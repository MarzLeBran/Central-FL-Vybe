#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CSV -> listings importer.
//
// Turns a scraped business CSV into BOTH halves of the seeding job:
//   1. src/data/mock-listings.json  — so the site is populated and looks live
//      today, before GHL Layer 0 exists.
//   2. out/ghl-import.csv           — a GoHighLevel-ready contact import.
//
// The GHL file exists because of one specific trap: HighLevel requires a first
// name on every contact, and the directory renders that field as the listing
// title. If you map the owner's name to First Name, every listing on your site
// shows a person's first name instead of the business. So this script always
// writes the BUSINESS NAME into First Name, and keeps any owner name separate.
//
// Usage:
//   node scripts/import-listings.mjs businesses.csv
//   node scripts/import-listings.mjs businesses.csv --merge
//   node scripts/import-listings.mjs businesses.csv --featured "Clean Lab by EZ,Hometown Pizza Co"
//   node scripts/import-listings.mjs businesses.csv --premium "Name A" --featured "Name B,Name C"
//   node scripts/import-listings.mjs businesses.csv --no-ai-descriptions
//
// Flags:
//   --merge              keep existing listings, add only slugs that aren't there yet
//   --featured           pipe/comma-separated business names to mark planTier=featured
//   --premium            pipe/comma-separated business names to mark planTier=premium
//                        (wins over --featured if a name is in both lists)
//   --no-ai-descriptions skip AI description generation even if ANTHROPIC_API_KEY is set
//   --dry                print what would happen, write nothing
//
// AEO descriptions: every listing needs a real, answer-engine-optimized
// description, not filler — see docs/ghl-layer-0.md's note on why the old
// "$name serves the local area." placeholder isn't good enough to publish.
// Any row that arrives with NO description (the common case — Google's Text
// Search doesn't return one; see scripts/find-businesses.mjs) gets one
// written by Claude from only the verified facts on hand: business name,
// category, city/county, and Google's own category tags when present (never
// invented specifics — no fake specialties, years in business, or awards). A
// row that already carries a real description (hand-curated CSV, a business
// that filled out /add-business) is left alone. Requires ANTHROPIC_API_KEY;
// falls back to the old generic placeholder if it's unset, never blocks the
// import either way.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LISTINGS_JSON = resolve(ROOT, "src/data/mock-listings.json");
const GHL_CSV = resolve(ROOT, "out/ghl-import.csv");

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const merge = args.includes("--merge");
const dry = args.includes("--dry");
// Business names contain commas ("Bella's Empanadas, Co."), so prefer a pipe
// separator and fall back to commas only when there is no pipe. A `featured`
// column in the CSV is more reliable than either — see ALIASES below.
function namesFromFlag(flag) {
  const raw = args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? "") : "";
  return new Set(
    raw
      .split(raw.includes("|") ? "|" : ",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}
const featuredNames = namesFromFlag("--featured");
const premiumNames = namesFromFlag("--premium");
const noAiDescriptions = args.includes("--no-ai-descriptions");

if (!csvPath) {
  console.error(
    'usage: node scripts/import-listings.mjs <file.csv> [--merge] [--featured "A,B"] [--premium "C,D"] [--dry]'
  );
  process.exit(1);
}

// ── tiny CSV parser (quoted fields, embedded commas and newlines) ────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Accepts the column names scrapers actually emit, not just one canonical set.
// County lookup, mirroring src/config/site.ts. Kept as a literal here so the
// importer stays a plain Node script with no build step. If you add a county or
// a city there, add it here too.
const COUNTIES = {
  Orange: ["Orlando","Winter Park","Apopka","Ocoee","Winter Garden","Maitland","Windermere","Belle Isle","Edgewood","Eatonville","Bay Lake","Doctor Phillips"],
  Osceola: ["Kissimmee","St. Cloud","Saint Cloud","Celebration","Harmony","Narcoossee","Poinciana","Buenaventura Lakes"],
  Seminole: ["Sanford","Altamonte Springs","Lake Mary","Longwood","Oviedo","Winter Springs","Casselberry","Heathrow"],
  Lake: ["Clermont","Leesburg","Eustis","Tavares","Mount Dora","Groveland","Minneola","Lady Lake","Umatilla","Fruitland Park","Astatula","Mascotte","Howey-in-the-Hills"],
  Brevard: ["Melbourne","West Melbourne","Palm Bay","Titusville","Cocoa Beach","Cocoa","Rockledge","Merritt Island","Viera","Satellite Beach","Cape Canaveral","Indialantic","Indian Harbour Beach","Suntree"],
  Volusia: ["Daytona Beach","South Daytona","Deltona","DeLand","Ormond Beach","Port Orange","New Smyrna Beach","Edgewater","DeBary","Orange City","Holly Hill","Ponce Inlet","Lake Helen","Pierson"],
  Polk: ["Lakeland","Winter Haven","Bartow","Haines City","Auburndale","Davenport","Lake Wales","Mulberry","Polk City","Dundee","Frostproof","Lake Alfred","Eagle Lake"],
};

// Longest needle first, so "West Melbourne" beats "Melbourne" and "Cocoa Beach"
// beats "Cocoa". Also matches "<County> County" — scraped rows often name the
// county with no city at all.
const COUNTY_NEEDLES = Object.entries(COUNTIES)
  .flatMap(([county, cities]) => [
    { needle: `${county.toLowerCase()} county`, county },
    ...cities.map((c) => ({ needle: c.toLowerCase(), county })),
  ])
  .sort((a, b) => b.needle.length - a.needle.length);

function countyForAddress(address) {
  const raw = String(address ?? "");
  const hay = raw.toLowerCase();

  // "<County> County" phrasing (scraped rows with no street/city at all) is
  // always checked against the whole string — it can't collide with a street
  // name the way a bare city name can.
  const countyPhraseHit = COUNTY_NEEDLES.find(
    ({ needle }) => needle.endsWith(" county") && hay.includes(needle)
  );
  if (countyPhraseHit) return countyPhraseHit.county;

  // Isolate the actual city from "..., City, ST 12345[, Country]" rather than
  // substring-matching the whole address — otherwise a street name that
  // happens to contain another city's name (e.g. "S Orlando Dr" in Sanford)
  // gets misread as the city itself. Falls back to the whole string for
  // addresses that don't have this shape (best effort, matches the old
  // behaviour only in that narrower case).
  const cityMatch = raw.match(/,\s*([^,]+?),\s*[A-Z]{2}\s*\d{5}/);
  const cityHay = (cityMatch ? cityMatch[1] : hay).toLowerCase();
  return COUNTY_NEEDLES.find(
    ({ needle }) => !needle.endsWith(" county") && cityHay.includes(needle)
  )?.county;
}

const ALIASES = {
  businessName: ["business name", "businessname", "name", "title", "company"],
  category: ["category", "business category", "type", "primary category"],
  description: ["description", "business description", "about", "summary"],
  address: ["address", "full address", "street address", "scraped address", "location"],
  phone: ["phone", "phone number", "telephone", "scraped phone"],
  website: ["website", "url", "site", "web"],
  rating: ["rating", "google rating", "stars", "review rating"],
  reviewCount: ["reviews", "review count", "google review count", "number of reviews"],
  ownerName: ["owner", "owner name", "first name", "contact name"],
  email: ["email", "email address"],
  featured: ["featured", "tier", "plan tier", "plan_tier"],
  county: ["county"],
  placeId: ["place id", "google place id", "placeid"],
  googleTypes: ["google types", "types"],
};

/** A `featured` column beats the --featured flag: no comma-escaping problems. */
function isTruthy(v) {
  return ["yes", "y", "true", "1", "featured", "premium"].includes(
    String(v ?? "").trim().toLowerCase()
  );
}

function buildIndex(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const at = norm.findIndex((h) => names.includes(h));
    if (at !== -1) idx[key] = at;
  }
  return idx;
}

function slugify(s) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function num(v) {
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

const GENERIC_DESCRIPTION = (name) => `${name} serves the local area.`;

// ── AEO description generation ────────────────────────────────────────────────
// One short Claude call per listing that's missing a real description. Kept
// deliberately simple (single call, no tools, no thinking needed) — this is
// exactly a "generate short copy from a few verified facts" task, not
// anything requiring multi-step reasoning.
async function writeAeoDescription(client, listing) {
  const cityMatch = String(listing.address ?? "").match(/,\s*([^,]+?),\s*[A-Z]{2}\s*\d{5}/);
  const city = cityMatch ? cityMatch[1] : undefined;
  const location = [city, listing.county && `${listing.county} County`].filter(Boolean).join(", ");

  const facts = [
    `Business name: ${listing.businessName}`,
    `Category: ${listing.category}`,
    location && `Location: ${location}, Florida`,
    listing._googleTypes &&
      `Google's own category tags for this business: ${listing._googleTypes.split(";").join(", ")}`,
  ].filter(Boolean).join("\n");

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system: [
      "You write short local-business directory descriptions optimized for answer",
      "engines (AEO) — clear, factual copy that a voice assistant or an AI search",
      'summary can quote directly to answer "is there a [category] in [city]" or',
      '"what does [business] do".',
      "",
      "Rules:",
      "1. One to two plain sentences. No headings, no marketing fluff, no emoji, no",
      "   surrounding quotation marks.",
      "2. State what kind of business it is and where it's located, clearly and near",
      "   the start.",
      "3. Use ONLY the facts given below. Never invent specialties, years in business,",
      "   awards, certifications, staff names, or customer testimonials that weren't",
      "   provided.",
      "4. If the only facts available are the name, category, and location, write a",
      "   plain, honest description of that category of business in that location —",
      '   don\'t pad it with vague unearned superlatives ("top-rated", "trusted",',
      '   "premier").',
      "5. Output only the description text, nothing else.",
    ].join("\n"),
    messages: [{ role: "user", content: facts }],
  });

  const text = response.content.find((b) => b.type === "text")?.text?.trim();
  if (!text) throw new Error("empty response");
  return text;
}

async function generateAeoDescriptions(items, { skip }) {
  const targets = items.filter((l) => l._needsDescription);
  if (!targets.length) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (skip || !apiKey) {
    if (!skip) {
      console.log(`\nnote: ANTHROPIC_API_KEY not set — ${targets.length} listing(s) got the generic`);
      console.log(`      placeholder description instead of an AEO-optimized one.`);
    }
    for (const l of targets) l.description = GENERIC_DESCRIPTION(l.businessName);
    return;
  }

  const client = new Anthropic({ apiKey });
  console.log(`\nWriting AEO descriptions for ${targets.length} listing(s) via Claude...`);

  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (l) => {
        try {
          l.description = await writeAeoDescription(client, l);
        } catch (err) {
          console.error(`  ${l.businessName}: generation failed (${err.message}) — using fallback`);
          l.description = GENERIC_DESCRIPTION(l.businessName);
        }
      })
    );
    console.error(`  ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}`);
  }
}

// ── read ─────────────────────────────────────────────────────────────────────
const rows = parseCsv(readFileSync(resolve(process.cwd(), csvPath), "utf8"));
if (rows.length < 2) { console.error("CSV has no data rows."); process.exit(1); }

const idx = buildIndex(rows[0]);
if (idx.businessName === undefined) {
  console.error(`Could not find a business-name column. Saw: ${rows[0].join(", ")}`);
  process.exit(1);
}

const existing = merge && existsSync(LISTINGS_JSON)
  ? JSON.parse(readFileSync(LISTINGS_JSON, "utf8"))
  : [];
const usedSlugs = new Set(existing.map((l) => l.slug));

const get = (row, key) => (idx[key] === undefined ? "" : (row[idx[key]] ?? "").trim());

const imported = [];
let skipped = 0;

for (const row of rows.slice(1)) {
  const businessName = get(row, "businessName");
  if (!businessName) continue;

  let slug = slugify(businessName);
  if (usedSlugs.has(slug)) {
    if (merge) { skipped++; continue; }
    let n = 2;
    while (usedSlugs.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  usedSlugs.add(slug);

  // An explicit county column wins; otherwise infer it from the address.
  const county = get(row, "county") || countyForAddress(get(row, "address"));

  const rating = num(get(row, "rating"));
  const reviewCount = num(get(row, "reviewCount"));
  // A name on --premium/--featured wins regardless of the CSV; otherwise the
  // row's own `featured` column can spell out the tier directly ("Premium"/
  // "All Access" vs "Featured"/"Spotlight"/yes/true/1 — see isTruthy above).
  const featuredCell = get(row, "featured").trim().toLowerCase();
  const isPremium =
    premiumNames.has(businessName.toLowerCase()) ||
    ["premium", "all access"].includes(featuredCell);
  const isFeatured =
    !isPremium &&
    (featuredNames.has(businessName.toLowerCase()) || isTruthy(featuredCell));
  const planTier = isPremium ? "premium" : isFeatured ? "featured" : "free";

  const rawDescription = get(row, "description");

  imported.push({
    id: `c_${slug}`,
    slug,
    businessName,
    category: get(row, "category") || "Uncategorised",
    description: rawDescription || undefined, // filled in below if empty
    address: get(row, "address"),
    county: county || undefined,
    phone: get(row, "phone"),
    website: get(row, "website") || undefined,
    rating,
    reviewCount: reviewCount === undefined ? undefined : Math.round(reviewCount),
    imageUrls: [],
    hours: undefined,
    socialLinks: undefined,
    planTier,
    claimStatus: "unclaimed",
    // Only Premium gets a per-listing AI agent (hasListingAgent() in
    // src/types/listing.ts) — Featured doesn't need this filled in.
    aiContext: isPremium ? `${businessName}. ${rawDescription}`.trim() : undefined,
    agencyClient: false,
    clientLocationId: undefined,
    placeId: get(row, "placeId") || undefined,
    _ownerName: get(row, "ownerName") || undefined,
    _email: get(row, "email") || undefined,
    _needsDescription: !rawDescription,
    _googleTypes: get(row, "googleTypes") || undefined,
  });
}

await generateAeoDescriptions(imported, { skip: noAiDescriptions });

// aiContext was computed before generation filled in `description` for rows
// that arrived without one — backfill it now so Premium's per-listing AI
// agent gets the real description too, not an empty one.
for (const l of imported) {
  if (l.planTier === "premium" && l._needsDescription) {
    l.aiContext = `${l.businessName}. ${l.description}`.trim();
  }
}

// Strip the import-only fields before they reach the app's data contract.
const listings = [...existing, ...imported].map(
  ({ _ownerName, _email, _needsDescription, _googleTypes, ...l }) => l
);

// ── GHL contact CSV ──────────────────────────────────────────────────────────
const esc = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const GHL_HEADER = [
  "First Name", "Last Name", "Email", "Phone", "Website",
  "business_name", "business_category", "business_description",
  "scraped_address", "county", "scraped_phone", "listing_slug",
  "google_rating", "google_review_count", "google_place_id", "ai_context",
  "plan_tier", "claim_status", "Tags",
];

const ghlRows = imported.map((l) => [
  l.businessName,              // First Name — the business, never the owner
  l._ownerName ?? "",
  l._email ?? "",
  l.phone,
  l.website ?? "",
  l.businessName,
  l.category,
  l.description,
  l.address,
  l.county ?? "",
  l.phone,
  l.slug,
  l.rating ?? "",
  l.reviewCount ?? "",
  l.placeId ?? "",
  l.aiContext ?? "",
  l.planTier === "premium" ? "Premium" : l.planTier === "featured" ? "Featured" : "Free",
  "Unclaimed",
  "business",                  // the tag that turns a contact into a listing
]);

// ── write ────────────────────────────────────────────────────────────────────
const featuredCount = listings.filter((l) => l.planTier === "featured").length;
const premiumCount = listings.filter((l) => l.planTier === "premium").length;

if (dry) {
  console.log(`[dry run] nothing written`);
} else {
  writeFileSync(LISTINGS_JSON, JSON.stringify(listings, null, 2) + "\n");
  mkdirSync(dirname(GHL_CSV), { recursive: true });
  writeFileSync(
    GHL_CSV,
    [GHL_HEADER, ...ghlRows].map((r) => r.map(esc).join(",")).join("\n") + "\n"
  );
}

console.log(`imported   ${imported.length}`);
if (skipped) console.log(`skipped    ${skipped} (slug already present, --merge)`);
console.log(`total      ${listings.length} listings, ${premiumCount} premium, ${featuredCount} featured`);
if (!dry) {
  console.log(`wrote      src/data/mock-listings.json`);
  console.log(`wrote      out/ghl-import.csv  (First Name = business name)`);
}
const unplaced = imported.filter((l) => !l.county).length;
if (unplaced) {
  console.log(`\nnote: ${unplaced} listing(s) had no recognisable county.`);
  console.log(`      They appear in search and category pages but not under a county.`);
  console.log(`      Add the missing city to COUNTIES in this script + config/site.ts.`);
}
if (featuredCount === 0) {
  console.log(`\nnote: no featured listings. Hand-pick 3+ with --featured "Name A,Name B"`);
  console.log(`      before you start outreach — a site with none reads as empty.`);
}

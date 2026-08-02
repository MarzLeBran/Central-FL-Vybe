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
//
// Flags:
//   --merge      keep existing listings, add only slugs that aren't there yet
//   --featured   comma-separated business names to mark planTier=featured
//   --dry        print what would happen, write nothing
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const featuredRaw = args.includes("--featured") ? (args[args.indexOf("--featured") + 1] ?? "") : "";
const featuredNames = new Set(
  featuredRaw
    .split(featuredRaw.includes("|") ? "|" : ",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

if (!csvPath) {
  console.error("usage: node scripts/import-listings.mjs <file.csv> [--merge] [--featured \"A,B\"] [--dry]");
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
  const hay = String(address ?? "").toLowerCase();
  return COUNTY_NEEDLES.find(({ needle }) => hay.includes(needle))?.county;
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
  const isFeatured =
    isTruthy(get(row, "featured")) || featuredNames.has(businessName.toLowerCase());

  imported.push({
    id: `c_${slug}`,
    slug,
    businessName,
    category: get(row, "category") || "Uncategorised",
    description: get(row, "description") || `${businessName} serves the local area.`,
    address: get(row, "address"),
    county: county || undefined,
    phone: get(row, "phone"),
    website: get(row, "website") || undefined,
    rating,
    reviewCount: reviewCount === undefined ? undefined : Math.round(reviewCount),
    imageUrls: [],
    hours: undefined,
    socialLinks: undefined,
    planTier: isFeatured ? "featured" : "free",
    claimStatus: "unclaimed",
    aiContext: isFeatured ? `${businessName}. ${get(row, "description")}`.trim() : undefined,
    agencyClient: false,
    clientLocationId: undefined,
    _ownerName: get(row, "ownerName") || undefined,
    _email: get(row, "email") || undefined,
  });
}

// Strip the import-only fields before they reach the app's data contract.
const listings = [...existing, ...imported].map(({ _ownerName, _email, ...l }) => l);

// ── GHL contact CSV ──────────────────────────────────────────────────────────
const esc = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const GHL_HEADER = [
  "First Name", "Last Name", "Email", "Phone", "Website",
  "business_name", "business_category", "business_description",
  "scraped_address", "county", "scraped_phone", "listing_slug",
  "google_rating", "google_review_count", "plan_tier", "claim_status", "Tags",
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
  l.planTier === "featured" ? "Featured" : "Free",
  "Unclaimed",
  "business",                  // the tag that turns a contact into a listing
]);

// ── write ────────────────────────────────────────────────────────────────────
const featuredCount = listings.filter((l) => l.planTier === "featured").length;

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
console.log(`total      ${listings.length} listings, ${featuredCount} featured`);
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

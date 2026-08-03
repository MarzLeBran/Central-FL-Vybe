#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Real-business sourcing via Google Places API (New) Text Search — legitimate,
// ToS-compliant alternative to scraping Google Maps directly (which its ToS
// forbids). Turns a list of "category in city" searches into a CSV shaped for
// scripts/import-listings.mjs.
//
// Cost: requesting phone + website pulls each call into the Enterprise SKU
// ($35 per 1,000 requests, see docs/google-apis.md) rather than the cheaper
// Pro tier — still trivial at this scale. One query = one request = up to 20
// results. Sourcing the ~25-50 businesses Layer 0 wants typically takes
// 10-20 queries, i.e. under $1. Deliberately does NOT request `rating` — that
// would push the SAME call into the even pricier Enterprise+Atmosphere SKU
// for no reason; ratings/reviews are the separate, paid-listings-only
// scripts/import-reviews.mjs, run later, after a business is actually Featured.
//
// Usage:
//   node scripts/find-businesses.mjs queries.txt > out/sourced.csv
//   node scripts/find-businesses.mjs --default > out/sourced.csv
//
// queries.txt: one "Category Label|search text" per line, e.g.
//   Plumbing|plumbers in Orlando FL
//   Restaurants|restaurants in Winter Park FL
// Blank lines and lines starting with # are skipped.
//
// --default runs a small starter set — one broadly-useful category per
// county seat — enough to seed an initial live-looking directory. Edit
// DEFAULT_QUERIES below or pass your own file for anything more targeted.
//
// Requires GOOGLE_PLACES_API_KEY in .env (server-side only — this is a local
// script, never shipped to the browser). Needs a Google Cloud project with
// "Places API (New)" enabled and billing attached (billing is required even
// to stay within the free monthly allowance — see docs/google-apis.md).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ROOT = resolve(import.meta.dirname, "..");

const DEFAULT_QUERIES = [
  ["Restaurants", "restaurants in Orlando FL"],
  ["Home Services", "home services in Orlando FL"],
  ["Auto Repair", "auto repair shops in Kissimmee FL"],
  ["Hair Salons", "hair salons in Sanford FL"],
  ["Plumbing", "plumbers in Clermont FL"],
  ["Electrical", "electricians in Melbourne FL"],
  ["Health & Wellness", "health and wellness in Daytona Beach FL"],
  ["Landscaping & Lawn Care", "landscaping companies in Lakeland FL"],
];

const args = process.argv.slice(2);
const useDefault = args.includes("--default");
const queriesFile = args.find((a) => !a.startsWith("--"));

if (!API_KEY) {
  console.error("GOOGLE_PLACES_API_KEY is not set. Add it to .env (see docs/google-apis.md).");
  process.exit(1);
}
if (!useDefault && !queriesFile) {
  console.error("Usage: node scripts/find-businesses.mjs <queries.txt> | --default");
  process.exit(1);
}

const queries = useDefault
  ? DEFAULT_QUERIES
  : readFileSync(queriesFile, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const [category, ...rest] = l.split("|");
        return [category.trim(), rest.join("|").trim()];
      });

const FIELD_MASK = [
  "places.id",                  // Essentials tier — free, no cost impact
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.types",                // Pro tier — already included at the Enterprise
                                  // level phone/website put us at; real signal
                                  // for the AEO description generator (not a
                                  // guess), never persisted as a Listing field.
].join(",");

async function searchText(query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, pageSize: 20 }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.places ?? [];
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const seen = new Set();
  const rows = [["Business Name", "Category", "Address", "Phone", "Website", "Place ID", "Google Types"]];

  for (const [category, query] of queries) {
    console.error(`Searching: ${query} (${category})`);
    let places;
    try {
      places = await searchText(query);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      continue;
    }
    let added = 0;
    for (const p of places) {
      const name = p.displayName?.text;
      if (!name) continue;
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([
        name,
        category,
        p.formattedAddress ?? "",
        p.nationalPhoneNumber ?? "",
        p.websiteUri ?? "",
        p.id ?? "",
        (p.types ?? []).join(";"),
      ]);
      added++;
    }
    console.error(`  +${added} new (${places.length} found, ${places.length - added} duplicate)`);
    // Be polite; Text Search has no documented rate limit but there's no
    // reason to hammer it for a one-off sourcing run.
    await new Promise((r) => setTimeout(r, 200));
  }

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  mkdirSync(resolve(ROOT, "out"), { recursive: true });
  const outPath = resolve(ROOT, "out", "sourced-businesses.csv");
  writeFileSync(outPath, csv);
  console.error(`\n${rows.length - 1} businesses written to out/sourced-businesses.csv`);
  console.error(`Review it, then: npm run import -- out/sourced-businesses.csv --featured "Name A|Name B|Name C"`);
}

main();

#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Google Reviews importer.
//
// Refreshes `rating`/`reviewCount` for PAID listings only, from Google's Places
// API Place Details (`reviews`/`rating` fields bill at the Enterprise +
// Atmosphere SKU, $40 per 1,000 requests — see docs/google-apis.md). Run this
// on a schedule (cron / GitHub Action), NEVER wired into `npm run build` — a
// static build touches every listing every time, which would mean a Places
// call per build, not per refresh interval.
//
// A listing needs a `placeId` (google_place_id custom field, admin-filled —
// see docs/ghl-layer-0.md) to be fetched at all. Paid listings with no
// placeId are skipped and logged, not guessed at, since matching by name +
// address risks pulling in the wrong business's reviews.
//
// Caches results in out/reviews-cache.json (gitignored, like
// out/dev-submissions.jsonl) keyed by listing id, with a `fetchedAt`
// timestamp. A listing fetched within --max-age-days is skipped on the next
// run — that's what keeps this "cache, never refetch per build" rather than
// re-billing every listing on every run. NOTE: Google's terms also restrict
// how long Places content may be cached — check the current terms before
// relying on the default below for anything beyond local testing.
//
// Usage:
//   node scripts/import-reviews.mjs
//   node scripts/import-reviews.mjs --max-age-days 14
//   node scripts/import-reviews.mjs --force        (ignore the cache)
//   node scripts/import-reviews.mjs --dry           (fetch nothing, print who'd be fetched)
//
// DATA_SOURCE (env, default "mock") picks the read/write target, mirroring
// src/lib/directory.ts / src/lib/submissions.ts:
//   mock — reads/writes src/data/mock-listings.json directly
//   ghl  — reads/writes GHL contacts via GHL_PIT_TOKEN + GHL_LOCATION_ID
// This script is plain Node with no build step, so — same as
// scripts/import-listings.mjs and its county table — it carries its own copy
// of the GHL read/write logic rather than importing from src/lib/*.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LISTINGS_JSON = resolve(ROOT, "src/data/mock-listings.json");
const CACHE_JSON = resolve(ROOT, "out/reviews-cache.json");

const DATA_SOURCE = process.env.DATA_SOURCE ?? "mock";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GHL_VERSION = "2021-07-28";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const force = args.includes("--force");
const maxAgeDays = args.includes("--max-age-days")
  ? Number(args[args.indexOf("--max-age-days") + 1])
  : 7;

const isPaidTier = (tier) => tier === "featured" || tier === "premium";

async function main() {
  if (!GOOGLE_PLACES_API_KEY && !dry) {
    console.error("GOOGLE_PLACES_API_KEY is not set. Add it to .env (server-side only, never client JS).");
    process.exit(1);
  }

  const cache = loadCache();
  const { listings, save } = DATA_SOURCE === "ghl" ? await loadFromGHL() : loadFromMock();

  const candidates = listings.filter((l) => isPaidTier(l.planTier));
  const withPlaceId = candidates.filter((l) => l.placeId);
  const missingPlaceId = candidates.filter((l) => !l.placeId);

  if (missingPlaceId.length) {
    console.log(`Skipping ${missingPlaceId.length} paid listing(s) with no placeId:`);
    for (const l of missingPlaceId) console.log(`  - ${l.businessName} (${l.id})`);
  }

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const toFetch = withPlaceId.filter((l) => {
    const cached = cache[l.id];
    return force || !cached || now - new Date(cached.fetchedAt).getTime() > maxAgeMs;
  });

  console.log(`${toFetch.length}/${withPlaceId.length} paid listing(s) with a placeId need a refresh.`);
  if (dry) {
    for (const l of toFetch) console.log(`  [dry] would fetch ${l.businessName} (${l.placeId})`);
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const listing of toFetch) {
    try {
      const details = await fetchPlaceDetails(listing.placeId);
      if (details) {
        listing.rating = details.rating;
        listing.reviewCount = details.reviewCount;
        cache[listing.id] = { ...details, fetchedAt: new Date().toISOString() };
        updated++;
        console.log(`  ✓ ${listing.businessName}: ${details.rating}★ (${details.reviewCount})`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${listing.businessName}: ${err.message}`);
    }
  }

  if (updated > 0) await save(listings);
  saveCache(cache);
  console.log(`Done. ${updated} updated, ${failed} failed, ${withPlaceId.length - toFetch.length} skipped (fresh).`);
}

// ── Google Places ────────────────────────────────────────────────────────────

async function fetchPlaceDetails(placeId) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "rating,user_ratings_total");
  url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(data.status);

  return {
    rating: data.result?.rating,
    reviewCount: data.result?.user_ratings_total,
  };
}

// ── mock mode ────────────────────────────────────────────────────────────────

function loadFromMock() {
  const listings = JSON.parse(readFileSync(LISTINGS_JSON, "utf-8"));
  return {
    listings,
    save: async (all) => writeFileSync(LISTINGS_JSON, JSON.stringify(all, null, 2) + "\n"),
  };
}

// ── ghl mode ─────────────────────────────────────────────────────────────────
// Duplicates the id->key custom-field resolution from src/lib/directory.ts —
// this script has no build step, so it can't import that TS module directly.

async function loadFromGHL() {
  const token = requireEnv("GHL_PIT_TOKEN");
  const locationId = requireEnv("GHL_LOCATION_ID");

  const keyMap = await fetchCustomFieldKeyMap(token, locationId);
  const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      locationId,
      pageLimit: 100,
      filters: [{ field: "tags", operator: "contains", value: "business" }],
    }),
  });
  if (!res.ok) throw new Error(`GHL fetch failed: ${res.status}`);
  const data = await res.json();

  const cf = (contact, key) => {
    const field = (contact.customFields ?? []).find((f) => f.key === key || keyMap.get(f.id) === key);
    return field?.value;
  };

  const listings = (data.contacts ?? []).map((c) => ({
    id: c.id,
    businessName: cf(c, "business_name") ?? "",
    planTier: normalizePlanTier(cf(c, "plan_tier")),
    placeId: cf(c, "google_place_id") || undefined,
    rating: undefined,
    reviewCount: undefined,
  }));

  return {
    listings,
    save: async (all) => {
      for (const l of all) {
        if (l.rating == null) continue;
        await fetch(`https://services.leadconnectorhq.com/contacts/${l.id}`, {
          method: "PUT",
          headers: ghlHeaders(token),
          body: JSON.stringify({
            customFields: [
              { key: "google_rating", fieldValue: String(l.rating) },
              { key: "google_review_count", fieldValue: String(l.reviewCount) },
            ],
          }),
        });
      }
    },
  };
}

async function fetchCustomFieldKeyMap(token, locationId) {
  const res = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION },
  });
  if (!res.ok) throw new Error(`GHL customFields fetch failed: ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const f of data.customFields ?? []) map.set(f.id, f.key ?? f.fieldKey);
  return map;
}

function normalizePlanTier(v) {
  const s = String(v ?? "").toLowerCase();
  if (s === "premium" || s === "all access") return "premium";
  if (s === "featured" || s === "spotlight") return "featured";
  return "free";
}

function ghlHeaders(token) {
  return { Authorization: `Bearer ${token}`, Version: GHL_VERSION, "Content-Type": "application/json" };
}

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`${key} is not set.`);
    process.exit(1);
  }
  return v;
}

// ── cache ────────────────────────────────────────────────────────────────────

function loadCache() {
  if (!existsSync(CACHE_JSON)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_JSON, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  mkdirSync(dirname(CACHE_JSON), { recursive: true });
  writeFileSync(CACHE_JSON, JSON.stringify(cache, null, 2) + "\n");
}

main();

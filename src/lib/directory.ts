// ─────────────────────────────────────────────────────────────────────────────
// THE DATA ADAPTER — the only file in the app that knows where listings come from.
// Everything else imports getListings/getListingBySlug and never touches GHL directly.
//
// Right now DATA_SOURCE=mock reads local JSON, so the whole site runs with zero setup.
// When your GHL Private Integration token + field keys are ready, set DATA_SOURCE=ghl
// and fill in fetchFromGHL(). Nothing else in the app changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { Listing } from "../types/listing";
import { isPaidTier } from "../types/listing";
import mock from "../data/mock-listings.json";

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";

// ── Public API (everything else in the app uses these four) ──────────────────

export async function getListings(): Promise<Listing[]> {
  const all = DATA_SOURCE === "ghl" ? await fetchFromGHL() : (mock as Listing[]);
  return all.filter((l) => l.claimStatus !== undefined); // = anything tagged `business`
}

export async function getListingBySlug(slug?: string): Promise<Listing | null> {
  if (!slug) return null;
  const all = await getListings();
  return all.find((l) => l.slug === slug) ?? null;
}

/** Looked up by GHL contact id — this is the token in claim links (`?t=`). */
export async function getListingById(id?: string): Promise<Listing | null> {
  if (!id) return null;
  const all = await getListings();
  return all.find((l) => l.id === id) ?? null;
}

/** Every listing on a paid plan — both featured and premium. Top tier first. */
export async function getFeaturedListings(): Promise<Listing[]> {
  return (await getListings())
    .filter((l) => isPaidTier(l.planTier))
    .sort((a, b) => Number(b.planTier === "premium") - Number(a.planTier === "premium"));
}

export async function getListingsByCategory(): Promise<Record<string, Listing[]>> {
  const grouped: Record<string, Listing[]> = {};
  for (const l of await getListings()) (grouped[l.category] ??= []).push(l);
  return grouped;
}

// ── GHL implementation (fill this in at Layer 1 wiring) ──────────────────────
// GHL API v2: https://services.leadconnectorhq.com
// Header: Authorization: Bearer <PRIVATE_INTEGRATION_TOKEN>, Version: 2021-07-28
//
// Plan: search contacts with tag `business` in your directory sub-account, then map
// each contact's customFields into the Listing shape via mapContactToListing().

async function fetchFromGHL(): Promise<Listing[]> {
  const token = import.meta.env.GHL_PIT_TOKEN;
  const locationId = import.meta.env.GHL_LOCATION_ID;

  const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locationId,
      pageLimit: 100,
      filters: [{ field: "tags", operator: "contains", value: "business" }],
    }),
  });

  if (!res.ok) throw new Error(`GHL fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts ?? []).map(mapContactToListing);
}

// Maps one GHL contact -> our Listing. Fill the custom-field KEYS with the exact
// keys you created in Layer 0 (GHL exposes them as an array on the contact).
//
// ⚠️ KNOWN GAP, not yet fixed: GHL's contact read responses (GET/search) only
// return `{ id, value }` per custom field — the human-readable `key` you set in
// Layer 0 (e.g. "business_name") is NOT included on read, only on write. So
// `cf()`'s `f.key === key` branch below will never match against a real GHL
// response; it only works today because DATA_SOURCE=mock reads mock JSON with
// keys already spelled out. Before flipping DATA_SOURCE=ghl, this needs one of:
//   (a) call GET /locations/:locationId/customFields once, cache an id->key
//       map, and resolve `cf()` through it, or
//   (b) hardcode the field ids you get from Layer 0 directly into this map.
// The WRITE side (src/lib/submissions.ts) does not have this problem — GHL's
// update/create endpoints accept `key` directly in the request body.
function mapContactToListing(c: any): Listing {
  const cf = (key: string) =>
    (c.customFields ?? []).find((f: any) => f.id === key || f.key === key)?.value;

  return {
    id: c.id,
    slug: cf("listing_slug") ?? slugify(cf("business_name") ?? c.id),
    businessName: cf("business_name") ?? "",
    category: cf("business_category") ?? "Uncategorized",
    description: cf("business_description") ?? "",
    address: cf("scraped_address") ?? "",
    county: cf("county") || undefined,
    phone: cf("scraped_phone") ?? c.phone ?? "",
    website: cf("website"),
    rating: num(cf("google_rating")),
    reviewCount: num(cf("google_review_count")),
    imageUrls: parseList(cf("image_urls")),
    hours: cf("hours"),
    socialLinks: parseJson(cf("social_links")),
    planTier: normalizePlanTier(cf("plan_tier")),
    claimStatus: (cf("claim_status") ?? "unclaimed").toLowerCase() as Listing["claimStatus"],
    aiContext: cf("ai_context"),
    agencyClient: String(cf("agency_client")).toLowerCase() === "true",
    clientLocationId: cf("client_location_id") || undefined,
  };
}

function normalizePlanTier(v: unknown): Listing["planTier"] {
  const s = String(v ?? "").toLowerCase();
  if (s === "premium" || s === "all access") return "premium";
  if (s === "featured" || s === "spotlight") return "featured";
  return "free";
}

// ── tiny helpers ─────────────────────────────────────────────────────────────
const num = (v: any) => (v == null || v === "" ? undefined : Number(v));
const parseList = (v: any) => (Array.isArray(v) ? v : (v ?? "").split(",").map((s: string) => s.trim()).filter(Boolean));
const parseJson = (v: any) => { try { return typeof v === "object" ? v : JSON.parse(v); } catch { return undefined; } };
export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

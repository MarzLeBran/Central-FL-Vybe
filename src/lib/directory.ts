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

/** Looked up by the owner's email — GHL's native field, set at claim time.
 *  Used only by the owner self-serve login flow (src/lib/auth.ts). */
export async function getListingByEmail(email?: string): Promise<Listing | null> {
  if (!email) return null;
  const needle = email.trim().toLowerCase();
  const all = await getListings();
  return all.find((l) => l.email?.toLowerCase() === needle) ?? null;
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

  const [contacts, keyMap] = await Promise.all([
    searchAllContacts(token, locationId),
    getCustomFieldKeyMap(token, locationId),
  ]);

  return contacts.map((c: any) => mapContactToListing(c, keyMap));
}

// contacts/search caps at 100 per page; paginate with searchAfter (built from the
// last contact's dateAdded + id) until a short page signals there's nothing left.
async function searchAllContacts(token: string, locationId: string): Promise<any[]> {
  const pageLimit = 100;
  const all: any[] = [];
  let searchAfter: [number, string] | undefined;

  while (true) {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId,
        pageLimit,
        filters: [{ field: "tags", operator: "contains", value: "business" }],
        ...(searchAfter ? { searchAfter } : {}),
      }),
    });
    if (!res.ok) throw new Error(`GHL fetch failed: ${res.status}`);
    const data = await res.json();
    const contacts = data.contacts ?? [];
    all.push(...contacts);
    if (contacts.length < pageLimit) break;
    const last = contacts[contacts.length - 1];
    searchAfter = [Date.parse(last.dateAdded), last.id];
  }
  return all;
}

// Resolves GHL's per-field `id` back to the human `key` (e.g. "business_name")
// set in Layer 0. Needed because contact read responses (GET/search) only
// return `{ id, value }` per custom field — the key is write-only. One call per
// build, cached in-module: field definitions don't change mid-build.
let customFieldKeyMapPromise: Promise<Map<string, string>> | null = null;

function getCustomFieldKeyMap(token: string, locationId: string): Promise<Map<string, string>> {
  if (!customFieldKeyMapPromise) {
    customFieldKeyMapPromise = (async () => {
      const res = await fetch(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } }
      );
      if (!res.ok) throw new Error(`GHL customFields fetch failed: ${res.status}`);
      const data = await res.json();
      // fieldKey comes back namespaced ("contact.business_name") — strip the
      // prefix so it matches the bare keys set in Layer 0 and used by cf().
      const map = new Map<string, string>();
      for (const f of data.customFields ?? []) {
        const key = f.key ?? f.fieldKey;
        map.set(f.id, key?.startsWith("contact.") ? key.slice("contact.".length) : key);
      }
      return map;
    })();
  }
  return customFieldKeyMapPromise;
}

// Maps one GHL contact -> our Listing. Fill the custom-field KEYS with the exact
// keys you created in Layer 0 (GHL exposes them as an array on the contact).
function mapContactToListing(c: any, keyMap: Map<string, string>): Listing {
  const cf = (key: string) => {
    const field = (c.customFields ?? []).find(
      (f: any) => f.key === key || keyMap.get(f.id) === key
    );
    return field?.value;
  };

  return {
    id: c.id,
    slug: cf("listing_slug") ?? slugify(cf("business_name") ?? c.companyName ?? c.firstName ?? c.id),
    businessName: cf("business_name") ?? c.companyName ?? c.firstName ?? "",
    category: cf("business_category") ?? "Uncategorized",
    description: cf("business_description") ?? "",
    // no contact person on these — business name/address live on GHL's native
    // companyName/firstName/address fields, not the scraped_* custom fields.
    address: cf("scraped_address") ?? c.address ?? "",
    county: cf("county") || undefined,
    phone: cf("scraped_phone") ?? c.phone ?? "",
    website: cf("website") ?? c.website,
    rating: num(cf("google_rating")),
    reviewCount: num(cf("google_review_count")),
    imageUrls: parseList(cf("image_urls")),
    hours: cf("hours"),
    socialLinks: parseSocialLinks(cf("social_links")),
    logoUrl: cf("logo_url") || undefined,
    youtubeUrl: cf("youtube_url") || undefined,
    bookingUrl: cf("booking_url") || undefined,
    extraLinks: parseExtraLinks(cf("extra_links")),
    specialOffer: cf("special_offer") || undefined,
    planTier: normalizePlanTier(cf("plan_tier")),
    claimStatus: (cf("claim_status") ?? "unclaimed").toLowerCase() as Listing["claimStatus"],
    email: c.email || undefined,
    aiContext: cf("ai_context"),
    aiAgentEnabled: String(cf("ai_agent_enabled")).toLowerCase() === "true",
    agencyClient: String(cf("agency_client")).toLowerCase() === "true",
    clientLocationId: cf("client_location_id") || undefined,
    placeId: cf("google_place_id") || undefined,
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

// social_links is a Multi-line GHL field, one `network=https://url` per line —
// human-readable/editable directly in GHL, matching this repo's convention
// for every other multi-value field (image_urls is CSV, hours is plain text).
function parseSocialLinks(v: any): Record<string, string> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) return v; // already an object (mock data)
  const lines = String(v ?? "").split(/\r?\n/);
  const out: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    const network = line.slice(0, i).trim().toLowerCase();
    const url = line.slice(i + 1).trim();
    if (network && url) out[network] = url;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Inverse of parseSocialLinks — used by submissions.ts to write the field
 *  back in the same human-readable format. */
export function serializeSocialLinks(links: Record<string, string> | undefined): string {
  return Object.entries(links ?? {})
    .filter(([, url]) => url)
    .map(([network, url]) => `${network}=${url}`)
    .join("\n");
}

// extra_links is the same one-per-line convention as social_links, but the
// left side is an owner-chosen label rather than a fixed network name, so it
// uses "|" (never legal in a label) instead of "=" (legal in a query string).
function parseExtraLinks(v: any): { label: string; url: string }[] | undefined {
  if (Array.isArray(v)) return v; // already structured (mock data)
  const lines = String(v ?? "").split(/\r?\n/);
  const out: { label: string; url: string }[] = [];
  for (const line of lines) {
    const i = line.indexOf("|");
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    const url = line.slice(i + 1).trim();
    if (label && url) out.push({ label, url });
  }
  return out.length ? out : undefined;
}

/** Inverse of parseExtraLinks — used by submissions.ts. */
export function serializeExtraLinks(links: { label: string; url: string }[] | undefined): string {
  return (links ?? [])
    .filter((l) => l.label && l.url)
    .map((l) => `${l.label}|${l.url}`)
    .join("\n");
}

export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

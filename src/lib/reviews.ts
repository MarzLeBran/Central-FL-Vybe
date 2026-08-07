// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE PLACES LOOKUP — shared by the webhook (src/pages/api/webhooks/reviews.ts)
// that auto-backfills a rating the moment a listing goes paid. NOT used by
// scripts/import-reviews.mjs, which deliberately carries its own copy — it's
// a plain Node script with no build step, same reasoning as its GHL logic.
//
// Cost guardrail (docs/google-apis.md): Place Details bills $40/1000 requests
// the moment you ask for `rating`. Guard every call with isPaidTier() and
// only fetch once per listing (see hasExistingRating in the webhook) — this
// file does not cache or rate-limit on its own, callers must.
// ─────────────────────────────────────────────────────────────────────────────

const GHL_VERSION = "2021-07-28";

export interface PlaceDetails {
  rating: number;
  reviewCount: number;
}

export interface ContactReviewInfo {
  isPaidBusiness: boolean;
  placeId?: string;
  hasExistingRating: boolean;
  businessName: string;
}

function ghlHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Version: GHL_VERSION, "Content-Type": "application/json" };
}

/**
 * Single-contact lookup for the webhook — deliberately NOT a shared import
 * from directory.ts, which fetches and maps the WHOLE listings set for a
 * build. Re-fetches the contact fresh from GHL rather than trusting anything
 * in the webhook's own POST body — see the route's own comment on why.
 */
export async function getContactReviewInfo(contactId: string): Promise<ContactReviewInfo | null> {
  const token = import.meta.env.GHL_PIT_TOKEN;
  const locationId = import.meta.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL env vars are not set");

  const [contactRes, keyMap] = await Promise.all([
    fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      headers: ghlHeaders(token),
    }),
    getCustomFieldKeyMap(token, locationId),
  ]);
  if (contactRes.status === 404) return null;
  if (!contactRes.ok) throw new Error(`GHL contact fetch failed: ${contactRes.status}`);

  // NOTE: GET /contacts/:id's exact response shape (contact nested under a
  // `contact` key vs the object itself) wasn't independently verified here —
  // same category of unconfirmed-shape caveat as the Create Contact response
  // in consumer-submissions.ts. Handle both; smoke-test against a live
  // sandbox contact before trusting this in production.
  const body = await contactRes.json();
  const contact = body.contact ?? body;
  const cf = (key: string) => {
    const field = (contact.customFields ?? []).find(
      (f: any) => f.key === key || keyMap.get(f.id) === key
    );
    return field?.value;
  };

  const tags: string[] = contact.tags ?? [];
  const planTier = String(cf("plan_tier") ?? "").toLowerCase();
  const isPaid = planTier === "featured" || planTier === "spotlight" || planTier === "premium" || planTier === "all access";

  return {
    isPaidBusiness: tags.includes("business") && isPaid,
    placeId: cf("google_place_id") || undefined,
    hasExistingRating: !!cf("google_rating"),
    businessName: cf("business_name") ?? contact.companyName ?? contact.firstName ?? contactId,
  };
}

export async function writeReviewFields(contactId: string, details: PlaceDetails): Promise<void> {
  const token = import.meta.env.GHL_PIT_TOKEN;
  if (!token) throw new Error("GHL_PIT_TOKEN is not set");

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      customFields: [
        { key: "google_rating", fieldValue: String(details.rating) },
        { key: "google_review_count", fieldValue: String(details.reviewCount) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`GHL update failed: ${res.status}`);
}

let customFieldKeyMapPromise: Promise<Map<string, string>> | null = null;

function getCustomFieldKeyMap(token: string, locationId: string): Promise<Map<string, string>> {
  if (!customFieldKeyMapPromise) {
    customFieldKeyMapPromise = (async () => {
      const res = await fetch(
        `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
        { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } }
      );
      if (!res.ok) throw new Error(`GHL customFields fetch failed: ${res.status}`);
      const data = await res.json();
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

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = import.meta.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "rating,user_ratings_total");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Places status ${data.status}`);

  // Google returns no `rating` at all for a business with zero reviews yet —
  // write 0 rather than skip, so the caller has something non-empty to store
  // and doesn't re-fetch (re-bill) this same listing on every future edit.
  return {
    rating: data.result?.rating ?? 0,
    reviewCount: data.result?.user_ratings_total ?? 0,
  };
}

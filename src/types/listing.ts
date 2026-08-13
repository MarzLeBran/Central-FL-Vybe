// The single data contract for the whole app.
// Both the front end (Astro pages) and the data layer (GHL adapter) speak THIS shape.
// GHL contact custom fields map INTO this; nothing else in the app touches GHL's raw shape.

// Three paid-plan levels, low to high. Display names, prices and the feature
// matrix all live in `src/config/site.ts` — these ids are the stable keys the
// data and the GHL `plan_tier` field speak in, so renaming a plan in marketing
// never touches the data.
//   free     -> the always-free listing
//   featured -> mid tier: placement, richer listing, Google reviews + map
//   premium  -> top tier: everything, incl. the per-listing AI agent
export type PlanTier = "free" | "featured" | "premium";
export type ClaimStatus = "unclaimed" | "pending" | "claimed";

/** Anything on a paid plan. Drives placement and the Featured mark. */
export function isPaidTier(tier: PlanTier): boolean {
  return tier !== "free";
}

/** Premium is necessary but not sufficient — a real agent still has to be
 *  built and enabled per business (`aiAgentEnabled`, manually flipped on once
 *  Layer 5 work is actually done for that listing). Being on the top tier
 *  alone must never show an "Ask the business" card with nothing behind it —
 *  see the widget rule in AGENTS.md. */
export function hasListingAgent(listing: Pick<Listing, "planTier" | "aiAgentEnabled">): boolean {
  return listing.planTier === "premium" && !!listing.aiAgentEnabled;
}

/** Sort order for grids: highest plan first. Placement is what a plan buys. */
export function tierRank(tier: PlanTier): number {
  return tier === "premium" ? 0 : tier === "featured" ? 1 : 2;
}

// Per-listing content types (Featured/Premium perks: "Custom blog", "Add
// events", "Share news stories", "Feature your team" in site.planFeatures).
// Each lives on the business's OWN page (business/[slug].astro) — not a
// site-wide "/blog" or "/events" hub; those are a separate, still-deferred
// Layer 7 concept gated by site.exploreLinks' `enabled` flags.
//
// GHL has no sub-object/collection field type, so each list is stored as a
// JSON string in one Multi-line custom field (see docs/ghl-layer-0.md) —
// not the "one line per entry" convention socialLinks/extraLinks use,
// because a post body can itself contain newlines. `id` is a client-generated
// uuid, just a stable key for the editor's add/remove UI, not read anywhere
// else.
export interface BlogPost {
  id: string;
  title: string;
  date: string;    // ISO yyyy-mm-dd, from a <input type="date">
  body: string;     // plain text, not markdown — line breaks preserved, no formatting
  imageUrl?: string;
}
export interface NewsItem {
  id: string;
  title: string;
  date: string;
  body: string;
  imageUrl?: string;
}
export interface EventItem {
  id: string;
  title: string;
  date: string;
  time?: string;
  location?: string;
  description: string;
  imageUrl?: string;
}
export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio?: string;
  imageUrl?: string; // same field name as the other three entry types on
                      // purpose — one shared editor/validator, not a special case
}

export interface Listing {
  id: string;                 // GHL contact id
  slug: string;               // URL key, e.g. "clean-lab-by-ez"  (custom field: listing_slug)
  businessName: string;       // business_name
  category: string;           // business_category
  description: string;        // business_description
  address: string;            // scraped_address
  county?: string;            // county — the second browse axis, alongside category.
                              // Optional on purpose: a listing whose city we cannot
                              // place still appears everywhere except county pages.
  phone: string;              // scraped_phone
  website?: string;
  rating?: number;            // google_rating
  reviewCount?: number;       // google_review_count
  placeId?: string;           // google_place_id — required to fetch this business's
                              // Google reviews (Layer 4); admin-filled, not scraped
  imageUrls: string[];        // image_urls (parsed)
  hours?: string;             // hours
  socialLinks?: Record<string, string>; // social_links (parsed)
  logoUrl?: string;           // logo_url — owner-uploaded, separate from imageUrls[0]/cover
  youtubeUrl?: string;        // youtube_url — curated safe embed, validated at write time
  bookingUrl?: string;        // booking_url — curated safe embed (e.g. Calendly), validated at write time
  extraLinks?: { label: string; url: string }[]; // extra_links — owner-curated link list (structured
                              // fields, not raw HTML/embeds — see the "no custom code" note in AGENTS.md)
  specialOffer?: string;      // special_offer — free-text coupon/promo blurb, owner-edited
  specialOfferImageUrl?: string; // special_offer_image — optional photo for the deal card

  blogPosts?: BlogPost[];     // blog_posts — JSON
  newsItems?: NewsItem[];     // news_items — JSON
  events?: EventItem[];       // events — JSON
  team?: TeamMember[];        // team — JSON

  planTier: PlanTier;         // plan_tier  -> drives Featured styling + which chat widget
  claimStatus: ClaimStatus;   // claim_status
  email?: string;             // GHL's native contact email — set at claim time; used to
                              // look up a listing for owner self-serve login (src/lib/auth.ts)

  // Per-listing AI agent (Premium only, and only once actually built)
  aiContext?: string;         // ai_context — the knowledge blurb the business agent uses
  aiAgentEnabled?: boolean;   // ai_agent_enabled — manually flipped on once a real agent has
                              // been built for this specific business (see hasListingAgent()).
                              // Premium alone does NOT imply this — most premium listings
                              // won't have it yet.

  // Agency-client lead routing (see Layer 5 in the build doc)
  agencyClient: boolean;      // agency_client — true once they buy monthly agency services
  clientLocationId?: string;  // client_location_id — their sub-account, where their leads route
}

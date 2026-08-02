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

/** Only the top tier gets its own AI agent — see the widget rule in AGENTS.md. */
export function hasListingAgent(tier: PlanTier): boolean {
  return tier === "premium";
}

/** Sort order for grids: highest plan first. Placement is what a plan buys. */
export function tierRank(tier: PlanTier): number {
  return tier === "premium" ? 0 : tier === "featured" ? 1 : 2;
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

  planTier: PlanTier;         // plan_tier  -> drives Featured styling + which chat widget
  claimStatus: ClaimStatus;   // claim_status

  // Per-listing AI agent (Featured only)
  aiContext?: string;         // ai_context — the knowledge blurb the business agent uses

  // Agency-client lead routing (see Layer 5 in the build doc)
  agencyClient: boolean;      // agency_client — true once they buy monthly agency services
  clientLocationId?: string;  // client_location_id — their sub-account, where their leads route
}

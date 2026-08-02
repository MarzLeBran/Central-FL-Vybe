// The single data contract for the whole app.
// Both the front end (Astro pages) and the data layer (GHL adapter) speak THIS shape.
// GHL contact custom fields map INTO this; nothing else in the app touches GHL's raw shape.

export type PlanTier = "free" | "featured";
export type ClaimStatus = "unclaimed" | "pending" | "claimed";

export interface Listing {
  id: string;                 // GHL contact id
  slug: string;               // URL key, e.g. "clean-lab-by-ez"  (custom field: listing_slug)
  businessName: string;       // business_name
  category: string;           // business_category
  description: string;        // business_description
  address: string;            // scraped_address
  phone: string;              // scraped_phone
  website?: string;
  rating?: number;            // google_rating
  reviewCount?: number;       // google_review_count
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

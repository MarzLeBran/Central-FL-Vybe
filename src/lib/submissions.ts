// ─────────────────────────────────────────────────────────────────────────────
// THE WRITE ADAPTER — the only file that knows how a claim or a new-business
// submission reaches GHL. Mirrors src/lib/directory.ts's DATA_SOURCE pattern:
// mock mode needs zero setup, GHL mode needs GHL_PIT_TOKEN + GHL_LOCATION_ID.
//
// API endpoints (src/pages/api/*.ts) call these two functions and never touch
// GHL or the filesystem directly.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { slugify, serializeSocialLinks, serializeExtraLinks, serializeJsonList } from "./directory";
import type { BlogPost, NewsItem, EventItem, TeamMember } from "../types/listing";

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";
const GHL_VERSION = "2021-07-28";

type Result = { ok: true } | { ok: false; error: string };

export interface ConsentMeta {
  tcpaConsent: boolean;
  consentVersion: string;
  ip?: string;
  userAgent?: string;
}

export interface ClaimInput extends ConsentMeta {
  listingId: string;
  ownerName: string;
  ownerRole?: string;
  email: string;
  phone: string;
}

export interface AddBusinessInput extends ConsentMeta {
  businessName: string;
  category: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  description?: string;
  ownerName?: string;
  socialLinks?: Record<string, string>;
  plan: "free" | "featured" | "premium";
}

type AddBusinessResult = { ok: true; contactId: string } | { ok: false; error: string };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * An owner claiming an EXISTING listing. Updates the contact in place — never
 * touches the `business` tag, since the listing is already live.
 */
export async function submitClaim(input: ClaimInput): Promise<Result> {
  const submittedAt = new Date().toISOString();

  if (DATA_SOURCE !== "ghl") {
    logDev("claim", { ...input, submittedAt });
    return { ok: true };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  if (!token) return { ok: false, error: "GHL_PIT_TOKEN is not set" };

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${input.listingId}`, {
    method: "PUT",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      email: input.email,
      phone: input.phone,
      customFields: [
        { key: "claim_status", fieldValue: "Pending" },
        ...consentFields(input, submittedAt),
      ],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL update failed: ${res.status}` };

  // Tags are additive via their own endpoint — a PUT with a `tags` array would
  // OVERWRITE the contact's existing tags, silently un-tagging `business` and
  // unpublishing the listing. opt_in_voice is the Layer 5 outbound-call gate:
  // only added when the box was actually checked.
  await addTags(
    input.listingId,
    input.tcpaConsent ? ["dir_claimed", "opt_in_voice"] : ["dir_claimed"],
    token
  );

  return { ok: true };
}

/**
 * A visitor submitting a business that isn't listed yet — any of the three
 * tiers. Creates a NEW contact with `claim_status: Pending` always (a human
 * still needs to follow up either way), but the `business` tag — the one
 * that actually makes it live — depends on the tier:
 *
 *   - free: tagged `business` immediately, right here. Live the moment this
 *     function returns.
 *   - featured/premium: created WITHOUT the tag. `/api/add-business` sends
 *     the visitor to Stripe next; the tag only gets added by
 *     `applyPlanUpgrade({ activate: true })` once the webhook confirms real
 *     payment, so nobody pays and then finds out it never went live, and
 *     nobody sees a paid listing that was never actually paid for.
 *
 * Returns the new contact id so the caller can hand it to Stripe as the
 * checkout session's listingId metadata for a paid signup.
 */
export async function submitAddBusiness(input: AddBusinessInput): Promise<AddBusinessResult> {
  const submittedAt = new Date().toISOString();

  if (DATA_SOURCE !== "ghl") {
    const contactId = `mock-${Date.now()}`;
    logDev("add-business", { ...input, contactId, submittedAt });
    return { ok: true, contactId };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  const locationId = requireEnv("GHL_LOCATION_ID");
  if (!token || !locationId) return { ok: false, error: "GHL env vars are not set" };

  const planLabel = input.plan === "premium" ? "Premium" : input.plan === "featured" ? "Featured" : "Free";

  // NOTE: verified against the documented Update Contact body shape (which the
  // GHL docs confirm accepts `key`-addressed customFields). The Create Contact
  // endpoint's full request schema wasn't available to check field-for-field —
  // this mirrors Update's shape on the assumption they match, which is typical
  // for this API, but confirm against a live sandbox call before your first
  // real submission.
  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      locationId,
      // THE FIRST-NAME TRAP: GHL requires a first name, and the directory
      // renders that field as the listing title (scripts/import-listings.mjs
      // has the full story). Always the business name, never an owner's name.
      firstName: input.businessName,
      email: input.email,
      phone: input.phone,
      website: input.website || undefined,
      tags: input.plan === "free" ? ["business"] : [],
      customFields: [
        { key: "business_name", fieldValue: input.businessName },
        { key: "business_category", fieldValue: input.category },
        { key: "business_description", fieldValue: input.description ?? "" },
        { key: "scraped_address", fieldValue: input.address },
        { key: "scraped_phone", fieldValue: input.phone },
        { key: "listing_slug", fieldValue: slugify(input.businessName) },
        { key: "plan_tier", fieldValue: planLabel },
        { key: "claim_status", fieldValue: "Pending" },
        { key: "social_links", fieldValue: serializeSocialLinks(input.socialLinks) },
        ...consentFields(input, submittedAt),
      ],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL create failed: ${res.status}` };

  // UNVERIFIED, flagged honestly (same caveat as the request body above): the
  // Create Contact response shape wasn't checked against a live call. GHL
  // typically wraps the created record as `{ contact: { id, ... } }` — falls
  // back to a bare `id` in case it doesn't. Confirm on your first real paid
  // signup; if this is wrong, the checkout session below gets created with a
  // garbage listingId and the webhook silently can't find the contact.
  const data = await res.json().catch(() => ({}));
  const contactId = data.contact?.id ?? data.id;
  if (!contactId) return { ok: false, error: "GHL create succeeded but returned no contact id" };

  return { ok: true, contactId };
}

export interface AgencyInterestInput extends ConsentMeta {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  services: string[]; // e.g. ["Custom website", "Review management"] — checkboxes on /grow
  message?: string;
}

/**
 * A "/grow" submission — interest in the agency retainer (custom website,
 * review management, social auto-posting, missed-call text-back, AI voice
 * agents), sold entirely separately from the directory plans and never on
 * `/pricing` — see the golden rule in AGENTS.md. Deliberately NOT tied to an
 * existing listing/claim; anyone can express interest, not just claimed
 * owners, even though the page is mainly linked from post-claim moments.
 * Creates a new contact tagged `agency_lead` for manual follow-up — no
 * automated next step, this is a sales conversation, not a checkout.
 */
export async function submitAgencyInterest(input: AgencyInterestInput): Promise<Result> {
  const submittedAt = new Date().toISOString();

  if (DATA_SOURCE !== "ghl") {
    logDev("agency-interest", { ...input, submittedAt });
    return { ok: true };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  const locationId = requireEnv("GHL_LOCATION_ID");
  if (!token || !locationId) return { ok: false, error: "GHL env vars are not set" };

  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      locationId,
      firstName: input.contactName,
      email: input.email,
      phone: input.phone,
      tags: ["agency_lead"],
      customFields: [
        { key: "agency_lead_business", fieldValue: input.businessName },
        { key: "agency_interest", fieldValue: input.services.join(", ") },
        { key: "agency_message", fieldValue: input.message ?? "" },
        ...consentFields(input, submittedAt),
      ],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL create failed: ${res.status}` };
  return { ok: true };
}

/**
 * A checkout succeeded — write the new plan tier back to GHL. Called from
 * `/api/checkout` in mock mode (there's no real payment to wait on) and from
 * the Stripe webhook in live mode (the redirect back to the browser is not
 * trustworthy proof of payment; the webhook is).
 *
 * Also flips a `plan_featured`/`plan_premium` tag, not just the `plan_tier`
 * custom field — the field alone is what the app actually reads, but a tag
 * gives GHL workflows a clean "Contact Tag Added" trigger to rebuild the site
 * on upgrade, the same narrow pattern the `business` tag sync already uses
 * (see "Keeping the live site in sync" in docs/ghl-layer-0.md), rather than a
 * broad "Contact Updated" trigger firing on every unrelated edit.
 *
 * `activate: true` additionally adds the `business` tag itself — used when
 * this is a brand-new paid signup from `/add-business` (see
 * `submitAddBusiness()`) rather than an upgrade of an already-live listing,
 * so the listing only actually appears on the site once payment is confirmed,
 * never before.
 */
export async function applyPlanUpgrade(input: {
  listingId: string;
  plan: "featured" | "premium";
  activate?: boolean;
}): Promise<Result> {
  if (DATA_SOURCE !== "ghl") {
    logDev("upgrade", input);
    return { ok: true };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  if (!token) return { ok: false, error: "GHL_PIT_TOKEN is not set" };

  const planLabel = input.plan === "premium" ? "Premium" : "Featured";
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${input.listingId}`, {
    method: "PUT",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      customFields: [{ key: "plan_tier", fieldValue: planLabel }],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL update failed: ${res.status}` };

  // Best-effort: the plan_tier write above is the source of truth the app
  // reads, so a tag hiccup here must never fail the upgrade itself. Removes
  // the sibling tier's tag too, so a featured -> premium upgrade doesn't
  // leave both tags on the contact.
  const tagsToAdd = input.plan === "premium" ? ["plan_premium"] : ["plan_featured"];
  if (input.activate) tagsToAdd.push("business");
  const tagToRemove = input.plan === "premium" ? "plan_featured" : "plan_premium";
  await Promise.allSettled([
    addTags(input.listingId, tagsToAdd, token),
    removeTags(input.listingId, [tagToRemove], token),
  ]);

  return { ok: true };
}

export interface ListingUpdateInput {
  listingId: string;
  description: string;
  imageUrls: string[]; // full ordered array — index 0 is the cover, see ListingCard.astro
  logoUrl?: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  youtubeUrl?: string;
  bookingUrl?: string;
  socialLinks?: Record<string, string>;
  extraLinks?: { label: string; url: string }[];
  specialOffer?: string;
  specialOfferImageUrl?: string;
  blogPosts?: BlogPost[];
  newsItems?: NewsItem[];
  events?: EventItem[];
  team?: TeamMember[];
}

/**
 * Owner (or admin, on an owner's behalf) self-serve edit of an existing,
 * already-live listing — src/pages/manage/*. Never touches tags, so the
 * tag-clobbering hazard the other two write functions guard against doesn't
 * apply here at all: there is nothing in this body but customFields.
 */
export async function submitListingUpdate(input: ListingUpdateInput): Promise<Result> {
  if (DATA_SOURCE !== "ghl") {
    logDev("listing-update", input);
    return { ok: true };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  if (!token) return { ok: false, error: "GHL_PIT_TOKEN is not set" };

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${input.listingId}`, {
    method: "PUT",
    headers: ghlHeaders(token),
    body: JSON.stringify({
      // Top-level, not custom fields — these are GHL's native contact fields,
      // same ones submitClaim() sets and directory.ts falls back to when the
      // scraped_* custom field is empty (see the "known data gap" note in
      // AGENTS.md). Changing email here changes what this owner logs in with
      // next time — ListingEditForm.astro warns about that in the UI.
      email: input.email,
      phone: input.phone,
      website: input.website || undefined,
      customFields: [
        { key: "business_description", fieldValue: input.description },
        { key: "image_urls", fieldValue: input.imageUrls.join(",") },
        { key: "logo_url", fieldValue: input.logoUrl ?? "" },
        { key: "scraped_address", fieldValue: input.address },
        { key: "scraped_phone", fieldValue: input.phone },
        { key: "website", fieldValue: input.website ?? "" },
        { key: "youtube_url", fieldValue: input.youtubeUrl ?? "" },
        { key: "booking_url", fieldValue: input.bookingUrl ?? "" },
        { key: "social_links", fieldValue: serializeSocialLinks(input.socialLinks) },
        { key: "extra_links", fieldValue: serializeExtraLinks(input.extraLinks) },
        { key: "special_offer", fieldValue: input.specialOffer ?? "" },
        { key: "special_offer_image", fieldValue: input.specialOfferImageUrl ?? "" },
        { key: "blog_posts", fieldValue: serializeJsonList(input.blogPosts) },
        { key: "news_items", fieldValue: serializeJsonList(input.newsItems) },
        { key: "events", fieldValue: serializeJsonList(input.events) },
        { key: "team", fieldValue: serializeJsonList(input.team) },
      ],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL update failed: ${res.status}` };
  return { ok: true };
}

// ── GHL helpers ──────────────────────────────────────────────────────────────

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
  };
}

// Exported for reuse by src/lib/consumer-submissions.ts — identical consent
// mechanism, no reason to drift into a second implementation.
export function consentFields(input: ConsentMeta, submittedAt: string) {
  return [
    { key: "tcpa_consent", fieldValue: input.tcpaConsent ? "true" : "false" },
    { key: "tcpa_consent_ts", fieldValue: submittedAt },
    { key: "tcpa_consent_ip", fieldValue: input.ip ?? "" },
    { key: "tcpa_consent_version", fieldValue: input.consentVersion },
  ];
}

async function addTags(contactId: string, tags: string[], token: string): Promise<void> {
  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Version: "v3", "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
}

// Same endpoint as addTags, DELETE instead of POST — used by applyPlanUpgrade
// to drop the sibling tier's tag on a featured -> premium upgrade.
async function removeTags(contactId: string, tags: string[], token: string): Promise<void> {
  await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, Version: "v3", "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
}

function requireEnv(key: string): string | undefined {
  return import.meta.env[key];
}

// ── Mock helpers ─────────────────────────────────────────────────────────────
// Dev-only convenience so you can see what a submission would have contained
// before GHL exists. Writes to out/ (gitignored, ephemeral) — never relied on
// as storage, and a write failure here must never break the user-facing flow.

const LOG_FILE = resolve(process.cwd(), "out", "dev-submissions.jsonl");

function logDev(kind: string, payload: unknown): void {
  console.log(`[mock ${kind}]`, payload);
  try {
    mkdirSync(resolve(process.cwd(), "out"), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ kind, ...(payload as object) }) + "\n");
  } catch {
    // best effort only
  }
}

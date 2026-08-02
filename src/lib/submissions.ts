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
import { slugify } from "./directory";

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";
const GHL_VERSION = "2021-07-28";

type Result = { ok: true } | { ok: false; error: string };

interface ConsentMeta {
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
}

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
 * A visitor submitting a business that isn't listed yet. Creates a NEW contact
 * WITHOUT the `business` tag — see "new_business_request" in docs/ghl-layer-0.md.
 * It stays invisible on the live directory until an admin reviews it in GHL and
 * adds `business` themselves. That review gate is the whole point of this
 * function not just tagging it live immediately.
 */
export async function submitAddBusiness(input: AddBusinessInput): Promise<Result> {
  const submittedAt = new Date().toISOString();

  if (DATA_SOURCE !== "ghl") {
    logDev("add-business", { ...input, submittedAt });
    return { ok: true };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  const locationId = requireEnv("GHL_LOCATION_ID");
  if (!token || !locationId) return { ok: false, error: "GHL env vars are not set" };

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
      tags: ["new_business_request"],
      customFields: [
        { key: "business_name", fieldValue: input.businessName },
        { key: "business_category", fieldValue: input.category },
        { key: "business_description", fieldValue: input.description ?? "" },
        { key: "scraped_address", fieldValue: input.address },
        { key: "scraped_phone", fieldValue: input.phone },
        { key: "listing_slug", fieldValue: slugify(input.businessName) },
        { key: "plan_tier", fieldValue: "Free" },
        { key: "claim_status", fieldValue: "Pending" },
        ...consentFields(input, submittedAt),
      ],
    }),
  });

  if (!res.ok) return { ok: false, error: `GHL create failed: ${res.status}` };
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

function consentFields(input: ConsentMeta, submittedAt: string) {
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

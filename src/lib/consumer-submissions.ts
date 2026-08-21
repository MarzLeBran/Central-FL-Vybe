// ─────────────────────────────────────────────────────────────────────────────
// THE CONSUMER WRITE ADAPTER — registration, avatar, and follow-list writes
// for ordinary site visitors. Kept separate from src/lib/submissions.ts,
// whose own charter comment specifically scopes it to "a claim or a
// new-business submission" — consumer accounts are neither. Mirrors that
// file's DATA_SOURCE mock/ghl branch and logDev() convention; reuses its
// exported consentFields() rather than reimplementing the same consent logic.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { consentFields, type ConsentMeta } from "./submissions";
import { getConsumerByEmail, getConsumerById, upsertMockConsumer, type Consumer } from "./consumers";

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";
const GHL_VERSION = "2021-07-28";

type Result = { ok: true } | { ok: false; error: string };

export interface RegisterConsumerInput extends ConsentMeta {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * Creates a new consumer contact tagged `consumer` (never `business`). If
 * the email already belongs to a consumer, this is really a "log in
 * instead" case — return the existing id rather than erroring or creating a
 * duplicate, same non-enumerating spirit as the rest of the auth flow.
 */
export async function registerConsumer(
  input: RegisterConsumerInput
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  // getConsumerByEmail is a "read" helper (throws on a GHL failure, same
  // family as getListingById/getConsumerById in directory.ts/consumers.ts) —
  // this function's own contract is "returns a Result, never throws" (its
  // one caller, api/account/register.ts, doesn't wrap it in try/catch), so a
  // transient GHL hiccup here must be caught, not left to propagate.
  let existing;
  try {
    existing = await getConsumerByEmail(input.email);
  } catch (err) {
    return { ok: false, error: `network error: ${(err as Error).message}` };
  }
  if (existing) return { ok: true, contactId: existing.id };

  const submittedAt = new Date().toISOString();

  if (DATA_SOURCE !== "ghl") {
    const id = `consumer_${crypto.randomUUID()}`;
    const consumer: Consumer = {
      id,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      followedSlugs: [],
    };
    upsertMockConsumer(consumer);
    logDev("consumer-register", { ...input, submittedAt, contactId: id });
    return { ok: true, contactId: id };
  }

  const token = requireEnv("GHL_PIT_TOKEN");
  const locationId = requireEnv("GHL_LOCATION_ID");
  if (!token || !locationId) return { ok: false, error: "GHL env vars are not set" };

  try {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: ghlHeaders(token),
      body: JSON.stringify({
        locationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        tags: ["consumer"],
        customFields: consentFields(input, submittedAt),
      }),
    });

    if (!res.ok) return { ok: false, error: `GHL create failed: ${res.status}` };
    const data = await res.json();
    const contactId = data.contact?.id ?? data.id;
    if (!contactId) return { ok: false, error: "GHL create response had no contact id" };
    return { ok: true, contactId };
  } catch (err) {
    return { ok: false, error: `network error: ${(err as Error).message}` };
  }
}

export async function setFollowedListings(contactId: string, slugs: string[]): Promise<Result> {
  if (DATA_SOURCE !== "ghl") {
    const consumer = await getConsumerById(contactId);
    if (consumer) upsertMockConsumer({ ...consumer, followedSlugs: slugs });
    logDev("consumer-follow", { contactId, slugs });
    return { ok: true };
  }
  return putCustomField(contactId, "followed_listings", slugs.join(","));
}

export async function setAvatarUrl(contactId: string, avatarUrl: string): Promise<Result> {
  if (DATA_SOURCE !== "ghl") {
    const consumer = await getConsumerById(contactId);
    if (consumer) upsertMockConsumer({ ...consumer, avatarUrl });
    logDev("consumer-avatar", { contactId, avatarUrl });
    return { ok: true };
  }
  return putCustomField(contactId, "avatar_url", avatarUrl);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function putCustomField(contactId: string, key: string, fieldValue: string): Promise<Result> {
  const token = requireEnv("GHL_PIT_TOKEN");
  if (!token) return { ok: false, error: "GHL_PIT_TOKEN is not set" };

  try {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      method: "PUT",
      headers: ghlHeaders(token),
      body: JSON.stringify({ customFields: [{ key, fieldValue }] }),
    });

    if (!res.ok) return { ok: false, error: `GHL update failed: ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `network error: ${(err as Error).message}` };
  }
}

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
  };
}

function requireEnv(key: string): string | undefined {
  return import.meta.env[key];
}

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

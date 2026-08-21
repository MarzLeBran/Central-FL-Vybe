// ─────────────────────────────────────────────────────────────────────────────
// THE AUTH ADAPTER — magic-link tokens + session cookies for the owner
// self-serve editing flow (src/pages/manage/*) and the internal admin editor
// (src/pages/manage/admin/*). No users table: per docs/consumer-accounts.md,
// the GHL contact stays the single source of truth and a session is just a
// signed cookie, never a database row (golden rule 1).
//
// Same hand-rolled HMAC approach as src/lib/checkout.ts's Stripe signature
// check — no JWT dependency needed for one HMAC comparison.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";

const DATA_SOURCE = import.meta.env.DATA_SOURCE ?? "mock";
const GHL_VERSION = "2021-07-28";

// Dev-only fallback so local/mock work needs zero setup, same convention as
// every other adapter here. MUST be overridden by a real AUTH_SECRET before
// DATA_SOURCE=ghl — a hardcoded secret in live mode would let anyone forge
// sessions and edit any listing.
const DEV_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

function secret(): string {
  return import.meta.env.AUTH_SECRET || DEV_SECRET;
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — broader access, shorter leash
const CONSUMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — nothing sensitive to protect, just a follow list + avatar

export type MagicLinkPurpose = "owner" | "consumer";

type Payload = Record<string, unknown>;

function sign(payload: Payload): string {
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

function verify(token: string): Payload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = base64url(createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// ── Magic-link login tokens (short-lived, reusable within their window) ──────
// No single-use tracking — that needs a table/KV keyed by token, the exact
// "no separate database" trap docs/consumer-accounts.md warns against. A
// short expiry bounds a stolen-link risk instead, same trust model most sites
// apply to password-reset links.

// `purpose` keeps an owner login link and a consumer login link from ever
// being swapped — both are `v: "login"`, signed with the same secret, so
// without this an owner-purpose link would otherwise verify fine against
// the consumer verify route and vice versa.
export function createMagicLinkToken(contactId: string, purpose: MagicLinkPurpose): string {
  return sign({ v: "login", cid: contactId, purpose, exp: Date.now() + MAGIC_LINK_TTL_MS });
}

export function verifyMagicLinkToken(
  token: string,
  purpose: MagicLinkPurpose
): { contactId: string } | null {
  const payload = verify(token);
  if (!payload || payload.v !== "login" || payload.purpose !== purpose || typeof payload.cid !== "string") {
    return null;
  }
  return { contactId: payload.cid };
}

// ── Session cookies ───────────────────────────────────────────────────────────
// One cookie name for both owner and admin sessions, discriminated by `v` so
// neither can be replayed as the other and a login token can never double as
// a session (or vice versa) even though both are signed with the same secret.

export const SESSION_COOKIE = "manage_session";

// Non-authoritative — never trust these for anything real. They only exist
// so static pages (the header, and any listing page's admin-edit link) can
// render the right state without a network round-trip. Every actual account/
// admin action still re-verifies the real httpOnly session cookie above.
export const CONSUMER_HINT_COOKIE = "consumer_hint";
export const ADMIN_HINT_COOKIE = "admin_hint";

export type Session =
  | { kind: "owner"; contactId: string }
  | { kind: "admin" }
  | { kind: "consumer"; contactId: string };

export function createOwnerSessionCookie(contactId: string): string {
  return sign({ v: "session-owner", cid: contactId, exp: Date.now() + OWNER_SESSION_TTL_MS });
}

export function createAdminSessionCookie(): string {
  return sign({ v: "session-admin", exp: Date.now() + ADMIN_SESSION_TTL_MS });
}

export function createConsumerSessionCookie(contactId: string): string {
  return sign({ v: "session-consumer", cid: contactId, exp: Date.now() + CONSUMER_SESSION_TTL_MS });
}

export function verifySession(value: string | undefined): Session | null {
  if (!value) return null;
  const payload = verify(value);
  if (!payload) return null;
  if (payload.v === "session-owner" && typeof payload.cid === "string") {
    return { kind: "owner", contactId: payload.cid };
  }
  if (payload.v === "session-admin") {
    return { kind: "admin" };
  }
  if (payload.v === "session-consumer" && typeof payload.cid === "string") {
    return { kind: "consumer", contactId: payload.cid };
  }
  return null;
}

/** Constant-time compare against ADMIN_PASSWORD — a single shared password
 *  for this internal tool, not a multi-admin system (golden rule 1: no users
 *  table). */
export function verifyAdminPassword(candidate: string): boolean {
  return timingSafeEqualString(candidate, import.meta.env.ADMIN_PASSWORD);
}

/** Same shared-secret check as verifyAdminPassword, generalized for anything
 *  else that gates on one constant (e.g. the reviews webhook's secret). */
export function timingSafeEqualString(candidate: string, configured: string | undefined): boolean {
  if (!configured) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Astro's default `security.checkOrigin` CSRF protection only inspects
 * form-like content types (x-www-form-urlencoded, multipart, text/plain) —
 * a JSON `fetch()` POST is NOT covered by it. Routes that accept JSON and
 * authenticate via cookie (rather than a bearer header) must call this
 * explicitly. Do not disable `security.checkOrigin` project-wide to "fix"
 * this — that would remove real protection from the form-based routes.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

// ── Sending the magic-link email ──────────────────────────────────────────────

/**
 * Mock mode: never sends anything — logs the link to console so local dev
 * needs zero email setup, same convention as submissions.ts's logDev().
 * GHL mode: sends via GHL's own Conversations API (POST /conversations/messages)
 * reusing GHL_PIT_TOKEN — no new email vendor. NOTE: the exact request body
 * shape below is unverified from within this environment (GHL's docs weren't
 * fully inspectable here) — smoke-test against a live sandbox contact before
 * this reaches a real owner. If it doesn't pan out, RESEND_API_KEY is a
 * documented fallback (see docs/consumer-accounts.md).
 */
export async function sendMagicLinkEmail(
  contactId: string,
  email: string,
  url: string,
  purpose: MagicLinkPurpose
): Promise<void> {
  if (DATA_SOURCE !== "ghl") {
    console.log(`[mock magic-link] (${purpose}) ${email} -> ${url}`);
    return;
  }

  const token = import.meta.env.GHL_PIT_TOKEN;
  if (!token) {
    console.error("sendMagicLinkEmail: GHL_PIT_TOKEN is not set, cannot send");
    return;
  }

  const copy =
    purpose === "owner"
      ? { subject: "Manage your Central FL Vybe listing", body: "Click below to manage your listing." }
      : { subject: "Sign in to Central FL Vybe", body: "Click below to sign in to your account." };

  // Declared Promise<void> — every caller either awaits it bare or wraps it
  // in its own try/catch expecting "fails quietly, never throws" (see the
  // comment on the catch in api/account/register.ts). A bad HTTP response is
  // already handled below without throwing; a raw fetch() rejection
  // (DNS/timeout/network drop) would not be, so it's caught here too.
  try {
    const res = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "Email",
        contactId,
        subject: copy.subject,
        html: `<p>${copy.body} This link expires in 15 minutes.</p><p><a href="${url}">${url}</a></p>`,
      }),
    });

    if (!res.ok) console.error(`sendMagicLinkEmail: GHL send failed: ${res.status}`);
  } catch (err) {
    console.error("sendMagicLinkEmail: network error:", err);
  }
}

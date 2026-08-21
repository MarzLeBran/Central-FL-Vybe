// ─────────────────────────────────────────────────────────────────────────────
// THE STRIPE ADAPTER — the only file that knows how an upgrade reaches Stripe.
// Mirrors directory.ts/submissions.ts's DATA_SOURCE pattern, but the switch is
// "is STRIPE_SECRET_KEY set" rather than an explicit env flag: with no key, a
// checkout "succeeds" immediately (via applyPlanUpgrade) and sends the visitor
// straight to the thanks page, so the whole upgrade flow is testable with zero
// Stripe setup. Set STRIPE_SECRET_KEY + the two price ids and it charges for real.
//
// Raw fetch against Stripe's HTTP API, no `stripe` npm package — same choice
// this repo already made for GHL, and it keeps webhook signature verification
// (a few lines of HMAC) from pulling in a dependency for one function.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanTier } from "../types/listing";
import { applyPlanUpgrade } from "./submissions";

const STRIPE_API = "https://api.stripe.com/v1";
type UpgradeTier = Exclude<PlanTier, "free">;
type Result = { ok: true; url: string } | { ok: false; error: string };

export interface CheckoutInput {
  listingId: string;
  plan: UpgradeTier;
  businessName: string;
  origin: string; // e.g. "https://centralflvybe.com" or "http://localhost:4322"
  // True for a brand-new paid signup from /add-business, where the contact
  // exists in GHL but isn't tagged `business` yet — payment is what makes it
  // go live (see submitAddBusiness()/applyPlanUpgrade() in submissions.ts).
  // False/omitted for the normal case: upgrading an already-live listing.
  activate?: boolean;
}

/**
 * Starts an upgrade (or a paid signup, if `activate` is set). Mock mode
 * applies it immediately (nothing to wait on); live mode creates a real
 * Stripe Checkout Session and returns its hosted URL. The caller redirects
 * the browser to whatever URL comes back.
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<Result> {
  const secretKey = requireEnv("STRIPE_SECRET_KEY");
  const thanksUrl = input.activate
    ? `${input.origin}/add-business/thanks?business=${encodeURIComponent(input.businessName)}&plan=${input.plan}`
    : `${input.origin}/upgrade/thanks?business=${encodeURIComponent(input.businessName)}&plan=${input.plan}`;

  if (!secretKey) {
    const result = await applyPlanUpgrade({ listingId: input.listingId, plan: input.plan, activate: input.activate });
    if (!result.ok) return result;
    return { ok: true, url: thanksUrl };
  }

  const priceId = requireEnv(
    input.plan === "premium" ? "STRIPE_PRICE_PREMIUM" : "STRIPE_PRICE_FEATURED"
  );
  if (!priceId) return { ok: false, error: `Stripe price id for "${input.plan}" is not set` };

  const cancelUrl = input.activate
    ? `${input.origin}/add-business?plan=${input.plan}&error=cancelled`
    : `${input.origin}/upgrade?t=${encodeURIComponent(input.listingId)}&plan=${input.plan}&error=cancelled`;

  try {
    // Annual plans billed as one-time charges, not subscriptions — GHL workflows
    // (Layer 3) own renewal reminders rather than Stripe auto-renewing a listing
    // nobody re-confirmed. Revisit if that assumption changes.
    const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: "payment",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        success_url: thanksUrl,
        cancel_url: cancelUrl,
        "metadata[listingId]": input.listingId,
        "metadata[plan]": input.plan,
        "metadata[activate]": input.activate ? "1" : "0",
        // Adds an "Add promotion code" link on Stripe's hosted checkout page.
        // The actual codes/discounts (e.g. a founders' rate) are created and
        // managed entirely in the Stripe dashboard, not here — see
        // docs/stripe-checkout.md.
        allow_promotion_codes: "true",
      }),
    });

    if (!res.ok) return { ok: false, error: `Stripe session create failed: ${res.status}` };
    const session = await res.json();
    if (!session.url) return { ok: false, error: "Stripe session has no url" };
    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, error: `network error: ${(err as Error).message}` };
  }
}

/**
 * Verifies Stripe's `Stripe-Signature` header against the raw request body.
 * Algorithm per Stripe's docs: HMAC-SHA256 of `${timestamp}.${payload}` using
 * the webhook signing secret, compared to the `v1` value in the header.
 * Must run against the RAW body string — parsing to JSON first and
 * re-stringifying will not reproduce the same bytes Stripe signed.
 */
export function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string])
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const computed = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireEnv(key: string): string | undefined {
  return import.meta.env[key];
}

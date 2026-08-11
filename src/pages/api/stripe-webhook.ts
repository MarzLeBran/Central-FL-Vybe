// POST /api/stripe-webhook — Stripe calls this when a checkout session
// completes. Live mode only: mock mode applies the upgrade synchronously in
// /api/checkout since there's no real payment to wait on, so this route is a
// no-op (200, does nothing) until STRIPE_WEBHOOK_SECRET is set.
//
// This is the AUTHORITATIVE write for a live upgrade — not /upgrade/thanks or
// the browser redirect off /api/checkout, either of which a visitor can hit
// (or bail out before) without ever paying. Only a signed event proves Stripe
// actually collected the money.
//
// No CSRF concern here: Astro's checkOrigin only inspects form-like content
// types (x-www-form-urlencoded, multipart, text/plain); Stripe sends JSON, so
// it passes through untouched. The signature check below is what actually
// authenticates the caller.

export const prerender = false;

import type { APIRoute } from "astro";
import { applyPlanUpgrade } from "../../lib/submissions";
import { verifyStripeSignature } from "../../lib/checkout";

export const POST: APIRoute = async ({ request }) => {
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;
  const payload = await request.text();

  if (!webhookSecret) {
    // Not configured yet — nothing to verify against, nothing to do.
    return new Response(null, { status: 200 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, signature, webhookSecret)) {
    return new Response("invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const listingId = session.metadata?.listingId;
    const plan = session.metadata?.plan;
    const activate = session.metadata?.activate === "1";
    if (listingId && (plan === "featured" || plan === "premium")) {
      await applyPlanUpgrade({ listingId, plan, activate });
    }
  }

  return new Response(null, { status: 200 });
};

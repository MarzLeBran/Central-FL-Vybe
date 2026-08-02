# Stripe checkout — Layer 4

Sells the two paid directory plans (Spotlight $250/yr, All Access $699/yr).
**Never the GHL agency retainer** — that stays a post-claim conversation, off
`/pricing` and off this checkout, per the golden rule in `AGENTS.md`.

## The flow

1. A claimed listing's own page (`business/[slug].astro`) shows an "Upgrade to
   {next plan}" nudge once it's claimed and not already on the top plan.
2. That links to `/upgrade?t={listingId}&plan=featured|premium` — server-rendered
   on demand (needs a live look-up, same reason `/claim` is), shows the plan
   and price, and POSTs to `/api/checkout`.
3. `/api/checkout` calls `createCheckoutSession()` in
   [`src/lib/checkout.ts`](../src/lib/checkout.ts) and redirects the browser to
   whatever URL it returns.
4. The plan tier gets written back to GHL via `applyPlanUpgrade()` in
   [`src/lib/submissions.ts`](../src/lib/submissions.ts) — same `plan_tier`
   custom field Layer 0 already defines.

`/pricing`'s Spotlight/All Access buttons still point at `/listings`
("Find your listing"), not at `/upgrade` directly — there's no listing in
scope on that page, and upgrading presupposes an already-claimed one.

## Mock mode (today, no Stripe account needed)

With no `STRIPE_SECRET_KEY` set, `createCheckoutSession()` skips Stripe
entirely: it calls `applyPlanUpgrade()` immediately (mock mode logs it to
`out/dev-submissions.jsonl`, same as a claim) and sends the browser straight to
`/upgrade/thanks`. The whole flow — nudge → confirm → "payment" → thanks page
— is testable today with zero Stripe setup.

## Live mode

Set in `.env`:

```
STRIPE_SECRET_KEY=sk_...
STRIPE_PRICE_FEATURED=price_...   # $250/yr Spotlight price id
STRIPE_PRICE_PREMIUM=price_...    # $699/yr All Access price id
STRIPE_WEBHOOK_SECRET=whsec_...
```

Create the two prices in the Stripe dashboard (Products → Add product) and
copy their price ids in. Point a webhook endpoint at
`https://<your-domain>/api/stripe-webhook`, subscribed to
`checkout.session.completed`, and copy its signing secret into
`STRIPE_WEBHOOK_SECRET`.

**One-time charge, not a subscription.** Checkout sessions are created with
`mode: "payment"`, not `mode: "subscription"` — an annual plan billed once,
not auto-renewed. Renewal reminders are a GHL workflow (Layer 3) concern, not
Stripe's, on the theory that nobody should get silently re-charged for a
listing they haven't re-confirmed. Revisit this if that assumption changes.

**The webhook is the source of truth, not the redirect.** `/upgrade/thanks` and
the redirect off `/api/checkout` are both things a visitor can hit (or bail
out before) without ever paying — Stripe's browser redirect proves nothing.
`applyPlanUpgrade()` only runs for real in live mode from
`/api/stripe-webhook`, once Stripe has verified the payment and signed the
event. `/api/checkout` itself never upgrades anything in live mode; it only
starts the session.

No dependency on the `stripe` npm package — both the session-create call and
the webhook signature check (`verifyStripeSignature()` in `checkout.ts`, a few
lines of HMAC-SHA256 over Node's `crypto`) are plain `fetch`/`crypto`, the same
choice this repo already made for GHL.

## CSRF note

Astro's default CSRF protection (`security.checkOrigin`) only inspects
form-like `Content-Type`s (`application/x-www-form-urlencoded`,
`multipart/form-data`, `text/plain`). Stripe's webhook sends
`application/json`, so it passes through untouched — no special-casing
needed. The signature check in `verifyStripeSignature()` is what actually
authenticates the caller.

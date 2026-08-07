// POST /api/webhooks/reviews?secret=... — called by a GHL workflow whenever
// a business contact's plan_tier (or tags) change, so a newly-paid listing
// gets its Google rating backfilled automatically instead of waiting for the
// next manual `npm run reviews` run. See docs/ghl-layer-0.md for the GHL
// workflow setup this expects.
//
// Cost guardrail (docs/google-apis.md — Place Details bills $40/1000 requests
// the moment `rating` is requested): this only ever calls Google once per
// listing, period. If the contact already has a google_rating value, this is
// a no-op — regardless of how many times the workflow fires for that same
// contact afterward (any other field edit re-fires "Contact Updated" too).
// Ongoing periodic refreshes of already-fetched ratings are still
// scripts/import-reviews.mjs's job, run on a schedule — this route only ever
// does the one-time backfill the moment a listing first becomes paid.
//
// Never trusts the webhook POST body for the actual decision — GHL's webhook
// payload shape is configurable per-workflow and not something to build
// security or billing logic on. The body is used only to find WHICH contact
// to look up; the contact is then re-fetched fresh from GHL's own API.

export const prerender = false;

import type { APIRoute } from "astro";
import { timingSafeEqualString } from "../../../lib/auth";
import { getContactReviewInfo, writeReviewFields, fetchPlaceDetails } from "../../../lib/reviews";

export const POST: APIRoute = async ({ request, url }) => {
  if (!timingSafeEqualString(url.searchParams.get("secret") ?? "", import.meta.env.REVIEWS_WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }

  const body = await request.json().catch(() => ({}) as any);
  // GHL webhook payloads vary by workflow config — try the common shapes
  // rather than assuming one. Unverified against a live payload; smoke-test
  // and adjust if none of these match what your workflow actually sends.
  const contactId: string | undefined =
    body.contact_id ?? body.contactId ?? body.contact?.id ?? body.id;

  if (!contactId) {
    return new Response(JSON.stringify({ ok: false, error: "no contact id in payload" }), { status: 400 });
  }

  try {
    const info = await getContactReviewInfo(contactId);
    if (!info) {
      return new Response(JSON.stringify({ ok: true, skipped: "contact not found" }), { status: 200 });
    }
    if (!info.isPaidBusiness) {
      return new Response(JSON.stringify({ ok: true, skipped: "not a paid listing" }), { status: 200 });
    }
    if (!info.placeId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no google_place_id set" }), { status: 200 });
    }
    if (info.hasExistingRating) {
      return new Response(JSON.stringify({ ok: true, skipped: "already has a rating" }), { status: 200 });
    }

    const details = await fetchPlaceDetails(info.placeId);
    if (!details) {
      return new Response(JSON.stringify({ ok: true, skipped: "no place details returned" }), { status: 200 });
    }

    await writeReviewFields(contactId, details);
    console.log(`[reviews webhook] ${info.businessName}: ${details.rating}★ (${details.reviewCount})`);
    return new Response(JSON.stringify({ ok: true, ...details }), { status: 200 });
  } catch (err) {
    console.error("[reviews webhook] failed:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500 });
  }
};

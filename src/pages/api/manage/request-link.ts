// POST /api/manage/request-link — looks up a listing by email, gates on
// claimed + paid tier, and sends a magic-link sign-in email if eligible.
//
// Always redirects to the same "check your email" page regardless of whether
// the email matched anything or was eligible — no account enumeration, same
// spirit as the claim form's honeypot ("don't teach a bot/attacker what gave
// it away").

export const prerender = false;

import type { APIRoute } from "astro";
import { getListingByEmail } from "../../../lib/directory";
import { createMagicLinkToken, sendMagicLinkEmail } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const data = await request.formData();

  if (String(data.get("hp") ?? "")) return redirect("/manage/login?sent=1");

  const email = String(data.get("email") ?? "").trim();
  if (!email) return redirect("/manage/login?sent=1");

  const listing = await getListingByEmail(email);
  const eligible = listing && listing.claimStatus === "claimed" && listing.planTier !== "free";

  if (eligible) {
    const token = createMagicLinkToken(listing.id, "owner");
    const verifyUrl = `${url.origin}/api/manage/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail(listing.id, email, verifyUrl, "owner");
  }

  return redirect("/manage/login?sent=1");
};

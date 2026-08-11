// GET /api/manage/verify — the link clicked from the magic-link email. Verifies
// the token, re-checks the claim/tier gate (state may have changed between
// requesting and clicking), sets the session cookie, lands on /manage.

export const prerender = false;

import type { APIRoute } from "astro";
import { getListingById } from "../../../lib/directory";
import { verifyMagicLinkToken, createOwnerSessionCookie, SESSION_COOKIE } from "../../../lib/auth";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const token = url.searchParams.get("token") ?? "";
  const verified = verifyMagicLinkToken(token, "owner");
  if (!verified) return redirect("/manage/login?error=expired");

  const listing = await getListingById(verified.contactId);
  // See the matching comment in request-link.ts — "pending" is eligible too.
  const eligible = listing && listing.claimStatus !== "unclaimed" && listing.planTier !== "free";
  if (!eligible) return redirect("/manage/login?error=ineligible");

  cookies.set(SESSION_COOKIE, createOwnerSessionCookie(verified.contactId), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
    path: "/",
  });

  return redirect("/manage");
};

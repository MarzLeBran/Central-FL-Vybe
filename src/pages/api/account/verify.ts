// GET /api/account/verify — the link clicked from the consumer magic-link
// email. Verifies the purpose:"consumer" token, sets the session cookie plus
// the non-authoritative consumer_hint cookie (see src/lib/auth.ts), lands on
// /account.

export const prerender = false;

import type { APIRoute } from "astro";
import { getConsumerById } from "../../../lib/consumers";
import {
  verifyMagicLinkToken,
  createConsumerSessionCookie,
  SESSION_COOKIE,
  CONSUMER_HINT_COOKIE,
} from "../../../lib/auth";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const token = url.searchParams.get("token") ?? "";
  const verified = verifyMagicLinkToken(token, "consumer");
  if (!verified) return redirect("/account/login?error=expired");

  const consumer = await getConsumerById(verified.contactId);
  if (!consumer) return redirect("/account/login?error=expired");

  const cookieOpts = { secure: import.meta.env.PROD, sameSite: "lax" as const, path: "/" };
  cookies.set(SESSION_COOKIE, createConsumerSessionCookie(consumer.id), { ...cookieOpts, httpOnly: true });
  // Non-httpOnly on purpose — read by the pre-paint header script and the
  // follow-button script client-side. Never trusted for real authorization;
  // every actual account route re-verifies the httpOnly cookie above.
  cookies.set(CONSUMER_HINT_COOKIE, "1", { ...cookieOpts, httpOnly: false });

  return redirect("/account");
};

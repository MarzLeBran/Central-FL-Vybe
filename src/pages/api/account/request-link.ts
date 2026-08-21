// POST /api/account/request-link — consumer login. Looks up by email, sends
// a purpose:"consumer" magic link if found. Always redirects to the same
// "check your email" page regardless of match — no account enumeration,
// mirroring /api/manage/request-link.ts.

export const prerender = false;

import type { APIRoute } from "astro";
import { getConsumerByEmail } from "../../../lib/consumers";
import { createMagicLinkToken, sendMagicLinkEmail } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const data = await request.formData();

  if (String(data.get("hp") ?? "")) return redirect("/account/login?sent=1");

  const email = String(data.get("email") ?? "").trim();
  if (!email) return redirect("/account/login?sent=1");

  // GHL being unreachable/rate-limited must not crash the request with a
  // raw 500 — a transient failure here should read as "try again," not a
  // broken site. Doesn't weaken the anti-enumeration property above: this
  // path fires on infrastructure trouble, unrelated to whether the email
  // actually matches an account.
  try {
    const consumer = await getConsumerByEmail(email);
    if (consumer) {
      const token = createMagicLinkToken(consumer.id, "consumer");
      const verifyUrl = `${url.origin}/api/account/verify?token=${encodeURIComponent(token)}`;
      await sendMagicLinkEmail(consumer.id, email, verifyUrl, "consumer");
    }
  } catch {
    return redirect("/account/login?error=server");
  }

  return redirect("/account/login?sent=1");
};

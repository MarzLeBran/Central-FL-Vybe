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

  const consumer = await getConsumerByEmail(email);
  if (consumer) {
    const token = createMagicLinkToken(consumer.id, "consumer");
    const verifyUrl = `${url.origin}/api/account/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail(consumer.id, email, verifyUrl, "consumer");
  }

  return redirect("/account/login?sent=1");
};

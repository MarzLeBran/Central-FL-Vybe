// POST /api/account/register — creates (or, if the email already exists,
// reuses) a consumer contact, then immediately sends a magic link so
// registration doubles as first sign-in — same "check your email" redirect
// as login, no separate confirmation step.

export const prerender = false;

import type { APIRoute } from "astro";
import { registerConsumer } from "../../../lib/consumer-submissions";
import { createMagicLinkToken, sendMagicLinkEmail } from "../../../lib/auth";
import { TCPA_CONSENT_VERSION } from "../../../lib/consent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, clientAddress, redirect }) => {
  const data = await request.formData();

  if (String(data.get("hp") ?? "")) return redirect("/account/login?sent=1");

  const firstName = String(data.get("firstName") ?? "").trim();
  const lastName = String(data.get("lastName") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const phone = String(data.get("phone") ?? "").trim();
  const tcpaConsent = data.get("tcpaConsent") === "on";

  if (!firstName || !lastName || !email || !phone) return redirect("/account/register?error=missing");
  if (!EMAIL_RE.test(email)) return redirect("/account/register?error=email");

  const result = await registerConsumer({
    firstName,
    lastName,
    email,
    phone,
    tcpaConsent,
    consentVersion: TCPA_CONSENT_VERSION,
    ip: clientAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) return redirect("/account/register?error=server");

  const token = createMagicLinkToken(result.contactId, "consumer");
  const url = new URL(request.url);
  const verifyUrl = `${url.origin}/api/account/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(result.contactId, email, verifyUrl, "consumer");

  return redirect("/account/login?sent=1");
};

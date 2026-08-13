// POST /api/grow — interest in the agency retainer (custom website, review
// management, social auto-posting, missed-call text-back, AI voice agents).
// Sold entirely separately from the directory plans — never wired to Stripe,
// never a checkout. Writes through submitAgencyInterest() in submissions.ts,
// a new `agency_lead`-tagged contact for manual follow-up.
//
// On-demand for the same reason as /api/add-business: this writes, so it
// can't be prerendered. The /grow FORM page stays static.

export const prerender = false;

import type { APIRoute } from "astro";
import { submitAgencyInterest } from "../../lib/submissions";
import { TCPA_CONSENT_VERSION } from "../../lib/consent";
import { AGENCY_SERVICES } from "../../lib/agency";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, clientAddress, redirect }) => {
  const data = await request.formData();

  // Honeypot — same pattern/reasoning as /api/claim and /api/add-business.
  if (String(data.get("hp") ?? "")) return redirect("/grow/thanks");

  const businessName = String(data.get("businessName") ?? "").trim();
  const contactName = String(data.get("contactName") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const phone = String(data.get("phone") ?? "").trim();
  const message = String(data.get("message") ?? "").trim();
  const tcpaConsent = data.get("tcpaConsent") === "on";
  const services = AGENCY_SERVICES.filter((s) => data.get(`service_${s.key}`) === "on").map((s) => s.label);

  if (!businessName || !contactName || !email || !phone) {
    return redirect("/grow?error=missing");
  }
  if (!EMAIL_RE.test(email)) return redirect("/grow?error=email");

  const result = await submitAgencyInterest({
    businessName,
    contactName,
    email,
    phone,
    services,
    message: message || undefined,
    tcpaConsent,
    consentVersion: TCPA_CONSENT_VERSION,
    ip: clientAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) return redirect("/grow?error=server");
  return redirect("/grow/thanks");
};

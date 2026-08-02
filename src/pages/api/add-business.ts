// POST /api/add-business — creates a new_business_request contact in GHL.
// Not tagged `business`, so it never appears on the live directory until an
// admin reviews it and tags it themselves — see docs/ghl-layer-0.md.
//
// On-demand for the same reason as /api/claim: this writes, so it can't be
// prerendered. The /add-business FORM page stays static; only this endpoint
// and /claim (which needs a live per-token listing lookup) run per-request.

export const prerender = false;

import type { APIRoute } from "astro";
import { submitAddBusiness } from "../../lib/submissions";
import { TCPA_CONSENT_VERSION } from "../../lib/consent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, clientAddress, redirect }) => {
  const data = await request.formData();

  // Honeypot — see /api/claim for why this redirects as a success either way.
  if (String(data.get("hp") ?? "")) return redirect("/add-business/thanks");

  const businessName = String(data.get("businessName") ?? "").trim();
  const category = String(data.get("category") ?? "").trim();
  const address = String(data.get("address") ?? "").trim();
  const phone = String(data.get("phone") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const website = String(data.get("website") ?? "").trim();
  const description = String(data.get("description") ?? "").trim();
  const ownerName = String(data.get("ownerName") ?? "").trim();
  const tcpaConsent = data.get("tcpaConsent") === "on";

  if (!businessName || !category || !address || !phone || !email) {
    return redirect("/add-business?error=missing");
  }
  if (!EMAIL_RE.test(email)) return redirect("/add-business?error=email");

  const result = await submitAddBusiness({
    businessName,
    category,
    address,
    phone,
    email,
    website: website || undefined,
    description: description || undefined,
    ownerName: ownerName || undefined,
    tcpaConsent,
    consentVersion: TCPA_CONSENT_VERSION,
    ip: clientAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) return redirect("/add-business?error=server");
  return redirect(`/add-business/thanks?business=${encodeURIComponent(businessName)}`);
};

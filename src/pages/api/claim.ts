// POST /api/claim — the only route that writes a claim to GHL.
//
// On-demand (not prerendered): this is the one part of the funnel that must
// run per-request, since it validates and writes. Everything else on the site
// stays static.
//
// Anti-spam: a honeypot field only, no reCAPTCHA yet — wiring that in needs a
// Google site/secret key pair this project doesn't have. See the hidden `hp`
// field on the claim form.

export const prerender = false;

import type { APIRoute } from "astro";
import { getListingById } from "../../lib/directory";
import { submitClaim } from "../../lib/submissions";
import { TCPA_CONSENT_VERSION } from "../../lib/consent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, clientAddress, redirect }) => {
  const data = await request.formData();

  const listingId = String(data.get("listingId") ?? "").trim();
  const back = `/claim?t=${encodeURIComponent(listingId)}`;

  // Honeypot: real visitors never fill this in, since it's off-screen. Send a
  // bot that trips it to the exact same success page a real submission gets —
  // nothing in the response should teach it what gave it away.
  if (String(data.get("hp") ?? "")) return redirect("/claim/thanks");

  const ownerName = String(data.get("ownerName") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const phone = String(data.get("phone") ?? "").trim();
  const tcpaConsent = data.get("tcpaConsent") === "on";

  if (!listingId) return redirect("/listings?error=missing-listing");
  if (!ownerName || !email || !phone) return redirect(`${back}&error=missing`);
  if (!EMAIL_RE.test(email)) return redirect(`${back}&error=email`);

  let listing;
  try {
    listing = await getListingById(listingId);
  } catch {
    return redirect(`${back}&error=server`);
  }
  if (!listing) return redirect(`${back}&error=notfound`);
  if (listing.claimStatus === "claimed") return redirect(`${back}&error=already`);

  const result = await submitClaim({
    listingId,
    ownerName,
    email,
    phone,
    tcpaConsent,
    consentVersion: TCPA_CONSENT_VERSION,
    ip: clientAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) return redirect(`${back}&error=server`);
  return redirect(`/claim/thanks?business=${encodeURIComponent(listing.businessName)}`);
};

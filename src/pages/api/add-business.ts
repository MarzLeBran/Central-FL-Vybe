// POST /api/add-business — creates a contact in GHL for any of the three
// tiers. Free goes live immediately (submitAddBusiness tags it `business`
// itself). Featured/premium get created untagged and this route sends the
// visitor to Stripe next — the listing only actually goes live once the
// webhook confirms real payment (createCheckoutSession's `activate` flag),
// same "webhook is the source of truth" rule as the existing upgrade flow.
// Either way `claim_status` comes back Pending — a human still follows up.
//
// On-demand for the same reason as /api/claim: this writes, so it can't be
// prerendered. The /add-business FORM page stays static; only this endpoint
// and /claim (which needs a live per-token listing lookup) run per-request.

export const prerender = false;

import type { APIRoute } from "astro";
import { submitAddBusiness } from "../../lib/submissions";
import { createCheckoutSession } from "../../lib/checkout";
import { TCPA_CONSENT_VERSION } from "../../lib/consent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPlanTier = (v: string): v is "free" | "featured" | "premium" =>
  v === "free" || v === "featured" || v === "premium";

export const POST: APIRoute = async ({ request, clientAddress, redirect, url }) => {
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
  const planRaw = String(data.get("plan") ?? "free").trim();
  const plan = isPlanTier(planRaw) ? planRaw : "free";

  const socialLinks: Record<string, string> = {};
  for (const network of ["facebook", "instagram", "x", "linkedin", "tiktok", "youtube"]) {
    const url = String(data.get(`social_${network}`) ?? "").trim();
    if (url) socialLinks[network] = url;
  }

  if (!businessName || !category || !address || !phone || !email) {
    return redirect("/add-business?error=missing");
  }
  if (!EMAIL_RE.test(email)) return redirect("/add-business?error=email");
  for (const url of Object.values(socialLinks)) {
    if (!url.startsWith("https://")) return redirect("/add-business?error=social");
  }

  const result = await submitAddBusiness({
    businessName,
    category,
    address,
    phone,
    email,
    website: website || undefined,
    description: description || undefined,
    ownerName: ownerName || undefined,
    socialLinks: Object.keys(socialLinks).length ? socialLinks : undefined,
    tcpaConsent,
    consentVersion: TCPA_CONSENT_VERSION,
    ip: clientAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
    plan,
  });

  if (!result.ok) return redirect("/add-business?error=server");

  if (plan === "free") {
    return redirect(`/add-business/thanks?business=${encodeURIComponent(businessName)}`);
  }

  // Paid tier: not live yet (submitAddBusiness created it untagged) — send
  // the visitor to Stripe. It only actually goes live once the webhook
  // confirms payment; bailing out of Stripe here just leaves an untagged,
  // invisible contact you can still follow up with manually.
  const checkout = await createCheckoutSession({
    listingId: result.contactId,
    plan,
    businessName,
    origin: url.origin,
    activate: true,
  });

  if (!checkout.ok) return redirect(`/add-business?plan=${plan}&error=server`);
  return redirect(checkout.url);
};

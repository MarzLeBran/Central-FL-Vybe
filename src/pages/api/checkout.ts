// POST /api/checkout — starts (or, in mock mode, completes) an upgrade.
//
// On-demand for the same reason as /api/claim: it writes/reaches out to
// Stripe, so it can't be prerendered. /upgrade stays the confirm screen;
// this is the endpoint that form posts to.

export const prerender = false;

import type { APIRoute } from "astro";
import { getListingById } from "../../lib/directory";
import { createCheckoutSession } from "../../lib/checkout";
import { tierRank } from "../../types/listing";
import type { PlanTier } from "../../types/listing";

const isUpgradeTier = (v: string): v is "featured" | "premium" => v === "featured" || v === "premium";

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const data = await request.formData();

  const listingId = String(data.get("listingId") ?? "").trim();
  const plan = String(data.get("plan") ?? "").trim();
  const back = `/upgrade?t=${encodeURIComponent(listingId)}&plan=${encodeURIComponent(plan)}`;

  if (!listingId || !isUpgradeTier(plan)) return redirect("/listings");

  let listing;
  try {
    listing = await getListingById(listingId);
  } catch {
    return redirect(`${back}&error=server`);
  }
  if (!listing) return redirect("/listings");
  if (listing.claimStatus !== "claimed") return redirect(`/claim?t=${listing.id}`);
  if (tierRank(listing.planTier) <= tierRank(plan as PlanTier)) {
    return redirect(`/business/${listing.slug}`);
  }

  const result = await createCheckoutSession({
    listingId,
    plan,
    businessName: listing.businessName,
    origin: url.origin,
  });

  if (!result.ok) return redirect(`${back}&error=server`);
  return redirect(result.url);
};

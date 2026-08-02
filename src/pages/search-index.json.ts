// Static search index, built at build time and fetched by the search box on
// first focus. Kept separate from the page payload deliberately: at 3,000
// listings this file is a few hundred KB, and nobody should pay for that on a
// page load where they never touch the search field.
//
// Fields are the minimum needed to match and to render a result row.

import type { APIRoute } from "astro";
import { isPaidTier } from "../types/listing";
import { getListings } from "../lib/directory";

export const GET: APIRoute = async () => {
  const listings = await getListings();

  const index = listings.map((l) => ({
    s: l.slug,
    n: l.businessName,
    c: l.category,
    a: l.address,
    // County is searchable too, so "seminole plumber" finds the right rows even
    // when the address only names a city.
    y: l.county ?? "",
    f: isPaidTier(l.planTier) ? 1 : 0,
  }));

  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json" },
  });
};

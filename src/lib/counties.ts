// Counties — the second browse axis, alongside category.
//
// One directory covers Orange, Osceola, Seminole and Brevard (the Space Coast)
// rather than splitting into separate market deploys. Everything here derives
// from `site.counties`, so adding a fifth county is a config edit.
//
// A listing's `county` is assigned at import time from its address. Listings we
// cannot place keep `county` undefined — they still appear in search, in All
// Listings and on category pages, just not under a county. Silence beats a
// wrong county on a business page.

import { site } from "../config/site";
import type { Listing } from "../types/listing";
import { getListings } from "./directory";

export const COUNTIES = site.counties.map((c) => c.name);

/** "Orange" -> "orange". Slugs carry no listing counts, so URLs stay stable. */
export function countySlug(county: string): string {
  return county.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function countyBySlug(slug: string): (typeof site.counties)[number] | undefined {
  return site.counties.find((c) => countySlug(c.name) === slug);
}

/**
 * Best-effort county for a free-text address.
 *
 * Matches configured city names, and also the county's own name — scraped rows
 * often read "Serving Osceola County, FL" with no city at all. Longest needle
 * first, so "West Melbourne" beats "Melbourne" and "Cocoa Beach" beats "Cocoa".
 */
export function countyForAddress(address: string): string | undefined {
  const haystack = address.toLowerCase();
  const candidates = site.counties.flatMap((c) => [
    { needle: `${c.name.toLowerCase()} county`, county: c.name },
    ...c.cities.map((city) => ({ needle: city.toLowerCase(), county: c.name })),
  ]);
  candidates.sort((a, b) => b.needle.length - a.needle.length);
  return candidates.find(({ needle }) => haystack.includes(needle))?.county;
}

/** Listings grouped by county. Counties with nothing in them are omitted. */
export async function getListingsByCounty(): Promise<Record<string, Listing[]>> {
  const grouped: Record<string, Listing[]> = {};
  for (const l of await getListings()) {
    if (l.county) (grouped[l.county] ??= []).push(l);
  }
  return grouped;
}

/** Everything in one county, in the configured county order. */
export async function getListingsIn(county: string): Promise<Listing[]> {
  return (await getListings()).filter((l) => l.county === county);
}

/** County -> category -> listings. Powers the /county/[county]/[category] pages. */
export async function getCountyCategoryIndex(): Promise<
  Record<string, Record<string, Listing[]>>
> {
  const index: Record<string, Record<string, Listing[]>> = {};
  for (const l of await getListings()) {
    if (!l.county) continue;
    ((index[l.county] ??= {})[l.category] ??= []).push(l);
  }
  return index;
}

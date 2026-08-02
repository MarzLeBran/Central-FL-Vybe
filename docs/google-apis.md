# Google APIs — what's free, what bills

Two Google products touch this directory and they sit at opposite ends of the
pricing model. Getting them the wrong way round is how a directory quietly runs
up a four-figure monthly bill.

## Maps — free, use it everywhere

The listing map in [`src/pages/business/[slug].astro`](../src/pages/business/[slug].astro) is a
**keyless iframe**:

```
https://maps.google.com/maps?q={business}, {address}&output=embed
```

No API key, no Google Cloud project, no billing account. If you later move to the
official **Maps Embed API**, that is also **free with unlimited requests** — no
daily cap, no volume limit. It is explicitly exempt from the per-SKU free
allowances Google introduced in March 2025 (10,000/month Essentials, 5,000 Pro,
1,000 Enterprise).

**Therefore the map is not a paid feature.** Every tier gets one, including the
free Day Pass. The reference directory gates it behind its mid tier; that is
packaging, not economics, and copying it would withhold something that costs
nothing to give away. Do not add a "Google map on listing" row to
`site.planFeatures`.

Note the exception: a **dynamic** map — the Maps JavaScript API, e.g. a homepage
map with a pin per business — *is* billed under Essentials, free for the first
10,000 loads a month. That is a different product from the embed.

## Google Reviews — $40 per 1,000 requests

Places API **Place Details** billing is decided by the most expensive field you
ask for. Requesting `reviews` or `rating` pulls the whole call into the
**Enterprise + Atmosphere** SKU at **$40.00 per 1,000 requests** — even if the
rest of the fields are cheap.

What that means at directory scale:

| refresh scope | cost per refresh |
|---|---|
| all 3,000 listings | **$120** |
| paid listings only (~50) | **~$2** |

## The rule for Layer 4

When Google reviews get wired up:

1. **Fetch only for paid listings.** Guard every Place Details call with
   `isPaidTier(listing.planTier)` from [`src/types/listing.ts`](../src/types/listing.ts).
   This is what keeps the cost at ~$2 instead of $120, and it is why "Google
   reviews" is a Spotlight/All Access row on `/pricing`.
2. **Cache; never refetch per build.** A static build touches every listing every
   time. Persist review data with a timestamp and refresh on a schedule, not on
   deploy. Google's terms also restrict how long Places content may be cached —
   check the current terms before choosing an interval.
3. **Store what you fetch in GHL**, not a new store — `google_rating` and
   `google_review_count` already exist as custom fields (see
   [ghl-layer-0.md](ghl-layer-0.md)), so golden rule 1 still holds.

## Keys

None are needed today. When they are, they go in `.env` (already gitignored) and
must stay server-side — a Places key in client JavaScript is a key anyone can
spend your money with.

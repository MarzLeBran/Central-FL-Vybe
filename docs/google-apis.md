# Google APIs — what's free, what bills

Three Google products touch this directory and they sit at very different
points on the pricing model. Getting them the wrong way round is how a
directory quietly runs up a four-figure monthly bill.

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
free Just Chillin' tier. The reference directory gates it behind its mid tier; that is
packaging, not economics, and copying it would withhold something that costs
nothing to give away. Do not add a "Google map on listing" row to
`site.planFeatures`.

Note the exception: a **dynamic** map — the Maps JavaScript API, e.g. a homepage
map with a pin per business — *is* billed under Essentials, free for the first
10,000 loads a month. That is a different product from the embed.

## Sourcing real listings — Text Search, ~$35 per 1,000 requests

Scraping Google Maps directly violates its Terms of Service. Places API
**Text Search (New)** is the legitimate way to turn "restaurants in Orlando
FL" into a list of real businesses — it's what backs
[`scripts/find-businesses.mjs`](../scripts/find-businesses.mjs).

Like Place Details, Text Search bills on whichever field pushes it to the
highest SKU. Requesting `nationalPhoneNumber`/`websiteUri` (needed to fill
out a usable listing) lands the whole call in the **Enterprise** SKU —
**$35.00 per 1,000 requests** — a step below the Enterprise+Atmosphere tier
that `rating`/`reviews` would trigger. `find-businesses.mjs` deliberately
never requests `rating` for this reason; ratings are a paid-listings-only
concern handled later by `import-reviews.mjs` above, not part of sourcing.

It also captures `types` — Google's own category tags (e.g. `plumber`,
`contractor`) — at no extra cost; that field is already included at the
Enterprise tier phone/website put us at. These tags aren't stored on the
`Listing` (they'd be redundant with our own `category`), but they do feed
into `import-listings.mjs`'s AEO description generation as a real, verified
signal about what the business does — see
[ai-descriptions.md](ai-descriptions.md).

One query = one request = up to 20 results. Sourcing the 25-50 businesses
Layer 0 wants (see [ghl-layer-0.md](ghl-layer-0.md)) typically takes
10-20 queries — **under $1**, and likely free outright under Google's
per-SKU monthly allowance (check current limits before assuming that
holds at larger scale).

```
npm run find-businesses -- --default        # small starter set, one query per county seat
npm run find-businesses -- queries.txt       # your own "Category|search text" list, one per line
```

Writes `out/sourced-businesses.csv` (gitignored), already shaped for
`scripts/import-listings.mjs` — review it, trim anything wrong, then:

```
npm run import -- out/sourced-businesses.csv --featured "Name A|Name B|Name C"
```

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

**Built, two complementary paths:**

1. **Automatic one-time backfill on upgrade** —
   [`src/pages/api/webhooks/reviews.ts`](../src/pages/api/webhooks/reviews.ts),
   called by a GHL workflow the moment a listing becomes paid (see
   [ghl-layer-0.md](ghl-layer-0.md)). Fetches once per listing, ever — a
   listing that already has a `google_rating` is always a free no-op, no
   matter how many times the workflow fires. This is what makes "flip a
   listing to paid" show a rating without running anything by hand.
2. **Scheduled refresh** — [`scripts/import-reviews.mjs`](../scripts/import-reviews.mjs),
   run manually or on a cron/GitHub Action, never from `npm run build`, for
   keeping *already-fetched* ratings from going stale (a rating doesn't
   change the moment it's fetched, but it does drift over months):

```
npm run reviews                     # refresh anything stale (default: 7+ days)
npm run reviews -- --max-age-days 14
npm run reviews -- --force          # ignore the cache, refetch everything paid
npm run reviews -- --dry            # print who'd be fetched, call nothing
```

It only fetches listings that are both paid **and** have a `placeId` set (the
`google_place_id` custom field — captured automatically by
`find-businesses.mjs` at sourcing time, or admin-filled otherwise, see
[ghl-layer-0.md](ghl-layer-0.md)); anything paid without one is skipped and
logged rather than matched by name/address guesswork. Results are cached in
`out/reviews-cache.json` (gitignored) with a `fetchedAt` timestamp — that
cache, not the schedule you run it on, is what actually prevents re-billing a
listing that was just refreshed.

## Keys

`GOOGLE_PLACES_API_KEY` goes in `.env` (already gitignored) and must stay
server-side — the import script is the only thing that reads it. A Places key
in client JavaScript is a key anyone can spend your money with.

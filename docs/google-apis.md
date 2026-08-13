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
   reviews" is a Good Vybin'/Full Thrivin' row on `/pricing`.
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

## Traffic analytics — two, deliberately separate

Neither of these is a Google Places/Maps product, but they're documented
here alongside the other "optional, external-service" features on this page.

**Vercel Analytics** — `@vercel/analytics`'s `<Analytics />` component in
`BaseLayout.astro`, on every page unconditionally. The code side is done;
it still needs enabling in **Vercel Dashboard → your project → Analytics
tab → Enable** before any data actually shows up there — the component
alone doesn't turn tracking on. Page views, visitor counts, top pages,
referrers, countries. Free tier is capped on event volume; upgrade if this
directory outgrows it.

**Google Analytics 4** — set `PUBLIC_GA_MEASUREMENT_ID` (starts with `G-`)
and the `gtag.js` script loads automatically in `BaseLayout.astro`; unset
and nothing loads at all, same "absent until configured" pattern as
`PUBLIC_GHL_WIDGET_ID`. No code changes needed to turn this on — just:

1. Create a free GA4 property at [analytics.google.com](https://analytics.google.com)
2. Copy its Measurement ID
3. Set `PUBLIC_GA_MEASUREMENT_ID` in `.env` (local) and Vercel's Environment
   Variables (production), then trigger a genuinely fresh deploy — same env-var
   gotcha as everywhere else in this project, "Redeploy" alone can reuse a
   stale build.

Free with no real usage cap, and considerably deeper than Vercel
Analytics — behavior flow, which listings get clicked, device/location
breakdowns. Both can run at once; they don't conflict or double-count
against each other, since each is its own separate script/service.

## Address autocomplete on `/add-business` — free, if used correctly

`src/pages/add-business.astro` optionally shows a Google Places search-as-you-type
assist above the plain address field — purely additive, the real `#address`
`<input>` is a normal text field the whole time and works identically whether
or not this is configured. Absent entirely unless `PUBLIC_GOOGLE_PLACES_API_KEY`
is set (see `.env.example`).

**This must use `PlaceAutocompleteElement` ("Autocomplete (New)"), never the
legacy `google.maps.places.Autocomplete` widget** — they are billed
completely differently. The legacy widget is per-request with no free
allowance. The new element uses **session-based pricing**: the free-text
predictions as someone types are free within a session, and the session
"closes" for free (under the 10,000/month free Essentials allowance) only if
it ends with a `fetchFields()` call requesting **Basic Data** fields (like
`formattedAddress` — what this code requests, nothing more). Request
Contact or Atmosphere data instead and the session jumps to a paid SKU. A
session that's *abandoned* (the visitor types but never selects a
suggestion) doesn't get the free session rate — but at directory scale,
occasional abandoned sessions are not a real cost concern.

**This is a different key from `GOOGLE_PLACES_API_KEY` above, and the two
must never be swapped.** `GOOGLE_PLACES_API_KEY` runs server-side in scripts
and must never reach the browser. `PUBLIC_GOOGLE_PLACES_API_KEY` is the
opposite — it's *meant* to be visible in browser JavaScript (Astro's
`PUBLIC_` prefix ships it to the client), so it must instead be locked down
in Google Cloud Console: **HTTP referrer restriction** to this site's
domain(s), and **API restriction** to just the Places API. An unrestricted
browser key is a key anyone can copy out of your page source and spend
against.

**Unverified, flagged honestly:** the exact `PlaceAutocompleteElement`
JavaScript API (event name `gmp-select`, `.toPlace()`, `.fetchFields()`) was
written from Google's current documented pattern, not confirmed against a
live API key. Smoke-test with a real key before relying on it — if Google
has changed the surface, the whole thing fails silently closed (the plain
address input keeps working regardless, per the try/catch around it), so a
break here would be invisible unless someone actually goes looking for the
autocomplete assist and finds it missing.

## Keys

`GOOGLE_PLACES_API_KEY` goes in `.env` (already gitignored) and must stay
server-side — the import script is the only thing that reads it. A Places key
in client JavaScript is a key anyone can spend your money with.

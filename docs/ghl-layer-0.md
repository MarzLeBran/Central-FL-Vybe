# GoHighLevel setup — Layers 0, 2, 3, 4 (backend reference)

This is the complete, current spec of what the Astro app in this repo expects
from GoHighLevel. It is written to be handed to someone (or something) setting
up the GHL side with no other context — every field, tag, token, and env var
the code actually reads or writes is listed here, and nothing here is
speculative: each entry says whether the app already uses it or is reserving
it for later.

**Ownership context:** this sub-account is for **Central FL Vybe**, the first
market site under the **VYBE Directories** brand (a DBA of **The 8th Day
Contracting LLC**). Each additional market (e.g. a future South FL VYBE) gets
its **own** GHL sub-account and its own repo deploy pointed at it — sending
reputation and contacts stay isolated per market. Nothing below is
market-specific except the sub-account name itself.

**Ordering discipline — do these in order, not in parallel:**
1. Sub-account + custom fields + tags + token (this section)
2. Import listings, confirm the site renders against live GHL data
3. **Only then** build outreach workflows (Layer 3) — wiring automations
   before the site has listings means your first prospects land on an empty
   directory.
4. Layer 5 (AI voice calling) comes after Layer 3 is live and generating
   claims — it is out of scope for this pass, see the preview at the bottom.

The field **keys** below are a contract with the code: `fetchFromGHL()` /
`mapContactToListing()` in [`src/lib/directory.ts`](../src/lib/directory.ts)
map them onto the `Listing` type in
[`src/types/listing.ts`](../src/types/listing.ts); `src/lib/submissions.ts`
writes several of them. Rename a key here and you must rename it in both those
files, or the site will silently stop reading/writing that data.

## 1. Sub-account

One GHL sub-account for Central FL Vybe. Ignore GHL's onboarding prompts for
email, phone and calendars for now — none of it is needed to get listings
rendering. Skip building any workflow/automation in this step; that's Layer 3,
after listings are live.

## 2. Custom fields

Create these on **Contacts**. The **key** is what the code matches on — get it
exact (lowercase, underscores, no typos); the field's display label can be
anything human-readable.

**Live now** — the site reads or writes every one of these already:

| Key | Type | Maps to `Listing` |
|---|---|---|
| `business_name` | Text | `businessName` |
| `business_category` | Text / Dropdown | `category` |
| `business_description` | Multi-line | `description` |
| `scraped_address` | Text | `address` |
| `county` | Dropdown: `Orange` \| `Osceola` \| `Seminole` \| `Lake` \| `Brevard` \| `Volusia` \| `Polk` | `county` — optional; leave blank rather than guess |
| `scraped_phone` | Phone | `phone` |
| `listing_slug` | Text | `slug` — URL key, must be unique |
| `google_rating` | Number | `rating` |
| `google_review_count` | Number | `reviewCount` |
| `google_place_id` | Text | `placeId` — captured automatically by `scripts/find-businesses.mjs` at sourcing time (free `places.id` field, see [google-apis.md](google-apis.md)); for anything sourced another way, fill by hand (Google Business Profile → Share → the id in the URL, or the [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)). Only matters for **paid** listings — `scripts/import-reviews.mjs` skips any paid listing without one rather than guessing by name/address. |
| `image_urls` | Multi-line | `imageUrls` (newline- or comma-separated) |
| `hours` | Multi-line | `hours` |
| `social_links` | Multi-line | `socialLinks` (`instagram=https://…` per line) |
| `plan_tier` | Dropdown: `Free` \| `Featured` \| `Premium` | `planTier` — Day Pass / Spotlight / All Access on `/pricing`; `normalizePlanTier()` also accepts "Spotlight"/"All Access" as synonyms. Upgraded automatically by Stripe checkout (Layer 4) once live. |
| `claim_status` | Dropdown: `Unclaimed` \| `Pending` \| `Claimed` | `claimStatus` |
| `ai_context` | Multi-line | `aiContext` — knowledge for the All Access per-listing agent (Layer 5) |
| `agency_client` | Checkbox | `agencyClient` |
| `client_location_id` | Text | `clientLocationId` — their own sub-account, once they're an agency client |
| `tcpa_consent` | Checkbox | Written on every claim/add-business submission, consented or not |
| `tcpa_consent_ts` | Date/Text | When they answered the consent checkbox |
| `tcpa_consent_ip` | Text | IP the submission came from |
| `tcpa_consent_version` | Text | Which exact wording they saw (`TCPA_CONSENT_VERSION` in `src/lib/consent.ts`) |

The four `tcpa_*` fields are the legal record behind Layer 5's outbound
courtesy call — without them there is no evidence of permission. They get
written on **every** claim/add-business submission regardless of whether
consent was given, because recording that consent was *asked* matters as much
as the answer.

**Reserved, not wired into the app yet** — create the field now so it exists,
but nothing reads or writes it today:

| Key | Type | Purpose |
|---|---|---|
| `claim_token` | Text | Planned replacement for `/claim`'s `?t=` and `/upgrade`'s `?t=`, which today are literally the GHL contact id (fine for testing, guessable, must be swapped for an unguessable token before either link goes out in real outreach — Layer 3 work). |

## 3. Tags

| Tag | Meaning |
|---|---|
| `business` | **Makes the contact a listing.** Remove it and the listing disappears from the live site. |
| `new_business_request` | Self-submitted via `/add-business`, **not yet a live listing**. Review in GHL and add `business` yourself to publish it. |
| `directory_lead` | Came in via the directory outreach, not yet engaged — apply this when you first import a prospect, before any workflow touches them. |
| `dir_engaged` | Opened/clicked/replied to outreach — a workflow "add tag" action, not manual. |
| `dir_claimed` | Claimed their listing — a hot lead. Added automatically by `submitClaim()` in `src/lib/submissions.ts`. |
| `opt_in_voice` | Consented to AI-assisted calls (the `tcpaConsent` checkbox was checked on claim) — the outbound-call trigger. Added automatically by `submitClaim()`, only when consent was given. |
| `dir_opt_out` | Suppress everything — respect this in every workflow's filter. |

## 4. Private Integration token

Settings → Private Integrations → create one for this sub-account with read
and write on **Contacts** (search, update, tags) and read on **Custom
Fields**.

## 5. Environment variables

Local dev (`.env`, gitignored, never committed):

```
DATA_SOURCE=ghl
GHL_PIT_TOKEN=...
GHL_LOCATION_ID=...
```

`GHL_LOCATION_ID` is the sub-account id — it ends up publicly visible in image
URLs, so only the token needs to be treated as secret. Leaving `DATA_SOURCE`
unset (or `mock`) keeps the site on local mock data with zero GHL setup —
useful for verifying a code change before trusting it against live data.

**Production (Vercel):** the same three variables need to be set in the
Vercel project's Environment Variables, not just locally — a `.env` file
never ships to a deploy. Do this once the sub-account is populated and you're
ready to go live; leave `DATA_SOURCE` unset (or absent) in Preview
deployments if you want PR previews to keep rendering mock data.

Layer 4 (Stripe) and the reviews importer need their own keys —
[`stripe-checkout.md`](stripe-checkout.md) and
[`google-apis.md`](google-apis.md) — set locally and in Vercel the same way.
Sourcing and importing real businesses needs two more: `GOOGLE_PLACES_API_KEY`
(see [google-apis.md](google-apis.md)) and `ANTHROPIC_API_KEY` for AEO
description generation (see [ai-descriptions.md](ai-descriptions.md)) —
neither is required to run the site itself, only `npm run find-businesses`
and `npm run import`. See `.env.example` in the repo root for the full list
of every env var this project reads, in one place.

## 6. Importing your first listings

`npm run import` writes both halves at once:

```
npm run import -- prospects.csv --featured "Name A|Name B"
```

- `src/data/mock-listings.json` — the site renders immediately, no GHL needed
- `out/ghl-import.csv` — drop straight into GHL Contacts → Import

**The First Name trap.** GHL requires a first name on every contact, and the
listing title reads from it. If you map the owner's name there, every listing
on your site shows a person's first name instead of the business. The
importer always writes the **business name** into First Name and keeps any
owner name in Last Name. If you import a CSV by hand instead, check that
mapping yourself.

On import, choose "add tag to imported contacts" and apply **both**
`business` and `directory_lead` — every row becomes a live listing *and* is
marked ready for the Layer 3 outreach sequence in one pass.

## Layer 2 — the write path (already built)

`src/lib/submissions.ts` mirrors `directory.ts`'s `DATA_SOURCE` switch.
`submitClaim()` updates an existing contact, adds `dir_claimed` (and
`opt_in_voice` if consent was checked) via the tags endpoint — never by
overwriting the contact's `tags` array, which would silently strip `business`
and unpublish the listing. `submitAddBusiness()` creates a new contact tagged
`new_business_request` — deliberately **not** `business`, so a self-submitted
listing stays off the live directory until reviewed and tagged manually.

`directory.ts`'s read path resolves GHL's per-field `id` back to the `key`
above via a cached `GET /locations/:locationId/customFields` call (contact
read responses only return `{id, value}`, never the key) — already handled,
nothing to configure.

## Layer 3 — outreach workflows (build these once Layer 0 is done and listings are live)

No front-end code — this is entirely GHL Workflows, built against the tags
and fields above. **This is where GHL's AI-assisted workflow/content tools
are worth using** to draft copy and scaffold the automation instead of
building every step by hand; fall back to manual steps wherever an AI
feature isn't available.

The funnel this replicates: seed the directory with real listings, then
convert cold contacts into hand-raised leads by inviting them to claim a
listing that's already live and looks legitimate — not a cold pitch.

Suggested skeleton (adjust wording/cadence to taste, but keep the tag logic —
the rest of the app depends on it):

1. **Trigger:** contact tagged `directory_lead`.
2. **Step 1 — email:** "Your business is listed on Central FL Vybe — claim it
   free." Link to `/claim?t={{contact.id}}` (the live listing's claim URL —
   see the `claim_token` note above for why this is temporary).
3. **Step 2 — SMS** a day or two later, same offer, shorter.
4. **On open/click/reply:** add tag `dir_engaged`, remove from the reminder
   branch (they've seen it).
5. **On `dir_claimed`:** workflow ends for outreach purposes — Layer 5 picks
   up from here (courtesy call) once that's built.
6. **Every step:** filter out contacts tagged `dir_opt_out` first.
7. **Suppression:** an unsubscribe/STOP reply adds `dir_opt_out` and removes
   from every other workflow — required before sending real SMS (see the TCPA
   wording in `src/lib/consent.ts`, which this outreach is downstream of).

## Layer 4 — the monetization path (already built)

- `plan_tier` is what Stripe checkout upgrades — `applyPlanUpgrade()` in
  `src/lib/submissions.ts` PUTs it directly, key-addressed, unaffected by the
  read-path id→key resolution above.
- See [`stripe-checkout.md`](stripe-checkout.md) for the Stripe env vars and
  webhook setup (a separate Stripe account, not a GHL feature), and the
  Google Reviews section of [`google-apis.md`](google-apis.md) for
  `scripts/import-reviews.mjs` and the `google_place_id` field above.

## Layer 5 preview — not in scope for this pass

Once Layer 3 is live and producing claims, the next GHL-side build is the
outbound **courtesy call**: `opt_in_voice` fires an AI-assisted call (GHL's
own Voice AI, or a third-party integration such as Vapi — undecided) that
identifies itself as calling on behalf of the business's own listing, framed
as a courtesy call rather than a sales call. This depends on the
`tcpa_consent*` fields above as its legal basis and is genuinely a "GHL AI"
feature (their Voice AI / Conversation AI product), distinct from the
per-listing text agent on All Access listings, which is this app's **own**
Vercel-hosted LLM widget, not a GHL product. Do not start building this
before Layer 3 is live — flagged here only so the field/tag groundwork above
doesn't need to be revisited later.

## Done when

- A test contact tagged `business` has every "Live now" field above
  populated, and shows up correctly on the live site with `DATA_SOURCE=ghl`.
- 25–50 real businesses are imported, with **at least 3 set to `Featured`**
  and filled out properly. A directory where nothing is featured reads as
  empty, and nobody asks whether those businesses paid.
- Only then: build the Layer 3 outreach workflows above and drop contacts in.

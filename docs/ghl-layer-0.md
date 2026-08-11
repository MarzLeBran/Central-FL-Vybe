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
| `logo_url` | Text | `logoUrl` — separate from `imageUrls[0]`/cover photo. Written by the owner self-serve/admin editor (`/manage`, `/manage/admin`), points to a Vercel Blob URL |
| `youtube_url` | Text | `youtubeUrl` — curated safe embed, validated as a YouTube URL server-side before write, never rendered as raw HTML |
| `booking_url` | Text | `bookingUrl` — curated safe embed (e.g. Calendly), validated as `https://` server-side before write |
| `hours` | Multi-line | `hours` |
| `social_links` | Multi-line | `socialLinks` (`instagram=https://…` per line) |
| `extra_links` | Multi-line | `extraLinks` — owner-curated link list (`Label\|https://…` per line, one per line). Structured fields only, deliberately not a raw-HTML/embed field — see the "no custom code" note where `ListingEditForm.astro` is introduced. |
| `special_offer` | Text | `specialOffer` — free-text coupon/promo blurb, owner-edited, shown as a banner on the listing page |
| `plan_tier` | Dropdown: `Free` \| `Featured` \| `Premium` | `planTier` — Just Chillin' / Good Vybin' / Full Thrivin' on `/pricing`; `normalizePlanTier()` also accepts "Spotlight"/"All Access" as synonyms (the tier names before this round of renaming). Upgraded automatically by Stripe checkout (Layer 4) once live. |
| `claim_status` | Dropdown: `Unclaimed` \| `Pending` \| `Claimed` | `claimStatus` |
| `ai_context` | Multi-line | `aiContext` — knowledge for the All Access per-listing agent (Layer 5) |
| `ai_agent_enabled` | Checkbox | `aiAgentEnabled` — Premium alone does NOT show the "Ask this business" card/widget; this must also be checked, by hand, once a real agent has actually been built for that specific business. Defaults unchecked/false on every listing, including new Premium ones. See `hasListingAgent()` in `src/types/listing.ts`. |
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
| `business` | **Makes the contact a listing.** Remove it and the listing disappears from the live site — but only after the next build; see section 7 for making that automatic. |
| `new_business_request` | **Legacy — not used by the current `/add-business` flow.** Previously meant "self-submitted, not yet live, needs manual review before tagging `business`." As of the self-serve-with-payment redesign (see section 7), every `/add-business` submission gets `business` added automatically — free ones immediately, paid ones once Stripe confirms payment — so nothing goes through this tag today. Left defined in case you ever want to hand-add a listing in a truly unpublished, review-first state again. |
| `directory_lead` | Came in via the directory outreach, not yet engaged — apply this when you first import a prospect, before any workflow touches them. |
| `dir_engaged` | Opened/clicked/replied to outreach — a workflow "add tag" action, not manual. |
| `dir_claimed` | Claimed their listing — a hot lead. Added automatically by `submitClaim()` in `src/lib/submissions.ts`. |
| `opt_in_voice` | Consented to AI-assisted calls (the `tcpaConsent` checkbox was checked on claim) — the outbound-call trigger. Added automatically by `submitClaim()`, only when consent was given. |
| `dir_opt_out` | Suppress everything — respect this in every workflow's filter. |
| `plan_featured` | Added automatically by `applyPlanUpgrade()` the moment a Stripe checkout for the Good Vybin' tier completes (live mode: from the Stripe webhook; mock mode: immediately). Removed automatically on a further upgrade to `plan_premium`. Exists so a GHL workflow can trigger off "Contact Tag Added" — see section 7 — rather than a broad "Contact Updated" firing on every unrelated edit. |
| `plan_premium` | Same as `plan_featured`, for the Full Thrivin' tier. Mutually exclusive with `plan_featured` — `applyPlanUpgrade()` removes the other one when adding this one. |
| `consumer` | **A visitor account, not a listing.** Set by `registerConsumer()` in `src/lib/consumer-submissions.ts` — deliberately never co-occurs with `business` on the same contact, even if the same person also owns a claimed listing under a different contact record. See `docs/consumer-accounts.md`. |

### Consumer-only custom fields (never used by `Listing`)

| Key | Type | Purpose |
|---|---|---|
| `avatar_url` | Text | Consumer's profile photo — Vercel Blob URL, written from `/account`. |
| `followed_listings` | Multi-line | Comma-separated listing slugs this consumer follows — same CSV-in-a-text-field convention as `image_urls`. |

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

## 7. Keeping the live site in sync — Vercel Deploy Hook

**Status: done, live, confirmed working both directions** (tag added → listing
appears; tag removed → listing disappears; both automatic, no manual
redeploy). Two real gotchas hit while setting this up, worth knowing before
building the next GHL-workflow-triggered thing (e.g. the reviews webhook
below):

1. **Vercel env vars added via the dashboard don't apply to already-created
   deployments** — clicking "Redeploy" on an old deployment can reuse stale
   settings. After adding/changing env vars, trigger a genuinely fresh
   deployment (push a commit, or let a real webhook fire one) rather than
   assuming "Redeploy" alone picks them up.
2. **Editing an already-published GHL workflow leaves the live version frozen
   at whatever was last published** — new or changed triggers sit in an
   unpublished draft until you explicitly hit Publish again. This is exactly
   what happened here: the "Contact Tag Removed" trigger worked immediately,
   while "Contact Tag Added" silently did nothing for a while, because only
   the removed-trigger version of the workflow had ever actually been
   published. If a trigger looks correctly configured but isn't firing,
   check the workflow's publish status before assuming the trigger itself is
   broken.

The site is a **static build** (see repo facts in `CLAUDE.md`) — every listing
page is prerendered HTML, not a live per-request GHL fetch. That means adding
`business`, removing it, or editing any "Live now" field in section 2 does
**nothing** on the live site until the next build. Without this section,
"remove the tag to pull a listing" (the workflow described in the `business`
row of section 3) requires you to manually trigger a redeploy every time —
easy to forget, and the gap between "tag removed in GHL" and "listing
actually gone from the live site" is a real problem the one time it matters
(a business owner asking to be pulled).

**Fix: a Vercel Deploy Hook, fired by a GHL workflow, on any change to a
`business`-tagged contact.**

**Vercel side** (dashboard, not code): Project → Settings → Git → Deploy
Hooks → create one (name it something like "GHL contact sync"), targeting the
`main` branch (or whatever branch production deploys from). Vercel gives you
a POST URL, e.g. `https://api.vercel.com/v1/integrations/deploy/prj_xxx/xxx`.
Hitting it with an empty POST kicks a fresh build — no payload, no auth
beyond the URL itself, so treat the URL as a secret (anyone with it can
trigger builds, though not read or write data).

**GHL side** (dashboard, Workflows): build one workflow with triggers —
"Contact Tag Added" and "Contact Tag Removed" — both scoped to the `business`
tag specifically (not "Contact Updated" broadly, or unrelated CRM edits on
every contact burn a build). Action: Webhook → POST to the Deploy Hook URL.

**To also rebuild automatically when someone upgrades via Stripe:** add a
third trigger — "Contact Tag Added," filtered to `plan_featured` **or**
`plan_premium` (GHL lets you select multiple tags on one trigger; either one
firing is enough) — to the same workflow, same webhook action. `applyPlanUpgrade()`
in `src/lib/submissions.ts` adds one of those two tags the moment a real
Stripe payment is confirmed (see section 3), so this is the same clean
tag-triggered pattern as the `business` tag sync above, not a broad "Contact
Updated" trigger that would also fire on unrelated edits like correcting a
phone number. **Don't forget to hit Publish after adding it** — see gotcha #2
below.

A build takes ~1–2 minutes on Vercel, so there's a short lag between the GHL
change and it going live — expected, not a bug.

### Notifying yourself about a new self-signup

Every `/add-business` submission — free or paid — goes live immediately with
`claim_status: Pending`, not a review-gated draft (see section 3's note on
`new_business_request`). "Pending" means *you* haven't personally followed up
yet, not that the listing is hidden. You need to actually find out it
happened.

**Trigger:** "Contact Tag Added" → `business`, filtered to `claim_status =
Pending`. This is the same tag event the Deploy Hook workflow above already
listens for — add this as a **second, separate workflow** with the same
trigger rather than a branch inside that one, so a mistake editing your
notification logic can never accidentally break the rebuild, and vice versa.

**Action:** GHL's "Internal Notification" action (or create a Task assigned
to yourself) — whichever surfaces in wherever you actually check first.
Include `{{contact.first_name}}` (the business name — see the first-name
trap in section on Create Contact) and the `plan_tier` field in the
notification body so you know at a glance whether this is a free listing to
casually check or a paying customer to prioritize.

**Why the filter matters:** `business` also gets added when you manually
tag an admin-imported unclaimed listing (section 7's first workflow) — that
case is `claim_status: Unclaimed`, not `Pending`, so this filter correctly
skips it. You already know about those; you did them yourself.

### Auto-backfilling Google ratings on upgrade (`src/pages/api/webhooks/reviews.ts`)

`npm run reviews` (see [google-apis.md](google-apis.md)) is still how ratings
get *refreshed* on a schedule, but a **new** paid listing doesn't have to
wait for that — a second GHL workflow can call a webhook the moment a
contact becomes paid, so the rating shows up without you running anything.

**Vercel side:** nothing to create in the dashboard this time — it's already
a route in the app (`/api/webhooks/reviews`). Set `REVIEWS_WEBHOOK_SECRET`
in your env (local `.env` and Vercel's Environment Variables) to any random
string; the route 403s without the matching `?secret=` query param.

**GHL side** (dashboard, Workflows): a workflow triggered by **"Contact Tag
Added"** (`business`) and/or **"Contact Updated"** filtered to contacts
already tagged `business` — the same triggers as the Deploy Hook workflow
above, this can be a second action on that *same* workflow rather than a new
one. Action: Webhook → POST to
`https://<your-domain>/api/webhooks/reviews?secret=<REVIEWS_WEBHOOK_SECRET>`.

**What it actually does, and why it's safe to fire repeatedly:** the route
re-fetches the contact fresh from GHL (never trusts the webhook body for
the decision — GHL's webhook payload shape is configurable per-workflow, not
something to build billing logic on), and only calls the Places API if the
contact is tagged `business`, on a paid `plan_tier`, has a `google_place_id`,
**and doesn't already have a `google_rating` value**. That last check is the
actual cost guardrail — once a listing has been fetched once, every future
"Contact Updated" fire for that same contact (correcting an address, editing
the description, anything) is a free no-op. It never re-bills a listing that
already has a rating; that's still `npm run reviews`'s job, on your schedule.

**Unverified, flagged honestly:** GHL's webhook POST body shape wasn't
confirmed against a live payload — the route tries `contact_id`, `contactId`,
`contact.id`, and `id` at the top level. Smoke-test against a real workflow
fire and adjust `src/pages/api/webhooks/reviews.ts` if your workflow's
payload shape doesn't match one of those.

### Owner self-serve / admin editing (`src/pages/manage/*`)

Paid-tier owners can sign in at `/manage` (passwordless magic-link, email
must match the contact's native `email` field) to edit their description,
photo gallery, logo, and the two curated embeds above — `claim_status` of
either `Claimed` or `Pending` qualifies, not just `Claimed`. A paid
`/add-business` signup is `Pending` from the moment they pay, and they get
self-serve access immediately rather than waiting on your manual review; only
`Unclaimed` is locked out. You can also edit **any** listing — claimed or not,
any tier — at
`/manage/admin` behind a separate shared password (`ADMIN_PASSWORD`), on a
client's behalf.

Both write through `submitListingUpdate()` in `src/lib/submissions.ts`, a
plain `PUT /contacts/:id` with no `tags` key — this is exactly the kind of
"Contact Updated" change this section's Deploy Hook already covers. If you've
added the optional "Contact Updated" trigger above, a saved self-serve edit
auto-triggers a rebuild with no extra code. If not, the edit still saves
correctly but waits for the next rebuild like any other GHL change — not a
bug in the editor.

Photos/logos upload directly to Vercel Blob (`BLOB_READ_WRITE_TOKEN`), never
through GHL — GHL custom fields only ever hold the resulting URL string. See
`docs/consumer-accounts.md` for the auth design (magic-link tokens, session
cookies, no users table).

## Layer 2 — the write path (already built)

`src/lib/submissions.ts` mirrors `directory.ts`'s `DATA_SOURCE` switch.
`submitClaim()` updates an existing contact, adds `dir_claimed` (and
`opt_in_voice` if consent was checked) via the tags endpoint — never by
overwriting the contact's `tags` array, which would silently strip `business`
and unpublish the listing.

`submitAddBusiness()` creates a new contact for **any** of the three tiers,
picked on the `/add-business` form itself (not a separate flow per tier):

- **Free:** tagged `business` immediately, in the same create-contact call.
  Live the moment the form submits.
- **Featured/premium:** created untagged. `/api/add-business` then sends the
  visitor straight to Stripe (`createCheckoutSession()` with `activate:
  true`); `business` only gets added by `applyPlanUpgrade()` once the
  webhook confirms real payment (see section 7's Deploy Hook triggers) — so
  nobody sees a paid listing that was never actually paid for, and nobody
  pays and finds out afterward that it never went live.

Either way, `claim_status` comes back `Pending` — not a review gate that
blocks publishing, just a flag that a human (you) hasn't personally followed
up yet. See "Notifying yourself about a new self-signup" in section 7 for
how to actually find out one came in, and "touching up" a raw self-submitted
description before it's been reviewed is still a manual step worth doing —
see `docs/ai-descriptions.md` — nothing regenerates it automatically.

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

# Project: Local Business Directory (Smart-Directory-style lead engine)

## What this is
A great-looking local business **directory** that doubles as a lead-generation and sales engine. Businesses get added (via GoHighLevel), appear as listings, are invited to **claim** their listing for free, and are then upsold: a paid **Featured** listing, and ultimately monthly **agency services**. One directory = one market (e.g. "Space Coast", "Central Florida").

**Stack:** Astro + Tailwind (v4) + TypeScript, deployed on Vercel. GoHighLevel (GHL) is the CRM/backend.

## Golden rules (do not break these)
1. **GHL is the single source of truth for listing data.** The front end reads it and writes back to it. Do NOT introduce a separate database.
2. **All data access goes through `src/lib/directory.ts`.** Import `getListings`, `getListingBySlug`, `getFeaturedListings`, `getListingsByCategory`. Never fetch GHL or read the mock JSON directly from a page/component.
3. **Do not change the data contract** in `src/types/listing.ts` or the public function signatures in `src/lib/directory.ts` without flagging it first.
4. **`DATA_SOURCE=ghl` locally and in production** — the site reads/writes a real GHL sub-account, not mock data. `DATA_SOURCE=mock` (the default when unset) still has to keep working too — it's how a fresh clone builds/runs with zero setup, and how a write path gets smoke-tested without touching live data. Never test a write path (`curl`, a dev-server POST) without first checking which mode `.env`'s `DATA_SOURCE` is actually in — a "quick test" against a `ghl`-configured `.env` writes to the real account. (Learned this the expensive way — see "Known bugs fixed along the way.")
5. **Astro gotcha:** never put HTML comments (`<!-- -->`) inside template/JSX expressions — it breaks the compiler. Keep comments in the `---` frontmatter.
6. **Build in layers, in order. Do not build deferred (Layer 6+) features early.** Ask before scope-jumping.
7. **Design must be distinctive, not templated** (see Design rules). Avoid the generic-directory look.

## Architecture
```
Astro pages (mostly static/SSG — great SEO; a few routes on-demand, see "Repo facts" below)
   → src/lib/directory.ts  (data layer; DATA_SOURCE=ghl live, =mock for a clone/local testing)
   → Vercel serverless API routes (hold the GHL key server-side; handle claim/add/checkout/webhooks)
   → GoHighLevel sub-account (contacts = listings, workflows, payments, inbox)
```
A contact tagged `business` in GHL = a listing. Multi-market = this same repo deployed once per market, each pointed at its own GHL sub-account + domain.

## Two browse axes: county and category
One directory covers **all seven Central Florida counties** — Orange, Osceola, Seminole, Lake, Brevard, Volusia, Polk — rather than separate market deploys per region. The Space Coast is part of this directory, not a second one.

Visitors can browse by category (`/category/plumbing`), by county (`/county/seminole`), or by both (`/county/seminole/plumbing`). The county×category pages are the SEO/AEO payoff: each is static HTML with its own title and description matching how people actually search locally.

Counties live in `site.counties` with a `cities` list that drives **automatic assignment at import time** — `countyForAddress()` in `src/lib/counties.ts` matches an address against city names (longest first, so "West Melbourne" beats "Melbourne") and also against "<County> County" for scraped rows that name no city. `county` is **optional** on `Listing`: a business we cannot place still appears in search, All Listings and category pages, just not under a county. Silence beats a wrong county on someone's business page.

The importer carries its own copy of the county table (it is a plain Node script with no build step) — **add a city in both places** or imports and the site will disagree.

## Navigation grouping
Categories are **flat in the data** and grouped only for the header nav, via `site.categoryGroups` in `src/config/site.ts` (Dining / Services / Retail). Rules the header enforces: a group with no matching listings is hidden, and any category *not* named in a group is collected into a "More" group — so a new category arriving from a CSV import can never silently vanish from the nav. Grouping is presentation only; never let it leak into `Listing`.

Header also carries **Get listed** (→ `/pricing`) and an **Explore** dropdown for editorial sections. Explore items live in `site.exploreLinks` with an `enabled` flag and render only when true, so the dropdown stays hidden until the Layer 7 pages behind it exist — nothing in the nav can 404.

## Data contract
Defined in `src/types/listing.ts`. Key fields: `slug`, `businessName`, `category`, `description`, `address`, `county` (optional), `phone`, `website`, `rating`, `reviewCount`, `imageUrls`, `hours`, `socialLinks`, `extraLinks`, `specialOffer`/`specialOfferImageUrl`, `planTier` (`free`|`featured`|`premium`), `claimStatus`, `aiContext`, `agencyClient`, `clientLocationId`. Plus four per-listing content-type lists — `blogPosts`, `newsItems`, `events`, `team` — each stored as a **JSON array** in one GHL Multi-line field (not the "one line per entry" convention `socialLinks`/`extraLinks` use, since an entry's body text can itself contain newlines); see `docs/ghl-layer-0.md` §2.

Tier logic lives in three exported helpers there — `isPaidTier`, `hasListingAgent`, `tierRank` — so no page branches on a raw string. Adding a fourth plan should mean editing those and `site.plans`, nothing else.

## The tiers (drives everything)
**Value policy (overrides the old "basic free listing" split):** a free listing is a real, complete, useful page — full description, map, hours, phone, website, social links and `LocalBusiness` structured data. We do **not** cripple free pages to manufacture upgrades. The directory has to be worth linking to on its own merits or the whole foot-in-the-door premise collapses. Featured sells *placement and reach*, not access to the basics.

**Three directory plans**, sold on `/pricing`. Names/prices/feature matrix all live in `site.plans` + `site.planFeatures`; the `id` is the `PlanTier` value and the GHL `plan_tier` field, so marketing can rename a plan without touching data.

| `PlanTier` | Plan | Price | Listing | AI agent on their page |
|---|---|---|---|---|
| `free` | **Just Chillin'** | $0 forever | Full page: description, hours, phone, website, socials, schema, claim button | Directory-wide chat (shared) |
| `featured` | **Good Vybin'** | $249 / yr | + Google reviews & map, gallery, blog/events/news, team, special-offer coupon cards, top placement | Directory-wide chat (shared) |
| `premium` | **Full Thrivin'** | $699 / yr | + AI review response, promo video, everything | **Own text agent** (our Vercel LLM widget, cost-capped in code) |

Plan names have been renamed twice this session (Day Pass/Spotlight/All Access → ... → the row above) — `site.plans` in `src/config/site.ts` is the only place that matters; if this table and the code ever disagree, the code wins and this table is stale.

**The GHL agency retainer ($297–597/mo) is sold separately and must never appear on `/pricing`.** That conversation happens after a claim; the directory page sells the directory only. It has its own page now — `/grow` (`docs/ghl-layer-0.md` §3's `agency_lead` tag) — pitching capabilities (custom website, review management, missed-call text-back, AI voice/chat agent) with **no price shown and no fixed packages**, funneling to a short interest form rather than a checkout, since offerings are mixed/matched per business rather than sold as tiers. Linked from post-claim moments (`claim/thanks.astro`, `/manage`) and the footer — deliberately not primary nav or `/pricing`.

**Map is free on every tier; Google reviews are gated — and that split is about cost, not packaging.** The Maps Embed API is free with unlimited requests, so withholding a map from a free listing would cost us nothing and buy us nothing. Places API Place Details with `reviews`/`rating` bills at **$40 per 1,000 requests**, which is $120 per refresh across 3,000 listings versus ~$2 across the paid ones. Do not "fix" the apparent inconsistency by adding a map row to `site.planFeatures` — see `docs/google-apis.md`.

## The widget routing rule (never two chat widgets on one page)
Exactly ONE widget per page, decided by tier:
- Home, all non-listing pages, **Just Chillin'** and **Good Vybin'** listings → **directory-wide** assistant.
- **Full Thrivin'** listing → **custom per-listing text agent** only (directory-wide widget suppressed).
- **Agency-client** listing → **GHL Voice AI** agent (Layer 5).

Note the boundary: "AI agent for your listing" is a Full Thrivin' feature on `/pricing`, so **Good Vybin' does not get its own agent**. `hasListingAgent()` in `src/types/listing.ts` is the single place that decides this — change it there, nowhere else. `BaseLayout` owns mounting the directory-wide widget, which is what makes "never two" structural rather than something each new page has to remember.

## Build layers (the roadmap)
- **L0 — GHL foundation** (done by the owner, manual): sub-account, custom fields, tags, API token.
- **L1 — Front door: done.** Homepage, listings grid, category pages, county pages, client-side search (Fuse.js), pricing, and listing-detail (cover image, socials row, Claimed badge, Google Map embed, hours table).
- **L2 — Claim + add-business: done, redesigned this session.** `/claim` (live lookup by `?t=` listing id, pre-filled, unchecked TCPA consent, already-claimed state) is unchanged. `/add-business` now has a **plan picker** (free/featured/premium) and both POST to on-demand `/api/claim` and `/api/add-business`, which write through `src/lib/submissions.ts`. A free signup is tagged `business` immediately — live the moment it's submitted. A paid signup is created untagged and sent to Stripe; it only actually goes live (`business` tag added) once the webhook confirms real payment. Either way `claim_status` comes back `Pending`, not a review gate — the listing is fully live and visible either way, `Pending` is purely an internal "haven't personally followed up yet" flag (see `docs/ghl-layer-0.md` §3 and §7). The old `new_business_request` tag (self-submitted, invisible until manually reviewed) is now **legacy, unused by the current flow** — kept defined in GHL in case that review-gated pattern is ever wanted again. Newsletter capture is not yet built.
- **L3 — Outreach:** built in GHL (workflows, not code) — see `docs/ghl-ai-workflow-prompts.md` for ready-to-paste build prompts for all six current automations (live-sync, new-signup notification, reviews backfill, agency-client auto-upgrade, cold-lead outreach sequence, engagement tracking).
- **L4 — Monetization: done**, including the one previously-missing piece. Stripe checkout (mock-first, real once keys are set — `docs/stripe-checkout.md`) and Google Reviews import (`docs/google-apis.md`) were already built; **Deals/coupons** (`DealCard.astro`, a "Today's Deals" homepage row + coupon card on the listing page, "Get This Deal" links to the business's own site) shipped this session, plus Stripe promo-code support (`allow_promotion_codes: true`) for things like a founders' discount.
- **L5 — AI agents: partially built.** The per-listing text agent widget routes correctly (`hasListingAgent()` requires Premium tier AND a manually-flipped `ai_agent_enabled` field — Premium alone no longer shows an agent with nothing behind it), but `ListingAgentWidget.astro` has no real backend yet. Outbound "courtesy call" (GHL Voice AI / Vapi) is not started.
- **L6 — Consumer accounts + owner self-manage: built**, pulled forward ahead of L3 outreach at the owner's request. Passwordless magic-link auth (`src/lib/auth.ts`), no users table, GHL contact is the source of truth — see `docs/consumer-accounts.md`. Owner self-serve editing (`/manage`), an internal admin editor (`/manage/admin`), and consumer register/login/follow/profile (`/account`) are all live — see "Current status" below for the full breakdown. `/manage` eligibility is `claim_status !== "unclaimed"` (not strictly `"claimed"`) on a paid tier, so a paid signup gets self-serve access immediately rather than waiting on manual review. The site is no longer pure-static: `astro.config.mjs`'s Vercel adapter now backs a real set of on-demand routes.
- **L7 — Partially done, redefined this session.** Blog/events/news/team are built, but as sections **on each business's own listing page** (`business/[slug].astro`), editable via `ListingEditForm.astro` — not the site-wide `/blog`, `/events`, etc. hub pages that `site.exploreLinks` (all `enabled: false`) still reserves. That site-wide-hub version is the part still genuinely deferred; don't build it without confirming that's actually wanted, since it's a different, bigger feature than what shipped.

## Design rules
Distinctive, not the generic directory template. **Avoid:** warm-cream + serif + terracotta; near-black + one acid accent; purple/blue gradients; glassmorphism; the centered-headline-two-buttons hero; three rounded cards with outline icons; stock photos of strangers. **Do:** a strong hero (map-anchored or editorial masthead work well for a community directory), a real type scale with a confident pairing, one bold signature element, everything else quiet. Mobile-first.

**Brand:** the first market is **Central FL Vybe** — *Vybe with a Y is deliberate. Never correct it to "Vibe" anywhere.* Palette is lifted from the logo: coral `#ee5a3c` (wordmark + skyline), amber `#efb02a` (sun), teal `#33a399` (palm), deep teal-navy `#17414b` (the "Central FL" mark, used as the site's ink).

**As built:** near-white paper, oversized display type, flat saturated colour blocking. The signature element is the **category hue** — every category owns one of nine colours (`src/lib/categories.ts`), following it through card marks, index rows, chips and page accents. Assignment hashes the name then probes past collisions across the whole category set, so imported categories get a distinct colour automatically; the three brand hues are used first. Hue classes are authored CSS in `styles/global.css` (`.hue-coral` …) which is why building the class name dynamically is safe. One motion in the system: cards lift on hover, honouring `prefers-reduced-motion`.

## Current status (updated this session — read this first)

**GHL Layer 0 is done and live — `DATA_SOURCE=ghl` works against a real sub-account.** L1, L2, L4, and L6 are built; L7 is partially built (per-listing content sections, not the site-wide hub). L5 is partially built (per-listing agent routing exists, no real agent backend yet). L3 is GHL-workflow-only — ready-to-paste build prompts exist (`docs/ghl-ai-workflow-prompts.md`) but whether all six are actually built and *published* in the live GHL account needs verifying before relying on them; don't assume they're active without checking.

**The site is live at `centralflvybe.com`** (domain purchased and connected this session — no longer sitting on the default `*.vercel.app` URL), imported from GitHub (`github.com/MarzLeBran/Central-FL-Vybe`, `main` branch). `site.origin`/`site.contactEmail` in `src/config/site.ts` were corrected to match (they'd been left as a placeholder `cflvybe.com` — a real bug, not cosmetic, since it fed canonical URLs/OG tags/JSON-LD sitewide). Confirmed actually reading live GHL data, not mock, from a genuinely fresh clone.

**GHL live-sync now covers three kinds of change, not two.** One workflow, "Directory Live Sync": Contact Tag Added/Removed on `business` (a listing going live or coming down) — confirmed working end-to-end — **plus** Contact Tag Added on `plan_featured` OR `plan_premium` (a real Stripe upgrade), which is new this session and whose GHL-side trigger needs confirming/adding (the code side — `applyPlanUpgrade()` adding those tags — is done and tested). Each POSTs to the same Vercel Deploy Hook. Recurring gotcha, hit more than once: **editing an already-published GHL workflow leaves the live version frozen at whatever was last published** — a new/changed trigger sits in an unpublished draft until you explicitly hit Publish again. Always the first thing to check when something "should be live but isn't."

**Five more GHL automations are spec'd, ready to build from `docs/ghl-ai-workflow-prompts.md`, status unconfirmed:** a new-self-signup internal notification, Google Reviews auto-backfill, agency-client auto-upgrade-to-Premium, cold-lead claim-invitation outreach, and outreach engagement tracking. The reviews-webhook one was previously blocked on the domain being connected — it isn't anymore, so that blocker is gone, but the workflow itself still needs to actually exist in GHL.

### What's shipped

**Front door + monetization (L1/L2/L4):** Homepage — now hero → **Today's Deals** (new) → Featured → Find Local Gems → category band → channels → add-your-business — `/listings`, `/category/[category]`, `/county/[county]` (+ `/county/[county]/[category]`, all seven counties), `/pricing`, `/about`, listing detail with a photo gallery lightbox (click a thumbnail to enlarge, scrollable strip), real brand-color social icons (Facebook/Instagram/X/LinkedIn/TikTok), a share button (native share sheet + clipboard fallback), and a "Visit website" CTA. Client-side search (Fuse.js). Category colour system (`src/lib/categories.ts`). `/claim` + `/add-business` write through `src/lib/submissions.ts` — `/add-business` now has a plan picker and paid tiers pay via Stripe as part of signup itself, see L2 above. Stripe checkout (mock-first, `docs/stripe-checkout.md`, now with `allow_promotion_codes`) and Google Reviews (see below) are both live. Every outbound link (website, socials, map/channel links) opens in a new tab (`target="_blank"`) so the directory tab never gets navigated away from.

**Owner self-serve editing + internal admin editor (`/manage`, `/manage/admin`) — much wider than before.** Paid-tier owners (claimed *or* pending — see L6/L2 above) sign in via passwordless magic-link (email must match the contact's native `email` field) and edit their own address/phone/email/website, description, photo gallery (upload/reorder/delete/set-cover via Vercel Blob), logo, two curated embeds (YouTube URL, booking URL — deliberately not raw HTML/script, XSS risk), up to 6 structured extra links, a special-offer coupon card (text + optional photo), and — new this session — team/events/news/blog entries (see L7). You can also edit **any** listing — claimed or not, any tier — at `/manage/admin` behind a shared `ADMIN_PASSWORD`, including an "Edit this listing" shortcut button on a listing's own page when logged in as admin. Auth lives in `src/lib/auth.ts` — HMAC-signed magic-link tokens (`purpose: "owner" | "consumer"` so the two can't be swapped) and session cookies, no users table.

**Per-listing content sections (L7) + Deals (L4), both new this session:** Team/events/news/blog render as sections on `business/[slug].astro`, each a list of entries (title/date/body + optional photo per entry), edited via a shared generic list-editor in `ListingEditForm.astro` (`makeEntriesController`) rather than four hand-duplicated ones. Stored as JSON in one GHL Multi-line field per type — see the data-contract note above. A special offer with a photo shows as a coupon card on the listing page and, new, in a homepage "Today's Deals" row (`DealCard.astro`) — "Get This Deal" links to the business's own website, falling back to their listing page.

**`/grow` — the agency retainer pitch, new this session:** custom website, review management, missed-call text-back, AI voice/chat agent — deliberately no price shown and no fixed packages (offerings are mixed/matched per business, not sold as tiers), ending in a short interest form rather than a checkout. Submissions create a new, separate `agency_lead`-tagged contact (`submitAgencyInterest()` in `submissions.ts`) for manual follow-up only — no automation fires on it. Linked from post-claim moments (`claim/thanks.astro`, `/manage`) and the footer, deliberately not primary nav or `/pricing` — see the golden rule on the agency retainer above.

**Address autocomplete + analytics, both new this session, both optional/absent-until-configured:** `/add-business`'s address field gets a Google Places search-as-you-type assist when `PUBLIC_GOOGLE_PLACES_API_KEY` is set (purely additive — the real `#address` input is a normal always-working text field regardless; see the "Autocomplete (New)" vs. legacy-widget pricing distinction in `docs/google-apis.md`, they are billed completely differently). Vercel Analytics (`<Analytics />` in `BaseLayout.astro`) runs unconditionally but still needs enabling in the Vercel dashboard's Analytics tab to actually collect anything; GA4 loads only once `PUBLIC_GA_MEASUREMENT_ID` is set, same absent-until-configured pattern as `PUBLIC_GHL_WIDGET_ID`.

**Consumer accounts (`/account`):** A *separate*, unlinked identity system for ordinary visitors — register/login (magic-link, same mechanism as owners but tagged `consumer` not `business`), follow/favorite listings (heart button on every listing card and the detail page), a profile page (avatar upload, followed-listings grid), logout. The header shows Login/Register vs. Profile/Logout (or Admin/Sign out, for an admin session) via a non-authoritative hint cookie read by a pre-paint script — the site stays fully static, no page had to become server-rendered just to show login state. See `docs/consumer-accounts.md` for why consumer accounts and owner/`/manage` access are deliberately NOT linked.

**Google Reviews, two complementary paths (`docs/google-apis.md`):** `scripts/import-reviews.mjs` is the scheduled refresh (manual/cron, never per-build — Place Details bills $40/1000 requests once `rating` is requested). New this session: `src/pages/api/webhooks/reviews.ts` auto-backfills a rating **once** the moment a listing becomes paid, triggered by a GHL workflow — it re-fetches the contact fresh from GHL (never trusts the webhook body), and is a permanent no-op once a listing already has a rating, so repeated workflow fires never re-bill. Listing cards now show rating + review count prominently under the business name (was previously buried in a small meta line).

**Rich-text descriptions (`src/lib/markdown.ts`):** `Listing.description` is markdown *source* (unchanged field/type — still a plain string), rendered safely wherever it's shown publicly. `markdown-it` (links, images, raw HTML, tables, blockquotes, code all disabled at the parser level, not just unrendered) → `sanitize-html` (strict tag allowlist, zero attributes) as a second, independent pass. Supports bold, headings (all levels normalized to one visual style via `.aeo-content` in `global.css`, since the page already has its own h1/h2), and bullet/numbered lists — **never a clickable link, even if the source contains markdown link syntax**, which is a deliberate product rule, not just a safety one. A derived plain-text form (`plainTextDescription()`, strips tags + decodes entities from the same rendered HTML — one source of truth, not a second parser) feeds `<meta description>`, OG/Twitter tags, JSON-LD, and the `ListingCard` preview, none of which can hold markup. The owner/admin editor (`ListingEditForm.astro`) has a one-click "Preview" button (`/api/manage/preview-description`, session-gated) that reuses the exact publish-time renderer — not live-as-you-type, a deliberate choice to avoid bundling the ~110KB renderer client-side.

**Dark theme, vector logo, real business data:** unchanged from before — light/dark toggle (`localStorage` + OS preference), transparent vector logo (`docs/brand-assets.md`), 138 real Central Florida businesses sourced via Google Places (`scripts/find-businesses.mjs`) with AEO descriptions (`docs/ai-descriptions.md`).

**TinaCMS — Phase 0 done, paused.** Not urgent, not abandoned. Plan saved at `~/.claude/plans/is-there-a-way-frolicking-hammock.md`. Scaffolding sits inert in the repo — **with one real gap found and fixed**: it silently broke every production build, including the first real Vercel deploy. `src/lib/islands.ts` hard-imports `tina/__generated__/client` — gitignored (regenerated by `tinacms dev`, never committed) and hardcoded to `http://localhost:4001/graphql` even when it exists, so it only ever worked on the one machine that had generated it locally. Fixed by disabling the one route that pulled it in (`src/pages/tina-island/[name].ts` → renamed `.ts.disabled`, so Astro's router ignores it) and removing `tina()`/`tinaAdminDevRedirect()` from `astro.config.mjs`. To resume: run `tinacms dev` to regenerate `tina/__generated__/`, rename the route back to `.ts`, re-add the integration/vite plugin.

### Known bugs fixed along the way (not just written and left)
1. **GHL read-path bug**: contact read responses only return `{id, value}` per custom field, and `fieldKey` comes back namespaced (`contact.business_name`), never stripped — every custom-field lookup was silently failing. Fixed in `fetchFromGHL()`/`getCustomFieldKeyMap()`.
2. **Pagination bug**: `contacts/search` caps at 100/page; the code never paginated past the first page, silently dropping the last 38 of 138 businesses. Fixed with `searchAfter`.
3. **County-matching bug**: `countyForAddress()` substring-matched the whole address, so a street name could collide with a real city name. Fixed to isolate the actual city first.
4. **Raster logo white spots**: fixed by switching to true vector tracing with global (not corner-flood) background removal.
5. **Vercel Blob uploads silently failing**: `@vercel/blob`'s SDK reads `process.env.BLOB_READ_WRITE_TOKEN` directly, but Astro's dev/SSR runtime only populates `import.meta.env` from `.env` — every upload/delete call now passes `token: import.meta.env.BLOB_READ_WRITE_TOKEN` explicitly rather than relying on the SDK's auto-detection.
6. **Placeholder domain live in production**: `site.origin`/`site.contactEmail` were `cflvybe.com`, not the actual purchased/connected `centralflvybe.com` — silently wrong canonical URLs, OG tags, and JSON-LD `@id` on every listing since the first deploy. Fixed in `site.ts`.
7. **Footer `&middot;` rendered as literal text, not `·`**: built via `site.towns.join(" &middot; ")` — a JS string inserted as text, so the HTML entity *name* never got interpreted, it just printed. Every other `&middot;` in the codebase is written directly in markup, not built as a string, which is why this was the only spot. Fixed by joining with the real `·` character instead of the entity name. Same edit also swapped the footer from `site.towns` (5 towns) to all seven counties, per a separate content request.
8. **Test data leaked into live GHL during a smoke test**: local `.env` has `DATA_SOURCE=ghl`, and a `curl` test against a local dev server for the new paid-signup flow didn't check that first — two fake contacts (`Test Coffee Co`, `Test Plumbing Pros`) got created and tagged `business` in the real account, briefly live on the real site. Found via the next `npm run build`'s prerendered-routes list, confirmed and deleted with a one-off script using `GHL_PIT_TOKEN`. See golden rule 4 above — this is the incident that rule now references.

### Known data gap, GHL-side not code
`business_name` and `scraped_address` are populated in **0 of 138** imported contacts — the original CSV import wizard didn't map those two columns to their custom fields (business name landed in the native First Name field instead). The app already falls back to GHL's native `companyName`/`firstName`/`address` fields so the site renders correctly regardless, but a re-import with those columns explicitly mapped would be cleaner.

### Repo facts worth knowing
- `.env.example` at the repo root documents every env var the project reads — trust it over prose elsewhere.
- Plain Node doesn't read `.env` automatically — `npm run import`/`reviews`/`find-businesses` all run via `node --env-file=.env <script>`. Give any new script the same flag — including a one-off script, e.g. the test-contact cleanup mentioned above.
- The site is no longer pure-static: `/manage/*`, `/account/*`, and `/api/*` are on-demand (`export const prerender = false`); every listing/category/county/marketing page stays static HTML.
- `docs/ghl-ai-workflow-prompts.md` holds copy-paste prompts for GoHighLevel's own AI workflow builder to construct (or reconstruct) all six current automations from scratch — written generically enough to reuse for a future market's sub-account, not just this one. `docs/ghl-layer-0.md` is still the canonical field/tag spec those prompts are drawn from.
- A plain-English, code-free **owner's operations manual** was written this session (how the site/GHL/Vercel/Stripe fit together, day-to-day tasks, troubleshooting) — published as a Claude.ai Artifact rather than a repo file, so it's reachable outside a coding session. Ask the owner for the link if a non-technical explanation of "how does this work" is ever needed; don't re-derive it from code when it already exists in plain language.

### Next (not yet decided — pick one)
- **Almost all originally-sourced businesses are still untagged (`business` removed) on purpose** — the owner hand-picks which go live rather than auto-publishing. Real go-forward plan: solicit businesses via Facebook posts pointing at `/add-business` (fully built, including paid signup now — see L2), plus hand-picking from the sourced list as desired.
- **Confirm `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `ADMIN_PASSWORD`, and now `PUBLIC_GA_MEASUREMENT_ID` are set in Vercel, not just locally.** Admin login was confirmed broken this session specifically because `ADMIN_PASSWORD` was missing in production — now set locally, Vercel unconfirmed. Also noticed locally: **`ADMIN_PASSWORD` and `AUTH_SECRET` are currently set to the identical value** — they do two unrelated jobs (login password vs. session-signing secret), and sharing a value means one leaking compromises both. Worth generating a second distinct value for one of them, not urgent.
- **Verify the six GHL automations in `docs/ghl-ai-workflow-prompts.md` are actually built AND published** — prompts exist, execution status in the live GHL account is unconfirmed. Includes the reviews-webhook workflow, previously blocked on the domain (no longer blocked, `centralflvybe.com` is connected) — `REVIEWS_WEBHOOK_SECRET` needs to be set in `.env`/Vercel once it exists.
- **L5 (AI agents)**: `ListingAgentWidget.astro` has no real backend yet; `ai_agent_enabled` needs to be manually flipped per business once a real agent is built for them.
- **Tighten `/claim` and `/upgrade`'s token**: both use the raw GHL contact id as `?t=` today. Fine for testing; needs to become an unguessable token before either goes out in real outreach — more urgent now that self-signup + outreach are both live.
- **TinaCMS**: resume per the saved plan whenever site-wide visual editing becomes a priority — not before.
- **The site-wide content hub** (`/blog`, `/events`, etc. — distinct from the per-listing sections that shipped this session) is still what `site.exploreLinks`' `enabled: false` flags are reserved for. Confirm before building; see L7 above.
- **Verify the `submitAddBusiness()` → Create Contact response shape** against a real paid signup (or Stripe test mode) — the code assumes `{ contact: { id } }` but this was never checked against a live call; if wrong, a real payment could succeed while the webhook fails to find the contact to activate.
- **Card/detail-page layout tweaks**: the owner mentioned sending a reference screenshot for further placement adjustments — not yet received/actioned.

---

## Development

Node `>=22.12.0` is required (`engines` in `package.json`).

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

| Command | Action |
|---|---|
| `npm install` | Install dependencies |
| `npm run build` | Production build to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run astro check` | Typecheck — **requires `npm i -D @astrojs/check typescript` first**; neither is currently a dependency, so the command prompts to install them |
| `npm run import -- file.csv` | Seed `data/mock-listings.json` from a scraped CSV and emit a GHL-ready import CSV to `out/`. Add `--premium "A\|B"` / `--featured "C\|D"` to set tiers, `--no-ai-descriptions` to skip Claude-written descriptions. See `docs/ghl-layer-0.md` and `docs/ai-descriptions.md`. |
| `npm run find-businesses -- --default` | Source real local businesses via Google Places Text Search into `out/sourced-businesses.csv`, ready for the command above. See `docs/google-apis.md`. |
| `npm run reviews` | Refresh Google ratings for paid listings only (never on every build). See `docs/google-apis.md`. |

**There is no lint, test, or formatter tooling in this repo, and no typechecker installed.** `npm run build` is the only verification step that works out of the box — don't assume a test runner exists or invent commands for one.

## Repo facts (discovered from config, not obvious from any single file)

- **Tailwind v4, and there is no config file.** Wired via `@tailwindcss/vite` in `astro.config.mjs` plus `@import "tailwindcss";` in `src/styles/global.css`. Do **not** create `tailwind.config.js` — v4 is CSS-first; customize with `@theme` inside `global.css`.
- **Every page uses `layouts/BaseLayout.astro`.** It owns `<head>`/SEO tags, the header, the footer, and the widget-routing rule (`widget` prop, default `"directory"`). A new page should almost never hand-roll `<html>` — wrap it in `BaseLayout` instead, or the widget rule silently breaks (see the bug note in Current Status above).
- **Hybrid, not pure static.** `astro.config.mjs` now carries `adapter: vercel()`, added for Layer 2. Deliberately **no `output: 'server'`** — the default `'static'` mode still prerenders everything, and the adapter only enables `export const prerender = false` on the specific routes that need it: `/claim` (needs a live per-request listing lookup) and the two `/api/*` write endpoints. Every listing/category/county page stays static HTML. Adding a new on-demand route means adding that export; it does not change how anything else builds.
- **Astro's CSRF protection is on by default** (`security.checkOrigin`, true since Astro v5) and will 403 any POST whose `Origin` doesn't match the request host — this is why `curl`-ing `/api/claim` needs an explicit `-H "Origin: ..."` to test, while a real `<form method="POST">` from a browser works with no extra config. Do not set `security.checkOrigin: false` to make testing easier; that removes real protection on routes that write to GHL.
- **Anti-spam today is a honeypot only**, not reCAPTCHA — wiring reCAPTCHA needs a Google site/secret key pair this project doesn't have yet. Both forms have a `name="hp"` field hidden off-screen (not `display:none`, which some bots skip); a filled value redirects to the same success page a real submission gets, so nothing in the response teaches a bot what tripped it.
- **`.env` exists locally** (gitignored, not committed). **`.env.example` at the repo root documents every var the project reads** (GHL, Stripe, Google Places, Anthropic, Tina) — copy it and fill in only what the feature you're touching needs. A fresh clone with no `.env` at all still builds and runs, since `directory.ts` falls back to `"mock"`. Plain Node doesn't read `.env` automatically — scripts that need it (`import`, `reviews`, `find-businesses`) run via `node --env-file=.env` in their `package.json` script definitions; give a new script the same flag or it'll silently see no env vars.
- **`README.md` is still the stock Astro minimal-starter boilerplate** and does not describe this project — don't treat it as a source of truth.

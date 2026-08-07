# Project: Local Business Directory (Smart-Directory-style lead engine)

## What this is
A great-looking local business **directory** that doubles as a lead-generation and sales engine. Businesses get added (via GoHighLevel), appear as listings, are invited to **claim** their listing for free, and are then upsold: a paid **Featured** listing, and ultimately monthly **agency services**. One directory = one market (e.g. "Space Coast", "Central Florida").

**Stack:** Astro + Tailwind (v4) + TypeScript, deployed on Vercel. GoHighLevel (GHL) is the CRM/backend.

## Golden rules (do not break these)
1. **GHL is the single source of truth for listing data.** The front end reads it and writes back to it. Do NOT introduce a separate database.
2. **All data access goes through `src/lib/directory.ts`.** Import `getListings`, `getListingBySlug`, `getFeaturedListings`, `getListingsByCategory`. Never fetch GHL or read the mock JSON directly from a page/component.
3. **Do not change the data contract** in `src/types/listing.ts` or the public function signatures in `src/lib/directory.ts` without flagging it first.
4. **Currently `DATA_SOURCE=mock`** (see `.env`) — everything must keep working on mock data. GHL wiring happens later by filling in `fetchFromGHL()`; nothing else should change when we flip to `ghl`.
5. **Astro gotcha:** never put HTML comments (`<!-- -->`) inside template/JSX expressions — it breaks the compiler. Keep comments in the `---` frontmatter.
6. **Build in layers, in order. Do not build deferred (Layer 6+) features early.** Ask before scope-jumping.
7. **Design must be distinctive, not templated** (see Design rules). Avoid the generic-directory look.

## Architecture
```
Astro pages (static/SSG — great SEO)
   → src/lib/directory.ts  (data layer; mock now, GHL later)
   → [later] Vercel serverless API routes (hold the GHL key server-side; handle claim/add/agent)
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
Defined in `src/types/listing.ts`. Key fields: `slug`, `businessName`, `category`, `description`, `address`, `county` (optional), `phone`, `website`, `rating`, `reviewCount`, `imageUrls`, `hours`, `socialLinks`, `planTier` (`free`|`featured`|`premium`), `claimStatus`, `aiContext`, `agencyClient`, `clientLocationId`.

Tier logic lives in three exported helpers there — `isPaidTier`, `hasListingAgent`, `tierRank` — so no page branches on a raw string. Adding a fourth plan should mean editing those and `site.plans`, nothing else.

## The tiers (drives everything)
**Value policy (overrides the old "basic free listing" split):** a free listing is a real, complete, useful page — full description, map, hours, phone, website, social links and `LocalBusiness` structured data. We do **not** cripple free pages to manufacture upgrades. The directory has to be worth linking to on its own merits or the whole foot-in-the-door premise collapses. Featured sells *placement and reach*, not access to the basics.

**Three directory plans**, sold on `/pricing`. Names/prices/feature matrix all live in `site.plans` + `site.planFeatures`; the `id` is the `PlanTier` value and the GHL `plan_tier` field, so marketing can rename a plan without touching data.

| `PlanTier` | Plan | Price | Listing | AI agent on their page |
|---|---|---|---|---|
| `free` | **Day Pass** | $0 forever | Full page: description, hours, phone, website, socials, schema, claim button | Directory-wide chat (shared) |
| `featured` | **Spotlight** | $250 / yr | + Google reviews & map, gallery, blog/events/news/jobs, team, offers, top placement | Directory-wide chat (shared) |
| `premium` | **All Access** | $699 / yr | + AI review response, promo video, everything | **Own text agent** (our Vercel LLM widget, cost-capped in code) |

**The GHL agency retainer ($297–597/mo) is sold separately and must never appear on `/pricing`.** That conversation happens after a claim; the directory page sells the directory only.

**Map is free on every tier; Google reviews are gated — and that split is about cost, not packaging.** The Maps Embed API is free with unlimited requests, so withholding a map from a free listing would cost us nothing and buy us nothing. Places API Place Details with `reviews`/`rating` bills at **$40 per 1,000 requests**, which is $120 per refresh across 3,000 listings versus ~$2 across the paid ones. Do not "fix" the apparent inconsistency by adding a map row to `site.planFeatures` — see `docs/google-apis.md`.

## The widget routing rule (never two chat widgets on one page)
Exactly ONE widget per page, decided by tier:
- Home, all non-listing pages, **Day Pass** and **Spotlight** listings → **directory-wide** assistant.
- **All Access** listing → **custom per-listing text agent** only (directory-wide widget suppressed).
- **Agency-client** listing → **GHL Voice AI** agent (Layer 5).

Note the boundary: "AI agent for your listing" is an All Access feature on `/pricing`, so **Spotlight does not get its own agent**. `hasListingAgent()` in `src/types/listing.ts` is the single place that decides this — change it there, nowhere else. `BaseLayout` owns mounting the directory-wide widget, which is what makes "never two" structural rather than something each new page has to remember.

## Build layers (the roadmap)
- **L0 — GHL foundation** (done by the owner, manual): sub-account, custom fields, tags, API token.
- **L1 — Front door: done.** Homepage, listings grid, category pages, county pages, client-side search (Fuse.js), pricing, and listing-detail (cover image, socials row, Claimed badge, Google Map embed, hours table).
- **L2 — Claim + add-business: done.** `/claim` (live lookup by `?t=` listing id, pre-filled, unchecked TCPA consent, already-claimed state) and `/add-business` (static form, free-text category with a datalist of known categories) both POST to on-demand `/api/claim` and `/api/add-business`, which write through `src/lib/submissions.ts`. A claim updates the existing contact; an add-business submission creates one tagged `new_business_request` — **not** `business` — so it stays off the live directory until reviewed. Both record all four `tcpa_*` fields every time, consent given or not. Newsletter capture is not yet built.
- **L3 — Outreach:** built in GHL (email/SMS honeypot sequence). No front-end work.
- **L4 — Monetization: mostly done.** Stripe checkout (mock-first, real once keys are set — `docs/stripe-checkout.md`) and Google Reviews import (`docs/google-apis.md`) are both built. **Deals/coupons** (deal cards on home + on listing → "Get This Deal" links to business site) is not started.
- **L5 — AI agents: partially built.** The per-listing text agent widget routes correctly (`hasListingAgent()` requires Premium tier AND a manually-flipped `ai_agent_enabled` field — Premium alone no longer shows an agent with nothing behind it), but `ListingAgentWidget.astro` has no real backend yet. Outbound "courtesy call" (GHL Voice AI / Vapi) is not started.
- **L6 — Consumer accounts + owner self-manage: built**, pulled forward ahead of L3 outreach at the owner's request. Passwordless magic-link auth (`src/lib/auth.ts`), no users table, GHL contact is the source of truth — see `docs/consumer-accounts.md`. Owner self-serve editing (`/manage`), an internal admin editor (`/manage/admin`), and consumer register/login/follow/profile (`/account`) are all live — see "Current status" below for the full breakdown. The site is no longer pure-static: `astro.config.mjs`'s Vercel adapter now backs a real set of on-demand routes.
- **L7 — Defer until traction:** business content types (blogs, news, jobs, events) with conditional menu items.

## Design rules
Distinctive, not the generic directory template. **Avoid:** warm-cream + serif + terracotta; near-black + one acid accent; purple/blue gradients; glassmorphism; the centered-headline-two-buttons hero; three rounded cards with outline icons; stock photos of strangers. **Do:** a strong hero (map-anchored or editorial masthead work well for a community directory), a real type scale with a confident pairing, one bold signature element, everything else quiet. Mobile-first.

**Brand:** the first market is **Central FL Vybe** — *Vybe with a Y is deliberate. Never correct it to "Vibe" anywhere.* Palette is lifted from the logo: coral `#ee5a3c` (wordmark + skyline), amber `#efb02a` (sun), teal `#33a399` (palm), deep teal-navy `#17414b` (the "Central FL" mark, used as the site's ink).

**As built:** near-white paper, oversized display type, flat saturated colour blocking. The signature element is the **category hue** — every category owns one of nine colours (`src/lib/categories.ts`), following it through card marks, index rows, chips and page accents. Assignment hashes the name then probes past collisions across the whole category set, so imported categories get a distinct colour automatically; the three brand hues are used first. Hue classes are authored CSS in `styles/global.css` (`.hue-coral` …) which is why building the class name dynamically is safe. One motion in the system: cards lift on hover, honouring `prefers-reduced-motion`.

## Current status (as of this session — read this first)

**GHL Layer 0 is done and live — `DATA_SOURCE=ghl` works against a real sub-account with 138 real businesses.** L1, L2, and L4 are built. L6 (consumer accounts + owner self-manage) is built too, pulled forward ahead of L3. L5 is partially built (per-listing agent routing exists, no real agent backend yet). L3 (outreach workflows) is the main gap — it's GHL-dashboard-only work, not blocked on any code here.

**The site is live on Vercel**, imported from GitHub (`github.com/MarzLeBran/Central-FL-Vybe`, `main` branch). First deploy failed silently (see the TinaCMS entry below) — fixed and confirmed working from a genuinely fresh clone, not just local. Currently serving on Vercel's default `*.vercel.app` domain; the purchased custom domain is bought but deliberately not connected yet. GHL live-sync is also wired up: a GHL workflow ("Directory Live Sync," trigger on Contact Tag Added/Removed for `business`) POSTs to a Vercel Deploy Hook, so adding/removing the `business` tag now triggers a rebuild automatically — confirm it's actually scoped to the `business` tag specifically (not left open to any tag) before trusting it. The reviews-webhook workflow (separate from this one) is still intentionally not set up — see Next.

### What's shipped

**Front door + monetization (L1/L2/L4):** Homepage, `/listings`, `/category/[category]`, `/county/[county]` (+ `/county/[county]/[category]`, all seven counties), `/pricing`, `/about`, listing detail with a photo gallery lightbox (click a thumbnail to enlarge, scrollable strip), real brand-color social icons (Facebook/Instagram/X/LinkedIn/TikTok), a share button (native share sheet + clipboard fallback), and a "Visit website" CTA. Client-side search (Fuse.js). Category colour system (`src/lib/categories.ts`). `/claim` + `/add-business` write through `src/lib/submissions.ts`. Stripe checkout (mock-first, `docs/stripe-checkout.md`) and Google Reviews (see below) are both live. Every outbound link (website, socials, map/channel links) opens in a new tab (`target="_blank"`) so the directory tab never gets navigated away from.

**Owner self-serve editing + internal admin editor (`/manage`, `/manage/admin`):** Claimed, paid-tier owners sign in via passwordless magic-link (email must match the contact's native `email` field, set at claim time) and edit their own description, photo gallery (upload/reorder/delete/set-cover via Vercel Blob), logo, and two curated embeds (YouTube URL, booking URL — deliberately not raw HTML/script, XSS risk). You can also edit **any** listing — claimed or not, any tier — at `/manage/admin` behind a shared `ADMIN_PASSWORD`, including a "Edit this listing" shortcut button that appears directly on a listing's own page when you're logged in as admin (no need to search for it). Auth lives in `src/lib/auth.ts` — HMAC-signed magic-link tokens (`purpose: "owner" | "consumer"` so the two can't be swapped) and session cookies, no users table.

**Consumer accounts (`/account`):** A *separate*, unlinked identity system for ordinary visitors — register/login (magic-link, same mechanism as owners but tagged `consumer` not `business`), follow/favorite listings (heart button on every listing card and the detail page), a profile page (avatar upload, followed-listings grid), logout. The header shows Login/Register vs. Profile/Logout (or Admin/Sign out, for an admin session) via a non-authoritative hint cookie read by a pre-paint script — the site stays fully static, no page had to become server-rendered just to show login state. See `docs/consumer-accounts.md` for why consumer accounts and owner/`/manage` access are deliberately NOT linked.

**Google Reviews, two complementary paths (`docs/google-apis.md`):** `scripts/import-reviews.mjs` is the scheduled refresh (manual/cron, never per-build — Place Details bills $40/1000 requests once `rating` is requested). New this session: `src/pages/api/webhooks/reviews.ts` auto-backfills a rating **once** the moment a listing becomes paid, triggered by a GHL workflow — it re-fetches the contact fresh from GHL (never trusts the webhook body), and is a permanent no-op once a listing already has a rating, so repeated workflow fires never re-bill. Listing cards now show rating + review count prominently under the business name (was previously buried in a small meta line).

**Rich-text descriptions (`src/lib/markdown.ts`):** `Listing.description` is markdown *source* (unchanged field/type — still a plain string), rendered safely wherever it's shown publicly. `markdown-it` (links, images, raw HTML, tables, blockquotes, code all disabled at the parser level, not just unrendered) → `sanitize-html` (strict tag allowlist, zero attributes) as a second, independent pass. Supports bold, headings (all levels normalized to one visual style via `.aeo-content` in `global.css`, since the page already has its own h1/h2), and bullet/numbered lists — **never a clickable link, even if the source contains markdown link syntax**, which is a deliberate product rule, not just a safety one. A derived plain-text form (`plainTextDescription()`, strips tags + decodes entities from the same rendered HTML — one source of truth, not a second parser) feeds `<meta description>`, OG/Twitter tags, JSON-LD, and the `ListingCard` preview, none of which can hold markup. The owner/admin editor (`ListingEditForm.astro`) has a one-click "Preview" button (`/api/manage/preview-description`, session-gated) that reuses the exact publish-time renderer — not live-as-you-type, a deliberate choice to avoid bundling the ~110KB renderer client-side.

**Dark theme, vector logo, real business data:** unchanged from before — light/dark toggle (`localStorage` + OS preference), transparent vector logo (`docs/brand-assets.md`), 138 real Central Florida businesses sourced via Google Places (`scripts/find-businesses.mjs`) with AEO descriptions (`docs/ai-descriptions.md`).

**TinaCMS — Phase 0 done, paused.** Not urgent, not abandoned. Plan saved at `~/.claude/plans/is-there-a-way-frolicking-hammock.md`. Scaffolding sits inert in the repo — **with one real gap found and fixed**: it silently broke every production build, including the first real Vercel deploy. `src/lib/islands.ts` hard-imports `tina/__generated__/client` — gitignored (regenerated by `tinacms dev`, never committed) and hardcoded to `http://localhost:4001/graphql` even when it exists, so it only ever worked on the one machine that had generated it locally. Fixed by disabling the one route that pulled it in (`src/pages/tina-island/[name].ts` → renamed `.ts.disabled`, so Astro's router ignores it) and removing `tina()`/`tinaAdminDevRedirect()` from `astro.config.mjs`. To resume: run `tinacms dev` to regenerate `tina/__generated__/`, rename the route back to `.ts`, re-add the integration/vite plugin.

### Known bugs fixed this session (not just written and left)
1. **GHL read-path bug**: contact read responses only return `{id, value}` per custom field, and `fieldKey` comes back namespaced (`contact.business_name`), never stripped — every custom-field lookup was silently failing. Fixed in `fetchFromGHL()`/`getCustomFieldKeyMap()`.
2. **Pagination bug**: `contacts/search` caps at 100/page; the code never paginated past the first page, silently dropping the last 38 of 138 businesses. Fixed with `searchAfter`.
3. **County-matching bug**: `countyForAddress()` substring-matched the whole address, so a street name could collide with a real city name. Fixed to isolate the actual city first.
4. **Raster logo white spots**: fixed by switching to true vector tracing with global (not corner-flood) background removal.
5. **Vercel Blob uploads silently failing**: `@vercel/blob`'s SDK reads `process.env.BLOB_READ_WRITE_TOKEN` directly, but Astro's dev/SSR runtime only populates `import.meta.env` from `.env` — every upload/delete call now passes `token: import.meta.env.BLOB_READ_WRITE_TOKEN` explicitly rather than relying on the SDK's auto-detection.

### Known data gap, GHL-side not code
`business_name` and `scraped_address` are populated in **0 of 138** imported contacts — the original CSV import wizard didn't map those two columns to their custom fields (business name landed in the native First Name field instead). The app already falls back to GHL's native `companyName`/`firstName`/`address` fields so the site renders correctly regardless, but a re-import with those columns explicitly mapped would be cleaner.

### Repo facts worth knowing
- `.env.example` at the repo root documents every env var the project reads — trust it over prose elsewhere.
- Plain Node doesn't read `.env` automatically — `npm run import`/`reviews`/`find-businesses` all run via `node --env-file=.env <script>`. Give any new script the same flag.
- The site is no longer pure-static: `/manage/*`, `/account/*`, and `/api/*` are on-demand (`export const prerender = false`); every listing/category/county/marketing page stays static HTML.

### Next (not yet decided — pick one)
- **Connect the custom domain in Vercel** once ready — deliberately deferred so far, site is live on the default `*.vercel.app` URL in the meantime.
- **Set Vercel's production env vars** — confirm `DATA_SOURCE=ghl`, `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `ADMIN_PASSWORD` are all set in Vercel's project settings (not just local `.env`) so the deployed site actually serves live GHL data and owner/admin editing works there too — not yet confirmed done.
- **Reviews-webhook GHL workflow** (`docs/ghl-layer-0.md` § "Auto-backfilling Google ratings on upgrade") — intentionally not set up yet, was deferred until the custom domain is connected (the webhook URL is domain-dependent, unlike the Deploy Hook). `REVIEWS_WEBHOOK_SECRET` also needs to be set in `.env` and Vercel once it's built.
- **L3 (outreach)** is GHL workflows only — no front-end code; a suggested skeleton is in `docs/ghl-layer-0.md`.
- **L5 (AI agents)**: `ListingAgentWidget.astro` has no real backend yet; `ai_agent_enabled` needs to be manually flipped per business once a real agent is built for them.
- **Tighten `/claim` and `/upgrade`'s token**: both use the raw GHL contact id as `?t=` today. Fine for testing; needs to become an unguessable token before either goes out in real outreach.
- **TinaCMS**: resume per the saved plan whenever site-wide visual editing becomes a priority — not before.
- **Deals/coupons** (the one unbuilt piece of L4).
- **Card/detail-page layout tweaks**: the user mentioned sending a reference screenshot for further placement adjustments — not yet received/actioned.

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

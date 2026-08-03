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
- **L5 — AI agents:** the tiered agents above + outbound "courtesy call" (GHL Voice AI / Vapi) triggered when a consented claim happens.
- **L6 — Consumer accounts + owner self-manage:** register / sign in / profile, follow businesses, internal "Leave a Review", owner dashboard. **Committed, spec'd in `docs/consumer-accounts.md`** — read it before starting: it settles passwordless magic-link auth (the reference emails plaintext passwords; do not copy that), and it is the point where the site stops being static-only.
- **L7 — Defer until traction:** business content types (blogs, news, jobs, events) with conditional menu items.

## Design rules
Distinctive, not the generic directory template. **Avoid:** warm-cream + serif + terracotta; near-black + one acid accent; purple/blue gradients; glassmorphism; the centered-headline-two-buttons hero; three rounded cards with outline icons; stock photos of strangers. **Do:** a strong hero (map-anchored or editorial masthead work well for a community directory), a real type scale with a confident pairing, one bold signature element, everything else quiet. Mobile-first.

**Brand:** the first market is **Central FL Vybe** — *Vybe with a Y is deliberate. Never correct it to "Vibe" anywhere.* Palette is lifted from the logo: coral `#ee5a3c` (wordmark + skyline), amber `#efb02a` (sun), teal `#33a399` (palm), deep teal-navy `#17414b` (the "Central FL" mark, used as the site's ink).

**As built:** near-white paper, oversized display type, flat saturated colour blocking. The signature element is the **category hue** — every category owns one of nine colours (`src/lib/categories.ts`), following it through card marks, index rows, chips and page accents. Assignment hashes the name then probes past collisions across the whole category set, so imported categories get a distinct colour automatically; the three brand hues are used first. Hue classes are authored CSS in `styles/global.css` (`.hue-coral` …) which is why building the class name dynamically is safe. One motion in the system: cards lift on hover, honouring `prefers-reduced-motion`.

## Current status (as of this session — read this first)

**L1, L2, and (mostly) L4 are built. GHL Layer 0 (the owner's manual sub-account setup) is in progress in a separate Claude Project conversation, not this one — nothing here is blocked on it except actually flipping `DATA_SOURCE=ghl`.**

### What's shipped
- **L1 — front door.** Homepage, `/listings`, `/category/[category]`, `/county/[county]` + `/county/[county]/[category]` (all seven counties), `/pricing` (three tiers), listing detail. Client-side search (Fuse.js). Category colour system (`src/lib/categories.ts`).
- **L2 — claim + add-business.** `/claim?t={contactId}` (live lookup, TCPA consent, honeypot) and `/add-business` both POST to on-demand API routes that write through `src/lib/submissions.ts`, mirroring `directory.ts`'s `DATA_SOURCE` pattern.
- **L4 — Stripe checkout + Google Reviews.** `/upgrade?t=…&plan=…` → `/api/checkout` → `src/lib/checkout.ts` — mock-first (no Stripe keys = upgrade applies immediately, no real payment), real once `STRIPE_*` env vars are set (`docs/stripe-checkout.md`). `scripts/import-reviews.mjs` pulls Google ratings for paid listings only, cached, never per-build (`docs/google-apis.md`).
- **Dark theme.** A light/dark toggle in the header, persisted via `localStorage`, defaulting to OS preference. The palette inverts the brand's own two colours (deep teal-navy ↔ cream) rather than a generic near-black — see the `[data-theme="dark"]` block in `src/styles/global.css`.
- **Vector logo.** `public/logo.svg` / `logo-tagline.svg` replace the old raster PNGs — fully transparent (no white plate, no white "spots" inside letter counters), traced from the source art by `scripts/prep-brand-assets.py`. See `docs/brand-assets.md`.
- **Real business data.** `scripts/find-businesses.mjs` sources real Central Florida businesses via Google Places Text Search (ToS-compliant — never scrapes Google Maps directly). `scripts/import-listings.mjs` now also: supports `--premium` (there was previously no way to produce a Premium-tier listing at all, only Free/Featured), and generates **AEO-optimized descriptions via Claude** for any listing that arrives without one, using only verified facts — no invented specialties/awards/history (`docs/ai-descriptions.md`). `src/data/mock-listings.json` currently holds 138 real, sourced businesses (3 Premium, 3 Featured, spread across counties/categories as a claim-flow showcase).
- **TinaCMS — Phase 0 done, then paused.** User wants a visual CMS for site-wide branding/copy/colors eventually, explicitly **not urgent right now** ("we just got to get the site working and clients in") — deferred, not abandoned. Phase 0 (prove contextual/click-to-edit editing works on this static site before building the rest) is done and validated end-to-end locally: edited a field by clicking it in a live preview inside `/admin`, saved, watched the underlying content file change on disk. The full phased plan is saved at `~/.claude/plans/is-there-a-way-frolicking-hammock.md` (also copied into the summary of the session that built it). Scaffolding sits inert in the repo (`tina/`, `src/lib/islands.ts`, `src/components/islands/`, `src/pages/tina-island/`, the `@tinacms/*`/`tinacms` deps, `astro.config.mjs`'s `tina()` integration) — doesn't affect the live site, nothing to do with it until you pick the plan back up.

### Known bugs fixed this session (not just written and left)
1. **GHL read-path bug** (in `directory.ts`, flagged but unfixed for a while): GHL's contact read responses only return `{id, value}` per custom field, never the `key` set in Layer 0. `fetchFromGHL()` now calls `GET /locations/:locationId/customFields` once per build, caches an id→key map, and resolves through it. The write path (`submissions.ts`) never had this problem.
2. **County-matching bug** (in both `src/lib/counties.ts` and the importer's own copy): `countyForAddress()` substring-matched the **whole address**, so a business on "S Orlando Dr" in Sanford got misfiled under Orange County — the street name collided with a real city name. Fixed to isolate the actual city from `"..., City, ST 12345[, Country]"` before matching, falling back to the old whole-string behavior only when that shape isn't found.
3. **Raster logo white spots**: the old brand-asset pipeline (`cut_outer_white`) only flood-filled transparency from the four corners, so background trapped *inside* a letter counter (a gap in a "B", "e", "a") stayed opaque white — invisible on a light page, visible once the site got a dark theme. Fixed by switching the two lockups to true vector tracing with a global (not corner-flood) background removal.

### Repo facts worth knowing (superseded lines in "Repo facts" below)
- **`.env.example` now exists** at the repo root, documenting every env var the project reads (GHL, Stripe, Google Places, Anthropic, Tina) — the "Repo facts" section below predates this and says otherwise; trust `.env.example`.
- Local dev/scripts: `astro dev --background` still applies; **new env-loading gotcha** — plain Node doesn't read `.env` automatically, so `npm run import`/`reviews`/`find-businesses` all now run via `node --env-file=.env <script>` (see each script's line in `package.json`). If you add a new script that reads `process.env.*`, give it the same flag or it'll silently see nothing.

### Next (not yet decided — pick one)
- **GHL Layer 0** is in progress elsewhere (a separate Claude Project chat, per the user) — once the sub-account/fields/tags/token exist, import `out/ghl-import.csv` (already generated, includes real descriptions + Place IDs for all 138 sourced businesses) and flip `DATA_SOURCE=ghl`.
- **L3 (outreach)** is GHL workflows only — no front-end code; needs Layer 0 first. `docs/ghl-layer-0.md` has a suggested workflow skeleton built on the tags already in the code.
- **L5 (AI agents)**: the per-listing agent widget already routes correctly (`hasListingAgent()`), but `ListingAgentWidget.astro` has no real backend yet.
- **Tighten `/claim` and `/upgrade`'s token**: both use the raw GHL contact id as `?t=` today. Fine for testing; needs to become an unguessable token before either goes out in real outreach.
- **TinaCMS**: resume per the saved plan whenever site-wide visual editing becomes a priority — not before.
- **Deals/coupons** (the one unbuilt piece of L4).

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

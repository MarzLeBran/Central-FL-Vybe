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
- **L1 — Front door (NOW):** homepage (hero → deals row → featured row → category tiles → newsletter capture), listings grid, category pages, client-side search (Fuse.js), and listing-detail polish (cover image, socials row, Claimed badge, Google Map embed, hours table).
- **L2 — Claim + add-business:** claim page (pre-filled + unchecked TCPA consent), add-business form, newsletter capture → all POST to Vercel functions that write to GHL. Admin approves in GHL.
- **L3 — Outreach:** built in GHL (email/SMS honeypot sequence). No front-end work.
- **L4 — Monetization:** Featured plan/Stripe, **Deals/coupons** system (deal cards on home + on listing → "Get This Deal" links to business site), **Google reviews** import via Places API (agency feature).
- **L5 — AI agents:** the tiered agents above + outbound "courtesy call" (GHL Voice AI / Vapi) triggered when a consented claim happens.
- **L6 — Consumer accounts + owner self-manage:** register / sign in / profile, follow businesses, internal "Leave a Review", owner dashboard. **Committed, spec'd in `docs/consumer-accounts.md`** — read it before starting: it settles passwordless magic-link auth (the reference emails plaintext passwords; do not copy that), and it is the point where the site stops being static-only.
- **L7 — Defer until traction:** business content types (blogs, news, jobs, events) with conditional menu items.

## Design rules
Distinctive, not the generic directory template. **Avoid:** warm-cream + serif + terracotta; near-black + one acid accent; purple/blue gradients; glassmorphism; the centered-headline-two-buttons hero; three rounded cards with outline icons; stock photos of strangers. **Do:** a strong hero (map-anchored or editorial masthead work well for a community directory), a real type scale with a confident pairing, one bold signature element, everything else quiet. Mobile-first.

**Brand:** the first market is **Central FL Vybe** — *Vybe with a Y is deliberate. Never correct it to "Vibe" anywhere.* Palette is lifted from the logo: coral `#ee5a3c` (wordmark + skyline), amber `#efb02a` (sun), teal `#33a399` (palm), deep teal-navy `#17414b` (the "Central FL" mark, used as the site's ink).

**As built:** near-white paper, oversized display type, flat saturated colour blocking. The signature element is the **category hue** — every category owns one of nine colours (`src/lib/categories.ts`), following it through card marks, index rows, chips and page accents. Assignment hashes the name then probes past collisions across the whole category set, so imported categories get a distinct colour automatically; the three brand hues are used first. Hue classes are authored CSS in `styles/global.css` (`.hue-coral` …) which is why building the class name dynamically is safe. One motion in the system: cards lift on hover, honouring `prefers-reduced-motion`.

## Current status
**Layer 1 front door is built.** `layouts/BaseLayout.astro` (owns head/SEO, masthead, footer, and the widget routing rule), `config/site.ts` (per-market config — the only file to change for a new city), `components/ListingCard.astro`, home page (masthead → featured row → category index → claim strip), `/listings` grid, `/category/[category]` pages, and a polished listing detail with `LocalBusiness` JSON-LD including `aggregateRating`. Design system lives in `styles/global.css` as Tailwind v4 `@theme` tokens.

`npm run import -- file.csv` seeds `data/mock-listings.json` **and** emits a GHL-ready contact CSV (`out/ghl-import.csv`) — see `docs/ghl-layer-0.md` for the GHL side and the First Name trap.

**Next:** client-side search (Fuse.js, not yet installed), then Layer 2 claim + add-business.

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

**There is no lint, test, or formatter tooling in this repo, and no typechecker installed.** `npm run build` is the only verification step that works out of the box — don't assume a test runner exists or invent commands for one.

## Repo facts (discovered from config, not obvious from any single file)

- **Tailwind v4, and there is no config file.** Wired via `@tailwindcss/vite` in `astro.config.mjs` plus `@import "tailwindcss";` in `src/styles/global.css`. Do **not** create `tailwind.config.js` — v4 is CSS-first; customize with `@theme` inside `global.css`.
- **No shared layout yet.** Every page hand-rolls its own `<html>`, and `global.css` is imported per-page (currently only in `pages/business/[slug].astro` — `index.astro` does not import it). A `src/layouts/` base layout is the natural first move in Layer 1; otherwise each new page must remember the stylesheet import.
- **Static-only today.** `astro.config.mjs` sets no `output` mode and no adapter, so the build is pure SSG. Layer 2's Vercel functions will require adding `@astrojs/vercel` and switching output mode — that's a real config change, not just new files.
- **Fuse.js is not installed.** Layer 1 search will need it added.
- **`.env` is gitignored and there is no `.env.example`.** A fresh clone has no `.env`; `directory.ts` falls back to `"mock"`, so it still builds and runs.
- **`README.md` is still the stock Astro minimal-starter boilerplate** and does not describe this project — don't treat it as a source of truth.

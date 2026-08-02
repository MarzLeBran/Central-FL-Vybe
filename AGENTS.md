# Directory Build — Architecture & Layered Plan (Path B)

**Goal:** a great-looking local business directory where adding a client in GHL creates a listing, businesses claim their listing (giving TCPA consent), and we sell services on the back end — functionally similar to Smart Directory AI, built on our own stack instead of buying the app.

**Stack:** Astro + Tailwind + TypeScript (front end) · Vercel serverless (API layer) · GoHighLevel sub-account (CRM/outreach/payments/agents) · Claude Code (to build the custom app) · GHL AI (where it helps).

---

## 1. The honest reframe (noise removed)

What Smart Directory AI actually is, technically: a JavaScript listing app that reads/writes a HighLevel sub-account's contacts and renders directory pages. The expensive parts of Tom's build were **productization** — multi-tenancy (thousands of installs), billing, an admin UI, and support — none of which apply to us. We're building single-tenant directories we own.

The three parts that are genuinely non-trivial, named honestly, and how we handle each:

| Real challenge | How we solve it |
|---|---|
| **Two sources of truth** (front end vs CRM drifting apart) | GHL is the *only* source of truth. Front end reads from it and writes back to it. No separate DB. |
| **Claim write-back** (a claim must update the CRM + capture consent) | A single Vercel serverless function that validates the form and writes to the GHL API (tags + custom fields). |
| **Owner login/dashboard** (the piece that adds the most code) | **Deferred out of v1.** Claims are approved by you in GHL, exactly like Tom's "submissions → approve." Add magic-link owner editing later if wanted. |

Everything else — listing pages, search, categories, featured badges, claim forms, outreach, payments — is standard web + CRM work well within reach.

---

## 2. Architecture (the whole picture)

```
                         ┌─────────────────────────────┐
                         │   GHL Sub-account (per city) │  ← SOURCE OF TRUTH
                         │  Contacts (tag: business)    │
                         │  Custom fields = listing data│
                         │  Workflows · Payments · Agents│
                         └───────────▲─────────┬────────┘
                        write-back   │         │  read (server-side, keyed)
                     (claims, consent)│        │
                         ┌───────────┴─────────▼────────┐
                         │   Vercel serverless API layer │  ← holds GHL API key
                         │  /api/listings  /api/listing  │     (never client-side)
                         │  /api/claim     /api/add      │
                         └───────────▲─────────┬────────┘
                                     │         │
                         forms POST  │         │  build/ISR fetch
                         ┌───────────┴─────────▼────────┐
                         │   Astro site on Vercel        │  ← what visitors see
                         │  Home · Listing grid · Detail │     static HTML = great SEO
                         │  Category · Search · Claim    │
                         │  Add-business · Thank-you     │
                         └──────────────────────────────┘
                              custom domain (per city)
```

**Multi-market:** one codebase = a template repo. Deploy it once per market, each deploy configured (env vars) to point at that market's GHL sub-account and its own domain (spacecoast…, centralflorida…). This is the "master snapshot → spawn per city" idea, applied to the code side. One GHL sub-account per directory (for sending-reputation isolation, as we established).

**Why GHL-as-database works cleanly:** the GHL API exposes contacts, custom fields, and tags. Your API layer reads tagged contacts to build listings and writes claim data back. Tag a contact `business` → it appears as a listing on next fetch. Same UX as SDA, zero custom database.

---

## 3. What's built where (the split)

| Capability | GHL (native / GHL AI / manual) | Claude Code (custom app) |
|---|---|---|
| Contact/listing data store | ✅ contacts + custom fields | — (reads it) |
| Directory pages (home, grid, detail, category) | — | ✅ Astro |
| Search | — | ✅ client-side fuzzy search over listing index |
| Claim form + consent capture | form UI in Astro; **write-back** to GHL | ✅ Vercel fn |
| Add-business form | — | ✅ Astro + Vercel fn |
| Outreach email/SMS sequences | ✅ Workflow AI + our copy | — |
| Conversations inbox / calendars / pipeline | ✅ native | — |
| Premium plans + payments | ✅ order forms + Stripe | minor: read plan flag |
| Inbound chat widget | ✅ Conversation AI (native) | optional custom Claude widget (v2) |
| Outbound courtesy call | ✅ Voice AI **or** Vapi | — (config, not code) |
| Owner self-edit dashboard | — | optional magic-link (v2) |

---

## 4. Data model (GHL contact custom fields)

Reuse the fields from the earlier build doc, with one improvement over Tom's approach: use a real `business_name` field instead of his first-name-field hack. Core fields:

`business_name` · `scraped_address` · `scraped_phone` · `business_category` · `business_description` · `google_rating` · `google_review_count` · `listing_slug` (URL key) · `plan_tier` (Free/Featured) · `claim_status` (Unclaimed/Pending/Claimed) · `claim_token` · `image_urls` · `hours` · `social_links` · `tcpa_consent` (+ `_ts`, `_ip`, `_version`).

**Widget + agency fields** (added for the two-widget model, §5 Layer 5):
- `ai_context` — a short business blurb/FAQ the per-listing Featured agent uses as its knowledge. Can be auto-generated from the business's website at claim time.
- `agency_client` — boolean. `false` = directory-only (Featured listing). `true` = full agency client with their own sub-account.
- `client_location_id` — the GHL sub-account ID to route this business's captured leads into, when `agency_client = true`. Blank otherwise (leads stay in the directory sub-account).

A contact becomes a listing when tagged `business`. `plan_tier = Featured` drives the featured badge + extra fields *and* the per-listing AI agent on the front end.

> Later refinement: a GHL **custom object "Listing"** separates business data from the person cleanly, but has thinner API/workflow support. Contacts + fields is the right v1.

---

## 5. Layered build order (ship v1, then extend)

Each layer lists **goal · where · tools · done-when.** Build in order — later layers depend on earlier ones.

### Layer 0 — GHL foundation
- **Goal:** the CRM backbone exists.
- **Where:** GHL sub-account (one for your first market).
- **Tools:** GHL manual + Ask AI for the custom fields.
- **Do:** create the sub-account; create custom fields (§4) with exact keys; create tags (`business`, `directory_lead`, `dir_engaged`, `dir_claimed`, `opt_in_voice`, `dir_opt_out`); generate a GHL API key / Private Integration token for the app.
- **Done-when:** you can add a test contact, tag it `business`, and see the fields populated.

### Layer 1 — Directory app skeleton (the thing that looks great)
- **Goal:** a live, good-looking directory rendering real GHL listings.
- **Where:** Claude Code → Astro repo → Vercel.
- **Tools:** Claude Code, your design-playbook skill, Vercel.
- **Do:**
  1. `GET /api/listings` (Vercel fn): fetch contacts tagged `business` from GHL, return a clean JSON array. GHL key stays server-side.
  2. Astro pages: **home** (hero + featured row + category tiles), **listing grid**, **listing detail** (`/business/[slug]`), **category** pages. Static/ISR — rebuild on demand.
  3. **Search:** build a JSON index at build time; Fuse.js client-side fuzzy search. (Looks identical to Tom's "generative search" for a local dataset.)
  4. Featured listings render with badge + gallery; free listings are basic.
  5. Connect the domain.
- **Done-when:** the site is live at your domain, shows your seeded businesses, search + categories work, and it looks polished. **This is the foot-in-the-door — get here fast.**

### Layer 2 — Claim + add-business flow
- **Goal:** owners can claim listings; claims capture consent and update GHL.
- **Where:** Astro forms → Vercel fn → GHL write-back → GHL workflow.
- **Tools:** Claude Code + GHL workflow.
- **Do:**
  1. Claim page `/claim?t={claim_token}`: pre-fills the listing (via `GET /api/listing?token=`), form with owner name/role/cell + NAP confirm + **unchecked** TCPA consent box (use the exact consent language + `_ts`/`_ip`/`_version` capture).
  2. `POST /api/claim` (Vercel fn): validate → write to GHL (`claim_status=Pending`→ you approve, or auto `Claimed`; set consent fields; if consent checked, add tag `opt_in_voice`) → trigger the GHL claim workflow.
  3. Add-business page + `POST /api/add`: creates a new GHL contact tagged `business` (goes to a review queue via tag/pipeline stage).
  4. Admin approval = you flipping `claim_status` / stage in GHL (Tom's "submissions → approve/reject").
- **Done-when:** submitting the claim form updates the contact in GHL, sets consent + tag, and fires the workflow.

### Layer 3 — Outreach engine (the honeypot)
- **Goal:** contacts get the no-link → claim → courtesy sequence.
- **Where:** GHL workflows.
- **Tools:** GHL Workflow AI + our written copy (from the first build doc).
- **Do:** WF-A enrollment + no-link Email 1; WF-B reply handler + claim-link Email 2 + engagement-gated SMS; WF-C claim handler; WF-D upsell/booking. Drop `business`-tagged contacts into WF-A when the site's ready (Tom's "get live first, then prospect").
- **Done-when:** a test contact runs the full sequence and a claim flips it to the upsell path.

### Layer 4 — Premium plans + payments
- **Goal:** sell the Featured upgrade; front end reflects it.
- **Where:** GHL order forms/payments (Stripe) + a small front-end read.
- **Tools:** GHL payments + minor Claude Code.
- **Do:** create a Featured product/order form in GHL; on purchase, set `plan_tier=Featured` (workflow); front end already renders Featured differently (Layer 1). Optional redirect after purchase to an upsell page.
- **Done-when:** buying Featured flips the listing's styling on the next revalidate.

### Layer 5 — AI agents (replicate, don't rebuild)
- **Goal:** two distinct chat assistants + an outbound courtesy call, without $5k of custom coding.
- **Where:** GHL Conversation AI (directory-wide) · your Vercel API (per-listing) · GHL/Vapi Voice AI (outbound).
- **Tools:** GHL AI agents, your own LLM endpoint, Vapi (Russ's choice for voice — better voice, pay-per-minute, GHL integration).

**The two-widget model (never two chats on one page — pick one by page type):**

| Page type | Which widget | Built with |
|---|---|---|
| Home + all non-listing pages (category, search, add-business, about) | **Directory-wide assistant** — Q&A, add-business onboarding, upsell nudges | GHL Conversation AI widget (embed snippet), leads land in the directory inbox |
| **Free** listing pages | Directory-wide assistant (doubles as an "upgrade to Featured" nudge) | GHL widget |
| **Featured** listing pages | **Per-listing business agent** only — the directory-wide widget is suppressed here | Your Vercel LLM endpoint, primed with that business's `ai_context` |

**The routing rule** (one conditional in the listing-detail template — trivial because your Astro page already knows the business and its `plan_tier`):
```
if (listing.plan_tier === 'Featured')  → mount per-listing agent, do NOT load GHL snippet
else                                    → load GHL directory-wide snippet
every non-listing page                  → GHL directory-wide snippet
```

**Lead routing for the per-listing agent** (the agency-client bridge): when the Featured agent captures a lead, the Vercel endpoint checks `agency_client`. If `true`, write the lead into `client_location_id` (their own sub-account). If `false`, write it into the directory sub-account. Same widget, destination decided by tier — no widget swap when a business upgrades to an agency client.

- **Do:**
  1. **Directory-wide (GHL):** build the GHL Conversation AI chat widget; embed its snippet site-wide *except* on Featured listing pages. Requires the AI Employee add-on on the directory sub-account.
  2. **Per-listing (yours):** `POST /api/agent` — takes a `listing_slug`, builds a system prompt from that business's `ai_context`, answers as the business, captures leads → routes per `agency_client`/`client_location_id`. Give it a distinct greeting ("Hi, I'm the assistant for [Business] …") vs the directory-wide one ("Looking for a local business or want to add yours?").
  3. **Outbound courtesy call:** workflow trigger `opt_in_voice` tag added → wait 1 day → Voice AI/Vapi call with the courtesy script (not a sales call) → branch to premium link / book call / follow-up.
- **Done-when:** a Featured page shows only the business agent; every other page shows only the directory assistant; a consented test claim triggers a courtesy call the next day.

### Layer 6 — Owner dashboard + custom AI widget (v2, optional)
- **Goal:** self-service editing + a branded AI concierge.
- **Where:** Claude Code.
- **Do:** magic-link (passwordless) auth → a "manage my listing" page that reads/writes that contact's fields via a scoped token; optionally a Claude-powered chat widget ("Claude in Claude" style) that calls your API for listing lookup/claim.
- **Done-when:** an owner can log in via emailed link and edit their own listing. **Defer until you have traction.**

---

## 6. The MVP cut line (ship this, then stop and prospect)

Tom's own best advice, stripped of the sales: *get live fast, prospect, then build out.* Your v1 = **Layers 0–3.** That gives you a great-looking live directory, working claims with consent, and the outreach engine — everything needed to add clients and start selling. Layers 4–6 come after you've proven the outreach converts. Do not build the owner dashboard or custom AI agent before you have your first claims; that's the trap Tom warns about ("don't add a podcast page before you're making money").

---

## 7. First move (this week)

1. **Layer 0** in GHL — sub-account, fields, tags, API token. (A couple hours, mostly manual + Ask AI.)
2. **Layer 1 skeleton** in Claude Code — the `/api/listings` function + the Astro home/grid/detail pages reading your seeded businesses. Get it deployed to Vercel behind a temporary URL.

Once the skeleton renders real listings, everything else hangs off it. We'll build the `/api/listings` function and the Astro pages together first — that's the spine.

---

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

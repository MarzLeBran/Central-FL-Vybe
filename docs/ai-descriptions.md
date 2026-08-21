# AEO business descriptions — Claude-generated

Google's Places API (what sources real businesses — see
[google-apis.md](google-apis.md)) doesn't return anything resembling a
description. Before this, a business with no description column in its CSV
got a placeholder: `"$name serves the local area."` — filler text, not
something worth publishing, and the opposite of AEO (Answer Engine
Optimization): the whole point of a business page is to be the thing an AI
answer engine or voice assistant quotes when someone asks "is there a
[category] in [city]."

**Built, two paths:**

1. [`scripts/import-listings.mjs`](../scripts/import-listings.mjs) calls
   Claude once per listing that arrives with no real description in a batch
   CSV import, and writes the result into `business_description`.
2. **Live at `/add-business`, every submission, free or paid** —
   [`src/lib/ai-description.ts`](../src/lib/ai-description.ts). Instead of a
   single free-text description box, the form asks five short, specific
   questions (products/services, what makes them different, who they serve,
   credentials/specialties, anything else) and Claude writes the actual
   listing description from those answers automatically — no button to
   click, no "generate with AI" step the business owner has to think about.
   They can still edit the result afterward via `/manage` or `/manage/admin`
   like any other description. Applies to every signup, not just paid tiers,
   per the site's value policy that a free listing is a real page, not a
   lesser one.

The live path also computes `county` via `countyForAddress()` (previously
only done by the batch importer) for the "Location" fact fed to the prompt —
a real fix, not just an AI-quality nicety, since self-signups previously
never got placed under a county page at all.

**Beyond the five answers, the live path also draws on:**

- **Real text from the business's own website**, if they gave one —
  `fetchWebsiteExcerpt()` fetches their homepage and extracts plain text
  (crude regex tag-stripping, not a full HTML parser — this only needs rough
  visible copy for a prompt, not correct handling of arbitrary markup),
  capped at 3,000 characters. Best-effort only: a 5-second timeout, and any
  failure (site down, blocks bots, isn't HTML) just means no excerpt, never
  a failed or delayed signup.
- **Which social platforms they listed** (Instagram, Facebook, etc.) — just
  the fact that they're present there, not scraped content. Deliberately
  not attempted: Instagram/Facebook/TikTok actively block non-browser
  scraping (login walls, rate limits, bot detection), so unlike a business's
  own website, there's no reliable way to read what's actually posted there
  from a server-side fetch. Pretending otherwise would mean silently failing
  most of the time for something that adds real latency even when it works.

## What it's given, and what it's told not to do

**Batch import:** business name, category, city/county (parsed from the
address), and Google's own category tags (`types`, captured free by
`scripts/find-businesses.mjs` — see google-apis.md) when available — sparse
facts, so the prompt targets 1-2 plain sentences.

**Live at `/add-business`:** the same core facts, plus whatever the business
actually answered across the five intake questions — richer input, so the
prompt targets a fuller, structured write-up (headings, bold, bullet lists
where the answers support it), using exactly the markdown subset
`src/lib/markdown.ts`'s renderer supports and nothing else.

Both prompts share the same non-negotiable rule: **use only the facts
given, never invent anything not in that list** — no specialties, no "years
in business," no awards, no certifications, no customer testimonials beyond
what was actually provided. When a fact is missing, both prompts are told to
simply not cover that angle rather than padding with unearned superlatives
("top-rated", "trusted", "premier"). This matters because the output
publishes on a real business's page without a human reviewing it first — a
hallucinated claim isn't just bad copy, it's something a business owner
never agreed to have said about them.

## Model and cost

Both paths use `claude-opus-5` at `effort: "low"` — a short, single-turn
writing task with no multi-step reasoning to do, even for the fuller live
version. Batch import runs five requests concurrently; cost is trivial
either way — 138 short batch generations ran well under $1, and a single
live generation per signup is smaller still.

## Enabling / disabling it

Requires `ANTHROPIC_API_KEY` in `.env` (get one at
[console.anthropic.com](https://console.anthropic.com) → Settings → API
Keys) for **both** paths — this is the one server-side key, not a separate
one per path. Never required in either case: unset, and the batch importer
falls back to the old generic placeholder while the import still completes;
unset, and the live `/add-business` path falls back to plainly assembling
whatever the business actually typed into the five answers
(`assembleFallbackDescription()` in `src/lib/ai-description.ts`) — better
than a placeholder that's true of literally every business, since a live
signup usually has *some* real answers even without AI polish. Pass
`--no-ai-descriptions` to skip generation on purpose for a batch import run
(fast iteration, or you just don't want it for a given run) without needing
to unset the key.

```
npm run import -- out/sourced-businesses.csv --no-ai-descriptions
```

## Keys

`ANTHROPIC_API_KEY` goes in `.env` (already gitignored) — same treatment as
the GHL token, Stripe keys, and the Google Places key: local-script-only,
never sent to the browser.

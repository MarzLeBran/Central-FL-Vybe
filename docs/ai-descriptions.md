# AEO business descriptions — Claude-generated

Google's Places API (what sources real businesses — see
[google-apis.md](google-apis.md)) doesn't return anything resembling a
description. Before this, a business with no description column in its CSV
got a placeholder: `"$name serves the local area."` — filler text, not
something worth publishing, and the opposite of AEO (Answer Engine
Optimization): the whole point of a business page is to be the thing an AI
answer engine or voice assistant quotes when someone asks "is there a
[category] in [city]."

**Built:** [`scripts/import-listings.mjs`](../scripts/import-listings.mjs) calls
Claude once per listing that arrives with no real description, and writes the
result into `business_description` — the same field that flows to both
`src/data/mock-listings.json` and `out/ghl-import.csv`. A row that already
has a real description (a hand-curated CSV, a business that filled out
`/add-business` itself) is left untouched — this only fills gaps, never
overwrites real copy.

## What it's given, and what it's told not to do

Only verified facts go into the prompt: business name, category, city/county
(parsed from the address), and Google's own category tags (`types`, captured
free by `scripts/find-businesses.mjs` — see google-apis.md) when available.
The system prompt explicitly forbids inventing anything not in that list —
no specialties, no "years in business," no awards, no certifications, no
customer testimonials. When the only facts on hand are name + category +
location, it says so plainly rather than padding with unearned superlatives
("top-rated", "trusted", "premier"). This matters because the output is
published on a real business's page without their review — a hallucinated
claim isn't just bad copy, it's something a business owner never agreed to
have said about them.

## Model and cost

Uses `claude-opus-5` at `effort: "low"`, since this is a short, single-turn
writing task with no multi-step reasoning to do. Five requests run
concurrently. Cost is trivial — 138 short generations ran well under $1.

## Enabling / disabling it

Requires `ANTHROPIC_API_KEY` in `.env` (get one at
[console.anthropic.com](https://console.anthropic.com) → Settings → API
Keys). Never required — if it's unset, every listing that needed a
description gets the old generic placeholder instead, and the import still
completes. Pass `--no-ai-descriptions` to skip generation on purpose (fast
iteration, or you just don't want it for a given run) without needing to
unset the key.

```
npm run import -- out/sourced-businesses.csv --no-ai-descriptions
```

## Keys

`ANTHROPIC_API_KEY` goes in `.env` (already gitignored) — same treatment as
the GHL token, Stripe keys, and the Google Places key: local-script-only,
never sent to the browser.

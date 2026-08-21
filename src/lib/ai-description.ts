// ─────────────────────────────────────────────────────────────────────────────
// LIVE AEO DESCRIPTION GENERATION — for a real-time /add-business submission.
//
// A close cousin of scripts/import-listings.mjs's writeAeoDescription(), not
// a shared import from it: that script is plain Node (no build step, no TS),
// this runs inside the Astro/Vite app — mixing runtimes for one small prompt
// isn't worth the coupling. Two real differences from the batch-import
// version, not just a runtime port:
//
//   1. The batch importer only ever has bare facts (name/category/location) —
//      real listing content is rare there, so its prompt targets 1-2 plain
//      sentences. This one is fed real, owner-supplied answers most of the
//      time (the /add-business intake questions), so it targets a fuller,
//      structured write-up — headings/bold/bullets — using EXACTLY the
//      markdown subset src/lib/markdown.ts's renderer supports and nothing
//      else (a link or table in the output would just render as literal
//      text, not break anything, but it'd look wrong).
//   2. Still never invents anything not provided — same non-negotiable rule
//      as the batch version, same reason: this publishes on a real business's
//      page without a human reviewing it first.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";

export interface IntakeFacts {
  businessName: string;
  category: string;
  location?: string; // "City, County County, Florida" — same shape import-listings.mjs builds
  services?: string;
  differentiators?: string;
  audience?: string;
  credentials?: string;
  extra?: string;
  websiteExcerpt?: string; // real text pulled from their own site — see fetchWebsiteExcerpt()
  socialNetworks?: string[]; // which platforms they listed, e.g. ["instagram", "facebook"] —
                              // just the fact that they're present there, never scraped content.
                              // Instagram/Facebook/TikTok actively block non-browser scraping
                              // (login walls, rate limits, bot detection) — unlike a business's
                              // own website, there's no reliable way to read what's actually on
                              // those pages from a server-side fetch, so this deliberately
                              // doesn't try.
}

const SYSTEM_PROMPT = [
  "You write local-business directory descriptions optimized for answer engines",
  "(AEO) — content a voice assistant or AI search summary can quote directly to",
  'answer "is there a [category] in [city]" or "what does [business] do", and',
  "that a real visitor also finds genuinely useful.",
  "",
  "Formatting — markdown, and ONLY these elements, nothing else (no links, no",
  "tables, no code blocks, no raw HTML):",
  "  - **bold** for emphasis",
  "  - ## or ### headings for sections",
  "  - \"- \" bullet lists",
  "",
  "Rules:",
  "1. Lead with what kind of business it is and where it's located.",
  "2. Use a heading and a bulleted list where the business's own answers",
  "   naturally support one (e.g. a services list) — don't force structure",
  "   that isn't there. Two to four short sections is typical.",
  "3. Use ONLY the facts given below — including the website excerpt, if one is",
  "   provided, which is real text taken from the business's own site. Never",
  "   invent specialties, years in business, certifications, awards, staff",
  "   names, or customer testimonials that aren't actually in these facts.",
  "4. If an answer below is missing, simply don't cover that angle — don't",
  '   guess, and don\'t pad with vague unearned superlatives ("top-rated",',
  '   "trusted", "premier").',
  "5. Output only the description text itself — no preamble, no \"Here's a",
  "   description:\", no surrounding quotation marks.",
].join("\n");

function buildFactsBlock(facts: IntakeFacts): string {
  return [
    `Business name: ${facts.businessName}`,
    `Category: ${facts.category}`,
    facts.location && `Location: ${facts.location}`,
    facts.services && `Products/services offered: ${facts.services}`,
    facts.differentiators && `What makes them different: ${facts.differentiators}`,
    facts.audience && `Who they mainly serve: ${facts.audience}`,
    facts.credentials && `Certifications/specialties/years in business: ${facts.credentials}`,
    facts.extra && `Anything else they want known: ${facts.extra}`,
    facts.socialNetworks?.length && `Also active on: ${facts.socialNetworks.join(", ")}`,
    facts.websiteExcerpt &&
      `Text pulled from the business's own website (use it, but only what's actually here):\n${facts.websiteExcerpt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generates an AEO description from live intake answers. Throws on any
 * failure — the caller (api/add-business.ts) decides the fallback, same
 * "never block the submission over this" principle as the batch importer.
 */
export async function generateLiveAeoDescription(apiKey: string, facts: IntakeFacts): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 700,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildFactsBlock(facts) }],
  });

  const text = response.content.find((b) => b.type === "text")?.text?.trim();
  if (!text) throw new Error("empty response");
  return text;
}

/**
 * No API key, or generation failed — falls back to plainly assembling
 * whatever the business actually typed, rather than the batch importer's
 * generic "$name serves the local area." placeholder. A live signup usually
 * has SOME real answers even without AI polish; that's still better than a
 * placeholder that's true of literally every business.
 */
export function assembleFallbackDescription(facts: IntakeFacts): string {
  const parts = [
    facts.services && `${facts.businessName} offers ${lowerFirst(facts.services)}.`,
    facts.differentiators,
    facts.audience && `Serving ${facts.audience}.`,
    facts.credentials,
    facts.extra,
  ].filter(Boolean);

  if (!parts.length) {
    return `${facts.businessName} is a ${facts.category.toLowerCase()} business${
      facts.location ? ` in ${facts.location}` : ""
    }.`;
  }
  return parts.join(" ");
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const WEBSITE_FETCH_TIMEOUT_MS = 5000;
const WEBSITE_EXCERPT_MAX = 3000; // characters — plenty for a homepage's actual copy,
                                   // short enough to stay a small fraction of the prompt

/**
 * Best-effort: fetches the business's own homepage and extracts plain text
 * for the AI to draw on. Never throws — a slow, broken, or nonexistent
 * website must never block or fail the signup it's attached to; the caller
 * gets `undefined` and generation proceeds on the intake answers alone,
 * exactly as it did before this existed.
 *
 * Deliberately simple regex-based tag-stripping, not a full HTML parser —
 * this only needs to pull rough visible text for an LLM prompt, not
 * correctly handle arbitrary malformed markup. Strips <script>/<style>
 * bodies first (their content isn't text a visitor reads), then all
 * remaining tags, then collapses whitespace.
 */
export async function fetchWebsiteExcerpt(url: string): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CentralFLVybeBot/1.0)" },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return undefined;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return undefined;

    const html = await res.text();
    const text = html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text ? text.slice(0, WEBSITE_EXCERPT_MAX) : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE MARKDOWN RENDERING for listing descriptions — the only owner/admin-
// submitted content rendered as markup to every visitor of a public page.
//
// `description` is still stored as plain markdown SOURCE text (no change to
// the Listing type) — all the safety work happens here, at render time,
// every time it's read, rather than at write time. That's deliberate: it's
// a smaller, exhaustively-enumerable boundary (the two functions below) than
// "every current and future write path remembers to sanitize."
//
// Two layers of defense, not one:
//   1. markdown-it configured with `html: false` and the `link`/`image`/
//      `html_block`/`html_inline`/`reference` rules DISABLED (not just
//      un-rendered — disabled rules mean that syntax is never tokenized as
//      anything but literal text). This is what makes a raw <script> tag,
//      a `javascript:` link, or an `onerror=` image attribute impossible to
//      produce, and is also why descriptions can never contain a clickable
//      link even if the source text has markdown link syntax in it (a
//      deliberate product rule, not just a safety one).
//   2. sanitize-html as independent, belt-and-suspenders insurance against
//      a future markdown-it config/version change ever loosening the above —
//      a strict tag/attribute allowlist, zero attributes permitted on
//      anything.
// ─────────────────────────────────────────────────────────────────────────────

import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const md = new MarkdownIt({ html: false, linkify: false, breaks: true }).disable([
  "link",
  "image",
  "html_block",
  "html_inline",
  "reference",
  "table",
  "blockquote",
  "hr",
  "code",
  "fence",
]);

const ALLOWED_TAGS = ["p", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "br"];

/**
 * Renders a listing's markdown-source description to sanitized HTML, safe to
 * pass to `set:html`. Supports bold, italic, headings, and bullet/numbered
 * lists — nothing else. Never produces a link or any raw HTML, no matter
 * what the source text contains.
 */
export function renderDescriptionHtml(source: string): string {
  const rendered = md.render(source ?? "");
  return sanitizeHtml(rendered, { allowedTags: ALLOWED_TAGS, allowedAttributes: {} });
}

/**
 * Plain-text form for places that can't hold markup at all — <meta
 * description>, OG/Twitter tags, LocalBusiness JSON-LD, and the line-clamped
 * card preview. Derived from the same rendered HTML (strip tags, collapse
 * whitespace) rather than a second parser, so there's one source of truth
 * for what the markdown means.
 */
export function plainTextDescription(source: string): string {
  return decodeHtmlEntities(
    renderDescriptionHtml(source)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// The sanitized HTML has text-node special characters entity-encoded
// (&amp;, &lt;, ...) — stripping tags alone leaves those literal entities in
// place, and Astro's own attribute escaping then double-encodes them (e.g.
// "&amp;" -> "&amp;amp;" inside a meta tag). Decode before returning so the
// plain-text form reads as real text everywhere it's used.
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
}

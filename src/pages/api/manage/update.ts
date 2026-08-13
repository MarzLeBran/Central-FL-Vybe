// POST /api/manage/update — saves an owner's (or admin's, on an owner's
// behalf) listing edits: description, gallery order, logo, curated embeds.
// JSON body, cookie-authenticated — see isSameOrigin() for why this needs its
// own CSRF check (Astro's default only covers form-like content types).

export const prerender = false;

import type { APIRoute } from "astro";
import { del } from "@vercel/blob";
import { getListingById } from "../../../lib/directory";
import { submitListingUpdate } from "../../../lib/submissions";
import { verifySession, isSameOrigin, SESSION_COOKIE } from "../../../lib/auth";
import { renderDescriptionHtml } from "../../../lib/markdown";

const YOUTUBE_RE = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/)|youtu\.be\/)[\w-]+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOCIAL_NETWORKS = ["facebook", "instagram", "x", "linkedin", "tiktok", "youtube"];
// 10,000 chars comfortably fits a full AEO-style long-form description (a
// real example ran ~4,300 chars / 590 words) with headroom to spare. Not
// based on any confirmed GHL field limit — just a sane upper bound against
// someone pasting something absurd, raised from an earlier arbitrary 2,000.
const DESCRIPTION_MAX = 10000;
const OFFER_MAX = 300;
const EXTRA_LINKS_MAX = 6;
const ENTRY_LIST_MAX = 20; // per content type (blog/news/events/team)
const ENTRY_TITLE_MAX = 200;
const ENTRY_TEXT_MAX = 5000;

type EntryFieldSpec = { key: string; max: number; required?: boolean };

// Shared validator for the four "list of structured entries" content types —
// blog/news/events/team differ only in which fields they carry, not in the
// shape of the validation (cap count, trim/cap each field, validate the
// optional image url). Returns entries with only truthy fields kept, drops
// any entry that's entirely blank (e.g. an "Add" row nobody filled in).
function parseEntryList(
  raw: unknown,
  fields: EntryFieldSpec[],
  label: string
): { ok: true; entries: Record<string, unknown>[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > ENTRY_LIST_MAX) {
    return { ok: false, error: `no more than ${ENTRY_LIST_MAX} ${label} entries` };
  }
  const entries: Record<string, unknown>[] = [];
  for (const item of list) {
    const entry: Record<string, unknown> = { id: String((item as any)?.id || crypto.randomUUID()) };
    let hasAny = false;
    for (const f of fields) {
      const val = String((item as any)?.[f.key] ?? "").trim();
      if (val) hasAny = true;
      if (val.length > f.max) {
        return { ok: false, error: `a ${label} entry's ${f.key} must be under ${f.max} characters` };
      }
      if (val) entry[f.key] = val;
    }
    if (!hasAny) continue; // a blank row the owner added then never filled in
    for (const f of fields) {
      if (f.required && !entry[f.key]) {
        return { ok: false, error: `every ${label} entry needs a ${f.key}` };
      }
    }
    const imageUrl = (item as any)?.imageUrl ? String((item as any).imageUrl) : undefined;
    if (imageUrl) {
      if (!isBlobUrl(imageUrl)) return { ok: false, error: `invalid image url in a ${label} entry` };
      entry.imageUrl = imageUrl;
    }
    entries.push(entry);
  }
  return { ok: true, entries };
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: "bad origin" }, 403);
  }

  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session) return json({ ok: false, error: "not signed in" }, 401);

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "invalid body" }, 400);

  // Owner sessions may only ever edit their own listing — the client-supplied
  // listingId is ignored in favor of the session's own contact id. Admin
  // sessions may edit any listing that actually exists.
  const listingId = session.kind === "owner" ? session.contactId : String(body.listingId ?? "");
  const listing = await getListingById(listingId);
  if (!listing) return json({ ok: false, error: "listing not found" }, 404);

  // Defense in depth: re-check the claim/tier gate for owner sessions even
  // though request-link/verify/the dashboard already checked it — status can
  // change mid-session (downgrade, unclaim) and this is the actual mutation.
  if (session.kind === "owner") {
    const isPaid = listing.planTier !== "free";
    if (listing.claimStatus === "unclaimed" || !isPaid) {
      return json({ ok: false, error: "listing is no longer eligible" }, 403);
    }
  }

  const description = String(body.description ?? "").trim();
  if (!description) return json({ ok: false, error: "description is required" }, 400);
  if (description.length > DESCRIPTION_MAX) {
    return json({ ok: false, error: `description must be under ${DESCRIPTION_MAX} characters` }, 400);
  }
  // description is stored as markdown source (src/lib/markdown.ts renders it
  // safely on every read) — this doesn't change what's saved, it just fails
  // fast here for the one owner/admin if rendering ever throws, rather than
  // at page-build time for every visitor.
  try {
    renderDescriptionHtml(description);
  } catch {
    return json({ ok: false, error: "description could not be rendered — check formatting" }, 400);
  }

  const address = String(body.address ?? "").trim();
  if (!address) return json({ ok: false, error: "address is required" }, 400);

  const phone = String(body.phone ?? "").trim();
  if (!phone) return json({ ok: false, error: "phone is required" }, 400);

  const email = String(body.email ?? "").trim();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "a valid email is required" }, 400);

  const website = body.website ? String(body.website).trim() : undefined;
  if (website && !/^https?:\/\//.test(website)) {
    return json({ ok: false, error: "website must start with http:// or https://" }, 400);
  }

  const specialOffer = body.specialOffer ? String(body.specialOffer).trim() : undefined;
  if (specialOffer && specialOffer.length > OFFER_MAX) {
    return json({ ok: false, error: `special offer must be under ${OFFER_MAX} characters` }, 400);
  }

  const specialOfferImageUrl = body.specialOfferImageUrl ? String(body.specialOfferImageUrl) : undefined;
  if (specialOfferImageUrl && !isBlobUrl(specialOfferImageUrl)) {
    return json({ ok: false, error: "invalid special offer image url" }, 400);
  }

  const blogResult = parseEntryList(
    body.blogPosts,
    [
      { key: "title", max: ENTRY_TITLE_MAX, required: true },
      { key: "date", max: 20 },
      { key: "body", max: ENTRY_TEXT_MAX, required: true },
    ],
    "blog post"
  );
  if (!blogResult.ok) return json(blogResult, 400);

  const newsResult = parseEntryList(
    body.newsItems,
    [
      { key: "title", max: ENTRY_TITLE_MAX, required: true },
      { key: "date", max: 20 },
      { key: "body", max: ENTRY_TEXT_MAX, required: true },
    ],
    "news story"
  );
  if (!newsResult.ok) return json(newsResult, 400);

  const eventsResult = parseEntryList(
    body.events,
    [
      { key: "title", max: ENTRY_TITLE_MAX, required: true },
      { key: "date", max: 20 },
      { key: "time", max: 40 },
      { key: "location", max: 200 },
      { key: "description", max: ENTRY_TEXT_MAX, required: true },
    ],
    "event"
  );
  if (!eventsResult.ok) return json(eventsResult, 400);

  const teamResult = parseEntryList(
    body.team,
    [
      { key: "name", max: ENTRY_TITLE_MAX, required: true },
      { key: "role", max: ENTRY_TITLE_MAX, required: true },
      { key: "bio", max: ENTRY_TEXT_MAX },
    ],
    "team member"
  );
  if (!teamResult.ok) return json(teamResult, 400);

  const extraLinksRaw = Array.isArray(body.extraLinks) ? body.extraLinks : [];
  if (extraLinksRaw.length > EXTRA_LINKS_MAX) {
    return json({ ok: false, error: `no more than ${EXTRA_LINKS_MAX} extra links` }, 400);
  }
  const extraLinks: { label: string; url: string }[] = [];
  for (const entry of extraLinksRaw) {
    const label = String(entry?.label ?? "").trim();
    const url = String(entry?.url ?? "").trim();
    if (!label && !url) continue;
    if (!label || !url) return json({ ok: false, error: "extra links need both a label and a url" }, 400);
    if (!/^https?:\/\//.test(url)) return json({ ok: false, error: `extra link "${label}" must be http:// or https://` }, 400);
    extraLinks.push({ label, url });
  }

  const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map(String) : [];
  const logoUrl = body.logoUrl ? String(body.logoUrl) : undefined;
  for (const url of logoUrl ? [...imageUrls, logoUrl] : imageUrls) {
    if (!isBlobUrl(url)) return json({ ok: false, error: "invalid image url" }, 400);
  }

  const youtubeUrl = body.youtubeUrl ? String(body.youtubeUrl).trim() : undefined;
  if (youtubeUrl && !YOUTUBE_RE.test(youtubeUrl)) {
    return json({ ok: false, error: "invalid YouTube url" }, 400);
  }

  const bookingUrl = body.bookingUrl ? String(body.bookingUrl).trim() : undefined;
  if (bookingUrl && !bookingUrl.startsWith("https://")) {
    return json({ ok: false, error: "booking url must be https://" }, 400);
  }

  const socialLinks: Record<string, string> = {};
  if (body.socialLinks && typeof body.socialLinks === "object") {
    for (const network of SOCIAL_NETWORKS) {
      const url = body.socialLinks[network] ? String(body.socialLinks[network]).trim() : "";
      if (!url) continue;
      if (!url.startsWith("https://")) {
        return json({ ok: false, error: `${network} link must be https://` }, 400);
      }
      socialLinks[network] = url;
    }
  }

  const result = await submitListingUpdate({
    listingId,
    description,
    imageUrls,
    logoUrl,
    address,
    phone,
    email,
    website,
    youtubeUrl,
    bookingUrl,
    socialLinks,
    extraLinks,
    specialOffer,
    specialOfferImageUrl,
    blogPosts: blogResult.entries as any,
    newsItems: newsResult.entries as any,
    events: eventsResult.entries as any,
    team: teamResult.entries as any,
  });
  if (!result.ok) return json(result, 500);

  // Clean up any Blob files the owner/admin removed — gallery, logo, special
  // offer image, or an image that was on a blog/news/event/team entry that
  // got edited or deleted. Best-effort, must never fail the save itself.
  const keptEntryImages = [
    ...blogResult.entries, ...newsResult.entries, ...eventsResult.entries, ...teamResult.entries,
  ].map((e) => e.imageUrl).filter((u): u is string => !!u);
  const previousEntryImages = [
    ...(listing.blogPosts ?? []), ...(listing.newsItems ?? []), ...(listing.events ?? []), ...(listing.team ?? []),
  ].map((e) => e.imageUrl).filter((u): u is string => !!u);
  const removed = [...listing.imageUrls, listing.logoUrl, listing.specialOfferImageUrl, ...previousEntryImages].filter(
    (url): url is string =>
      !!url &&
      !imageUrls.includes(url) &&
      url !== logoUrl &&
      url !== specialOfferImageUrl &&
      !keptEntryImages.includes(url)
  );
  // Same explicit-token requirement as the upload routes — @vercel/blob
  // doesn't see import.meta.env's copy of BLOB_READ_WRITE_TOKEN.
  const blobToken = import.meta.env.BLOB_READ_WRITE_TOKEN;
  await Promise.allSettled(removed.map((url) => del(url, { token: blobToken })));

  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Rejects a hand-crafted POST pointing at an arbitrary external URL — every
// real image URL here came from our own upload route (upload.ts), which only
// ever hands back *.public.blob.vercel-storage.com URLs.
function isBlobUrl(url: string): boolean {
  try {
    return new URL(url).host.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

// POST /api/account/follow — toggles a listing slug in/out of the signed-in
// consumer's followed_listings. This is the endpoint an anonymous visitor
// never calls in practice (the client script that calls it only runs when
// the consumer_hint cookie is present), but the real gate is this session
// check, not the hint cookie.

export const prerender = false;

import type { APIRoute } from "astro";
import { getConsumerById } from "../../../lib/consumers";
import { setFollowedListings } from "../../../lib/consumer-submissions";
import { verifySession, isSameOrigin, SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, error: "bad origin" }), { status: 403 });
  }

  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.kind !== "consumer") {
    return new Response(JSON.stringify({ ok: false, error: "not signed in" }), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const slug = body?.slug ? String(body.slug) : "";
  const follow = !!body?.follow;
  if (!slug) return new Response(JSON.stringify({ ok: false, error: "missing slug" }), { status: 400 });

  let consumer;
  try {
    consumer = await getConsumerById(session.contactId);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "server" }), { status: 500 });
  }
  if (!consumer) return new Response(JSON.stringify({ ok: false, error: "account not found" }), { status: 404 });

  const current = new Set(consumer.followedSlugs);
  if (follow) current.add(slug);
  else current.delete(slug);
  const followedSlugs = [...current];

  const result = await setFollowedListings(session.contactId, followedSlugs);
  return new Response(JSON.stringify({ ...result, followedSlugs }), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
};

// GET /api/account/favorites.json — the one fetch the consumer_hint-driven
// client script makes per page load, to mark which listing cards' heart
// buttons should show filled. 401 (not an empty array) when there's no
// valid session, so the client script's stale-hint recovery path can tell
// "no favorites" apart from "not actually logged in."

export const prerender = false;

import type { APIRoute } from "astro";
import { getConsumerById } from "../../../lib/consumers";
import { verifySession, SESSION_COOKIE } from "../../../lib/auth";

export const GET: APIRoute = async ({ cookies }) => {
  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.kind !== "consumer") {
    return new Response(JSON.stringify({ error: "not signed in" }), { status: 401 });
  }

  // A transient GHL hiccup must not crash the request the header script
  // fires on every page load — degrade to "no favorites known right now"
  // rather than a raw 500, same pattern as the rest of the on-demand routes.
  try {
    const consumer = await getConsumerById(session.contactId);
    return new Response(JSON.stringify({ slugs: consumer?.followedSlugs ?? [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ slugs: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// POST /api/manage/logout — clears the session cookie. Shared by the owner
// dashboard, the admin editor, and the consumer account profile (same
// cookie, discriminated by kind) — kind-agnostic on purpose.

export const prerender = false;

import type { APIRoute } from "astro";
import { SESSION_COOKIE, CONSUMER_HINT_COOKIE, ADMIN_HINT_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  // Harmless no-op for whichever hint cookie wasn't set (owner logout sets
  // neither; consumer/admin logout only ever set one of the two).
  cookies.delete(CONSUMER_HINT_COOKIE, { path: "/" });
  cookies.delete(ADMIN_HINT_COOKIE, { path: "/" });
  return redirect("/");
};

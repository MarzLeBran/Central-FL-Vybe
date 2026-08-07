// POST /api/account/avatar-update — saves the URL returned by a completed
// Blob upload (avatar-upload.ts) onto the consumer's contact. Separate save
// step from the upload itself, same pattern as api/manage/update.ts: an
// upload alone never publishes anything until this runs.

export const prerender = false;

import type { APIRoute } from "astro";
import { setAvatarUrl } from "../../../lib/consumer-submissions";
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
  const avatarUrl = body?.avatarUrl ? String(body.avatarUrl) : "";
  if (!avatarUrl.includes(".public.blob.vercel-storage.com")) {
    return new Response(JSON.stringify({ ok: false, error: "invalid avatar url" }), { status: 400 });
  }

  const result = await setAvatarUrl(session.contactId, avatarUrl);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
};

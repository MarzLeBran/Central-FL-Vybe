// POST /api/manage/preview-description — renders markdown source to the
// exact sanitized HTML that will appear on the live page, so an owner/admin
// can check formatting before saving. Session-gated (not open to the public)
// even though the output itself is inert — no reason to let this become an
// unauthenticated "render arbitrary markdown" service. Pure rendering, no
// GHL read/write, nothing is saved by this route.

export const prerender = false;

import type { APIRoute } from "astro";
import { verifySession, isSameOrigin, SESSION_COOKIE } from "../../../lib/auth";
import { renderDescriptionHtml } from "../../../lib/markdown";

const DESCRIPTION_MAX = 10000;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, error: "bad origin" }), { status: 403 });
  }

  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return new Response(JSON.stringify({ ok: false, error: "not signed in" }), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const description = String(body?.description ?? "").slice(0, DESCRIPTION_MAX);

  try {
    const html = renderDescriptionHtml(description);
    return new Response(JSON.stringify({ ok: true, html }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 400 });
  }
};

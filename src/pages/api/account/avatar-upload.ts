// POST /api/account/avatar-upload — mints a Vercel Blob client-upload token
// for a consumer's own avatar. Dedicated route rather than a branch in
// api/manage/upload.ts: that route's authorization is listing/owner/admin-
// shaped, and mixing in a self-only-avatar rule there risks a bug that lets
// a consumer session fall through into listing-path logic. This route has
// exactly one rule: a consumer may only ever write to their own
// consumers/<contactId>/ prefix, derived from the session, never a
// client-supplied id.

export const prerender = false;

import type { APIRoute } from "astro";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifySession, isSameOrigin, SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: "bad origin" }), { status: 403 });
  }

  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.kind !== "consumer") {
    return new Response(JSON.stringify({ error: "not signed in" }), { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // See the matching comment in api/manage/upload.ts — @vercel/blob's
      // default process.env lookup doesn't see Astro's import.meta.env vars.
      token: import.meta.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`consumers/${session.contactId}/`)) {
          throw new Error("pathname does not match this account");
        }
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: 4 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });

    return new Response(JSON.stringify(jsonResponse), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
};

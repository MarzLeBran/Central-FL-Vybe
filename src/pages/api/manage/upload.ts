// POST /api/manage/upload — mints a Vercel Blob client-upload token so the
// browser can upload gallery photos/logos directly to Blob storage without
// routing image bytes through this function (avoids Vercel's function body
// size limits, gives free upload-progress events on the client).
//
// Shared by both the owner dashboard (src/pages/manage/index.astro) and the
// internal admin editor (src/pages/manage/admin/[slug].astro) — the caller
// tells us which listing via `clientPayload`, and we decide whether the
// current session is actually allowed to write to it.

export const prerender = false;

import type { APIRoute } from "astro";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getListingById } from "../../../lib/directory";
import { verifySession, isSameOrigin, SESSION_COOKIE } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: "bad origin" }), { status: 403 });
  }

  const session = verifySession(cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return new Response(JSON.stringify({ error: "not signed in" }), { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // @vercel/blob reads process.env.BLOB_READ_WRITE_TOKEN by default, but
      // Astro's dev/SSR runtime only populates import.meta.env from .env, not
      // Node's real process.env — pass it explicitly or every upload 400s
      // with "No read-write token found" even though the var is set.
      token: import.meta.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        const clientPayload = JSON.parse(clientPayloadRaw ?? "{}") as { listingId?: string };
        const listingId = clientPayload.listingId;
        if (!listingId) throw new Error("missing listingId");

        // Owner sessions may only upload to their own listing; admin sessions
        // may upload to any listing that actually exists.
        if (session.kind === "owner" && listingId !== session.contactId) {
          throw new Error("not authorized for this listing");
        }
        if (session.kind === "admin" && !(await getListingById(listingId))) {
          throw new Error("listing not found");
        }
        if (!pathname.startsWith(`listings/${listingId}/`)) {
          throw new Error("pathname does not match listingId");
        }

        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: 8 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // No onUploadCompleted — nothing needs to happen server-side after the
      // upload finishes. The client already has the resulting Blob URL from
      // upload()'s return value and appends it to local gallery state; nothing
      // is written to GHL until the owner/admin hits Save (see update.ts).
    });

    return new Response(JSON.stringify(jsonResponse), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400 });
  }
};

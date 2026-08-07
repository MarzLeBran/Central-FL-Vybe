// POST /api/manage/admin-login — checks the shared ADMIN_PASSWORD and, on
// success, sets the same manage_session cookie the owner flow uses, but with
// the "admin" discriminator (src/lib/auth.ts) so it can edit any listing.
// Also sets the non-httpOnly admin_hint cookie so static pages (the header,
// any listing page's "Edit this listing" link) can reflect admin state
// without a network round-trip — see src/lib/auth.ts.

export const prerender = false;

import type { APIRoute } from "astro";
import {
  verifyAdminPassword,
  createAdminSessionCookie,
  SESSION_COOKIE,
  ADMIN_HINT_COOKIE,
} from "../../../lib/auth";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const data = await request.formData();
  const password = String(data.get("password") ?? "");

  if (!verifyAdminPassword(password)) {
    return redirect("/manage/admin/login?error=invalid");
  }

  const cookieOpts = { secure: import.meta.env.PROD, sameSite: "lax" as const, path: "/" };
  cookies.set(SESSION_COOKIE, createAdminSessionCookie(), { ...cookieOpts, httpOnly: true });
  cookies.set(ADMIN_HINT_COOKIE, "1", { ...cookieOpts, httpOnly: false });

  return redirect("/manage/admin");
};

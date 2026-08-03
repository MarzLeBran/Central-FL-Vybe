// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import tina from '@tinacms/astro/integration';
import { tinaAdminDevRedirect } from '@tinacms/astro/vite';

// https://astro.build/config
export default defineConfig({
  // Deliberately no `output: 'server'`. The default 'static' mode prerenders
  // every page at build time — which is the whole point for listings/SEO/AEO
  // (AGENTS.md). The adapter below only makes `export const prerender = false`
  // work on the specific routes that need it: the claim/add-business forms,
  // their API endpoints (Layer 2), Stripe checkout (Layer 4), and — new here —
  // the single `tina-island/[name].ts` route TinaCMS's contextual (click-on-
  // page) editing needs even on an otherwise fully static site. Everything
  // else stays static HTML. See docs/tinacms.md.
  adapter: vercel(),
  integrations: [tina()],
  vite: {
    plugins: [tailwindcss(), tinaAdminDevRedirect()]
  }
});

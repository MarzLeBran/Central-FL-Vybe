// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// TinaCMS (tina() integration + tinaAdminDevRedirect vite plugin) is
// deliberately NOT wired in here — it broke every production build (see the
// comment in src/pages/tina-island/[name].ts.disabled for the full story:
// its one on-demand route imported a gitignored, dev-machine-only generated
// file). Phase 0 is proven and paused, not abandoned — see AGENTS.md's
// TinaCMS section for how to resume.

// https://astro.build/config
export default defineConfig({
  // Deliberately no `output: 'server'`. The default 'static' mode prerenders
  // every page at build time — which is the whole point for listings/SEO/AEO
  // (AGENTS.md). The adapter below only makes `export const prerender = false`
  // work on the specific routes that need it: the claim/add-business forms,
  // their API endpoints (Layer 2), Stripe checkout (Layer 4), and the whole
  // owner/consumer-account surface (/manage, /account). Every listing/
  // category/county/marketing page stays static HTML.
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()]
  }
});

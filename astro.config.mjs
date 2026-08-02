// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Deliberately no `output: 'server'`. The default 'static' mode prerenders
  // every page at build time — which is the whole point for listings/SEO/AEO
  // (AGENTS.md). The adapter below only makes `export const prerender = false`
  // work on the specific routes that need it: the claim/add-business forms and
  // their API endpoints (Layer 2). Everything else stays static HTML.
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()]
  }
});

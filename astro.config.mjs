// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import { fileURLToPath } from 'node:url';
import pwa from './src/integrations/pwa.ts';

// Fully static site. Cloudflare Pages serves the `dist/` folder (project belajarsendiri).
export default defineConfig({
  // The public address, for canonical + hreflang links. SITE_URL overrides it (e.g. your own domain).
  site: process.env.SITE_URL || 'https://belajarsendiri.pages.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // pwa(): fills dist/sw.js (offline support) after every build.
  integrations: [react(), mdx(), pwa()],
  vite: {
    resolve: {
      alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  },
});

// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import partytown from '@astrojs/partytown';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://ma3ak.top',
  image: {
    domains: ['static.mogcdn.com']
  },
  output: 'server',
  adapter: cloudflare({
    imageService: 'cloudflare',
    platformProxy: {
      enabled: true,
      experimentalJsonConfig: true
    }
  }),
  integrations: [
    svelte(),
    sitemap(),
    partytown({
      config: {
        forward: ['dataLayer.push']
      }
    })
  ],
  vite: {
    plugins: [
      tailwindcss()
    ],
    ssr: {
        external: ['miniflare']
    }
  }
});

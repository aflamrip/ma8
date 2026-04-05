import { defineAction } from 'astro:actions';
import { z } from 'astro:schema';
import { create, insert, search } from '@orama/orama';
import { CDN_URLS } from '../lib/constants';

export const server = {
  searchOrama: defineAction({
    input: z.object({
      term: z.string(),
    }),
    handler: async (input) => {
       // In a production SSR environment (Cloudflare Workers), building the Orama DB per request is heavy.
       // Ideally, this uses a pre-built static Orama index or queries D1 directly.
       // Here we demonstrate the Orama integration fetching the ndjson dynamically and building the DB.
       try {
         const db = await create({
            schema: {
              id: 'string',
              title: 'string',
              slug: 'string',
              type: 'string'
            }
         });

         // Fetch movies and tv index for search
         const movieRes = await fetch(`${CDN_URLS.STATIC}/movie/index.1.ndjson`);
         if (movieRes.ok) {
           const movieText = await movieRes.text();
           const movieLines = movieText.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
           for (const m of movieLines) {
             await insert(db, { id: m.id.toString(), title: m.title, slug: m.slug, type: 'movie' });
           }
         }

         const tvRes = await fetch(`${CDN_URLS.STATIC}/tv/index.1.ndjson`);
         if (tvRes.ok) {
           const tvText = await tvRes.text();
           const tvLines = tvText.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
           for (const t of tvLines) {
             await insert(db, { id: t.id.toString(), title: t.title, slug: t.slug, type: 'tv' });
           }
         }

         const results = await search(db, {
           term: input.term,
           properties: ['title'],
           threshold: 0.5 // typo tolerance
         });

         // Return matched documents
         return results.hits.map(h => h.document);
       } catch (error) {
         console.error("Orama search error:", error);
         return [];
       }
    }
  })
};

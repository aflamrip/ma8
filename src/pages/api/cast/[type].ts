import type { APIRoute } from 'astro';
import { CDN_URLS } from '../../../lib/constants';
import ndjsonStream from 'can-ndjson-stream';

export const GET: APIRoute = async ({ params, url }) => {
  const { type } = params;
  const actorName = url.searchParams.get('name')?.trim();
  
  if (!actorName || !type) {
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  }

  const isMovie = type === 'movie' || type === 'movies';
  const pluralType = isMovie ? 'movies' : 'tv';

  try {
    // Step 1: Fetch only 2 index pages (2 subrequests)
    const indexPromises = Array.from({ length: 2 }, (_, i) =>
      // @ts-ignore
      fetch(`${CDN_URLS.STATIC}/${pluralType}/index.${i + 1}.ndjson`, {
        cf: { cacheEverything: true, cacheTtl: 14400 }
      }).then(r => r.ok ? r : null).catch(() => null)
    );
    const indexResponses = await Promise.all(indexPromises);
    
    // Parse all index entries
    const allEntries: any[] = [];
    for (const res of indexResponses) {
      if (!res) continue;
      try {
        const stream = await ndjsonStream(res.body);
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.id) allEntries.push(value);
        }
      } catch {}
    }

    // Step 2: Limit detail fetches to 45 max (2 index + 45 detail = 47 total < 50 limit)
    const maxDetailFetches = 45;
    const entriesToCheck = allEntries.slice(0, maxDetailFetches);
    const matchedItems: any[] = [];

    // Single batch with Promise.allSettled (all 45 in parallel for speed)
    const detailPromises = entriesToCheck.map(async (entry: any) => {
      try {
        const id = entry.id.toString();
        const prefix = id.substring(0, 2);
        const detailUrl = `${CDN_URLS.STATIC}/${pluralType}/${prefix}/${id}/${id}.ndjson`;
        // @ts-ignore
        const res = await fetch(detailUrl, { cf: { cacheEverything: true, cacheTtl: 14400 } });
        if (!res.ok) return null;
        
        const stream = await ndjsonStream(res.body);
        const reader = stream.getReader();
        const { value: d } = await reader.read();
        if (!d) return null;
        
        const raw = d.data && typeof d.data === 'object' ? { ...d, ...d.data } : d;
        if (Array.isArray(raw.cast) && raw.cast.some((c: string) => c.trim() === actorName)) {
          return {
            id,
            slug: raw.slug || entry.slug,
            title: raw.title || entry.title,
            year: raw.year || entry.year,
            lang: raw.lang || entry.lang,
            type: raw.type || entry.type
          };
        }
        return null;
      } catch { return null; }
    });

    const results = await Promise.allSettled(detailPromises);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        matchedItems.push(r.value);
      }
    }

    return new Response(JSON.stringify(matchedItems), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=14400'
      }
    });
  } catch (e) {
    console.error('Cast API error:', e);
    return new Response(JSON.stringify([]), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

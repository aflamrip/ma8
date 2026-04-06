import { getSitemapData, getFullSiteUrl, GENRES_LIST, CDN_URLS, getPrefix } from '../lib/constants';

/** 
 * SCALABLE DYNAMIC SITEMAP ENGINE (Stable Version)
 * Rules:
 * 1. ALWAYS use numbering (e.g., sitemap-movies1.xml) for permanent indexing.
 * 2. This prevents URL changes when the site grows beyond page 1.
 */
export async function GET(context: any) {
  const { slug } = context.params;
  const currentSite = getFullSiteUrl(context);
  
  // Extract type and page number: e.g., 'sitemap-movies1', 'sitemap-pages1'
  const match = slug.match(/^([a-z-]+)(\d+)$/);
  if (!match) return new Response('Invalid Sitemap Param', { status: 404 });

  const [, rawType, pageNumStr] = match;
  const page = parseInt(pageNumStr, 10);
  const ITEMS_PER_SITEMAP = 50000;

  const typeKey = rawType.replace(/^sitemap-/, '');

  let urls: string[] = [];
  let isVideoMap = typeKey === 'video' || typeKey === 'video-sitemap';
  let xmlContent = "";

  try {
    if (typeKey === 'pages') {
      if (page > 1) return new Response('Range Out', { status: 404 });
      urls = [
        `${currentSite}/`, `${currentSite}/movie`, `${currentSite}/tv`, `${currentSite}/categories`, `${currentSite}/search`,
        ...GENRES_LIST.map(g => `${currentSite}/movie/category/${g.slug}`),
        ...GENRES_LIST.map(g => `${currentSite}/tv/category/${g.slug}`)
      ];
    } 
    else if (typeKey === 'movies' || isVideoMap) {
      const all = await getSitemapData('movie', 20);
      const totalPages = Math.max(1, Math.ceil(all.length / ITEMS_PER_SITEMAP));
      if (page > totalPages) return new Response('Range Out', { status: 404 });
      
      const chunk = all.slice((page - 1) * ITEMS_PER_SITEMAP, page * ITEMS_PER_SITEMAP);
      if (isVideoMap) {
        xmlContent = generateVideoXml(chunk, currentSite);
      } else {
        urls = chunk.map(m => `${currentSite}/movie/${m.data.slug}`);
      }
    } 
    else if (typeKey === 'series' || typeKey === 'tv') {
      const all = await getSitemapData('tv', 20);
      const totalPages = Math.max(1, Math.ceil(all.length / ITEMS_PER_SITEMAP));
      if (page > totalPages) return new Response('Range Out', { status: 404 });
      
      const chunk = all.slice((page - 1) * ITEMS_PER_SITEMAP, page * ITEMS_PER_SITEMAP);
      urls = chunk.map(t => `${currentSite}/tv/${t.data.slug}`);
    } 
    else if (typeKey === 'seasons' || typeKey === 'episodes') {
      const all = await getSitemapData('tv', 20);
      const totalPages = Math.max(1, Math.ceil(all.length / ITEMS_PER_SITEMAP));
      if (page > totalPages) return new Response('Range Out', { status: 404 });
      
      const chunk = all.slice((page - 1) * ITEMS_PER_SITEMAP, page * ITEMS_PER_SITEMAP);
      if (typeKey === 'seasons') {
        urls = chunk.map(t => `${currentSite}/tv/${t.data.slug}/s1`);
      } else {
        urls = chunk.map(t => `${currentSite}/tv/${t.data.slug}/s1/e1`);
      }
    }
    else if (typeKey === 'cast') {
      // Collect unique cast/director names from index data
      const movies = await getSitemapData('movie', 3);
      const tvShows = await getSitemapData('tv', 3);
      
      const castSet = new Set<string>();
      const directorSet = new Set<string>();
      
      for (const item of [...movies, ...tvShows]) {
        if (item.data.director) directorSet.add(item.data.director.trim());
        if (Array.isArray(item.data.cast)) {
          item.data.cast.forEach((name: string) => castSet.add(name.trim()));
        }
      }
      
      // Generate URLs for both movie and tv cast pages
      const allNames = new Set([...castSet, ...directorSet]);
      for (const name of allNames) {
        const encoded = encodeURIComponent(name);
        urls.push(`${currentSite}/movie/cast/${encoded}`);
        urls.push(`${currentSite}/tv/cast/${encoded}`);
      }
    }

    if (!xmlContent) {
      if (urls.length === 0) return new Response('Empty Partition', { status: 404 });
      xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map((url) => `<url><loc>${url}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`).join('')}
</urlset>`;
    }

    return new Response(xmlContent, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600'
      }
    });

  } catch (e) {
    return new Response('Sitemap Error', { status: 500 });
  }
}

function generateVideoXml(items: any[], site: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  ${items.map((item: any) => {
    const thumb = `${CDN_URLS.STATIC}/movies/${getPrefix(item.id)}/${item.id}/${item.id}.webp`;
    let ts = Number(item.data?.publish_date_timestamp || Date.now() / 1000);
    if (ts > 9999999999) ts = ts / 1000;
    const baseDate = new Date(ts * 1000);
    const saudiDate = new Date(baseDate.getTime() + (3 * 3600 * 1000));
    const pubDateIso = saudiDate.toISOString().replace('Z', '+03:00');
    return `<url><loc>${site}/movie/${item.data.slug}</loc><video:video><video:thumbnail_loc>${thumb}</video:thumbnail_loc><video:title>مشاهدة فيلم ${item.data.title}</video:title><video:description>${item.data.overview || item.data.title}</video:description><video:content_loc>${site}/movie/${item.data.slug}</video:content_loc><video:publication_date>${pubDateIso}</video:publication_date><video:family_friendly>yes</video:family_friendly></video:video></url>`;
  }).join('')}
</urlset>`;
}

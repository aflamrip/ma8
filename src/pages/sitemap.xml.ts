import { getFullSiteUrl, getSitemapData } from '../lib/constants';

/** 
 * PROFESSIONAL SCALABLE SITEMAP INDEX
 * Uses permanent numbering (e.g., sitemap-movies1.xml) to ensure 
 * URL stability and predictable crawling as the site grows.
 */
export async function GET(context: any) {
  try {
    const currentSite = getFullSiteUrl(context);
    const now = new Date().toISOString();

    const moviePages = 5; 
    const tvPages = 5;

    const getLinks = (type: string, totalPages: number) => {
      return Array.from({ length: totalPages }, (_, i) => `${currentSite}/sitemap-${type}${i + 1}.xml`);
    };

    const sitemaps = [
      `${currentSite}/sitemap-pages1.xml`,
      ...getLinks('movies', moviePages),
      ...getLinks('series', tvPages),
      ...getLinks('seasons', tvPages),
      ...getLinks('episodes', tvPages),
      ...Array.from({ length: moviePages }, (_, i) => `${currentSite}/video-sitemap${i + 1}.xml`),
      `${currentSite}/sitemap-cast1.xml`,
    ];

    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemaps.map(url => `
  <sitemap>
    <loc>${url}</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`).join('')}
</sitemapindex>
`;

    return new Response(sitemapIndex, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400'
      }
    });
  } catch (e: any) {
    return new Response(`DEBUG ERROR: ${e.message}\n${e.stack}`, { status: 500 });
  }
}

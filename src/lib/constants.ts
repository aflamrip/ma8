export const CDN_URLS = {
  STATIC: "https://static.mogcdn.com",
  VIDEO: "https://s001.mogcdn.com"
};

import ndjsonStream from 'can-ndjson-stream';

/** Compute CDN prefix from ID: first 2 digits. e.g. 1010857 → "10" */
export function getPrefix(id: string | number): string {
  return id.toString().substring(0, 2);
}

/** SSR Helper to fetch NDJSON indices from CDN without rebuild */
export async function getDynamicContent(type: 'movie' | 'tv', pageCount = 3) {
  try {
    const pluralType = type.startsWith('movie') ? 'movies' : 'tv';
    const pages = Array.from({ length: pageCount }, (_, i) => `index.${i + 1}.ndjson`);

    // 4- Server Island + Batch API (Concurrent dynamic requests)
    const fetchPromises = pages.map(file => {
      // 5- Cache + Edge
      // @ts-ignore - Cloudflare Worker options
      return fetch(`${CDN_URLS.STATIC}/${pluralType}/${file}`, {
        cf: { cacheEverything: true, cacheTtl: 14400 }
      }).then(r => r.ok ? r : null).catch(() => null);
    });

    const responses = await Promise.all(fetchPromises);
    const validResponses = responses.filter(r => r !== null) as Response[];

    const allItems: any[] = [];

    for (const res of validResponses) {
      try {
        const text = await res.text();
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        
        for (const line of lines) {
          try {
            const rawD = JSON.parse(line);
            if (rawD) {
              const raw = rawD.data && typeof rawD.data === 'object' ? { ...rawD, ...rawD.data } : rawD;
              const data: any = { ...raw };

              const findValue = (keys: string[]) => {
                for (const k of keys) {
                  if (raw[k]) return raw[k];
                }
                return null;
              };

              data.arabic_title = findValue(['title_ar', 'title-ar', 'arabic_title']);
              data['title-ar'] = data.arabic_title;
              data.original_title = raw.original_title || raw.name || '';
              data.title = raw.title || raw.name || '';
              data.lang = raw.lang || 'ar';

              const yearRaw = findValue(['year', 'release_date', 'date', 'published']) || '2026';
              data.year = yearRaw.toString().substring(0, 4);
              data.overview = findValue(['overview', 'plot', 'summary', 'description', 'story', 'info', 'qessa', 'content']) || '';
              data.genres = Array.isArray(raw.genres) ? raw.genres : (raw.genre ? [raw.genre] : []);
              data.slug = raw.slug || (data.title ? data.title.toLowerCase().replace(/\s+/g, '-') : '');
              data.director = raw.director || null;
              data.cast = Array.isArray(raw.cast) ? raw.cast : [];

              allItems.push({
                id: (raw.id || rawD.id || '').toString(),
                data
              });
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    return allItems;
  } catch (e) {
    console.error(`Error fetching dynamic indices (Batch API):`, e);
    return [];
  }
}

/** SSR Helper to find a specific item by slug across indices */
export async function getDynamicItemBySlug(type: 'movie' | 'tv', slug: string, pageCount = 10) {
  try {
    const pluralType = type.startsWith('movie') ? 'movies' : 'tv';

    // 4- Server Island + Batch API (Parallel fetch)
    const fetchPromises = Array.from({ length: pageCount }, (_, i) => {
      // 5- Cache + Edge
      // @ts-ignore - Cloudflare request options
      return fetch(`${CDN_URLS.STATIC}/${pluralType}/index.${i + 1}.ndjson`, {
        cf: { cacheEverything: true, cacheTtl: 14400 }
      }).then(r => r.ok ? r : null).catch(() => null);
    });
    const responses = await Promise.all(fetchPromises);
    const validResponses = responses.filter(r => r !== null) as Response[];

    // 3- Live Loader + can-ndjson-stream
    let foundInIndex: any = null;

    // 2- Content Layer Eager Search
    for (const res of validResponses) {
      if (foundInIndex) break;
      try {
        const stream = await ndjsonStream(res.body);
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Eager parsing match
          if (value && value.slug === slug) {
            foundInIndex = value;
            break;
          }
        }
      } catch (e) { }
    }

    if (foundInIndex) {
      const id = foundInIndex.id.toString();
      const prefix = getPrefix(id);

      const detailUrl = `${CDN_URLS.STATIC}/${pluralType}/${prefix}/${id}/${id}.ndjson`;

      try {
        // @ts-ignore - Cloudflare request options
        const detailRes = await fetch(detailUrl, { cf: { cacheEverything: true, cacheTtl: 14400 } });
        if (detailRes.ok) {
          const stream = await ndjsonStream(detailRes.body);
          const reader = stream.getReader();
          const { value: d } = await reader.read(); // Only need first line

          if (d) {
            const raw = d.data && typeof d.data === 'object' ? { ...d, ...d.data } : d;
            const data: any = { ...raw };
            const findValue = (keys: string[]) => {
              for (const k of keys) {
                if (raw[k]) return raw[k];
              }
              return null;
            };

            data.arabic_title = findValue(['title_ar', 'title-ar', 'arabic_title']);
            data.original_title = raw.title || raw.name || raw.original_title || foundInIndex.title || '';

            data.title = data.original_title;
            data.lang = raw.lang || (foundInIndex.lang) || 'ar';

            const yearRaw = findValue(['year', 'release_date', 'date', 'published']) || '2026';
            data.year = yearRaw.toString().substring(0, 4);
            data.overview = findValue(['overview', 'plot', 'summary', 'description', 'story', 'info', 'qessa', 'content']) || foundInIndex.overview || '';
            data.genres = Array.isArray(raw.genres) ? raw.genres : (raw.genre ? [raw.genre] : []);
            data.slug = raw.slug || slug;

            return { id, data };
          }
        }
      } catch {
        try {
          const cdnUrl = `${CDN_URLS.STATIC}/${pluralType}/${prefix}/${id}/cdn.ndjson`;
          // @ts-ignore - Cloudflare request options
          const cdnRes = await fetch(cdnUrl, { cf: { cacheEverything: true, cacheTtl: 14400 } });
          if (cdnRes.ok) {
            const stream = await ndjsonStream(cdnRes.body);
            const reader = stream.getReader();
            const { value: d } = await reader.read();
            if (d) {
              const raw = d.data && typeof d.data === 'object' ? { ...d, ...d.data } : d;
              return { id, data: { ...raw, slug } };
            }
          }
        } catch { }
      }

      // Ultimate fallback
      return { id, data: { ...foundInIndex, slug } };
    }
    return null;
  } catch (e) {
    console.error(`Error finding slug ${slug} (Stream API):`, e);
    return null;
  }
}

/** 40 SEO Promo Messages for Rotating Strategy */
export const SEO_PROMO_MESSAGES = [
  "يقدم موقع معاك سيما مكتبة متنوعة من الأفلام والمسلسلات العربية والأجنبية.",
  "استمتع بتجربة مشاهدة مريحة مع افلام معاك سيما بجودات متعددة.",
  "يوفر معاك سيما أحدث الأفلام والمسلسلات مع تحديث مستمر للمحتوى.",
  "يمكنك متابعة مسلسلات معاك سيما بسهولة ومن أي جهاز.",
  "يُعد معاك سيما من المواقع المميزة لعشاق الأفلام والمسلسلات.",
  "مشاهدة الأفلام والمسلسلات على موقع معاك سيما تتم بدون تعقيد.",
  "يضم معاك سيما مجموعة كبيرة من الأعمال الجديدة والقديمة.",
  "يتم تحديث افلام معاك سيما بشكل دوري لتقديم الأفضل دائمًا.",
  "يوفر موقع معاك سيما تجربة مشاهدة سلسة وسريعة.",
  "استكشف مكتبة مسلسلات معاك سيما المتنوعة في جميع التصنيفات.",
  "يتم إضافة حلقات المسلسلات الجديدة على معاك سيما أولًا بأول.",
  "يحرص موقع معاك سيما على تقديم محتوى يناسب جميع الأذواق.",
  "معاك سيما يوفر مشاهدة مباشرة للأفلام والمسلسلات أونلاين.",
  "يتميز معاك سيما بسهولة الاستخدام وسرعة التصفح.",
  "يمكنك الاعتماد على معاك سيما لمتابعة أحدث الأعمال الفنية.",
  "يوفر افلام معاك سيما خيارات مشاهدة بجودات مختلفة.",
  "مسلسلات معاك سيما متاحة للمتابعة في أي وقت.",
  "يقدم موقع معاك سيما محتوى متجدد لمحبي السينما والدراما.",
  "يضم معاك سيما أعمالًا عربية وأجنبية مترجمة.",
  "يمكنك مشاهدة الأفلام والمسلسلات عبر موقع ma3ak بسهولة.",
  "يركز موقع معاك سيما على راحة المستخدم أثناء المشاهدة.",
  "يتم تنظيم المحتوى على معاك سيما لتسهيل الوصول إليه.",
  "معاك سيما من المواقع التي تجمع بين البساطة والتنوع.",
  "يوفر معاك سيما مكتبة غنية من الأفلام والمسلسلات.",
  "مشاهدة افلام معاك سيما تتم عبر سيرفرات سريعة.",
  "يتيح موقع معاك سيما متابعة المسلسلات دون تقطيع.",
  "يتم تحديث محتوى معاك سيما باستمرار لإرضاء الزوار.",
  "يجمع معاك سيما بين أحدث الأعمال والكلاسيكيات.",
  "يمكنك اكتشاف أفلام ومسلسلات جديدة عبر معاك سيما.",
  "يهدف موقع معاك سيما لتقديم تجربة مشاهدة مميزة.",
  "افلام معاك سيما مناسبة لمحبي الأكشن والدراما والكوميديا.",
  "مسلسلات معاك سيما تشمل أعمالًا متنوعة من مختلف الدول.",
  "يوفر معاك سيما واجهة بسيطة وسهلة الاستخدام.",
  "يمكنك الاستمتاع بالمحتوى عبر معاك سيما في أي وقت.",
  "يهتم معاك سيما بتقديم تجربة مشاهدة مستقرة.",
  "معاك سيما خيار مناسب لمتابعة الأفلام والمسلسلات.",
  "يتم إضافة محتوى جديد إلى معاك سيما بشكل منتظم.",
  "يضم موقع معاك سيما مكتبة متجددة لمحبي المشاهدة أونلاين.",
  "يمكنك متابعة أحدث الإصدارات عبر افلام معاك سيما.",
  "معاك سيما منصة مشاهدة تجمع بين التنوع وسهولة الوصول."
];

export const GENRES_LIST = [
  { name: 'أكشن', slug: 'action', icon: '🔥' },
  { name: 'دراما', slug: 'drama', icon: '🎭' },
  { name: 'كوميدي', slug: 'comedy', icon: '😂' },
  { name: 'رعب', slug: 'horror', icon: '🎃' },
  { name: 'خيال علمي', slug: 'sci-fi', icon: '🚀' },
  { name: 'رومانسية', slug: 'romance', icon: '❤️' },
  { name: 'أنمي', slug: 'anime', icon: '🉐' },
  { name: 'جريمة', slug: 'crime', icon: '🔍' },
  { name: 'غموض', slug: 'mystery', icon: '🕵️' },
  { name: 'وثائقي', slug: 'documentary', icon: '🌎' },
  { name: 'عائلي', slug: 'family', icon: '🏠' },
  { name: 'مغامرة', slug: 'adventure', icon: '🗺️' },
  { name: 'إثارة', slug: 'thriller', icon: '⚡' },
];

export function getSeoPromo(id: string | number): string {
  const date = new Date();
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const hour = date.getHours();

  // Combine ID hash with day and hour for maximum variety every hour
  const idStr = id.toString();
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = ((hash << 5) - hash) + idStr.charCodeAt(i);
    hash |= 0; 
  }

  const index = Math.abs(dayOfYear + hour + hash) % SEO_PROMO_MESSAGES.length;
  return SEO_PROMO_MESSAGES[index];
}

/** Specialized fetcher for SiteMap & Feeds: fetches many more indices for maximum coverage */
export async function getSitemapData(type: 'movie' | 'tv', pageCount = 40) {
  const items = await getDynamicContent(type, pageCount);
  return items;
}

export function getFullSiteUrl(context: any): string {
  const site = context.site ? context.site.toString().replace(/\/$/, '') : 'https://ma3ak.top';
  return site;
}

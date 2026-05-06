import type { MetadataRoute } from 'next';
import type { ListDatasetsResponse } from '@oci/shared-types';
import { apiFetch } from '../lib/api';
import { siteUrl } from '../lib/site-url';

/**
 * `/sitemap.xml` — Next.js metadata route. Lists the public surface of
 * the site so Google + Bing can discover what to crawl. Anonymous fetch
 * to the catalog API guarantees we only enumerate PUBLIC + PUBLISHED
 * datasets (the API filters by visibility at source — see
 * `catalog.service.ts::visibilitiesFor`).
 *
 * Pagination: the catalog API caps `limit` at 100 and uses opaque
 * keyset cursors. We loop until `nextCursor` is null. There's a hard
 * page cap to bound runtime — Google rejects sitemaps over 50 000
 * URLs anyway, and we'd want a sitemap-index well before then.
 */
export const revalidate = 3600;

const MAX_PAGES = 500; // 500 × 100 = 50 000 URLs, the sitemap.org limit

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/catalog`, changeFrequency: 'daily', priority: 0.9 },
  ];

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);

    let response: ListDatasetsResponse | null;
    try {
      response = await apiFetch<ListDatasetsResponse>(`/v2/catalog/datasets?${qs.toString()}`, {
        revalidate: 3600,
      });
    } catch {
      // Don't fail the sitemap if the API is briefly unavailable —
      // Google will just see the static entries and re-fetch later.
      break;
    }
    if (!response) break;

    for (const d of response.items) {
      entries.push({
        url: `${base}/catalog/${d.slug}`,
        lastModified: new Date(d.updatedAt),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }

    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return entries;
}

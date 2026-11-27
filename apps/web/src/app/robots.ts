import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { siteUrl } from '../lib/site-url';

/**
 * `/robots.txt` — allow public surface, block authenticated app
 * routes (Cognito callback, dashboard, host workflow). Everything
 * the public catalog needs is under `/`, `/catalog/*`, `/sitemap.xml`.
 *
 * Rendered per request (`connection()`), not at build time: the file names
 * the site's own address, which exists only where the image runs (#831). A
 * file fixed at build time told every crawler the site was at localhost.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/catalog'],
        disallow: ['/api/', '/dashboard', '/auth/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

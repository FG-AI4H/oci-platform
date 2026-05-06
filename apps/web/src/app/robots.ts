import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site-url';

/**
 * `/robots.txt` — allow public surface, block authenticated app
 * routes (Cognito callback, dashboard, host workflow). Everything
 * the public catalog needs is under `/`, `/catalog/*`, `/sitemap.xml`.
 */
export default function robots(): MetadataRoute.Robots {
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

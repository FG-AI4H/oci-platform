/**
 * Returns the canonical public-facing URL of the web app, with no
 * trailing slash. Drives `metadataBase`, JSON-LD `@id` / `url`,
 * sitemap entries, and robots policy.
 *
 * `NEXT_PUBLIC_SITE_URL` is set per environment (dev / int / prod) by
 * the CDK web-stack outputs. Locally, `.env.local` defaults to
 * `http://localhost:3001`. Throws when missing so we fail loudly in
 * deploy rather than silently emit `undefined`-prefixed canonicals.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) {
    throw new Error('NEXT_PUBLIC_SITE_URL not set in web container env');
  }
  return raw.replace(/\/+$/, '');
}

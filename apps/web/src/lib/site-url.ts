/**
 * The public address of the web app, with no trailing slash. Drives
 * `metadataBase`, the JSON-LD `@id` / `url` of a dataset or a model, the
 * sitemap entries and the robots policy: what search engines and Croissant
 * harvesters follow to reach us.
 *
 * Read when a request is served, never fixed when the image is built, so one
 * image serves every environment (#831):
 *
 *   1. `NEXT_PUBLIC_SITE_URL`, set per environment by the CDK web stack;
 *   2. else `AUTH_URL`, which the same stack sets to the same address for the
 *      sign-in callbacks;
 *   3. else, on a deployed environment, an error. Publishing
 *      `http://localhost:3001` as our own address sends every crawler and
 *      harvester nowhere, and nothing on the page shows it;
 *   4. else `http://localhost:3001`: a laptop, a test run, or `next build`,
 *      which collects page data before any environment exists.
 */
const LOCAL = 'http://localhost:3001';
const DEPLOYED: ReadonlySet<string> = new Set(['dev', 'int', 'prod']);

type Env = Readonly<Record<string, string | undefined>>;

export function siteUrl(env: Env = process.env): string {
  const configured = [env.NEXT_PUBLIC_SITE_URL, env.AUTH_URL]
    .map((value) => value?.trim() ?? '')
    .find((value) => value.length > 0);
  if (configured) return configured.replace(/\/+$/, '');

  const building = env.NEXT_PHASE === 'phase-production-build';
  if (!building && DEPLOYED.has(env.OCI_ENV ?? '')) {
    throw new Error(
      `The site address is not configured on "${env.OCI_ENV}": set NEXT_PUBLIC_SITE_URL (or AUTH_URL) on the web container`,
    );
  }
  return LOCAL;
}

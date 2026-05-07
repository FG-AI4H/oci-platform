import { validate as validateCroissant } from '@oci/croissant';
import type { Logger } from 'pino';
import type { PrismaClient } from '@oci/database';

/**
 * One harvest cycle for the federation worker (PR E.3).
 *
 * For each `RemoteCatalog` row that's due for harvest:
 *   1. Optimistically claim it by transitioning IDLE / SUCCEEDED /
 *      FAILED → RUNNING in a single `updateMany`. A stale row whose
 *      `updatedAt` has moved (another worker already claimed it) is
 *      detected by row count and skipped, so two workers can run in
 *      the same cluster without coordinating.
 *   2. Fetch `<endpointUrl>/.well-known/croissant-catalog.json` — the
 *      same shape this platform itself serves (PR C). Each entry
 *      lists a child dataset by its `@id` URL.
 *   3. For each child URL, fetch the manifest, validate via
 *      `@oci/croissant`, and upsert a `RemoteDataset` keyed by
 *      `(sourceCatalogId, originUrl)`.
 *   4. Mark the peer SUCCEEDED with `lastHarvestedAt = now`, or
 *      FAILED + `lastError = "<message>"` on any throw.
 *
 * The function is idempotent: re-running it never duplicates rows.
 * `RemoteDataset.harvestedAt` is bumped on every successful upsert
 * so the federated list (PR E.2) shows recently-refreshed peers
 * first.
 *
 * Pure(-ish) for testability: takes its `fetch` impl as an argument
 * so vitest can swap in a stub. The Prisma client is also passed in
 * — production wires it from the lazy `@oci/database` singleton; tests
 * use a manually-constructed mock.
 */
export interface HarvestDeps {
  prisma: PrismaClient;
  fetchImpl: typeof fetch;
  logger: Logger;
  /**
   * Rows older than this are due for harvest. Defaults to 30 minutes
   * — fine for dev (the worker runs continuously) and can be tuned
   * via env in prod (`HARVEST_INTERVAL_MINUTES`).
   */
  intervalMs: number;
  /** Per-fetch timeout (ms). Defaults to 30s. */
  fetchTimeoutMs: number;
}

export interface HarvestSummary {
  peersConsidered: number;
  peersHarvested: number;
  datasetsUpserted: number;
  failures: number;
}

interface CroissantCatalogIndex {
  '@type'?: string;
  dataset?: Array<{ '@id'?: string }>;
}

const CONTEXT_FETCH_HEADERS: Record<string, string> = {
  Accept: 'application/ld+json, application/json',
  'User-Agent': 'oci-platform-federation-harvester/1.0 (+https://oci.ai4h.net)',
};

export async function runOneHarvestCycle(deps: HarvestDeps): Promise<HarvestSummary> {
  const summary: HarvestSummary = {
    peersConsidered: 0,
    peersHarvested: 0,
    datasetsUpserted: 0,
    failures: 0,
  };

  const dueBefore = new Date(Date.now() - deps.intervalMs);
  const candidates = await deps.prisma.remoteCatalog.findMany({
    where: {
      harvestStatus: { not: 'RUNNING' },
      OR: [{ lastHarvestedAt: null }, { lastHarvestedAt: { lt: dueBefore } }],
    },
    orderBy: { lastHarvestedAt: { sort: 'asc', nulls: 'first' } },
    take: 25,
  });
  summary.peersConsidered = candidates.length;

  for (const peer of candidates) {
    // Optimistic claim. If another process already moved this row out
    // of its previous status, the updateMany returns 0 and we skip.
    const claim = await deps.prisma.remoteCatalog.updateMany({
      where: {
        id: peer.id,
        harvestStatus: peer.harvestStatus,
        // updatedAt guard prevents a race when two workers both saw
        // the same harvestStatus.
        updatedAt: peer.updatedAt,
      },
      data: { harvestStatus: 'RUNNING', lastError: null },
    });
    if (claim.count === 0) {
      deps.logger.debug({ peer: peer.slug }, 'harvest:claim-lost');
      continue;
    }

    try {
      const datasetsUpserted = await harvestPeer(peer, deps);
      summary.peersHarvested += 1;
      summary.datasetsUpserted += datasetsUpserted;

      await deps.prisma.remoteCatalog.update({
        where: { id: peer.id },
        data: {
          harvestStatus: 'SUCCEEDED',
          lastHarvestedAt: new Date(),
          lastError: null,
        },
      });
      deps.logger.info({ peer: peer.slug, datasetsUpserted }, 'harvest:peer-succeeded');
    } catch (err) {
      summary.failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      await deps.prisma.remoteCatalog.update({
        where: { id: peer.id },
        data: {
          harvestStatus: 'FAILED',
          lastHarvestedAt: new Date(),
          lastError: message.slice(0, 2000),
        },
      });
      deps.logger.warn({ peer: peer.slug, err: message }, 'harvest:peer-failed');
    }
  }

  return summary;
}

/** Fetch + validate + upsert. Returns number of rows written. */
async function harvestPeer(
  peer: { id: string; slug: string; endpointUrl: string },
  deps: HarvestDeps,
): Promise<number> {
  // The peer's catalog index. Format matches what we serve at
  // `/v2/catalog/.well-known/croissant-catalog.json` (PR C).
  const indexUrl = trimSlash(peer.endpointUrl) + '/.well-known/croissant-catalog.json';
  const index = (await fetchJsonLd(deps, indexUrl)) as CroissantCatalogIndex;
  const entries = Array.isArray(index?.dataset) ? index.dataset : [];

  let upserted = 0;
  for (const entry of entries) {
    const originUrl = typeof entry?.['@id'] === 'string' ? entry['@id'] : null;
    if (!originUrl) continue;

    // Two conventions for "where the manifest lives":
    //   1. The peer's `@id` IS the manifest URL (some catalogues do this).
    //   2. The peer's `@id` is the dataset's canonical page; the manifest
    //      lives at `<@id>/croissant` (this platform — see PR C).
    // Try (2) first since it's our convention; fall back to (1) so we
    // also work against peers that pack the manifest behind `@id`.
    let manifest: unknown;
    try {
      manifest = await fetchManifest(deps, originUrl);
    } catch (err) {
      // One bad manifest doesn't fail the whole peer; log and continue.
      deps.logger.warn(
        { peer: peer.slug, originUrl, err: err instanceof Error ? err.message : err },
        'harvest:manifest-fetch-failed',
      );
      continue;
    }

    const result = validateCroissant(manifest);
    if (!result.ok) {
      deps.logger.warn(
        { peer: peer.slug, originUrl, conformance: result.conformance },
        'harvest:manifest-validation-failed',
      );
      continue;
    }

    const fields = extractManifestFields(manifest, originUrl);
    await deps.prisma.remoteDataset.upsert({
      where: {
        sourceCatalogId_originUrl: { sourceCatalogId: peer.id, originUrl },
      },
      create: {
        sourceCatalogId: peer.id,
        originUrl,
        slug: fields.slug,
        name: fields.name,
        description: fields.description,
        conformanceVersion: result.conformance === 'croissant-1.1' ? '1.1' : '1.0',
        version: fields.version,
        croissant: manifest as object,
      },
      update: {
        slug: fields.slug,
        name: fields.name,
        description: fields.description,
        conformanceVersion: result.conformance === 'croissant-1.1' ? '1.1' : '1.0',
        version: fields.version,
        croissant: manifest as object,
        harvestedAt: new Date(),
      },
    });
    upserted += 1;
  }

  return upserted;
}

/**
 * Fetch the Croissant manifest for a dataset entry. Tries the
 * `<@id>/croissant` URL first (our platform's convention — see the
 * federation index in PR C / catalog.service.ts); falls back to
 * fetching `@id` directly if the suffixed URL 404s. This lets the
 * harvester work against both this platform AND peers that stash
 * the manifest at `@id` itself.
 */
async function fetchManifest(deps: HarvestDeps, originUrl: string): Promise<unknown> {
  const trimmed = trimSlash(originUrl);
  const suffixed = `${trimmed}/croissant`;
  try {
    return await fetchJsonLd(deps, suffixed);
  } catch (err) {
    // Only fall back on 404. Network errors / 5xx propagate.
    if (err instanceof Error && /HTTP 404/.test(err.message)) {
      return fetchJsonLd(deps, originUrl);
    }
    throw err;
  }
}

async function fetchJsonLd(deps: HarvestDeps, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.fetchTimeoutMs);
  try {
    const res = await deps.fetchImpl(url, {
      headers: CONTEXT_FETCH_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

interface ManifestFields {
  slug: string;
  name: string;
  description: string | null;
  version: string | null;
}

function extractManifestFields(manifest: unknown, originUrl: string): ManifestFields {
  // Slug priority:
  //   1. The peer's index entry URL (originUrl) — last path segment.
  //      The federation index our platform serves uses `<base>/v2/catalog/datasets/<slug>`,
  //      and most peer catalogues follow the same shape (HuggingFace's
  //      `<base>/datasets/<owner>/<name>` lands on `<name>` which is fine).
  //   2. The manifest's `alternateName` — only used when the URL tail
  //      isn't a meaningful slug ("croissant", numeric ids, etc.).
  //   3. The literal "_unknown" fallback.
  const segments = originUrl.split(/[?#]/)[0]!.split('/').filter(Boolean);
  // Skip a trailing "croissant" segment — that's our convention for
  // the manifest URL, not a meaningful slug.
  while (segments.length > 0 && segments[segments.length - 1] === 'croissant') {
    segments.pop();
  }
  const urlTail = segments.length > 0 ? segments[segments.length - 1]! : '';

  if (!manifest || typeof manifest !== 'object') {
    return {
      slug: urlTail || '_unknown',
      name: urlTail || 'Unknown',
      description: null,
      version: null,
    };
  }
  const m = manifest as Record<string, unknown>;
  // The keys here are compile-time literals — eslint's
  // detect-object-injection can't see that, so use Reflect.get with
  // a literal-typed key to silence the rule (same pattern as
  // dataset-jsonld in the web app).
  type ManifestKey = 'alternateName' | 'name' | 'description' | 'version';
  const get = (key: ManifestKey): unknown =>
    Reflect.get(m, key) ?? Reflect.get(m, `sc:${key}`);
  const altName = get('alternateName');
  const slugBase =
    typeof altName === 'string' && altName.length > 0 ? altName : urlTail || '_unknown';
  const slug = slugBase.toLowerCase().slice(0, 80);
  const name = String(get('name') ?? slug);
  const descRaw = get('description');
  const description =
    typeof descRaw === 'string' && descRaw.length > 0 ? descRaw.slice(0, 4000) : null;
  const versionRaw = get('version');
  const version = typeof versionRaw === 'string' ? versionRaw : null;
  return { slug, name, description, version };
}

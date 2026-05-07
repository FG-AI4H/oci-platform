import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import type { PrismaClient } from '@oci/database';
import { runOneHarvestCycle, type HarvestDeps } from './harvest.js';

interface PeerRow {
  id: string;
  slug: string;
  endpointUrl: string;
  harvestStatus: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  lastHarvestedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

function silentLogger(): Logger {
  // Pino has too much surface to mock cleanly; spy-able stand-in.
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
    child: vi.fn(),
  } as unknown as Logger;
}

interface PrismaMock {
  remoteCatalog: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  remoteDataset: { upsert: ReturnType<typeof vi.fn> };
}

function makePrisma(): PrismaMock {
  return {
    remoteCatalog: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    remoteDataset: { upsert: vi.fn() },
  };
}

function makeDeps(prisma: PrismaMock, fetchImpl: typeof fetch): HarvestDeps {
  return {
    prisma: prisma as unknown as PrismaClient,
    fetchImpl,
    logger: silentLogger(),
    intervalMs: 30 * 60 * 1000,
    fetchTimeoutMs: 5_000,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/ld+json' },
    ...init,
  });
}

const peer: PeerRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'demo-peer',
  endpointUrl: 'https://peer.example.org/v2/catalog',
  harvestStatus: 'IDLE',
  lastHarvestedAt: null,
  lastError: null,
  updatedAt: new Date('2026-05-07T00:00:00Z'),
};

// Minimal-but-Croissant-valid fixture: matches the validator's
// required set (name, description, license, url, creator, datePublished
// — see packages/croissant/src/croissant10/schema.ts). The validator
// runs on every harvested manifest before upsert, so the fixture has
// to clear it.
const validManifest = {
  '@context': 'https://schema.org/',
  '@type': 'sc:Dataset',
  '@id': 'https://peer.example.org/datasets/demo',
  'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
  name: 'Demo dataset',
  description: 'A federated demo.',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://peer.example.org/datasets/demo',
  creator: { '@type': 'Organization', name: 'Demo Peer Org' },
  datePublished: '2026-05-01',
  version: '1.2.3',
};

describe('runOneHarvestCycle', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrisma();
    // updateMany returns count: 1 by default (claim succeeds)
    prisma.remoteCatalog.updateMany.mockResolvedValue({ count: 1 });
    prisma.remoteCatalog.update.mockResolvedValue({});
    prisma.remoteDataset.upsert.mockResolvedValue({});
  });

  it('upserts a federated row when the peer returns a valid index + manifest', async () => {
    prisma.remoteCatalog.findMany.mockResolvedValue([peer]);

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/.well-known/croissant-catalog.json')) {
        return jsonResponse({
          '@type': 'sc:DataCatalog',
          dataset: [{ '@id': 'https://peer.example.org/datasets/demo' }],
        });
      }
      if (url === 'https://peer.example.org/datasets/demo') {
        return jsonResponse(validManifest);
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await runOneHarvestCycle(makeDeps(prisma, fetchImpl));
    expect(summary).toEqual({
      peersConsidered: 1,
      peersHarvested: 1,
      datasetsUpserted: 1,
      failures: 0,
    });
    expect(prisma.remoteDataset.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.remoteDataset.upsert.mock.calls[0]![0];
    expect(upsertArgs.where.sourceCatalogId_originUrl).toEqual({
      sourceCatalogId: peer.id,
      originUrl: 'https://peer.example.org/datasets/demo',
    });
    expect(upsertArgs.create.name).toBe('Demo dataset');
    // Final status update transitions RUNNING → SUCCEEDED
    const finalUpdate = prisma.remoteCatalog.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.harvestStatus).toBe('SUCCEEDED');
    expect(finalUpdate.data.lastError).toBeNull();
  });

  it('marks the peer FAILED when the index URL is unreachable', async () => {
    prisma.remoteCatalog.findMany.mockResolvedValue([peer]);

    const fetchImpl = vi.fn(
      async () => new Response('boom', { status: 502 }),
    ) as unknown as typeof fetch;
    const summary = await runOneHarvestCycle(makeDeps(prisma, fetchImpl));

    expect(summary.peersHarvested).toBe(0);
    expect(summary.failures).toBe(1);
    expect(prisma.remoteDataset.upsert).not.toHaveBeenCalled();
    const finalUpdate = prisma.remoteCatalog.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data.harvestStatus).toBe('FAILED');
    expect(finalUpdate.data.lastError).toMatch(/HTTP 502/);
  });

  it('skips invalid manifests but keeps harvesting the rest of the peer', async () => {
    prisma.remoteCatalog.findMany.mockResolvedValue([peer]);

    // The harvester tries `<@id>/croissant` first and falls back to
    // `<@id>` on 404. The stub mirrors that: bad manifest is served
    // only at `<@id>/croissant`; demo is served at `<@id>/croissant`
    // too. Bare `<@id>` returns 404 for both so the fallback is
    // exercised on a third peer entry that 404s everywhere.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/.well-known/croissant-catalog.json')) {
        return jsonResponse({
          dataset: [
            { '@id': 'https://peer.example.org/datasets/bad' },
            { '@id': 'https://peer.example.org/datasets/demo' },
          ],
        });
      }
      if (url === 'https://peer.example.org/datasets/bad/croissant') {
        // Missing conformsTo + required fields → croissant validator rejects.
        return jsonResponse({ '@type': 'sc:Dataset', name: 'oops' });
      }
      if (url === 'https://peer.example.org/datasets/demo/croissant') {
        return jsonResponse(validManifest);
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await runOneHarvestCycle(makeDeps(prisma, fetchImpl));
    expect(summary.peersHarvested).toBe(1);
    expect(summary.datasetsUpserted).toBe(1);
    expect(prisma.remoteDataset.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips a peer when the optimistic claim is lost to another worker', async () => {
    prisma.remoteCatalog.findMany.mockResolvedValue([peer]);
    prisma.remoteCatalog.updateMany.mockResolvedValue({ count: 0 });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const summary = await runOneHarvestCycle(makeDeps(prisma, fetchImpl));

    expect(summary.peersConsidered).toBe(1);
    expect(summary.peersHarvested).toBe(0);
    expect(summary.failures).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.remoteCatalog.update).not.toHaveBeenCalled();
  });

  it('returns an empty summary when no peers are due', async () => {
    prisma.remoteCatalog.findMany.mockResolvedValue([]);
    const summary = await runOneHarvestCycle(makeDeps(prisma, vi.fn() as unknown as typeof fetch));
    expect(summary).toEqual({
      peersConsidered: 0,
      peersHarvested: 0,
      datasetsUpserted: 0,
      failures: 0,
    });
  });
});

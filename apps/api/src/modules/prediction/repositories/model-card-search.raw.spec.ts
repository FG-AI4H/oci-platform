import type { Prisma, PrismaClient } from '@oci/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  searchPublishedModelCards,
  type SearchPublishedModelCardsArgs,
} from './model-card-search.raw.js';

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'acme-triage-v1',
  model_class: 'lmm',
  version_major_minor_patch: '1.0.0',
  model_developer: 'Acme Health AI GmbH',
  clinical_summary: null,
  medical_purpose: 'triage',
  risk_tier: 'III',
  generative_ai: true,
  training_data_jurisdictions: ['CH', 'EU'],
  regulatory_status: 'granted',
  created_at: new Date('2026-07-26T00:00:00.000Z'),
  updated_at: new Date('2026-07-27T00:00:00.000Z'),
};

let queryRaw: ReturnType<typeof vi.fn>;
let client: PrismaClient;

beforeEach(() => {
  queryRaw = vi
    .fn()
    .mockResolvedValueOnce([ROW])
    .mockResolvedValueOnce([{ total: 1n }]);
  client = { $queryRaw: queryRaw } as unknown as PrismaClient;
});

function args(over: Partial<SearchPublishedModelCardsArgs> = {}): SearchPublishedModelCardsArgs {
  return { sort: 'recent', offset: 0, limit: 25, ...over };
}

/** The rows query and the count query, as Prisma would send them. */
function sent(): { rows: Prisma.Sql; count: Prisma.Sql } {
  return {
    rows: queryRaw.mock.calls[0]![0] as Prisma.Sql,
    count: queryRaw.mock.calls[1]![0] as Prisma.Sql,
  };
}

const squash = (sql: string) => sql.replace(/\s+/g, ' ');

describe('searchPublishedModelCards (#591)', () => {
  it('restricts both the page and the count to PUBLISHED cards with no filters set', async () => {
    await searchPublishedModelCards(client, args());

    const { rows, count } = sent();
    expect(squash(rows.sql)).toContain(`WHERE m.status = 'PUBLISHED'`);
    expect(squash(count.sql)).toContain(`WHERE m.status = 'PUBLISHED'`);
    expect(rows.sql).not.toContain('ILIKE');
    expect(rows.sql).not.toContain('model_class =');
  });

  it('maps rows to the public summary shape, with no submitter field', async () => {
    const out = await searchPublishedModelCards(client, args());

    expect(out.total).toBe(1);
    expect(out.rows[0]).toEqual({
      id: ROW.id,
      slug: 'acme-triage-v1',
      modelClass: 'lmm',
      versionMajorMinorPatch: '1.0.0',
      modelDeveloper: 'Acme Health AI GmbH',
      clinicalSummary: null,
      medicalPurpose: 'triage',
      riskTier: 'III',
      generativeAi: true,
      trainingDataJurisdictions: ['CH', 'EU'],
      regulatoryApprovalStatus: 'granted',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    });
    expect(out.rows[0]).not.toHaveProperty('submitterUserId');
    expect(squash(sent().rows.sql)).not.toContain('submitter_user_id');
  });

  it('q searches slug, developer, clinical summary and IUS string values, escaping LIKE wildcards', async () => {
    await searchPublishedModelCards(client, args({ q: '50%_off' }));

    const { rows, count } = sent();
    const sql = squash(rows.sql);
    expect(sql).toContain('m.slug ILIKE');
    expect(sql).toContain('m.model_developer ILIKE');
    expect(sql).toContain('m.clinical_summary ILIKE');
    // IUS values only, not keys — "purpose" must not match every card.
    expect(sql).toContain(`jsonb_path_query(m.intended_use, 'strict $.**')`);
    expect(sql).toContain(`jsonb_typeof(v) = 'string'`);
    expect(rows.values).toContain('%50\\%\\_off%');
    expect(count.values).toContain('%50\\%\\_off%');
  });

  it('modelClass is an equality filter', async () => {
    await searchPublishedModelCards(client, args({ modelClass: 'foundation' }));

    const { rows } = sent();
    expect(squash(rows.sql)).toContain('AND m.model_class =');
    expect(rows.values).toContain('foundation');
  });

  it('jurisdiction matches training-data or regulatory-approval jurisdictions, case-insensitively', async () => {
    await searchPublishedModelCards(client, args({ jurisdiction: 'ch' }));

    const { rows, count } = sent();
    const sql = squash(rows.sql);
    expect(sql).toContain('unnest(m.training_data_jurisdictions)');
    expect(sql).toContain(`m.regulatory_approval -> 'jurisdictions'`);
    expect(sql).toContain('upper(j) = upper(');
    expect(rows.values).toContain('ch');
    expect(count.values).toContain('ch');
  });

  it.each([
    ['recent', 'ORDER BY m.updated_at DESC, m.id DESC'],
    ['name', 'ORDER BY m.slug ASC, m.id ASC'],
    ['oldest', 'ORDER BY m.created_at ASC, m.id ASC'],
  ] as const)('sort=%s orders by %s', async (sort, order) => {
    await searchPublishedModelCards(client, args({ sort }));

    expect(squash(sent().rows.sql)).toContain(order);
  });

  it('pages with LIMIT/OFFSET', async () => {
    await searchPublishedModelCards(client, args({ offset: 50, limit: 25 }));

    const { rows } = sent();
    expect(squash(rows.sql)).toContain('LIMIT ? OFFSET ?');
    expect(rows.values.slice(-2)).toEqual([25, 50]);
  });
});

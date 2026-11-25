import { describe, expect, it } from 'vitest';
import type { ModelCardStatus, MyModelCardSummary } from '@oci/shared-types';
import { modelCardOptions, modelCardRefusalOf, readModelCardChoice } from './model-card-choice';

const ID = {
  draft: '11111111-1111-4111-8111-111111111111',
  submitted: '22222222-2222-4222-8222-222222222222',
  published: '33333333-3333-4333-8333-333333333333',
  withdrawn: '44444444-4444-4444-8444-444444444444',
};

function card(
  status: ModelCardStatus,
  id: string,
  slug = status.toLowerCase(),
): MyModelCardSummary {
  return {
    id,
    slug,
    versionMajorMinorPatch: '1.2.0',
    modelClass: 'classical',
    status,
    medicalPurpose: 'diagnosis',
    riskTier: 'III',
    updatedAt: '2026-11-20T10:00:00.000Z',
  };
}

const mine = [
  card('PUBLISHED', ID.published),
  card('WITHDRAWN', ID.withdrawn),
  card('DRAFT', ID.draft),
  card('SUBMITTED', ID.submitted),
];

describe('modelCardOptions (#587)', () => {
  it('offers every card of the caller except the withdrawn ones, in the API order', () => {
    expect(modelCardOptions(mine)).toEqual([
      { id: ID.published, slug: 'published', version: '1.2.0', status: 'PUBLISHED' },
      { id: ID.draft, slug: 'draft', version: '1.2.0', status: 'DRAFT' },
      { id: ID.submitted, slug: 'submitted', version: '1.2.0', status: 'SUBMITTED' },
    ]);
  });

  it('offers nothing when the caller has no card, or only withdrawn ones', () => {
    expect(modelCardOptions([])).toEqual([]);
    expect(modelCardOptions([card('WITHDRAWN', ID.withdrawn)])).toEqual([]);
  });

  it('keeps the linked card first when it has been withdrawn since', () => {
    const current = {
      id: ID.withdrawn,
      slug: 'withdrawn',
      version: '1.2.0',
      status: 'WITHDRAWN' as const,
    };
    const options = modelCardOptions(mine, current);
    expect(options.map((o) => o.id)).toEqual([ID.withdrawn, ID.published, ID.draft, ID.submitted]);
  });

  it('does not list the linked card twice when it is still linkable', () => {
    const current = { id: ID.draft, slug: 'draft', version: '1.2.0', status: 'DRAFT' as const };
    expect(modelCardOptions(mine, current).map((o) => o.id)).toEqual([
      ID.published,
      ID.draft,
      ID.submitted,
    ]);
  });
});

describe('readModelCardChoice (#587)', () => {
  it('reads the empty value and a missing field as no card', () => {
    expect(readModelCardChoice('')).toEqual({ ok: true, modelCardId: null });
    expect(readModelCardChoice(null)).toEqual({ ok: true, modelCardId: null });
  });

  it('reads a card id', () => {
    expect(readModelCardChoice(ID.draft)).toEqual({ ok: true, modelCardId: ID.draft });
    expect(readModelCardChoice(ID.draft.toUpperCase())).toEqual({
      ok: true,
      modelCardId: ID.draft,
    });
  });

  it('refuses anything that is not a card id', () => {
    expect(readModelCardChoice('chest-xr-triage')).toEqual({ ok: false });
    expect(readModelCardChoice(new File(['x'], 'x.txt'))).toEqual({ ok: false });
  });
});

describe('modelCardRefusalOf (#587)', () => {
  it('names the refusal behind each status the API uses for a card', () => {
    expect(modelCardRefusalOf(404)).toBe('notFound');
    expect(modelCardRefusalOf(403)).toBe('notYours');
    expect(modelCardRefusalOf(409)).toBe('withdrawn');
  });

  it('is null for any other status', () => {
    for (const status of [200, 400, 401, 413, 500]) expect(modelCardRefusalOf(status)).toBeNull();
  });
});

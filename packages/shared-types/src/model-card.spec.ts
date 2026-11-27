import { describe, expect, it } from 'vitest';
import {
  CreateModelCardRequestSchema,
  ListModelCardsQuerySchema,
  MAX_MODEL_CARD_DATASET_REFS,
  ModelCardDatasetRefInputSchema,
  ModelCardSlugSchema,
  UpdateModelCardRequestSchema,
  LinkSubmissionModelCardRequestSchema,
  canEditModelCard,
  isModelCardReviewerGroups,
  modelCardLinkRefusal,
  modelCardMovesFor,
  modelCardVisibleTo,
  type ModelCardStatus,
} from './model-card.js';

describe('CreateModelCardRequestSchema slug (#651)', () => {
  it('refuses a reserved slug that a web route would shadow', () => {
    expect(CreateModelCardRequestSchema.shape.slug.safeParse('new').success).toBe(false);
  });

  it('accepts an ordinary slug', () => {
    expect(CreateModelCardRequestSchema.shape.slug.safeParse('new-chest-triage').success).toBe(
      true,
    );
  });
});

describe('UpdateModelCardRequestSchema (#651)', () => {
  it('accepts a partial body and adds no defaults', () => {
    expect(UpdateModelCardRequestSchema.parse({ clinicalSummary: 'Flags pneumothorax.' })).toEqual({
      clinicalSummary: 'Flags pneumothorax.',
    });
  });

  it('refuses an empty body', () => {
    expect(UpdateModelCardRequestSchema.safeParse({}).success).toBe(false);
  });

  it.each([{ slug: 'renamed' }, { parentModelCardId: null }, { status: 'PUBLISHED' }])(
    'refuses a field that is not editable: %o',
    (body) => {
      expect(UpdateModelCardRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('model-card lifecycle permissions (#651)', () => {
  const submitter = { isSubmitter: true, isReviewer: false };
  const reviewer = { isSubmitter: false, isReviewer: true };
  const selfReviewer = { isSubmitter: true, isReviewer: true };
  const stranger = { isSubmitter: false, isReviewer: false };

  it('lets only the submitter submit a draft', () => {
    expect(modelCardMovesFor('DRAFT', submitter)).toEqual(['SUBMITTED']);
    expect(modelCardMovesFor('DRAFT', reviewer)).toEqual([]);
    expect(modelCardMovesFor('DRAFT', stranger)).toEqual([]);
  });

  it('lets a reviewer publish someone else’s submission, never their own', () => {
    expect(modelCardMovesFor('SUBMITTED', reviewer)).toEqual(['PUBLISHED', 'DRAFT']);
    expect(modelCardMovesFor('SUBMITTED', selfReviewer)).toEqual(['DRAFT']);
    expect(modelCardMovesFor('SUBMITTED', submitter)).toEqual(['DRAFT']);
  });

  it('lets the submitter or a reviewer withdraw a published card', () => {
    expect(modelCardMovesFor('PUBLISHED', submitter)).toEqual(['WITHDRAWN']);
    expect(modelCardMovesFor('PUBLISHED', reviewer)).toEqual(['WITHDRAWN']);
    expect(modelCardMovesFor('PUBLISHED', stranger)).toEqual([]);
    expect(modelCardMovesFor('WITHDRAWN', selfReviewer)).toEqual([]);
  });

  it('allows editing a DRAFT by its submitter only', () => {
    expect(canEditModelCard('DRAFT', submitter)).toBe(true);
    expect(canEditModelCard('DRAFT', selfReviewer)).toBe(true);
    expect(canEditModelCard('DRAFT', reviewer)).toBe(false);
    expect(canEditModelCard('SUBMITTED', submitter)).toBe(false);
    expect(canEditModelCard('PUBLISHED', submitter)).toBe(false);
  });

  it('treats evaluation-reviewer and admin as reviewers', () => {
    expect(isModelCardReviewerGroups(['evaluation-reviewer'])).toBe(true);
    expect(isModelCardReviewerGroups(['admin'])).toBe(true);
    expect(isModelCardReviewerGroups(['host', 'participant'])).toBe(false);
  });
});

describe('ListModelCardsQuerySchema (#591)', () => {
  it('applies the defaults', () => {
    expect(ListModelCardsQuerySchema.parse({})).toEqual({ sort: 'recent', page: 1, limit: 25 });
  });

  it.each([
    ['q', { q: 'a\0b' }],
    ['jurisdiction', { jurisdiction: 'E\0U' }],
  ])('rejects a NUL byte in %s — Postgres would 500 on it', (_field, input) => {
    expect(ListModelCardsQuerySchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { limit: '101' },
    { page: '0' },
    { sort: 'slug; DROP TABLE x' },
    { modelClass: "lmm'--" },
    { q: 'a'.repeat(201) },
  ])('rejects out-of-range or unknown input %o', (input) => {
    expect(ListModelCardsQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('ModelCardSlugSchema (#591)', () => {
  it('accepts a slug', () => {
    expect(ModelCardSlugSchema.parse('demo-retina-dr-grader')).toBe('demo-retina-dr-grader');
  });

  it.each(['../../admin', 'demo\0x', 'Upper-Case', 'ab', 'a'.repeat(121)])('rejects %j', (s) => {
    expect(ModelCardSlugSchema.safeParse(s).success).toBe(false);
  });
});

describe('modelCardLinkRefusal (#587)', () => {
  it.each<ModelCardStatus>(['DRAFT', 'SUBMITTED', 'PUBLISHED'])(
    'lets the submitter link results to their %s card',
    (status) => {
      expect(modelCardLinkRefusal(status, { isSubmitter: true })).toBeNull();
    },
  );

  it('refuses a WITHDRAWN card, even to its submitter', () => {
    expect(modelCardLinkRefusal('WITHDRAWN', { isSubmitter: true })).toBe('CARD_WITHDRAWN');
  });

  it.each<ModelCardStatus>(['DRAFT', 'SUBMITTED', 'PUBLISHED', 'WITHDRAWN'])(
    'refuses anyone else on a %s card, reviewers included, before looking at the status',
    (status) => {
      expect(modelCardLinkRefusal(status, { isSubmitter: false })).toBe('NOT_CARD_SUBMITTER');
    },
  );
});

describe('modelCardVisibleTo (#591, #587)', () => {
  const anonymous = { isSignedIn: false, isSubmitter: false, isReviewer: false };
  const stranger = { isSignedIn: true, isSubmitter: false, isReviewer: false };
  const submitter = { isSignedIn: true, isSubmitter: true, isReviewer: false };
  const reviewer = { isSignedIn: true, isSubmitter: false, isReviewer: true };

  it.each<[ModelCardStatus, boolean, boolean, boolean, boolean]>([
    // status, anonymous, stranger, submitter, reviewer
    ['PUBLISHED', true, true, true, true],
    ['WITHDRAWN', false, true, true, true],
    ['SUBMITTED', false, false, true, true],
    ['DRAFT', false, false, true, true],
  ])('%s: anonymous %s, stranger %s, submitter %s, reviewer %s', (status, a, st, su, r) => {
    expect(modelCardVisibleTo(status, anonymous)).toBe(a);
    expect(modelCardVisibleTo(status, stranger)).toBe(st);
    expect(modelCardVisibleTo(status, submitter)).toBe(su);
    expect(modelCardVisibleTo(status, reviewer)).toBe(r);
  });
});

describe('LinkSubmissionModelCardRequestSchema (#587)', () => {
  it('takes a card id, or null to unlink', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(LinkSubmissionModelCardRequestSchema.parse({ modelCardId: id })).toEqual({
      modelCardId: id,
    });
    expect(LinkSubmissionModelCardRequestSchema.parse({ modelCardId: null })).toEqual({
      modelCardId: null,
    });
  });

  it.each([{}, { modelCardId: 'acme-grader' }, { modelCardId: null, extra: 1 }])(
    'refuses %o: the field is required, a uuid, and alone',
    (body) => {
      expect(LinkSubmissionModelCardRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('ModelCardDatasetRefInputSchema (#820)', () => {
  const ok = (ref: unknown) => ModelCardDatasetRefInputSchema.safeParse(ref).success;

  it('accepts a dataset of the catalogue', () => {
    expect(ok({ role: 'TRAINING', datasetSlug: 'idrid-grading', note: 'Training split' })).toBe(
      true,
    );
  });

  it('accepts a dataset held elsewhere, by address and name', () => {
    expect(
      ok({
        role: 'EVALUATION',
        externalUrl: 'https://doi.org/10.5555/example',
        externalName: 'Messidor-2',
      }),
    ).toBe(true);
  });

  it.each([
    ['no target', { role: 'TRAINING' }],
    [
      'two targets',
      {
        role: 'TRAINING',
        datasetSlug: 'idrid-grading',
        externalUrl: 'https://example.org/d',
        externalName: 'D',
      },
    ],
    ['an address with no name', { role: 'TRAINING', externalUrl: 'https://example.org/d' }],
    [
      'a name on a catalogue dataset',
      { role: 'TRAINING', datasetSlug: 'idrid-grading', externalName: 'IDRiD' },
    ],
    ['an unknown key', { role: 'TRAINING', datasetSlug: 'idrid-grading', split: 'train' }],
  ])('refuses %s', (_what, ref) => {
    expect(ok(ref)).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.org/d',
    'https://',
    'https:///path-without-host',
    'https://example.org/a b',
    'https://example.org/"><script>',
    'example.org/d',
  ])('refuses the address %s', (externalUrl) => {
    expect(ok({ role: 'TRAINING', externalUrl, externalName: 'D' })).toBe(false);
  });

  it.each(['https://example.org', 'http://example.org/d?x=1#frag', 'HTTPS://Example.org/D'])(
    'accepts the address %s',
    (externalUrl) => {
      expect(ok({ role: 'TRAINING', externalUrl, externalName: 'D' })).toBe(true);
    },
  );
});

describe('datasetRefs on the card requests (#820)', () => {
  const ref = (n: number) => ({ role: 'TRAINING', datasetSlug: `dataset-${n}` });

  it('defaults to none on create and adds nothing on update', () => {
    expect(UpdateModelCardRequestSchema.parse({ clinicalSummary: 'x' })).not.toHaveProperty(
      'datasetRefs',
    );
    expect(CreateModelCardRequestSchema.shape.datasetRefs.parse(undefined)).toEqual([]);
  });

  it('accepts an empty list on update: that is how the list is cleared', () => {
    expect(UpdateModelCardRequestSchema.safeParse({ datasetRefs: [] }).success).toBe(true);
  });

  it('refuses more than the limit', () => {
    const many = Array.from({ length: MAX_MODEL_CARD_DATASET_REFS + 1 }, (_, n) => ref(n));
    expect(UpdateModelCardRequestSchema.safeParse({ datasetRefs: many }).success).toBe(false);
    expect(UpdateModelCardRequestSchema.safeParse({ datasetRefs: many.slice(1) }).success).toBe(
      true,
    );
  });

  it('refuses the same dataset twice in one role, and allows it in two roles', () => {
    expect(UpdateModelCardRequestSchema.safeParse({ datasetRefs: [ref(1), ref(1)] }).success).toBe(
      false,
    );
    expect(
      UpdateModelCardRequestSchema.safeParse({
        datasetRefs: [ref(1), { ...ref(1), role: 'VALIDATION' }],
      }).success,
    ).toBe(true);
  });
});

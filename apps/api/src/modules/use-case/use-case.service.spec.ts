import { UseCaseQuerySchema, type DatasetSummary, type UseCaseQueryInput } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { EvaluationService } from '../evaluation/evaluation.service.js';
import type { PredictionService } from '../prediction/prediction.service.js';
import { UseCaseService } from './use-case.service.js';

/** GRU: general research use. NCU: non-commercial use only. IRB: ethics approval required. */
const GRU = 'DUO_0000042';
const NCU = 'DUO_0000046';
const IRB = 'DUO_0000021';

function dataset(slug: string, over: Partial<DatasetSummary> = {}): DatasetSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug,
    name: `Dataset ${slug}`,
    description: null,
    visibility: 'PUBLIC',
    status: 'PUBLISHED',
    conformanceVersion: '1.1',
    latestVersion: '1.0.0',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    sourceCatalog: null,
    originUrl: null,
    accessTier: 'OPEN',
    commercialUseTerms: 'CASE_BY_CASE',
    modalities: ['CT'],
    ...over,
  } as DatasetSummary;
}

const task = (slug: string, datasetSlug: string, taskKind = 'GRADING', name = `Task ${slug}`) => ({
  id: '00000000-0000-4000-8000-000000000002',
  slug,
  name,
  datasetSlug,
  taskKind,
  submissionCount: 0,
});

const useCase = (input: UseCaseQueryInput = {}) => UseCaseQuerySchema.parse(input);

let catalog: { list: ReturnType<typeof vi.fn>; findOwnerBySlug: ReturnType<typeof vi.fn> };
let evaluation: { listTasks: ReturnType<typeof vi.fn> };
let prediction: { listPublished: ReturnType<typeof vi.fn> };
let service: UseCaseService;

/** The catalogue as the caller sees it, each dataset with its terms of use. */
function catalogueHolds(...entries: Array<[DatasetSummary, string[]]>) {
  catalog.list.mockResolvedValue({ items: entries.map(([d]) => d) });
  catalog.findOwnerBySlug.mockImplementation(async (slug: string) => {
    const entry = entries.find(([d]) => d.slug === slug);
    return entry ? { duoTerms: entry[1] } : null;
  });
}

beforeEach(() => {
  catalog = { list: vi.fn().mockResolvedValue({ items: [] }), findOwnerBySlug: vi.fn() };
  evaluation = { listTasks: vi.fn().mockResolvedValue([]) };
  prediction = { listPublished: vi.fn().mockResolvedValue({ items: [] }) };
  service = new UseCaseService(
    catalog as unknown as CatalogService,
    evaluation as unknown as EvaluationService,
    prediction as unknown as PredictionService,
  );
});

describe('UseCaseService.suggest: datasets (#829)', () => {
  it('searches the catalogue with the words and the modality, published only, as the caller', async () => {
    const caller = { sub: 'someone' } as unknown as CognitoAccessTokenPayload;

    await service.suggest(useCase({ q: 'retinopathy', modality: 'Fundus photography' }), caller);

    expect(catalog.list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'retinopathy',
        modality: 'Fundus photography',
        status: 'PUBLISHED',
        limit: 20,
      }),
      caller,
    );
  });

  it('says what the access matcher would say about this use', async () => {
    catalogueHolds(
      [dataset('open-research', { commercialUseTerms: 'OK' }), [GRU]],
      [dataset('ethics-needed'), [GRU, IRB]],
      [dataset('no-terms'), []],
    );

    const { datasets } = await service.suggest(useCase({ intendedUse: 'NON_COMMERCIAL_RESEARCH' }));

    expect(Object.fromEntries(datasets.map((d) => [d.slug, d.match]))).toEqual({
      'open-research': 'MATCHED',
      // Requires an ethics approval, and the use case declares none.
      'ethics-needed': 'CONFLICT',
      // No terms declared: a holder would have to judge.
      'no-terms': 'UNCLEAR',
    });
  });

  it('an ethics approval in the use case lifts the conflict it caused', async () => {
    catalogueHolds([dataset('ethics-needed'), [GRU, IRB]]);

    const { datasets } = await service.suggest(useCase({ irbApproved: 'true' }));

    expect(datasets[0]?.match).toBe('MATCHED');
  });

  it('a commercial use conflicts with a non-commercial dataset and needs review case by case', async () => {
    catalogueHolds(
      [dataset('non-commercial', { commercialUseTerms: 'NON_COMMERCIAL_ONLY' }), [GRU, NCU]],
      [dataset('case-by-case', { commercialUseTerms: 'CASE_BY_CASE' }), [GRU]],
      [dataset('commercial-ok', { commercialUseTerms: 'OK' }), [GRU]],
    );

    const { datasets } = await service.suggest(useCase({ intendedUse: 'COMMERCIAL_RESEARCH' }));

    expect(datasets.map((d) => [d.slug, d.match])).toEqual([
      ['commercial-ok', 'MATCHED'],
      ['case-by-case', 'UNCLEAR'],
      ['non-commercial', 'CONFLICT'],
    ]);
  });

  it('lists compatible datasets first and keeps the catalogue order within an outcome', async () => {
    catalogueHolds(
      [dataset('b-conflict'), [GRU, IRB]],
      [dataset('a-match', { commercialUseTerms: 'OK' }), [GRU]],
      [dataset('c-match', { commercialUseTerms: 'OK' }), [GRU]],
    );

    const { datasets } = await service.suggest(useCase());

    expect(datasets.map((d) => d.slug)).toEqual(['a-match', 'c-match', 'b-conflict']);
  });

  it('does not let the identity tier of a dataset count against a use case', async () => {
    // Who is asking is not part of a use case; the tier applies when a request is filed.
    catalogueHolds([dataset('controlled', { accessTier: 'SENSITIVE' }), [GRU]]);

    const { datasets } = await service.suggest(useCase());

    expect(datasets[0]).toMatchObject({ accessTier: 'SENSITIVE', match: 'MATCHED' });
  });

  it('says whether the files are behind a request', async () => {
    catalogueHolds(
      [dataset('public-set'), [GRU]],
      [dataset('restricted-set', { visibility: 'RESTRICTED' }), [GRU]],
    );

    const { datasets } = await service.suggest(useCase());

    expect(datasets.map((d) => [d.slug, d.requiresRequest])).toEqual([
      ['public-set', false],
      ['restricted-set', true],
    ]);
  });
});

describe('UseCaseService.suggest: evaluation tasks (#829)', () => {
  it('suggests the tasks that evaluate on a suggested dataset, those first', async () => {
    catalogueHolds([dataset('idrid'), [GRU]]);
    evaluation.listTasks.mockResolvedValue([
      task('elsewhere', 'other-set', 'GRADING', 'Retinopathy grading on another set'),
      task('on-idrid', 'idrid'),
      task('unrelated', 'other-set'),
    ]);

    const { tasks } = await service.suggest(useCase({ q: 'retinopathy' }));

    expect(tasks.map((t) => [t.slug, t.onSuggestedDataset])).toEqual([
      ['on-idrid', true],
      // Not on a suggested dataset, but its name carries the words of the use case.
      ['elsewhere', false],
    ]);
  });

  it('keeps only the kind of task asked for', async () => {
    catalogueHolds([dataset('idrid'), [GRU]]);
    evaluation.listTasks.mockResolvedValue([
      task('grade', 'idrid', 'GRADING'),
      task('classify', 'idrid', 'CLASSIFICATION'),
    ]);

    const { tasks } = await service.suggest(useCase({ taskKind: 'CLASSIFICATION' }));

    expect(tasks.map((t) => t.slug)).toEqual(['classify']);
  });
});

describe('UseCaseService.suggest: models (#829)', () => {
  it('searches published cards by the words and the country', async () => {
    prediction.listPublished.mockResolvedValue({ items: [{ slug: 'grader' }] });

    const { models } = await service.suggest(useCase({ q: 'retina', country: 'CH' }));

    expect(prediction.listPublished).toHaveBeenCalledWith({
      q: 'retina',
      jurisdiction: 'CH',
      sort: 'recent',
      page: 1,
      limit: 10,
    });
    expect(models).toEqual([{ slug: 'grader' }]);
  });

  it('suggests no model when the use case has neither words nor a country', async () => {
    const { models } = await service.suggest(useCase({ modality: 'CT' }));

    expect(models).toEqual([]);
    expect(prediction.listPublished).not.toHaveBeenCalled();
  });
});

describe('UseCaseQuerySchema (#829)', () => {
  it('reads an empty form as an empty use case, with its defaults', () => {
    expect(
      UseCaseQuerySchema.parse({
        q: '',
        modality: ' ',
        taskKind: '',
        intendedUse: '',
        country: '',
      }),
    ).toEqual({ intendedUse: 'NON_COMMERCIAL_RESEARCH', irbApproved: false });
  });

  it('reads the ethics approval from a query string', () => {
    expect(UseCaseQuerySchema.parse({ irbApproved: 'true' }).irbApproved).toBe(true);
    expect(UseCaseQuerySchema.parse({ irbApproved: 'false' }).irbApproved).toBe(false);
  });

  it.each([
    { q: 'x' },
    { taskKind: 'NOT_A_KIND' },
    { intendedUse: 'ANYTHING' },
    { irbApproved: 'yes' },
    { country: 'C' },
  ])('refuses %o', (input) => {
    expect(UseCaseQuerySchema.safeParse(input).success).toBe(false);
  });
});

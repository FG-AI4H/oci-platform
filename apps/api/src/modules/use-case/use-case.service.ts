import { Inject, Injectable } from '@nestjs/common';
import {
  ListDatasetsQuerySchema,
  type AccessRequestAttestations,
  type AccessRequestMatchStatus,
  type DatasetSummary,
  type UseCaseDatasetSuggestion,
  type UseCaseQuery,
  type UseCaseSuggestionsResponse,
  type UseCaseTaskSuggestion,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { matchDuoIntent } from '../access-request/duo-matcher.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { EvaluationService } from '../evaluation/evaluation.service.js';
import { PredictionService } from '../prediction/prediction.service.js';

/** How many datasets, tasks and models one answer lists at most. */
const MAX_DATASETS = 20;
const MAX_TASKS = 20;
const MAX_MODELS = 10;

/** Compatible uses first, then those a holder would have to look at, then conflicts. */
const MATCH_ORDER: ReadonlyMap<AccessRequestMatchStatus, number> = new Map([
  ['MATCHED', 0],
  ['UNCLEAR', 1],
  ['CONFLICT', 2],
]);

/**
 * From a use case to the resources that fit it (#829; Lab requirements
 * Req-001 and Req-002: describe a use case, get datasets, models and tools
 * recommended from metadata).
 *
 * Rules on metadata, no model and no agent:
 *
 *   - datasets come from the catalogue search, with the caller's own
 *     visibility, so nothing is suggested that the caller could not open;
 *   - each one is run through `matchDuoIntent`, the matcher a real access
 *     request goes through, with the kind of use and the ethics approval of
 *     the use case. The suggestion therefore says what the request would be
 *     told, and the two cannot drift apart;
 *   - tasks are those that evaluate on a suggested dataset, plus those whose
 *     name carries the words of the use case;
 *   - models are the published cards the catalogue search finds for the
 *     words or the country.
 *
 * The matcher's identity check is left out: who is asking is not part of a
 * use case. It applies, as always, when the request is filed.
 */
@Injectable()
export class UseCaseService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(EvaluationService) private readonly evaluation: EvaluationService,
    @Inject(PredictionService) private readonly prediction: PredictionService,
  ) {}

  async suggest(
    useCase: UseCaseQuery,
    user?: CognitoAccessTokenPayload,
  ): Promise<UseCaseSuggestionsResponse> {
    const [datasets, tasks, models] = await Promise.all([
      this.datasets(useCase, user),
      this.evaluation.listTasks(),
      useCase.q === undefined && useCase.country === undefined
        ? Promise.resolve([])
        : this.prediction
            .listPublished({
              q: useCase.q,
              jurisdiction: useCase.country,
              sort: 'recent',
              page: 1,
              limit: MAX_MODELS,
            })
            .then((page) => page.items),
    ]);

    const suggested = new Set<string>(datasets.map((d) => d.slug));
    const words = useCase.q?.toLowerCase();
    const taskSuggestions: UseCaseTaskSuggestion[] = tasks
      .filter((task) => useCase.taskKind === undefined || task.taskKind === useCase.taskKind)
      .map((task) => ({
        slug: task.slug,
        name: task.name,
        taskKind: task.taskKind,
        datasetSlug: task.datasetSlug,
        onSuggestedDataset: suggested.has(task.datasetSlug),
      }))
      .filter(
        (task) =>
          task.onSuggestedDataset ||
          (words !== undefined && task.name.toLowerCase().includes(words)),
      )
      // Tasks on a suggested dataset first; the sort is stable for the rest.
      .sort((a, b) => Number(b.onSuggestedDataset) - Number(a.onSuggestedDataset))
      .slice(0, MAX_TASKS);

    return { datasets, tasks: taskSuggestions, models };
  }

  private async datasets(
    useCase: UseCaseQuery,
    user: CognitoAccessTokenPayload | undefined,
  ): Promise<UseCaseDatasetSuggestion[]> {
    const page = await this.catalog.list(
      ListDatasetsQuerySchema.parse({
        ...(useCase.q !== undefined ? { q: useCase.q } : {}),
        ...(useCase.modality !== undefined ? { modality: useCase.modality } : {}),
        status: 'PUBLISHED',
        limit: MAX_DATASETS,
      }),
      user,
    );
    const suggestions = await Promise.all(
      page.items.map((dataset) => this.suggestion(dataset, useCase)),
    );
    // Stable: within one outcome the catalogue's own order is kept.
    return suggestions.sort(
      (a, b) => (MATCH_ORDER.get(a.match) ?? 0) - (MATCH_ORDER.get(b.match) ?? 0),
    );
  }

  private async suggestion(
    dataset: DatasetSummary,
    useCase: UseCaseQuery,
  ): Promise<UseCaseDatasetSuggestion> {
    const terms = await this.catalog.findOwnerBySlug(dataset.slug);
    const match = matchDuoIntent(terms?.duoTerms ?? [], asAttestations(useCase), {
      accessTier: dataset.accessTier,
      // Not part of a use case; see the class comment.
      requesterIdentityScore: 'PASSPORT_VERIFIED',
      commercialUseTerms: dataset.commercialUseTerms,
    });
    return {
      slug: dataset.slug,
      name: dataset.name,
      description: dataset.description,
      visibility: dataset.visibility,
      accessTier: dataset.accessTier,
      modalities: [...dataset.modalities],
      match: match.status,
      requiresRequest: dataset.visibility === 'RESTRICTED',
    };
  }
}

/**
 * The use case as the matcher reads an access request. The matcher decides on
 * the kind of use and the ethics approval; the other fields of a request are
 * for the holder who reads it, and a use case has none of them yet.
 */
function asAttestations(useCase: UseCaseQuery): AccessRequestAttestations {
  return {
    v: 1,
    projectTitle: '',
    projectDescription: '',
    institution: '',
    intendedUseCategory: useCase.intendedUse,
    intendedUseDuoTerms: [],
    irbApproved: useCase.irbApproved,
    dataRetentionDays: 1,
    redistributionIntent: 'NONE',
    outputType: 'PUBLICATION',
  };
}

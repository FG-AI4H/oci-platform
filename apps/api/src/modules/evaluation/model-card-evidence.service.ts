import { Inject, Injectable } from '@nestjs/common';
import { EvaluationRepository } from './evaluation.repository.js';
import { modelCardPerformance, type ModelCardPerformance } from './model-card-evidence.js';

/**
 * The evaluation module's typed read for the prediction module (#587): the
 * results linked to one model card, already sorted into published,
 * provisional and not attributed by the evaluation module's own publication
 * rule. The prediction module renders them; it never reads a submission row
 * itself, so the rule for what counts as published stays in one place.
 */
@Injectable()
export class ModelCardEvidenceService {
  constructor(@Inject(EvaluationRepository) private readonly repo: EvaluationRepository) {}

  async performanceFor(modelCardId: string): Promise<ModelCardPerformance> {
    const rows = await this.repo.findScoredSubmissionsForModelCard(modelCardId);
    const datasetSlugs = [...new Set(rows.map((r) => r.task.datasetSlug))];
    const versions = await this.repo.findDatasetVersions(datasetSlugs);
    return modelCardPerformance(rows, versions);
  }
}

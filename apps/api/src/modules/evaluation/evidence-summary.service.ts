import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  EVIDENCE_MAX_TRACE_EVENTS,
  type DatasetDetail,
  type DatasetSlug,
  type EvidenceSummary,
} from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { assembleEvidence } from './evidence-summary.js';
import { EvidenceSummaryRepository } from './evidence-summary.repository.js';

/** Groups that read any submission's evidence summary, besides its submitter (#652). */
export const EVIDENCE_READER_GROUPS: readonly string[] = [
  'admin',
  'evaluation-reviewer',
  'regulator',
];

/**
 * The evidence summary of one submission (#652):
 * `GET /v2/evaluation/submissions/:id/evidence`.
 *
 * WHO READS IT. The submitter, administrators, `evaluation-reviewer` and
 * `regulator`. On top of that, the submission page's rule for a FAILED
 * submission holds here too: its submitter and administrators only, and a
 * 404 for anyone else, so the answer does not say whether a failed attempt
 * exists. Anyone else signed in gets a 403 for a scored or pending one,
 * whose existence the task's public result list already shows.
 *
 * WHAT IT READS. The submission and its method version, the task's dataset
 * through `CatalogService.detail` with the reader's own token (so a dataset
 * they may not see is reported as unavailable, never shown), and the
 * submission's audit events without actor or payload. Never the reference
 * labels or the predictions.
 *
 * Model card: there is no link from a submission to a model card yet
 * (#587 adds `Submission.modelCardId`), so section 1 always reports the card
 * as missing until it lands. The assembly already reads a linked card.
 */
@Injectable()
export class EvidenceSummaryService {
  constructor(
    @Inject(EvidenceSummaryRepository) private readonly repo: EvidenceSummaryRepository,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async getEvidence(
    submissionId: string,
    user: CognitoAccessTokenPayload,
    now: Date = new Date(),
  ): Promise<EvidenceSummary> {
    const notFound = () => new NotFoundException(`submission "${submissionId}" not found`);

    const row = await this.repo.findSubmission(submissionId);
    if (!row) throw notFound();

    const groups = groupsOf(user);
    const viewerIsSubmitter =
      row.submittedBy !== null && row.submittedBy === cognitoSubAsUuid(user.sub);
    if (row.status === 'FAILED' && !viewerIsSubmitter && !groups.includes('admin')) {
      throw notFound();
    }
    if (!viewerIsSubmitter && !groups.some((g) => EVIDENCE_READER_GROUPS.includes(g))) {
      throw new ForbiddenException(
        'The evidence summary is for the submitter, administrators, evaluation reviewers and regulators.',
      );
    }

    const [dataset, trace] = await Promise.all([
      this.readDataset(row.task.datasetSlug, user),
      this.repo.findTrace(submissionId, EVIDENCE_MAX_TRACE_EVENTS),
    ]);

    return assembleEvidence({
      now,
      viewerIsSubmitter,
      submission: row,
      dataset,
      modelCard: null,
      trace: { rows: trace, limit: EVIDENCE_MAX_TRACE_EVENTS },
    });
  }

  /**
   * The dataset as the reader may see it. Not found, or not visible to them,
   * is a statement on the page ("not available"), not an error of the page.
   */
  private async readDataset(
    slug: string,
    user: CognitoAccessTokenPayload,
  ): Promise<DatasetDetail | null> {
    try {
      return await this.catalog.detail(slug as DatasetSlug, user);
    } catch (err: unknown) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}

function groupsOf(user: CognitoAccessTokenPayload): string[] {
  const groups: unknown = user['cognito:groups'];
  return Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [];
}

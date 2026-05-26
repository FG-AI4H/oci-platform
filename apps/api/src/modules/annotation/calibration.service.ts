import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { cohensKappa } from '@oci/annotation-quality';
import {
  CalibrationThresholdsSchema,
  evaluateCalibrationFlags,
  type CalibrationAnnotatorInput,
  type CalibrationFlag,
  type CalibrationFlagDecision,
  type CalibrationThresholds,
  type ListCalibrationFlagsResponse,
} from '@oci/shared-types';
import type { AnnotatorCalibrationFlag } from '@oci/database';
import { CalibrationRepository, type AnnotatorSubmissionRow } from './calibration.repository.js';
import { CampaignRepository } from './campaign.repository.js';

interface RunResult {
  scannedCampaigns: number;
  scannedAnnotators: number;
  raised: number;
  cleared: number;
  errors: string[];
}

/**
 * Calibration drift detection (#292).
 *
 * Walks every RUNNING campaign on each pass:
 *   1. Pull all SUBMITTED assignments within the rolling window
 *      (default 7 days; campaign override via workflowConfig).
 *   2. Group by annotator + sample. Compute peer Cohen's-κ between
 *      this annotator and a synthetic majority-vote rater (proxy for
 *      "peers") and intra-rater agreement on duplicate samples.
 *   3. Apply `evaluateCalibrationFlags()` against the thresholds.
 *   4. Diff against persisted ACTIVE rows: raise new flags, clear
 *      stale ones.
 *
 * Gold-standard vs-gold computation is wired up but inert until #291
 * lands — without `isGoldStandard` tasks, all annotators see
 * `vsGold = null` and the SKILL/vs-gold branch is skipped.
 */
@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);

  constructor(
    @Inject(CalibrationRepository) private readonly repo: CalibrationRepository,
    @Inject(CampaignRepository) private readonly campaigns: CampaignRepository,
  ) {}

  /**
   * Run one calibration pass across all RUNNING campaigns. Called by
   * the BullMQ scheduler and by the `triggerNow` admin button.
   */
  async runOnce(): Promise<RunResult> {
    const campaigns = await this.campaigns.listRecent(200);
    let scannedAnnotators = 0;
    let raised = 0;
    let cleared = 0;
    const errors: string[] = [];
    const runningCampaigns = campaigns.filter((c) => c.status === 'RUNNING');

    for (const campaign of runningCampaigns) {
      try {
        const summary = await this.evaluateCampaign(campaign.id);
        scannedAnnotators += summary.evaluated;
        raised += summary.raised;
        cleared += summary.cleared;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${campaign.slug}: ${msg}`);
        this.logger.error(`calibration pass failed for ${campaign.slug}: ${msg}`);
      }
    }

    this.logger.log(
      `calibration sweep — campaigns=${runningCampaigns.length} annotators=${scannedAnnotators} raised=${raised} cleared=${cleared} errors=${errors.length}`,
    );
    return {
      scannedCampaigns: runningCampaigns.length,
      scannedAnnotators,
      raised,
      cleared,
      errors,
    };
  }

  async listForCampaign(slug: string): Promise<ListCalibrationFlagsResponse> {
    const campaign = await this.campaigns.findBySlug(slug);
    if (!campaign) throw new NotFoundException(`Campaign '${slug}' not found`);
    const rows = await this.repo.listActiveFlagsForCampaign(campaign.id);
    return { items: rows.map((r) => this.toContract(r)) };
  }

  async evaluateCampaign(campaignId: string): Promise<{
    evaluated: number;
    raised: number;
    cleared: number;
  }> {
    const thresholds = CalibrationThresholdsSchema.parse({});
    const windowDays = 7;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const submissions = await this.repo.listSubmissionsForCampaign(campaignId, since);
    const inputs = this.computeAnnotatorStats(submissions);
    const decisions = evaluateCalibrationFlags(inputs, thresholds);

    let raised = 0;
    let cleared = 0;

    for (const decision of decisions) {
      const existing = await this.repo.findActiveFlag(
        campaignId,
        decision.annotatorUserId,
        decision.flagType,
      );
      if (existing) continue;
      await this.repo.raiseFlag({
        campaignId,
        annotatorUserId: decision.annotatorUserId,
        flagType: decision.flagType,
        metric: decision.metric,
        score: decision.score,
        threshold: decision.threshold,
        sampleSize: decision.sampleSize,
        windowMeta: { since: since.toISOString(), windowDays },
      });
      raised += 1;
      this.logger.warn(
        `calibration flag raised campaign=${campaignId} annotator=${decision.annotatorUserId} type=${decision.flagType} metric=${decision.metric} score=${decision.score.toFixed(3)}`,
      );
    }

    // Clear any ACTIVE flags that no longer match a decision (the
    // annotator's metrics recovered into the safe range).
    const activeRows = await this.repo.listActiveFlagsForCampaign(campaignId);
    const stillActiveKey = (d: CalibrationFlagDecision): string =>
      `${d.annotatorUserId}|${d.flagType}`;
    const decisionKeys = new Set(decisions.map(stillActiveKey));
    for (const row of activeRows) {
      const key = `${row.annotatorUserId}|${row.flagType}`;
      if (!decisionKeys.has(key)) {
        await this.repo.clearFlag(row.id);
        cleared += 1;
        this.logger.log(
          `calibration flag cleared campaign=${campaignId} annotator=${row.annotatorUserId} type=${row.flagType}`,
        );
      }
    }

    return { evaluated: inputs.length, raised, cleared };
  }

  /**
   * Group submissions into per-annotator stats. Peer agreement is
   * approximated by comparing each annotator's labels against the
   * mode of OTHER annotators' labels on the same sampleRef (Cohen's-κ
   * with the synthetic "majority" rater).
   *
   * `vsGold` is left null until #291's gold-standard sample handling
   * lands; `vsSelf` requires the duplicate-sample feature (out of
   * scope for the first-cut).
   */
  computeAnnotatorStats(rows: readonly AnnotatorSubmissionRow[]): CalibrationAnnotatorInput[] {
    const byAnnotator = new Map<string, AnnotatorSubmissionRow[]>();
    for (const r of rows) {
      const list = byAnnotator.get(r.assigneeUserId) ?? [];
      list.push(r);
      byAnnotator.set(r.assigneeUserId, list);
    }

    // For each sampleRef, collect every (annotator, label) pair so we
    // can compute the majority label per sample.
    const labelsBySample = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const label = extractLabel(r.submission);
      if (label === null) continue;
      const inner = labelsBySample.get(r.sampleRef) ?? new Map<string, string>();
      inner.set(r.assigneeUserId, label);
      labelsBySample.set(r.sampleRef, inner);
    }

    const out: CalibrationAnnotatorInput[] = [];
    for (const [annotatorUserId, list] of byAnnotator.entries()) {
      const labels: string[] = [];
      const peerMajority: string[] = [];
      for (const r of list) {
        const myLabel = extractLabel(r.submission);
        if (myLabel === null) continue;
        const sampleLabels = labelsBySample.get(r.sampleRef);
        if (!sampleLabels || sampleLabels.size < 2) continue;
        const others = [...sampleLabels.entries()]
          .filter(([uid]) => uid !== annotatorUserId)
          .map(([, lbl]) => lbl);
        if (others.length === 0) continue;
        const majority = mode(others);
        labels.push(myLabel);
        peerMajority.push(majority);
      }
      const sampleSize = labels.length;
      let vsPeers: number | null = null;
      if (sampleSize >= 2) {
        try {
          const result = cohensKappa(labels, peerMajority);
          vsPeers = Number.isFinite(result.kappa) ? result.kappa : null;
        } catch {
          vsPeers = null;
        }
      }
      out.push({
        annotatorUserId,
        sampleSize,
        vsGold: null,
        vsPeers,
        vsSelf: null,
      });
    }
    return out;
  }

  private toContract(row: AnnotatorCalibrationFlag): CalibrationFlag {
    return {
      id: row.id,
      campaignId: row.campaignId,
      annotatorUserId: row.annotatorUserId,
      flagType: row.flagType as CalibrationFlag['flagType'],
      metric: row.metric as CalibrationFlag['metric'],
      score: row.score,
      threshold: row.threshold,
      sampleSize: row.sampleSize,
      status: row.status as CalibrationFlag['status'],
      createdAt: row.createdAt.toISOString(),
      clearedAt: row.clearedAt ? row.clearedAt.toISOString() : null,
    };
  }
}

/**
 * Pull a single categorical label from a free-form submission. Slice 1
 * supports the two common shapes:
 *   { label: 'pneumonia' } — classification per ADR-0008
 *   { class: 'pneumonia' } — alternative key used by some adapters
 *
 * Returns null for shapes we don't understand (segmentation masks,
 * multi-class, etc.) — those don't contribute to the peer-κ first cut.
 */
function extractLabel(submission: unknown): string | null {
  if (submission == null || typeof submission !== 'object') return null;
  const obj = submission as Record<string, unknown>;
  if (typeof obj.label === 'string') return obj.label;
  if (typeof obj.class === 'string') return obj.class;
  return null;
}

function mode(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0]!;
  let bestCount = -1;
  for (const [k, v] of counts.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

export type { CalibrationThresholds };

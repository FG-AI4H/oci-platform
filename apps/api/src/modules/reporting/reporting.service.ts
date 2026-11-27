import { Inject, Injectable } from '@nestjs/common';
import {
  lastCompleteMonth,
  monthBounds,
  type ActivityReport,
  type ActivityReportCampaign,
  type ActivityReportMonth,
  type ActivityReportTask,
  type EvaluationTaskSummary,
} from '@oci/shared-types';
import { CampaignAnnotationsService } from '../annotation/campaign-annotations.service.js';
import { CampaignService } from '../annotation/campaign.service.js';
import { AuditReaderService } from '../audit/audit-reader.service.js';
import { EvaluationService } from '../evaluation/evaluation.service.js';
import {
  isScorableTaskKind,
  primaryMetricLabelOf,
  primaryMetricOf,
} from '../evaluation/scoring-registry.js';
import { ReportingRepository, type Period } from './reporting.repository.js';

/** Campaigns whose readings are worth reporting: under way, or done. */
const REPORTED_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set(['RUNNING', 'COMPLETED']);

/**
 * The periodic activity report (#828; Lab requirement Req-036).
 *
 * One calendar month of what the platform recorded, assembled on request and
 * stored nowhere. This service owns no rule: it counts rows through its
 * repository and asks the owning modules for everything that takes judgement:
 *
 *   - which results are published, and which is the best on a task: the
 *     evaluation module (`getTaskDetail`, already ordered best first, each
 *     result with its attribution);
 *   - how far a campaign's readers agree: the annotation module
 *     (`agreement`);
 *   - whether the audit chain holds over the period: the audit reader
 *     (`verify`).
 *
 * No person is named and nothing private is listed: public datasets, public
 * tasks, counts.
 */
@Injectable()
export class ReportingService {
  constructor(
    @Inject(ReportingRepository) private readonly repo: ReportingRepository,
    @Inject(EvaluationService) private readonly evaluation: EvaluationService,
    @Inject(CampaignService) private readonly campaigns: CampaignService,
    @Inject(CampaignAnnotationsService) private readonly annotations: CampaignAnnotationsService,
    @Inject(AuditReaderService) private readonly audit: AuditReaderService,
  ) {}

  async activity(
    month: ActivityReportMonth | undefined,
    now: Date = new Date(),
  ): Promise<ActivityReport> {
    const reported = month ?? lastCompleteMonth(now);
    const period = monthBounds(reported);

    const [datasets, accessRequests, evaluation, models, annotation, audit] = await Promise.all([
      this.repo.datasets(period),
      this.repo.accessRequests(period),
      this.evaluationSection(period),
      this.repo.models(period),
      this.annotationSection(now),
      this.auditSection(period),
    ]);

    return {
      v: 1,
      month: reported,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      partial: now.getTime() < period.to.getTime(),
      generatedAt: now.toISOString(),
      deployment: process.env.OCI_ENV ?? 'local',
      datasets,
      accessRequests,
      evaluation,
      models,
      annotation,
      audit,
    };
  }

  private async evaluationSection(period: Period): Promise<ActivityReport['evaluation']> {
    const [tasks, counts] = await Promise.all([
      this.evaluation.listTasks(),
      this.repo.submissionsByTask(period),
    ]);
    const rows = await Promise.all(tasks.map((task) => this.taskRow(task, counts.get(task.id))));
    const byTask = rows.filter((row) => row.received > 0 || row.publishedResults > 0);
    return {
      tasks: tasks.length,
      received: sum(rows, (r) => r.received),
      scored: sum(rows, (r) => r.scored),
      failed: sum(rows, (r) => r.failed),
      byTask,
    };
  }

  private async taskRow(
    task: EvaluationTaskSummary,
    inPeriod: { received: number; scored: number; failed: number } | undefined,
  ): Promise<ActivityReportTask> {
    const base = {
      slug: task.slug,
      name: task.name,
      taskKind: task.taskKind,
      datasetSlug: task.datasetSlug,
      received: inPeriod?.received ?? 0,
      scored: inPeriod?.scored ?? 0,
      failed: inPeriod?.failed ?? 0,
    };
    // A task nobody ever submitted to has no result to look for.
    if (task.submissionCount === 0) return { ...base, best: null, publishedResults: 0 };

    const detail = await this.evaluation.getTaskDetail(task.slug);
    // Published by the evaluation module's own attribution: an approved
    // method version, not retracted. Already ordered best first.
    const published = detail.submissions.filter(
      (s) =>
        s.status === 'SCORED' &&
        s.scores !== null &&
        s.attribution?.kind === 'ROUTED' &&
        s.attribution.published &&
        s.attribution.retractedAt === null &&
        Number.isFinite(primaryMetricOf(s.scores)),
    );
    const top = published[0];
    const best =
      top && top.scores && isScorableTaskKind(top.scores.kind)
        ? {
            methodName: top.methodName,
            metricLabel: primaryMetricLabelOf(top.scores.kind),
            value: primaryMetricOf(top.scores),
          }
        : null;
    return { ...base, best, publishedResults: published.length };
  }

  private async annotationSection(now: Date): Promise<ActivityReport['annotation']> {
    const { items } = await this.campaigns.list();
    const reported = items.filter((c) => REPORTED_CAMPAIGN_STATUSES.has(c.status));
    const campaigns = await Promise.all(
      reported.map(async (campaign): Promise<ActivityReportCampaign> => {
        const agreement = await this.annotations.agreement(campaign.slug, now);
        return {
          slug: campaign.slug,
          name: campaign.name,
          status: campaign.status,
          tasksCounted: agreement.tasks.counted,
          tasksOpen: agreement.tasks.open,
          arbitrationShare: agreement.tasks.arbitrationShare,
          fleissKappa: agreement.overall.fleissKappa,
          percentAgreement: agreement.overall.percentAgreement,
        };
      }),
    );
    return { campaigns };
  }

  private async auditSection(period: Period): Promise<ActivityReport['audit']> {
    const [events, verification] = await Promise.all([
      this.repo.auditEvents(period),
      this.audit.verify({ from: period.from.toISOString(), to: period.to.toISOString() }),
    ]);
    return {
      events,
      // One call checks a bounded number of events. A longer period is said
      // to be unverified here, not passed off as intact.
      chain:
        verification.status === 'intact' && !verification.complete
          ? 'unverified'
          : verification.status,
      checked: verification.checked,
    };
  }
}

function sum<T>(rows: ReadonlyArray<T>, of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

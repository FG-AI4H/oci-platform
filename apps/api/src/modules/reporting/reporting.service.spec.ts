import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignAnnotationsService } from '../annotation/campaign-annotations.service.js';
import type { CampaignService } from '../annotation/campaign.service.js';
import type { AuditReaderService } from '../audit/audit-reader.service.js';
import type { EvaluationService } from '../evaluation/evaluation.service.js';
import type { ReportingRepository } from './reporting.repository.js';
import { ReportingService } from './reporting.service.js';

const NOVEMBER = {
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-12-01T00:00:00.000Z'),
};
const IN_DECEMBER = new Date('2026-12-05T10:00:00.000Z');

const task = (id: string, slug: string, submissionCount: number) => ({
  id,
  slug,
  name: `Task ${slug}`,
  datasetSlug: `${slug}-data`,
  taskKind: 'GRADING',
  submissionCount,
});

/** A grading result; `kappa` is the metric a grading task ranks by. */
function result(methodName: string, kappa: number, attribution: unknown, status = 'SCORED') {
  return {
    id: methodName,
    methodName,
    status,
    scores: status === 'SCORED' ? { kind: 'GRADING', metrics: { qwk: kappa } } : null,
    attribution,
    createdAt: '2026-11-10T00:00:00.000Z',
  };
}
const PUBLISHED = { kind: 'ROUTED', published: true, retractedAt: null };
const PROVISIONAL = { kind: 'ROUTED', published: false, retractedAt: null };
const RETRACTED = { kind: 'ROUTED', published: true, retractedAt: '2026-11-20T00:00:00.000Z' };
const LEGACY = { kind: 'LEGACY', note: 'before method versions' };

let repo: Record<
  'datasets' | 'accessRequests' | 'submissionsByTask' | 'models' | 'auditEvents',
  ReturnType<typeof vi.fn>
>;
let evaluation: { listTasks: ReturnType<typeof vi.fn>; getTaskDetail: ReturnType<typeof vi.fn> };
let campaigns: { list: ReturnType<typeof vi.fn> };
let annotations: { agreement: ReturnType<typeof vi.fn> };
let audit: { verify: ReturnType<typeof vi.fn> };
let service: ReportingService;

beforeEach(() => {
  repo = {
    datasets: vi.fn().mockResolvedValue({ publishedAtEnd: 3, versionsPublished: 0, versions: [] }),
    accessRequests: vi
      .fn()
      .mockResolvedValue({ submitted: 0, approved: 0, denied: 0, pendingAtEnd: 0 }),
    submissionsByTask: vi.fn().mockResolvedValue(new Map()),
    models: vi.fn().mockResolvedValue({ published: 0, publishedInPeriod: 0 }),
    auditEvents: vi.fn().mockResolvedValue(0),
  };
  evaluation = { listTasks: vi.fn().mockResolvedValue([]), getTaskDetail: vi.fn() };
  campaigns = { list: vi.fn().mockResolvedValue({ items: [] }) };
  annotations = { agreement: vi.fn() };
  audit = {
    verify: vi.fn().mockResolvedValue({ status: 'empty', checked: 0, complete: true }),
  };
  service = new ReportingService(
    repo as unknown as ReportingRepository,
    evaluation as unknown as EvaluationService,
    campaigns as unknown as CampaignService,
    annotations as unknown as CampaignAnnotationsService,
    audit as unknown as AuditReaderService,
  );
});

describe('ReportingService.activity: the period (#828)', () => {
  it('reports the month asked for, as [from, to) in UTC', async () => {
    const report = await service.activity('2026-11', IN_DECEMBER);

    expect(report).toMatchObject({
      v: 1,
      month: '2026-11',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      partial: false,
      generatedAt: IN_DECEMBER.toISOString(),
    });
    expect(repo.datasets).toHaveBeenCalledWith(NOVEMBER);
    expect(repo.accessRequests).toHaveBeenCalledWith(NOVEMBER);
    expect(audit.verify).toHaveBeenCalledWith({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
    });
  });

  it('without a month, reports the last complete one', async () => {
    expect((await service.activity(undefined, IN_DECEMBER)).month).toBe('2026-11');
  });

  it('says so when the month is not over yet', async () => {
    const report = await service.activity('2026-12', IN_DECEMBER);

    expect(report.partial).toBe(true);
  });
});

describe('ReportingService.activity: evaluation (#828)', () => {
  it('takes the best published result, never a provisional, retracted or unattributed one', async () => {
    evaluation.listTasks.mockResolvedValue([task('t1', 'grading', 5)]);
    // As the evaluation module returns them: best first.
    evaluation.getTaskDetail.mockResolvedValue({
      submissions: [
        result('unattributed', 0.99, LEGACY),
        result('retracted', 0.95, RETRACTED),
        result('provisional', 0.9, PROVISIONAL),
        result('published-best', 0.81, PUBLISHED),
        result('published-second', 0.7, PUBLISHED),
        result('failed', 0, PUBLISHED, 'FAILED'),
      ],
    });

    const { evaluation: section } = await service.activity('2026-11', IN_DECEMBER);

    expect(section.byTask).toEqual([
      expect.objectContaining({
        slug: 'grading',
        publishedResults: 2,
        best: { methodName: 'published-best', metricLabel: expect.any(String), value: 0.81 },
      }),
    ]);
  });

  it('counts what the period received, by task and in total', async () => {
    evaluation.listTasks.mockResolvedValue([task('t1', 'busy', 4), task('t2', 'quiet', 0)]);
    evaluation.getTaskDetail.mockResolvedValue({ submissions: [] });
    repo.submissionsByTask.mockResolvedValue(
      new Map([['t1', { received: 4, scored: 3, failed: 1 }]]),
    );

    const { evaluation: section } = await service.activity('2026-11', IN_DECEMBER);

    expect(section).toMatchObject({ tasks: 2, received: 4, scored: 3, failed: 1 });
    // A task with no submission in the period and no published result is not listed.
    expect(section.byTask.map((t) => t.slug)).toEqual(['busy']);
    expect(section.byTask[0]).toMatchObject({ received: 4, best: null, publishedResults: 0 });
  });

  it('does not read the results of a task nobody ever submitted to', async () => {
    evaluation.listTasks.mockResolvedValue([task('t2', 'untouched', 0)]);

    await service.activity('2026-11', IN_DECEMBER);

    expect(evaluation.getTaskDetail).not.toHaveBeenCalled();
  });

  it('lists a task with a published result even when the period received nothing', async () => {
    evaluation.listTasks.mockResolvedValue([task('t1', 'settled', 1)]);
    evaluation.getTaskDetail.mockResolvedValue({ submissions: [result('m', 0.6, PUBLISHED)] });

    const { evaluation: section } = await service.activity('2026-11', IN_DECEMBER);

    expect(section.byTask).toEqual([expect.objectContaining({ slug: 'settled', received: 0 })]);
  });
});

describe('ReportingService.activity: annotation and audit (#828)', () => {
  it('reports running and completed campaigns with the annotation module’s own agreement', async () => {
    campaigns.list.mockResolvedValue({
      items: [
        { slug: 'draft', name: 'Draft', status: 'DRAFT' },
        { slug: 'reading', name: 'Reading', status: 'RUNNING' },
      ],
    });
    annotations.agreement.mockResolvedValue({
      tasks: { counted: 30, open: 4, arbitrationShare: 0.2 },
      overall: { fleissKappa: 0.71, percentAgreement: 0.86 },
    });

    const { annotation } = await service.activity('2026-11', IN_DECEMBER);

    expect(annotations.agreement).toHaveBeenCalledTimes(1);
    expect(annotations.agreement).toHaveBeenCalledWith('reading', IN_DECEMBER);
    expect(annotation.campaigns).toEqual([
      {
        slug: 'reading',
        name: 'Reading',
        status: 'RUNNING',
        tasksCounted: 30,
        tasksOpen: 4,
        arbitrationShare: 0.2,
        fleissKappa: 0.71,
        percentAgreement: 0.86,
      },
    ]);
  });

  it.each([
    [{ status: 'intact', checked: 120, complete: true }, 'intact'],
    [{ status: 'broken', checked: 7, complete: true }, 'broken'],
    [{ status: 'empty', checked: 0, complete: true }, 'empty'],
    // More events than one check covers: not passed off as intact.
    [{ status: 'intact', checked: 5000, complete: false }, 'unverified'],
    [{ status: 'broken', checked: 5000, complete: false }, 'broken'],
  ])('reads the audit chain %o as %s', async (verification, chain) => {
    audit.verify.mockResolvedValue(verification);
    repo.auditEvents.mockResolvedValue(verification.checked);

    const report = await service.activity('2026-11', IN_DECEMBER);

    expect(report.audit).toEqual({
      events: verification.checked,
      chain,
      checked: verification.checked,
    });
  });
});

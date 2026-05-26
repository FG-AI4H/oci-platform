import { NotFoundException } from '@nestjs/common';
import {
  evaluateCalibrationFlags,
  type CalibrationAnnotatorInput,
  type CalibrationThresholds,
} from '@oci/shared-types';
import type { AnnotationCampaign, AnnotatorCalibrationFlag } from '@oci/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalibrationRepository, type AnnotatorSubmissionRow } from './calibration.repository.js';
import { CalibrationService } from './calibration.service.js';
import { CampaignRepository } from './campaign.repository.js';

const DEFAULT: CalibrationThresholds = {
  publishableFloor: 0.6,
  fatigueFloor: 0.7,
  minSampleSize: 2,
};

const ANN_A = '00000000-0000-4000-8000-000000000001';
const ANN_B = '00000000-0000-4000-8000-000000000002';
const ANN_C = '00000000-0000-4000-8000-000000000003';
const ANN_D = '00000000-0000-4000-8000-000000000004';

describe('evaluateCalibrationFlags', () => {
  it('raises SKILL/vs-gold when vsGold < publishableFloor', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 20, vsGold: 0.4, vsPeers: 0.8, vsSelf: 0.9 },
    ];
    const out = evaluateCalibrationFlags(inputs, DEFAULT);
    expect(out).toEqual([
      {
        annotatorUserId: ANN_A,
        flagType: 'SKILL',
        metric: 'vs-gold',
        score: 0.4,
        threshold: 0.6,
        sampleSize: 20,
      },
    ]);
  });

  it('raises SKILL/vs-peers when vsGold is null and vsPeers < publishableFloor', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 20, vsGold: null, vsPeers: 0.3, vsSelf: 0.9 },
    ];
    const out = evaluateCalibrationFlags(inputs, DEFAULT);
    expect(out[0]!.flagType).toBe('SKILL');
    expect(out[0]!.metric).toBe('vs-peers');
  });

  it('raises DRIFT only when peer/gold are OK but vsSelf < fatigueFloor', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 20, vsGold: 0.8, vsPeers: 0.75, vsSelf: 0.4 },
    ];
    const out = evaluateCalibrationFlags(inputs, DEFAULT);
    expect(out).toHaveLength(1);
    expect(out[0]!.flagType).toBe('DRIFT');
    expect(out[0]!.metric).toBe('vs-self');
  });

  it('does NOT raise DRIFT when vsSelf is null', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 20, vsGold: 0.8, vsPeers: 0.8, vsSelf: null },
    ];
    expect(evaluateCalibrationFlags(inputs, DEFAULT)).toEqual([]);
  });

  it('skips annotators below minSampleSize', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 1, vsGold: 0.0, vsPeers: 0.0, vsSelf: 0.0 },
    ];
    expect(evaluateCalibrationFlags(inputs, DEFAULT)).toEqual([]);
  });

  it('SKILL takes precedence over DRIFT when both would fire', () => {
    const inputs: CalibrationAnnotatorInput[] = [
      { annotatorUserId: ANN_A, sampleSize: 20, vsGold: 0.4, vsPeers: 0.4, vsSelf: 0.3 },
    ];
    const out = evaluateCalibrationFlags(inputs, DEFAULT);
    expect(out).toHaveLength(1);
    expect(out[0]!.flagType).toBe('SKILL');
  });
});

// -----------------------------------------------------------------------------

interface RepoMock {
  listSubmissionsForCampaign: ReturnType<typeof vi.fn>;
  findActiveFlag: ReturnType<typeof vi.fn>;
  listActiveFlagsForCampaign: ReturnType<typeof vi.fn>;
  raiseFlag: ReturnType<typeof vi.fn>;
  clearFlag: ReturnType<typeof vi.fn>;
}

interface CampaignRepoMock {
  findBySlug: ReturnType<typeof vi.fn>;
  listRecent: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let campaigns: CampaignRepoMock;
let service: CalibrationService;

beforeEach(() => {
  repo = {
    listSubmissionsForCampaign: vi.fn().mockResolvedValue([]),
    findActiveFlag: vi.fn().mockResolvedValue(null),
    listActiveFlagsForCampaign: vi.fn().mockResolvedValue([]),
    raiseFlag: vi.fn().mockImplementation(async (args) => ({ id: 'new-flag', ...args })),
    clearFlag: vi.fn().mockResolvedValue({}),
  };
  campaigns = {
    findBySlug: vi.fn().mockResolvedValue(null),
    listRecent: vi.fn().mockResolvedValue([]),
  };
  service = new CalibrationService(
    repo as unknown as CalibrationRepository,
    campaigns as unknown as CampaignRepository,
  );
});

function row(user: string, sampleRef: string, label: string): AnnotatorSubmissionRow {
  return {
    taskId: `t-${sampleRef}`,
    sampleRef,
    assigneeUserId: user,
    submission: { label },
    submittedAt: new Date('2026-05-26T12:00:00Z'),
  };
}

describe('CalibrationService.computeAnnotatorStats', () => {
  it('produces vsPeers κ from majority-of-others on shared samples', () => {
    // Four annotators on 4 samples. B, C, D always agree;
    // A diverges on s4. With 3 peers per POV, ties don't bias the
    // majority — B/C/D get κ=1.0 (their POV majority always matches
    // them); A gets κ<1.0 because the majority of others disagrees
    // with A on s4.
    const rows = [
      row(ANN_A, 's1', 'pneumonia'),
      row(ANN_B, 's1', 'pneumonia'),
      row(ANN_C, 's1', 'pneumonia'),
      row(ANN_D, 's1', 'pneumonia'),
      row(ANN_A, 's2', 'normal'),
      row(ANN_B, 's2', 'normal'),
      row(ANN_C, 's2', 'normal'),
      row(ANN_D, 's2', 'normal'),
      row(ANN_A, 's3', 'pneumonia'),
      row(ANN_B, 's3', 'pneumonia'),
      row(ANN_C, 's3', 'pneumonia'),
      row(ANN_D, 's3', 'pneumonia'),
      row(ANN_A, 's4', 'effusion'),
      row(ANN_B, 's4', 'normal'),
      row(ANN_C, 's4', 'normal'),
      row(ANN_D, 's4', 'normal'),
    ];
    const stats = service.computeAnnotatorStats(rows);
    const byUser = new Map(stats.map((s) => [s.annotatorUserId, s]));
    expect(byUser.get(ANN_B)!.vsPeers).toBeGreaterThan(0.9);
    // A has one mismatch out of four vs majority-of-others
    expect(byUser.get(ANN_A)!.vsPeers).toBeLessThan(byUser.get(ANN_B)!.vsPeers!);
  });

  it('returns vsPeers=null when no shared samples exist', () => {
    const rows = [row(ANN_A, 's1', 'a'), row(ANN_B, 's2', 'b')];
    const stats = service.computeAnnotatorStats(rows);
    for (const s of stats) expect(s.vsPeers).toBeNull();
  });

  it('leaves vsGold and vsSelf null in the first-cut implementation', () => {
    const rows = [row(ANN_A, 's1', 'pneumonia'), row(ANN_B, 's1', 'pneumonia')];
    const stats = service.computeAnnotatorStats(rows);
    expect(stats.every((s) => s.vsGold === null)).toBe(true);
    expect(stats.every((s) => s.vsSelf === null)).toBe(true);
  });
});

// -----------------------------------------------------------------------------

describe('CalibrationService.listForCampaign', () => {
  it('throws 404 when the campaign does not exist', async () => {
    campaigns.findBySlug.mockResolvedValue(null);
    await expect(service.listForCampaign('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only ACTIVE flags shaped as contract', async () => {
    campaigns.findBySlug.mockResolvedValue({ id: 'cmp-1', slug: 'pilot' });
    const flag: AnnotatorCalibrationFlag = {
      id: 'flag-1',
      campaignId: 'cmp-1',
      annotatorUserId: ANN_A,
      flagType: 'SKILL',
      metric: 'vs-peers',
      score: 0.3,
      threshold: 0.6,
      sampleSize: 20,
      status: 'ACTIVE',
      windowMeta: { since: '2026-05-19T00:00:00Z' },
      createdAt: new Date('2026-05-26T00:00:00Z'),
      clearedAt: null,
    } as unknown as AnnotatorCalibrationFlag;
    repo.listActiveFlagsForCampaign.mockResolvedValue([flag]);
    const out = await service.listForCampaign('pilot');
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.flagType).toBe('SKILL');
    expect(out.items[0]!.status).toBe('ACTIVE');
  });
});

// -----------------------------------------------------------------------------

describe('CalibrationService.runOnce', () => {
  it('only scans RUNNING campaigns', async () => {
    campaigns.listRecent.mockResolvedValue([
      { id: 'a', slug: 'a', status: 'RUNNING' } as AnnotationCampaign,
      { id: 'b', slug: 'b', status: 'DRAFT' } as AnnotationCampaign,
      { id: 'c', slug: 'c', status: 'COMPLETED' } as AnnotationCampaign,
    ]);
    await service.runOnce();
    // Only one campaign passed to the submissions listing — one
    // call per RUNNING campaign.
    expect(repo.listSubmissionsForCampaign).toHaveBeenCalledTimes(1);
    expect(repo.listSubmissionsForCampaign).toHaveBeenCalledWith('a', expect.any(Date));
  });
});

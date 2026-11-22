import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AnnotationGateState } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cognitoSubAsUuid } from '../../auth/cognito-sub.js';
import type { DicomSeriesService } from '../storage/dicom-series.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { AssignmentSampleService, SAMPLE_URL_TTL_SECONDS } from './assignment-sample.service.js';
import type { CampaignRepository } from './campaign.repository.js';
import type { TaskRepository } from './task.repository.js';

const READER = 'reader';
const OTHER = 'someone-else';
const NOW = Date.parse('2026-11-16T10:00:00Z');
const DIST = '11111111-1111-4111-8111-111111111111';
const SERIES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

function assignment(
  over: { status?: string; gate?: AnnotationGateState; assignee?: string; sampleRef?: string } = {},
) {
  return {
    id: 'asn-1',
    taskId: 'task-1',
    assigneeUserId: cognitoSubAsUuid(over.assignee ?? READER),
    assigneeRole: 'annotator',
    gateAtAssignment: over.gate ?? 'INDEPENDENT',
    status: over.status ?? 'PENDING',
    task: {
      id: 'task-1',
      campaignId: 'cmp-1',
      sampleRef: over.sampleRef ?? `file:${DIST}`,
    },
  };
}

let campaigns: {
  findById: ReturnType<typeof vi.fn>;
  findHostedImageFile: ReturnType<typeof vi.fn>;
};
let dicomSeries: { taskSample: ReturnType<typeof vi.fn> };
let tasks: {
  findAssignmentById: ReturnType<typeof vi.fn>;
  submissionPayloadsAtGate: ReturnType<typeof vi.fn>;
};
let storage: { signHostedRead: ReturnType<typeof vi.fn> };
let service: AssignmentSampleService;

beforeEach(() => {
  campaigns = {
    findById: vi.fn().mockResolvedValue({ id: 'cmp-1', manifestVersionId: 'dv-1' }),
    findHostedImageFile: vi.fn().mockResolvedValue({
      s3Bucket: 'oci-datasets-local',
      s3Key: 'ds/u1/IDRiD_001.jpg',
      contentType: 'image/jpeg',
    }),
  };
  tasks = {
    findAssignmentById: vi.fn().mockResolvedValue(assignment()),
    submissionPayloadsAtGate: vi.fn().mockResolvedValue([]),
  };
  storage = { signHostedRead: vi.fn().mockResolvedValue('https://s3.example/signed') };
  dicomSeries = { taskSample: vi.fn() };
  service = new AssignmentSampleService(
    campaigns as unknown as CampaignRepository,
    tasks as unknown as TaskRepository,
    storage as unknown as StorageService,
    dicomSeries as unknown as DicomSeriesService,
  );
});

describe('AssignmentSampleService.sample (#646)', () => {
  it('gives the assignee a short-lived address and nothing else', async () => {
    const out = await service.sample({
      assignmentId: 'asn-1',
      user: user(READER),
      userGroups: ['annotator'],
      nowMs: NOW,
    });

    expect(campaigns.findHostedImageFile).toHaveBeenCalledWith('dv-1', DIST);
    expect(storage.signHostedRead).toHaveBeenCalledWith({
      bucket: 'oci-datasets-local',
      key: 'ds/u1/IDRiD_001.jpg',
      contentType: 'image/jpeg',
      ttlSeconds: SAMPLE_URL_TTL_SECONDS,
    });
    expect(out).toEqual({
      kind: 'image',
      url: 'https://s3.example/signed',
      contentType: 'image/jpeg',
      expiresAt: new Date(NOW + SAMPLE_URL_TTL_SECONDS * 1000).toISOString(),
    });
  });

  it('refuses another annotator', async () => {
    await expect(
      service.sample({ assignmentId: 'asn-1', user: user(OTHER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.signHostedRead).not.toHaveBeenCalled();
  });

  it.each(['SUBMITTED', 'EXPIRED', 'RELEASED'])(
    'refuses the assignee once the assignment is %s',
    async (status) => {
      tasks.findAssignmentById.mockResolvedValue(assignment({ status }));
      await expect(
        service.sample({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each(['campaign-manager', 'task-supervisor'])('lets a %s see it', async (group) => {
    tasks.findAssignmentById.mockResolvedValue(assignment({ status: 'SUBMITTED' }));
    const out = await service.sample({
      assignmentId: 'asn-1',
      user: user(OTHER),
      userGroups: [group],
    });
    expect(out).toMatchObject({ kind: 'image', url: 'https://s3.example/signed' });
  });

  it('hands a dicom-series reference to the series side, against the pinned version', async () => {
    const series = { kind: 'dicom-series', modality: 'CT', expiresAt: 'x', instances: [] };
    tasks.findAssignmentById.mockResolvedValue(assignment({ sampleRef: `dicom-series:${SERIES}` }));
    dicomSeries.taskSample.mockResolvedValue(series);
    const out = await service.sample({
      assignmentId: 'asn-1',
      user: user(READER),
      userGroups: ['annotator'],
    });
    expect(dicomSeries.taskSample).toHaveBeenCalledWith({
      sampleRef: `dicom-series:${SERIES}`,
      versionId: 'dv-1',
    });
    expect(campaigns.findHostedImageFile).not.toHaveBeenCalled();
    expect(out).toBe(series);
  });

  it('passes on the 409 of a series with a held file', async () => {
    tasks.findAssignmentById.mockResolvedValue(assignment({ sampleRef: `dicom-series:${SERIES}` }));
    dicomSeries.taskSample.mockRejectedValue(new ConflictException('held'));
    await expect(
      service.sample({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies the task rule before asking the series side', async () => {
    tasks.findAssignmentById.mockResolvedValue(assignment({ sampleRef: `dicom-series:${SERIES}` }));
    await expect(
      service.sample({ assignmentId: 'asn-1', user: user(OTHER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dicomSeries.taskSample).not.toHaveBeenCalled();
  });

  it('404s when the file is not a hosted image of the pinned version', async () => {
    campaigns.findHostedImageFile.mockResolvedValue(null);
    await expect(
      service.sample({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['ds/u1/IDRiD_001.jpg', 'file:not-a-uuid', 'free text'])(
    '404s on a reference that is not a typed platform id (%s)',
    async (sampleRef) => {
      tasks.findAssignmentById.mockResolvedValue(assignment({ sampleRef }));
      await expect(
        service.sample({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(campaigns.findHostedImageFile).not.toHaveBeenCalled();
      expect(dicomSeries.taskSample).not.toHaveBeenCalled();
    },
  );

  it('409s when the campaign pins no dataset version', async () => {
    campaigns.findById.mockResolvedValue({ id: 'cmp-1', manifestVersionId: null });
    await expect(
      service.sample({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AssignmentSampleService.readings (#646)', () => {
  it("gives the arbiter the readers' labels and comments, and nothing about who gave them", async () => {
    tasks.findAssignmentById.mockResolvedValue(assignment({ gate: 'AWAITING_ARBITRATION' }));
    tasks.submissionPayloadsAtGate.mockResolvedValue([
      { label: 'normal', comment: 'small drusen only' },
      { label: 'abnormal', comment: 'haemorrhage at the macula' },
      { label: 'normal' },
    ]);

    const out = await service.readings({
      assignmentId: 'asn-1',
      user: user(READER),
      userGroups: ['arbitration-annotator'],
    });

    expect(tasks.submissionPayloadsAtGate).toHaveBeenCalledWith('task-1', 'INDEPENDENT');
    // Sorted by label then comment: the order of reading is not shown.
    expect(out).toEqual({
      readings: [
        { label: 'abnormal', comment: 'haemorrhage at the macula' },
        { label: 'normal', comment: null },
        { label: 'normal', comment: 'small drusen only' },
      ],
    });
    for (const r of out.readings) expect(Object.keys(r).sort()).toEqual(['comment', 'label']);
  });

  it('refuses at the independent step, where readers must not see each other', async () => {
    await expect(
      service.readings({ assignmentId: 'asn-1', user: user(READER), userGroups: ['annotator'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

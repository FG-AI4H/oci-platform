import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AnnotationCampaign, AnnotationToolIntegration } from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from './campaign.repository.js';
import { CampaignService } from './campaign.service.js';

const SUB_UUID = '00000000-0000-4000-8000-000000000001';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

const TOOL: AnnotationToolIntegration = {
  id: 'tool-monai',
  slug: 'monai-label',
  name: 'MONAI Label',
  vendor: 'NVIDIA / Project MONAI',
  version: '0.8',
  isActive: true,
  supportedTaskKinds: ['SEGMENTATION', 'CLASSIFICATION'],
  createdAt: new Date('2026-05-01T00:00:00Z'),
  updatedAt: new Date('2026-05-01T00:00:00Z'),
} as unknown as AnnotationToolIntegration;

const ROW: AnnotationCampaign & { toolIntegration: AnnotationToolIntegration } = {
  id: 'cmp-1',
  slug: 'chest-xr-pilot',
  name: 'Chest XR Pilot',
  description: null,
  status: 'DRAFT',
  taskKind: 'CLASSIFICATION',
  datasetId: 'ds-1',
  toolIntegrationId: TOOL.id,
  outputLicense: 'CC_BY_4_0',
  workflowConfig: { nAnnotators: 3 },
  createdById: SUB_UUID,
  createdAt: new Date('2026-05-16T00:00:00Z'),
  updatedAt: new Date('2026-05-16T00:00:00Z'),
  toolIntegration: TOOL,
} as unknown as AnnotationCampaign & { toolIntegration: AnnotationToolIntegration };

interface RepoMock {
  findBySlug: ReturnType<typeof vi.fn>;
  listRecent: ReturnType<typeof vi.fn>;
  countAll: ReturnType<typeof vi.fn>;
  findToolIntegrationById: ReturnType<typeof vi.fn>;
  listActiveToolIntegrations: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: CampaignService;

function withStatus(status: AnnotationCampaign['status']): typeof ROW {
  return { ...ROW, status };
}

beforeEach(() => {
  repo = {
    findBySlug: vi.fn(),
    listRecent: vi.fn(),
    countAll: vi.fn(),
    findToolIntegrationById: vi.fn(),
    listActiveToolIntegrations: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
  };
  service = new CampaignService(repo as unknown as CampaignRepository);
});

describe('CampaignService.create', () => {
  it('persists a draft campaign with default outputLicense + workflowConfig', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    repo.create.mockResolvedValue(ROW);

    const out = await service.create(
      {
        slug: 'chest-xr-pilot',
        name: 'Chest XR Pilot',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );

    expect(out.slug).toBe('chest-xr-pilot');
    expect(out.status).toBe('DRAFT');
    expect(out.toolIntegration.slug).toBe('monai-label');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'chest-xr-pilot',
        outputLicense: 'CC_BY_4_0',
        workflowConfig: { nAnnotators: 3 },
        createdById: SUB_UUID,
      }),
    );
  });

  it('rejects a duplicate slug with 409', async () => {
    repo.findBySlug.mockResolvedValue(ROW);

    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'Dup',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown toolIntegrationId with 400', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(null);

    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'Chest XR Pilot',
          datasetId: 'ds-1',
          toolIntegrationId: 'tool-does-not-exist',
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a tool that does not support the requested taskKind', async () => {
    repo.findBySlug.mockResolvedValue(null);
    // MONAI Label supports SEGMENTATION + CLASSIFICATION, not DETECTION.
    repo.findToolIntegrationById.mockResolvedValue(TOOL);

    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'Chest XR Pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'DETECTION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('CampaignService.detail', () => {
  it('returns the campaign detail when the slug exists', async () => {
    repo.findBySlug.mockResolvedValue(ROW);

    const out = await service.detail('chest-xr-pilot');

    expect(out.id).toBe(ROW.id);
    expect(out.toolIntegration.slug).toBe('monai-label');
  });

  it('throws 404 when the slug is unknown', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(service.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CampaignService.transition (lifecycle state machine, #215 slice 1)', () => {
  it('DRAFT → READY via mark-ready stamps no timestamp', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('DRAFT'));
    repo.updateStatus.mockResolvedValue(withStatus('READY'));

    const out = await service.transition('chest-xr-pilot', 'mark-ready', undefined, user(SUB_UUID));

    expect(out.status).toBe('READY');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'READY' }),
    );
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.not.objectContaining({ stampStartedAt: true }),
    );
  });

  it('READY → RUNNING via start stamps startedAt', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('READY'));
    repo.updateStatus.mockResolvedValue(withStatus('RUNNING'));

    await service.transition('chest-xr-pilot', 'start', undefined, user(SUB_UUID));

    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'RUNNING', stampStartedAt: true }),
    );
  });

  it('RUNNING → COMPLETED via complete stamps completedAt', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('RUNNING'));
    repo.updateStatus.mockResolvedValue(withStatus('COMPLETED'));

    await service.transition('chest-xr-pilot', 'complete', undefined, user(SUB_UUID));

    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'COMPLETED', stampCompletedAt: true }),
    );
  });

  it('COMPLETED → ARCHIVED via archive is allowed without a reason', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('COMPLETED'));
    repo.updateStatus.mockResolvedValue(withStatus('ARCHIVED'));

    await service.transition('chest-xr-pilot', 'archive', undefined, user(SUB_UUID));

    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'ARCHIVED' }),
    );
  });

  it('READY → DRAFT via revert-to-draft REQUIRES a reason', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('READY'));

    await expect(
      service.transition('chest-xr-pilot', 'revert-to-draft', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateStatus).not.toHaveBeenCalled();

    repo.updateStatus.mockResolvedValue(withStatus('DRAFT'));
    await service.transition('chest-xr-pilot', 'revert-to-draft', 'mistyped slug', user(SUB_UUID));
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'DRAFT' }),
    );
  });

  it('RUNNING → ARCHIVED via archive REQUIRES a reason (emergency stop)', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('RUNNING'));

    await expect(
      service.transition('chest-xr-pilot', 'archive', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(BadRequestException);

    repo.updateStatus.mockResolvedValue(withStatus('ARCHIVED'));
    await service.transition('chest-xr-pilot', 'archive', 'data leak found', user(SUB_UUID));
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'ARCHIVED' }),
    );
  });

  it('illegal transition (DRAFT → start) is 400', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('DRAFT'));

    await expect(
      service.transition('chest-xr-pilot', 'start', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('illegal transition (ARCHIVED → anything) is 400', async () => {
    repo.findBySlug.mockResolvedValue(withStatus('ARCHIVED'));

    await expect(
      service.transition('chest-xr-pilot', 'complete', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the slug is unknown', async () => {
    repo.findBySlug.mockResolvedValue(null);

    await expect(
      service.transition('nope', 'mark-ready', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mark-ready preflight rejects a deactivated tool integration', async () => {
    const deactivated: AnnotationToolIntegration = { ...TOOL, isActive: false };
    repo.findBySlug.mockResolvedValue({
      ...withStatus('DRAFT'),
      toolIntegration: deactivated,
    });

    await expect(
      service.transition('chest-xr-pilot', 'mark-ready', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('mark-ready preflight rejects nAnnotators outside [1, 12]', async () => {
    repo.findBySlug.mockResolvedValue({
      ...withStatus('DRAFT'),
      workflowConfig: { nAnnotators: 99 },
    });

    await expect(
      service.transition('chest-xr-pilot', 'mark-ready', undefined, user(SUB_UUID)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});

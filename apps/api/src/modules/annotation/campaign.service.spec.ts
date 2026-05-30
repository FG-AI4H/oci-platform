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
  manifestVersionId: null,
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
  findDatasetModalities: ReturnType<typeof vi.fn>;
  findDatasetLicenseContext: ReturnType<typeof vi.fn>;
  findDatasetVersion: ReturnType<typeof vi.fn>;
  findLatestDatasetVersion: ReturnType<typeof vi.fn>;
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
    findDatasetModalities: vi.fn(),
    // Default to OPEN / OK so tests that don't care about the
    // license-context check just pass through. Per-test overrides
    // exercise the CONTROLLED / SENSITIVE / NCU branches.
    findDatasetLicenseContext: vi
      .fn()
      .mockResolvedValue({ accessTier: 'OPEN', commercialUseTerms: 'OK' }),
    // Default: dataset has no published version → manifestVersionId
    // resolves to null (legacy resolve-at-use posture). Per-test
    // overrides exercise the pin + mismatch branches.
    findDatasetVersion: vi.fn(),
    findLatestDatasetVersion: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    updateStatus: vi.fn(),
  };
  service = new CampaignService(repo as unknown as CampaignRepository);
});

/**
 * Wire the modality lookup the campaign service performs after the
 * tool-integration check (#247). Tests that don't care about the
 * constraint just hand back a permissive dataset (X-ray → all four
 * imaging task kinds).
 */
function mockDatasetModalities(modalities: string[], slug = 'chest-xr-pilot') {
  repo.findDatasetModalities.mockResolvedValue({
    id: 'ds-1',
    slug,
    modalities,
  });
}

describe('CampaignService.create', () => {
  it('persists a draft campaign with default outputLicense + workflowConfig', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
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

  it('uses CC-BY-NC-4.0 as default for CONTROLLED-tier datasets (#235)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.findDatasetLicenseContext.mockResolvedValueOnce({
      accessTier: 'CONTROLLED',
      commercialUseTerms: 'CASE_BY_CASE',
    });
    repo.create.mockResolvedValue(ROW);

    await service.create(
      {
        slug: 'controlled-pilot',
        name: 'Controlled',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ outputLicense: 'CC_BY_NC_4_0' }),
    );
  });

  it('uses custom-restricted as default for SENSITIVE-tier datasets (#235)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.findDatasetLicenseContext.mockResolvedValueOnce({
      accessTier: 'SENSITIVE',
      commercialUseTerms: 'CASE_BY_CASE',
    });
    repo.create.mockResolvedValue(ROW);

    await service.create(
      {
        slug: 'sensitive-pilot',
        name: 'Sensitive',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ outputLicense: 'CUSTOM_RESTRICTED' }),
    );
  });

  it('rejects a CC-BY-4.0 output on a NCU dataset (#235)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.findDatasetLicenseContext.mockResolvedValueOnce({
      accessTier: 'CONTROLLED',
      commercialUseTerms: 'NON_COMMERCIAL_ONLY',
    });

    await expect(
      service.create(
        {
          slug: 'ncu-pilot',
          name: 'NCU',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
          outputLicense: 'CC-BY-4.0',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts CC-BY-NC-4.0 on a NCU dataset', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.findDatasetLicenseContext.mockResolvedValueOnce({
      accessTier: 'CONTROLLED',
      commercialUseTerms: 'NON_COMMERCIAL_ONLY',
    });
    repo.create.mockResolvedValue(ROW);

    await service.create(
      {
        slug: 'ncu-pilot',
        name: 'NCU',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
        outputLicense: 'CC-BY-NC-4.0',
      },
      user(SUB_UUID),
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ outputLicense: 'CC_BY_NC_4_0' }),
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

/**
 * Modality → allowed task-kinds server-side guard (#247). Mirrors the
 * disabled-radios behaviour on the campaign-create form for defence in
 * depth. The curated mapping lives in @oci/shared-types/modality-task-kinds.
 */
describe('CampaignService.create — modality → task-kind guard (#247)', () => {
  it('X-ray dataset + CLASSIFICATION passes', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.create.mockResolvedValue(ROW);

    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'Chest XR Pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalled();
  });

  it('text dataset + SEGMENTATION is rejected with 400', async () => {
    const TEXT_TOOL: AnnotationToolIntegration = {
      ...TOOL,
      supportedTaskKinds: ['SEGMENTATION', 'CLASSIFICATION', 'MULTI_MODAL'],
    } as AnnotationToolIntegration;

    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TEXT_TOOL);
    mockDatasetModalities(['Text']);

    await expect(
      service.create(
        {
          slug: 'notes-pilot',
          name: 'Clinical notes pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TEXT_TOOL.id,
          taskKind: 'SEGMENTATION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('timeseries dataset + DETECTION is rejected with 400', async () => {
    const TS_TOOL: AnnotationToolIntegration = {
      ...TOOL,
      supportedTaskKinds: ['DETECTION', 'CLASSIFICATION'],
    } as AnnotationToolIntegration;
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TS_TOOL);
    mockDatasetModalities(['ECG']);

    await expect(
      service.create(
        {
          slug: 'ecg-pilot',
          name: 'ECG pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TS_TOOL.id,
          taskKind: 'DETECTION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('text dataset + CLASSIFICATION passes (Text allows CLASSIFICATION + MULTI_MODAL)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['Text']);
    repo.create.mockResolvedValue(ROW);

    await expect(
      service.create(
        {
          slug: 'notes-pilot',
          name: 'Clinical notes pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalled();
  });

  it('dataset with no modalities declared falls back to "allow all" (does not block)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities([]);
    repo.create.mockResolvedValue(ROW);

    await expect(
      service.create(
        {
          slug: 'mystery-pilot',
          name: 'Mystery pilot',
          datasetId: 'ds-1',
          toolIntegrationId: TOOL.id,
          taskKind: 'SEGMENTATION', // would be blocked if modalities said "Text"
        },
        user(SUB_UUID),
      ),
    ).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalled();
  });

  it('unknown datasetId yields a 400 (not a deferred FK violation)', async () => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    repo.findDatasetModalities.mockResolvedValue(null);

    await expect(
      service.create(
        {
          slug: 'nope',
          name: 'No such dataset',
          datasetId: '00000000-0000-4000-8000-000000000999',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
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

describe('CampaignService — manifest version pin (ADR-0016 Decision 1, #320)', () => {
  beforeEach(() => {
    repo.findBySlug.mockResolvedValue(null);
    repo.findToolIntegrationById.mockResolvedValue(TOOL);
    mockDatasetModalities(['X-ray']);
    repo.create.mockResolvedValue(ROW);
  });

  it('default-pins the dataset latest version when manifestVersionId is omitted', async () => {
    repo.findLatestDatasetVersion.mockResolvedValue({
      id: 'dv-9',
      datasetId: 'ds-1',
      version: '2.0.0',
    });
    await service.create(
      {
        slug: 'chest-xr-pilot',
        name: 'X',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ manifestVersionId: 'dv-9' }),
    );
  });

  it('leaves manifestVersionId null when the dataset has no published version', async () => {
    repo.findLatestDatasetVersion.mockResolvedValue(null);
    await service.create(
      {
        slug: 'chest-xr-pilot',
        name: 'X',
        datasetId: 'ds-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ manifestVersionId: null }));
  });

  it('pins a supplied manifestVersionId that belongs to the dataset', async () => {
    repo.findDatasetVersion.mockResolvedValue({ id: 'dv-1', datasetId: 'ds-1', version: '1.0.0' });
    await service.create(
      {
        slug: 'chest-xr-pilot',
        name: 'X',
        datasetId: 'ds-1',
        manifestVersionId: 'dv-1',
        toolIntegrationId: TOOL.id,
        taskKind: 'CLASSIFICATION',
      },
      user(SUB_UUID),
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ manifestVersionId: 'dv-1' }),
    );
  });

  it('400s a supplied manifestVersionId that belongs to a different dataset', async () => {
    repo.findDatasetVersion.mockResolvedValue({
      id: 'dv-x',
      datasetId: 'other-ds',
      version: '1.0.0',
    });
    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'X',
          datasetId: 'ds-1',
          manifestVersionId: 'dv-x',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('400s a supplied manifestVersionId that does not exist', async () => {
    repo.findDatasetVersion.mockResolvedValue(null);
    await expect(
      service.create(
        {
          slug: 'chest-xr-pilot',
          name: 'X',
          datasetId: 'ds-1',
          manifestVersionId: 'dv-missing',
          toolIntegrationId: TOOL.id,
          taskKind: 'CLASSIFICATION',
        },
        user(SUB_UUID),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assertManifestVersionMutable throws 409 once started, passes while DRAFT/READY', () => {
    expect(() => service.assertManifestVersionMutable('DRAFT')).not.toThrow();
    expect(() => service.assertManifestVersionMutable('READY')).not.toThrow();
    expect(() => service.assertManifestVersionMutable('RUNNING')).toThrow(ConflictException);
    expect(() => service.assertManifestVersionMutable('COMPLETED')).toThrow(ConflictException);
  });
});

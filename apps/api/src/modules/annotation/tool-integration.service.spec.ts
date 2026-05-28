import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetadataVisibilityService } from './metadata-visibility.service.js';
import { ToolIntegrationRepository } from './tool-integration.repository.js';
import { ToolIntegrationService } from './tool-integration.service.js';

const CURRENT_VERSION = {
  id: 'ver-1',
  integrationId: 'int-1',
  version: '1.2.0',
  schemaProfile: 'classification-v1',
  launchUrlTemplate: 'https://tool.example/launch?token={token}',
  callbackUrlPath: '/cb',
  outputFormats: ['jsonl-custom'],
  releaseNotes: null,
  isCurrent: true,
  createdAt: new Date('2026-05-29T00:00:00Z'),
};

const INTEGRATION = {
  id: 'int-1',
  slug: 'monai-label',
  name: 'MONAI Label',
  vendor: 'MONAI',
  version: '1.2.0',
  isActive: true,
  supportedTaskKinds: ['CLASSIFICATION'],
  homepageUrl: null,
  modalities: ['image-2d'],
  annotationTypes: ['classification'],
  supportsPreAnnotation: true,
  supportsActiveLearning: false,
  authMode: 'RFC8693',
  launchMode: 'REDIRECT',
  createdAt: new Date('2026-05-29T00:00:00Z'),
  updatedAt: new Date('2026-05-29T00:00:00Z'),
  versions: [CURRENT_VERSION],
};

const ASSIGNMENT = {
  id: 'asn-1',
  taskId: 'task-1',
  task: { id: 'task-1', campaignId: 'cmp-1', gateState: 'INDEPENDENT' },
};

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmp-1',
    slug: 'chest-xr',
    status: 'RUNNING',
    toolIntegrationId: 'int-1',
    toolVersionId: null,
    visibilityConfig: null,
    ...overrides,
  };
}

interface RepoMock {
  findIntegrationById: ReturnType<typeof vi.fn>;
  findVersionById: ReturnType<typeof vi.fn>;
  findCurrentVersion: ReturnType<typeof vi.fn>;
  findAssignmentById: ReturnType<typeof vi.fn>;
  findCampaignById: ReturnType<typeof vi.fn>;
  findReceipt: ReturnType<typeof vi.fn>;
  createReceipt: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let visibility: { compose: ReturnType<typeof vi.fn> };
let service: ToolIntegrationService;

beforeEach(() => {
  repo = {
    findIntegrationById: vi.fn(),
    findVersionById: vi.fn(),
    findCurrentVersion: vi.fn(),
    findAssignmentById: vi.fn(),
    findCampaignById: vi.fn(),
    findReceipt: vi.fn(),
    createReceipt: vi.fn(),
  };
  visibility = {
    compose: vi.fn().mockReturnValue({
      bundle: { required: { modality: 'CR' }, optional: {} },
      exposureProfile: {
        visibilityConfigHash: 'h',
        visibilityConfigVersion: 'v',
        deliveredFields: ['modality'],
      },
    }),
  };
  service = new ToolIntegrationService(
    repo as unknown as ToolIntegrationRepository,
    visibility as unknown as MetadataVisibilityService,
  );
});

describe('ToolIntegrationService.handoff', () => {
  it('builds a descriptor from the current version + filtered metadataBundle; defers token + presign', async () => {
    repo.findAssignmentById.mockResolvedValue(ASSIGNMENT);
    repo.findCampaignById.mockResolvedValue(campaign());
    repo.findIntegrationById.mockResolvedValue(INTEGRATION);

    const d = await service.handoff('int-1', 'asn-1');

    expect(d.version).toBe('1.2.0');
    expect(d.schemaProfile).toBe('classification-v1');
    expect(d.gate).toBe('INDEPENDENT');
    expect(d.metadataBundle).toEqual({ required: { modality: 'CR' }, optional: {} });
    // Security-boundary seams are null in this slice:
    expect(d.launchToken).toBeNull();
    expect(d.sampleUrl).toBeNull();
    // metadataBundle was composed from the campaign's visibility config + task gate
    expect(visibility.compose).toHaveBeenCalledWith(null, {}, 'INDEPENDENT');
  });

  it('honours a pinned campaign version over the current version', async () => {
    const pinned = { ...CURRENT_VERSION, id: 'ver-0', version: '1.0.0' };
    repo.findAssignmentById.mockResolvedValue(ASSIGNMENT);
    repo.findCampaignById.mockResolvedValue(campaign({ toolVersionId: 'ver-0' }));
    repo.findIntegrationById.mockResolvedValue(INTEGRATION);
    repo.findVersionById.mockResolvedValue(pinned);

    const d = await service.handoff('int-1', 'asn-1');
    expect(d.version).toBe('1.0.0');
  });

  it('rejects a handoff whose integration does not match the campaign tool', async () => {
    repo.findAssignmentById.mockResolvedValue(ASSIGNMENT);
    repo.findCampaignById.mockResolvedValue(campaign({ toolIntegrationId: 'other-tool' }));
    await expect(service.handoff('int-1', 'asn-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a pinned version that belongs to a different integration (version guard)', async () => {
    repo.findAssignmentById.mockResolvedValue(ASSIGNMENT);
    repo.findCampaignById.mockResolvedValue(campaign({ toolVersionId: 'ver-x' }));
    repo.findIntegrationById.mockResolvedValue(INTEGRATION);
    repo.findVersionById.mockResolvedValue({
      ...CURRENT_VERSION,
      id: 'ver-x',
      integrationId: 'other',
    });
    await expect(service.handoff('int-1', 'asn-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when the integration has no current version and the campaign pins none', async () => {
    repo.findAssignmentById.mockResolvedValue(ASSIGNMENT);
    repo.findCampaignById.mockResolvedValue(campaign());
    repo.findIntegrationById.mockResolvedValue({ ...INTEGRATION, versions: [] });
    await expect(service.handoff('int-1', 'asn-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ToolIntegrationService.callback', () => {
  const validBody = { assignmentId: 'asn-1', versionId: 'ver-1', payload: { label: 'pneumonia' } };

  it('accepts a first valid callback (202) and persists a receipt', async () => {
    repo.findVersionById.mockResolvedValue(CURRENT_VERSION);
    repo.findReceipt.mockResolvedValue(null);
    repo.createReceipt.mockResolvedValue({ id: 'rcpt-1' });

    const { response, httpStatus } = await service.callback('int-1', validBody, 'key-1');
    expect(httpStatus).toBe(202);
    expect(response.status).toBe('accepted');
    expect(response.receiptId).toBe('rcpt-1');
    expect(repo.createReceipt).toHaveBeenCalledOnce();
  });

  it('replays the cached result (200 duplicate) on the same key + body, without a new receipt', async () => {
    repo.findVersionById.mockResolvedValue(CURRENT_VERSION);
    repo.findReceipt.mockResolvedValueOnce(null);
    repo.createReceipt.mockResolvedValue({ id: 'rcpt-1' });
    await service.callback('int-1', validBody, 'key-1');
    const persistedHash = repo.createReceipt.mock.calls[0][0].payloadHash as string;

    repo.findReceipt.mockResolvedValue({ id: 'rcpt-1', payloadHash: persistedHash });
    const { response, httpStatus } = await service.callback('int-1', validBody, 'key-1');
    expect(httpStatus).toBe(200);
    expect(response.status).toBe('duplicate');
    expect(response.receiptId).toBe('rcpt-1');
    expect(repo.createReceipt).toHaveBeenCalledOnce(); // not called a second time
  });

  it('rejects a key reused with a different body (409)', async () => {
    repo.findVersionById.mockResolvedValue(CURRENT_VERSION);
    repo.findReceipt.mockResolvedValue({ id: 'rcpt-1', payloadHash: 'a-different-hash' });
    await expect(service.callback('int-1', validBody, 'key-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a payload that fails the version schemaProfile (422)', async () => {
    repo.findVersionById.mockResolvedValue(CURRENT_VERSION);
    repo.findReceipt.mockResolvedValue(null);
    const bad = { assignmentId: 'asn-1', versionId: 'ver-1', payload: { notLabel: 1 } };
    await expect(service.callback('int-1', bad, 'key-2')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a version that is not part of the integration (400)', async () => {
    repo.findVersionById.mockResolvedValue({ ...CURRENT_VERSION, integrationId: 'other' });
    await expect(service.callback('int-1', validBody, 'key-3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a missing idempotency key (400)', async () => {
    await expect(service.callback('int-1', validBody, '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

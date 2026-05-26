import { NotFoundException } from '@nestjs/common';
import type {
  AnnotationCampaign,
  AnnotationCampaignInstructions,
  AnnotationToolIntegration,
} from '@oci/database';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from './campaign.repository.js';
import { InstructionsService } from './instructions.service.js';

const SUB = 'cognito-sub-1';

function user(sub: string): CognitoAccessTokenPayload {
  return { sub } as unknown as CognitoAccessTokenPayload;
}

const TOOL = {
  id: 'tool-monai',
  slug: 'monai-label',
  name: 'MONAI Label',
} as unknown as AnnotationToolIntegration;

function campaign(
  currentInstructionsVersion: string | null,
): AnnotationCampaign & { toolIntegration: AnnotationToolIntegration } {
  return {
    id: 'cmp-1',
    slug: 'chest-xr-pilot',
    name: 'Chest XR Pilot',
    description: null,
    status: 'RUNNING',
    taskKind: 'CLASSIFICATION',
    datasetId: 'ds-1',
    toolIntegrationId: TOOL.id,
    outputLicense: 'CC_BY_4_0',
    workflowConfig: { nAnnotators: 3 },
    createdById: '00000000-0000-4000-8000-000000000001',
    currentInstructionsVersion,
    createdAt: new Date('2026-05-26T00:00:00Z'),
    updatedAt: new Date('2026-05-26T00:00:00Z'),
    startedAt: new Date('2026-05-26T00:00:00Z'),
    completedAt: null,
    toolIntegration: TOOL,
  } as unknown as AnnotationCampaign & { toolIntegration: AnnotationToolIntegration };
}

function instructionsRow(
  version: string,
  body: string,
  createdAt = new Date('2026-05-26T01:00:00Z'),
): AnnotationCampaignInstructions {
  return {
    id: `inst-${version}`,
    campaignId: 'cmp-1',
    version,
    markdownBody: body,
    mediaUrls: [],
    createdById: '00000000-0000-4000-8000-000000000001',
    createdAt,
  } as unknown as AnnotationCampaignInstructions;
}

interface RepoMock {
  findBySlug: ReturnType<typeof vi.fn>;
  listInstructionsHistory: ReturnType<typeof vi.fn>;
  publishInstructions: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: InstructionsService;

beforeEach(() => {
  repo = {
    findBySlug: vi.fn(),
    listInstructionsHistory: vi.fn(),
    publishInstructions: vi.fn(),
  };
  service = new InstructionsService(repo as unknown as CampaignRepository);
});

describe('InstructionsService.fetch', () => {
  it('returns null current when the campaign has no published version', async () => {
    repo.findBySlug.mockResolvedValue(campaign(null));
    repo.listInstructionsHistory.mockResolvedValue([]);
    const out = await service.fetch('chest-xr-pilot');
    expect(out.current).toBeNull();
    expect(out.history).toEqual([]);
  });

  it('surfaces the published row as current + flags it in history', async () => {
    const row = instructionsRow('abc123', '# Hello');
    repo.findBySlug.mockResolvedValue(campaign('abc123'));
    repo.listInstructionsHistory.mockResolvedValue([row]);
    const out = await service.fetch('chest-xr-pilot');
    expect(out.current).not.toBeNull();
    expect(out.current!.version).toBe('abc123');
    expect(out.history).toHaveLength(1);
    expect(out.history[0]!.isCurrent).toBe(true);
  });

  it('throws 404 when the campaign does not exist', async () => {
    repo.findBySlug.mockResolvedValue(null);
    await expect(service.fetch('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('InstructionsService.publish', () => {
  it('hashes the markdown body into a 16-char hex version slug', async () => {
    repo.findBySlug.mockResolvedValue(campaign(null));
    repo.publishInstructions.mockImplementation(async (args: { version: string }) => ({
      row: instructionsRow(args.version, '# Hello'),
      created: true,
    }));

    const out = await service.publish(
      'chest-xr-pilot',
      { markdownBody: '# Hello', mediaUrls: [] },
      user(SUB),
    );

    expect(out.created).toBe(true);
    expect(out.instructions.version).toMatch(/^[0-9a-f]{16}$/);
    expect(out.instructions.version.length).toBe(16);
    // sha256('# Hello') = 5dcaf5...
    expect(out.instructions.version).toBe('01c8de44e04d2f7a');
  });

  it('returns created=false on idempotent re-publish of identical content', async () => {
    repo.findBySlug.mockResolvedValue(campaign('01c8de44e04d2f7a'));
    repo.publishInstructions.mockResolvedValue({
      row: instructionsRow('01c8de44e04d2f7a', '# Hello'),
      created: false,
    });
    const out = await service.publish(
      'chest-xr-pilot',
      { markdownBody: '# Hello', mediaUrls: [] },
      user(SUB),
    );
    expect(out.created).toBe(false);
    expect(out.instructions.isCurrent).toBe(true);
  });

  it('throws 404 when the campaign does not exist', async () => {
    repo.findBySlug.mockResolvedValue(null);
    await expect(
      service.publish('missing', { markdownBody: 'x', mediaUrls: [] }, user(SUB)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

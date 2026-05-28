import { NotFoundException } from '@nestjs/common';
import type { AnnotationCampaign, AnnotationToolIntegration } from '@oci/database';
import type { CampaignVisibilityConfig } from '@oci/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignRepository } from './campaign.repository.js';
import { MetadataVisibilityService } from './metadata-visibility.service.js';

/** A representative chest-XR sample with one field from each bucket. */
const SAMPLE: Record<string, unknown> = {
  modality: 'CR', // required (default table)
  body_part: 'CHEST', // required
  age_bin: '60-69', // optional
  sex: 'F', // optional
  prior_diagnosis: 'diabetes', // hidden (priming risk)
  scanner_make: 'Acme', // hidden
  patient_name: 'Jane Roe', // never (PHI)
  mrn: '00112233', // never (PHI)
  custom_vendor_field: 'x', // unknown → hidden fallback
};

function campaignWith(
  visibilityConfig: unknown,
): AnnotationCampaign & { toolIntegration: AnnotationToolIntegration } {
  return {
    id: 'cmp-1',
    slug: 'chest-xr-pilot',
    name: 'Chest XR Pilot',
    description: null,
    status: 'RUNNING',
    taskKind: 'CLASSIFICATION',
    datasetId: 'ds-1',
    toolIntegrationId: 'tool-1',
    outputLicense: 'CC_BY_4_0',
    workflowConfig: { nAnnotators: 3 },
    visibilityConfig,
    currentInstructionsVersion: null,
    createdById: '00000000-0000-4000-8000-000000000001',
    createdAt: new Date('2026-05-28T00:00:00Z'),
    updatedAt: new Date('2026-05-28T00:00:00Z'),
    startedAt: new Date('2026-05-28T00:00:00Z'),
    completedAt: null,
    toolIntegration: { id: 'tool-1' } as unknown as AnnotationToolIntegration,
  } as unknown as AnnotationCampaign & { toolIntegration: AnnotationToolIntegration };
}

interface RepoMock {
  findBySlug: ReturnType<typeof vi.fn>;
}

let repo: RepoMock;
let service: MetadataVisibilityService;

beforeEach(() => {
  repo = { findBySlug: vi.fn() };
  service = new MetadataVisibilityService(repo as unknown as CampaignRepository);
});

describe('MetadataVisibilityService.compose — PHI never-floor', () => {
  it('never delivers `never` fields at any gate, even with a manager override trying to expose them', () => {
    const config: CampaignVisibilityConfig = {
      version: 'v1',
      // hostile config: manager marks PHI as required + promotes it everywhere
      fieldOverrides: {
        patient_name: {
          bucket: 'required',
          promotedAtGates: ['independent', 'arbitration', 'expert'],
        },
        mrn: { bucket: 'optional', promotedAtGates: ['independent', 'arbitration', 'expert'] },
      },
      trainingGrade: true,
    };
    for (const gate of ['INDEPENDENT', 'AWAITING_ARBITRATION', 'AWAITING_EXPERT']) {
      const { bundle, exposureProfile } = service.compose(config, SAMPLE, gate);
      expect(bundle.required).not.toHaveProperty('patient_name');
      expect(bundle.required).not.toHaveProperty('mrn');
      expect(bundle.optional).not.toHaveProperty('patient_name');
      expect(bundle.optional).not.toHaveProperty('mrn');
      expect(exposureProfile.deliveredFields).not.toContain('patient_name');
      expect(exposureProfile.deliveredFields).not.toContain('mrn');
    }
  });

  it('honours a Croissant `never` tag as a hard floor', () => {
    const { bundle } = service.compose(
      {
        version: 'v1',
        fieldOverrides: { age_bin: { bucket: 'required', promotedAtGates: [] } },
        trainingGrade: false,
      },
      { age_bin: '60-69' },
      'AWAITING_EXPERT',
      { age_bin: 'never' },
    );
    expect(bundle.required).not.toHaveProperty('age_bin');
    expect(bundle.optional).not.toHaveProperty('age_bin');
  });
});

describe('MetadataVisibilityService.compose — gate progression (default config)', () => {
  const DEFAULT = null; // no manager config → defaults + fallback-hidden

  it('gate 1 (INDEPENDENT) delivers required only', () => {
    const { bundle, exposureProfile } = service.compose(DEFAULT, SAMPLE, 'INDEPENDENT');
    expect(Object.keys(bundle.required).sort()).toEqual(['body_part', 'modality']);
    expect(bundle.optional).toEqual({});
    // hidden + never + unknown all excluded
    expect(exposureProfile.deliveredFields).toEqual(['body_part', 'modality']);
  });

  it('gate 2 (AWAITING_ARBITRATION) adds optional', () => {
    const { bundle } = service.compose(DEFAULT, SAMPLE, 'AWAITING_ARBITRATION');
    expect(Object.keys(bundle.required).sort()).toEqual(['body_part', 'modality']);
    expect(Object.keys(bundle.optional).sort()).toEqual(['age_bin', 'sex']);
    // hidden + never + unknown still excluded
    expect(bundle.optional).not.toHaveProperty('prior_diagnosis');
    expect(bundle.optional).not.toHaveProperty('scanner_make');
  });

  it('gate 3 (AWAITING_EXPERT) still hides `hidden` fields unless explicitly promoted', () => {
    const { bundle } = service.compose(DEFAULT, SAMPLE, 'AWAITING_EXPERT');
    expect(Object.keys(bundle.optional).sort()).toEqual(['age_bin', 'sex']);
    expect(bundle.optional).not.toHaveProperty('prior_diagnosis');
  });
});

describe('MetadataVisibilityService.compose — manager promotion', () => {
  it('shows a promoted `hidden` field at the expert gate only', () => {
    const config: CampaignVisibilityConfig = {
      version: 'v2',
      fieldOverrides: {
        prior_diagnosis: {
          bucket: 'hidden',
          rationale: 'expert needs history',
          promotedAtGates: ['expert'],
        },
      },
      trainingGrade: false,
    };
    expect(service.compose(config, SAMPLE, 'INDEPENDENT').bundle.optional).not.toHaveProperty(
      'prior_diagnosis',
    );
    expect(
      service.compose(config, SAMPLE, 'AWAITING_ARBITRATION').bundle.optional,
    ).not.toHaveProperty('prior_diagnosis');
    expect(service.compose(config, SAMPLE, 'AWAITING_EXPERT').bundle.optional).toHaveProperty(
      'prior_diagnosis',
      'diabetes',
    );
  });

  it('training-grade campaigns may promote optional fields at gate 1', () => {
    const config: CampaignVisibilityConfig = {
      version: 'v3',
      fieldOverrides: {},
      trainingGrade: true,
    };
    const { bundle } = service.compose(config, SAMPLE, 'INDEPENDENT');
    expect(Object.keys(bundle.optional).sort()).toEqual(['age_bin', 'sex']);
  });
});

describe('MetadataVisibilityService.compose — exposure profile', () => {
  it('produces a deterministic, order-independent config hash', () => {
    const a: CampaignVisibilityConfig = {
      version: 'v1',
      fieldOverrides: {
        age_bin: { bucket: 'optional', promotedAtGates: [] },
        sex: { bucket: 'optional', promotedAtGates: [] },
      },
      trainingGrade: false,
    };
    const b: CampaignVisibilityConfig = {
      version: 'v1',
      // same content, keys inserted in the opposite order
      fieldOverrides: {
        sex: { bucket: 'optional', promotedAtGates: [] },
        age_bin: { bucket: 'optional', promotedAtGates: [] },
      },
      trainingGrade: false,
    };
    const ha = service.compose(a, SAMPLE, 'INDEPENDENT').exposureProfile.visibilityConfigHash;
    const hb = service.compose(b, SAMPLE, 'INDEPENDENT').exposureProfile.visibilityConfigHash;
    expect(ha).toBe(hb);
    expect(ha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives a hash-based version for the default (unconfigured) config', () => {
    const { exposureProfile } = service.compose(null, SAMPLE, 'INDEPENDENT');
    expect(exposureProfile.visibilityConfigVersion).toMatch(/^default-[0-9a-f]{16}$/);
    expect(exposureProfile.deliveredFields).toEqual(['body_part', 'modality']);
  });
});

describe('MetadataVisibilityService.previewForCampaign / resolvedFields', () => {
  it('previewForCampaign filters using the campaign config', async () => {
    repo.findBySlug.mockResolvedValue(campaignWith(null));
    const out = await service.previewForCampaign('chest-xr-pilot', SAMPLE, 'INDEPENDENT');
    expect(out.bundle.required).toHaveProperty('modality', 'CR');
    expect(out.bundle.required).not.toHaveProperty('patient_name');
  });

  it('throws 404 when the campaign does not exist', async () => {
    repo.findBySlug.mockResolvedValue(null);
    await expect(
      service.previewForCampaign('missing', SAMPLE, 'INDEPENDENT'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolvedFields reports bucket + source + gate visibility', async () => {
    repo.findBySlug.mockResolvedValue(campaignWith(null));
    const out = await service.resolvedFields(
      'chest-xr-pilot',
      ['modality', 'prior_diagnosis', 'patient_name', 'custom_vendor_field'],
      'INDEPENDENT',
    );
    const byField = Object.fromEntries(out.map((r) => [r.field, r]));
    expect(byField.modality).toMatchObject({
      bucket: 'required',
      source: 'oci-default',
      visibleAtGate: true,
    });
    expect(byField.prior_diagnosis).toMatchObject({
      bucket: 'hidden',
      source: 'oci-default',
      visibleAtGate: false,
    });
    expect(byField.patient_name).toMatchObject({
      bucket: 'never',
      source: 'oci-default',
      visibleAtGate: false,
    });
    expect(byField.custom_vendor_field).toMatchObject({
      bucket: 'hidden',
      source: 'fallback-hidden',
      visibleAtGate: false,
    });
  });
});

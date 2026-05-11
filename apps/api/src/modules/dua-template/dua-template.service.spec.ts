import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { CatalogService } from '../catalog/catalog.service.js';
import { DuaTemplateService } from './dua-template.service.js';

interface CatalogMock {
  findOwnerBySlug: ReturnType<typeof vi.fn>;
}

let catalog: CatalogMock;
let service: DuaTemplateService;

function datasetRow(
  overrides: Partial<{
    duoTerms: string[];
    emailDomainAllowlist: string[];
    commercialUseTerms: string;
  }> = {},
) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    hostId: 'host-id',
    visibility: 'RESTRICTED' as const,
    accessTier: 'CONTROLLED',
    duoTerms: ['DUO:0000042'],
    emailDomainAllowlist: ['example.edu'],
    commercialUseTerms: 'CASE_BY_CASE',
    commercialClauses: null,
    ...overrides,
  };
}

beforeEach(() => {
  catalog = { findOwnerBySlug: vi.fn() };
  service = new DuaTemplateService(catalog as unknown as CatalogService);
});

describe('DuaTemplateService.preview', () => {
  it('404s when the dataset does not exist', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(null);
    await expect(
      service.preview({
        datasetSlug: 'missing',
        audience: 'RESEARCHER',
        intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('selects the researcher template for audience=RESEARCHER', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow());
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
    });
    expect(result.templateId).toBe('dua-researcher');
    expect(result.markdown).toContain('Data Use Agreement — Researcher');
    expect(result.markdown).not.toContain('Data Use Agreement — AI Builder');
  });

  it('selects the builder template for audience=BUILDER', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow());
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'BUILDER',
      intendedUse: 'Train and validate an AI/ML model for a commercial product deployment.',
    });
    expect(result.templateId).toBe('dua-builder');
    expect(result.markdown).toContain('Data Use Agreement — AI Builder');
    expect(result.markdown).toContain('Post-market monitoring');
  });

  it('omits the LMIC addendum when commercial terms are CASE_BY_CASE', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow({ commercialUseTerms: 'CASE_BY_CASE' }));
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
    });
    expect(result.lmicAddendumIncluded).toBe(false);
    expect(result.markdown).not.toContain('Addendum A — LMIC');
  });

  it('appends the LMIC addendum when commercial terms are NON_COMMERCIAL_ONLY', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(
      datasetRow({ commercialUseTerms: 'NON_COMMERCIAL_ONLY' }),
    );
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
    });
    expect(result.lmicAddendumIncluded).toBe(true);
    expect(result.markdown).toContain('Addendum A — LMIC Public-Sector Deployment');
  });

  it('forces the LMIC addendum when forceLmicAddendum=true (preview-only override)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow({ commercialUseTerms: 'CASE_BY_CASE' }));
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'BUILDER',
      intendedUse: 'Train and validate an AI/ML model for a commercial product deployment.',
      forceLmicAddendum: true,
    });
    expect(result.lmicAddendumIncluded).toBe(true);
    expect(result.markdown).toContain('Addendum A — LMIC');
  });

  it('substitutes the requester name + institution into the document', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow());
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
      requesterName: 'Alice Researcher',
      requesterInstitution: 'University of Geneva',
    });
    expect(result.markdown).toContain('Alice Researcher');
    expect(result.markdown).toContain('University of Geneva');
  });

  it('shows the requester intended-use verbatim', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow());
    const intent = 'Replicate the prior analysis on the RSNA pneumonia benchmark for a thesis.';
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: intent,
    });
    expect(result.markdown).toContain(intent);
  });

  it('renders multiple DUO terms with their decorated labels', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(
      datasetRow({ duoTerms: ['DUO:0000006', 'DUO:0000019'] }),
    );
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
    });
    expect(result.markdown).toContain('DUO:0000006');
    expect(result.markdown).toContain('health/medical/biomedical research');
    expect(result.markdown).toContain('DUO:0000019');
    expect(result.markdown).toContain('publication required');
  });

  it('falls back to "see dataset detail page" for unknown DUO codes', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow({ duoTerms: ['DUO:9999999'] }));
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'RESEARCHER',
      intendedUse: 'A 20-character-plus rationale for using the dataset in a research study.',
    });
    expect(result.markdown).toContain('DUO:9999999');
    expect(result.markdown).toContain('see dataset detail page');
  });

  it('renders builder-only clauses (regulatory pathway, deployment country)', async () => {
    catalog.findOwnerBySlug.mockResolvedValue(datasetRow());
    const result = await service.preview({
      datasetSlug: 'rsna-pneumonia',
      audience: 'BUILDER',
      intendedUse: 'Train and validate an AI/ML model for a commercial product deployment.',
      regulatoryPathway: 'CE marking — IIa medical device',
      deploymentCountry: 'CH',
    });
    expect(result.markdown).toContain('CE marking — IIa medical device');
    expect(result.markdown).toContain('CH');
  });
});

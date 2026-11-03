import { describe, expect, it } from 'vitest';
import type { PublicModelCard } from '@oci/shared-types';
import { modelCardJsonLd } from './model-jsonld';

const card: PublicModelCard = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'demo-chest-xray-triage',
  intendedUse: {
    v: 1,
    medicalPurpose: 'clinical-decision-support',
    bodySystemOrSite: 'Chest',
    foreseeableMisuse: 'Using the triage flag as a diagnosis.',
    contraindications: '',
    riskTier: 'III',
  },
  modelClass: 'foundation',
  architectureSummary: 'Vision transformer.',
  trainingDataLineage: {},
  parentModelCardId: null,
  versionMajorMinorPatch: '2.0.1',
  changeJustification: null,
  materialChange: false,
  trainingDataJurisdictions: ['US'],
  generativeAi: false,
  lmmSpecificLimitations: null,
  status: 'PUBLISHED',
  modelDeveloper: 'Demo Imaging Inc.',
  developerContact: 'safety@imaging.example',
  clinicalSummary: 'Flags suspected pneumothorax for priority reading.',
  regulatoryApproval: null,
  knownBiasesOrEthicalConsiderations: null,
  biasMitigationApproaches: null,
  ongoingMaintenance: null,
  securityPosture: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('modelCardJsonLd (#591)', () => {
  it('emits a SoftwareApplication keyed to the canonical page URL', () => {
    const ld = modelCardJsonLd(card, 'https://oci.ai4h.net');

    expect(ld).toMatchObject({
      '@context': 'https://schema.org/',
      '@type': 'SoftwareApplication',
      '@id': 'https://oci.ai4h.net/models/demo-chest-xray-triage',
      url: 'https://oci.ai4h.net/models/demo-chest-xray-triage',
      applicationCategory: 'HealthApplication',
      softwareVersion: '2.0.1',
      description: 'Flags suspected pneumothorax for priority reading.',
      author: { '@type': 'Organization', name: 'Demo Imaging Inc.' },
    });
    expect(ld.keywords).toEqual(['Foundation model', 'Clinical decision support', 'Chest']);
  });

  it('falls back to the architecture summary and omits a missing developer', () => {
    const ld = modelCardJsonLd(
      { ...card, clinicalSummary: null, modelDeveloper: null },
      'https://oci.ai4h.net',
    );

    expect(ld.description).toBe('Vision transformer.');
    expect(ld).not.toHaveProperty('author');
  });

  it('never carries the developer contact', () => {
    expect(JSON.stringify(modelCardJsonLd(card, 'https://oci.ai4h.net'))).not.toContain(
      'safety@imaging.example',
    );
  });
});

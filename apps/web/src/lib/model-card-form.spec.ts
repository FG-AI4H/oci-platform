import { describe, expect, it } from 'vitest';
import {
  CreateModelCardRequestSchema,
  UpdateModelCardRequestSchema,
  type ModelCardResponse,
} from '@oci/shared-types';
import {
  editBodyFrom,
  emptyModelCardFormValues,
  fieldErrorsFromIssues,
  firstStepWithError,
  formValuesFromCard,
  modelCardRequestFromValues,
  readModelCardForm,
  riskTierFromValues,
  type ModelCardFormValues,
} from './model-card-form';

function filled(over: Partial<ModelCardFormValues> = {}): ModelCardFormValues {
  return {
    ...emptyModelCardFormValues(),
    slug: 'chest-xr-triage',
    version: '1.2.0',
    modelClass: 'classical',
    modelDeveloper: 'Example Imaging Lab',
    developerContact: 'models@example.org',
    clinicalSummary: 'Flags chest radiographs with a likely pneumothorax.',
    architectureSummary: 'Convolutional network over frontal chest radiographs.',
    medicalPurpose: 'triage',
    intendedClinicalPathway: 'triage-before-clinician',
    operatingEnvironment: ['hospital-outpatient'],
    intendedUserRole: ['radiologist'],
    ageMin: '18',
    populationDescription: 'Adults referred for a chest radiograph.',
    foreseeableMisuse: 'Used on paediatric films.',
    contraindications: '',
    trainingDataSummary: 'Two public chest radiograph sets.',
    trainingDataJurisdictions: 'EU, CH',
    ...over,
  };
}

describe('readModelCardForm (#651)', () => {
  it('reads text, multi-valued and checkbox fields as typed', () => {
    const fd = new FormData();
    fd.set('slug', 'chest-xr-triage');
    fd.append('operatingEnvironment', 'emergency');
    fd.append('operatingEnvironment', 'hospital-inpatient');
    fd.set('generativeAi', 'on');
    fd.set('riskTier', 'I'); // not a field: ignored, the tier is never read from the form

    const values = readModelCardForm(fd);

    expect(values.slug).toBe('chest-xr-triage');
    expect(values.operatingEnvironment).toEqual(['emergency', 'hospital-inpatient']);
    expect(values.generativeAi).toBe(true);
    expect(values.foreseeableMisuse).toBe('');
    expect(values).not.toHaveProperty('riskTier');
  });
});

describe('the risk tier (#651)', () => {
  it('is derived from the answers, with the reason', () => {
    expect(riskTierFromValues(filled())).toEqual({ tier: 'II', reason: 'triage-screening' });
    expect(riskTierFromValues(filled({ operatingEnvironment: ['emergency'] }))).toEqual({
      tier: 'III',
      reason: 'triage-screening-emergency',
    });
  });

  it('is unknown until a clinical task is chosen', () => {
    expect(riskTierFromValues(filled({ medicalPurpose: '' }))).toBeNull();
  });

  it('goes into the request derived, whatever else was submitted', () => {
    const request = modelCardRequestFromValues(
      filled({ medicalPurpose: 'diagnosis', intendedClinicalPathway: 'standalone' }),
    );
    expect(request.intendedUse).toMatchObject({ medicalPurpose: 'diagnosis', riskTier: 'IV' });
  });
});

describe('modelCardRequestFromValues (#651)', () => {
  it('builds a request the API schema accepts', () => {
    const parsed = CreateModelCardRequestSchema.parse(modelCardRequestFromValues(filled()));

    expect(parsed).toMatchObject({
      slug: 'chest-xr-triage',
      versionMajorMinorPatch: '1.2.0',
      trainingDataJurisdictions: ['EU', 'CH'],
      trainingDataLineage: { summary: 'Two public chest radiograph sets.' },
      regulatoryApproval: null,
      intendedUse: {
        v: 1,
        medicalPurpose: 'triage',
        riskTier: 'II',
        targetPopulation: {
          ageRangeYears: { min: 18 },
          populationDescription: 'Adults referred for a chest radiograph.',
        },
        contraindications: '',
      },
    });
    expect(parsed.intendedUse).not.toHaveProperty('medicalPurposeOther');
  });

  it('declares a regulatory approval only when a pathway is chosen', () => {
    const request = modelCardRequestFromValues(
      filled({
        regulatoryPathway: 'EU_MDR_CLASS_IIA',
        regulatoryStatus: 'granted',
        regulatoryJurisdictions: 'EU',
        regulatoryIdentifier: 'CE 0123',
      }),
    );
    expect(request.regulatoryApproval).toEqual({
      pathway: 'EU_MDR_CLASS_IIA',
      status: 'granted',
      jurisdictions: ['EU'],
      identifier: 'CE 0123',
    });
  });

  it('keeps lineage entries the form does not own', () => {
    const request = modelCardRequestFromValues(filled({ trainingDataSummary: '' }), {
      summary: 'old',
      datasetRefs: ['oci:chest-xr@1.0.0'],
    });
    expect(request.trainingDataLineage).toEqual({ datasetRefs: ['oci:chest-xr@1.0.0'] });
  });
});

describe('errors back to fields (#651)', () => {
  it('maps the API schema’s issues to the form’s fields and steps', () => {
    const result = CreateModelCardRequestSchema.safeParse(
      modelCardRequestFromValues(
        filled({
          version: '1.0',
          medicalPurpose: 'other',
          medicalPurposeOther: '',
          foreseeableMisuse: '',
        }),
      ),
    );
    expect(result.success).toBe(false);
    if (result.success) return;

    const { fieldErrors, other } = fieldErrorsFromIssues(result.error.issues);

    expect([...fieldErrors.keys()].sort()).toEqual([
      'foreseeableMisuse',
      'medicalPurposeOther',
      'version',
    ]);
    expect(other).toEqual([]);
    expect(firstStepWithError(fieldErrors.keys())).toBe('model');
    expect(firstStepWithError(['foreseeableMisuse'])).toBe('intendedUse');
    expect(firstStepWithError([])).toBeNull();
  });

  it('puts a missing clinical task on the clinical-task field', () => {
    const result = CreateModelCardRequestSchema.safeParse(
      modelCardRequestFromValues(filled({ medicalPurpose: '' })),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(fieldErrorsFromIssues(result.error.issues).fieldErrors.has('medicalPurpose')).toBe(true);
  });
});

describe('editing (#651)', () => {
  it('round-trips a saved card through the form and sends only what the form owns', () => {
    const parsed = CreateModelCardRequestSchema.parse(modelCardRequestFromValues(filled()));
    const card = {
      ...parsed,
      id: '11111111-1111-4111-8111-111111111111',
      submitterUserId: null,
      parentModelCardId: null,
      changeJustification: 'reviewer note',
      materialChange: true,
      lmmSpecificLimitations: null,
      status: 'DRAFT',
      clinicalSummary: parsed.clinicalSummary ?? null,
      regulatoryApproval: null,
      knownBiasesOrEthicalConsiderations: null,
      biasMitigationApproaches: null,
      ongoingMaintenance: null,
      securityPosture: 'internal',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
    } as ModelCardResponse;

    const values = formValuesFromCard(card);
    expect(values).toMatchObject({
      slug: 'chest-xr-triage',
      ageMin: '18',
      medicalPurpose: 'triage',
    });

    const reparsed = CreateModelCardRequestSchema.parse(
      modelCardRequestFromValues(values, card.trainingDataLineage),
    );
    const body = UpdateModelCardRequestSchema.parse(editBodyFrom(reparsed));
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('materialChange');
    expect(body).not.toHaveProperty('securityPosture');
    expect(body.intendedUse).toEqual(card.intendedUse);
  });
});

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
  unknownDatasetRows,
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

describe('dataset rows (#820)', () => {
  function rows(...list: Array<[role: string, target: string, name: string, note: string]>) {
    const fd = new FormData();
    for (const [role, target, name, note] of list) {
      fd.append('datasetRefRole', role);
      fd.append('datasetRefTarget', target);
      fd.append('datasetRefName', name);
      fd.append('datasetRefNote', note);
    }
    return fd;
  }

  it('reads the rows in order and drops one left empty', () => {
    const values = readModelCardForm(
      rows(
        ['TRAINING', 'idrid-grading', '', 'Training split'],
        ['TUNING', '', '', ''],
        ['EVALUATION', 'https://doi.org/10.5555/example', 'Messidor-2', ''],
      ),
    );

    expect(values.datasetRefs).toEqual([
      { role: 'TRAINING', target: 'idrid-grading', name: '', note: 'Training split' },
      {
        role: 'EVALUATION',
        target: 'https://doi.org/10.5555/example',
        name: 'Messidor-2',
        note: '',
      },
    ]);
  });

  it('sends an identifier as a catalogue dataset and a web address as an external one', () => {
    const request = modelCardRequestFromValues(
      filled({
        datasetRefs: [
          {
            role: 'TRAINING',
            target: ' idrid-grading ',
            name: 'ignored',
            note: ' Training split ',
          },
          {
            role: 'EVALUATION',
            target: 'HTTPS://doi.org/10.5555/x',
            name: ' Messidor-2 ',
            note: '',
          },
        ],
      }),
    );

    expect(request.datasetRefs).toEqual([
      { role: 'TRAINING', datasetSlug: 'idrid-grading', note: 'Training split' },
      { role: 'EVALUATION', externalUrl: 'HTTPS://doi.org/10.5555/x', externalName: 'Messidor-2' },
    ]);
    expect(CreateModelCardRequestSchema.safeParse(request).success).toBe(true);
  });

  it('puts a refused row on its own line and opens the evidence step', () => {
    const result = CreateModelCardRequestSchema.safeParse(
      modelCardRequestFromValues(
        filled({
          datasetRefs: [
            { role: 'TRAINING', target: 'idrid-grading', name: '', note: '' },
            { role: 'EVALUATION', target: 'https://example.org/set', name: '', note: '' },
            { role: 'TUNING', target: '', name: '', note: 'a note with no dataset' },
          ],
        }),
      ),
    );
    if (result.success) throw new Error('expected the rows to be refused');

    const { fieldErrors, datasetRefErrors } = fieldErrorsFromIssues(result.error.issues);

    expect([...datasetRefErrors.keys()]).toEqual([1, 2]);
    expect(fieldErrors.has('datasetRefs')).toBe(true);
    expect(firstStepWithError(fieldErrors.keys())).toBe('evidence');
  });

  it('finds the rows the API refused as unknown datasets', () => {
    const values = filled({
      datasetRefs: [
        { role: 'TRAINING', target: 'idrid-grading', name: '', note: '' },
        { role: 'TUNING', target: 'hospital-private-ct', name: '', note: '' },
        { role: 'EVALUATION', target: 'hospital-private-ct', name: '', note: '' },
      ],
    });

    expect(unknownDatasetRows(values, { unknownDatasets: ['hospital-private-ct'] })).toEqual([
      1, 2,
    ]);
    expect(unknownDatasetRows(values, { message: 'something else' })).toEqual([]);
    expect(unknownDatasetRows(values, null)).toEqual([]);
  });

  it('shows a saved card’s datasets as rows and sends them back on an edit', () => {
    const card = {
      ...CreateModelCardRequestSchema.parse(modelCardRequestFromValues(filled())),
      trainingDataLineage: {},
      datasetRefs: [
        {
          role: 'TRAINING',
          kind: 'CATALOGUE',
          datasetSlug: 'idrid-grading',
          externalUrl: null,
          externalName: null,
          note: 'Training split',
          manifestVersion: '1.0.0',
          manifestSha256: null,
          dataset: null,
        },
        {
          role: 'EVALUATION',
          kind: 'EXTERNAL',
          datasetSlug: null,
          externalUrl: 'https://doi.org/10.5555/example',
          externalName: 'Messidor-2',
          note: null,
          manifestVersion: null,
          manifestSha256: null,
          dataset: null,
        },
      ],
      evaluatedOn: [],
    } as unknown as ModelCardResponse;

    const values = formValuesFromCard(card);
    expect(values.datasetRefs).toEqual([
      { role: 'TRAINING', target: 'idrid-grading', name: '', note: 'Training split' },
      {
        role: 'EVALUATION',
        target: 'https://doi.org/10.5555/example',
        name: 'Messidor-2',
        note: '',
      },
    ]);

    const body = UpdateModelCardRequestSchema.parse(
      editBodyFrom(CreateModelCardRequestSchema.parse(modelCardRequestFromValues(values))),
    );
    expect(body.datasetRefs).toEqual([
      { role: 'TRAINING', datasetSlug: 'idrid-grading', note: 'Training split' },
      {
        role: 'EVALUATION',
        externalUrl: 'https://doi.org/10.5555/example',
        externalName: 'Messidor-2',
      },
    ]);
  });
});

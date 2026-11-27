import {
  ClinicalPathwaySchema,
  MedicalPurposeSchema,
  OperatingEnvironmentSchema,
  explainRiskTier,
  type ModelCardResponse,
  type OperatingEnvironment,
  type RiskTier,
  type RiskTierReason,
} from '@oci/shared-types';

/**
 * The model-card form (#651): what the browser sends, how it becomes the
 * API's `CreateModelCardRequest`, and how the API schema's complaints find
 * their way back to the field that caused them.
 *
 * Validation is NOT here: the server actions parse the request this module
 * builds with `CreateModelCardRequestSchema` from `@oci/shared-types`, the
 * schema the API's pipe uses. Neither is the risk tier: it comes from
 * `explainRiskTier` in `@oci/shared-types`, the derivation the API checks
 * against. The form never asks the user for a tier.
 *
 * Pure, no I/O: runs in the server actions and in the browser (the review
 * step and the live tier read the form through it).
 */

/** The form's steps, in order. A sandbox step (#586) slots in before `review`. */
export const MODEL_CARD_FORM_STEPS = [
  'model',
  'intendedUse',
  'riskTier',
  'evidence',
  'review',
] as const;
export type ModelCardFormStep = (typeof MODEL_CARD_FORM_STEPS)[number];

/** Every field, as the form names it, with the step it sits on. */
export const MODEL_CARD_FORM_FIELDS = {
  slug: 'model',
  version: 'model',
  modelClass: 'model',
  modelDeveloper: 'model',
  developerContact: 'model',
  clinicalSummary: 'model',
  architectureSummary: 'model',
  generativeAi: 'model',
  medicalPurpose: 'intendedUse',
  medicalPurposeOther: 'intendedUse',
  bodySystemOrSite: 'intendedUse',
  ageMin: 'intendedUse',
  ageMax: 'intendedUse',
  sexEligibility: 'intendedUse',
  populationDescription: 'intendedUse',
  intendedUserRole: 'intendedUse',
  operatingEnvironment: 'intendedUse',
  intendedClinicalPathway: 'intendedUse',
  operatingPrinciple: 'intendedUse',
  foreseeableMisuse: 'intendedUse',
  contraindications: 'intendedUse',
  trainingDataSummary: 'evidence',
  trainingDataJurisdictions: 'evidence',
  regulatoryPathway: 'evidence',
  regulatoryStatus: 'evidence',
  regulatoryJurisdictions: 'evidence',
  regulatoryIdentifier: 'evidence',
  datasetRefs: 'evidence',
  knownBiases: 'evidence',
  biasMitigation: 'evidence',
  ongoingMaintenance: 'evidence',
} as const satisfies Record<string, ModelCardFormStep>;
export type ModelCardFormField = keyof typeof MODEL_CARD_FORM_FIELDS;

const MULTI_FIELDS = ['intendedUserRole', 'operatingEnvironment'] as const;
type MultiField = (typeof MULTI_FIELDS)[number];
type TextField = Exclude<ModelCardFormField, MultiField | 'generativeAi' | 'datasetRefs'>;

/**
 * One dataset row of the form (#820). `target` is what the user typed in the
 * single "dataset" box: the identifier of a dataset of the catalogue, or a web
 * address for one held elsewhere, in which case `name` says what to call it.
 */
export interface DatasetRefFormRow {
  role: string;
  target: string;
  name: string;
  note: string;
}

/** The four inputs of a dataset row; each name repeats once per row, in order. */
export const DATASET_REF_INPUTS = {
  role: 'datasetRefRole',
  target: 'datasetRefTarget',
  name: 'datasetRefName',
  note: 'datasetRefNote',
} as const;

/** What the user typed, as typed: echoed back into the form after an error. */
export type ModelCardFormValues = Record<TextField, string> &
  Record<MultiField, string[]> & { generativeAi: boolean; datasetRefs: DatasetRefFormRow[] };

/** A web address, as opposed to a catalogue identifier. */
export function isWebAddress(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

/**
 * The dataset rows of a submitted form. The four inputs repeat once per row;
 * a row the user left empty (the role select always has a value) is dropped,
 * so the rows kept are, in order, the entries of the request's `datasetRefs`.
 */
function readDatasetRefRows(formData: FormData): DatasetRefFormRow[] {
  const column = (name: string) =>
    formData.getAll(name).map((v) => (typeof v === 'string' ? v : ''));
  const roles = column(DATASET_REF_INPUTS.role);
  const targets = column(DATASET_REF_INPUTS.target);
  const names = column(DATASET_REF_INPUTS.name);
  const notes = column(DATASET_REF_INPUTS.note);
  return roles
    .map((role, i) => ({
      role,
      target: targets.at(i) ?? '',
      name: names.at(i) ?? '',
      note: notes.at(i) ?? '',
    }))
    .filter((row) => [row.target, row.name, row.note].some((v) => v.trim().length > 0));
}

/** A form row as an entry of the request's `datasetRefs`. Not validated. */
function datasetRefFromRow(row: DatasetRefFormRow): Record<string, unknown> {
  const target = row.target.trim();
  const note = row.note.trim();
  const base = { role: row.role, ...(note.length > 0 ? { note } : {}) };
  if (target.length === 0) return base;
  if (!isWebAddress(target)) return { ...base, datasetSlug: target };
  const name = row.name.trim();
  return { ...base, externalUrl: target, ...(name.length > 0 ? { externalName: name } : {}) };
}

function isMultiField(field: string): field is MultiField {
  return (MULTI_FIELDS as readonly string[]).includes(field);
}

/** Every field, read through `read`; built with `fromEntries`, no dynamic writes. */
function valuesFrom(
  read: (field: ModelCardFormField) => string | string[] | boolean | DatasetRefFormRow[],
): ModelCardFormValues {
  const fields = Object.keys(MODEL_CARD_FORM_FIELDS) as ModelCardFormField[];
  return Object.fromEntries(fields.map((f) => [f, read(f)])) as ModelCardFormValues;
}

export function emptyModelCardFormValues(): ModelCardFormValues {
  return valuesFrom((field) => {
    if (field === 'generativeAi') return false;
    if (field === 'datasetRefs') return [];
    if (isMultiField(field)) return [];
    if (field === 'version') return '1.0.0';
    if (field === 'regulatoryStatus') return 'none';
    return '';
  });
}

/** Read the submitted form. Unknown entries are ignored; text is kept as typed. */
export function readModelCardForm(formData: FormData): ModelCardFormValues {
  return valuesFrom((field) => {
    if (field === 'generativeAi') return formData.get('generativeAi') === 'on';
    if (field === 'datasetRefs') return readDatasetRefRows(formData);
    if (isMultiField(field)) return formData.getAll(field).map(String);
    const raw = formData.get(field);
    return typeof raw === 'string' ? raw : '';
  });
}

/** The answers the risk tier is derived from, or `null` before a purpose is chosen. */
export function riskTierFromValues(
  values: Pick<
    ModelCardFormValues,
    'medicalPurpose' | 'intendedClinicalPathway' | 'operatingEnvironment'
  >,
): { tier: RiskTier; reason: RiskTierReason } | null {
  const purpose = MedicalPurposeSchema.safeParse(values.medicalPurpose);
  if (!purpose.success) return null;
  const pathway = ClinicalPathwaySchema.safeParse(values.intendedClinicalPathway);
  const environments = values.operatingEnvironment.filter(
    (e): e is OperatingEnvironment => OperatingEnvironmentSchema.safeParse(e).success,
  );
  return explainRiskTier({
    medicalPurpose: purpose.data,
    intendedClinicalPathway: pathway.success ? pathway.data : undefined,
    operatingEnvironment: environments,
  });
}

const blankToUndefined = (s: string): string | undefined => {
  const t = s.trim();
  return t.length > 0 ? t : undefined;
};
const blankToNull = (s: string): string | null => blankToUndefined(s) ?? null;
const codeList = (s: string): string[] =>
  s
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
const age = (s: string): number | undefined => {
  const t = s.trim();
  return t.length > 0 ? Number(t) : undefined;
};

/**
 * The create request the form describes. Not validated: the caller parses it
 * with `CreateModelCardRequestSchema`. `riskTier` is derived here from the
 * answers, never read from the form.
 *
 * `existingLineage` is the card's current `trainingDataLineage` when editing:
 * the form owns its `summary` entry only, other entries (set through the API)
 * are kept.
 */
export function modelCardRequestFromValues(
  values: ModelCardFormValues,
  existingLineage: Record<string, unknown> = {},
): Record<string, unknown> {
  const tier = riskTierFromValues(values);
  const ageMin = age(values.ageMin);
  const ageMax = age(values.ageMax);
  const sex = blankToUndefined(values.sexEligibility);
  const populationDescription = blankToUndefined(values.populationDescription);
  const targetPopulation =
    ageMin !== undefined ||
    ageMax !== undefined ||
    sex !== undefined ||
    populationDescription !== undefined
      ? {
          ...(ageMin !== undefined || ageMax !== undefined
            ? {
                ageRangeYears: {
                  ...(ageMin !== undefined ? { min: ageMin } : {}),
                  ...(ageMax !== undefined ? { max: ageMax } : {}),
                },
              }
            : {}),
          ...(sex !== undefined ? { sexEligibility: sex } : {}),
          ...(populationDescription !== undefined ? { populationDescription } : {}),
        }
      : undefined;

  const intendedUse: Record<string, unknown> = {
    v: 1,
    medicalPurpose: values.medicalPurpose,
    foreseeableMisuse: values.foreseeableMisuse.trim(),
    contraindications: values.contraindications.trim(),
  };
  if (tier) intendedUse.riskTier = tier.tier;
  const optional: Array<[string, unknown]> = [
    [
      'medicalPurposeOther',
      values.medicalPurpose === 'other' ? blankToUndefined(values.medicalPurposeOther) : undefined,
    ],
    ['bodySystemOrSite', blankToUndefined(values.bodySystemOrSite)],
    ['targetPopulation', targetPopulation],
    ['intendedUserRole', values.intendedUserRole.length > 0 ? values.intendedUserRole : undefined],
    [
      'operatingEnvironment',
      values.operatingEnvironment.length > 0 ? values.operatingEnvironment : undefined,
    ],
    ['intendedClinicalPathway', blankToUndefined(values.intendedClinicalPathway)],
    ['operatingPrinciple', blankToUndefined(values.operatingPrinciple)],
  ];
  Object.assign(intendedUse, Object.fromEntries(optional.filter(([, v]) => v !== undefined)));

  const { summary: _previousSummary, ...otherLineage } = existingLineage;
  const summary = blankToUndefined(values.trainingDataSummary);
  const trainingDataLineage = summary ? { ...otherLineage, summary } : otherLineage;

  const pathway = blankToUndefined(values.regulatoryPathway);
  const regulatoryApproval = pathway
    ? {
        pathway,
        status: blankToUndefined(values.regulatoryStatus) ?? 'none',
        jurisdictions: codeList(values.regulatoryJurisdictions),
        identifier: blankToNull(values.regulatoryIdentifier),
      }
    : null;

  return {
    slug: values.slug.trim(),
    versionMajorMinorPatch: values.version.trim(),
    modelClass: values.modelClass,
    modelDeveloper: values.modelDeveloper.trim(),
    developerContact: values.developerContact.trim(),
    clinicalSummary: blankToNull(values.clinicalSummary),
    architectureSummary: values.architectureSummary.trim(),
    generativeAi: values.generativeAi,
    intendedUse,
    trainingDataLineage,
    trainingDataJurisdictions: codeList(values.trainingDataJurisdictions),
    datasetRefs: values.datasetRefs.map(datasetRefFromRow),
    regulatoryApproval,
    knownBiasesOrEthicalConsiderations: blankToNull(values.knownBiases),
    biasMitigationApproaches: blankToNull(values.biasMitigation),
    ongoingMaintenance: blankToNull(values.ongoingMaintenance),
  };
}

/**
 * The fields of the request the form owns: an edit sends these and nothing
 * else, so what the form does not show (material change, security posture,
 * LMM limitations…) keeps the value it has.
 */
export const FORM_OWNED_REQUEST_KEYS = [
  'versionMajorMinorPatch',
  'modelClass',
  'modelDeveloper',
  'developerContact',
  'clinicalSummary',
  'architectureSummary',
  'generativeAi',
  'intendedUse',
  'trainingDataLineage',
  'trainingDataJurisdictions',
  'datasetRefs',
  'regulatoryApproval',
  'knownBiasesOrEthicalConsiderations',
  'biasMitigationApproaches',
  'ongoingMaintenance',
] as const;

/** Keep only the keys the form owns: the body of an edit. */
export function editBodyFrom(parsed: Record<string, unknown>): Record<string, unknown> {
  const owned = new Set<string>(FORM_OWNED_REQUEST_KEYS);
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => owned.has(k)));
}

const PATH_TO_FIELD: ReadonlyArray<[string, ModelCardFormField]> = [
  ['slug', 'slug'],
  ['versionMajorMinorPatch', 'version'],
  ['modelClass', 'modelClass'],
  ['modelDeveloper', 'modelDeveloper'],
  ['developerContact', 'developerContact'],
  ['clinicalSummary', 'clinicalSummary'],
  ['architectureSummary', 'architectureSummary'],
  ['generativeAi', 'generativeAi'],
  ['intendedUse.medicalPurposeOther', 'medicalPurposeOther'],
  ['intendedUse.medicalPurpose', 'medicalPurpose'],
  // No tier means no valid purpose: the purpose field carries the message.
  ['intendedUse.riskTier', 'medicalPurpose'],
  ['intendedUse.bodySystemOrSite', 'bodySystemOrSite'],
  ['intendedUse.targetPopulation.ageRangeYears.min', 'ageMin'],
  ['intendedUse.targetPopulation.ageRangeYears.max', 'ageMax'],
  ['intendedUse.targetPopulation.sexEligibility', 'sexEligibility'],
  ['intendedUse.targetPopulation.populationDescription', 'populationDescription'],
  ['intendedUse.intendedUserRole', 'intendedUserRole'],
  ['intendedUse.operatingEnvironment', 'operatingEnvironment'],
  ['intendedUse.intendedClinicalPathway', 'intendedClinicalPathway'],
  ['intendedUse.operatingPrinciple', 'operatingPrinciple'],
  ['intendedUse.foreseeableMisuse', 'foreseeableMisuse'],
  ['intendedUse.contraindications', 'contraindications'],
  ['trainingDataLineage', 'trainingDataSummary'],
  ['trainingDataJurisdictions', 'trainingDataJurisdictions'],
  ['datasetRefs', 'datasetRefs'],
  ['regulatoryApproval.pathway', 'regulatoryPathway'],
  ['regulatoryApproval.status', 'regulatoryStatus'],
  ['regulatoryApproval.jurisdictions', 'regulatoryJurisdictions'],
  ['regulatoryApproval.identifier', 'regulatoryIdentifier'],
  ['knownBiasesOrEthicalConsiderations', 'knownBiases'],
  ['biasMitigationApproaches', 'biasMitigation'],
  ['ongoingMaintenance', 'ongoingMaintenance'],
];

/** The form field a schema issue belongs to, or `null` for one no field owns. */
export function fieldForIssuePath(path: ReadonlyArray<PropertyKey>): ModelCardFormField | null {
  const dotted = path.map(String).join('.');
  for (const [prefix, field] of PATH_TO_FIELD) {
    if (dotted === prefix || dotted.startsWith(prefix + '.')) return field;
  }
  return null;
}

/**
 * Field-level messages from a failed parse: the first message per field. A
 * message no field owns is returned in `other`, so it is not lost.
 *
 * A message about one dataset row (`datasetRefs.<n>…`) is also returned in
 * `datasetRefErrors`, by row, so the form can show it under that row (#820).
 */
export function fieldErrorsFromIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): {
  fieldErrors: Map<ModelCardFormField, string>;
  datasetRefErrors: Map<number, string>;
  other: string[];
} {
  const fieldErrors = new Map<ModelCardFormField, string>();
  const datasetRefErrors = new Map<number, string>();
  const other: string[] = [];
  for (const issue of issues) {
    const field = fieldForIssuePath(issue.path);
    if (field === null) other.push(issue.message);
    else if (!fieldErrors.has(field)) fieldErrors.set(field, issue.message);
    const row = issue.path[1];
    if (field === 'datasetRefs' && typeof row === 'number' && !datasetRefErrors.has(row)) {
      datasetRefErrors.set(row, issue.message);
    }
  }
  return { fieldErrors, datasetRefErrors, other };
}

/**
 * The rows that name a dataset the API refused (#820): not in the catalogue,
 * or not visible to the submitter. `body` is the API's 400 answer, which lists
 * the identifiers under `unknownDatasets`; anything else gives no row.
 */
export function unknownDatasetRows(
  values: Pick<ModelCardFormValues, 'datasetRefs'>,
  body: unknown,
): number[] {
  const listed =
    body !== null && typeof body === 'object'
      ? (body as { unknownDatasets?: unknown }).unknownDatasets
      : undefined;
  if (!Array.isArray(listed)) return [];
  const unknown = new Set(listed.filter((s): s is string => typeof s === 'string'));
  return values.datasetRefs.flatMap((row, index) =>
    unknown.has(row.target.trim()) ? [index] : [],
  );
}

const STEP_OF_FIELD = new Map<string, ModelCardFormStep>(Object.entries(MODEL_CARD_FORM_FIELDS));

/** The first step holding one of these fields, for the form to open on. */
export function firstStepWithError(fields: Iterable<ModelCardFormField>): ModelCardFormStep | null {
  let first: number | null = null;
  for (const field of fields) {
    const step = STEP_OF_FIELD.get(field);
    const index = step ? MODEL_CARD_FORM_STEPS.indexOf(step) : -1;
    if (index >= 0 && (first === null || index < first)) first = index;
  }
  return first === null ? null : (MODEL_CARD_FORM_STEPS.at(first) ?? null);
}

/** A saved card, as the form shows it for editing. */
export function formValuesFromCard(card: ModelCardResponse): ModelCardFormValues {
  const ius = card.intendedUse;
  const population = ius.targetPopulation;
  const lineageSummary = card.trainingDataLineage.summary;
  const approval = card.regulatoryApproval;
  return {
    slug: card.slug,
    version: card.versionMajorMinorPatch,
    modelClass: card.modelClass,
    modelDeveloper: card.modelDeveloper ?? '',
    developerContact: card.developerContact ?? '',
    clinicalSummary: card.clinicalSummary ?? '',
    architectureSummary: card.architectureSummary,
    generativeAi: card.generativeAi,
    medicalPurpose: ius.medicalPurpose,
    medicalPurposeOther: ius.medicalPurposeOther ?? '',
    bodySystemOrSite: ius.bodySystemOrSite ?? '',
    ageMin: population?.ageRangeYears?.min?.toString() ?? '',
    ageMax: population?.ageRangeYears?.max?.toString() ?? '',
    sexEligibility: population?.sexEligibility ?? '',
    populationDescription: population?.populationDescription ?? '',
    intendedUserRole: [...(ius.intendedUserRole ?? [])],
    operatingEnvironment: [...(ius.operatingEnvironment ?? [])],
    intendedClinicalPathway: ius.intendedClinicalPathway ?? '',
    operatingPrinciple: ius.operatingPrinciple ?? '',
    foreseeableMisuse: ius.foreseeableMisuse,
    contraindications: ius.contraindications,
    trainingDataSummary: typeof lineageSummary === 'string' ? lineageSummary : '',
    trainingDataJurisdictions: card.trainingDataJurisdictions.join(', '),
    // The submitter gets every declared dataset back as typed (never WITHHELD).
    datasetRefs: card.datasetRefs.map((ref) => ({
      role: ref.role,
      target: ref.datasetSlug ?? ref.externalUrl ?? '',
      name: ref.externalName ?? '',
      note: ref.note ?? '',
    })),
    regulatoryPathway: approval?.pathway ?? '',
    regulatoryStatus: approval?.status ?? 'none',
    regulatoryJurisdictions: approval?.jurisdictions.join(', ') ?? '',
    regulatoryIdentifier: approval?.identifier ?? '',
    knownBiases: card.knownBiasesOrEthicalConsiderations ?? '',
    biasMitigation: card.biasMitigationApproaches ?? '',
    ongoingMaintenance: card.ongoingMaintenance ?? '',
  };
}

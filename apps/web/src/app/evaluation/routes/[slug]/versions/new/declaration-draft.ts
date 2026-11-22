import {
  CreateRouteVersionRequestSchema,
  RoutePartySchema,
  type CreateRouteVersionRequest,
  type RouteParty,
  type RouteVersionResponse,
} from '@oci/shared-types';

/**
 * The declaration form's values, as text the way a person edits them, and
 * the conversions to and from the API's request (#649). Lists are one item
 * per line; the adversary and observation tables are rows. The request
 * schema in `@oci/shared-types` stays the only judge of what is valid.
 */

export interface AdversaryRow {
  party: string;
  capability: string;
  defended: boolean;
}

export interface ObservationRow {
  party: string;
  observes: string;
}

export interface DeclarationDraft {
  version: string;
  adversaries: AdversaryRow[];
  assumptions: string;
  outOfScope: string;
  observations: ObservationRow[];
  trustAnchor: string;
  keyGovernance: string;
  reproducible: boolean;
  reproducibleMethod: string;
  permittedOperations: string;
  arithmeticPrecision: string;
  maxRuntimeSec: string;
  maxMemoryMb: string;
  modelConstraints: string;
  fidelityMeasured: boolean;
  fidelityMetric: string;
  fidelityDelta: string;
  fidelityMeasuredOn: string;
}

/** Most rows a table accepts, as the schema caps them. */
export const MAX_ROWS = 16;

export function emptyDraft(): DeclarationDraft {
  return {
    version: '',
    adversaries: [{ party: '', capability: '', defended: true }],
    assumptions: '',
    outOfScope: '',
    observations: [{ party: '', observes: '' }],
    trustAnchor: '',
    keyGovernance: '',
    reproducible: false,
    reproducibleMethod: '',
    permittedOperations: '',
    arithmeticPrecision: '',
    maxRuntimeSec: '',
    maxMemoryMb: '',
    modelConstraints: '',
    fidelityMeasured: false,
    fidelityMetric: '',
    fidelityDelta: '',
    fidelityMeasuredOn: '',
  };
}

/** A draft that starts from a version's declarations, with the version number left blank. */
export function draftFromVersion(v: RouteVersionResponse): DeclarationDraft {
  const gap = v.operationalEnvelope.fidelityGap ?? null;
  return {
    version: '',
    adversaries: v.threatModel.adversaries.map((a) => ({ ...a })),
    assumptions: v.threatModel.assumptions.join('\n'),
    outOfScope: v.threatModel.outOfScope.join('\n'),
    observations: v.disclosureProfile.observations.map((o) => ({ ...o })),
    trustAnchor: v.disclosureProfile.trustAnchor,
    keyGovernance: v.disclosureProfile.keyGovernance,
    reproducible: v.disclosureProfile.reproducible.value,
    reproducibleMethod: v.disclosureProfile.reproducible.method ?? '',
    permittedOperations: v.operationalEnvelope.permittedOperations.join('\n'),
    arithmeticPrecision: v.operationalEnvelope.arithmeticPrecision,
    maxRuntimeSec: String(v.operationalEnvelope.maxRuntimeSec),
    maxMemoryMb: String(v.operationalEnvelope.maxMemoryMb),
    modelConstraints: v.operationalEnvelope.modelConstraints ?? '',
    fidelityMeasured: gap !== null,
    fidelityMetric: gap?.metric ?? '',
    fidelityDelta: gap ? String(gap.delta) : '',
    fidelityMeasuredOn: gap?.measuredOn ?? '',
  };
}

const text = (fd: FormData, name: string): string => {
  const value = fd.get(name);
  return typeof value === 'string' ? value : '';
};

/** Rows posted as `<prefix>.<i>.<field>`, in index order, up to `MAX_ROWS`. */
const ROW_KEY = {
  adversaries: /^adversaries\.(\d{1,2})\./,
  observations: /^observations\.(\d{1,2})\./,
} as const;

function rows(fd: FormData, prefix: keyof typeof ROW_KEY): number[] {
  const indexes = new Set<number>();
  const pattern = prefix === 'adversaries' ? ROW_KEY.adversaries : ROW_KEY.observations;
  for (const key of fd.keys()) {
    const match = pattern.exec(key);
    if (match?.[1]) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b).slice(0, MAX_ROWS);
}

/** The draft as the form posted it. */
export function draftFromFormData(fd: FormData): DeclarationDraft {
  return {
    version: text(fd, 'version').trim(),
    adversaries: rows(fd, 'adversaries').map((i) => ({
      party: text(fd, `adversaries.${i}.party`),
      capability: text(fd, `adversaries.${i}.capability`),
      defended: text(fd, `adversaries.${i}.defended`) === 'yes',
    })),
    assumptions: text(fd, 'assumptions'),
    outOfScope: text(fd, 'outOfScope'),
    observations: rows(fd, 'observations').map((i) => ({
      party: text(fd, `observations.${i}.party`),
      observes: text(fd, `observations.${i}.observes`),
    })),
    trustAnchor: text(fd, 'trustAnchor'),
    keyGovernance: text(fd, 'keyGovernance'),
    reproducible: text(fd, 'reproducible') === 'yes',
    reproducibleMethod: text(fd, 'reproducibleMethod'),
    permittedOperations: text(fd, 'permittedOperations'),
    arithmeticPrecision: text(fd, 'arithmeticPrecision'),
    maxRuntimeSec: text(fd, 'maxRuntimeSec').trim(),
    maxMemoryMb: text(fd, 'maxMemoryMb').trim(),
    modelConstraints: text(fd, 'modelConstraints'),
    fidelityMeasured: text(fd, 'fidelityMeasured') === 'yes',
    fidelityMetric: text(fd, 'fidelityMetric'),
    fidelityDelta: text(fd, 'fidelityDelta').trim(),
    fidelityMeasuredOn: text(fd, 'fidelityMeasuredOn'),
  };
}

const lines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** A number typed in a field, or NaN so the schema names the field. */
const numberOf = (value: string): number => (value === '' ? Number.NaN : Number(value));

const partyOf = (value: string): RouteParty | string => {
  const parsed = RoutePartySchema.safeParse(value);
  return parsed.success ? parsed.data : value;
};

/**
 * The request a draft stands for, unchecked. A blank optional text is sent
 * as null; a blank required one is sent as typed so the schema says which.
 */
export function requestFromDraft(d: DeclarationDraft): unknown {
  const trimmedOrNull = (value: string) => (value.trim().length > 0 ? value.trim() : null);
  return {
    version: d.version,
    threatModel: {
      adversaries: d.adversaries.map((a) => ({
        party: partyOf(a.party),
        capability: a.capability.trim(),
        defended: a.defended,
      })),
      assumptions: lines(d.assumptions),
      outOfScope: lines(d.outOfScope),
    },
    disclosureProfile: {
      observations: d.observations.map((o) => ({
        party: partyOf(o.party),
        observes: o.observes.trim(),
      })),
      trustAnchor: d.trustAnchor,
      keyGovernance: d.keyGovernance.trim(),
      reproducible: { value: d.reproducible, method: trimmedOrNull(d.reproducibleMethod) },
    },
    operationalEnvelope: {
      permittedOperations: lines(d.permittedOperations),
      arithmeticPrecision: d.arithmeticPrecision.trim(),
      maxRuntimeSec: numberOf(d.maxRuntimeSec),
      maxMemoryMb: numberOf(d.maxMemoryMb),
      modelConstraints: trimmedOrNull(d.modelConstraints),
      fidelityGap: d.fidelityMeasured
        ? {
            metric: d.fidelityMetric.trim(),
            delta: numberOf(d.fidelityDelta),
            measuredOn: d.fidelityMeasuredOn.trim(),
          }
        : null,
    },
  };
}

/**
 * The form field a schema issue belongs to. Table cells keep their row
 * (`adversaries.2.capability`); an issue on a list or a table as a whole
 * goes to the field itself (`assumptions`, `adversaries`).
 */
export function fieldForIssue(path: ReadonlyArray<PropertyKey>): string {
  const [section, field, index, cell] = path.map(String);
  if (section === 'version') return 'version';
  if (section === 'threatModel' || section === 'disclosureProfile') {
    if ((field === 'adversaries' || field === 'observations') && index !== undefined && cell) {
      return `${field}.${index}.${cell}`;
    }
    if (field === 'reproducible') return 'reproducibleMethod';
    return field ?? section;
  }
  if (section === 'operationalEnvelope') {
    if (field === 'fidelityGap') {
      const sub = index ?? 'metric';
      return `fidelity${sub.charAt(0).toUpperCase()}${sub.slice(1)}`;
    }
    return field ?? section;
  }
  return 'form';
}

export type DraftCheck =
  | { ok: true; request: CreateRouteVersionRequest }
  | { ok: false; errors: Record<string, string> };

/** Checks a draft with the API's own request schema; one message per field. */
export function checkDraft(d: DeclarationDraft, messageFor: (field: string) => string): DraftCheck {
  const parsed = CreateRouteVersionRequestSchema.safeParse(requestFromDraft(d));
  if (parsed.success) return { ok: true, request: parsed.data };
  const errors = new Map<string, string>();
  for (const issue of parsed.error.issues) {
    const field = fieldForIssue(issue.path);
    if (!errors.has(field)) errors.set(field, messageFor(field));
  }
  return { ok: false, errors: Object.fromEntries(errors) };
}

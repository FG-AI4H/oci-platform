import type { z } from 'zod';
import type { AccessTier } from '@oci/shared-types';
import {
  ANNOTATION_CAMPAIGN_ACTIVITY_KIND,
  DeidentificationSchema,
  IntegritySchema,
  IsoDateTime,
  LabelProtocolSchema,
  ReceiptSchema,
  SourceSiteSchema,
} from './schema.js';

/**
 * `bio-prov` v0.1 obligation table (spec section 3) as data, plus the
 * predicate for each requirement.
 *
 * Every requirement evaluates the **normalized** manifest and reports
 * one of:
 *
 *   - `satisfied`        the requirement is met;
 *   - `missing`          the property (or the qualifying entry) is absent;
 *   - `malformed`        the property is present but does not meet the
 *                        profile's shape or cross-checks — `problems`
 *                        lists each defect with its own pointer;
 *   - `not_applicable`   the footnote condition does not hold (P3 for a
 *                        primary collection, A1–A3 with no campaign
 *                        write-back).
 *
 * The obligation a `missing` result carries depends on the access tier
 * (`obligationFor`); a `malformed` result is reported at the same
 * severity at every tier. Turning outcomes into `ValidationIssue`s with
 * levels is `index.ts`'s job, so this module stays a pure description of
 * the profile.
 *
 * Paths are RFC 6901 JSON Pointers into the normalized manifest, in line
 * with the other layers of this package (`/wasGeneratedBy/startedAtTime`
 * rather than `/prov:wasGeneratedBy/prov:startedAtTime`).
 */

export type Obligation = 'MUST' | 'SHOULD' | 'MAY';

export type RequirementId =
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'H6'
  | 'A1'
  | 'A2'
  | 'A3';

export type RequirementStatus = 'satisfied' | 'missing' | 'malformed' | 'not_applicable';

export interface RequirementProblem {
  /** `invalid` — wrong shape or value; `mismatch` — disagrees with another property. */
  kind: 'invalid' | 'mismatch';
  /** The offending field, appended to the issue code (`provenance.invalid.P2.endedAtTime`). */
  field?: string;
  /** JSON Pointer to the offending value (normalized keys). */
  path: string;
  message: string;
}

export interface RequirementEvaluation {
  id: RequirementId;
  status: RequirementStatus;
  /** Where the property lives, or where it is expected. */
  path: string;
  message: string;
  /** Populated when `status === 'malformed'`. */
  problems: RequirementProblem[];
}

export type NormalizedManifest = Record<string, unknown>;

export interface ProvenanceRequirement {
  id: RequirementId;
  /** Short title as in the spec's table. */
  title: string;
  /** Section 3 of the spec, before footnotes. */
  obligation: Readonly<Record<AccessTier, Obligation>>;
  /** Footnote adjustment (² for H4). Returns the effective obligation. */
  adjustObligation?: (
    tier: AccessTier,
    base: Obligation,
    manifest: NormalizedManifest,
  ) => Obligation;
  /**
   * Evaluate against the normalized manifest. Requirements that attach
   * to distributions (A1–A3) return one evaluation per qualifying
   * distribution; the others return exactly one.
   */
  evaluate: (manifest: NormalizedManifest) => RequirementEvaluation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** RFC 6901 token escaping. */
function token(segment: string | number): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function join(base: string, ...segments: Array<string | number>): string {
  return segments.reduce<string>((acc, s) => `${acc}/${token(s)}`, base);
}

interface Located<T = unknown> {
  value: T;
  path: string;
}

/**
 * Croissant allows single values wherever an array may appear. Return the
 * entries with the pointer each one lives at: `/key/0` for arrays, `/key`
 * for a bare value.
 */
function entries(container: JsonObject, key: string, base = ''): Located[] {
  // Keys come from the profile's fixed vocabulary, never from input.
  // eslint-disable-next-line security/detect-object-injection
  const raw = container[key];
  if (raw === undefined || raw === null) return [];
  const path = join(base, key);
  if (Array.isArray(raw)) return raw.map((value, i) => ({ value, path: join(path, i) }));
  return [{ value: raw, path }];
}

/** `@type` may be a string or an array; accept the prefixed and bare spellings. */
function hasType(obj: JsonObject, ...bareNames: string[]): boolean {
  const t = obj['@type'];
  const types = Array.isArray(t) ? t : [t];
  return types.some(
    (x) => typeof x === 'string' && bareNames.some((n) => x === n || x === `prov:${n}`),
  );
}

function parseIso(value: unknown): number | null {
  const r = IsoDateTime.safeParse(value);
  return r.success ? Date.parse(r.data) : null;
}

/** Map a Zod failure on a sub-object to requirement problems. */
function zodProblems(err: z.ZodError, base: string): RequirementProblem[] {
  return err.issues.map((issue) => {
    const last = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : undefined;
    return {
      kind: 'invalid',
      field: last,
      path: issue.path.reduce<string>((acc, p) => join(acc, String(p)), base),
      message: issue.message,
    };
  });
}

function outcome(
  id: RequirementId,
  status: RequirementStatus,
  path: string,
  message: string,
  problems: RequirementProblem[] = [],
): RequirementEvaluation {
  return { id, status, path, message, problems };
}

function fromProblems(
  id: RequirementId,
  path: string,
  okMessage: string,
  problems: RequirementProblem[],
): RequirementEvaluation {
  return problems.length === 0
    ? outcome(id, 'satisfied', path, okMessage)
    : outcome(id, 'malformed', path, `${id} is present but malformed`, problems);
}

// ---------------------------------------------------------------------------
// Shared readers
// ---------------------------------------------------------------------------

/** The P2 activity: the first `wasGeneratedBy` entry typed `prov:Activity`. */
export function findGeneratingActivity(manifest: NormalizedManifest): Located<JsonObject> | null {
  for (const e of entries(manifest, 'wasGeneratedBy')) {
    if (isObject(e.value) && hasType(e.value, 'Activity')) {
      return { value: e.value, path: e.path };
    }
  }
  return null;
}

/**
 * A dataset is *derived* when it says so (`wasDerivedFrom`) or when its
 * generating activity `used` an upstream entity (spec P2, last paragraph).
 */
export function isDerived(manifest: NormalizedManifest): boolean {
  if (entries(manifest, 'wasDerivedFrom').length > 0) return true;
  const activity = findGeneratingActivity(manifest);
  return activity !== null && entries(activity.value, 'used').length > 0;
}

/**
 * Distributions produced by an annotation campaign: those whose
 * `wasGeneratedBy` holds an Activity with `activityKind: ANNOTATION_CAMPAIGN`.
 */
export function findWriteBackDistributions(manifest: NormalizedManifest): Array<{
  distribution: Located<JsonObject>;
  activity: Located<JsonObject>;
}> {
  const out: Array<{ distribution: Located<JsonObject>; activity: Located<JsonObject> }> = [];
  for (const d of entries(manifest, 'distribution')) {
    if (!isObject(d.value)) continue;
    for (const a of entries(d.value, 'wasGeneratedBy', d.path)) {
      if (
        isObject(a.value) &&
        hasType(a.value, 'Activity') &&
        a.value['activityKind'] === ANNOTATION_CAMPAIGN_ACTIVITY_KIND
      ) {
        out.push({
          distribution: { value: d.value, path: d.path },
          activity: { value: a.value, path: a.path },
        });
        break;
      }
    }
  }
  return out;
}

/** Validate a `startedAtTime` / `endedAtTime` pair on an activity. */
function activityDateProblems(activity: Located<JsonObject>): RequirementProblem[] {
  const problems: RequirementProblem[] = [];
  const start = activity.value['startedAtTime'];
  const end = activity.value['endedAtTime'];
  const startMs = parseIso(start);
  const endMs = parseIso(end);
  if (startMs === null) {
    problems.push({
      kind: 'invalid',
      field: 'startedAtTime',
      path: join(activity.path, 'startedAtTime'),
      message:
        start === undefined
          ? 'startedAtTime is required on the activity'
          : 'startedAtTime must be an ISO 8601 date or date-time',
    });
  }
  if (endMs === null) {
    problems.push({
      kind: 'invalid',
      field: 'endedAtTime',
      path: join(activity.path, 'endedAtTime'),
      message:
        end === undefined
          ? 'endedAtTime is required on the activity'
          : 'endedAtTime must be an ISO 8601 date or date-time',
    });
  } else if (startMs !== null && endMs < startMs) {
    problems.push({
      kind: 'invalid',
      field: 'endedAtTime',
      path: join(activity.path, 'endedAtTime'),
      message: 'endedAtTime must not be before startedAtTime',
    });
  }
  return problems;
}

const AGENT_TYPES = ['Agent', 'Organization', 'Person', 'SoftwareAgent'];

/** An agent reference: an IRI string, or an object typed as an agent or carrying a name. */
function namesAnAgent(v: unknown): boolean {
  if (isNonEmptyString(v)) return true;
  if (!isObject(v)) return false;
  return hasType(v, ...AGENT_TYPES) || isNonEmptyString(v['name']);
}

// ---------------------------------------------------------------------------
// P1–P4 — required PROV-O structure (spec section 4)
// ---------------------------------------------------------------------------

const P1: ProvenanceRequirement = {
  id: 'P1',
  title: 'Attributed to a source organization',
  obligation: { OPEN: 'SHOULD', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/wasAttributedTo';
    const list = entries(manifest, 'wasAttributedTo');
    if (list.length === 0) {
      return [outcome('P1', 'missing', path, 'wasAttributedTo must name a prov:Organization')];
    }
    const orgs = list.filter((e) => isObject(e.value) && hasType(e.value, 'Organization'));
    if (orgs.length === 0) {
      return [
        outcome(
          'P1',
          'missing',
          path,
          'wasAttributedTo has no entry of @type prov:Organization (a prov:Person never satisfies P1 alone)',
        ),
      ];
    }
    const problems: RequirementProblem[] = [];
    for (const org of orgs) {
      if (!isNonEmptyString((org.value as JsonObject)['name'])) {
        problems.push({
          kind: 'invalid',
          field: 'name',
          path: join(org.path, 'name'),
          message: 'prov:Organization must carry a non-empty name',
        });
      }
    }
    return [fromProblems('P1', path, 'attributed to a named organization', problems)];
  },
};

const P2: ProvenanceRequirement = {
  id: 'P2',
  title: 'Generated by a dated collection/derivation activity',
  obligation: { OPEN: 'SHOULD', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/wasGeneratedBy';
    const list = entries(manifest, 'wasGeneratedBy');
    if (list.length === 0) {
      return [outcome('P2', 'missing', path, 'wasGeneratedBy must hold a dated prov:Activity')];
    }
    const activity = findGeneratingActivity(manifest);
    if (activity === null) {
      return [
        outcome(
          'P2',
          'missing',
          path,
          'wasGeneratedBy has no object of @type prov:Activity (an IRI string alone does not satisfy P2)',
        ),
      ];
    }
    const problems: RequirementProblem[] = [];
    if (!isNonEmptyString(activity.value['name'])) {
      problems.push({
        kind: 'invalid',
        field: 'name',
        path: join(activity.path, 'name'),
        message: 'the generating activity must carry a non-empty name',
      });
    }
    problems.push(...activityDateProblems(activity));
    // A derived dataset's activity MUST `used` the upstream entity of P3.
    if (
      entries(manifest, 'wasDerivedFrom').length > 0 &&
      entries(activity.value, 'used').length === 0
    ) {
      problems.push({
        kind: 'invalid',
        field: 'used',
        path: join(activity.path, 'used'),
        message:
          'a derived dataset’s activity must `used` the upstream entity named in wasDerivedFrom',
      });
    }
    return [fromProblems('P2', activity.path, 'generated by a dated activity', problems)];
  },
};

const P3: ProvenanceRequirement = {
  id: 'P3',
  title: 'Derived-from upstream entity, when derived',
  obligation: { OPEN: 'MUST', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/wasDerivedFrom';
    if (!isDerived(manifest)) {
      return [outcome('P3', 'not_applicable', path, 'primary collection; P3 does not apply')];
    }
    const list = entries(manifest, 'wasDerivedFrom');
    if (list.length === 0) {
      return [
        outcome(
          'P3',
          'missing',
          path,
          'the generating activity `used` an upstream entity but wasDerivedFrom is absent',
        ),
      ];
    }
    const problems: RequirementProblem[] = [];
    for (const e of list) {
      if (isNonEmptyString(e.value)) continue;
      if (!isObject(e.value)) {
        problems.push({
          kind: 'invalid',
          path: e.path,
          message: 'wasDerivedFrom entries must be an IRI string or a prov:Entity object',
        });
        continue;
      }
      if (!hasType(e.value, 'Entity')) {
        problems.push({
          kind: 'invalid',
          field: '@type',
          path: join(e.path, '@type'),
          message: 'wasDerivedFrom object must be of @type prov:Entity',
        });
      }
      if (!isNonEmptyString(e.value['@id'])) {
        problems.push({
          kind: 'invalid',
          field: '@id',
          path: join(e.path, '@id'),
          message: 'wasDerivedFrom entity must carry an @id (a DOI IRI is preferred)',
        });
      }
    }
    return [fromProblems('P3', path, 'derived from an identified upstream entity', problems)];
  },
};

const P4: ProvenanceRequirement = {
  id: 'P4',
  title: 'Activity associated with an agent',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const activity = findGeneratingActivity(manifest);
    if (activity === null) {
      return [
        outcome(
          'P4',
          'missing',
          '/wasGeneratedBy',
          'no generating prov:Activity to associate an agent with (see P2)',
        ),
      ];
    }
    const path = join(activity.path, 'wasAssociatedWith');
    const agents = entries(activity.value, 'wasAssociatedWith', activity.path);
    if (agents.length === 0) {
      return [outcome('P4', 'missing', path, 'the generating activity must name an agent')];
    }
    if (!agents.some((a) => namesAnAgent(a.value))) {
      return [
        outcome('P4', 'malformed', path, 'P4 is present but malformed', [
          {
            kind: 'invalid',
            path,
            message:
              'wasAssociatedWith must name a prov:Organization, prov:Person or prov:SoftwareAgent',
          },
        ]),
      ];
    }
    return [outcome('P4', 'satisfied', path, 'activity associated with an agent')];
  },
};

// ---------------------------------------------------------------------------
// H1–H6 — health qualifiers (spec section 5)
// ---------------------------------------------------------------------------

const H1: ProvenanceRequirement = {
  id: 'H1',
  title: 'Source site(s)',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/sourceSite';
    const raw = manifest['sourceSite'];
    if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
      return [outcome('H1', 'missing', path, 'sourceSite must list the contributing sites')];
    }
    if (!Array.isArray(raw)) {
      return [
        outcome('H1', 'malformed', path, 'H1 is present but malformed', [
          { kind: 'invalid', path, message: 'sourceSite must be an array of site objects' },
        ]),
      ];
    }
    const problems: RequirementProblem[] = [];
    raw.forEach((site, i) => {
      const r = SourceSiteSchema.safeParse(site);
      if (!r.success) problems.push(...zodProblems(r.error, join(path, i)));
    });
    return [fromProblems('H1', path, 'source sites declared with countries', problems)];
  },
};

const H2: ProvenanceRequirement = {
  id: 'H2',
  title: 'Collection timeframe',
  obligation: { OPEN: 'SHOULD', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/dataCollectionTimeframe';
    const raw = manifest['dataCollectionTimeframe'];
    if (raw === undefined || raw === null) {
      return [
        outcome(
          'H2',
          'missing',
          path,
          'rai:dataCollectionTimeframe must state when data was collected',
        ),
      ];
    }
    if (!isNonEmptyString(raw)) {
      return [
        outcome('H2', 'malformed', path, 'H2 is present but malformed', [
          { kind: 'invalid', path, message: 'dataCollectionTimeframe must be a non-empty string' },
        ]),
      ];
    }
    return [outcome('H2', 'satisfied', path, 'collection timeframe stated')];
  },
};

const H3: ProvenanceRequirement = {
  id: 'H3',
  title: 'Acquisition device / scanner class',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'SHOULD', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/dataAcquisitionEquipment';
    const equipment = entries(manifest, 'dataAcquisitionEquipment');
    const classes = entries(manifest, 'deviceClass');
    const problems: RequirementProblem[] = [];

    let satisfied = false;
    for (const e of equipment) {
      if (!isObject(e.value)) continue;
      if (isNonEmptyString(e.value['manufacturer'])) satisfied = true;
      if ('serialNumber' in e.value) {
        problems.push({
          kind: 'invalid',
          field: 'serialNumber',
          path: join(e.path, 'serialNumber'),
          message: 'device serial numbers must not appear in a manifest',
        });
      }
    }
    for (const c of classes) {
      if (isNonEmptyString(c.value)) {
        satisfied = true;
      } else if (isObject(c.value)) {
        if (
          isNonEmptyString(c.value['name']) ||
          isNonEmptyString(c.value['termCode']) ||
          isNonEmptyString(c.value['@id'])
        ) {
          satisfied = true;
        } else {
          problems.push({
            kind: 'invalid',
            path: c.path,
            message: 'deviceClass must be a DefinedTerm with a name, termCode or @id',
          });
        }
      } else {
        problems.push({
          kind: 'invalid',
          path: c.path,
          message: 'deviceClass must be a DefinedTerm object',
        });
      }
    }

    if (problems.length > 0) {
      return [outcome('H3', 'malformed', path, 'H3 is present but malformed', problems)];
    }
    if (!satisfied) {
      return [
        outcome(
          'H3',
          'missing',
          path,
          'declare dataAcquisitionEquipment with a manufacturer, or a deviceClass term',
        ),
      ];
    }
    return [outcome('H3', 'satisfied', path, 'acquisition device class declared')];
  },
};

const H4: ProvenanceRequirement = {
  id: 'H4',
  title: 'De-identification activity',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  // ² At OPEN, H4 is a MUST when anonymizationLevel is anything other than ANONYMIZED.
  adjustObligation(tier, base, manifest) {
    if (tier !== 'OPEN') return base;
    const level = manifest['anonymizationLevel'];
    return level !== undefined && level !== 'ANONYMIZED' ? 'MUST' : base;
  },
  evaluate(manifest) {
    const path = '/deidentification';
    const raw = manifest['deidentification'];
    if (raw === undefined || raw === null) {
      return [
        outcome('H4', 'missing', path, 'deidentification must describe the de-identification pass'),
      ];
    }
    const r = DeidentificationSchema.safeParse(raw);
    if (!r.success) {
      return [
        outcome('H4', 'malformed', path, 'H4 is present but malformed', zodProblems(r.error, path)),
      ];
    }
    const problems: RequirementProblem[] = [];
    const declared = manifest['anonymizationLevel'];
    if (declared !== undefined && declared !== r.data.resultingLevel) {
      problems.push({
        kind: 'mismatch',
        field: 'anonymizationLevel',
        path: join(path, 'resultingLevel'),
        message: `deidentification.resultingLevel (${r.data.resultingLevel}) must equal bio:anonymizationLevel (${String(declared)})`,
      });
    }
    if (r.data.method === 'NONE' && r.data.resultingLevel !== 'IDENTIFIED') {
      problems.push({
        kind: 'invalid',
        field: 'method',
        path: join(path, 'method'),
        message: 'method NONE is only valid with resultingLevel IDENTIFIED',
      });
    }
    return [fromProblems('H4', path, 'de-identification activity described', problems)];
  },
};

const H5: ProvenanceRequirement = {
  id: 'H5',
  title: 'Ethics / IRB approval',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/irbApproval';
    const raw = manifest['irbApproval'];
    if (raw === undefined || raw === null) {
      return [outcome('H5', 'missing', path, 'irbApproval must reference the covering approval')];
    }
    if (!isObject(raw)) {
      return [
        outcome('H5', 'malformed', path, 'H5 is present but malformed', [
          { kind: 'invalid', path, message: 'irbApproval must be an object' },
        ]),
      ];
    }
    const problems: RequirementProblem[] = [];
    for (const field of ['approvingBody', 'approvalNumber'] as const) {
      // eslint-disable-next-line security/detect-object-injection -- fixed vocabulary
      if (!isNonEmptyString(raw[field])) {
        problems.push({
          kind: 'invalid',
          field,
          path: join(path, field),
          message: `irbApproval.${field} must be a non-empty string`,
        });
      }
    }
    return [fromProblems('H5', path, 'ethics approval referenced', problems)];
  },
};

const H6: ProvenanceRequirement = {
  id: 'H6',
  title: 'Label-production protocol version',
  obligation: { OPEN: 'SHOULD', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const path = '/labelProtocol';
    const raw = manifest['labelProtocol'];
    if (raw === undefined || raw === null) {
      return [
        outcome(
          'H6',
          'missing',
          path,
          'labelProtocol must state version, labelScale and gradersPerItem',
        ),
      ];
    }
    const r = LabelProtocolSchema.safeParse(raw);
    if (!r.success) {
      return [
        outcome('H6', 'malformed', path, 'H6 is present but malformed', zodProblems(r.error, path)),
      ];
    }
    return [outcome('H6', 'satisfied', path, 'label-production protocol declared')];
  },
};

// ---------------------------------------------------------------------------
// A1–A3 — the annotation-campaign edge (spec section 6)
// ---------------------------------------------------------------------------

function notApplicableWriteBack(id: RequirementId): RequirementEvaluation[] {
  return [
    outcome(
      id,
      'not_applicable',
      '/distribution',
      'no annotation-campaign write-back distribution',
    ),
  ];
}

const A1: ProvenanceRequirement = {
  id: 'A1',
  title: 'Write-back distribution is a derived entity',
  obligation: { OPEN: 'MUST', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const writeBacks = findWriteBackDistributions(manifest);
    if (writeBacks.length === 0) return notApplicableWriteBack('A1');
    return writeBacks.map(({ distribution, activity }) => {
      const derived = entries(distribution.value, 'wasDerivedFrom', distribution.path);
      if (derived.length === 0) {
        return outcome(
          'A1',
          'missing',
          join(distribution.path, 'wasDerivedFrom'),
          'a campaign write-back must be wasDerivedFrom the dataset or its source distribution',
        );
      }
      const problems: RequirementProblem[] = [];
      if (!isNonEmptyString(activity.value['@id'])) {
        problems.push({
          kind: 'invalid',
          field: '@id',
          path: join(activity.path, '@id'),
          message: 'the campaign activity must carry the campaign identifier as @id',
        });
      }
      problems.push(...activityDateProblems(activity));
      const agents = entries(activity.value, 'wasAssociatedWith', activity.path);
      const tool = agents.find((a) => isObject(a.value) && hasType(a.value, 'SoftwareAgent'));
      if (tool === undefined) {
        problems.push({
          kind: 'invalid',
          field: 'wasAssociatedWith',
          path: join(activity.path, 'wasAssociatedWith'),
          message:
            'the campaign activity must be wasAssociatedWith the annotation tool as a prov:SoftwareAgent',
        });
      } else if (!isNonEmptyString((tool.value as JsonObject)['name'])) {
        problems.push({
          kind: 'invalid',
          field: 'name',
          path: join(tool.path, 'name'),
          message: 'the annotation tool agent must carry a name',
        });
      }
      return fromProblems('A1', distribution.path, 'write-back is a derived entity', problems);
    });
  },
};

const A2: ProvenanceRequirement = {
  id: 'A2',
  title: 'Write-back carries its chain root',
  obligation: { OPEN: 'MUST', REGISTERED: 'MUST', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const writeBacks = findWriteBackDistributions(manifest);
    if (writeBacks.length === 0) return notApplicableWriteBack('A2');
    return writeBacks.map(({ distribution }) => {
      const path = join(distribution.path, 'integrity');
      const raw = distribution.value['integrity'];
      if (raw === undefined || raw === null) {
        return outcome(
          'A2',
          'missing',
          path,
          'a campaign write-back must carry bio:integrity (chain root)',
        );
      }
      const r = IntegritySchema.safeParse(raw);
      return r.success
        ? outcome('A2', 'satisfied', path, 'chain root carried')
        : outcome(
            'A2',
            'malformed',
            path,
            'A2 is present but malformed',
            zodProblems(r.error, path),
          );
    });
  },
};

const A3: ProvenanceRequirement = {
  id: 'A3',
  title: 'Write-back carries receipt references',
  obligation: { OPEN: 'MAY', REGISTERED: 'SHOULD', CONTROLLED: 'MUST', SENSITIVE: 'MUST' },
  evaluate(manifest) {
    const writeBacks = findWriteBackDistributions(manifest);
    if (writeBacks.length === 0) return notApplicableWriteBack('A3');
    return writeBacks.map(({ distribution }) => {
      const path = join(distribution.path, 'receipts');
      const raw = distribution.value['receipts'];
      if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
        return outcome('A3', 'missing', path, 'a campaign write-back must carry bio:receipts');
      }
      if (!Array.isArray(raw)) {
        return outcome('A3', 'malformed', path, 'A3 is present but malformed', [
          { kind: 'invalid', path, message: 'receipts must be an array of receipt references' },
        ]);
      }
      const problems: RequirementProblem[] = [];
      raw.forEach((receipt, i) => {
        const r = ReceiptSchema.safeParse(receipt);
        if (!r.success) problems.push(...zodProblems(r.error, join(path, i)));
      });
      return fromProblems('A3', path, 'receipt references carried', problems);
    });
  },
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** Spec section 3, in table order. */
export const PROVENANCE_REQUIREMENTS: ReadonlyArray<ProvenanceRequirement> = [
  P1,
  P2,
  P3,
  P4,
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  A1,
  A2,
  A3,
];

/** Effective obligation of a requirement at a tier, footnotes applied. */
export function obligationFor(
  requirement: ProvenanceRequirement,
  tier: AccessTier,
  manifest: NormalizedManifest,
): Obligation {
  // Tier names are the fixed `AccessTier` enum, never input.
  // eslint-disable-next-line security/detect-object-injection
  const base = requirement.obligation[tier];
  return requirement.adjustObligation ? requirement.adjustObligation(tier, base, manifest) : base;
}

/** Evaluate every requirement against a normalized manifest. */
export function evaluateRequirements(manifest: NormalizedManifest): RequirementEvaluation[] {
  return PROVENANCE_REQUIREMENTS.flatMap((r) => r.evaluate(manifest));
}

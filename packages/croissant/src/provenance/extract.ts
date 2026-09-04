import { normalize } from '../validator/normalize.js';
import {
  findGeneratingActivity,
  findWriteBackDistributions,
  type NormalizedManifest,
} from './requirements.js';

/**
 * Flat provenance summary for the UI and the API (spec section 8;
 * mirrors `extractDuoTerms`).
 *
 * Accepts a manifest in either prefixed (`prov:wasGeneratedBy`,
 * `bio:sourceSite`) or normalized form: the input is normalized first,
 * so nested prefixed keys (`prov:startedAtTime`) are read too. Never
 * throws on a malformed manifest; fields it cannot read come back empty
 * or `null`. Validation is the validator's job.
 */
export interface ProvenanceSummary {
  /** Names of the `prov:Organization` entries in `wasAttributedTo`. */
  sourceOrganizations: string[];
  /** `bio:sourceSite` entries with a name; `country` is `''` when absent. */
  sites: Array<{ name: string; country: string }>;
  /** `startedAtTime` / `endedAtTime` of the generating activity. */
  timeframe: { start: string; end: string } | null;
  /** `bio:deviceClass` labels, then `manufacturer [model]` of acquisition equipment. */
  deviceClasses: string[];
  deidentification: { method: string; resultingLevel: string } | null;
  ethicsApproval: { approvingBody: string; approvalNumber: string } | null;
  labelProtocolVersion: string | null;
  /** `@id`s (or bare IRIs) of `wasDerivedFrom`. */
  derivedFrom: string[];
  /** One entry per annotation-campaign write-back distribution. */
  writeBacks: Array<{ distributionId: string; chainRoot: string | null; events: number | null }>;
}

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function hasType(obj: JsonObject, bare: string): boolean {
  return list(obj['@type']).some((t) => t === bare || t === `prov:${bare}`);
}

export function extractProvenance(manifest: unknown): ProvenanceSummary {
  const empty: ProvenanceSummary = {
    sourceOrganizations: [],
    sites: [],
    timeframe: null,
    deviceClasses: [],
    deidentification: null,
    ethicsApproval: null,
    labelProtocolVersion: null,
    derivedFrom: [],
    writeBacks: [],
  };
  if (!isObject(manifest)) return empty;
  const m = normalize(manifest) as NormalizedManifest;

  // P1 — source organizations
  const sourceOrganizations = dedupe(
    list(m['wasAttributedTo']).flatMap((a) =>
      isObject(a) && hasType(a, 'Organization') ? (str(a['name']) ?? []) : [],
    ),
  );

  // H1 — sites
  const sites = list(m['sourceSite']).flatMap((s) => {
    if (!isObject(s)) return [];
    const name = str(s['name']);
    return name ? [{ name, country: str(s['country']) ?? '' }] : [];
  });

  // P2 — timeframe
  const activity = findGeneratingActivity(m);
  const start = activity ? str(activity.value['startedAtTime']) : null;
  const end = activity ? str(activity.value['endedAtTime']) : null;
  const timeframe = start !== null && end !== null ? { start, end } : null;

  // H3 — device classes
  const deviceClasses = dedupe([
    ...list(m['deviceClass']).flatMap((c) => {
      if (typeof c === 'string') return str(c) ?? [];
      if (!isObject(c)) return [];
      return str(c['name']) ?? str(c['termCode']) ?? str(c['@id']) ?? [];
    }),
    ...list(m['dataAcquisitionEquipment']).flatMap((e) => {
      if (!isObject(e)) return [];
      const manufacturer = str(e['manufacturer']);
      if (!manufacturer) return [];
      const model = str(e['model']);
      return model ? `${manufacturer} ${model}` : manufacturer;
    }),
  ]);

  // H4 — de-identification
  const deid = m['deidentification'];
  const method = isObject(deid) ? str(deid['method']) : null;
  const resultingLevel = isObject(deid) ? str(deid['resultingLevel']) : null;
  const deidentification =
    method !== null && resultingLevel !== null ? { method, resultingLevel } : null;

  // H5 — ethics approval
  const irb = m['irbApproval'];
  const approvingBody = isObject(irb) ? str(irb['approvingBody']) : null;
  const approvalNumber = isObject(irb) ? str(irb['approvalNumber']) : null;
  const ethicsApproval =
    approvingBody !== null && approvalNumber !== null ? { approvingBody, approvalNumber } : null;

  // H6 — label protocol
  const protocol = m['labelProtocol'];
  const labelProtocolVersion = isObject(protocol) ? str(protocol['version']) : null;

  // P3 — upstream entities
  const derivedFrom = dedupe(
    list(m['wasDerivedFrom']).flatMap((d) => {
      if (typeof d === 'string') return str(d) ?? [];
      return isObject(d) ? (str(d['@id']) ?? []) : [];
    }),
  );

  // A1–A3 — write-backs
  const writeBacks = findWriteBackDistributions(m).map(({ distribution }) => {
    const integrity = distribution.value['integrity'];
    const events = isObject(integrity) ? integrity['events'] : undefined;
    return {
      distributionId: str(distribution.value['@id']) ?? str(distribution.value['name']) ?? '',
      chainRoot: isObject(integrity) ? str(integrity['root']) : null,
      events: typeof events === 'number' && Number.isInteger(events) ? events : null,
    };
  });

  return {
    sourceOrganizations,
    sites,
    timeframe,
    deviceClasses,
    deidentification,
    ethicsApproval,
    labelProtocolVersion,
    derivedFrom,
    writeBacks,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

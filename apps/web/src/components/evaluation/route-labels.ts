import type {
  EvaluationRouteResponse,
  RouteParty,
  RouteVersionResponse,
  ScoreAttribution,
} from '@oci/shared-types';
import type { Formatters } from '../../i18n/format';
import type { Translator } from '../../i18n/translator';

/**
 * Pure helpers for the evaluation-method pages (#487). The specification
 * calls an evaluation method a *route*; the pages say "evaluation method" in
 * headings and mention the specification's word once. Everything here is
 * free of JSX so the vocabulary and the unit formatting can be tested under
 * Vitest's node environment. The words come from the `EvaluationMethods`
 * messages, in the interface language (#654).
 */

/** `t` for the `EvaluationMethods` namespace. */
export type MethodsTranslator = Translator<'EvaluationMethods'>;

/** The execution family a route belongs to, as the API spells it. */
export type RouteMode = 'PREDICTIONS' | 'CONTAINER' | 'ENCRYPTED';

// A Set rather than a Record: the list DTO types `mode` as a plain string.
const MODES: ReadonlySet<string> = new Set<RouteMode>(['PREDICTIONS', 'CONTAINER', 'ENCRYPTED']);

export function asRouteMode(mode: string): RouteMode | null {
  return MODES.has(mode) ? (mode as RouteMode) : null;
}

/** Plain-language label for an execution family; the raw word for a mode this build does not know. */
export function describeMode(mode: string, t: MethodsTranslator): string {
  const known = asRouteMode(mode);
  return known ? t(`mode.long.${known}`) : mode;
}

/** Two-or-three-word form of the same label, for a badge. */
export function shortMode(mode: string, t: MethodsTranslator): string {
  const known = asRouteMode(mode);
  return known ? t(`mode.short.${known}`) : mode;
}

/** One party, its plain-word label and what it is, for readers meeting the words for the first time. */
export interface PartyGlossaryEntry {
  party: RouteParty;
  label: string;
  description: string;
}

/** The four parties in display order. Written out rather than derived, so nothing indexes by key. */
export const PARTIES: ReadonlyArray<RouteParty> = [
  'DATA_HOST',
  'MODEL_DEVELOPER',
  'PLATFORM_OPERATOR',
  'ROUTE_PROVIDER',
];

/** A party, in plain words ("data host"). */
export function partyLabel(party: RouteParty, t: MethodsTranslator): string {
  return t(`party.label.${party}`);
}

/** The four parties with what each one is, in display order. */
export function partyGlossary(t: MethodsTranslator): PartyGlossaryEntry[] {
  return PARTIES.map((party) => ({
    party,
    label: t(`party.label.${party}`),
    description: t(`party.description.${party}`),
  }));
}

export type TrustAnchor = 'CONTRACTUAL' | 'HARDWARE_ATTESTATION' | 'CRYPTOGRAPHIC';

/** What the guarantees can rest on, in display order. */
export const TRUST_ANCHORS: ReadonlyArray<TrustAnchor> = [
  'CONTRACTUAL',
  'HARDWARE_ATTESTATION',
  'CRYPTOGRAPHIC',
];

/** What the guarantees ultimately rest on, in words ("a contract"). */
export function trustAnchorLabel(anchor: TrustAnchor, t: MethodsTranslator): string {
  return t(`trustAnchor.${anchor}`);
}

/** Provider name, or the reference-implementation wording for OCI's own routes. */
export function describeProvider(
  route: Pick<EvaluationRouteResponse, 'providerName' | 'isReference'>,
  t: MethodsTranslator,
): string {
  if (route.isReference) return t('provider.reference');
  return route.providerName ?? t('provider.unnamed');
}

/**
 * Build the attribution the task page renders for a result, from a route
 * version alone. The review-status badge then reads identically on both
 * pages — published / provisional / withdrawn — because both go through
 * `describeAttribution`. A version has no retraction of its own, so
 * `retractedAt` is always null here; retraction is a property of results.
 */
export function attributionForVersion(
  routeSlug: string,
  version: Pick<RouteVersionResponse, 'version' | 'reviewStatus'>,
): Extract<ScoreAttribution, { kind: 'ROUTED' }> {
  return {
    kind: 'ROUTED',
    routeSlug,
    routeVersion: version.version,
    reviewStatus: version.reviewStatus,
    published: version.reviewStatus === 'APPROVED',
    retractedAt: null,
  };
}

/**
 * Parse MAJOR.MINOR.PATCH. Anything else sorts after every well-formed
 * version, in the order the API returned it, rather than throwing.
 */
function semverParts(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Latest version first. Stable for ties and for malformed versions. */
export function sortVersionsLatestFirst<T extends { version: string }>(
  versions: readonly T[],
): T[] {
  return versions
    .map((v, index) => ({ v, index, parts: semverParts(v.version) }))
    .sort((a, b) => {
      if (a.parts && b.parts) {
        const [aMajor, aMinor, aPatch] = a.parts;
        const [bMajor, bMinor, bPatch] = b.parts;
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch || a.index - b.index;
      }
      if (a.parts) return -1;
      if (b.parts) return 1;
      return a.index - b.index;
    })
    .map(({ v }) => v);
}

export function latestVersion<T extends { version: string }>(versions: readonly T[]): T | null {
  return sortVersionsLatestFirst(versions)[0] ?? null;
}

/**
 * Seconds as hours and minutes: 45 → "45 s", 60 → "1 min", 3600 → "1 h",
 * 5400 → "1 h 30 min". The same symbols in English and French. The exact
 * seconds figure is kept by the caller in a `title` so the rounding never
 * hides the declared cap.
 */
export function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (rest > 0) parts.push(`${rest} s`);
  return parts.join(' ');
}

/**
 * Mebibytes as gibibytes once they reach 1024: 512 → "512 MiB",
 * 1536 → "1.5 GiB", 16384 → "16 GiB" ("1,5 Gio" in French).
 */
export function formatMemory(mib: number, t: MethodsTranslator, f: Formatters): string {
  if (mib < 1024) return t('unit.mib', { n: f.number(mib) });
  const gib = mib / 1024;
  const n = Number.isInteger(gib) ? f.number(gib) : f.number(gib, { maximumFractionDigits: 2 });
  return t('unit.gib', { n });
}

/** Signed delta on a fidelity gap; a positive gap is shown with its sign. */
export function formatDelta(delta: number, f: Formatters): string {
  return f.number(delta, { maximumFractionDigits: 4, signDisplay: 'exceptZero' });
}

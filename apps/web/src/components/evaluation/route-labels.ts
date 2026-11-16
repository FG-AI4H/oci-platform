import type {
  EvaluationRouteResponse,
  RouteParty,
  RouteVersionResponse,
  ScoreAttribution,
} from '@oci/shared-types';

/**
 * Pure helpers for the evaluation-method pages (#487). The specification
 * calls an evaluation method a *route*; the pages say "evaluation method" in
 * headings and mention the specification's word once. Everything here is
 * free of JSX so the vocabulary and the unit formatting can be tested under
 * Vitest's node environment.
 */

/** The execution family a route belongs to, as the API spells it. */
export type RouteMode = 'PREDICTIONS' | 'CONTAINER' | 'ENCRYPTED';

// Maps rather than Records: the list DTO types `mode` as a plain string, and a
// Map lookup keeps the code free of dynamic-key access on an object.
/** Plain-language label for each execution family. */
export const MODE_LABEL: ReadonlyMap<RouteMode, string> = new Map<RouteMode, string>([
  ['PREDICTIONS', 'Predictions file scored on the platform'],
  ['CONTAINER', 'Sealed container run next to the data'],
  ['ENCRYPTED', 'Computation on encrypted values'],
]);

/** Two-or-three-word form of the same label, for a badge. */
export const MODE_SHORT_LABEL: ReadonlyMap<RouteMode, string> = new Map<RouteMode, string>([
  ['PREDICTIONS', 'Predictions file'],
  ['CONTAINER', 'Sealed container'],
  ['ENCRYPTED', 'Encrypted computation'],
]);

export function asRouteMode(mode: string): RouteMode | null {
  return MODE_LABEL.has(mode as RouteMode) ? (mode as RouteMode) : null;
}

/** Falls back to the raw word for a mode this build does not know. */
export function describeMode(mode: string): string {
  return MODE_LABEL.get(mode as RouteMode) ?? mode;
}

export function shortMode(mode: string): string {
  return MODE_SHORT_LABEL.get(mode as RouteMode) ?? mode;
}

/** One party, its plain-word label and what it is, for readers meeting the words for the first time. */
export interface PartyGlossaryEntry {
  party: RouteParty;
  label: string;
  description: string;
}

/** The four parties in display order. Written out rather than derived, so nothing indexes by key. */
export const PARTY_GLOSSARY: ReadonlyArray<PartyGlossaryEntry> = [
  {
    party: 'DATA_HOST',
    label: 'data host',
    description: 'the institution that holds the dataset and its reference labels',
  },
  {
    party: 'MODEL_DEVELOPER',
    label: 'model developer',
    description: 'the participant whose model is being evaluated',
  },
  {
    party: 'PLATFORM_OPERATOR',
    label: 'platform operator',
    description: 'the team that runs the Open Code Infrastructure',
  },
  {
    party: 'ROUTE_PROVIDER',
    label: 'method provider',
    description: 'the party that built and operates the evaluation method',
  },
];

/** The four parties, in plain words. Keyed for the member-expression lookups in the pages. */
export const PARTY_LABEL: Record<RouteParty, string> = {
  DATA_HOST: 'data host',
  MODEL_DEVELOPER: 'model developer',
  PLATFORM_OPERATOR: 'platform operator',
  ROUTE_PROVIDER: 'method provider',
};

export type TrustAnchor = 'CONTRACTUAL' | 'HARDWARE_ATTESTATION' | 'CRYPTOGRAPHIC';

/** What the guarantees ultimately rest on. */
export const TRUST_ANCHOR_LABEL: Record<TrustAnchor, string> = {
  CONTRACTUAL: 'a contract',
  HARDWARE_ATTESTATION: 'hardware attestation',
  CRYPTOGRAPHIC: 'a cryptographic assumption',
};

/** Provider name, or the reference-implementation wording for OCI's own routes. */
export function describeProvider(
  route: Pick<EvaluationRouteResponse, 'providerName' | 'isReference'>,
): string {
  if (route.isReference) return 'Reference implementation';
  return route.providerName ?? 'Provider not named';
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
 * 5400 → "1 h 30 min". The exact seconds figure is kept by the caller in a
 * `title` so the rounding never hides the declared cap.
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
 * 1536 → "1.5 GiB", 16384 → "16 GiB".
 */
export function formatMemory(mib: number): string {
  if (mib < 1024) return `${mib.toLocaleString('en-GB')} MiB`;
  const gib = mib / 1024;
  const formatted = Number.isInteger(gib)
    ? gib.toLocaleString('en-GB')
    : gib.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return `${formatted} GiB`;
}

/** Signed delta on a fidelity gap; a positive gap is shown with its sign. */
export const DELTA_FORMATTER = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 4,
  signDisplay: 'exceptZero',
});

import type { DicomInstanceHeader } from './types.js';

type Orderable = Pick<
  DicomInstanceHeader,
  'sopInstanceUid' | 'instanceNumber' | 'imagePositionPatient' | 'imageOrientationPatient'
>;

type Orientation = NonNullable<DicomInstanceHeader['imageOrientationPatient']>;

/** Direction cosines are written with six or so digits; this absorbs that. */
const ORIENTATION_TOLERANCE = 1e-3;

function sameOrientation(a: Orientation, b: Orientation): boolean {
  return a.every((value, i) => Math.abs(value - (b.at(i) ?? Number.NaN)) <= ORIENTATION_TOLERANCE);
}

/**
 * Distance of each slice from the origin along the normal of the
 * stack, or null when the instances are not one stack: a position or an
 * orientation is missing, or the orientations differ (a three-plane
 * localiser). Requiring one shared orientation is also what makes the
 * result independent of the order the instances arrive in.
 */
function stackDistances<T extends Orderable>(
  instances: readonly T[],
): Array<{ instance: T; distance: number }> | null {
  const reference = instances[0]?.imageOrientationPatient;
  if (!reference) return null;
  const [rx, ry, rz, cx, cy, cz] = reference;
  // Normal = row direction × column direction.
  const normal = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx] as const;

  const out: Array<{ instance: T; distance: number }> = [];
  for (const instance of instances) {
    const position = instance.imagePositionPatient;
    const orientation = instance.imageOrientationPatient;
    if (!position || !orientation || !sameOrientation(orientation, reference)) return null;
    out.push({
      instance,
      distance: normal[0] * position[0] + normal[1] * position[1] + normal[2] * position[2],
    });
  }
  return out;
}

function byInstanceNumber(a: Orderable, b: Orderable): number {
  const an = a.instanceNumber ?? Number.MAX_SAFE_INTEGER;
  const bn = b.instanceNumber ?? Number.MAX_SAFE_INTEGER;
  return an - bn || (a.sopInstanceUid ?? '').localeCompare(b.sopInstanceUid ?? '');
}

/**
 * +1 when instance numbers grow with distance along the normal, -1 when
 * they shrink. Taken from every numbered slice (the sign of the
 * covariance), not from the two ends, so one slice without a number or
 * a series with repeated positions does not flip the stack.
 */
function scannerDirection(
  entries: ReadonlyArray<{ instance: Orderable; distance: number }>,
): 1 | -1 {
  const numbered = entries.filter((entry) => entry.instance.instanceNumber !== null);
  if (numbered.length < 2) return 1;
  const meanDistance = numbered.reduce((sum, e) => sum + e.distance, 0) / numbered.length;
  const meanNumber =
    numbered.reduce((sum, e) => sum + (e.instance.instanceNumber ?? 0), 0) / numbered.length;
  const covariance = numbered.reduce(
    (sum, e) => sum + (e.distance - meanDistance) * ((e.instance.instanceNumber ?? 0) - meanNumber),
    0,
  );
  return covariance < 0 ? -1 : 1;
}

/**
 * Order the instances of one series for a stack.
 *
 * Position along the slice normal decides when the instances form one
 * stack: instance numbers can repeat, be missing or follow the export
 * order. The direction is the scanner's own, taken from the instance
 * numbers. Slices at the same position, and series that are not one
 * stack, are ordered by instance number, then by SOP instance UID, so
 * the result never depends on the order of the input.
 */
export function orderInstances<T extends Orderable>(instances: readonly T[]): T[] {
  const entries = stackDistances(instances);
  if (!entries) return [...instances].sort(byInstanceNumber);

  const direction = scannerDirection(entries);
  return entries
    .sort(
      (a, b) => direction * (a.distance - b.distance) || byInstanceNumber(a.instance, b.instance),
    )
    .map((entry) => entry.instance);
}

export interface DicomSeries<T> {
  studyInstanceUid: string | null;
  seriesInstanceUid: string;
  modality: string | null;
  seriesNumber: number | null;
  /** Ordered for display. */
  instances: T[];
}

/**
 * Group instances into series and order each one. Instances without a
 * series UID cannot be placed and are left out. Series come back by
 * study, then series number, then UID.
 */
export function groupIntoSeries<T extends DicomInstanceHeader>(
  instances: readonly T[],
): DicomSeries<T>[] {
  const bySeries = new Map<string, T[]>();
  for (const instance of instances) {
    if (!instance.seriesInstanceUid) continue;
    const members = bySeries.get(instance.seriesInstanceUid);
    if (members) members.push(instance);
    else bySeries.set(instance.seriesInstanceUid, [instance]);
  }

  return [...bySeries.entries()]
    .map(([seriesInstanceUid, members]) => {
      const ordered = orderInstances(members);
      const first = ordered[0];
      return {
        studyInstanceUid: first?.studyInstanceUid ?? null,
        seriesInstanceUid,
        modality: first?.modality ?? null,
        seriesNumber: first?.seriesNumber ?? null,
        instances: ordered,
      };
    })
    .sort(
      (a, b) =>
        (a.studyInstanceUid ?? '').localeCompare(b.studyInstanceUid ?? '') ||
        (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) - (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
        a.seriesInstanceUid.localeCompare(b.seriesInstanceUid),
    );
}

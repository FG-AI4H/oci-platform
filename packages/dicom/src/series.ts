import type { DicomInstanceHeader } from './types.js';

type Orderable = Pick<
  DicomInstanceHeader,
  'sopInstanceUid' | 'instanceNumber' | 'imagePositionPatient' | 'imageOrientationPatient'
>;

/** Distance of a slice from the origin along the normal of the stack. */
function distanceAlongNormal(instance: Orderable, reference: Orderable): number | null {
  const position = instance.imagePositionPatient;
  const orientation = reference.imageOrientationPatient;
  if (!position || !orientation) return null;
  const [rx, ry, rz, cx, cy, cz] = orientation;
  // Normal = row direction × column direction.
  const normal = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx] as const;
  return normal[0] * position[0] + normal[1] * position[1] + normal[2] * position[2];
}

function byInstanceNumber(a: Orderable, b: Orderable): number {
  const an = a.instanceNumber ?? Number.MAX_SAFE_INTEGER;
  const bn = b.instanceNumber ?? Number.MAX_SAFE_INTEGER;
  return an - bn || (a.sopInstanceUid ?? '').localeCompare(b.sopInstanceUid ?? '');
}

/**
 * Order the instances of one series for a stack.
 *
 * Position along the slice normal decides when every instance has one:
 * instance numbers can repeat, be missing or follow the export order.
 * The direction is the scanner's own, taken from the instance numbers
 * when they agree with the geometry. Without positions, instance number
 * decides, then the SOP instance UID, so the result is deterministic.
 */
export function orderInstances<T extends Orderable>(instances: readonly T[]): T[] {
  const reference = instances[0];
  if (!reference) return [];

  const withDistance = instances.map((instance) => ({
    instance,
    distance: distanceAlongNormal(instance, reference),
  }));
  if (withDistance.some((entry) => entry.distance === null)) {
    return [...instances].sort(byInstanceNumber);
  }

  const sorted = withDistance
    .sort(
      (a, b) =>
        (a.distance as number) - (b.distance as number) || byInstanceNumber(a.instance, b.instance),
    )
    .map((entry) => entry.instance);

  const first = sorted[0]?.instanceNumber;
  const last = sorted[sorted.length - 1]?.instanceNumber;
  if (first != null && last != null && first > last) sorted.reverse();
  return sorted;
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
      const first = members[0];
      return {
        studyInstanceUid: first?.studyInstanceUid ?? null,
        seriesInstanceUid,
        modality: first?.modality ?? null,
        seriesNumber: first?.seriesNumber ?? null,
        instances: orderInstances(members),
      };
    })
    .sort(
      (a, b) =>
        (a.studyInstanceUid ?? '').localeCompare(b.studyInstanceUid ?? '') ||
        (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) - (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
        a.seriesInstanceUid.localeCompare(b.seriesInstanceUid),
    );
}

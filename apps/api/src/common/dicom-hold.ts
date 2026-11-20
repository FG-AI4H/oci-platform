/**
 * Check outcomes that hold a stored DICOM file (ADR-0026): it is
 * served to nobody but its host and platform operators.
 *
 * `HELD` has findings no operator decision covers. `UNREADABLE` was
 * never checked, so it cannot be treated as clean. Shared here because
 * both the storage module (downloads) and the catalog module (the file
 * list of a dataset) enforce it, and neither may import the other's
 * repository.
 */
export const DICOM_HELD_STATUSES = ['HELD', 'UNREADABLE'] as const;

export type DicomHeldStatus = (typeof DICOM_HELD_STATUSES)[number];

export function isDicomHeldStatus(status: string): status is DicomHeldStatus {
  return (DICOM_HELD_STATUSES as readonly string[]).includes(status);
}

/** Captures the distribution id in a platform-hosted `contentUrl`. */
const HOSTED_DISTRIBUTION_ID =
  /\/v2\/catalog\/datasets\/[a-z0-9][a-z0-9-]*\/distributions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download$/;

/**
 * A copy of a Croissant manifest without the `distribution[]` entries
 * that point at a held file (ADR-0026).
 *
 * The host's manifest names every uploaded file (`@id`, name, hash,
 * and a `contentUrl` carrying the distribution id), so leaving a held
 * file out of the file list is not enough: the manifest is served on
 * its own route and inside the archive. Entries are matched by the
 * distribution id in their `contentUrl`; entries hosted elsewhere are
 * untouched. Returns the input itself when there is nothing to remove.
 */
export function withoutHeldDistributions(
  croissant: unknown,
  heldDistributionIds: ReadonlySet<string>,
): unknown {
  if (heldDistributionIds.size === 0) return croissant;
  if (!croissant || typeof croissant !== 'object' || Array.isArray(croissant)) return croissant;

  const isHeld = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const fields = new Map(Object.entries(entry as Record<string, unknown>));
    const contentUrl = fields.get('contentUrl') ?? fields.get('sc:contentUrl');
    if (typeof contentUrl !== 'string') return false;
    const id = HOSTED_DISTRIBUTION_ID.exec(contentUrl)?.[1];
    return id !== undefined && heldDistributionIds.has(id);
  };

  let changed = false;
  const out = Object.entries(croissant as Record<string, unknown>).map(([key, value]) => {
    if ((key !== 'distribution' && key !== 'sc:distribution') || !Array.isArray(value)) {
      return [key, value] as const;
    }
    const kept = value.filter((entry) => !isHeld(entry));
    if (kept.length !== value.length) changed = true;
    return [key, kept] as const;
  });
  return changed ? Object.fromEntries(out) : croissant;
}

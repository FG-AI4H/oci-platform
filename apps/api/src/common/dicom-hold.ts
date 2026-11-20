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

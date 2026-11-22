/**
 * Why some DICOM series got no task (#646, ADR-0026): a held file never
 * reaches a reader, so a series with one is left out until an operator
 * has decided on its findings.
 */
export function heldSeriesNotice(held: number): string {
  return `${held} DICOM ${held === 1 ? 'series was' : 'series were'} left out: ${held === 1 ? 'it has' : 'they have'} images held for de-identification findings.`;
}

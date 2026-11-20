import type { DicomSeriesSummary } from '@oci/shared-types';

/**
 * How a DICOM series is named and described on the dataset page
 * (#674, ADR-0026).
 *
 * The index keeps no free-text description of a series on purpose:
 * that is where identifying text hides. So a series is named from what
 * is safe to show: its modality, its number, and, when the dataset
 * holds several exams, which exam it belongs to.
 */
export interface SeriesRow {
  id: string;
  /** e.g. "CT series 3", or "Exam 2 · CT series 3". */
  title: string;
  /** e.g. "49 images · 512 × 512". */
  meta: string;
  /** Set when some of its images are held; null otherwise. */
  held: 'all' | 'some' | null;
  heldCount: number;
}

export function seriesRows(series: readonly DicomSeriesSummary[]): SeriesRow[] {
  // Exams are numbered in the order the list gives them. The UID itself
  // is not shown: it is long, and means nothing to a reader.
  const exams = new Map<string, number>();
  for (const entry of series) {
    const key = entry.studyInstanceUid ?? '';
    if (!exams.has(key)) exams.set(key, exams.size + 1);
  }

  const rows = series.map((entry): SeriesRow => {
    const name = [
      entry.modality ?? 'DICOM',
      entry.seriesNumber === null ? 'series' : `series ${entry.seriesNumber}`,
    ].join(' ');
    const exam = exams.get(entry.studyInstanceUid ?? '');
    const images = `${entry.instanceCount} ${entry.instanceCount === 1 ? 'image' : 'images'}`;
    const size =
      entry.rows !== null && entry.columns !== null ? `${entry.columns} × ${entry.rows}` : null;
    return {
      id: entry.id,
      title: exams.size > 1 && exam !== undefined ? `Exam ${exam} · ${name}` : name,
      meta: [images, size].filter((part): part is string => part !== null).join(' · '),
      held:
        entry.heldInstanceCount === 0
          ? null
          : entry.heldInstanceCount >= entry.instanceCount
            ? 'all'
            : 'some',
      heldCount: entry.heldInstanceCount,
    };
  });

  // A series number is optional in DICOM and is often repeated within
  // an exam. Rows that would carry the same name are told apart by
  // their place: "CT series (1 of 3)". A name is also the label of the
  // row's button and the title of its dialog, so it has to be unique.
  const sameTitle = new Map<string, number>();
  for (const row of rows) sameTitle.set(row.title, (sameTitle.get(row.title) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const total = sameTitle.get(row.title) ?? 1;
    if (total < 2) return row;
    const place = (seen.get(row.title) ?? 0) + 1;
    seen.set(row.title, place);
    return { ...row, title: `${row.title} (${place} of ${total})` };
  });
}

/** How many images of the listed series are held. */
export function heldImageCount(series: readonly DicomSeriesSummary[]): number {
  return series.reduce((sum, entry) => sum + entry.heldInstanceCount, 0);
}

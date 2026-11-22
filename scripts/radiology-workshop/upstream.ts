import { CsvError, parseCsvRecords } from './csv.js';
import { ageBandOf, type AgeBand, type Sex } from './profile.js';

/**
 * Readers for the two upstream inputs of the selection (#644): the metadata
 * file that ships with NIH ChestX-ray14, and a reference-label file.
 *
 * NOT CHECKED AGAINST THE DOWNLOAD. The column names below are the ones the
 * dataset is documented with; this code was written and tested against
 * synthetic stand-in files of the same shape, before anyone fetched the real
 * ones. A file with different headers is refused with the list of headers it
 * does have, so a difference shows up as a message, not as a wrong selection.
 */

/** Columns read from the NIH metadata file (`Data_Entry_2017*.csv`). */
export const NIH_COLUMNS = {
  image: 'Image Index',
  findings: 'Finding Labels',
  patient: 'Patient ID',
  age: 'Patient Age',
  sex: 'Patient Gender',
  view: 'View Position',
} as const;

/** The value NIH writes in `Finding Labels` when the report named no finding. */
export const NIH_NO_FINDING = 'No Finding';

export interface UpstreamImage {
  /** File name as distributed, e.g. `00000001_000.png`. */
  file: string;
  /** Item identifier used everywhere on the platform: the file name without its extension. */
  imageId: string;
  patientId: string;
  sex: Sex;
  ageBand: AgeBand;
  /** `PA` or `AP`. */
  view: string;
  /** Report-mined finding names, as listed by NIH. Empty for "No Finding". */
  findings: string[];
}

export interface MetadataReadResult {
  images: UpstreamImage[];
  /** Rows left out, by reason, so the operator sees what the pool lost. */
  excluded: Map<string, number>;
}

/**
 * Age in whole years. The file has been published with plain integers and,
 * earlier, with a zero-padded number and a unit (`058Y`, `010M`, `003D`).
 * Months and days are infants, outside the adult range the slice covers.
 */
function ageInYears(raw: string): number | null {
  const match = /^(\d{1,3})([YMD]?)$/i.exec(raw);
  if (!match) return null;
  const unit = (match[2] ?? '').toUpperCase();
  return unit === 'M' || unit === 'D' ? 0 : Number(match[1]);
}

export function readNihMetadata(csvText: string): MetadataReadResult {
  const records = parseCsvRecords(csvText, Object.values(NIH_COLUMNS), 'NIH metadata file');
  const images: UpstreamImage[] = [];
  const excluded = new Map<string, number>();
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);

  for (const record of records) {
    const file = record.get(NIH_COLUMNS.image) ?? '';
    const sexRaw = (record.get(NIH_COLUMNS.sex) ?? '').toUpperCase();
    const years = ageInYears(record.get(NIH_COLUMNS.age) ?? '');
    const band = years === null ? null : ageBandOf(years);
    const patientId = record.get(NIH_COLUMNS.patient) ?? '';

    if (!/^[A-Za-z0-9_-]+\.png$/.test(file)) {
      exclude('file name is not a plain .png name');
    } else if (patientId === '') {
      exclude('no patient identifier');
    } else if (sexRaw !== 'F' && sexRaw !== 'M') {
      exclude('sex is neither F nor M');
    } else if (band === null) {
      exclude('age missing, implausible or under 18');
    } else {
      images.push({
        file,
        imageId: file.slice(0, -'.png'.length),
        patientId,
        sex: sexRaw,
        ageBand: band,
        view: (record.get(NIH_COLUMNS.view) ?? '').toUpperCase(),
        findings: (record.get(NIH_COLUMNS.findings) ?? '')
          .split('|')
          .map((f) => f.trim())
          .filter((f) => f !== '' && f !== NIH_NO_FINDING),
      });
    }
  }
  return { images, excluded };
}

/** Where the reference labels come from. Recorded in the selection and the manifest. */
export const LABEL_SOURCES = [
  /** Radiologist-adjudicated labels released for a subset of the images. */
  'radiologist-adjudicated',
  /** The labels NIH mined from the radiology reports. Weak; the dataset page says so. */
  'nih-report-mined',
  /** Invented labels for the synthetic stand-in. Never diagnostic. */
  'synthetic-stand-in',
] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/** Reference label per image file: 1 = finding present, 0 = absent. */
export type ReferenceLabels = Map<string, 0 | 1>;

/** Labels mined from the reports: present when NIH lists the finding for the image. */
export function labelsFromReportMining(
  images: readonly UpstreamImage[],
  finding: string,
): ReferenceLabels {
  const known = new Set(images.flatMap((i) => i.findings));
  if (!known.has(finding)) {
    throw new CsvError(
      `No image lists the finding "${finding}". Findings in the file: ${[...known].sort().join(', ')}.`,
    );
  }
  return new Map(images.map((i) => [i.file, i.findings.includes(finding) ? 1 : 0]));
}

/**
 * Labels from an adjudicated label file: one row per image, an image column
 * and one column per finding holding YES or NO. An empty cell means the image
 * was not adjudicated for that finding, and it gets no label.
 */
export function labelsFromAdjudicatedFile(
  csvText: string,
  findingColumn: string,
  imageColumn: string = NIH_COLUMNS.image,
): ReferenceLabels {
  const records = parseCsvRecords(csvText, [imageColumn, findingColumn], 'Label file');
  const labels: ReferenceLabels = new Map();
  for (const record of records) {
    const file = record.get(imageColumn) ?? '';
    const value = (record.get(findingColumn) ?? '').toUpperCase();
    if (value === 'YES') labels.set(file, 1);
    else if (value === 'NO') labels.set(file, 0);
    else if (value !== '') {
      throw new CsvError(
        `Label file: "${file}" has the value "${value}" in "${findingColumn}"; expected YES, NO or empty.`,
      );
    }
  }
  return labels;
}

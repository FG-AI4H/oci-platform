import { toCsv } from './csv.js';
import { encodeGreyPng } from './png.js';
import { mulberry32, streamFor } from './prng.js';
import { NIH_COLUMNS, NIH_NO_FINDING } from './upstream.js';

/**
 * Synthetic stand-in for the upstream files (#644), so the whole profile can
 * be built, seeded and reset before a single real file is fetched.
 *
 * NOT DIAGNOSTIC, NOT NIH DATA. The metadata rows are invented, the labels
 * are random, and the images are drawn by the function below; none of the
 * three has anything to do with the others or with a patient. Stand-in file
 * names start with `standin_` so they cannot be mistaken for upstream ones.
 *
 * The files have the SHAPE of the real inputs (same column names, the same
 * awkward header, an old-style age here and there, rows that must be left
 * out), which is what the selection code needs to be exercised against.
 */

export const STAND_IN_METADATA_FILE = 'Data_Entry_standin.csv';
export const STAND_IN_LABELS_FILE = 'standin_labels.csv';
export const STAND_IN_FINDING = 'Airspace opacity';
const STAND_IN_PATIENTS = 1400;
const OTHER_FINDINGS = ['Effusion', 'Atelectasis', 'Nodule', 'Cardiomegaly'];

/** Header of the NIH metadata file as documented, bracketed columns and trailing comma included. */
const METADATA_HEADER = [
  NIH_COLUMNS.image,
  NIH_COLUMNS.findings,
  'Follow-up #',
  NIH_COLUMNS.patient,
  NIH_COLUMNS.age,
  NIH_COLUMNS.sex,
  NIH_COLUMNS.view,
  'OriginalImage[Width',
  'Height]',
  'OriginalImagePixelSpacing[x',
  'y]',
  '',
];

export interface StandInUpstream {
  metadataCsv: string;
  labelsCsv: string;
}

/** Invented metadata and label files. The same seed gives the same files. */
export function standInUpstream(seed: number): StandInUpstream {
  const rand = streamFor(seed, 'standin:metadata');
  const metadata: string[][] = [METADATA_HEADER];
  const labels: string[][] = [[NIH_COLUMNS.image, STAND_IN_FINDING, 'Fracture']];

  for (let patient = 1; patient <= STAND_IN_PATIENTS; patient += 1) {
    const sex = rand() < 0.5 ? 'F' : 'M';
    const age = 2 + Math.floor(rand() * 92);
    const films = 1 + Math.floor(rand() * 3);
    for (let followUp = 0; followUp < films; followUp += 1) {
      const file = `standin_${String(patient).padStart(5, '0')}_${String(followUp).padStart(3, '0')}.png`;
      const findings = OTHER_FINDINGS.filter(() => rand() < 0.12);
      // One row in forty carries the old age format, one in two hundred a value to leave out.
      const quirk = rand();
      const ageCell =
        quirk < 0.005 ? '414' : quirk < 0.03 ? `${String(age).padStart(3, '0')}Y` : String(age);
      metadata.push([
        file,
        findings.length > 0 ? findings.join('|') : NIH_NO_FINDING,
        String(followUp),
        String(patient),
        ageCell,
        sex,
        rand() < 0.65 ? 'PA' : 'AP',
        '2500',
        '2048',
        '0.168',
        '0.168',
        '',
      ]);
      // Three films in four have an adjudicated label; the rest have an empty cell.
      const labelled = rand() < 0.75;
      const present = rand() < 0.45;
      labels.push([file, labelled ? (present ? 'YES' : 'NO') : '', rand() < 0.05 ? 'YES' : 'NO']);
    }
  }
  return { metadataCsv: toCsv(metadata), labelsCsv: toCsv(labels) };
}

/**
 * A placeholder image for one stand-in file: a dark field with two lighter
 * ovals and a hatched band across the top that no radiograph has. It depends
 * on the file name only, never on a label.
 */
export function renderStandInImage(file: string, width = 256, height = 256): Buffer {
  const nameSeed = [...file].reduce(
    (h, ch) => (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) | 0,
    7,
  );
  const rand = mulberry32(nameSeed);
  const shift = Math.floor(rand() * 24) - 12;
  const pixels = Buffer.alloc(width * height);
  const cx = width / 2 + shift;
  const cy = height / 2 + 10;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 40;
      for (const side of [-1, 1]) {
        const dx = (x - (cx + side * width * 0.19)) / (width * 0.16);
        const dy = (y - cy) / (height * 0.32);
        if (dx * dx + dy * dy < 1) value = 96;
      }
      if (Math.abs(x - cx) < width * 0.02) value = 150;
      // The hatched band marks the image as artificial at a glance.
      if (y < height * 0.08) value = (x + y) % 16 < 8 ? 230 : 20;
      value += Math.floor((rand() - 0.5) * 12);
      pixels.writeUInt8(Math.max(0, Math.min(255, value)), y * width + x);
    }
  }
  return encodeGreyPng(pixels, width, height);
}

import { parseCsv, toCsv } from './csv.js';
import { AGE_BANDS, MODEL_B_WEAK_AGE_BAND, SEXES, type AgeBand, type Sex } from './profile.js';
import { apportion, shuffled, streamFor } from './prng.js';
import type { Selection } from './selection-file.js';

/**
 * The three teaching files of the workshop (#644): prediction files a
 * participant uploads to the evaluation task to see what a result does and
 * does not tell them.
 *
 *   model-a.csv  good overall and in every subgroup;
 *   model-b.csv  the SAME overall result as model A, and clearly worse in
 *                one age band;
 *   model-c.csv  not acceptable as a submission, to show the format check.
 *
 * HOW A AND B GET THE SAME OVERALL RESULT. Both make exactly the same number
 * of missed findings and of false alarms over the whole slice, so accuracy,
 * sensitivity and specificity are equal by construction, not by luck. They
 * differ only in WHERE the errors fall: model A spreads them over the six
 * strata in proportion to their size, model B puts every missed finding and
 * all but two false alarms in one age band. An aggregate cannot tell the two
 * apart; a breakdown by age band does.
 *
 * These are constructed files, not the output of any model. They are derived
 * from the hidden reference labels, so the two valid ones give most labels
 * away: that is accepted for a teaching task and would not be for a
 * competitive one.
 */

/** Header of a predictions CSV, as the submission page reads it. */
export const PREDICTIONS_CSV_HEADER = ['item_id', 'label'] as const;

/** Share of images with the finding that a model misses, and of images without it that it flags. */
export const ERROR_RATE = 0.1;
/** False alarms model B makes outside its weak age band, so the other bands are not perfect. */
const MODEL_B_ERRORS_ELSEWHERE = 2;

export interface TeachingFiles {
  modelA: string;
  modelB: string;
  modelC: string;
  design: {
    weakAgeBand: AgeBand;
    /** Missed findings and false alarms, identical for models A and B. */
    falseNegatives: number;
    falsePositives: number;
  };
}

interface Cell {
  sex: Sex;
  ageBand: AgeBand;
  label: 0 | 1;
  /** Image ids of the cell, in a seeded order: the first `k` are the ones a model gets wrong. */
  ids: string[];
}

function cellsOf(selection: Selection, labels: ReadonlyMap<string, 0 | 1>, seed: number): Cell[] {
  const cells: Cell[] = [];
  for (const sex of SEXES) {
    for (const ageBand of AGE_BANDS) {
      for (const label of [1, 0] as const) {
        const ids = selection.images
          .filter((i) => i.sex === sex && i.ageBand === ageBand && labels.get(i.imageId) === label)
          .map((i) => i.imageId)
          .sort((a, b) => a.localeCompare(b, 'en'));
        cells.push({
          sex,
          ageBand,
          label,
          ids: shuffled(ids, streamFor(seed, `teaching:${sex}/${ageBand}/${label}`)),
        });
      }
    }
  }
  return cells;
}

/** Predictions that are the reference label everywhere except the first `errors[i]` ids of cell `i`. */
function predictionsWithErrors(
  cells: readonly Cell[],
  errors: readonly number[],
): Map<string, number> {
  const predictions = new Map<string, number>();
  cells.forEach((cell, index) => {
    const wrong = errors.at(index) ?? 0;
    if (wrong > cell.ids.length) {
      throw new Error(
        `teaching files: ${wrong} errors asked of a cell of ${cell.ids.length} (${cell.sex}/${cell.ageBand}); the selection is too small for this design.`,
      );
    }
    cell.ids.forEach((id, position) => {
      predictions.set(id, position < wrong ? 1 - cell.label : cell.label);
    });
  });
  return predictions;
}

function toPredictionsCsv(rows: readonly (readonly [string, string])[]): string {
  return toCsv([[...PREDICTIONS_CSV_HEADER], ...rows]);
}

function sortedRows(predictions: ReadonlyMap<string, number>): [string, string][] {
  return [...predictions.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([id, label]) => [id, String(label)]);
}

export function buildTeachingFiles(
  selection: Selection,
  labels: ReadonlyMap<string, 0 | 1>,
  seed: number,
): TeachingFiles {
  const cells = cellsOf(selection, labels, seed);
  const sizeWhere = (keep: (cell: Cell) => boolean) =>
    cells.map((cell) => (keep(cell) ? cell.ids.length : 0));
  const total = (label: 0 | 1) =>
    cells.filter((c) => c.label === label).reduce((sum, c) => sum + c.ids.length, 0);

  const falseNegatives = Math.round(total(1) * ERROR_RATE);
  const falsePositives = Math.round(total(0) * ERROR_RATE);

  // Model A: errors in proportion to the size of each cell.
  const fnA = apportion(
    falseNegatives,
    sizeWhere((c) => c.label === 1),
  );
  const fpA = apportion(
    falsePositives,
    sizeWhere((c) => c.label === 0),
  );
  const errorsA = cells.map((_, index) => (fnA.at(index) ?? 0) + (fpA.at(index) ?? 0));

  // Model B: every missed finding in the weak band; the false alarms too, but for
  // two that fall in two different strata elsewhere.
  const weak = MODEL_B_WEAK_AGE_BAND;
  const elsewhere = Math.min(MODEL_B_ERRORS_ELSEWHERE, falsePositives);
  const otherBands = AGE_BANDS.filter((band) => band !== weak);
  const elsewhereCells = cells.map((c) => {
    const turn = otherBands.indexOf(c.ageBand);
    // One per other band, alternating the sex, so neither sex carries both.
    return c.label === 0 && turn >= 0 && c.sex === SEXES.at(turn % SEXES.length) ? 1 : 0;
  });
  const fnB = apportion(
    falseNegatives,
    sizeWhere((c) => c.label === 1 && c.ageBand === weak),
  );
  const fpWeakB = apportion(
    falsePositives - elsewhere,
    sizeWhere((c) => c.label === 0 && c.ageBand === weak),
  );
  const fpElsewhereB = apportion(elsewhere, elsewhereCells);
  const errorsB = cells.map(
    (_, index) => (fnB.at(index) ?? 0) + (fpWeakB.at(index) ?? 0) + (fpElsewhereB.at(index) ?? 0),
  );

  const modelA = predictionsWithErrors(cells, errorsA);
  const modelB = predictionsWithErrors(cells, errorsB);

  return {
    modelA: toPredictionsCsv(sortedRows(modelA)),
    modelB: toPredictionsCsv(sortedRows(modelB)),
    modelC: toPredictionsCsv(brokenRows(sortedRows(modelA), seed)),
    design: { weakAgeBand: weak, falseNegatives, falsePositives },
  };
}

/**
 * Model C: model A's file with the four mistakes the format check exists to
 * catch. The file still reads as a table of identifiers and whole numbers, so
 * it reaches the check instead of failing on its first line:
 *
 *   - five identifiers written as file names (`.png` added), which the task
 *     does not know;
 *   - four labels of 2 on a task whose labels are 0 and 1;
 *   - three items listed twice;
 *   - ten items left out.
 */
function brokenRows(rows: readonly [string, string][], seed: number): [string, string][] {
  const order = shuffled(
    rows.map(([id]) => id),
    streamFor(seed, 'teaching:model-c'),
  );
  const asFileName = new Set(order.slice(0, 5));
  const outOfRange = new Set(order.slice(5, 9));
  const twice = new Set(order.slice(9, 12));
  const leftOut = new Set(order.slice(12, 22));

  const out: [string, string][] = [];
  for (const [id, label] of rows) {
    if (leftOut.has(id)) continue;
    out.push([asFileName.has(id) ? `${id}.png` : id, outOfRange.has(id) ? '2' : label]);
    if (twice.has(id)) out.push([id, label]);
  }
  return out;
}

/**
 * Read a predictions CSV into the rows of the submission request body. Only
 * what the header and a whole-number label require is checked here; whether
 * the identifiers and labels suit a task is the API's validation path's job.
 */
export function readPredictionsCsv(text: string): { imageId: string; grade: number }[] {
  const [header, ...rows] = parseCsv(text);
  if (header?.join(',') !== PREDICTIONS_CSV_HEADER.join(',')) {
    throw new Error(`The first line must be ${PREDICTIONS_CSV_HEADER.join(',')}.`);
  }
  return rows.map(([imageId = '', label = '']) => {
    if (!/^\d+$/.test(label)) throw new Error(`The label of "${imageId}" is not a whole number.`);
    return { imageId, grade: Number(label) };
  });
}

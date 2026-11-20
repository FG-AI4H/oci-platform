import type { PredictionRow, SubmissionValidationReport } from '@oci/shared-types';

/**
 * Turns the API's validation report into what the submit page prints under
 * the file field (#645). Pure, so the wording is unit-tested without a browser.
 *
 * The API's own `detail` strings are written for someone calling the endpoint
 * (they mention `index.json` and the scored path). The reader here filled in a
 * spreadsheet, so each problem is restated in those terms and says what to do.
 *
 * Missing items are computed here, not taken from the report: the report gives
 * only their count, and "12 items have no prediction" is not actionable
 * without knowing which. Both inputs are public — the task's identifiers are
 * on its page, and the predictions are the reader's own file.
 */

/** How many identifiers one list names. The count is always given in full. */
export const MAX_LISTED_ITEM_IDS = 20;

export interface FormatProblem {
  key: 'duplicates' | 'unknown' | 'labels' | 'other';
  title: string;
  detail: string;
  /** The first identifiers concerned; `itemIdCount` says how many there are. */
  itemIds: string[];
  itemIdCount: number;
}

export interface FormatReportView {
  /** True when the file can be submitted for scoring as it is. */
  ok: boolean;
  /** Rows in the file. */
  rowCount: number;
  /** Items the task scores. */
  taskItemCount: number;
  /** Distinct rows whose identifier belongs to the task. */
  recognised: number;
  /** What must be fixed before the file can be scored. Empty when `ok`. */
  problems: FormatProblem[];
  /** Task items the file has no row for. Allowed: they lower coverage. */
  missing: { itemIds: string[]; count: number };
}

export function buildFormatReport(args: {
  report: SubmissionValidationReport;
  predictions: readonly PredictionRow[];
  task: { itemIds: readonly string[]; numClasses: number };
}): FormatReportView {
  const { report, predictions, task } = args;

  const submitted = new Set(predictions.map((p) => p.imageId));
  const missing = task.itemIds.filter((id) => !submitted.has(id));
  const recognised = report.itemIdSummary?.recognised ?? task.itemIds.length - missing.length;
  const topLabel = task.numClasses - 1;

  const problems: FormatProblem[] = [];
  for (const check of report.checks) {
    if (check.ok) continue;
    const ids = { itemIds: check.itemIds, itemIdCount: check.itemIdCount };
    switch (check.name) {
      case 'DUPLICATE_ITEM_IDS':
        problems.push({
          key: 'duplicates',
          title: 'Identifiers that appear more than once',
          detail: 'Each item takes one line. Keep one line for each of these and delete the rest.',
          ...ids,
        });
        break;
      case 'ITEM_IDS_RECOGNISED':
        problems.push({
          key: 'unknown',
          title: 'Identifiers this task does not have',
          detail:
            recognised === 0
              ? 'None of the identifiers in the file belong to this task. The file may be for another task, or the identifiers were changed. Start again from the template.'
              : 'Check these for a typing mistake, or delete their lines. The template lists every identifier the task has.',
          ...ids,
        });
        break;
      case 'LABEL_RANGE':
        problems.push({
          key: 'labels',
          title: 'Labels outside the range of this task',
          detail: `A label is a whole number from 0 to ${topLabel}. These items have a different value.`,
          ...ids,
        });
        break;
      default:
        problems.push({ key: 'other', title: 'Check failed', detail: check.detail, ...ids });
    }
  }

  return {
    // The API's verdict, not `problems.length === 0`: the two agree today, and
    // if a check were ever added that this file does not know, the API's word
    // is the one that decides whether a file would be scored.
    ok: report.ok,
    rowCount: predictions.length,
    taskItemCount: task.itemIds.length,
    recognised,
    problems,
    missing: { itemIds: missing.slice(0, MAX_LISTED_ITEM_IDS), count: missing.length },
  };
}

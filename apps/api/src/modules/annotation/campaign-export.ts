import type { AnnotationGateState } from '@oci/database';
import {
  ANNOTATION_EXPORT_COLUMNS,
  type AnnotationExportRow,
  type ExportGate,
  type ExportTaskStatus,
  type ReaderPseudonym,
} from '@oci/shared-types';
import { csvCell, UTF8_BOM } from '../../common/csv.js';
import { answerOf } from './campaign-agreement.js';
import type { CampaignTaskAnswers } from './task.repository.js';

/**
 * The export of a campaign's annotations (#648). Pure: the service
 * reads the tasks and writes the audit event.
 *
 * One row per submitted answer, at every gate, and one row for a task
 * with no answer yet, so every task of the campaign appears. Readers
 * appear under the campaign's pseudonymous ids only.
 */

/** How the final label is chosen, written into the JSON export. */
export const FINAL_LABEL_RULE =
  'Closed at the independent step: the label the readers gave in common. ' +
  'Sent to arbitration: the arbitration label, or the expert-review label if the task went on to expert review (the last one wins). ' +
  'Open or skipped: none. No majority vote is applied (ADR-0008, amendment of 2026-11-25).';

export const READERS_RULE =
  "Readers appear under the campaign's pseudonymous reader ids: the same reader has the same id in every export of this campaign and an unrelated id in other campaigns. No name, email or account id.";

const GATE: Record<AnnotationGateState, ExportGate | null> = {
  INDEPENDENT: 'independent',
  AWAITING_ARBITRATION: 'arbitration',
  AWAITING_EXPERT: 'expert-review',
  COMPLETED: null,
  SKIPPED: null,
};

/** Later gates win; within a gate, the later answer. */
const GATE_RANK: Record<AnnotationGateState, number> = {
  INDEPENDENT: 0,
  AWAITING_ARBITRATION: 1,
  AWAITING_EXPERT: 2,
  COMPLETED: 3,
  SKIPPED: 3,
};

/**
 * The task's status and final label, by Marc's rule of 2026-11-17:
 *   - closed at the independent step: the readers' common label;
 *   - sent to arbitration: the arbitration label, or the expert-review
 *     label if there is one (the last one wins);
 *   - not completed (or skipped): no final label.
 * No majority vote. A task closed at the independent step without a
 * common label (which the workflow never produces) gets none.
 */
export function finalLabelOf(task: CampaignTaskAnswers): {
  taskStatus: ExportTaskStatus;
  finalLabel: string | null;
} {
  if (task.gateState === 'SKIPPED') return { taskStatus: 'skipped', finalLabel: null };
  if (task.gateState !== 'COMPLETED') return { taskStatus: 'open', finalLabel: null };

  const settling = task.assignments
    .filter((a) => a.gateAtAssignment !== 'INDEPENDENT' && answerOf(a.submission) !== null)
    .sort(
      (x, y) =>
        GATE_RANK[x.gateAtAssignment] - GATE_RANK[y.gateAtAssignment] ||
        (x.submittedAt?.getTime() ?? 0) - (y.submittedAt?.getTime() ?? 0),
    );
  const last = settling.at(-1);
  if (last) {
    return {
      taskStatus:
        last.gateAtAssignment === 'AWAITING_EXPERT' ? 'closed-expert-review' : 'closed-arbitration',
      finalLabel: answerOf(last.submission),
    };
  }

  const readings = task.assignments
    .filter((a) => a.gateAtAssignment === 'INDEPENDENT')
    .map((a) => answerOf(a.submission));
  const first = readings[0] ?? null;
  const common = first !== null && readings.every((l) => l === first) ? first : null;
  return { taskStatus: 'closed-independent', finalLabel: common };
}

function textField(submission: unknown, field: 'comment' | 'reason'): string | null {
  if (!submission || typeof submission !== 'object') return null;
  // eslint-disable-next-line security/detect-object-injection -- `field` is one of two literals
  const value = (submission as Record<string, unknown>)[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function buildExportRows(
  tasks: readonly CampaignTaskAnswers[],
  pseudonym: (userId: string) => ReaderPseudonym,
): AnnotationExportRow[] {
  const rows: AnnotationExportRow[] = [];
  for (const task of tasks) {
    const { taskStatus, finalLabel } = finalLabelOf(task);
    const answers = [...task.assignments].sort(
      (x, y) =>
        GATE_RANK[x.gateAtAssignment] - GATE_RANK[y.gateAtAssignment] ||
        (x.submittedAt?.getTime() ?? 0) - (y.submittedAt?.getTime() ?? 0),
    );
    if (answers.length === 0) {
      rows.push({
        task: task.id,
        sampleRef: task.sampleRef,
        taskStatus,
        reader: null,
        gate: null,
        label: null,
        comment: null,
        submittedAt: null,
        arbitrationReason: null,
        finalLabel,
      });
      continue;
    }
    for (const a of answers) {
      const gate = GATE[a.gateAtAssignment];
      rows.push({
        task: task.id,
        sampleRef: task.sampleRef,
        taskStatus,
        reader: pseudonym(a.assigneeUserId),
        gate,
        label: answerOf(a.submission),
        comment: textField(a.submission, 'comment'),
        submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
        arbitrationReason: gate === 'arbitration' ? textField(a.submission, 'reason') : null,
        finalLabel,
      });
    }
  }
  return rows;
}

/**
 * The rows as CSV for a spreadsheet: UTF-8 with a byte-order mark, a
 * header row, CRLF line ends, RFC 4180 quoting, and the formula guard
 * on every cell (`csvCell`). An empty value is an empty cell.
 */
export function toAnnotationCsv(rows: readonly AnnotationExportRow[]): string {
  const lines: string[] = [ANNOTATION_EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      // eslint-disable-next-line security/detect-object-injection -- `column` is a typed key of the row
      ANNOTATION_EXPORT_COLUMNS.map((column) => csvCell(row[column] ?? '')).join(','),
    );
  }
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

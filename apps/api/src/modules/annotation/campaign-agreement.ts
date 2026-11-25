import { cohensKappa, fleissKappa, fleissKappaBootstrap } from '@oci/annotation-quality';
import {
  AGREEMENT_MIN_TASKS,
  CANNOT_ASSESS_LABEL,
  type AgreementCoefficientStatus,
  type CampaignAgreement,
  type ClassificationLabelsConfig,
  type PairwiseAgreement,
  type ReaderPseudonym,
} from '@oci/shared-types';
import type { CampaignTaskAnswers } from './task.repository.js';

/**
 * Agreement between a campaign's readers (#648). Pure: the service
 * reads the tasks and hands them over with the pseudonym function.
 *
 * Basis. Only the SUBMITTED answers of the independent step: released
 * and expired assignments never reach here (the repository reads
 * SUBMITTED only), and arbitration and expert-review answers are left
 * out, since they are not independent readings of the same task.
 *
 * Tasks counted. A task whose independent step is finished: it closed,
 * or went on to arbitration or expert review. Tasks still being read
 * are `open`; skipped tasks are counted apart. A finished task with a
 * reading that carries no answer, or with a number of readings other
 * than the campaign's usual one, is `excluded` (Fleiss' kappa needs the
 * same number of readers on every task).
 *
 * « Cannot assess » is an answer of its own: two readers who both
 * cannot assess agree. The gate-1 decision uses the same rule, so a
 * task closed by agreement here is one the workflow closed.
 *
 * Coefficients. Fleiss' kappa over the counted tasks with its 95%
 * percentile-bootstrap interval (`fleissKappaBootstrap`), overall
 * percent agreement (Fleiss' P̄), and Cohen's kappa for every pair of
 * readers over the tasks they share. None of them below
 * `AGREEMENT_MIN_TASKS` tasks (for a pair: shared tasks).
 */
export interface AgreementInput {
  campaignSlug: string;
  tasks: readonly CampaignTaskAnswers[];
  labels: ClassificationLabelsConfig | null;
  pseudonym: (userId: string) => ReaderPseudonym;
  now?: Date;
}

interface CountedTask {
  readings: Array<{ reader: ReaderPseudonym; label: string }>;
  sentToArbitration: boolean;
}

/** The answer of a submission, or null when it has none. */
export function answerOf(submission: unknown): string | null {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) return null;
  const label = (submission as { label?: unknown }).label;
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  return trimmed === '' ? null : trimmed;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export function computeCampaignAgreement(input: AgreementInput): CampaignAgreement {
  let open = 0;
  let skipped = 0;
  let excluded = 0;
  const finished: CountedTask[] = [];

  for (const task of input.tasks) {
    if (task.gateState === 'SKIPPED') {
      skipped += 1;
      continue;
    }
    if (task.gateState === 'INDEPENDENT') {
      open += 1;
      continue;
    }
    const independent = task.assignments.filter((a) => a.gateAtAssignment === 'INDEPENDENT');
    const readings = independent.map((a) => ({
      reader: input.pseudonym(a.assigneeUserId),
      label: answerOf(a.submission),
    }));
    if (readings.length === 0 || readings.some((r) => r.label === null)) {
      excluded += 1;
      continue;
    }
    const sentToArbitration =
      task.gateState === 'AWAITING_ARBITRATION' ||
      task.gateState === 'AWAITING_EXPERT' ||
      task.assignments.some((a) => a.gateAtAssignment !== 'INDEPENDENT');
    finished.push({
      readings: readings as CountedTask['readings'],
      sentToArbitration,
    });
  }

  // The usual number of readers per task: the most frequent one, the
  // larger on a tie. Tasks with another number are excluded.
  const frequency = new Map<number, number>();
  for (const t of finished) {
    frequency.set(t.readings.length, (frequency.get(t.readings.length) ?? 0) + 1);
  }
  let readersPerTask: number | null = null;
  let best = 0;
  for (const [n, count] of frequency) {
    if (count > best || (count === best && readersPerTask !== null && n > readersPerTask)) {
      readersPerTask = n;
      best = count;
    }
  }
  const counted = finished.filter((t) => t.readings.length === readersPerTask);
  excluded += finished.length - counted.length;

  // Answers: the campaign's order, then « cannot assess », then others.
  const seen = new Set<string>();
  for (const t of counted) for (const r of t.readings) seen.add(r.label);
  const labels: CampaignAgreement['labels'] = [];
  const listed = new Set<string>();
  for (const l of input.labels?.labels ?? []) {
    labels.push({ value: l.value, display: l.display });
    listed.add(l.value);
  }
  if (input.labels?.cannotAssess || seen.has(CANNOT_ASSESS_LABEL)) {
    labels.push({ value: CANNOT_ASSESS_LABEL, display: null });
    listed.add(CANNOT_ASSESS_LABEL);
  }
  for (const value of [...seen].filter((v) => !listed.has(v)).sort()) {
    labels.push({ value, display: null });
  }
  const column = new Map(labels.map((l, i) => [l.value, i]));

  // Per reader: their answer on each counted task, and their counts.
  const byReader = new Map<ReaderPseudonym, Map<number, string>>();
  let cannotAssessReadings = 0;
  counted.forEach((t, taskIndex) => {
    for (const r of t.readings) {
      let answers = byReader.get(r.reader);
      if (!answers) {
        answers = new Map();
        byReader.set(r.reader, answers);
      }
      answers.set(taskIndex, r.label);
      if (r.label === CANNOT_ASSESS_LABEL) cannotAssessReadings += 1;
    }
  });
  const readers = [...byReader.keys()].sort();

  const sentToArbitration = counted.filter((t) => t.sentToArbitration).length;
  const enough = counted.length >= AGREEMENT_MIN_TASKS;

  let overall: CampaignAgreement['overall'] = {
    status: 'too-few-tasks',
    fleissKappa: null,
    interval: null,
    percentAgreement: null,
    unanimousTasks: null,
  };
  if (readersPerTask === 1) {
    overall = { ...overall, status: 'single-reader' };
  } else if (enough && readersPerTask !== null) {
    const matrix = counted.map((t) => {
      const row = new Array<number>(Math.max(2, labels.length)).fill(0);
      for (const r of t.readings) {
        const j = column.get(r.label) ?? 0;
        // eslint-disable-next-line security/detect-object-injection -- numeric index from a local Map
        row[j] = (row[j] ?? 0) + 1;
      }
      return row;
    });
    const fleiss = fleissKappa(matrix);
    const unanimousTasks = counted.filter((t) =>
      t.readings.every((r) => r.label === t.readings[0]?.label),
    ).length;
    const defined = Number.isFinite(fleiss.kappa);
    const interval = defined ? fleissKappaBootstrap(matrix) : null;
    overall = {
      status: defined ? 'computed' : 'single-answer',
      fleissKappa: defined ? round4(fleiss.kappa) : null,
      interval: interval
        ? {
            lower: round4(interval.lower),
            upper: round4(interval.upper),
            level: interval.level,
            method: interval.method,
            resamples: interval.resamples,
            seed: interval.seed,
          }
        : null,
      percentAgreement: round4(fleiss.meanAgreement),
      unanimousTasks,
    };
  }

  const pairwise: PairwiseAgreement[] = [];
  for (const [a, ra] of readers.entries()) {
    for (const rb of readers.slice(a + 1)) {
      const answersA = byReader.get(ra) ?? new Map<number, string>();
      const answersB = byReader.get(rb) ?? new Map<number, string>();
      const xs: string[] = [];
      const ys: string[] = [];
      for (const [taskIndex, label] of answersA) {
        const other = answersB.get(taskIndex);
        if (other !== undefined) {
          xs.push(label);
          ys.push(other);
        }
      }
      if (xs.length === 0) continue;
      let status: AgreementCoefficientStatus = 'too-few-tasks';
      let kappa: number | null = null;
      let percent: number | null = null;
      if (xs.length >= AGREEMENT_MIN_TASKS) {
        const cohen = cohensKappa(xs, ys);
        percent = round4(cohen.observedAgreement);
        if (Number.isFinite(cohen.kappa)) {
          status = 'computed';
          kappa = round4(cohen.kappa);
        } else {
          status = 'single-answer';
        }
      }
      pairwise.push({
        readerA: ra,
        readerB: rb,
        sharedTasks: xs.length,
        cohensKappa: kappa,
        percentAgreement: percent,
        status,
      });
    }
  }

  const labelCountsByReader = readers.map((reader) => {
    const answers = [...(byReader.get(reader) ?? new Map<number, string>()).values()];
    return {
      reader,
      readings: answers.length,
      counts: labels.map((l) => ({
        label: l.value,
        count: answers.filter((x) => x === l.value).length,
      })),
    };
  });

  return {
    campaignSlug: input.campaignSlug,
    computedAt: (input.now ?? new Date()).toISOString(),
    minimumTasks: AGREEMENT_MIN_TASKS,
    tasks: {
      counted: counted.length,
      open,
      skipped,
      excluded,
      sentToArbitration,
      arbitrationShare: counted.length > 0 ? round4(sentToArbitration / counted.length) : null,
    },
    readersPerTask,
    readers: readers.length,
    labels,
    cannotAssess: { policy: 'own-answer', readings: cannotAssessReadings },
    overall,
    pairwise,
    labelCountsByReader,
  };
}

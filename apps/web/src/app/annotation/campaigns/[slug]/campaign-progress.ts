import type { AnnotationGateState, TaskSummary } from '@oci/shared-types';

/** Gate states in workflow order, for display. */
export const GATE_ORDER: readonly AnnotationGateState[] = [
  'INDEPENDENT',
  'AWAITING_ARBITRATION',
  'AWAITING_EXPERT',
  'COMPLETED',
  'SKIPPED',
];

export interface BurndownPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Tasks created on or before this day minus tasks completed on or before it. */
  remaining: number;
}

export interface CampaignProgress {
  total: number;
  counts: Record<AnnotationGateState, number>;
  /** `COMPLETED + SKIPPED`: tasks that need no more work. */
  done: number;
  /** `done / total`, in [0, 1]; 0 when there are no tasks. */
  doneShare: number;
  /** One point per UTC day from the first task's creation to `today`. Empty with no tasks. */
  burndown: BurndownPoint[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(iso: string | Date): string {
  return (typeof iso === 'string' ? new Date(iso) : iso).toISOString().slice(0, 10);
}

/**
 * Progress of a campaign's task pool (#556): counts per gate state,
 * the share done, and a daily burndown. Pure: `today` is passed in so
 * the result never depends on the clock.
 *
 * Days are UTC calendar days. A SKIPPED task counts as done and leaves
 * the burndown when it is skipped, since the API stamps `completedAt`
 * on skip as well as on completion.
 */
export function computeCampaignProgress(
  tasks: ReadonlyArray<Pick<TaskSummary, 'gateState' | 'createdAt' | 'completedAt'>>,
  today: Date,
): CampaignProgress {
  const counts: Record<AnnotationGateState, number> = {
    INDEPENDENT: 0,
    AWAITING_ARBITRATION: 0,
    AWAITING_EXPERT: 0,
    COMPLETED: 0,
    SKIPPED: 0,
  };
  for (const t of tasks) counts[t.gateState] += 1;

  const total = tasks.length;
  const done = counts.COMPLETED + counts.SKIPPED;
  if (total === 0) {
    return { total, counts, done, doneShare: 0, burndown: [] };
  }

  // Tally creations and completions per day, then walk the days once.
  const created = new Map<string, number>();
  const completed = new Map<string, number>();
  for (const t of tasks) {
    const c = utcDay(t.createdAt);
    created.set(c, (created.get(c) ?? 0) + 1);
    if (t.completedAt) {
      const d = utcDay(t.completedAt);
      completed.set(d, (completed.get(d) ?? 0) + 1);
    }
  }

  const todayDay = utcDay(today);
  // ISO day strings sort chronologically. Starting at the earliest event
  // of either kind means no completion is ever left uncounted.
  const startDay = [...created.keys(), ...completed.keys()].reduce(
    (a, b) => (b < a ? b : a),
    todayDay,
  );

  const burndown: BurndownPoint[] = [];
  let createdSoFar = 0;
  let completedSoFar = 0;
  // Events dated after `today` (clock skew) fold into the last day.
  const lateCreated = sumAfter(created, todayDay);
  const lateCompleted = sumAfter(completed, todayDay);
  for (let ms = Date.parse(startDay); ; ms += DAY_MS) {
    const day = utcDay(new Date(ms));
    createdSoFar += created.get(day) ?? 0;
    completedSoFar += completed.get(day) ?? 0;
    if (day === todayDay) {
      burndown.push({
        date: day,
        remaining: createdSoFar + lateCreated - (completedSoFar + lateCompleted),
      });
      break;
    }
    burndown.push({ date: day, remaining: createdSoFar - completedSoFar });
  }

  return { total, counts, done, doneShare: done / total, burndown };
}

function sumAfter(byDay: ReadonlyMap<string, number>, day: string): number {
  let sum = 0;
  for (const [d, n] of byDay) if (d > day) sum += n;
  return sum;
}

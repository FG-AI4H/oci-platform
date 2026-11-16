import type { AnnotationGateState, TaskSummary } from '@oci/shared-types';
import { GATE_ORDER, computeCampaignProgress, type BurndownPoint } from './campaign-progress';

const GATE_LABEL: Record<AnnotationGateState, string> = {
  INDEPENDENT: 'Independent',
  AWAITING_ARBITRATION: 'Arbitration',
  AWAITING_EXPERT: 'Expert review',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

const dayFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const pctFmt = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 });
const fmt = (n: number) => n.toLocaleString('en-GB');
const formatDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00.000Z`));

/**
 * Progress card on the campaign detail page (#556): counts per gate
 * state, the share done, and a burndown of remaining tasks per day.
 * Built from the task list the page already fetched; `today` is passed
 * in so the page decides the clock, not the card.
 */
export function ProgressCard({ tasks, today }: { tasks: ReadonlyArray<TaskSummary>; today: Date }) {
  const p = computeCampaignProgress(tasks, today);
  if (p.total === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">No tasks seeded yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{pctFmt.format(p.doneShare)}</span>{' '}
          done: <span className="tabular-nums">{fmt(p.done)}</span> of{' '}
          <span className="tabular-nums">{fmt(p.total)}</span> tasks (
          <span className="tabular-nums">{fmt(p.counts.COMPLETED)}</span> completed,{' '}
          <span className="tabular-nums">{fmt(p.counts.SKIPPED)}</span> skipped)
        </p>
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]"
          aria-hidden="true"
        >
          {/* Completed and skipped as two segments, so skips don't read as finished work. */}
          <div className="flex h-full">
            <div
              className="h-full bg-[var(--color-success)]"
              style={{ width: `${(p.counts.COMPLETED / p.total) * 100}%` }}
            />
            <div
              className="h-full bg-[var(--color-warning)]"
              style={{ width: `${(p.counts.SKIPPED / p.total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {GATE_ORDER.map((gate) => (
          <div key={gate} className="space-y-0.5">
            <dt className="text-xs text-[var(--color-muted-foreground)]">
              {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
              {GATE_LABEL[gate]}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {/* eslint-disable-next-line security/detect-object-injection -- typed enum key */}
              {fmt(p.counts[gate])}
            </dd>
          </div>
        ))}
      </dl>

      <Burndown points={p.burndown} total={p.total} />
    </div>
  );
}

// Chart geometry in viewBox units. The SVG stretches to the card width
// (preserveAspectRatio="none") and strokes stay crisp via
// vector-effect="non-scaling-stroke".
const W = 600;
const H = 160;

function Burndown({ points, total }: { points: BurndownPoint[]; total: number }) {
  const last = points.at(-1);
  const first = points.at(0);
  if (!last || !first) return null;

  const max = Math.max(1, ...points.map((pt) => pt.remaining));
  const x = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * W);
  const y = (remaining: number) => H - (remaining / max) * H;
  // A single day draws as a flat line across the chart.
  const coords =
    points.length === 1
      ? [`0,${y(first.remaining)}`, `${W},${y(first.remaining)}`]
      : points.map((pt, i) => `${x(i)},${y(pt.remaining)}`);
  const line = coords.join(' ');
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">Remaining tasks per day</figcaption>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div
          className="flex h-40 flex-col justify-between text-end text-xs tabular-nums text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        >
          <span>{fmt(max)}</span>
          <span>0</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Burndown: ${fmt(last.remaining)} of ${fmt(total)} tasks remaining on ${formatDay(last.date)}.`}
          className="h-40 w-full overflow-visible"
        >
          <line
            x1={0}
            y1={0}
            x2={W}
            y2={0}
            vectorEffect="non-scaling-stroke"
            className="stroke-[var(--color-border)]"
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            y1={H}
            x2={W}
            y2={H}
            vectorEffect="non-scaling-stroke"
            className="stroke-[var(--color-border)]"
          />
          <polygon points={area} className="fill-[var(--color-primary)]/15" />
          <polyline
            points={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-[var(--color-primary)]"
          />
        </svg>
        <div
          className="col-start-2 flex justify-between text-xs text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        >
          <span>{formatDay(first.date)}</span>
          {points.length > 1 ? <span>{formatDay(last.date)}</span> : null}
        </div>
      </div>

      <table className="sr-only">
        <caption>Remaining tasks per day, oldest first</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt) => (
            <tr key={pt.date}>
              <td>
                <time dateTime={pt.date}>{formatDay(pt.date)}</time>
              </td>
              <td>{fmt(pt.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

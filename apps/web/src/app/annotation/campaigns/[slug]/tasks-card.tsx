'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import type { AnnotationGateState, TaskSummary } from '@oci/shared-types';
import { seedTasksAction, type SeedTasksState } from './tasks-actions';

const initial: SeedTasksState = { status: 'idle' };

const GATE_LABEL: Record<AnnotationGateState, string> = {
  INDEPENDENT: 'Independent',
  AWAITING_ARBITRATION: 'Arbitration',
  AWAITING_EXPERT: 'Expert review',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

interface TasksCardProps {
  slug: string;
  /** Server-fetched task list. Empty when no tasks have been seeded yet. */
  tasks: ReadonlyArray<TaskSummary>;
  /** True when the campaign is RUNNING — the only state that accepts seed. */
  canSeed: boolean;
}

/**
 * Tasks card on the campaign detail page (#215 slice 2 web slice).
 *
 * Shows a per-gate breakdown of the campaign's task pool and, when
 * the caller is the campaign manager on a RUNNING campaign, exposes
 * a textarea to seed a new batch of sample refs. Mirrors the
 * TransitionActions UX so the page stays visually consistent.
 */
export function TasksCard({ slug, tasks, canSeed }: TasksCardProps) {
  const [state, formAction, pending] = useActionState(seedTasksAction, initial);

  const breakdown = countByGate(tasks);
  const total = tasks.length;

  // Compact summary row instead of a 6-tile grid — six Stat tiles
  // dominated the page on the first audit pass; a single line keeps
  // the breakdown visible without burying the table + seed form.
  const summary: Array<{ label: string; value: number }> = [
    { label: 'Total', value: total },
    { label: 'Independent', value: breakdown.INDEPENDENT },
    { label: 'Arbitration', value: breakdown.AWAITING_ARBITRATION },
    { label: 'Expert review', value: breakdown.AWAITING_EXPERT },
    { label: 'Completed', value: breakdown.COMPLETED },
    { label: 'Skipped', value: breakdown.SKIPPED },
  ];

  return (
    <div className="space-y-5">
      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        {summary.map((s, i) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <dt className="text-[var(--color-muted-foreground)]">{s.label}</dt>
            <dd className="font-semibold tabular-nums">{s.value}</dd>
            {i < summary.length - 1 ? (
              <span aria-hidden="true" className="text-[var(--color-muted-foreground)] ms-3">
                ·
              </span>
            ) : null}
          </div>
        ))}
      </dl>

      {total > 0 ? (
        <TasksTable tasks={tasks} />
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          No tasks seeded yet.{' '}
          {canSeed ? 'Paste sample references below to start the queue.' : null}
        </p>
      )}

      {canSeed ? (
        <form action={formAction} className="space-y-3 border-t border-[var(--color-border)] pt-5">
          <input type="hidden" name="slug" value={slug} />
          {state.status === 'success' ? (
            <Alert tone="success">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          {state.status === 'error' ? (
            <Alert tone="danger">
              <AlertTitle>Could not seed tasks</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          <Field
            label="Seed sample references"
            htmlFor="field-sample-refs"
            hint="One reference per line. Free-form strings today (e.g. dataset-slug/sample-001). The catalog ↔ annotation linkage (#223) will turn these into real S3 keys."
          >
            <Textarea
              id="field-sample-refs"
              name="sampleRefs"
              rows={6}
              maxLength={50_000}
              defaultValue={state.status === 'idle' ? '' : state.sampleRefs}
              placeholder="rsna-pneumonia-2018/sample-009&#10;rsna-pneumonia-2018/sample-010"
            />
          </Field>
          <div>
            <Button type="submit" disabled={pending} variant="primary">
              {pending ? 'Seeding…' : 'Seed tasks'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Tasks can only be seeded while the campaign is RUNNING.
        </p>
      )}
    </div>
  );
}

function TasksTable({ tasks }: { tasks: ReadonlyArray<TaskSummary> }) {
  // Render the first 25 — manager dashboards with full pagination
  // land with the supervisor inbox in slice 3.
  const head = tasks.slice(0, 25);
  return (
    <div
      // tabindex + role keep the table reachable via keyboard when it
      // overflows horizontally on narrow viewports (axe
      // scrollable-region-focusable). The aria-label is what a screen
      // reader announces when the region gains focus.
      tabIndex={0}
      role="region"
      aria-label="Annotation tasks"
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">Annotation tasks for this campaign</caption>
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <th scope="col" className="py-2 pr-4 font-medium">
              Sample
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Gate
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Annotators
            </th>
            <th scope="col" className="py-2 font-medium">
              Completed
            </th>
          </tr>
        </thead>
        <tbody>
          {head.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-border)] last:border-b-0">
              <td className="py-2 pr-4 font-mono text-xs">{t.sampleRef}</td>
              <td className="py-2 pr-4">{GATE_LABEL[t.gateState]}</td>
              <td className="py-2 pr-4 tabular-nums">{t.nAnnotatorsRequired}</td>
              <td className="py-2 text-xs text-[var(--color-muted-foreground)]">
                {t.completedAt
                  ? new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(t.completedAt))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length > head.length ? (
        <p className="pt-2 text-xs text-[var(--color-muted-foreground)]">
          Showing {head.length} of {tasks.length}. Full paginated dashboard lands with slice 3.
        </p>
      ) : null}
    </div>
  );
}

function countByGate(tasks: ReadonlyArray<TaskSummary>): Record<AnnotationGateState, number> {
  const out: Record<AnnotationGateState, number> = {
    INDEPENDENT: 0,
    AWAITING_ARBITRATION: 0,
    AWAITING_EXPERT: 0,
    COMPLETED: 0,
    SKIPPED: 0,
  };
  for (const t of tasks) out[t.gateState] += 1;
  return out;
}

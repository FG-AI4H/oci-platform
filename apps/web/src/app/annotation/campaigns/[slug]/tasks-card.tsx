'use client';

import { useActionState } from 'react';
import { Alert, AlertDescription, AlertTitle, Button, Field, Stat, Textarea } from '@oci/ui';
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

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total tasks" value={total.toString()} />
        <Stat label="Independent" value={breakdown.INDEPENDENT.toString()} />
        <Stat label="Arbitration" value={breakdown.AWAITING_ARBITRATION.toString()} />
        <Stat label="Expert review" value={breakdown.AWAITING_EXPERT.toString()} />
        <Stat label="Completed" value={breakdown.COMPLETED.toString()} />
        <Stat label="Skipped" value={breakdown.SKIPPED.toString()} />
      </div>

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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <th className="py-2 pr-4 font-medium">Sample</th>
            <th className="py-2 pr-4 font-medium">Gate</th>
            <th className="py-2 pr-4 font-medium">N required</th>
            <th className="py-2 font-medium">Completed</th>
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

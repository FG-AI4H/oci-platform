'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, Button, Field, Textarea } from '@oci/ui';
import type { AnnotationGateState, TaskSummary } from '@oci/shared-types';
import { useFormatters } from '../../../../i18n/client';
import { SeedFromDatasetForm } from './seed-from-dataset-form';
import { seedTasksAction, type SeedTasksState } from './tasks-actions';

const initial: SeedTasksState = { status: 'idle' };

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
  const t = useTranslations('Campaign');
  const [state, formAction, pending] = useActionState(seedTasksAction, initial);

  const breakdown = countByGate(tasks);
  const total = tasks.length;

  // Compact summary row instead of a 6-tile grid — six Stat tiles
  // dominated the page on the first audit pass; a single line keeps
  // the breakdown visible without burying the table + seed form.
  const summary: Array<{ label: string; value: number }> = [
    { label: t('tasks.total'), value: total },
    { label: t('gate.INDEPENDENT'), value: breakdown.INDEPENDENT },
    { label: t('gate.AWAITING_ARBITRATION'), value: breakdown.AWAITING_ARBITRATION },
    { label: t('gate.AWAITING_EXPERT'), value: breakdown.AWAITING_EXPERT },
    { label: t('gate.COMPLETED'), value: breakdown.COMPLETED },
    { label: t('gate.SKIPPED'), value: breakdown.SKIPPED },
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
          {t('tasks.noTasks')} {canSeed ? t('tasks.noTasksCanSeed') : null}
        </p>
      )}

      {canSeed ? (
        <div className="border-t border-[var(--color-border)] pt-5">
          <SeedFromDatasetForm slug={slug} />
        </div>
      ) : null}

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
              <AlertTitle>{t('tasks.couldNotSeed')}</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          <Field
            label={t('tasks.seedLabel')}
            htmlFor="field-sample-refs"
            hint={t('tasks.seedHint')}
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
              {pending ? t('tasks.seeding') : t('tasks.seed')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-[var(--color-muted-foreground)]">{t('tasks.onlyRunning')}</p>
      )}
    </div>
  );
}

function TasksTable({ tasks }: { tasks: ReadonlyArray<TaskSummary> }) {
  const t = useTranslations('Campaign');
  const fmt = useFormatters();
  // Render the first 25 — manager dashboards with full pagination
  // land with the supervisor inbox in slice 3.
  const head = tasks.slice(0, 25);
  return (
    <div className="space-y-2">
      <div
        // The table scrolls inside a capped height (and horizontally on
        // narrow viewports) so a long list doesn't push the rest of the
        // page down. tabindex + role keep it reachable via keyboard (axe
        // scrollable-region-focusable); the aria-label is what a screen
        // reader announces when the region gains focus.
        tabIndex={0}
        role="region"
        aria-label={t('tasks.tableRegion')}
        className="max-h-96 overflow-auto overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">{t('tasks.tableCaption')}</caption>
          <thead>
            {/* Header stays visible while the rows scroll. */}
            <tr className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-card)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('tasks.sample')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('tasks.gate')}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t('tasks.submissions')}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t('tasks.completedColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {head.map((task) => (
              <tr key={task.id} className="border-b border-[var(--color-border)] last:border-b-0">
                <td className="py-2 pr-4 font-mono text-xs">{task.sampleRef}</td>
                <td className="py-2 pr-4">{t(`gate.${task.gateState}`)}</td>
                <td className="py-2 pr-4 tabular-nums">
                  <SubmissionsCell task={task} />
                </td>
                <td className="py-2 text-xs text-[var(--color-muted-foreground)]">
                  {task.completedAt
                    ? fmt.dateTime(task.completedAt, { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.length > head.length ? (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {t('tasks.showing', { shown: head.length, total: tasks.length })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Per-task submission progress. For tasks at INDEPENDENT or
 * AWAITING_ARBITRATION the count needs to reach `nAnnotatorsRequired`
 * (independent) or 1 (arbitration / expert) before the gate advances;
 * we surface `n/N` and `n/1` respectively so the manager sees what's
 * landed at the CURRENT gate, even when the lifetime task isn't done.
 *
 * COMPLETED / SKIPPED tasks show a single dash — the count is meaningless
 * (the task ended; we don't reset the counter visually).
 */
function SubmissionsCell({ task }: { task: TaskSummary }) {
  const t = useTranslations('Campaign');
  if (task.gateState === 'COMPLETED' || task.gateState === 'SKIPPED') {
    return <span className="text-[var(--color-muted-foreground)]">—</span>;
  }
  const required = task.gateState === 'INDEPENDENT' ? task.nAnnotatorsRequired : 1;
  return (
    <span aria-label={t('tasks.submittedOf', { submitted: task.submittedCount, required })}>
      {task.submittedCount}{' '}
      <span className="text-[var(--color-muted-foreground)]">/ {required}</span>
    </span>
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

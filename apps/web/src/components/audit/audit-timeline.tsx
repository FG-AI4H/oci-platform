import type { AuditEventView } from '@oci/shared-types';
import {
  AUDIT_LABELS_EN,
  actorText,
  formatOccurredAt,
  payloadText,
  shortHash,
  type AuditLabels,
} from './audit-format';

interface Props {
  /** The events of one object, oldest first (`order=asc`). */
  events: readonly AuditEventView[];
  /** Words to print; English when absent. */
  labels?: AuditLabels;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

/**
 * The audit trail of one object, as a timeline (#653).
 *
 * A server component with no data fetching of its own: the page reads
 * `GET /v2/audit/events?subjectType=…&subjectId=…&order=asc` and passes
 * the events. Used on `/admin/audit`; written to be reused by the
 * submission page and the evidence summary, which pass their own
 * labels.
 */
export function AuditTimeline({ events, labels = AUDIT_LABELS_EN, label, className }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{labels.empty}</p>;
  }
  return (
    <ol
      aria-label={label ?? labels.timeline}
      className={`relative space-y-4 border-l border-[var(--color-border)] pl-5 ${className ?? ''}`}
    >
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-card)] bg-[var(--color-primary)]"
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <time dateTime={event.occurredAt} className="text-sm tabular-nums">
              {formatOccurredAt(event.occurredAt)}
            </time>
            <code className="break-all text-sm font-medium">{event.eventType}</code>
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {labels.actor}: <span className="break-all">{actorText(event.actor, labels)}</span>
            {event.actorRoles.length > 0 ? (
              <>
                {' · '}
                {labels.roles}: {event.actorRoles.join(', ')}
              </>
            ) : null}
            {' · '}
            {labels.sequence} {event.sequenceNumber}
          </p>
          <AuditEventDetails event={event} labels={labels} />
        </li>
      ))}
    </ol>
  );
}

/** The hashes and the payload of one event, folded. */
export function AuditEventDetails({
  event,
  labels = AUDIT_LABELS_EN,
}: {
  event: AuditEventView;
  labels?: AuditLabels;
}) {
  return (
    <details className="mt-2 rounded-md border border-[var(--color-border)] text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]">
        {labels.details}
        <span className="ml-2 font-normal text-[var(--color-muted-foreground)]">
          {shortHash(event.recordHash)}
        </span>
      </summary>
      <dl className="grid gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-3 py-2 sm:grid-cols-[max-content_1fr]">
        <dt className="text-[var(--color-muted-foreground)]">{labels.object}</dt>
        <dd className="break-all">
          {event.subjectType} · {event.subjectId}
        </dd>
        <dt className="text-[var(--color-muted-foreground)]">{labels.recordHash}</dt>
        <dd className="break-all font-mono text-xs">{event.recordHash}</dd>
        <dt className="text-[var(--color-muted-foreground)]">{labels.previousHash}</dt>
        <dd className="break-all font-mono text-xs">{event.previousHash ?? labels.noPrevious}</dd>
        <dt className="text-[var(--color-muted-foreground)]">{labels.payloadHash}</dt>
        <dd className="break-all font-mono text-xs">{event.payloadHash}</dd>
      </dl>
      <div className="border-t border-[var(--color-border)] px-3 py-2">
        <p className="mb-1 text-[var(--color-muted-foreground)]">{labels.payload}</p>
        <pre className="max-h-64 overflow-auto rounded bg-[var(--color-muted)] p-2 text-xs">
          {payloadText(event.payload)}
        </pre>
        {event.pseudonymised.length > 0 ? (
          <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
            {labels.pseudonymisedNote} ({event.pseudonymised.join(', ')})
          </p>
        ) : null}
      </div>
    </details>
  );
}

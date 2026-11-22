import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Button,
  Container,
  Field,
  Input,
  Section,
} from '@oci/ui';
import {
  AuditEventsQuerySchema,
  type AuditActorView,
  type AuditEventPage,
  type AuditEventView,
} from '@oci/shared-types';
import { auth } from '../../../auth';
import { AuditEventDetails, AuditTimeline } from '../../../components/audit/audit-timeline';
import { actorText, formatOccurredAt } from '../../../components/audit/audit-format';
import { fetchAsUser } from '../../../lib/api-action';
import { isAdmin, requireAuditReader } from '../../../lib/groups';
import {
  apiQuery,
  pageQuery,
  readCursor,
  readFilters,
  utcInstant,
  type PageFilters,
} from './filters';
import { AUDIT_PAGE as T } from './strings';
import { VerifyChain } from './verify-chain';

export const metadata = {
  title: T.metaTitle,
  robots: { index: false, follow: false },
};

const LINK =
  'rounded font-medium text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

const TIMELINE_LIMIT = 200;

type Loaded =
  | { kind: 'ok'; page: AuditEventPage }
  | { kind: 'invalid'; messages: string[] }
  | { kind: 'failed' };

/**
 * `/admin/audit` — the audit trail, for `admin` and `regulator` (#653).
 *
 * The list with its filters, the exports, and "Verify chain". With an
 * object type and an object id, the page shows that object's timeline.
 * An `admin` sees who acted; a `regulator` sees pseudonyms (the API
 * decides, from the caller's token).
 */
export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = requireAuditReader(await auth());
  const params = await searchParams;
  const filters = readFilters(params);
  const cursor = readCursor(params);
  const objectView = filters.subjectType !== undefined && filters.subjectId !== undefined;

  const loaded = await load(filters, objectView ? undefined : cursor, objectView);
  const actorView: AuditActorView =
    loaded.kind === 'ok' ? loaded.page.actorView : isAdmin(session) ? 'identified' : 'pseudonymous';

  return (
    <Container size="lg">
      <Section spacing="md">
        {isAdmin(session) ? (
          <Link
            href="/admin"
            className={`mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm sm:min-h-6 ${LINK}`}
          >
            <ArrowLeftIcon size={14} />
            {T.back}
          </Link>
        ) : null}
        <header className="mb-8 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            {T.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{T.title}</h1>
          <p className="max-w-prose text-[var(--color-muted-foreground)]">
            {T.intro} {actorView === 'pseudonymous' ? T.introRegulator : null}
            {actorView === 'withheld' ? T.introWithheld : null}
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <aside className="space-y-8 lg:order-2">
            <section aria-labelledby="verify-heading" className="space-y-3">
              <h2 id="verify-heading" className="text-lg font-semibold">
                {T.verifyHeading}
              </h2>
              <p className="text-sm text-[var(--color-muted-foreground)]">{T.verifyIntro}</p>
              <VerifyChain />
            </section>
            <section aria-labelledby="export-heading" className="space-y-3">
              <h2 id="export-heading" className="text-lg font-semibold">
                {T.exportHeading}
              </h2>
              <p className="text-sm text-[var(--color-muted-foreground)]">{T.exportIntro}</p>
              <div className="flex flex-wrap gap-2">
                {/* Plain links, never prefetched: each request is a recorded export. */}
                <Button asChild variant="secondary" size="sm">
                  <a href={`/admin/audit/export${pageQuery(filters, { format: 'csv' })}`} download>
                    {T.exportCsv}
                  </a>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <a href={`/admin/audit/export${pageQuery(filters, { format: 'json' })}`} download>
                    {T.exportJson}
                  </a>
                </Button>
              </div>
            </section>
          </aside>
          <div className="min-w-0 space-y-8 lg:order-1">
            <FilterForm filters={filters} actorView={actorView} />
            {objectView ? (
              <ObjectTimeline filters={filters} loaded={loaded} />
            ) : (
              <EventList filters={filters} cursor={cursor} loaded={loaded} />
            )}
          </div>
        </div>
      </Section>
    </Container>
  );
}

async function load(
  filters: PageFilters,
  cursor: string | undefined,
  objectView: boolean,
): Promise<Loaded> {
  const extra: Record<string, string> = objectView
    ? { order: 'asc', limit: String(TIMELINE_LIMIT) }
    : { order: 'desc', limit: '50' };
  if (cursor) extra.cursor = cursor;

  // The API's own schema first, so a typing mistake reads as one.
  const check = AuditEventsQuerySchema.safeParse({
    ...filters,
    from: filters.from ? utcInstant(filters.from) : undefined,
    to: filters.to ? utcInstant(filters.to) : undefined,
    ...extra,
  });
  if (!check.success) {
    return {
      kind: 'invalid',
      messages: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { kind: 'failed' };
  try {
    const res = await fetchAsUser(
      `${base}/v2/audit/events?${apiQuery(filters, extra)}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' },
      { returnTo: `/admin/audit${pageQuery(filters)}`, rendering: true },
    );
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
      const message = typeof body?.message === 'string' ? body.message : T.invalid;
      return { kind: 'invalid', messages: [message] };
    }
    if (!res.ok) return { kind: 'failed' };
    return { kind: 'ok', page: (await res.json()) as AuditEventPage };
  } catch (err) {
    unstable_rethrow(err);
    return { kind: 'failed' };
  }
}

function FilterForm({ filters, actorView }: { filters: PageFilters; actorView: AuditActorView }) {
  return (
    <section aria-labelledby="filters-heading" className="space-y-4">
      <h2 id="filters-heading" className="text-lg font-semibold">
        {T.filtersHeading}
      </h2>
      <form method="get" action="/admin/audit" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={T.subjectType} htmlFor="f-subjectType" hint={T.subjectTypeHint}>
            <Input id="f-subjectType" name="subjectType" defaultValue={filters.subjectType ?? ''} />
          </Field>
          <Field label={T.subjectId} htmlFor="f-subjectId">
            <Input id="f-subjectId" name="subjectId" defaultValue={filters.subjectId ?? ''} />
          </Field>
          <Field
            label={T.actor}
            htmlFor="f-actor"
            hint={actorView === 'identified' ? T.actorHintAdmin : T.actorHintRegulator}
          >
            <Input id="f-actor" name="actor" defaultValue={filters.actor ?? ''} />
          </Field>
          <Field label={T.action} htmlFor="f-action" hint={T.actionHint}>
            <Input id="f-action" name="action" defaultValue={filters.action ?? ''} />
          </Field>
          <Field label={T.from} htmlFor="f-from">
            <Input
              id="f-from"
              name="from"
              type="datetime-local"
              defaultValue={filters.from ?? ''}
            />
          </Field>
          <Field label={T.to} htmlFor="f-to">
            <Input id="f-to" name="to" type="datetime-local" defaultValue={filters.to ?? ''} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">{T.apply}</Button>
          <Link
            href="/admin/audit"
            className={`inline-flex min-h-11 items-center text-sm sm:min-h-6 ${LINK}`}
          >
            {T.clear}
          </Link>
        </div>
      </form>
    </section>
  );
}

function Problem({ loaded }: { loaded: Exclude<Loaded, { kind: 'ok' }> }) {
  if (loaded.kind === 'invalid') {
    return (
      <Alert tone="warning">
        <AlertTitle as="h3">{T.invalid}</AlertTitle>
        <AlertDescription>
          {loaded.messages.map((m) => (
            <span key={m} className="block">
              {m}
            </span>
          ))}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert tone="danger">
      <AlertDescription>{T.unavailable}</AlertDescription>
    </Alert>
  );
}

function ObjectTimeline({ filters, loaded }: { filters: PageFilters; loaded: Loaded }) {
  const { subjectType = '', subjectId = '' } = filters;
  return (
    <section aria-labelledby="object-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="object-heading" className="min-w-0 break-all text-lg font-semibold">
          {T.objectHeading(subjectType, subjectId)}
        </h2>
        <Link href="/admin/audit" className={`text-sm ${LINK}`}>
          {T.objectBack}
        </Link>
      </div>
      {loaded.kind !== 'ok' ? (
        <Problem loaded={loaded} />
      ) : (
        <>
          <AuditTimeline events={loaded.page.events} />
          {loaded.page.nextCursor ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{T.truncatedTimeline}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function EventList({
  filters,
  cursor,
  loaded,
}: {
  filters: PageFilters;
  cursor: string | undefined;
  loaded: Loaded;
}) {
  return (
    <section aria-labelledby="list-heading" className="space-y-4">
      <h2 id="list-heading" className="text-lg font-semibold">
        {T.listHeading}
      </h2>
      {loaded.kind !== 'ok' ? (
        <Problem loaded={loaded} />
      ) : loaded.page.events.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{T.none}</p>
      ) : (
        <ol className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {loaded.page.events.map((event) => (
            <EventRow key={event.id} event={event} filters={filters} />
          ))}
        </ol>
      )}
      <nav aria-label="Pages" className="flex flex-wrap gap-4 text-sm">
        {cursor ? (
          <Link href={`/admin/audit${pageQuery(filters)}`} className={LINK}>
            {T.newestAgain}
          </Link>
        ) : null}
        {loaded.kind === 'ok' && loaded.page.nextCursor ? (
          <Link
            href={`/admin/audit${pageQuery(filters, { cursor: loaded.page.nextCursor })}`}
            className={LINK}
          >
            {T.older}
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

function EventRow({ event, filters }: { event: AuditEventView; filters: PageFilters }) {
  const timeline = pageQuery({
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  });
  return (
    <li className="space-y-1 p-4" data-testid="audit-event">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm tabular-nums text-[var(--color-muted-foreground)]">
          {T.colSequence} {event.sequenceNumber}
        </span>
        <time dateTime={event.occurredAt} className="text-sm tabular-nums">
          {formatOccurredAt(event.occurredAt)}
        </time>
        <code className="break-all text-sm font-medium">{event.eventType}</code>
      </div>
      <p className="text-sm">
        <span className="text-[var(--color-muted-foreground)]">{T.colObject}: </span>
        <Link
          href={`/admin/audit${timeline}`}
          aria-label={T.openTimeline(event.subjectType, event.subjectId)}
          className={`break-all ${LINK}`}
        >
          {event.subjectType} · {event.subjectId}
        </Link>
      </p>
      <p className="text-sm">
        <span className="text-[var(--color-muted-foreground)]">{T.colActor}: </span>
        <span className="break-all">{actorText(event.actor)}</span>
      </p>
      <AuditEventDetails event={event} />
    </li>
  );
}

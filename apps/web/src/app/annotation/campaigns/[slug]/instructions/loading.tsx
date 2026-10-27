import { Card, CardContent, CardHeader, Container, Section } from '@oci/ui';

const bar = 'rounded bg-[var(--color-muted)] motion-safe:animate-pulse';

/**
 * Loading state for the instructions page (#555). Mirrors the page's
 * header and the current-version card so the content swaps in without
 * shifting the layout.
 */
export default function Loading() {
  return (
    <Container size="md">
      <Section spacing="md">
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading instructions…</span>
          <header className="mb-6 space-y-3" aria-hidden="true">
            {/* back link, eyebrow, h1, description */}
            <div className={`h-5 w-40 ${bar}`} />
            <div className={`h-4 w-36 ${bar}`} />
            <div className={`h-9 sm:h-10 w-56 max-w-full ${bar}`} />
            <div className="flex max-w-prose flex-col gap-2">
              <div className={`h-5 w-full ${bar}`} />
              <div className={`h-5 w-1/2 ${bar}`} />
              {/* the description wraps one line further on narrow screens */}
              <div className={`h-4 w-1/3 sm:hidden ${bar}`} />
            </div>
          </header>
          <Card aria-hidden="true">
            <CardHeader className="space-y-2">
              <div className={`h-6 w-64 max-w-full ${bar}`} />
              <div className={`h-4 w-40 ${bar}`} />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-5 w-full ${bar}`} />
              ))}
              <div className={`h-5 w-2/3 ${bar}`} />
            </CardContent>
          </Card>
        </div>
      </Section>
    </Container>
  );
}

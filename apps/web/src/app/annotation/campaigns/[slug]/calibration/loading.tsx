import { Card, CardContent, CardHeader, Container, Section } from '@oci/ui';

const bar = 'rounded bg-[var(--color-muted)] motion-safe:animate-pulse';

/**
 * Loading state for the calibration-flags inbox (#554). Mirrors the
 * page's header and table card so the real content swaps in without
 * shifting the layout.
 */
export default function Loading() {
  return (
    <Container size="md">
      <Section spacing="md">
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading calibration flags…</span>
          <header className="mb-6 space-y-3" aria-hidden="true">
            {/* back link, eyebrow, h1, description */}
            <div className={`h-5 w-40 ${bar}`} />
            <div className={`h-4 w-36 ${bar}`} />
            <div className={`h-9 sm:h-10 w-72 max-w-full ${bar}`} />
            <div className="flex max-w-prose flex-col gap-2">
              <div className={`h-5 w-full ${bar}`} />
              <div className={`h-5 w-2/3 ${bar}`} />
              {/* the description wraps one line further on narrow screens */}
              <div className={`h-4 w-1/2 sm:hidden ${bar}`} />
            </div>
          </header>
          <Card aria-hidden="true">
            <CardHeader>
              <div className={`h-6 w-32 ${bar}`} />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* table header row + rows, then the legend line */}
              {[0, 1, 2].map((i) => (
                <div key={i} className={`h-7 w-full ${bar}`} />
              ))}
              <div className={`h-4 w-3/4 ${bar}`} />
              {/* the legend wraps to two lines on narrow screens */}
              <div className={`h-4 w-1/2 sm:hidden ${bar}`} />
            </CardContent>
          </Card>
        </div>
      </Section>
    </Container>
  );
}

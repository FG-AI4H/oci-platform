import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InstructionsMediaRef } from '@oci/shared-types';

const linkClass =
  'text-[var(--color-primary)] underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';

/**
 * Markdown headings sit under the page's h1 and the card's h2, so they
 * shift down two levels to keep the document outline intact.
 */
const components: Components = {
  h1: ({ node: _node, ...props }) => <h3 className="mt-6 text-xl font-semibold" {...props} />,
  h2: ({ node: _node, ...props }) => <h4 className="mt-5 text-lg font-semibold" {...props} />,
  h3: ({ node: _node, ...props }) => <h5 className="mt-4 text-base font-semibold" {...props} />,
  h4: ({ node: _node, ...props }) => <h6 className="mt-4 text-sm font-semibold" {...props} />,
  h5: ({ node: _node, ...props }) => <h6 className="mt-4 text-sm font-semibold" {...props} />,
  h6: ({ node: _node, ...props }) => <h6 className="mt-4 text-sm font-semibold" {...props} />,
  p: ({ node: _node, ...props }) => <p className="mt-3 leading-relaxed" {...props} />,
  // remark-gfm marks task lists with `contains-task-list`; they show
  // their checkboxes instead of bullets.
  ul: ({ node: _node, className, ...props }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'mt-3 list-none space-y-1 ps-1'
          : 'mt-3 list-disc space-y-1 ps-6'
      }
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => <ol className="mt-3 list-decimal space-y-1 ps-6" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="mt-3 border-s-4 border-[var(--color-border)] ps-4 text-[var(--color-muted-foreground)]"
      {...props}
    />
  ),
  code: ({ node: _node, ...props }) => (
    <code
      className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-[0.9em]"
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="mt-3 overflow-x-auto rounded-md bg-[var(--color-muted)] p-3 text-sm [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  hr: () => <hr className="my-6 border-[var(--color-border)]" />,
  // GFM tables scroll on narrow screens; the wrapper is focusable so
  // keyboard users can scroll it (axe `scrollable-region-focusable`).
  table: ({ node: _node, ...props }) => (
    <div
      tabIndex={0}
      role="region"
      aria-label="Table"
      className="mt-3 overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => (
    <th
      className="border-b border-[var(--color-border)] py-2 pe-4 text-start font-medium"
      style={style?.textAlign ? { textAlign: style.textAlign } : undefined}
      {...props}
    />
  ),
  td: ({ node: _node, style, ...props }) => (
    <td
      className="border-b border-[var(--color-border)] py-2 pe-4 align-top"
      style={style?.textAlign ? { textAlign: style.textAlign } : undefined}
      {...props}
    />
  ),
  // Task-list checkboxes are read-only and need an accessible name.
  input: ({ node: _node, checked, ...props }) => (
    <input
      {...props}
      checked={checked}
      disabled
      aria-label={checked ? 'Done' : 'Not done'}
      className="me-2 align-middle"
    />
  ),
  // Instructions are user content: every link leaves the platform in a
  // new tab without handing it `window.opener` or the referrer.
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  ),
  img: ({ node: _node, alt, ...props }) => (
    <img {...props} alt={alt ?? ''} loading="lazy" className="mt-3 max-w-full rounded-md" />
  ),
};

/**
 * Renders a published instructions body and its media, with GitHub
 * Flavored Markdown (tables, task lists, strikethrough, autolinks).
 * Raw HTML in the markdown is escaped, never rendered: there is
 * deliberately no `rehype-raw`, and react-markdown's default URL transform drops
 * `javascript:` and other unsafe link targets.
 */
export function InstructionsContent({
  markdownBody,
  mediaUrls: allMedia,
}: {
  markdownBody: string;
  mediaUrls: InstructionsMediaRef[];
}) {
  // The schema only accepts https, but rows published before it did
  // may hold other schemes; they go straight into `src`, so skip them.
  const mediaUrls = allMedia.filter((m) => isHttps(m.url));
  return (
    <div className="space-y-6">
      <div className="min-w-0 break-words text-[var(--color-foreground)] [&>*:first-child]:mt-0">
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {markdownBody}
        </Markdown>
      </div>
      {mediaUrls.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Instruction media">
          {mediaUrls.map((m, i) => (
            <li key={`${i}-${m.url}`}>
              <figure className="space-y-2">
                {m.kind === 'image' ? (
                  // The figcaption already names a captioned image; repeating
                  // it in alt would be read twice.
                  <img
                    src={m.url}
                    alt={m.caption ? '' : `Instruction image ${i + 1}`}
                    loading="lazy"
                    className="w-full rounded-md border border-[var(--color-border)]"
                  />
                ) : (
                  <video
                    src={m.url}
                    controls
                    preload="metadata"
                    aria-label={m.caption ?? 'Instruction video'}
                    className="w-full rounded-md border border-[var(--color-border)]"
                  />
                )}
                {m.caption ? (
                  <figcaption className="text-sm text-[var(--color-muted-foreground)]">
                    {m.caption}
                  </figcaption>
                ) : null}
              </figure>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

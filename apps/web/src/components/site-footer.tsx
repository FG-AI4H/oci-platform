/**
 * Footer — single line of attribution + environment + commit-ish info.
 * Kept intentionally quiet so it doesn't compete with content.
 */
export function SiteFooter() {
  const env = process.env.OCI_ENV ?? 'local';

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <p>
          OCI Platform — Open Code Infrastructure for the{' '}
          <abbr title="ITU-WHO-WIPO Global Initiative on AI for Health">GI-AI4H</abbr>.
        </p>
        <p className="font-mono">
          env: <span className="text-[var(--color-foreground)]">{env}</span>
        </p>
      </div>
    </footer>
  );
}

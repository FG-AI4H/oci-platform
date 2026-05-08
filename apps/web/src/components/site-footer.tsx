import Link from 'next/link';
import { BrandMark } from './brand-mark';

/**
 * Footer — multi-column with provenance, navigation, and quiet env
 * info. Designed to read as institutional (think regulator portal,
 * not consumer SaaS) so it earns trust at a glance for first-time
 * visitors arriving from a Google Dataset Search hit.
 */
export function SiteFooter() {
  const env = process.env.OCI_ENV ?? 'local';
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-[var(--color-border)] bg-[var(--color-subtle)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-4 sm:px-6">
        <div className="sm:col-span-2 space-y-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
          >
            <BrandMark size={26} className="text-[var(--color-primary)]" />
            <span className="font-semibold tracking-tight text-[var(--color-foreground)]">
              OCI Platform
            </span>
          </Link>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            Open Code Infrastructure for the{' '}
            <abbr
              title="ITU-WHO-WIPO Global Initiative on AI for Health"
              className="cursor-help underline decoration-dotted underline-offset-2"
            >
              GI-AI4H
            </abbr>
            . A unified surface for cataloguing health data, coordinating annotation, evaluating
            models, and publishing reproducible reports.
          </p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Convened by ITU · WHO · WIPO.
          </p>
        </div>

        <FooterColumn title="Platform">
          <FooterLink href="/catalog">Catalog</FooterLink>
          <FooterLink href="/dashboard">Dashboard</FooterLink>
        </FooterColumn>

        <FooterColumn title="Resources">
          <FooterLink href="https://github.com/FG-AI4H/oci-platform" external>
            Source on GitHub
          </FooterLink>
          <FooterLink href="https://www.itu.int/go/ai4h" external>
            ITU FG-AI4H
          </FooterLink>
          <FooterLink href="https://mlcommons.org/datasets/" external>
            Croissant 1.1
          </FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-[var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {year} OCI Platform contributors. BSD-3-Clause licensed.</p>
          <p className="font-mono">
            env: <span className="text-[var(--color-foreground)]">{env}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-foreground)]">
        {title}
      </h3>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const baseClass =
    'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] rounded';
  if (external) {
    return (
      <li>
        <a href={href} target="_blank" rel="noreferrer" className={baseClass}>
          {children}
          <span aria-hidden="true"> ↗</span>
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={href} className={baseClass}>
        {children}
      </Link>
    </li>
  );
}

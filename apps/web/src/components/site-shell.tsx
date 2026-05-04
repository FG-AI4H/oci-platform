import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';
import { SiteFooter } from './site-footer';

/**
 * Page shell — wraps every route with header + main + footer and
 * enforces the global content width. Keep this thin: per-route layout
 * decisions belong in the route's own page or a route-group layout.
 */
export async function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

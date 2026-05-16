import type { ReactNode } from 'react';
import { MaintenanceBanner } from './maintenance-banner';
import { SiteHeader } from './site-header';
import { SiteFooter } from './site-footer';

/**
 * Page shell — wraps every route with header + main + footer and
 * enforces the global content width. Keep this thin: per-route layout
 * decisions belong in the route's own page or a route-group layout.
 *
 * The `MaintenanceBanner` floats above the header so it's the first
 * thing every visitor sees during an incident or scheduled window. It
 * server-renders (60s cache) and returns `null` when no banner is
 * active, so there's zero layout cost in the steady state.
 */
export async function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <MaintenanceBanner />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

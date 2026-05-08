import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SiteShell } from '../components/site-shell';
import { siteUrl } from '../lib/site-url';
import { readThemeCookie, themeAttr } from '../lib/theme-cookie';
import './globals.css';

/**
 * Inter Variable — self-hosted via next/font, with global subsets so the
 * UI renders cleanly across Latin, Cyrillic, and Greek scripts (matches
 * GI-AI4H's reach). Variable axis lets us request weights without
 * downloading multiple files.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'OCI Platform — ITU/WHO/WIPO',
  description:
    'Open Code Infrastructure — unified platform for benchmarking and assessing health AI under the ITU-WHO-WIPO Global Initiative on AI for Health (GI-AI4H).',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the saved dark-mode preference at SSR so the right palette is
  // baked into the first paint — no FOUC flash from light-by-default
  // hydrating to dark a frame later.
  const dataTheme = themeAttr(await readThemeCookie());
  return (
    <html
      lang="en"
      className={inter.variable}
      suppressHydrationWarning
      {...(dataTheme ? { 'data-theme': dataTheme } : {})}
    >
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}

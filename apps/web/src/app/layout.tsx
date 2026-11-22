import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { SiteShell } from '../components/site-shell';
import { clientMessages } from '../i18n/client-namespaces';
import type { Messages } from '../i18n/messages/en';
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Common');
  return {
    metadataBase: new URL(siteUrl()),
    title: t('siteTitle'),
    description: t('siteDescription'),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the saved dark-mode preference at SSR so the right palette is
  // baked into the first paint — no FOUC flash from light-by-default
  // hydrating to dark a frame later.
  const dataTheme = themeAttr(await readThemeCookie());
  // The interface language (#654): preference, cookie, Accept-Language,
  // English. The client gets only the namespaces its components read.
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html
      lang={locale}
      className={inter.variable}
      suppressHydrationWarning
      {...(dataTheme ? { 'data-theme': dataTheme } : {})}
    >
      <body>
        <NextIntlClientProvider messages={clientMessages(messages as Messages)}>
          <SiteShell>{children}</SiteShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

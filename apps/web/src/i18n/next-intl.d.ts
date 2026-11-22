import type { AppLocale } from './locales';
import type { Messages } from './messages/en';

/**
 * Type-safe keys (#654): `t('…')` only accepts keys that exist in the
 * English catalogue, and `useLocale()` / `getLocale()` return one of
 * the interface languages.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}

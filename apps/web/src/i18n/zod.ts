import { z } from 'zod';
import type { AppLocale } from './locales';

const french = z.locales.fr();

/**
 * Parse options that put Zod's own messages ("Too small: expected
 * string to have >=1 characters") in the interface language (#654).
 * Per parse, not `z.config()`: the server renders requests in both
 * languages at once, and a global setting would leak between them.
 * English keeps Zod's defaults, so English messages read as before.
 * Messages a schema states itself stay as written.
 */
export function zodParseParams(
  locale: AppLocale,
): { error: typeof french.localeError } | undefined {
  return locale === 'fr' ? { error: french.localeError } : undefined;
}

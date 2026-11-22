import { intlLocale, type AppLocale } from './locales';

/**
 * Dates and numbers in the interface language (#654): the one place
 * they are formatted. Server components get these from
 * `getFormatters()` (`./server`), client components from
 * `useFormatters()` (`./client`); both build on this.
 *
 * English keeps `en-GB`, as before translation; French uses `fr-FR`
 * (`22 nov. 2026`, `1 234,5`).
 */
export interface Formatters {
  readonly locale: AppLocale;
  /** The `Intl` tag behind it, for the rare call that needs `Intl` directly. */
  readonly intlLocale: string;
  /** A date; `dateStyle: 'medium'` unless told otherwise. An unparseable value is returned as given. */
  date(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
  /** A date with its time; `medium` date, `short` time unless told otherwise. */
  dateTime(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
  /** A number with the language's grouping and decimal separators. */
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** A ratio (0.25) as a percentage (`25%`, `25 %`). */
  percent(value: number, options?: Intl.NumberFormatOptions): string;
  /** A size in bytes with a binary unit (`1.5 MB`, `1,5 Mo` in French). */
  bytes(value: number): string;
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The symbols the app showed before translation (`B`, `KB`, …, binary
 * multiples), and the French octet symbols. `Intl`'s own byte units
 * spell `512 byte` and `kB`, which read worse in both languages.
 */
const BYTE_UNITS_EN = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTE_UNITS_FR = ['o', 'Ko', 'Mo', 'Go', 'To'] as const;

export function formattersFor(locale: AppLocale): Formatters {
  const tag = intlLocale(locale);
  return {
    locale,
    intlLocale: tag,
    date(value, options = { dateStyle: 'medium' }) {
      const date = toDate(value);
      return date === null ? String(value) : new Intl.DateTimeFormat(tag, options).format(date);
    },
    dateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
      const date = toDate(value);
      return date === null ? String(value) : new Intl.DateTimeFormat(tag, options).format(date);
    },
    number(value, options) {
      return new Intl.NumberFormat(tag, options).format(value);
    },
    percent(value, options = { maximumFractionDigits: 0 }) {
      return new Intl.NumberFormat(tag, { ...options, style: 'percent' }).format(value);
    },
    bytes(value) {
      const units = locale === 'fr' ? BYTE_UNITS_FR : BYTE_UNITS_EN;
      let unit = 0;
      let amount = value;
      while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit += 1;
      }
      const digits = unit === 0 ? 0 : 1;
      const number = new Intl.NumberFormat(tag, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount);
      return `${number} ${units.at(unit) ?? ''}`;
    },
  };
}

import { getLocale } from 'next-intl/server';
import { formattersFor, type Formatters } from './format';

/** Date and number formatters in the request's interface language (server components, actions). */
export async function getFormatters(): Promise<Formatters> {
  return formattersFor(await getLocale());
}

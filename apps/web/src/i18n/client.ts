'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { formattersFor, type Formatters } from './format';

/** Date and number formatters in the interface language (client components). */
export function useFormatters(): Formatters {
  const locale = useLocale();
  return useMemo(() => formattersFor(locale), [locale]);
}

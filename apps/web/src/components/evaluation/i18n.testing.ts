import { createTranslator } from 'next-intl';
import { formattersFor } from '../../i18n/format';
import type { AppLocale } from '../../i18n/locales';
import en from '../../i18n/messages/en';
import fr from '../../i18n/messages/fr';
import type { EvaluationI18n } from './i18n';

/** The evaluation vocabulary in a fixed language, for unit tests only. */
export function evaluationI18n(locale: AppLocale = 'en'): EvaluationI18n {
  return {
    t:
      locale === 'fr'
        ? createTranslator({ locale, messages: fr, namespace: 'Evaluation' })
        : createTranslator({ locale, messages: en, namespace: 'Evaluation' }),
    f: formattersFor(locale),
  };
}

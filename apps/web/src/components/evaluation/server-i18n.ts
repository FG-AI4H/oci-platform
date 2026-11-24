import { getTranslations } from 'next-intl/server';
import { getFormatters } from '../../i18n/server';
import type { EvaluationI18n } from './i18n';

/** The evaluation vocabulary in the request's language (server components and actions). */
export async function getEvaluationI18n(): Promise<EvaluationI18n> {
  const [t, f] = await Promise.all([getTranslations('Evaluation'), getFormatters()]);
  return { t, f };
}

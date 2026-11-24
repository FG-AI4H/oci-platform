import type { Formatters } from '../../i18n/format';
import type { Translator } from '../../i18n/translator';

/**
 * What the evaluation helpers need to word and format a result in the
 * interface language (#654): the `Evaluation` messages and the number
 * and date formatters. Pages get it from `getEvaluationI18n()`
 * (`./server-i18n`); unit tests build it for a fixed language
 * (`./i18n.testing`).
 */
export interface EvaluationI18n {
  readonly t: Translator<'Evaluation'>;
  readonly f: Formatters;
}

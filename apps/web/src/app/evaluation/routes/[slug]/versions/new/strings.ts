import type { Formatters } from '../../../../../../i18n/format';
import type { Translator } from '../../../../../../i18n/translator';

/** `t` for the `EvaluationDeclare` namespace (#654). */
export type DeclareTranslator = Translator<'EvaluationDeclare'>;

/**
 * One message per field of the "Declare a new version" form (#649),
 * phrased for the person filling it, in the interface language (#654).
 * The wording is in the `EvaluationDeclare` messages; this only picks
 * the message for a field path (`adversaries.2.party` → "Choose the party.").
 */
export function fieldMessage(field: string, t: DeclareTranslator, f: Formatters): string {
  if (field === 'version') return t('field.version');
  if (field === 'adversaries') return t('field.adversaries');
  if (field === 'observations') return t('field.observations');
  if (field.endsWith('.party')) return t('field.party');
  if (field.endsWith('.capability')) return t('field.capability');
  if (field.endsWith('.observes')) return t('field.observes');
  if (field === 'assumptions') return t('field.assumptions');
  if (field === 'outOfScope') return t('field.outOfScope');
  if (field === 'trustAnchor') return t('field.trustAnchor');
  if (field === 'keyGovernance') return t('field.keyGovernance');
  if (field === 'reproducibleMethod') return t('field.reproducibleMethod');
  if (field === 'permittedOperations') return t('field.permittedOperations');
  if (field === 'arithmeticPrecision') return t('field.arithmeticPrecision');
  if (field === 'maxRuntimeSec') return t('field.maxRuntimeSec', { max: f.number(86_400) });
  if (field === 'maxMemoryMb') return t('field.maxMemoryMb', { max: f.number(1_048_576) });
  if (field === 'fidelityMetric') return t('field.fidelityMetric');
  // The example is what the field accepts, a point as the decimal sign, in every language.
  if (field === 'fidelityDelta') return t('field.fidelityDelta', { example: '-0.012' });
  if (field === 'fidelityMeasuredOn') return t('field.fidelityMeasuredOn');
  return t('field.other');
}

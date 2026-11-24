import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { RouteVersionResponse } from '@oci/shared-types';
import {
  checkDraft,
  draftFromFormData,
  draftFromVersion,
  emptyDraft,
  fieldForIssue,
} from './declaration-draft';
import { formattersFor } from '../../../../../../i18n/format';
import en from '../../../../../../i18n/messages/en';
import fr from '../../../../../../i18n/messages/fr';
import { fieldMessage as messageFor } from './strings';

const t = createTranslator({ locale: 'en', messages: en, namespace: 'EvaluationDeclare' });
const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'EvaluationDeclare' });
const fieldMessage = (field: string) => messageFor(field, t, formattersFor('en'));
const champMessage = (field: string) => messageFor(field, tFr, formattersFor('fr'));

const VERSION: RouteVersionResponse = {
  id: '22222222-2222-4222-8222-222222222222',
  routeId: '11111111-1111-4111-8111-111111111111',
  version: '1.0.0',
  threatModel: {
    adversaries: [
      { party: 'PLATFORM_OPERATOR', capability: 'reads all logs', defended: true },
      { party: 'MODEL_DEVELOPER', capability: 'submits crafted models', defended: false },
    ],
    assumptions: ['the sandbox has no network'],
    outOfScope: ['a malicious data host', 'side channels'],
  },
  disclosureProfile: {
    observations: [{ party: 'DATA_HOST', observes: 'its own data' }],
    trustAnchor: 'CONTRACTUAL',
    keyGovernance: 'The data host holds the keys.',
    reproducible: { value: true, method: 'Fixed seed and image digest.' },
  },
  operationalEnvelope: {
    permittedOperations: ['inference'],
    arithmeticPrecision: 'fp32',
    maxRuntimeSec: 3600,
    maxMemoryMb: 8192,
    modelConstraints: null,
    fidelityGap: { metric: 'AUC', delta: -0.01, measuredOn: 'the public slice' },
  },
  reviewStatus: 'APPROVED',
  reviewedAt: null,
  reviewNotes: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function formDataOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe('declaration draft', () => {
  it('round-trips a version through the draft to a valid request', () => {
    const draft = { ...draftFromVersion(VERSION), version: '1.1.0' };
    const check = checkDraft(draft, fieldMessage);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.request.version).toBe('1.1.0');
      expect(check.request.threatModel).toEqual(VERSION.threatModel);
      expect(check.request.disclosureProfile).toEqual(VERSION.disclosureProfile);
      expect(check.request.operationalEnvelope).toEqual(VERSION.operationalEnvelope);
    }
  });

  it('starts with the version number blank, so it must be chosen', () => {
    const check = checkDraft(draftFromVersion(VERSION), fieldMessage);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(Object.keys(check.errors)).toEqual(['version']);
  });

  it('reads the posted form: rows in index order, lines, checkboxes', () => {
    const draft = draftFromFormData(
      formDataOf({
        version: ' 2.0.0 ',
        'adversaries.1.party': 'DATA_HOST',
        'adversaries.1.capability': 'second',
        'adversaries.0.party': 'PLATFORM_OPERATOR',
        'adversaries.0.capability': 'first',
        'adversaries.0.defended': 'yes',
        assumptions: 'a\n\n b \n',
        reproducible: 'yes',
      }),
    );
    expect(draft.version).toBe('2.0.0');
    expect(draft.adversaries).toEqual([
      { party: 'PLATFORM_OPERATOR', capability: 'first', defended: true },
      { party: 'DATA_HOST', capability: 'second', defended: false },
    ]);
    expect(draft.reproducible).toBe(true);
    expect(draft.fidelityMeasured).toBe(false);
  });

  it('names every field that is wrong in an empty draft, with its message', () => {
    const check = checkDraft(emptyDraft(), fieldMessage);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors).toMatchObject({
        version: fieldMessage('version'),
        'adversaries.0.party': 'Choose the party.',
        'adversaries.0.capability': 'Say what this party can do.',
        assumptions: fieldMessage('assumptions'),
        outOfScope: fieldMessage('outOfScope'),
        trustAnchor: fieldMessage('trustAnchor'),
        maxRuntimeSec: fieldMessage('maxRuntimeSec'),
      });
    }
  });

  it('words the field messages in each language, numbers formatted in it (#654)', () => {
    expect(fieldMessage('maxRuntimeSec')).toBe('A whole number of seconds, at most 86,400.');
    expect(fieldMessage('fidelityDelta')).toBe('A number, for example -0.012.');
    expect(champMessage('adversaries.3.party')).toBe('Choisissez la partie.');
    expect(champMessage('maxMemoryMb')).toBe(
      'Un nombre entier de Mio, au plus 1\u202f048\u202f576.',
    );
    expect(champMessage('something-else')).toBe('Vérifiez ce champ.');
  });

  it('asks how a result reproduces when it is said to', () => {
    const draft = { ...draftFromVersion(VERSION), version: '1.1.0', reproducibleMethod: ' ' };
    const check = checkDraft(draft, fieldMessage);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors).toHaveProperty('reproducibleMethod');
  });

  it('maps schema paths to form fields', () => {
    expect(fieldForIssue(['threatModel', 'adversaries', 2, 'capability'])).toBe(
      'adversaries.2.capability',
    );
    expect(fieldForIssue(['threatModel', 'assumptions', 0])).toBe('assumptions');
    expect(fieldForIssue(['disclosureProfile', 'reproducible', 'method'])).toBe(
      'reproducibleMethod',
    );
    expect(fieldForIssue(['operationalEnvelope', 'fidelityGap', 'delta'])).toBe('fidelityDelta');
    expect(fieldForIssue(['operationalEnvelope', 'maxMemoryMb'])).toBe('maxMemoryMb');
  });
});

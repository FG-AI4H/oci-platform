import { describe, expect, it } from 'vitest';
import type { SubgroupResults, TaskKindScores } from '@oci/shared-types';
import en from '../../../../../../i18n/messages/en';
import fr from '../../../../../../i18n/messages/fr';
import { formattersFor } from '../../../../../../i18n/format';
import {
  excerpt,
  gapValues,
  gapsBySection,
  knownEvent,
  metricRows,
  shortHash,
  subgroupViews,
} from './evidence-view';

/**
 * The evidence summary's figures (#652): which measures each scoring family
 * shows, in French and English number formats, and the subgroup tables
 * printing a withheld group as withheld, never as a number.
 */

const EN = formattersFor('en');
const FR = formattersFor('fr');

/** French spacing as plain spaces: ICU writes a no-break or a narrow no-break one. */
const spaces = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/[\u00a0\u202f]/g, ' ')) as T;

const p = (
  estimate: number,
  lower: number,
  upper: number,
  numerator: number,
  denominator: number,
) => ({
  estimate,
  lower,
  upper,
  numerator,
  denominator,
});

const BINARY: TaskKindScores = {
  kind: 'BINARY_DIAGNOSTIC',
  metrics: {
    truePositives: 68,
    falsePositives: 12,
    trueNegatives: 108,
    falseNegatives: 12,
    prevalence: p(0.4, 0.3348, 0.4688, 80, 200),
    sensitivity: p(0.85, 0.7554, 0.9122, 68, 80),
    specificity: p(0.9, 0.8333, 0.9419, 108, 120),
    positivePredictiveValue: p(0.85, 0.7554, 0.9122, 68, 80),
    negativePredictiveValue: p(0.9, 0.8333, 0.9419, 108, 120),
    accuracy: p(0.88, 0.8269, 0.9183, 176, 200),
    balancedAccuracy: 0.875,
    auc: null,
    coverage: 1,
  },
};

describe('metricRows', () => {
  it('a binary finding: sensitivity and specificity first, with their Wilson intervals and counts', () => {
    const rows = metricRows(BINARY, FR);
    expect(rows.map((r) => r.key)).toStrictEqual([
      'sensitivity',
      'specificity',
      'positivePredictiveValue',
      'negativePredictiveValue',
      'balancedAccuracy',
      'auc',
      'accuracy',
      'prevalence',
      'coverage',
    ]);
    const [sensitivity] = rows;
    // French: decimal comma and a narrow no-break space before %.
    expect(spaces(sensitivity?.value)).toBe('85 %');
    expect(spaces(sensitivity?.interval)).toStrictEqual({ lower: '75,5 %', upper: '91,2 %' });
    expect(sensitivity?.basis).toStrictEqual({ numerator: '68', denominator: '80' });
    expect(rows.find((r) => r.key === 'auc')?.absent).toBe('aucNeedsScores');
  });

  it('English keeps en-GB formats', () => {
    const [sensitivity] = metricRows(BINARY, EN);
    expect(sensitivity?.value).toBe('85%');
    expect(sensitivity?.interval).toStrictEqual({ lower: '75.5%', upper: '91.2%' });
  });

  it('a rate with no denominator is not estimable, not 0%', () => {
    const none: TaskKindScores = {
      ...BINARY,
      metrics: { ...BINARY.metrics, positivePredictiveValue: null },
    } as TaskKindScores;
    const ppv = metricRows(none, EN).find((r) => r.key === 'positivePredictiveValue');
    expect(ppv).toMatchObject({ value: null, absent: 'notEstimable', interval: null });
  });

  it('classification and grading carry no interval', () => {
    const classification: TaskKindScores = {
      kind: 'CLASSIFICATION',
      metrics: {
        accuracy: 0.88,
        balancedAccuracy: 0.875,
        macroF1: 0.8743,
        microF1: 0.88,
        coverage: 0.95,
        perClass: [],
      },
    };
    const rows = metricRows(classification, FR);
    expect(rows.map((r) => r.key)).toStrictEqual([
      'macroF1',
      'balancedAccuracy',
      'accuracy',
      'coverage',
    ]);
    expect(rows.every((r) => r.interval === null)).toBe(true);
    expect(spaces(rows[0]?.value)).toBe('87,4 %');

    const grading: TaskKindScores = {
      kind: 'GRADING',
      metrics: {
        qwk: -0.0423,
        accuracy: 0.5,
        referableSensitivity: 0.6,
        referableSpecificity: 0.7,
        coverage: 1,
      },
    };
    expect(metricRows(grading, FR)[0]?.value).toBe('-0,042');
  });
});

describe('subgroupViews', () => {
  const results: SubgroupResults = {
    minCellSize: 11,
    fields: [
      {
        key: 'ageBand',
        label: 'Age band',
        cells: [
          {
            status: 'REPORTED',
            value: '18-39',
            label: '18 to 39',
            itemCount: 70,
            scoredCount: 70,
            metrics: {
              kind: 'BINARY_DIAGNOSTIC',
              accuracy: p(0.9, 0.8, 0.95, 63, 70),
              prevalence: null,
              sensitivity: null,
              specificity: null,
              positivePredictiveValue: null,
              negativePredictiveValue: null,
              balancedAccuracy: null,
              auc: null,
              ratesWithheld: true,
            },
          },
          { status: 'SUPPRESSED', value: '60+', label: '60 and over' },
        ],
      },
    ],
  };

  it('prints the whole set first, a withheld rate as withheld, and a suppressed group without figures', () => {
    const [table] = subgroupViews(results, BINARY, EN, 'All scored items');
    expect(table?.columns).toStrictEqual(['sensitivity', 'specificity', 'accuracy']);
    const [overall, young, old] = table?.rows ?? [];
    expect(overall).toMatchObject({
      kind: 'overall',
      label: 'All scored items',
      items: { scored: '200' },
    });
    expect(overall?.figures[0]).toMatchObject({ state: 'value', text: '85%' });
    expect(young?.figures.map((fig) => fig.state)).toStrictEqual(['withheld', 'withheld', 'value']);
    expect(young?.figures[2]?.interval).toStrictEqual({ lower: '80%', upper: '95%' });
    expect(old).toStrictEqual({
      key: '60+',
      label: '60 and over',
      kind: 'suppressed',
      items: null,
      figures: [],
    });
  });
});

describe('gaps', () => {
  it('formats a share as a percentage and counts in the language’s digits', () => {
    expect(
      spaces(
        gapValues({ code: 'INCOMPLETE_COVERAGE', section: 4, params: { coverage: 0.955 } }, FR),
      ),
    ).toStrictEqual({ coverage: '95,5 %' });
    expect(
      spaces(
        gapValues(
          { code: 'FEW_POSITIVE_CASES', section: 4, params: { positives: 1234, minimum: 50 } },
          FR,
        ),
      ),
    ).toStrictEqual({ positives: '1 234', minimum: '50' });
    expect(
      gapValues({ code: 'METHOD_NOT_APPROVED', section: 3, params: { status: 'DECLARED' } }, EN),
    ).toStrictEqual({ status: 'DECLARED' });
  });

  it('groups by section in order', () => {
    const bySection = gapsBySection([
      { code: 'METHOD_NOT_APPROVED', section: 3, params: {} },
      { code: 'NO_MODEL_CARD', section: 1, params: {} },
    ]);
    expect([...bySection.keys()]).toStrictEqual([1, 3]);
  });

  it('every gap code has a sentence in both languages', () => {
    const codes = [
      'NO_MODEL_CARD',
      'MODEL_CARD_NOT_PUBLISHED',
      'NO_INTENDED_USE',
      'DATASET_NOT_AVAILABLE',
      'SYNTHETIC_DATA',
      'REFERENCE_LABELS_UNDOCUMENTED',
      'SINGLE_READER_LABELS',
      'READER_AGREEMENT_NOT_REPORTED',
      'METHOD_NOT_ATTRIBUTED',
      'METHOD_NOT_APPROVED',
      'METHOD_RETRACTED',
      'NOT_SCORED',
      'NO_INTERVALS',
      'FEW_POSITIVE_CASES',
      'INCOMPLETE_COVERAGE',
      'NO_SUBGROUP_DATA',
      'SUBGROUPS_WITHHELD',
      'NO_AUDIT_EVENTS',
      'AUDIT_RESULT_EVENT_MISSING',
    ] as const;
    const english = new Map(Object.entries(en.EvidenceSummary.gaps));
    const french = new Map(Object.entries(fr.EvidenceSummary.gaps));
    for (const code of codes) {
      expect(english.get(code), code).toBeTruthy();
      expect(french.get(code), code).toBeTruthy();
    }
  });
});

describe('helpers', () => {
  it('shortens a hash and names the evaluation events', () => {
    expect(shortHash('a'.repeat(64))).toBe(`${'a'.repeat(12)}…`);
    expect(shortHash(null)).toBe('—');
    expect(knownEvent('evaluation.scored')).toBe('scored');
    expect(knownEvent('audit.events.exported')).toBeNull();
  });

  it('cuts a long manifest text at a word', () => {
    const long = 'word '.repeat(100).trim();
    const cut = excerpt(long, 40);
    expect(cut.cut).toBe(true);
    expect(cut.text.endsWith('word…')).toBe(true);
    expect(excerpt('short', 40)).toStrictEqual({ text: 'short', cut: false });
  });
});

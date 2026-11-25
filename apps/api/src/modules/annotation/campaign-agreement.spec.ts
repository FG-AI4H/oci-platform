import { randomUUID } from 'node:crypto';
import type { AnnotationGateState } from '@oci/database';
import type { ClassificationLabelsConfig, ReaderPseudonym } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { computeCampaignAgreement } from './campaign-agreement.js';
import type { CampaignTaskAnswers } from './task.repository.js';

/** Reader "a" → "r-0000000a": readable in assertions. */
const pseudonym = (userId: string) => `r-${userId.padStart(8, '0')}` as ReaderPseudonym;

const LABELS: ClassificationLabelsConfig = {
  labels: [
    { value: 'normal', display: 'Normal' },
    { value: 'abnormal', display: 'Abnormal' },
  ],
  cannotAssess: true,
  allowComment: true,
};

let clock = Date.UTC(2026, 10, 20, 9);
function answer(reader: string, label: string | null, gate: AnnotationGateState = 'INDEPENDENT') {
  clock += 60_000;
  return {
    assigneeUserId: reader,
    gateAtAssignment: gate,
    submission: label === null ? { comment: 'no label' } : { label },
    submittedAt: new Date(clock),
  };
}

function task(
  gateState: AnnotationGateState,
  readings: Array<[string, string | null]>,
  later: Array<[string, string, AnnotationGateState]> = [],
): CampaignTaskAnswers {
  return {
    id: randomUUID(),
    sampleRef: `file:${randomUUID()}`,
    gateState,
    assignments: [
      ...readings.map(([r, l]) => answer(r, l)),
      ...later.map(([r, l, g]) => answer(r, l, g)),
    ],
  };
}

function compute(tasks: CampaignTaskAnswers[], labels: ClassificationLabelsConfig | null = LABELS) {
  return computeCampaignAgreement({
    campaignSlug: 'c',
    tasks,
    labels,
    pseudonym,
    now: new Date('2026-11-25T10:00:00Z'),
  });
}

/**
 * The worked example, by hand. Three readers a, b, c; ten tasks:
 *   4 × (normal, normal, normal)
 *   4 × (abnormal, abnormal, abnormal)
 *   2 × (normal, normal, abnormal)   c disagrees, sent to arbitration
 *
 * Fleiss: P_i = 1 on the unanimous tasks, (2·1)/(3·2) = 1/3 on the split
 * ones, so P̄ = (8 + 2/3)/10 = 13/15. p(normal) = 16/30, p(abnormal) =
 * 14/30, P̄e = (16² + 14²)/30² = 113/225. κ = (13/15 − 113/225)/(112/225)
 * = 82/112 = 0.7321.
 *
 * Cohen, a–b: identical answers, κ = 1. a–c: p_o = 8/10, a says normal
 * 6/10, c says normal 4/10, p_e = 0.6·0.4 + 0.4·0.6 = 0.48, κ = 0.32/0.52
 * = 0.6154. b–c the same.
 */
function workedExample(): CampaignTaskAnswers[] {
  return [
    ...Array.from({ length: 4 }, () =>
      task('COMPLETED', [
        ['a', 'normal'],
        ['b', 'normal'],
        ['c', 'normal'],
      ]),
    ),
    ...Array.from({ length: 4 }, () =>
      task('COMPLETED', [
        ['a', 'abnormal'],
        ['b', 'abnormal'],
        ['c', 'abnormal'],
      ]),
    ),
    // Settled by arbiter d, whose answer is not a reading.
    task(
      'COMPLETED',
      [
        ['a', 'normal'],
        ['b', 'normal'],
        ['c', 'abnormal'],
      ],
      [['d', 'abnormal', 'AWAITING_ARBITRATION']],
    ),
    // Waiting for an arbiter.
    task('AWAITING_ARBITRATION', [
      ['a', 'normal'],
      ['b', 'normal'],
      ['c', 'abnormal'],
    ]),
  ];
}

describe('computeCampaignAgreement (#648)', () => {
  it('matches the worked example: Fleiss, percent agreement, pairwise Cohen, counts', () => {
    const r = compute(workedExample());
    expect(r.tasks).toEqual({
      counted: 10,
      open: 0,
      skipped: 0,
      excluded: 0,
      sentToArbitration: 2,
      arbitrationShare: 0.2,
    });
    expect(r.readersPerTask).toBe(3);
    expect(r.readers).toBe(3);
    expect(r.overall.status).toBe('computed');
    expect(r.overall.fleissKappa).toBeCloseTo(82 / 112, 4);
    expect(r.overall.percentAgreement).toBeCloseTo(13 / 15, 4);
    expect(r.overall.unanimousTasks).toBe(8);
    expect(r.overall.interval).toMatchObject({
      level: 0.95,
      method: 'percentile-bootstrap',
      resamples: 2000,
    });
    expect(r.overall.interval!.lower).toBeLessThanOrEqual(r.overall.fleissKappa!);
    expect(r.overall.interval!.upper).toBeGreaterThanOrEqual(r.overall.fleissKappa!);

    const pair = (x: string, y: string) =>
      r.pairwise.find((p) => p.readerA === pseudonym(x) && p.readerB === pseudonym(y));
    expect(pair('a', 'b')).toMatchObject({ sharedTasks: 10, cohensKappa: 1, percentAgreement: 1 });
    expect(pair('a', 'c')?.cohensKappa).toBeCloseTo(0.32 / 0.52, 4);
    expect(pair('a', 'c')?.percentAgreement).toBe(0.8);
    expect(pair('b', 'c')?.cohensKappa).toBeCloseTo(0.32 / 0.52, 4);
    expect(r.pairwise).toHaveLength(3);

    // The arbiter is not a reader.
    expect(r.labelCountsByReader.map((x) => x.reader)).toEqual(['a', 'b', 'c'].map(pseudonym));
    expect(r.labelCountsByReader[2]).toEqual({
      reader: pseudonym('c'),
      readings: 10,
      counts: [
        { label: 'normal', count: 4 },
        { label: 'abnormal', count: 6 },
        { label: 'cannot-assess', count: 0 },
      ],
    });
    expect(r.labels).toEqual([
      { value: 'normal', display: 'Normal' },
      { value: 'abnormal', display: 'Abnormal' },
      { value: 'cannot-assess', display: null },
    ]);
  });

  it('reproduces Fleiss (1971): 10 subjects, 14 readers, 5 answers, κ ≈ 0.21', () => {
    const matrix = [
      [0, 0, 0, 0, 14],
      [0, 2, 6, 4, 2],
      [0, 0, 3, 5, 6],
      [0, 3, 9, 2, 0],
      [2, 2, 8, 1, 1],
      [7, 7, 0, 0, 0],
      [3, 2, 6, 3, 0],
      [2, 5, 3, 2, 2],
      [6, 5, 2, 1, 0],
      [0, 2, 2, 3, 7],
    ];
    const tasks = matrix.map((row) => {
      const readings: Array<[string, string]> = [];
      row.forEach((count, category) => {
        for (let k = 0; k < count; k += 1) {
          readings.push([(readings.length + 10).toString(16), `c${category + 1}`]);
        }
      });
      return task('COMPLETED', readings);
    });
    const r = compute(tasks, null);
    expect(r.readersPerTask).toBe(14);
    expect(r.overall.fleissKappa).toBeCloseTo(0.21, 2);
    expect(r.overall.percentAgreement).toBeCloseTo(0.378, 3);
    expect(r.labels.map((l) => l.value)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('reproduces Cohen (1960) for a pair of readers: κ = 0.29 / 0.59 over 200 cases', () => {
    const counts: Array<[string, string, number]> = [
      ['p', 'p', 88],
      ['p', 'z', 14],
      ['p', 'm', 18],
      ['z', 'p', 10],
      ['z', 'z', 40],
      ['z', 'm', 10],
      ['m', 'p', 2],
      ['m', 'z', 6],
      ['m', 'm', 12],
    ];
    const tasks: CampaignTaskAnswers[] = [];
    for (const [x, y, n] of counts) {
      for (let i = 0; i < n; i += 1) {
        tasks.push(
          task(x === y ? 'COMPLETED' : 'AWAITING_ARBITRATION', [
            ['a', x],
            ['b', y],
          ]),
        );
      }
    }
    const r = compute(tasks, null);
    expect(r.readersPerTask).toBe(2);
    expect(r.pairwise).toHaveLength(1);
    expect(r.pairwise[0]?.sharedTasks).toBe(200);
    expect(r.pairwise[0]?.cohensKappa).toBeCloseTo(0.29 / 0.59, 4);
    expect(r.pairwise[0]?.percentAgreement).toBe(0.7);
    expect(r.overall.percentAgreement).toBe(0.7);
    expect(r.tasks.arbitrationShare).toBe(0.3);
  });

  it('uses independent SUBMITTED readings only: arbitration and expert answers are left out', () => {
    const tasks = workedExample();
    // Expert review on one more split task: still not a reading.
    tasks.push(
      task(
        'COMPLETED',
        [
          ['a', 'normal'],
          ['b', 'abnormal'],
          ['c', 'abnormal'],
        ],
        [
          ['d', 'normal', 'AWAITING_ARBITRATION'],
          ['e', 'abnormal', 'AWAITING_EXPERT'],
        ],
      ),
    );
    const r = compute(tasks);
    expect(r.readers).toBe(3);
    expect(r.tasks.counted).toBe(11);
    expect(r.tasks.sentToArbitration).toBe(3);
    expect(r.labelCountsByReader.every((x) => x.readings === 11)).toBe(true);
  });

  it('counts open and skipped tasks apart, and excludes unusable finished tasks', () => {
    const tasks = [
      ...workedExample(),
      // Still being read.
      task('INDEPENDENT', [
        ['a', 'normal'],
        ['b', 'normal'],
      ]),
      task('INDEPENDENT', []),
      // Taken out of the campaign.
      task('SKIPPED', [
        ['a', 'normal'],
        ['b', 'abnormal'],
        ['c', 'abnormal'],
      ]),
      // A reading without an answer.
      task('COMPLETED', [
        ['a', 'normal'],
        ['b', null],
        ['c', 'normal'],
      ]),
      // Two readings where the campaign has three.
      task('COMPLETED', [
        ['a', 'normal'],
        ['b', 'normal'],
      ]),
    ];
    const r = compute(tasks);
    expect(r.tasks).toMatchObject({ counted: 10, open: 2, skipped: 1, excluded: 2 });
    expect(r.overall.fleissKappa).toBeCloseTo(82 / 112, 4);
  });

  it('below 10 counted tasks gives the counts and no coefficient', () => {
    const r = compute(workedExample().slice(0, 9));
    expect(r.tasks.counted).toBe(9);
    expect(r.overall).toEqual({
      status: 'too-few-tasks',
      fleissKappa: null,
      interval: null,
      percentAgreement: null,
      unanimousTasks: null,
    });
    expect(r.pairwise.every((p) => p.status === 'too-few-tasks' && p.cohensKappa === null)).toBe(
      true,
    );
    expect(r.pairwise[0]?.sharedTasks).toBe(9);
    expect(r.labelCountsByReader).toHaveLength(3);
    expect(r.tasks.sentToArbitration).toBe(1);
  });

  it('counts « cannot assess » as an answer of its own', () => {
    const tasks = [
      ...workedExample().slice(0, 8),
      task('COMPLETED', [
        ['a', 'cannot-assess'],
        ['b', 'cannot-assess'],
        ['c', 'cannot-assess'],
      ]),
      task('AWAITING_ARBITRATION', [
        ['a', 'cannot-assess'],
        ['b', 'normal'],
        ['c', 'normal'],
      ]),
    ];
    const r = compute(tasks);
    expect(r.cannotAssess).toEqual({ policy: 'own-answer', readings: 4 });
    // Three readers agreeing they cannot assess is agreement: 9 unanimous tasks.
    expect(r.overall.unanimousTasks).toBe(9);
    const a = r.labelCountsByReader.find((x) => x.reader === pseudonym('a'));
    expect(a?.counts.find((c) => c.label === 'cannot-assess')?.count).toBe(2);
  });

  it('says so when every reading gave the same answer (kappa is 0/0)', () => {
    const tasks = Array.from({ length: 10 }, () =>
      task('COMPLETED', [
        ['a', 'normal'],
        ['b', 'normal'],
        ['c', 'normal'],
      ]),
    );
    const r = compute(tasks);
    expect(r.overall.status).toBe('single-answer');
    expect(r.overall.fleissKappa).toBeNull();
    expect(r.overall.interval).toBeNull();
    expect(r.overall.percentAgreement).toBe(1);
    expect(r.pairwise[0]?.status).toBe('single-answer');
  });

  it('with one reader per task there is nothing to agree with', () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task('COMPLETED', [[i % 2 === 0 ? 'a' : 'b', 'normal']]),
    );
    const r = compute(tasks);
    expect(r.readersPerTask).toBe(1);
    expect(r.overall.status).toBe('single-reader');
    expect(r.pairwise).toEqual([]);
  });

  it('an empty campaign has zero counts and nulls', () => {
    const r = compute([]);
    expect(r.tasks.counted).toBe(0);
    expect(r.tasks.arbitrationShare).toBeNull();
    expect(r.readersPerTask).toBeNull();
    expect(r.overall.status).toBe('too-few-tasks');
  });
});

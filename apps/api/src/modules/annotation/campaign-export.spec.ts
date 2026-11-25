import type { AnnotationGateState } from '@oci/database';
import { ANNOTATION_EXPORT_COLUMNS, type ReaderPseudonym } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { buildExportRows, finalLabelOf, toAnnotationCsv } from './campaign-export.js';
import type { CampaignTaskAnswers } from './task.repository.js';

const pseudonym = (userId: string) => `r-${userId.padStart(8, '0')}` as ReaderPseudonym;

const T0 = Date.UTC(2026, 10, 20, 9);
function answer(
  reader: string,
  gate: AnnotationGateState,
  minute: number,
  submission: Record<string, unknown>,
) {
  return {
    assigneeUserId: reader,
    gateAtAssignment: gate,
    submission,
    submittedAt: new Date(T0 + minute * 60_000),
  };
}

function task(
  gateState: AnnotationGateState,
  assignments: CampaignTaskAnswers['assignments'],
  id = '00000000-0000-4000-8000-000000000001',
): CampaignTaskAnswers {
  return { id, sampleRef: 'file:sample-1', gateState, assignments };
}

describe('finalLabelOf: the final label comes from arbitration, not a vote (#648)', () => {
  it('closed at the independent step: the common label', () => {
    const t = task('COMPLETED', [
      answer('a', 'INDEPENDENT', 1, { label: 'normal' }),
      answer('b', 'INDEPENDENT', 2, { label: 'normal' }),
      answer('c', 'INDEPENDENT', 3, { label: 'normal' }),
    ]);
    expect(finalLabelOf(t)).toEqual({ taskStatus: 'closed-independent', finalLabel: 'normal' });
  });

  it('a single reader (N = 1) closes the task with their label', () => {
    const t = task('COMPLETED', [answer('a', 'INDEPENDENT', 1, { label: 'abnormal' })]);
    expect(finalLabelOf(t)).toEqual({ taskStatus: 'closed-independent', finalLabel: 'abnormal' });
  });

  it('sent to arbitration: the arbitration label, even against the majority', () => {
    const t = task('COMPLETED', [
      answer('a', 'INDEPENDENT', 1, { label: 'normal' }),
      answer('b', 'INDEPENDENT', 2, { label: 'normal' }),
      answer('c', 'INDEPENDENT', 3, { label: 'abnormal' }),
      answer('d', 'AWAITING_ARBITRATION', 4, { label: 'abnormal', reason: 'nodule at apex' }),
    ]);
    expect(finalLabelOf(t)).toEqual({ taskStatus: 'closed-arbitration', finalLabel: 'abnormal' });
  });

  it('sent on to expert review: the expert label wins (the last one)', () => {
    const t = task('COMPLETED', [
      answer('a', 'INDEPENDENT', 1, { label: 'normal' }),
      answer('b', 'INDEPENDENT', 2, { label: 'abnormal' }),
      // Listed out of order: the gate decides, then the time.
      answer('e', 'AWAITING_EXPERT', 9, { label: 'normal' }),
      answer('d', 'AWAITING_ARBITRATION', 4, { label: 'abnormal', reason: 'r' }),
    ]);
    expect(finalLabelOf(t)).toEqual({ taskStatus: 'closed-expert-review', finalLabel: 'normal' });
  });

  it.each<AnnotationGateState>(['INDEPENDENT', 'AWAITING_ARBITRATION', 'AWAITING_EXPERT'])(
    'not completed (%s): no final label, the task is open',
    (gate) => {
      const t = task(gate, [
        answer('a', 'INDEPENDENT', 1, { label: 'normal' }),
        answer('b', 'INDEPENDENT', 2, { label: 'abnormal' }),
      ]);
      expect(finalLabelOf(t)).toEqual({ taskStatus: 'open', finalLabel: null });
    },
  );

  it('skipped: no final label', () => {
    const t = task('SKIPPED', [answer('a', 'INDEPENDENT', 1, { label: 'normal' })]);
    expect(finalLabelOf(t)).toEqual({ taskStatus: 'skipped', finalLabel: null });
  });
});

describe('buildExportRows', () => {
  it('one row per answer, readers pseudonymous, the final label on every row', () => {
    const rows = buildExportRows(
      [
        task('COMPLETED', [
          answer('d', 'AWAITING_ARBITRATION', 4, {
            label: 'abnormal',
            reason: 'nodule at apex',
            comment: 'arbiter note',
          }),
          answer('a', 'INDEPENDENT', 1, { label: 'normal', comment: 'looks fine' }),
          answer('c', 'INDEPENDENT', 3, { label: 'abnormal' }),
          answer('b', 'INDEPENDENT', 2, { label: 'normal' }),
        ]),
      ],
      pseudonym,
    );
    expect(rows.map((r) => [r.reader, r.gate, r.label])).toEqual([
      [pseudonym('a'), 'independent', 'normal'],
      [pseudonym('b'), 'independent', 'normal'],
      [pseudonym('c'), 'independent', 'abnormal'],
      [pseudonym('d'), 'arbitration', 'abnormal'],
    ]);
    expect(rows.every((r) => r.finalLabel === 'abnormal')).toBe(true);
    expect(rows.every((r) => r.taskStatus === 'closed-arbitration')).toBe(true);
    expect(rows[0]).toMatchObject({
      comment: 'looks fine',
      submittedAt: '2026-11-20T09:01:00.000Z',
      arbitrationReason: null,
    });
    expect(rows[3]).toMatchObject({ arbitrationReason: 'nodule at apex', comment: 'arbiter note' });
  });

  it('a task with no answer yet has one row saying it is open', () => {
    const rows = buildExportRows([task('INDEPENDENT', [])], pseudonym);
    expect(rows).toEqual([
      {
        task: '00000000-0000-4000-8000-000000000001',
        sampleRef: 'file:sample-1',
        taskStatus: 'open',
        reader: null,
        gate: null,
        label: null,
        comment: null,
        submittedAt: null,
        arbitrationReason: null,
        finalLabel: null,
      },
    ]);
  });

  it('carries no user id', () => {
    const userId = '6f1c2a9e-0d3b-5c7e-9a1f-2b4d6e8f0a1c';
    const rows = buildExportRows(
      [task('COMPLETED', [answer(userId, 'INDEPENDENT', 1, { label: 'normal' })])],
      () => 'r-12345678' as ReaderPseudonym,
    );
    expect(JSON.stringify(rows)).not.toContain(userId);
    expect(toAnnotationCsv(rows)).not.toContain(userId);
  });
});

describe('toAnnotationCsv', () => {
  const rows = buildExportRows(
    [
      task('COMPLETED', [
        answer('a', 'INDEPENDENT', 1, {
          label: 'normal',
          comment: 'Opacité, base droite; "à revoir"\nsecond line',
        }),
        answer('b', 'INDEPENDENT', 2, { label: 'normal', comment: '=HYPERLINK("http://x")' }),
        answer('c', 'INDEPENDENT', 3, { label: 'normal', comment: '+1' }),
        answer('d', 'INDEPENDENT', 4, { label: 'normal', comment: '-2' }),
        answer('e', 'INDEPENDENT', 5, { label: 'normal', comment: '@SUM(A1)' }),
      ]),
    ],
    pseudonym,
  );
  const csv = toAnnotationCsv(rows);

  it('starts with a UTF-8 byte-order mark and the header row', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.slice(1).split('\r\n')[0]).toBe(ANNOTATION_EXPORT_COLUMNS.join(','));
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'task,sampleRef,taskStatus,reader,gate,label,comment,submittedAt,arbitrationReason,finalLabel',
    );
  });

  it('quotes commas, quotes and line breaks, and keeps accents', () => {
    expect(csv).toContain(',"Opacité, base droite; ""à revoir""\nsecond line",');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('guards cells that start with = + - @ against formula injection', () => {
    expect(csv).toContain(`,"'=HYPERLINK(""http://x"")",`);
    expect(csv).toContain(",'+1,");
    expect(csv).toContain(",'-2,");
    expect(csv).toContain(",'@SUM(A1),");
  });

  it('writes empty values as empty cells', () => {
    const line = toAnnotationCsv(buildExportRows([task('INDEPENDENT', [])], pseudonym))
      .slice(1)
      .split('\r\n')[1];
    expect(line).toBe('00000000-0000-4000-8000-000000000001,file:sample-1,open,,,,,,,');
  });
});

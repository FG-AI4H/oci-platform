import { describe, expect, it } from 'vitest';
import {
  EvaluationSubmissionDetailSchema,
  MAX_REPORTED_FILE_ISSUES,
  SubmitPredictionsRequestSchema,
  parsePredictionsFile,
  predictionsTemplateCsv,
  type PredictionsFileParseResult,
} from './index.js';

function rows(result: PredictionsFileParseResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.issues)}`);
  return result.predictions;
}

function issues(result: PredictionsFileParseResult) {
  if (result.ok) throw new Error('expected the file to be refused');
  return result;
}

describe('parsePredictionsFile — CSV (#645)', () => {
  it('reads item_id,label rows into the request shape', () => {
    const result = parsePredictionsFile('item_id,label\nimg_01,0\nimg_02,3\n');
    expect(result).toEqual({
      ok: true,
      format: 'CSV',
      predictions: [
        { imageId: 'img_01', grade: 0 },
        { imageId: 'img_02', grade: 3 },
      ],
    });
  });

  it('produces a body the submissions endpoint accepts', () => {
    const predictions = rows(parsePredictionsFile('item_id,label\r\na,1\r\nb,0\r\n'));
    expect(SubmitPredictionsRequestSchema.safeParse({ methodName: 'm', predictions }).success).toBe(
      true,
    );
  });

  it('reads a semicolon-separated file, as a spreadsheet with a decimal comma saves it', () => {
    expect(rows(parsePredictionsFile('item_id;label\r\nimg_01;1\r\nimg_02;0\r\n'))).toEqual([
      { imageId: 'img_01', grade: 1 },
      { imageId: 'img_02', grade: 0 },
    ]);
  });

  it('honours an explicit sep= line and keeps line numbers aligned with the file', () => {
    const result = issues(parsePredictionsFile('sep=;\nitem_id;label\nimg_01;x\n'));
    expect(result.issues).toEqual([
      {
        line: 3,
        message: 'The label for "img_01" must be a whole number such as 0 or 1. Found: x',
      },
    ]);
  });

  it('ignores a byte-order mark, blank lines, a missing final newline and stray empty cells', () => {
    const text = '﻿Item_ID , Label ,,\n\nimg_01 , 2 ,,\n,,\nimg_02,0';
    expect(rows(parsePredictionsFile(text))).toEqual([
      { imageId: 'img_01', grade: 2 },
      { imageId: 'img_02', grade: 0 },
    ]);
  });

  it('reads quoted identifiers, including a separator, a doubled quote and a line break', () => {
    const text = 'item_id,label\n"a,b",1\n"say ""hi""",0\n"two\nlines",2\nlast,1\n';
    expect(rows(parsePredictionsFile(text))).toEqual([
      { imageId: 'a,b', grade: 1 },
      { imageId: 'say "hi"', grade: 0 },
      { imageId: 'two\nlines', grade: 2 },
      { imageId: 'last', grade: 1 },
    ]);
  });

  it('does not check duplicates or task membership — that is the API validation path', () => {
    expect(rows(parsePredictionsFile('item_id,label\nsame,1\nsame,1\n'))).toHaveLength(2);
  });

  it('refuses a file without the header, quoting what it found', () => {
    const result = issues(parsePredictionsFile('img_01,1\nimg_02,0\n'));
    expect(result.format).toBe('CSV');
    expect(result.issues[0]).toEqual({
      line: 1,
      message:
        'The first line must be the header item_id,label (comma or semicolon separated). Found: img_01,1',
    });
  });

  it('refuses a score column rather than dropping it', () => {
    const result = issues(parsePredictionsFile('item_id,label,score\nimg_01,1,0.93\n'));
    expect(result.issues[0]?.message).toMatch(/^A score column is not accepted/);
  });

  it('reports each bad line with its line number, and submits nothing', () => {
    const text = [
      'item_id,label', // 1
      'img_01,', // 2  empty label (an unfilled template line)
      ',1', // 3  empty identifier
      'img_03,2.0', // 4  not a whole number
      'img_04,-1', // 5  negative
      'img_05,1,extra', // 6  third value
      'img_06,1001', // 7  above the static ceiling
      `${'x'.repeat(201)},1`, // 8  identifier too long
      'img_08,1', // 9  fine
    ].join('\n');
    const result = issues(parsePredictionsFile(text));
    expect(result.issueCount).toBe(7);
    expect(result.issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.issues[0]?.message).toBe('No label for "img_01".');
    expect(result.missingLabelCount).toBe(1);
    expect(result.issues[2]?.message).toBe(
      'The label for "img_03" must be a whole number such as 0 or 1. Found: 2.0',
    );
    expect(result.issues[4]?.message).toBe('Expected two values (item_id and label), found 3.');
  });

  it('lists the first problems and counts all of them', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `img_${i},`);
    const result = issues(parsePredictionsFile(['item_id,label', ...lines].join('\n')));
    expect(result.issues).toHaveLength(MAX_REPORTED_FILE_ISSUES);
    expect(result.issueCount).toBe(50);
  });

  it('refuses an unclosed quote at the line it opens on', () => {
    const result = issues(parsePredictionsFile('item_id,label\nimg_01,1\n"img_02,1\nimg_03,0\n'));
    expect(result.issues).toEqual([
      { line: 3, message: 'A quoted value is opened here and never closed.' },
    ]);
  });

  it('refuses text after a closing quote', () => {
    const result = issues(parsePredictionsFile('item_id,label\n"img"_01,1\n'));
    expect(result.issues[0]?.line).toBe(2);
    expect(result.issues[0]?.message).toMatch(/^Text follows a closing quote/);
  });

  it.each([
    ['', 'The file is empty.'],
    ['\n\n', 'The file is empty.'],
    ['item_id,label\n', 'The file has a header and no predictions.'],
  ])('refuses %j', (text, message) => {
    expect(issues(parsePredictionsFile(text)).issues[0]?.message).toBe(message);
  });
});

describe('parsePredictionsFile — JSON (#645)', () => {
  it('reads the request body', () => {
    const text = JSON.stringify({
      methodName: 'ignored — the form names the method',
      predictions: [{ imageId: 'img_01', grade: 2 }],
    });
    expect(parsePredictionsFile(text)).toEqual({
      ok: true,
      format: 'JSON',
      predictions: [{ imageId: 'img_01', grade: 2 }],
    });
  });

  it('reads the predictions array on its own', () => {
    expect(rows(parsePredictionsFile('  [{"imageId":"a","grade":0}]'))).toEqual([
      { imageId: 'a', grade: 0 },
    ]);
  });

  it('names the entry and the field that is wrong, and refuses unknown keys', () => {
    const text = JSON.stringify({
      predictions: [
        { imageId: 'a', grade: 0 },
        { imageId: 'b', grade: '1' },
        { imageId: 'c', grade: 1, score: 0.9 },
      ],
    });
    const result = issues(parsePredictionsFile(text));
    expect(result.format).toBe('JSON');
    expect(result.issueCount).toBe(2);
    expect(result.issues[0]?.message).toMatch(/^predictions\[1\]\.grade: /);
    expect(result.issues[1]?.message).toMatch(/^predictions\[2\]: .*score/);
  });

  it.each([
    ['{"predictions": [', /^The file is not valid JSON/],
    ['{"rows": []}', /^Expected an object with a "predictions" array/],
    ['{"predictions": []}', /^The "predictions" array is empty/],
  ])('refuses %j', (text, message) => {
    expect(issues(parsePredictionsFile(text)).issues[0]?.message).toMatch(message);
  });
});

describe('predictionsTemplateCsv (#645)', () => {
  it('writes the header and one unlabelled line per item', () => {
    expect(predictionsTemplateCsv(['img_01', 'img_02'])).toBe(
      'item_id,label\r\nimg_01,\r\nimg_02,\r\n',
    );
  });

  it('writes the semicolon form', () => {
    expect(predictionsTemplateCsv(['img_01'], ';')).toBe('item_id;label\r\nimg_01;\r\n');
  });

  it('read back untouched, reports every line as unlabelled', () => {
    const result = issues(parsePredictionsFile(predictionsTemplateCsv(['a', 'b', 'c'])));
    expect(result.issueCount).toBe(3);
    expect(result.missingLabelCount).toBe(3);
    expect(result.issues.map((i) => i.line)).toEqual([2, 3, 4]);
  });

  it.each([',', ';'] as const)(
    'round-trips awkward identifiers once labelled (separator %j)',
    (delimiter) => {
      const ids = ['plain', 'has,comma', 'has;semicolon', 'has "quote"', ' padded ', '00012'];
      const filled = predictionsTemplateCsv(ids, delimiter)
        .split('\r\n')
        .map((line, i) => (i === 0 || line === '' ? line : `${line}1`))
        .join('\r\n');
      expect(rows(parsePredictionsFile(filled)).map((p) => p.imageId)).toEqual(ids);
    },
  );
});

describe('parsePredictionsFile — optional score, for a task that takes one (#650)', () => {
  const allow = { allowScore: true };

  it('reads item_id,label,score rows', () => {
    expect(rows(parsePredictionsFile('item_id,label,score\na,1,0.93\nb,0,0.1\n', allow))).toEqual([
      { imageId: 'a', grade: 1, score: 0.93 },
      { imageId: 'b', grade: 0, score: 0.1 },
    ]);
  });

  it('still reads item_id,label with no score column', () => {
    expect(rows(parsePredictionsFile('item_id,label\na,1\n', allow))).toEqual([
      { imageId: 'a', grade: 1 },
    ]);
  });

  it('takes an empty score cell as "no score for this item"', () => {
    expect(rows(parsePredictionsFile('item_id,label,score\na,1,0.8\nb,0,\n', allow))).toEqual([
      { imageId: 'a', grade: 1, score: 0.8 },
      { imageId: 'b', grade: 0 },
    ]);
  });

  it('reads a decimal comma in a semicolon-separated file', () => {
    expect(rows(parsePredictionsFile('item_id;label;score\na;1;0,83\nb;0;1\n', allow))).toEqual([
      { imageId: 'a', grade: 1, score: 0.83 },
      { imageId: 'b', grade: 0, score: 1 },
    ]);
  });

  it.each(['1.5', '-0.2', 'high', '0,5', '1e-3'])(
    'refuses the score %j in a comma-separated file, with its line',
    (bad) => {
      // "0,5" in a comma file is two cells, so it shows up as a fourth value.
      const result = issues(parsePredictionsFile(`item_id,label,score\na,1,${bad}\n`, allow));
      expect(result.issues[0]?.line).toBe(2);
      expect(result.issues[0]?.message).toMatch(
        /score for "a" must be a number from 0 to 1|at most three/,
      );
    },
  );

  it('produces a body the submissions endpoint accepts, and the endpoint refuses a score above 1', () => {
    const predictions = rows(parsePredictionsFile('item_id,label,score\na,1,0.5\n', allow));
    expect(SubmitPredictionsRequestSchema.safeParse({ methodName: 'm', predictions }).success).toBe(
      true,
    );
    expect(
      SubmitPredictionsRequestSchema.safeParse({
        methodName: 'm',
        predictions: [{ imageId: 'a', grade: 1, score: 1.2 }],
      }).success,
    ).toBe(false);
  });

  it('reads a JSON score, and refuses one outside 0 to 1', () => {
    expect(rows(parsePredictionsFile('[{"imageId":"a","grade":1,"score":0.7}]', allow))).toEqual([
      { imageId: 'a', grade: 1, score: 0.7 },
    ]);
    const result = issues(parsePredictionsFile('[{"imageId":"a","grade":1,"score":7}]', allow));
    expect(result.issues[0]?.message).toMatch(/^predictions\[0\]\.score: /);
  });

  it('keeps refusing the score column when the task takes none', () => {
    const result = issues(parsePredictionsFile('item_id,label,score\na,1,0.5\n'));
    expect(result.issues[0]?.message).toBe(
      'A score column is not accepted for this task: it takes one whole-number label per item. The first line must be exactly item_id,label.',
    );
    const json = issues(parsePredictionsFile('[{"imageId":"a","grade":1,"score":0.5}]'));
    expect(json.issues[0]?.message).toBe(
      'predictions[0]: A score is not accepted for this task: it takes one whole-number label per item.',
    );
  });

  it('writes a template with an empty score column, which reads back as unlabelled', () => {
    const csv = predictionsTemplateCsv(['a', 'b'], ',', { withScore: true });
    expect(csv).toBe('item_id,label,score\r\na,,\r\nb,,\r\n');
    expect(predictionsTemplateCsv(['a'], ';', { withScore: true })).toBe(
      'item_id;label;score\r\na;;\r\n',
    );
    expect(issues(parsePredictionsFile(csv, allow)).missingLabelCount).toBe(2);
  });
});

describe('EvaluationSubmissionDetailSchema (#645)', () => {
  const base = {
    id: '22222222-2222-4222-8222-222222222222',
    task: {
      slug: 'chest-xr-finding',
      name: 'Chest X-ray finding',
      datasetSlug: 'chest-xr',
      taskKind: 'GRADING',
      numClasses: 2,
      referableThreshold: 1,
      positiveClassName: null,
    },
    methodName: 'm',
    mode: 'PREDICTIONS',
    viewerIsSubmitter: false,
    createdAt: '2026-11-20T00:00:00.000Z',
  };

  it('accepts a failed submission with its reason', () => {
    const failed = {
      ...base,
      status: 'FAILED',
      scores: null,
      attribution: null,
      failure: { reason: 'duplicate imageId "a" in predictions', quotaConsumed: false },
    };
    expect(EvaluationSubmissionDetailSchema.safeParse(failed).success).toBe(true);
  });

  it('refuses a failure on a submission that did not fail, and a failed one without it', () => {
    const pendingWithFailure = {
      ...base,
      status: 'PENDING',
      scores: null,
      attribution: null,
      failure: { reason: 'x', quotaConsumed: true },
    };
    const failedWithout = { ...pendingWithFailure, status: 'FAILED', failure: null };
    expect(EvaluationSubmissionDetailSchema.safeParse(pendingWithFailure).success).toBe(false);
    expect(EvaluationSubmissionDetailSchema.safeParse(failedWithout).success).toBe(false);
  });
});

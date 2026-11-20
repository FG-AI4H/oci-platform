import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IDENTIFYING_ATTRIBUTES } from '@oci/dicom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRecord } from './arrival-record.js';
import {
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_SAMPLE_REFUSED,
  run,
  type CheckCliDependencies,
} from './check-cli.js';
import {
  INVENTED_MARKER,
  slice,
  writeCleanSample,
  writeFile,
} from './test-support/synthetic-sample.js';

let scratch: string;
let repository: string;
let desk: string;
let sample: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-check-cli-')));
  repository = path.join(scratch, 'checkout');
  desk = path.join(scratch, 'desk');
  sample = path.join(scratch, 'sample');
  for (const folder of [repository, desk, sample]) mkdirSync(folder);
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function command() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CheckCliDependencies = {
    workingDirectory: desk,
    repositoryRoot: repository,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    now: () => new Date('2026-12-01T08:00:00.000Z'),
  };
  return {
    out,
    err,
    text: () => [...out, ...err].join('\n'),
    run: (...argv: string[]) => run(argv, deps),
  };
}

/** Everything the command produced: the terminal and every file it wrote. */
function everythingWritten(terminal: string): string {
  const files = ['record.json', 'sheet.csv']
    .map((name) => path.join(desk, name))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'));
  return [terminal, ...files].join('\n');
}

describe('check-exam-sample: a sample that passes', () => {
  it('prints each exam with its series, writes the record and the sheet, and exits 0', () => {
    writeCleanSample(sample, { exams: 2, slicesPerSeries: 3 });
    const cli = command();

    const code = cli.run(sample, '--record-out', 'record.json', '--sheet-out', 'sheet.csv');

    expect(code).toBe(EXIT_OK);
    expect(cli.text()).toMatch(/Read 6 file\(s\)/);
    expect(cli.text()).toMatch(
      /series 1 {2}\| {2}CT {2}\| {2}3 image\(s\) {2}\| {2}4 x 4 {2}\| {2}slice thickness 5 mm {2}\| {2}Explicit VR Little Endian/,
    );
    expect(cli.text()).toMatch(/PASSED: 2 exam\(s\), 6 image\(s\)/);
    expect(cli.text()).toMatch(/a person opens every exam once/);

    const record = parseRecord(readFileSync(path.join(desk, 'record.json'), 'utf8'));
    expect(record.verdict).toBe('PASS');
    expect(record.checkedAt).toBe('2026-12-01T08:00:00.000Z');
    expect(record.files).toHaveLength(6);

    const sheet = readFileSync(path.join(desk, 'sheet.csv'), 'utf8').trim().split('\r\n');
    expect(sheet[0]).toBe(
      'exam,exam_ref,folders,series,images,look_closely,checked_by,checked_on,result,notes',
    );
    expect(sheet).toHaveLength(3);
    expect(sheet[1]).toMatch(/^1,[0-9a-f]{12},exam-00\d,1,3,,,,,$/);
  });

  it('writes its files for the owner only', () => {
    writeCleanSample(sample, { exams: 1 });
    command().run(sample, '--record-out', 'record.json', '--sheet-out', 'sheet.csv');
    for (const name of ['record.json', 'sheet.csv']) {
      expect(statSync(path.join(desk, name)).mode & 0o777).toBe(0o600);
    }
  });
});

describe('check-exam-sample: never prints the value of an identifying attribute', () => {
  it('names the attribute and the file for every attribute of the platform list, and no value anywhere', () => {
    writeCleanSample(sample, { exams: 1 });
    writeFile(
      sample,
      'exam-002/series-01/0001.dcm',
      slice({
        exam: 2,
        series: 1,
        instance: 1,
        overrides: IDENTIFYING_ATTRIBUTES.map(({ tag, attribute }) => ({
          tag,
          vr: 'LO' as const,
          value: `${INVENTED_MARKER}-${attribute}`,
        })),
      }),
    );
    const cli = command();

    const code = cli.run(sample, '--record-out', 'record.json', '--sheet-out', 'sheet.csv');

    expect(code).toBe(EXIT_SAMPLE_REFUSED);
    for (const { attribute } of IDENTIFYING_ATTRIBUTES) {
      expect(cli.text()).toContain(
        `the identifying attribute ${attribute} is populated: 1 file(s)`,
      );
    }
    expect(cli.text()).toContain('exam-002/series-01/0001.dcm');
    expect(cli.text()).toMatch(/REFUSED: 17 kind\(s\) of problem\. Nothing may be uploaded/);

    // The proof: the invented values are in the file on disk and in nothing the command produced.
    expect(
      readFileSync(path.join(sample, 'exam-002/series-01/0001.dcm')).includes(INVENTED_MARKER),
    ).toBe(true);
    expect(everythingWritten(cli.text())).not.toContain(INVENTED_MARKER);
    // A refused sample gets a record (it names the files to correct) and no sheet.
    expect(parseRecord(readFileSync(path.join(desk, 'record.json'), 'utf8')).verdict).toBe(
      'REFUSED',
    );
    expect(existsSync(path.join(desk, 'sheet.csv'))).toBe(false);
  });

  it('prints no value when the finding is accepted by a recorded decision either', () => {
    writeFile(
      sample,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [
          { tag: '00080020', vr: 'DA', value: '19990101' },
          { tag: '00100010', vr: 'PN', value: `${INVENTED_MARKER}^CODE` },
        ],
      }),
    );
    writeFileSync(
      path.join(desk, 'decisions.json'),
      JSON.stringify({
        decidedBy: 'An Operator',
        decidedOn: '2026-12-01',
        institutionStatement: 'letter ref. EX-1',
        attributes: [
          { attribute: 'PatientName', reason: 'study codes made for this sample' },
          { attribute: 'StudyDate', reason: 'dates shifted at source' },
        ],
      }),
    );
    const cli = command();

    const code = cli.run(
      sample,
      '--accept-findings',
      'decisions.json',
      '--record-out',
      'record.json',
      '--sheet-out',
      'sheet.csv',
    );

    expect(code).toBe(EXIT_OK);
    expect(cli.text()).toMatch(
      /PatientName: 1 file\(s\), 1 distinct value\(s\)\. Reason recorded: study codes/,
    );
    expect(cli.text()).toMatch(/the platform will still hold these files/);
    const written = everythingWritten(cli.text());
    expect(written).not.toContain(INVENTED_MARKER);
    expect(written).not.toContain('19990101');
    const record = parseRecord(readFileSync(path.join(desk, 'record.json'), 'utf8'));
    expect(record.decisions?.decidedBy).toBe('An Operator');
    expect(record.files[0]?.acceptedFindings).toEqual(['PatientName', 'StudyDate']);
  });

  it('does not print a file or folder name that it refuses', () => {
    writeFile(
      sample,
      'Zorblax Quillfeather 1999-01-01/0001.dcm',
      slice({ exam: 1, series: 1, instance: 1 }),
    );
    const cli = command();
    expect(cli.run(sample, '--record-out', 'record.json')).toBe(EXIT_SAMPLE_REFUSED);
    expect(cli.text()).toContain('[name withheld: entry 1 of 1]');
    expect(everythingWritten(cli.text())).not.toMatch(/Zorblax|Quillfeather|1999/);
  });
});

describe('check-exam-sample: refusals before any file is read', () => {
  it('refuses an output inside the repository, and reads nothing', () => {
    writeCleanSample(sample, { exams: 1 });
    const cli = command();
    const code = cli.run(sample, '--record-out', path.join(repository, 'record.json'));
    expect(code).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/inside the repository/);
    expect(cli.text()).not.toMatch(/Read \d+ file/);
  });

  it('refuses to overwrite an existing record', () => {
    writeCleanSample(sample, { exams: 1 });
    writeFileSync(path.join(desk, 'record.json'), '{}');
    expect(command().run(sample, '--record-out', 'record.json')).toBe(EXIT_REFUSED);
    expect(readFileSync(path.join(desk, 'record.json'), 'utf8')).toBe('{}');
  });

  it('refuses a decisions file that accepts an attribute outside the short list', () => {
    writeCleanSample(sample, { exams: 1 });
    writeFileSync(
      path.join(desk, 'decisions.json'),
      JSON.stringify({
        decidedBy: 'An Operator',
        decidedOn: '2026-12-01',
        institutionStatement: 'letter ref. EX-1',
        attributes: [{ attribute: 'PatientBirthDate', reason: 'it is fine' }],
      }),
    );
    const cli = command();
    expect(cli.run(sample, '--accept-findings', 'decisions.json')).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/decisions file .* is not valid/);
  });

  it.each([
    [['/no/such/folder'], /is not a folder/],
    [[], /exactly one folder/],
    [['--no-such-option'], /Unknown option/],
  ])('refuses %j', (argv, message) => {
    const cli = command();
    expect(cli.run(...argv)).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(message);
  });
});

describe('check-exam-sample: --list-attributes', () => {
  it("prints the platform's list, one attribute per line with its tag", () => {
    const cli = command();
    expect(cli.run('--list-attributes')).toBe(EXIT_OK);
    expect(cli.out).toHaveLength(IDENTIFYING_ATTRIBUTES.length);
    expect(cli.out[0]).toBe('(0010,0010)  PatientName');
  });
});

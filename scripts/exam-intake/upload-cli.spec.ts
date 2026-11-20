import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRecord } from './arrival-record.js';
import { run as runCheck } from './check-cli.js';
import { HttpPlatformApi } from './platform-api.js';
import { FakePlatform } from './test-support/fake-platform.js';
import {
  INVENTED_MARKER,
  slice,
  writeCleanSample,
  writeFile,
} from './test-support/synthetic-sample.js';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_REFUSED,
  run,
  TOKEN_VARIABLE,
  type UploadCliDependencies,
} from './upload-cli.js';
import type { UploadManifest, UploadState } from './upload-sample.js';

const SLUG = 'head-ct-sample-x7k2';
/** Invented, and recognisable in any output it must never reach. */
const TOKEN = 'TOKEN-ZZQX-NEVER-PRINT-ME';
const MANIFEST_BASE = {
  '@type': 'sc:Dataset',
  name: 'Head CT sample',
  description: 'Synthetic test sample.',
  license: 'https://example.org/licence',
};

let scratch: string;
let repository: string;
let desk: string;
let sample: string;
let platform: FakePlatform;

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'oci-upload-cli-')));
  repository = path.join(scratch, 'checkout');
  desk = path.join(scratch, 'desk');
  sample = path.join(scratch, 'sample');
  for (const folder of [repository, desk, sample]) mkdirSync(folder);
  writeFileSync(path.join(desk, 'base.json'), JSON.stringify(MANIFEST_BASE));
  platform = new FakePlatform();
  platform.token = TOKEN;
  await platform.start();
});
afterEach(async () => {
  await platform.stop();
  rmSync(scratch, { recursive: true, force: true });
});

/** Run the arrival check for real and fill in the sheet as a person would. */
function checkAndLook(options: { fillSheet?: boolean; decisions?: string } = {}): void {
  for (const name of ['record.json', 'sheet.csv']) rmSync(path.join(desk, name), { force: true });
  const code = runCheck(
    [
      sample,
      '--record-out',
      'record.json',
      '--sheet-out',
      'sheet.csv',
      ...(options.decisions ? ['--accept-findings', options.decisions] : []),
    ],
    {
      workingDirectory: desk,
      repositoryRoot: repository,
      out: () => undefined,
      err: () => undefined,
      now: () => new Date('2026-12-01T08:00:00.000Z'),
    },
  );
  expect(code).toBe(0);
  if (options.fillSheet === false) return;
  const sheet = path.join(desk, 'sheet.csv');
  writeFileSync(
    sheet,
    readFileSync(sheet, 'utf8').replaceAll(/,,,,\r\n/g, ',A. Reader,2026-12-02,clear,\r\n'),
  );
}

function command(env: Record<string, string> = { [TOKEN_VARIABLE]: TOKEN }) {
  const out: string[] = [];
  const err: string[] = [];
  let opened = 0;
  const deps: UploadCliDependencies = {
    env,
    workingDirectory: desk,
    repositoryRoot: repository,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openApi: (apiBase, token) => {
      opened += 1;
      return new HttpPlatformApi(apiBase, token);
    },
    now: () => new Date('2026-12-03T09:00:00.000Z'),
  };
  const standard = (): string[] => [
    sample,
    '--record',
    'record.json',
    '--sheet',
    'sheet.csv',
    '--dataset',
    SLUG,
    '--api',
    platform.origin,
    '--state',
    'state.json',
    '--manifest-out',
    'manifest.json',
  ];
  return {
    out,
    err,
    opened: () => opened,
    text: () => [...out, ...err].join('\n'),
    run: (...extra: string[]) => run([...standard(), ...extra], deps),
    runRaw: (...argv: string[]) => run(argv, deps),
  };
}

const readManifest = (): UploadManifest =>
  JSON.parse(readFileSync(path.join(desk, 'manifest.json'), 'utf8')) as UploadManifest;
const readState = (): UploadState =>
  JSON.parse(readFileSync(path.join(desk, 'state.json'), 'utf8')) as UploadState;

describe('upload-exam-sample: a checked sample', () => {
  it('creates the dataset PRIVATE and CONTROLLED, attaches every file to one version, and writes the manifest', async () => {
    writeCleanSample(sample, { exams: 2, slicesPerSeries: 3 });
    checkAndLook();
    const cli = command();

    const code = await cli.run('--manifest-base', 'base.json');

    expect(cli.text()).toMatch(
      /Done: 6 file\(s\) attached to "head-ct-sample-x7k2" version 1\.0\.0\./,
    );
    expect(code).toBe(EXIT_OK);
    const dataset = platform.datasets.get(SLUG);
    expect(dataset).toMatchObject({ visibility: 'PRIVATE', accessTier: 'CONTROLLED' });
    expect(dataset?.versions).toHaveLength(1);
    expect(dataset?.versions[0]?.distributions).toHaveLength(6);

    // The bytes that reached storage are the bytes on disk.
    const stored = [...platform.objects.entries()].find(([key]) =>
      key.endsWith('/exam-001__series-01__0001.dcm'),
    );
    expect(stored?.[1]).toEqual(
      new Uint8Array(readFileSync(path.join(sample, 'exam-001/series-01/0001.dcm'))),
    );

    const manifest = readManifest();
    expect(manifest).toMatchObject({
      datasetSlug: SLUG,
      visibility: 'PRIVATE',
      accessTier: 'CONTROLLED',
      version: '1.0.0',
      fileListVersion: null,
      exams: 2,
      heldFiles: 0,
      startedAt: '2026-12-03T09:00:00.000Z',
    });
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.every((file) => file.dicomCheckStatus === 'CLEAR')).toBe(true);
    expect(manifest.visualChecks).toEqual([
      { exam: 1, checkedBy: 'A. Reader', checkedOn: '2026-12-02' },
      { exam: 2, checkedBy: 'A. Reader', checkedOn: '2026-12-02' },
    ]);
    expect(manifest.croissantDistribution).toHaveLength(6);
    const record = parseRecord(readFileSync(path.join(desk, 'record.json'), 'utf8'));
    expect(manifest.files.map((file) => file.sha256).sort()).toEqual(
      record.files.map((file) => file.sha256).sort(),
    );
  });

  it('gives each file its own identifier although file names repeat from one series to the next', async () => {
    writeCleanSample(sample, { exams: 3, slicesPerSeries: 2 });
    checkAndLook();
    await command().run('--manifest-base', 'base.json');
    const ids = platform.datasets.get(SLUG)?.versions[0]?.distributions.map((d) => d.croissantId);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain('exam-003/series-01/0002.dcm');
  });

  it('sends a file larger than one part in several parts, intact', async () => {
    writeFile(
      sample,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [{ tag: '7fe00010', vr: 'OW', value: new Uint8Array(5000).fill(7) }],
      }),
    );
    checkAndLook();
    platform.partSize = 1024;
    expect(await command().run('--manifest-base', 'base.json')).toBe(EXIT_OK);
    expect(platform.storageRequests().length).toBeGreaterThan(4);
    expect([...platform.objects.values()][0]).toEqual(
      new Uint8Array(readFileSync(path.join(sample, 'exam-001/series-01/0001.dcm'))),
    );
  });

  it('publishes a version that lists the files when asked, and says so in the manifest', async () => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 2 });
    checkAndLook();
    const cli = command();
    expect(await cli.run('--manifest-base', 'base.json', '--publish-file-list', '1.1.0')).toBe(
      EXIT_OK,
    );
    const versions = platform.datasets.get(SLUG)?.versions ?? [];
    expect(versions.map((version) => version.version)).toEqual(['1.1.0', '1.0.0']);
    expect(
      (versions[0]?.croissant as { distribution: Array<{ contentUrl: string }> }).distribution[0]
        ?.contentUrl,
    ).toMatch(
      /^\/v2\/catalog\/datasets\/head-ct-sample-x7k2\/distributions\/[0-9a-f-]{36}\/download$/,
    );
    expect(readManifest().fileListVersion).toBe('1.1.0');
  });

  it('does not publish a file list larger than the API accepts, and keeps the files attached', async () => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 2 });
    checkAndLook();
    writeFileSync(
      path.join(desk, 'base.json'),
      JSON.stringify({ ...MANIFEST_BASE, description: 'x'.repeat(1024 * 1024) }),
    );
    platform.addDataset(SLUG);
    platform.addVersion(SLUG, '1.0.0');
    const cli = command();
    expect(await cli.run('--manifest-base', 'base.json', '--publish-file-list', '1.1.0')).toBe(
      EXIT_OK,
    );
    expect(cli.text()).toMatch(/version 1\.1\.0 is NOT published/);
    expect(platform.datasets.get(SLUG)?.versions).toHaveLength(1);
    expect(readManifest()).toMatchObject({ version: '1.0.0', fileListVersion: null });
  });
});

describe('upload-exam-sample: refuses a folder that is not what was checked', () => {
  beforeEach(() => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 3 });
    checkAndLook();
  });

  const expectRefusedUntouched = async (cli: ReturnType<typeof command>, reason: RegExp) => {
    expect(await cli.run('--manifest-base', 'base.json')).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(reason);
    expect(cli.opened()).toBe(0);
    expect(platform.requests).toEqual([]);
  };

  it('a file changed after the check', async () => {
    writeFile(
      sample,
      'exam-001/series-01/0002.dcm',
      slice({ exam: 1, series: 1, instance: 2, z: 11 }),
    );
    await expectRefusedUntouched(command(), /1 file\(s\) have changed since the check/);
  });

  it('a file added after the check', async () => {
    writeFile(sample, 'exam-001/series-01/0004.dcm', slice({ exam: 1, series: 1, instance: 4 }));
    await expectRefusedUntouched(command(), /1 file\(s\) in the folder are not in the record/);
  });

  it('a file removed after the check', async () => {
    rmSync(path.join(sample, 'exam-001/series-01/0003.dcm'));
    await expectRefusedUntouched(
      command(),
      /1 file\(s\) of the record are no longer in the folder/,
    );
  });

  it('a file swapped for one with a populated attribute, even if the record is edited to match', async () => {
    const swapped = slice({
      exam: 1,
      series: 1,
      instance: 2,
      overrides: [{ tag: '00100010', vr: 'PN', value: `${INVENTED_MARKER}^NAME` }],
    });
    writeFile(sample, 'exam-001/series-01/0002.dcm', swapped);
    // Someone edits the record so that its checksums match the new file.
    const file = path.join(desk, 'record.json');
    const record = JSON.parse(readFileSync(file, 'utf8')) as {
      files: Array<{ path: string; sha256: string; sizeBytes: number }>;
    };
    const entry = record.files.find(
      (candidate) => candidate.path === 'exam-001/series-01/0002.dcm',
    );
    if (!entry) throw new Error('fixture: the file is not in the record');
    entry.sha256 = createHash('sha256').update(swapped).digest('hex');
    entry.sizeBytes = swapped.length;
    writeFileSync(file, JSON.stringify(record));

    const cli = command();
    await expectRefusedUntouched(cli, /checked again just now, the folder is refused/);
    expect(cli.text()).toMatch(/the identifying attribute PatientName is populated/);
    expect(cli.text()).not.toMatch(/have changed since the check/);
    expect(cli.text()).not.toContain(INVENTED_MARKER);
  });

  it('a record that says REFUSED', async () => {
    const file = path.join(desk, 'record.json');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('"verdict": "PASS"', '"verdict": "REFUSED"'),
    );
    await expectRefusedUntouched(command(), /did not pass/);
  });

  it("a record made with another version of the platform's attribute list", async () => {
    const file = path.join(desk, 'record.json');
    const record = JSON.parse(readFileSync(file, 'utf8')) as { attributeListDigest: string };
    record.attributeListDigest = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(record));
    await expectRefusedUntouched(command(), /another version of the platform's list/);
  });

  it('a record of another folder', async () => {
    const other = path.join(scratch, 'other');
    mkdirSync(other);
    writeCleanSample(other, { exams: 2, slicesPerSeries: 1 });
    const cli = command();
    const argv = ['--record', 'record.json', '--sheet', 'sheet.csv', '--dataset', SLUG];
    const code = await cli.runRaw(
      other,
      ...argv,
      '--api',
      platform.origin,
      '--state',
      'state.json',
      '--manifest-out',
      'manifest.json',
    );
    expect(code).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/not in the record/);
    expect(platform.requests).toEqual([]);
  });

  it('a visual check that nobody has filled in', async () => {
    checkAndLook({ fillSheet: false });
    await expectRefusedUntouched(command(), /the visual check is not complete/);
  });

  it('a visual check that found text in one exam', async () => {
    const sheet = path.join(desk, 'sheet.csv');
    writeFileSync(sheet, readFileSync(sheet, 'utf8').replace(',clear,', ',text-found,'));
    await expectRefusedUntouched(command(), /text was found in the images/);
  });
});

describe('upload-exam-sample: only into a dataset under restricted hosting', () => {
  beforeEach(() => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 2 });
    checkAndLook();
  });

  it.each([
    { visibility: 'PUBLIC', accessTier: 'CONTROLLED' },
    { visibility: 'RESTRICTED', accessTier: 'CONTROLLED' },
    { visibility: 'PRIVATE', accessTier: 'OPEN' },
  ])(
    'refuses an existing dataset that is $visibility with tier $accessTier, and uploads nothing',
    async (existing) => {
      platform.addDataset(SLUG, existing);
      platform.addVersion(SLUG, '1.0.0');
      const cli = command();
      expect(await cli.run()).toBe(EXIT_REFUSED);
      expect(cli.text()).toMatch(/only into a dataset that is PRIVATE with access tier CONTROLLED/);
      expect(platform.objects.size).toBe(0);
      expect(platform.requests.every((request) => request.method === 'GET')).toBe(true);
    },
  );

  it('refuses when the dataset does not exist and no description was given to create it', async () => {
    const cli = command();
    expect(await cli.run()).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/does not exist/);
    expect(platform.datasets.size).toBe(0);
  });
});

describe('upload-exam-sample: interrupted and run again', () => {
  beforeEach(() => {
    writeCleanSample(sample, { exams: 2, slicesPerSeries: 3 });
    checkAndLook();
  });

  it('resumes from the state file and uploads no file twice', async () => {
    platform.failCompleteAt = { nth: 3, status: 500 };
    const first = command();
    expect(await first.run('--manifest-base', 'base.json', '--concurrency', '1')).toBe(EXIT_FAILED);
    expect(first.text()).toMatch(/Stopped: finish the upload: HTTP 500/);
    expect(first.text()).toMatch(/Run the same command again to continue/);
    expect(Object.keys(readState().uploaded)).toHaveLength(2);
    expect(existsSync(path.join(desk, 'manifest.json'))).toBe(false);

    const second = command();
    expect(await second.run('--manifest-base', 'base.json', '--concurrency', '1')).toBe(EXIT_OK);
    expect(second.text()).toMatch(/2 of 6 file\(s\) already there, 4 to upload/);
    expect(platform.datasets.get(SLUG)?.versions[0]?.distributions).toHaveLength(6);
    expect(platform.objects.size).toBe(6);
    expect(readManifest().files).toHaveLength(6);
  });

  it('resumes from what the platform holds when the state file is lost', async () => {
    platform.failCompleteAt = { nth: 4, status: 500 };
    await command().run('--manifest-base', 'base.json', '--concurrency', '1');
    rmSync(path.join(desk, 'state.json'));

    const again = command();
    expect(await again.run('--concurrency', '1')).toBe(EXIT_OK);
    expect(again.text()).toMatch(/3 of 6 file\(s\) already there, 3 to upload/);
    expect(platform.objects.size).toBe(6);
  });

  it('says to renew the token when the session has expired part-way, and resumes with the new one', async () => {
    platform.failCompleteAt = { nth: 2, status: 401 };
    const first = command();
    expect(await first.run('--manifest-base', 'base.json', '--concurrency', '1')).toBe(EXIT_FAILED);
    expect(first.text()).toMatch(/the session token was not accepted; it may have expired/);
    expect(first.text()).toMatch(/with a new token in \$OCI_API_TOKEN/);
    expect(await command().run('--concurrency', '1')).toBe(EXIT_OK);
  });

  it('refuses to overwrite the manifest of a finished upload, and uploads nothing more', async () => {
    expect(await command().run('--manifest-base', 'base.json')).toBe(EXIT_OK);
    const again = command();
    expect(await again.run()).toBe(EXIT_REFUSED);
    expect(again.text()).toMatch(/never overwritten/);
    expect(platform.objects.size).toBe(6);
  });

  it('refuses a state file that belongs to another upload', async () => {
    writeFileSync(
      path.join(desk, 'state.json'),
      JSON.stringify({
        tool: 'upload-exam-sample',
        apiBase: 'https://elsewhere.example',
        datasetSlug: SLUG,
        recordDigest: 'x',
        uploaded: {},
      }),
    );
    const cli = command();
    expect(await cli.run()).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/belongs to another upload/);
  });
});

describe("upload-exam-sample: the platform's own check", () => {
  it('stops at once when the platform holds a file the arrival check passed, and stays stopped on the next run', async () => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 3 });
    checkAndLook();
    platform.forceCheckStatus = 'HELD';
    const first = command();
    expect(await first.run('--manifest-base', 'base.json', '--concurrency', '1')).toBe(EXIT_FAILED);
    expect(first.text()).toMatch(
      /the platform's check of exam-001\/series-01\/0001\.dcm says HELD, the arrival check expected CLEAR/,
    );
    expect(platform.objects.size).toBe(1);

    platform.forceCheckStatus = null;
    const second = command();
    expect(await second.run('--concurrency', '1')).toBe(EXIT_FAILED);
    expect(second.text()).toMatch(/says HELD/);
    expect(platform.objects.size).toBe(1);
  });

  it('expects the platform to hold a file whose finding a recorded decision accepted', async () => {
    writeFile(
      sample,
      'exam-001/series-01/0001.dcm',
      slice({
        exam: 1,
        series: 1,
        instance: 1,
        overrides: [{ tag: '00100020', vr: 'LO', value: `${INVENTED_MARKER}-CODE` }],
      }),
    );
    writeFile(sample, 'exam-001/series-01/0002.dcm', slice({ exam: 1, series: 1, instance: 2 }));
    writeFileSync(
      path.join(desk, 'decisions.json'),
      JSON.stringify({
        decidedBy: 'An Operator',
        decidedOn: '2026-12-01',
        institutionStatement: 'letter ref. EX-1',
        attributes: [{ attribute: 'PatientID', reason: 'study codes made for this sample' }],
      }),
    );
    checkAndLook({ decisions: 'decisions.json' });
    const cli = command();

    expect(await cli.run('--manifest-base', 'base.json')).toBe(EXIT_OK);

    expect(cli.text()).toMatch(
      /1 file\(s\) carry a finding accepted by a recorded decision\. The platform will hold them/,
    );
    expect(cli.text()).toMatch(/of which 1 held by the platform/);
    const manifest = readManifest();
    expect(manifest.heldFiles).toBe(1);
    expect(manifest.files.map((file) => file.dicomCheckStatus)).toEqual(['HELD', 'CLEAR']);
    expect(JSON.stringify(manifest) + cli.text() + JSON.stringify(readState())).not.toContain(
      INVENTED_MARKER,
    );
  });
});

describe('upload-exam-sample: the session token', () => {
  beforeEach(() => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 2 });
    checkAndLook();
  });

  it('is sent to the API and never to storage, never printed, never written to a file', async () => {
    const cli = command();
    expect(await cli.run('--manifest-base', 'base.json')).toBe(EXIT_OK);

    expect(platform.apiRequests().length).toBeGreaterThan(0);
    expect(platform.apiRequests().every((r) => r.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(platform.storageRequests()).toHaveLength(2);
    expect(platform.storageRequests().every((r) => r.authorization === undefined)).toBe(true);

    expect(cli.text()).not.toContain(TOKEN);
    for (const name of readdirSync(desk)) {
      expect(readFileSync(path.join(desk, name), 'utf8')).not.toContain(TOKEN);
    }
    // Nor a signed storage address.
    expect(cli.text() + readFileSync(path.join(desk, 'state.json'), 'utf8')).not.toMatch(
      /signature=|\/storage\//,
    );
  });

  it('is not printed when the platform rejects it', async () => {
    const cli = command({ [TOKEN_VARIABLE]: `${TOKEN}-WRONG` });
    expect(await cli.run('--manifest-base', 'base.json')).toBe(EXIT_FAILED);
    expect(cli.text()).toMatch(/HTTP 401 \(the session token was not accepted/);
    expect(cli.text()).not.toContain(TOKEN);
  });

  it('is refused on the command line, before anything else', async () => {
    const cli = command({});
    expect(await cli.run('--token', TOKEN)).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/never given on the command line/);
    expect(cli.text()).not.toContain(TOKEN);
    expect(platform.requests).toEqual([]);
  });

  it('is required, from the environment, for a real run only', async () => {
    const cli = command({});
    expect(await cli.run()).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/no session token: put the operator's own token in \$OCI_API_TOKEN/);
    expect(cli.opened()).toBe(0);
  });
});

describe('upload-exam-sample: dry run and refusals', () => {
  beforeEach(() => {
    writeCleanSample(sample, { exams: 1, slicesPerSeries: 2 });
    checkAndLook();
  });

  it('verifies the folder, says what would be done, and opens no connection', async () => {
    const cli = command({});
    expect(await cli.run('--dry-run')).toBe(EXIT_OK);
    expect(cli.text()).toMatch(/The folder is what was checked: 1 exam\(s\), 2 file\(s\)/);
    expect(cli.text()).toMatch(/Dry run: no connection is opened/);
    expect(cli.opened()).toBe(0);
    expect(platform.requests).toEqual([]);
    expect(existsSync(path.join(desk, 'state.json'))).toBe(false);
    expect(existsSync(path.join(desk, 'manifest.json'))).toBe(false);
  });

  it('refuses a platform address that would send the token in clear over a network', async () => {
    const cli = command();
    const code = await cli.runRaw(
      sample,
      '--record',
      'record.json',
      '--sheet',
      'sheet.csv',
      '--dataset',
      SLUG,
      '--api',
      'http://platform.example',
      '--state',
      'state.json',
      '--manifest-out',
      'manifest.json',
    );
    expect(code).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/must start with https:\/\//);
  });

  it('refuses a state or a manifest inside the repository', async () => {
    const cli = command();
    const code = await cli.runRaw(
      sample,
      '--record',
      'record.json',
      '--sheet',
      'sheet.csv',
      '--dataset',
      SLUG,
      '--api',
      platform.origin,
      '--state',
      path.join(repository, 'state.json'),
      '--manifest-out',
      'manifest.json',
    );
    expect(code).toBe(EXIT_REFUSED);
    expect(cli.text()).toMatch(/inside the repository/);
    expect(platform.requests).toEqual([]);
  });
});

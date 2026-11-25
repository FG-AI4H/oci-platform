import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEmitter } from '@oci/audit';
import { buildPart10, ctSlice, type TestElement } from '@oci/dicom/testing';
import type { DicomIndexRepository, DicomObjectRecord } from './dicom-index.repository.js';
import { DicomIndexService } from './dicom-index.service.js';
import type { S3ClientProvider } from './s3-client.js';

/**
 * The parser is the real one and the files are real bytes: headers of a
 * public CT series, and files built in memory with invented patient
 * values. Only storage and the database are stood in for. Storage is a
 * map of key to bytes that honours `Range` the way S3 does, so the
 * ranged reads are exercised and not assumed.
 */

const BUCKET = 'test-bucket';
const DATASET_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LOCAL_KEY = 'local-dev-only-dicom-finding-digest-key';
const DELIMITER = new Uint8Array([0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]);

const fixtures = join(
  dirname(createRequire(import.meta.url).resolve('@oci/dicom')),
  '..',
  'fixtures',
  'rider-lung-ct',
);

interface StoredObject {
  /** Bytes from offset 0. May be shorter than `size` (a header-only fixture). */
  head: Uint8Array;
  size: number;
  /** Last bytes of the object, when `head` does not reach the end. */
  tail?: Uint8Array;
}

let objects: Map<string, StoredObject>;
let ranges: string[];
let saved: DicomObjectRecord[];
let svc: DicomIndexService;
let logged: string[];
/** The audit trail: one event per file released at upload. */
const audit = { emitSync: vi.fn() };

function s3Send(command: GetObjectCommand) {
  const { Key, Range } = command.input;
  const object = objects.get(Key ?? '');
  if (!object) throw new Error(`NoSuchKey ${Key}`);
  ranges.push(Range ?? '');
  const match = /^bytes=(\d+)-(\d+)$/.exec(Range ?? '');
  if (!match) throw new Error(`unexpected range ${Range}`);
  const start = Number(match[1]);
  const end = Math.min(Number(match[2]), object.size - 1);

  let bytes: Uint8Array;
  if (end < object.head.length) {
    bytes = object.head.subarray(start, end + 1);
  } else if (object.tail && start >= object.size - object.tail.length) {
    bytes = object.tail.subarray(start - (object.size - object.tail.length));
  } else {
    // Asked for more of a header-only fixture than it holds: give what
    // exists, as a real ranged read would past the header.
    bytes = object.head.subarray(start);
  }
  return Promise.resolve({
    Body: { transformToByteArray: async () => bytes },
    ContentRange: `bytes ${start}-${end}/${object.size}`,
  });
}

function build() {
  const s3 = { bucket: BUCKET, client: { send: vi.fn(s3Send) } };
  const repo = {
    // Answers with the status it was given, as the repository does
    // when no operator decision covers the findings.
    save: vi.fn(async (record: DicomObjectRecord) => {
      saved.push(record);
      return record.checkStatus;
    }),
  };
  return new DicomIndexService(
    s3 as unknown as S3ClientProvider,
    repo as unknown as DicomIndexRepository,
    audit as unknown as AuditEmitter,
  );
}

function store(key: string, bytes: Uint8Array) {
  objects.set(key, { head: bytes, size: bytes.length });
}

const index = (key: string) =>
  svc.indexStoredObject({ datasetId: DATASET_ID, s3Bucket: BUCKET, s3Key: key });

const digest = (attribute: string, value: string, key = LOCAL_KEY) =>
  createHmac('sha256', key).update(attribute).update('\0').update(value).digest('hex');

const NAME: TestElement = { tag: '00100010', vr: 'PN', value: 'Example^Patient' };

beforeEach(() => {
  objects = new Map();
  ranges = [];
  saved = [];
  logged = [];
  vi.stubEnv('OCI_ENV', 'local');
  vi.stubEnv('OCI_DICOM_FINDING_DIGEST_KEY', '');
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
  svc = build();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('DicomIndexService.indexStoredObject', () => {
  it('records nothing for a file that is not DICOM, whatever it is called', async () => {
    const png = new Uint8Array(500);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    store('demo/1/scan.dcm', png);

    await expect(index('demo/1/scan.dcm')).resolves.toBeNull();
    expect(saved).toEqual([]);
  });

  it('indexes a clean slice as CLEAR, from one small read and no pixel data', async () => {
    const file = ctSlice();
    store('demo/1/clean.dcm', file);

    await expect(index('demo/1/clean.dcm')).resolves.toBe('CLEAR');

    expect(ranges).toEqual(['bytes=0-65535']);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      datasetId: DATASET_ID,
      s3Bucket: BUCKET,
      s3Key: 'demo/1/clean.dcm',
      checkStatus: 'CLEAR',
      unreadableReason: null,
      findings: [],
      parsed: {
        objectKind: 'single-frame-image',
        header: { modality: 'CT', rows: 4, columns: 4, imagePositionPatient: [-100, -100, 0] },
      },
    });
  });

  it('holds a file with a populated patient name and stores a digest, never the value', async () => {
    store('demo/1/named.dcm', ctSlice([NAME]));

    await expect(index('demo/1/named.dcm')).resolves.toBe('HELD');

    expect(saved[0]?.findings).toEqual([
      { attribute: 'PatientName', valueDigest: digest('PatientName', 'Example^Patient') },
    ]);
    // Neither what is handed to the database nor what is logged holds the name.
    expect(JSON.stringify(saved)).not.toContain('Example');
    expect(logged.join('\n')).not.toContain('Example');
    expect(logged.join('\n')).toContain('status=HELD');
    // Nor the file name, which can carry an identifier too.
    expect(logged.join('\n')).not.toContain('named.dcm');
  });

  it('gives the same digest for the same value and a different one otherwise', async () => {
    store('a', ctSlice([NAME]));
    store('b', ctSlice([NAME, { tag: '00080018', vr: 'UI', value: '1.2.3.4' }]));
    store('c', ctSlice([{ tag: '00100010', vr: 'PN', value: 'Other^Patient' }]));
    // The same text under another attribute must not look like the same finding.
    store('d', ctSlice([{ tag: '00100020', vr: 'LO', value: 'Example^Patient' }]));
    for (const key of ['a', 'b', 'c', 'd']) await index(key);

    const [a, b, c, d] = saved.map((record) => record.findings[0]?.valueDigest);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });

  it('keys the digest with the configured key when there is one', async () => {
    vi.stubEnv('OCI_ENV', 'dev');
    vi.stubEnv('OCI_DICOM_FINDING_DIGEST_KEY', 'a-deployed-key');
    svc = build();
    store('demo/1/named.dcm', ctSlice([NAME]));

    await index('demo/1/named.dcm');

    expect(saved[0]?.findings[0]?.valueDigest).toBe(
      digest('PatientName', 'Example^Patient', 'a-deployed-key'),
    );
  });

  it('reads further when the header is longer than the first read', async () => {
    // 100 KB of a harmless element in front of the geometry and the pixel data.
    const file = ctSlice([{ tag: '00189999', vr: 'OB', value: new Uint8Array(100_000) }]);
    store('demo/1/long-header.dcm', file);

    await expect(index('demo/1/long-header.dcm')).resolves.toBe('CLEAR');

    expect(ranges).toEqual(['bytes=0-65535', `bytes=0-${file.length - 1}`]);
    expect(saved[0]?.parsed?.header.rows).toBe(4);
  });

  it('takes the size of the file from storage, not from the caller', async () => {
    const file = ctSlice();
    objects.set('demo/1/short.dcm', { head: file, size: file.length });

    await index('demo/1/short.dcm');

    // One read was enough: storage said where the file ends.
    expect(ranges).toEqual(['bytes=0-65535']);
    expect(saved[0]?.checkStatus).toBe('CLEAR');
  });

  it('records a marked file it cannot read as UNREADABLE, which is held', async () => {
    store('demo/1/deflated.dcm', ctSlice([NAME], '1.2.840.10008.1.2.1.99'));

    await expect(index('demo/1/deflated.dcm')).resolves.toBe('UNREADABLE');

    expect(saved[0]).toMatchObject({
      checkStatus: 'UNREADABLE',
      unreadableReason: 'the deflated transfer syntax is not supported',
      parsed: null,
      findings: [],
    });
  });

  it('holds a file whose uncompressed pixel data is followed by more content', async () => {
    const file = buildPart10([
      { tag: '00080060', vr: 'CS', value: 'CT' },
      { tag: '00280010', vr: 'US', value: 4 },
      { tag: '00280011', vr: 'US', value: 4 },
      { tag: '7fe00010', vr: 'OW', value: new Uint8Array(32) },
      { tag: '00100010', vr: 'PN', value: 'After^Pixels' },
    ]);
    store('demo/1/trailing.dcm', file);

    await expect(index('demo/1/trailing.dcm')).resolves.toBe('HELD');
    expect(saved[0]?.findings.map((f) => f.attribute)).toEqual(['DataAfterPixelData']);
  });
});

describe('DicomIndexService on real compressed headers (the end of the file is checked)', () => {
  interface Entry {
    file: string;
    headerBytes: number;
    originalBytes: number;
  }
  const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.json'), 'utf8')) as Entry[];
  const jpegLs = manifest.find((entry) => entry.file.startsWith('jpeg-ls'));
  if (!jpegLs) throw new Error('fixture manifest has no JPEG-LS entry');
  const head = new Uint8Array(readFileSync(join(fixtures, jpegLs.file)));

  it('reads the header and the last eight bytes, and nothing in between', async () => {
    objects.set('demo/1/jls.dcm', { head, size: jpegLs.originalBytes, tail: DELIMITER });

    await expect(index('demo/1/jls.dcm')).resolves.toBe('HELD');

    expect(ranges).toEqual([
      'bytes=0-65535',
      `bytes=${jpegLs.originalBytes - 8}-${jpegLs.originalBytes - 1}`,
    ]);
    const attributes = saved[0]?.findings.map((f) => f.attribute) ?? [];
    // The archive's own codes and dates: held until an operator decides.
    expect(attributes).toEqual(expect.arrayContaining(['PatientID', 'PatientName', 'StudyDate']));
    expect(attributes).not.toContain('DataAfterPixelData');
    expect(saved[0]?.parsed?.header).toMatchObject({
      transferSyntaxUid: '1.2.840.10008.1.2.4.80',
      modality: 'CT',
      rows: 512,
    });
    expect(JSON.stringify(saved)).not.toContain('573377');
    expect(JSON.stringify(saved)).not.toContain('RIDER-');
  });

  it('adds a finding when the file does not end where its pixel data ends', async () => {
    const notTheEnd = new Uint8Array([0x10, 0x00, 0x10, 0x00, 0x50, 0x4e, 0x04, 0x00]);
    objects.set('demo/1/jls-trailing.dcm', { head, size: jpegLs.originalBytes, tail: notTheEnd });

    await index('demo/1/jls-trailing.dcm');

    expect(saved[0]?.findings.map((f) => f.attribute)).toContain('DataAfterPixelData');
  });
});

describe('DicomIndexService fails closed', () => {
  it('refuses a file with findings when no digest key is configured', async () => {
    vi.stubEnv('OCI_ENV', 'dev');
    svc = build();
    store('demo/1/named.dcm', ctSlice([NAME]));

    await expect(index('demo/1/named.dcm')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(saved).toEqual([]);
    expect(logged.join('\n')).toContain('OCI_DICOM_FINDING_DIGEST_KEY is not set');
  });

  it('still accepts a clean file without a key: there is nothing to digest', async () => {
    vi.stubEnv('OCI_ENV', 'dev');
    svc = build();
    store('demo/1/clean.dcm', ctSlice());

    await expect(index('demo/1/clean.dcm')).resolves.toBe('CLEAR');
  });

  it('throws when storage cannot be read, so the caller writes no row', async () => {
    await expect(index('demo/1/missing.dcm')).rejects.toThrow('NoSuchKey');
    expect(saved).toEqual([]);
  });

  it('throws when storage does not say how large the file is', async () => {
    const s3 = {
      bucket: BUCKET,
      client: {
        send: vi.fn(async () => ({ Body: { transformToByteArray: async () => ctSlice() } })),
      },
    };
    const service = new DicomIndexService(
      s3 as unknown as S3ClientProvider,
      { save: vi.fn() } as unknown as DicomIndexRepository,
      audit as unknown as AuditEmitter,
    );

    await expect(
      service.indexStoredObject({ datasetId: DATASET_ID, s3Bucket: BUCKET, s3Key: 'k' }),
    ).rejects.toThrow('did not report the size');
  });

  it('throws when the outcome cannot be recorded', async () => {
    const s3 = { bucket: BUCKET, client: { send: vi.fn(s3Send) } };
    const repo = { save: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new DicomIndexService(
      s3 as unknown as S3ClientProvider,
      repo as unknown as DicomIndexRepository,
      audit as unknown as AuditEmitter,
    );
    store('demo/1/named.dcm', ctSlice([NAME]));

    await expect(
      service.indexStoredObject({
        datasetId: DATASET_ID,
        s3Bucket: BUCKET,
        s3Key: 'demo/1/named.dcm',
      }),
    ).rejects.toThrow('database unavailable');
  });
});

describe('DicomIndexService: the digest key stays out of logs and responses (#784)', () => {
  // Distinctive, so a leak of any of it is found by substring.
  const SECRET = 'leak-canary-Dq7Xw2Vb9Np4Lm6Kc8Rt1Hs5Jd3Fg0Yu';

  function withKey(): DicomIndexService {
    vi.stubEnv('OCI_ENV', 'prod');
    vi.stubEnv('OCI_DICOM_FINDING_DIGEST_KEY', SECRET);
    return build();
  }

  it('is not in the instance as JSON.stringify, util.inspect or its own properties see it', () => {
    const service = withKey();
    expect(JSON.stringify(service)).not.toContain(SECRET);
    expect(inspect(service, { showHidden: true, depth: null })).not.toContain(SECRET);
    expect(JSON.stringify({ ...service })).not.toContain(SECRET);
  });

  it('is not logged at startup', () => {
    withKey();
    expect(logged).toEqual([]);
  });

  it('is still the key the digests are made with, and is not part of what is stored', async () => {
    svc = withKey();
    store('demo/1/named.dcm', ctSlice([NAME]));

    await index('demo/1/named.dcm');

    expect(saved[0]?.findings[0]?.valueDigest).toBe(
      digest('PatientName', 'Example^Patient', SECRET),
    );
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
  });
});

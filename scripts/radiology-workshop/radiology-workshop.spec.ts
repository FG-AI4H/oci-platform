import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validate } from '@oci/croissant';
import { CampaignWorkflowConfigSchema, IntendedUseStatementSchema } from '@oci/shared-types';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { campaignInstructionsFr, campaignLabels, modelCards, termsStatement } from './content.js';
import { parseCsv } from './csv.js';
import { prepareImages } from './fetch.js';
import { buildProfileOutputs, GenerateError } from './generate.js';
import { METADATA_HEADER } from './manifest.js';
import { encodeGreyPng, readPngSize } from './png.js';
import {
  AGE_BANDS,
  CAMPAIGN_SIZE,
  DATASET_SLUG,
  MODEL_B_WEAK_AGE_BAND,
  PROFILE_DIR,
  SEED,
  SEXES,
  SLICE_SIZE,
  sha256Hex,
} from './profile.js';
import { selectImages, selectionQuotas, SelectionError } from './select.js';
import { parseHiddenLabels, parseSelection, type Selection } from './selection-file.js';
import { instructionsVersion } from './seed-sql.js';
import {
  renderStandInImage,
  STAND_IN_FINDING,
  STAND_IN_LABELS_FILE,
  STAND_IN_METADATA_FILE,
  standInUpstream,
} from './standin.js';
import { readPredictionsCsv } from './teaching-files.js';
import { labelsFromAdjudicatedFile, labelsFromReportMining, readNihMetadata } from './upstream.js';

/**
 * The workshop tooling against SYNTHETIC stand-in files only (#644). No real
 * image, metadata or label file is read here or anywhere in the repository.
 * The numeric proof that the teaching files score as designed runs against
 * the real scorer and validation path in
 * apps/api/src/seed-profiles/radiology-workshop.int.spec.ts.
 */

const OPTIONS = {
  seed: SEED,
  size: SLICE_SIZE,
  campaignSize: CAMPAIGN_SIZE,
  prevalence: 0.4,
  views: ['PA'],
};

const upstream = standInUpstream(SEED);
const pool = readNihMetadata(upstream.metadataCsv);
const poolLabels = labelsFromAdjudicatedFile(upstream.labelsCsv, STAND_IN_FINDING);

const committed = (relative: string) => readFileSync(path.join(PROFILE_DIR, relative), 'utf8');
const committedSelection = parseSelection(committed('selection.json'));
const committedLabels = parseHiddenLabels(
  committed('reference-labels.hidden.csv'),
  committedSelection,
);

const silent = { out: () => undefined, err: () => undefined };
const scratch: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'oci-rw-'));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  // Retries: on a busy machine a recursive delete can meet a directory the
  // system has not finished emptying, and a leftover temp directory is no
  // reason to fail the suite.
  for (const dir of scratch) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('upstream readers', () => {
  it('reads both age formats and leaves out children, implausible ages and unknown sex', () => {
    const csv = [
      'Image Index,Finding Labels,Follow-up #,Patient ID,Patient Age,Patient Gender,View Position,',
      'a_000.png,No Finding,0,1,058Y,M,PA,',
      'b_000.png,Effusion|Nodule,0,2,61,F,AP,',
      'c_000.png,No Finding,0,3,7,F,PA,',
      'd_000.png,No Finding,0,4,414,M,PA,',
      'e_000.png,No Finding,0,5,010M,F,PA,',
      'f_000.png,No Finding,0,6,40,O,PA,',
    ].join('\n');
    const { images, excluded } = readNihMetadata(csv);
    expect(images.map((i) => [i.imageId, i.ageBand, i.sex, i.view])).toEqual([
      ['a_000', '40-59', 'M', 'PA'],
      ['b_000', '60+', 'F', 'AP'],
    ]);
    expect(images.at(1)?.findings).toEqual(['Effusion', 'Nodule']);
    expect(excluded.get('age missing, implausible or under 18')).toBe(3);
    expect(excluded.get('sex is neither F nor M')).toBe(1);
  });

  it('refuses a file with other column names and says which ones it has', () => {
    expect(() => readNihMetadata('Image,Labels\nx.png,No Finding\n')).toThrow(
      /column\(s\) not found: Image Index, .*The file has: Image, Labels/,
    );
  });

  it('takes report-mined labels from the finding list and refuses an unknown finding', () => {
    const labels = labelsFromReportMining(pool.images, 'Effusion');
    expect(new Set(labels.values())).toEqual(new Set([0, 1]));
    expect(() => labelsFromReportMining(pool.images, 'Opacity')).toThrow(/Findings in the file/);
  });

  it('gives no label to an image the adjudicated file leaves empty, and refuses other values', () => {
    const labels = labelsFromAdjudicatedFile(
      'Image Index,Airspace opacity\na.png,YES\nb.png,NO\nc.png,\n',
      'Airspace opacity',
    );
    expect([...labels]).toEqual([
      ['a.png', 1],
      ['b.png', 0],
    ]);
    expect(() =>
      labelsFromAdjudicatedFile('Image Index,Airspace opacity\na.png,HEDGE\n', 'Airspace opacity'),
    ).toThrow(/expected YES, NO or empty/);
  });
});

describe('selection rule', () => {
  const result = selectImages(pool.images, poolLabels, OPTIONS);
  const byId = new Map(pool.images.map((i) => [i.imageId, i]));

  it('fills six strata of equal size with the same share of findings', () => {
    const quotas = selectionQuotas(OPTIONS);
    expect(quotas.map((q) => q.positives + q.negatives)).toEqual([34, 33, 33, 33, 33, 34]);
    expect(quotas.map((q) => q.positives)).toEqual([14, 13, 13, 13, 13, 14]);
    expect(quotas.map((q) => q.campaignPositives + q.campaignNegatives)).toEqual(
      Array.from({ length: 6 }, () => 10),
    );
    expect(result.images).toHaveLength(SLICE_SIZE);
    for (const sex of SEXES) {
      expect(result.images.filter((i) => i.sex === sex)).toHaveLength(100);
    }
    expect(AGE_BANDS.map((b) => result.images.filter((i) => i.ageBand === b).length)).toEqual([
      67, 66, 67,
    ]);
    expect([...result.labels.values()].filter((l) => l === 1)).toHaveLength(80);
  });

  it('keeps one image per patient, and only the projection asked for', () => {
    const patients = result.images.map((i) => byId.get(i.imageId)?.patientId);
    expect(new Set(patients).size).toBe(SLICE_SIZE);
    expect(new Set(result.images.map((i) => byId.get(i.imageId)?.view))).toEqual(new Set(['PA']));
  });

  it('marks a reading subset with the same balance', () => {
    const subset = result.images.filter((i) => i.campaign);
    expect(subset).toHaveLength(CAMPAIGN_SIZE);
    for (const sex of SEXES) {
      for (const band of AGE_BANDS) {
        const cell = subset.filter((i) => i.sex === sex && i.ageBand === band);
        expect(cell).toHaveLength(10);
        expect(cell.filter((i) => result.labels.get(i.imageId) === 1)).toHaveLength(4);
      }
    }
  });

  it('is the same selection every time, whatever the order of the input', () => {
    const again = selectImages([...pool.images].reverse(), poolLabels, OPTIONS);
    expect(again.images).toEqual(result.images);
    expect([...again.labels].sort()).toEqual([...result.labels].sort());
  });

  it('stops with the shortfall, and selects nothing, when a cell cannot be filled', () => {
    const men = pool.images.filter((i) => i.sex === 'M');
    expect(() => selectImages(men, poolLabels, OPTIONS)).toThrow(SelectionError);
    expect(() => selectImages(men, poolLabels, OPTIONS)).toThrow(
      /F\/18-39\/present: need 14, found 0[\s\S]*Nothing was selected/,
    );
  });
});

describe('generated files', () => {
  let outputs: Awaited<ReturnType<typeof buildProfileOutputs>>;
  beforeAll(async () => {
    outputs = await buildProfileOutputs(committedSelection, committedLabels);
  });

  it('the committed profile is exactly what the generator writes', () => {
    expect([...outputs.files.keys()].sort()).toEqual([
      `fixtures/${DATASET_SLUG}/manifest.json`,
      `fixtures/${DATASET_SLUG}/metadata.csv`,
      `fixtures/${DATASET_SLUG}/model-a.csv`,
      `fixtures/${DATASET_SLUG}/model-b.csv`,
      `fixtures/${DATASET_SLUG}/model-c.csv`,
      'reset.json',
      'seed.sql',
    ]);
    for (const [relative, content] of outputs.files) {
      expect(committed(relative), relative).toBe(content);
    }
  });

  it('the manifest is valid Croissant 1.1 and carries the terms and the three attributions', () => {
    const report = validate(outputs.manifest);
    expect(report.issues).toEqual([]);
    expect(report.conformance).toBe('croissant-1.1');
    expect(report.hasRai).toBe(true);
    expect(report.hasBioCroissant).toBe(true);
    const manifest = outputs.manifest;
    expect(manifest['url']).toBe('https://nihcc.app.box.com/v/ChestXray-NIHCC');
    expect(manifest['citeAs']).toContain('ChestX-ray8');
    expect(manifest['creditText']).toContain('NIH Clinical Center');
    for (const needle of ['nihcc.app.box.com', 'NIH Clinical Center', 'IEEE CVPR 2017']) {
      expect(manifest['description']).toContain(needle);
    }
  });

  it('says the README has not been read until its text is recorded, then quotes it with its date', () => {
    expect(committedSelection.source.readme).toBeNull();
    expect(outputs.manifest['dct:rights']).toMatch(/^PLACEHOLDER, TO BE REPLACED/);
    expect(outputs.manifest['dct:rights']).toContain('third parties');
    const recorded: Selection = {
      ...committedSelection,
      source: {
        ...committedSelection.source,
        readme: { file: 'README.pdf', recordedOn: '2026-11-25', text: 'Invented text for a test.' },
      },
    };
    expect(termsStatement(recorded)).toBe(
      'README of the source download (README.pdf), text recorded on 2026-11-25: Invented text for a test.',
    );
  });

  it('refuses to prepare real data before the README has been recorded', async () => {
    const real: Selection = { ...committedSelection, standIn: false };
    await expect(buildProfileOutputs(real, committedLabels)).rejects.toThrow(GenerateError);
  });

  it('publishes image id, sex and age band, and no reference label anywhere', () => {
    const recordSet = (outputs.manifest['recordSet'] as { field: { name: string }[] }[]).at(0);
    expect(recordSet?.field.map((f) => f.name)).toEqual([...METADATA_HEADER]);

    const metadata = parseCsv(committed(`fixtures/${DATASET_SLUG}/metadata.csv`));
    expect(metadata.at(0)).toEqual(['image_id', 'sex', 'age_band']);
    expect(metadata).toHaveLength(SLICE_SIZE + 1);

    const listed = (outputs.manifest['distribution'] as { name: string }[]).map((d) => d.name);
    expect(listed).toHaveLength(SLICE_SIZE + 4);
    expect(listed.some((name) => name.includes('hidden') || name.includes('label'))).toBe(false);
    // Only files the manifest lists are ever uploaded, and the hidden file is not beside them.
    expect(readdirSync(path.join(PROFILE_DIR, 'fixtures', DATASET_SLUG)).sort()).toEqual([
      'manifest.json',
      'metadata.csv',
      'model-a.csv',
      'model-b.csv',
      'model-c.csv',
    ]);
    // The selection has no label field at all, so nothing built from it alone can leak one.
    expect(Object.keys(committedSelection.images.at(0) ?? {}).sort()).toEqual([
      'ageBand',
      'campaign',
      'file',
      'hosted',
      'imageId',
      'sex',
      'upstream',
    ]);
    expect(committed('selection.json')).not.toMatch(/"label"\s*:|finding_present/i);
  });

  it('models A and B make the same errors in number, placed differently', () => {
    const errorsOf = (file: string) => {
      const rows = readPredictionsCsv(committed(`fixtures/${DATASET_SLUG}/${file}`));
      expect(rows).toHaveLength(SLICE_SIZE);
      const bands = new Map(committedSelection.images.map((i) => [i.imageId, i.ageBand]));
      const wrong = rows.filter((r) => r.grade !== committedLabels.get(r.imageId));
      return {
        missed: wrong.filter((r) => r.grade === 0).length,
        falseAlarms: wrong.filter((r) => r.grade === 1).length,
        inWeakBand: wrong.filter((r) => bands.get(r.imageId) === MODEL_B_WEAK_AGE_BAND).length,
      };
    };
    expect(errorsOf('model-a.csv')).toEqual({ missed: 8, falseAlarms: 12, inWeakBand: 7 });
    expect(errorsOf('model-b.csv')).toEqual({ missed: 8, falseAlarms: 12, inWeakBand: 18 });
    expect(outputs.design).toEqual({
      weakAgeBand: MODEL_B_WEAK_AGE_BAND,
      falseNegatives: 8,
      falsePositives: 12,
    });
  });

  it('model C holds the four mistakes the format check is there to catch', () => {
    const rows = readPredictionsCsv(committed(`fixtures/${DATASET_SLUG}/model-c.csv`));
    const ids = rows.map((r) => r.imageId);
    expect(ids.filter((id) => id.endsWith('.png'))).toHaveLength(5);
    expect(rows.filter((r) => r.grade === 2)).toHaveLength(4);
    expect(ids.length - new Set(ids).size).toBe(3);
    const known = new Set(committedSelection.images.map((i) => i.imageId));
    expect([...known].filter((id) => !ids.includes(id))).toHaveLength(15); // 10 left out, 5 renamed
  });

  it('the campaign is configured as decided and its instructions are French, with a stable version', () => {
    const sql = committed('seed.sql');
    const workflow = /'(\{"nAnnotators":[^']+\})'::jsonb/.exec(sql)?.[1] ?? '';
    expect(CampaignWorkflowConfigSchema.parse(JSON.parse(workflow))).toMatchObject({
      nAnnotators: 3,
      taskTimeoutHours: 1,
      // The evaluation task's classes, 0 absent and 1 present, in French, with
      // « Non interprétable » after them (#646 shape).
      classificationLabels: {
        labels: [
          { value: '0', display: 'Absent' },
          { value: '1', display: 'Présent' },
        ],
        cannotAssess: true,
        allowComment: true,
      },
    });
    // The same set is what a campaign seeded before the labels gets, once.
    expect(sql).toContain(
      `jsonb_build_object('classificationLabels', '${JSON.stringify(campaignLabels())}'::jsonb)`,
    );
    const instructions = campaignInstructionsFr(committedSelection);
    expect(instructions).toContain('Lecture de radiographies thoraciques');
    expect(instructions).toContain('sans valeur diagnostique'); // stand-in notice
    // The instructions name the answers the screen offers, with their keys.
    expect(instructions).toContain('**Absent** (touche 1)');
    expect(instructions).toContain('**Présent** (touche 2)');
    expect(instructions).toContain('**Non interprétable** (touche 0)');
    expect(instructionsVersion(instructions)).toMatch(/^[0-9a-f]{16}$/);
    expect(sql).toContain(`'${instructionsVersion(instructions)}'`);
    expect(sql).toContain('\'READY\'::"annotation"."CampaignStatus"');
  });

  it('creates one reading task per flagged image, found by file name and hash, never by id', () => {
    const sql = committed('seed.sql');
    const block = /DO \$workshop_reading_tasks\$([\s\S]*?)END \$workshop_reading_tasks\$;/.exec(
      sql,
    )?.[1];
    expect(block).toBeDefined();
    const flagged = committedSelection.images.filter((i) => i.campaign);
    expect(flagged).toHaveLength(CAMPAIGN_SIZE);
    const quoted = (array: string) =>
      [
        ...(
          new RegExp(`${array}\\s+CONSTANT text\\[\\] := ARRAY\\[([^\\]]*)\\]`).exec(
            block ?? '',
          )?.[1] ?? ''
        ).matchAll(/'([^']+)'/g),
      ].map((m) => m[1]);
    expect(quoted('files')).toEqual(flagged.map((i) => i.file));
    expect(quoted('hashes')).toEqual(flagged.map((i) => i.hosted?.sha256));
    // No distribution id and no storage key in the block: they are resolved.
    expect(block).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(block).not.toContain(`${DATASET_SLUG}/`);
    expect(block).toContain("'file:' || r.distribution_id::text");
  });

  it('both model cards carry a valid intended-use statement, and model A a complete one', () => {
    const cards = modelCards(committedSelection);
    const a = IntendedUseStatementSchema.parse(cards.modelA.intendedUse);
    IntendedUseStatementSchema.parse(cards.modelB.intendedUse);
    expect(cards.modelA.status).toBe('PUBLISHED');
    expect(cards.modelB.status).toBe('DRAFT');
    // Every field of the statement is filled in, none left undefined or empty.
    const filled = new Map(Object.entries(a).filter(([, value]) => Boolean(value)));
    expect([...filled.keys()].sort()).toEqual([
      'bodySystemOrSite',
      'contraindications',
      'foreseeableMisuse',
      'intendedClinicalPathway',
      'intendedUserRole',
      'medicalPurpose',
      'operatingEnvironment',
      'operatingPrinciple',
      'riskTier',
      'targetPopulation',
      'v',
    ]);
    expect(cards.modelA.developerContact).toMatch(/\.example$/);
  });
});

describe('the whole pipeline on stand-in files', () => {
  it('reproduces the committed profile from nothing, byte for byte', async () => {
    const up = tmp();
    const work = tmp();
    const profileDir = tmp();
    const at = ['--profile-dir', profileDir];
    const steps: string[][] = [
      ['standin', '--dir', up],
      [
        'select',
        '--metadata',
        path.join(up, STAND_IN_METADATA_FILE),
        '--labels',
        path.join(up, STAND_IN_LABELS_FILE),
        '--label-source',
        'adjudicated',
        '--finding',
        STAND_IN_FINDING,
        '--finding-fr',
        committedSelection.finding.nameFr,
        '--stand-in',
        '--prepared-on',
        committedSelection.preparedOn,
      ],
      ['standin-images', '--dir', path.join(up, 'images')],
      [
        'fetch',
        '--source-dir',
        up,
        '--work-dir',
        work,
        '--pin',
        '--fetched-from',
        committedSelection.source.imagesFetchedFrom ?? '',
      ],
      ['generate', '--work-dir', work],
      ['check'],
    ];
    for (const step of steps) {
      expect(await run([...step, ...at], silent), step.at(0)).toBe(0);
    }
    for (const relative of [
      'selection.json',
      'reference-labels.hidden.csv',
      'reset.json',
      'seed.sql',
      `fixtures/${DATASET_SLUG}/manifest.json`,
      `fixtures/${DATASET_SLUG}/metadata.csv`,
      `fixtures/${DATASET_SLUG}/model-a.csv`,
      `fixtures/${DATASET_SLUG}/model-b.csv`,
      `fixtures/${DATASET_SLUG}/model-c.csv`,
    ]) {
      expect(readFileSync(path.join(profileDir, relative), 'utf8'), relative).toBe(
        committed(relative),
      );
    }
    // The work directory is what the uploader is pointed at: manifest, bundled files, images.
    expect(readdirSync(path.join(work, DATASET_SLUG))).toHaveLength(SLICE_SIZE + 5);

    // A second fetch verifies against the pinned checksums and changes nothing.
    const before = readFileSync(path.join(profileDir, 'selection.json'), 'utf8');
    expect(await run(['fetch', '--source-dir', up, '--work-dir', work, ...at], silent)).toBe(0);
    expect(readFileSync(path.join(profileDir, 'selection.json'), 'utf8')).toBe(before);
  }, 120_000);

  it('refuses to upload to a prod bucket, or a stand-in to a deployed environment', async () => {
    const lines: string[] = [];
    const io = { out: () => undefined, err: (line: string) => lines.push(line) };
    expect(await run(['upload', '--work-dir', tmp(), '--bucket', 'oci-prod-datasets'], io)).toBe(2);
    expect(await run(['upload', '--work-dir', tmp(), '--bucket', 'oci-dev-datasets'], io)).toBe(2);
    expect(lines.join('\n')).toMatch(/never goes to prod[\s\S]*synthetic stand-in/);
  });
});

describe('fetch, verify, resize', () => {
  const three: Selection = {
    ...committedSelection,
    images: committedSelection.images.slice(0, 3),
  };
  const sourceWith = (files: Map<string, Buffer>) => {
    const dir = tmp();
    for (const [name, bytes] of files) writeFileSync(path.join(dir, name), bytes);
    return dir;
  };
  const standIns = () => new Map(three.images.map((i) => [i.file, renderStandInImage(i.file)]));

  it('hosts a file within the limit byte for byte', async () => {
    const workDir = tmp();
    const result = await prepareImages({
      selection: three,
      sourceDir: sourceWith(standIns()),
      workDir,
      pin: false,
    });
    expect(result).toMatchObject({ pinned: 0, resized: 0, downloaded: 0 });
    for (const image of result.selection.images) {
      const hosted = readFileSync(path.join(workDir, DATASET_SLUG, image.file));
      expect(sha256Hex(hosted)).toBe(image.upstream?.sha256);
      expect(image.hosted?.sha256).toBe(image.upstream?.sha256);
    }
  });

  it('stops on a checksum mismatch and names the file', async () => {
    const files = standIns();
    const victim = three.images.at(1)?.file ?? '';
    files.set(victim, renderStandInImage('standin_tampered.png'));
    await expect(
      prepareImages({ selection: three, sourceDir: sourceWith(files), workDir: tmp(), pin: true }),
    ).rejects.toThrow(new RegExp(`${victim}: checksum mismatch`));
  });

  it('refuses an unpinned file unless asked to pin', async () => {
    const unpinned: Selection = {
      ...three,
      images: three.images.map((i) => ({ ...i, upstream: null, hosted: null })),
    };
    const sourceDir = sourceWith(standIns());
    await expect(
      prepareImages({ selection: unpinned, sourceDir, workDir: tmp(), pin: false }),
    ).rejects.toThrow(/has no pinned checksum/);
    const pinned = await prepareImages({
      selection: unpinned,
      sourceDir,
      workDir: tmp(),
      pin: true,
    });
    expect(pinned.pinned).toBe(3);
    expect(pinned.selection.images).toEqual(three.images);
  });

  it('shrinks a larger image to 1024 px on its longest side and keeps it a readable PNG', async () => {
    const file = three.images.at(0)?.file ?? '';
    const large = encodeGreyPng(Buffer.alloc(1280 * 1040, 90), 1280, 1040);
    expect(readPngSize(large)).toEqual({ width: 1280, height: 1040 });
    const one: Selection = {
      ...three,
      images: three.images.slice(0, 1).map((i) => ({ ...i, upstream: null, hosted: null })),
    };
    const workDir = tmp();
    const result = await prepareImages({
      selection: one,
      sourceDir: sourceWith(new Map([[file, large]])),
      workDir,
      pin: true,
    });
    expect(result.resized).toBe(1);
    expect(result.selection.images.at(0)?.hosted).toMatchObject({ width: 1024, height: 832 });
    const meta = await sharp(readFileSync(path.join(workDir, DATASET_SLUG, file))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1024, 832]);
    // The hand-written encoder is read by a real decoder, pixel for pixel.
    const decoded = await sharp(renderStandInImage(file))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([256, 256]);
  });

  describe('from an upstream address', () => {
    let server: Server;
    let baseUrl: string;
    beforeAll(async () => {
      const files = standIns();
      server = createServer((req, res) => {
        const body = files.get(path.basename(req.url ?? ''));
        res.writeHead(body ? 200 : 404).end(body);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/png/`;
    });
    afterAll(() => server.close());

    it('downloads what is missing, verifies it and records where it came from', async () => {
      const sourceDir = tmp();
      mkdirSync(sourceDir, { recursive: true });
      const result = await prepareImages({
        selection: three,
        sourceDir,
        workDir: tmp(),
        pin: false,
        baseUrl,
      });
      expect(result.downloaded).toBe(3);
      expect(result.selection.source.imagesFetchedFrom).toBe(baseUrl);
      expect(readdirSync(sourceDir)).toHaveLength(3);
    });

    it('refuses a plain http address that is not this machine', async () => {
      await expect(
        prepareImages({
          selection: three,
          sourceDir: tmp(),
          workDir: tmp(),
          pin: false,
          baseUrl: 'http://example.org/png/',
        }),
      ).rejects.toThrow(/must be an https address/);
    });
  });
});

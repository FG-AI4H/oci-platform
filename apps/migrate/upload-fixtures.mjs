// Idempotent S3 uploader for OCI-bundled dataset fixtures (#251).
// Walks every fixture directory under ./seed/fixtures/ and uploads
// each PNG to the datasets bucket under the platform's expected key
// shape. HEAD-checks before PUT so re-runs are no-ops.
//
// Invoked by `apps/migrate/entrypoint.sh` after `prisma migrate
// deploy` and before `prisma db execute --file seed/demo.sql`, only
// when `OCI_ENV != 'prod'`. The demo SQL seed references the same
// keys the bytes were uploaded to.
//
// Env contract (set by the migrate task definition):
//   OCI_DATASETS_BUCKET    Bucket name (e.g. oci-datasets-dev)
//   AWS_REGION             For the SDK signer
//   S3_ENDPOINT (optional) MinIO-style endpoint for local; absent in prod
//
// Each fixture directory is expected to contain a `manifest.json` (the
// Croissant manifest) plus the FileObject files it references. We
// look up files by `name` and key them as:
//
//   <dataset-slug>/<distribution-@id>/<filename>
//
// — exactly mirroring what the demo SQL inserts on the row, so the
// platform's `/download` route reads from the same S3 key.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUCKET = process.env.OCI_DATASETS_BUCKET;
const REGION = process.env.AWS_REGION ?? 'eu-central-1';
const ENDPOINT = process.env.S3_ENDPOINT;

if (!BUCKET) {
  console.warn('seed-fixtures: OCI_DATASETS_BUCKET not set — skipping fixture upload');
  process.exit(0);
}

const s3 = new S3Client({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
});

// Default path in the deployed migrate image (`COPY packages/database/
// seed ./seed` writes to `/app/seed`). `SEED_FIXTURES_DIR` overrides
// the path for local invocation against the repo layout.
const fixturesRoot =
  process.env.SEED_FIXTURES_DIR ?? join(__dirname, 'seed', 'fixtures');

let fixtureDirs;
try {
  fixtureDirs = readdirSync(fixturesRoot).filter((d) => {
    const stat = statSync(join(fixturesRoot, d));
    return stat.isDirectory();
  });
} catch (err) {
  console.warn(`seed-fixtures: no fixtures directory at ${fixturesRoot} — skipping`);
  process.exit(0);
}

let uploaded = 0;
let skipped = 0;

for (const slug of fixtureDirs) {
  const fixtureDir = join(fixturesRoot, slug);
  const manifestPath = join(fixtureDir, 'manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.warn(`seed-fixtures: ${slug} has no manifest.json — skipping directory`);
    continue;
  }

  const distributions = manifest.distribution ?? manifest['sc:distribution'] ?? [];
  if (!Array.isArray(distributions) || distributions.length === 0) {
    console.warn(`seed-fixtures: ${slug} manifest has no distribution[] — skipping`);
    continue;
  }

  for (const dist of distributions) {
    const distId = dist['@id'];
    const filename = dist.name;
    if (!distId || !filename) {
      console.warn(`seed-fixtures: ${slug} distribution missing @id or name — skipping entry`);
      continue;
    }

    const filePath = join(fixtureDir, filename);
    let body;
    try {
      body = readFileSync(filePath);
    } catch (err) {
      console.warn(`seed-fixtures: ${slug}/${filename} not found in fixture dir — skipping`);
      continue;
    }

    const key = `${slug}/${distId}/${filename}`;
    const contentType = dist.encodingFormat ?? 'application/octet-stream';

    // HEAD first to keep re-runs idempotent. If the object already
    // exists and matches our content-length, skip the PUT.
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      // 404 / NotFound is expected on first run; anything else is real.
      const code = err?.$metadata?.httpStatusCode;
      if (code !== undefined && code !== 404) {
        throw err;
      }
    }

    if (head && head.ContentLength === body.length) {
      skipped++;
      continue;
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    uploaded++;
    console.log(`seed-fixtures: PUT s3://${BUCKET}/${key} (${body.length} B)`);
  }
}

console.log(`seed-fixtures: done — uploaded=${uploaded} skipped=${skipped}`);

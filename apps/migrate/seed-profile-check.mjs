// Is a seed profile ready to be replayed? (#644)
//
// A profile (`seed/profiles/<name>/`) may host files that are too large to
// keep in the repository: an operator uploads them to the datasets bucket
// once. Its seed SQL writes file rows marked READY, so replaying it before
// the bytes are there would publish download links that lead nowhere.
//
// This check answers one question before `entrypoint.sh` replays a profile:
// is every file its manifests list either bundled in the image or already in
// the bucket, with the size and the sha256 the manifest states?
//
// Exit 0: ready, replay it. Any other exit: NOT ready, skip the profile.
// The entrypoint never fails the deploy on this check: a profile that is not
// ready is skipped with one line in the log, and the rest of the deploy goes
// on. A problem inside the profile's SQL is a different matter and does fail.
//
// A profile whose `selection.json` says `"standIn": true` holds synthetic
// placeholder content. It is replayed only when OCI_ENV=local or
// OCI_SEED_ALLOW_STANDIN=1 (tests), never on a deployed environment: a
// stand-in answer key, once written, would block the real one (#464).
//
// Usage: node seed-profile-check.mjs <profile>
// Env:   OCI_ENV, OCI_DATASETS_BUCKET, AWS_REGION, S3_ENDPOINT (optional),
//        SEED_PROFILES_DIR (optional), OCI_SEED_ALLOW_STANDIN (optional)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const NOT_READY = 3;
const __dirname = dirname(fileURLToPath(import.meta.url));
const profile = process.argv[2] ?? '';

function notReady(reason) {
  console.log(`seed-profile: ${profile || '(unnamed)'} NOT READY: ${reason}`);
  process.exit(NOT_READY);
}

try {
  if (!/^[a-z0-9-]{1,64}$/.test(profile)) notReady('the profile name is not valid');

  const profilesRoot = process.env.SEED_PROFILES_DIR ?? join(__dirname, 'seed', 'profiles');
  const profileDir = join(profilesRoot, profile);
  if (!existsSync(join(profileDir, 'seed.sql'))) notReady(`no seed.sql under ${profileDir}`);

  const selectionPath = join(profileDir, 'selection.json');
  const standIn =
    existsSync(selectionPath) && JSON.parse(readFileSync(selectionPath, 'utf8')).standIn === true;
  if (standIn && process.env.OCI_ENV !== 'local' && process.env.OCI_SEED_ALLOW_STANDIN !== '1') {
    notReady(
      'it holds synthetic stand-in content, which is never seeded on a deployed environment',
    );
  }

  const bucket = process.env.OCI_DATASETS_BUCKET;
  if (!bucket) notReady('OCI_DATASETS_BUCKET is not set');
  const endpoint = process.env.S3_ENDPOINT;
  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'eu-central-1',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  const fixturesRoot = join(profileDir, 'fixtures');
  const slugs = existsSync(fixturesRoot)
    ? readdirSync(fixturesRoot).filter((d) => statSync(join(fixturesRoot, d)).isDirectory())
    : [];

  let bundled = 0;
  let inBucket = 0;
  const problems = [];
  for (const slug of slugs) {
    const manifest = JSON.parse(readFileSync(join(fixturesRoot, slug, 'manifest.json'), 'utf8'));
    for (const dist of manifest.distribution ?? []) {
      const name = dist.name;
      // Without a sha256 there is nothing to hold a file to.
      if (typeof dist.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(dist.sha256)) {
        problems.push(`${slug}/${name}: the manifest states no sha256 for it`);
        continue;
      }
      const expectedSize = Number.parseInt(String(dist.contentSize ?? ''), 10);
      const local = join(fixturesRoot, slug, name);
      if (existsSync(local)) {
        const body = readFileSync(local);
        if (createHash('sha256').update(body).digest('hex') === dist.sha256) bundled += 1;
        else
          problems.push(`${slug}/${name}: the bundled file is not the one the manifest describes`);
        continue;
      }
      const key = `${slug}/${dist['@id']}/${name}`;
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (head.ContentLength !== expectedSize)
          problems.push(`${key}: size differs from the manifest`);
        else if (head.Metadata?.sha256 !== dist.sha256)
          problems.push(`${key}: sha256 differs from the manifest or was not recorded`);
        else inBucket += 1;
      } catch (err) {
        const status = err?.$metadata?.httpStatusCode;
        problems.push(
          status === 404
            ? `${key}: not in the bucket`
            : `${key}: ${err?.name ?? 'error'} (HTTP ${status ?? '?'})`,
        );
      }
    }
  }

  if (problems.length > 0) {
    for (const line of problems.slice(0, 5)) console.log(`seed-profile: ${profile}: ${line}`);
    notReady(
      `${problems.length} file(s) are not ready in s3://${bucket} (first ${Math.min(5, problems.length)} above). Upload them as described in docs/for-operators/demo-seed.md, then deploy again.`,
    );
  }
  console.log(
    `seed-profile: ${profile} ready: ${bundled} bundled file(s), ${inBucket} already in s3://${bucket}`,
  );
} catch (err) {
  notReady(`the check itself failed: ${err instanceof Error ? err.message : String(err)}`);
}

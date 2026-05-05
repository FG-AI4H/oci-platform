#!/usr/bin/env tsx
/**
 * One-shot seeder for the OCI catalog. Reads a Croissant manifest from
 * `apps/api/scripts/fixtures/`, creates the dataset record via
 * `POST /v2/catalog/datasets`, then publishes the manifest as version
 * 1.0.0 via `POST /v2/catalog/datasets/:slug/versions`.
 *
 * Usage (from repo root):
 *
 *   1. Sign in to https://dev.oci.ai4h.net as a `host` (or `admin`) user
 *      and copy the Cognito access token from the /dashboard page.
 *   2. Run:
 *
 *        ACCESS_TOKEN=<paste> \
 *        API_BASE=https://dev.oci.ai4h.net \
 *        pnpm --filter @oci/api tsx scripts/seed-catalog.ts \
 *          --slug idrid-2018 \
 *          --name "Indian Diabetic Retinopathy Image Dataset (IDRiD)" \
 *          --visibility RESTRICTED \
 *          --manifest scripts/fixtures/idrid.croissant.json
 *
 * The script is idempotent on re-runs: 409 on POST /datasets means the
 * slug already exists (we proceed to publish a new version); otherwise
 * the version POST fails with a clear "version already exists" error
 * which the operator should resolve by bumping --version.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, exit } from 'node:process';

interface Args {
  slug: string;
  name: string;
  visibility: 'PRIVATE' | 'RESTRICTED' | 'PUBLIC';
  description: string | null;
  manifest: string;
  version: string;
  notes: string | null;
}

function parseArgs(): Args {
  const out: Partial<Args> = {
    version: '1.0.0',
    visibility: 'RESTRICTED',
    description: null,
    notes: null,
  };
  for (let i = 2; i < argv.length; i++) {
    // Indices come from a bounded for-loop on argv; not user-controlled
    // outside the local scope. Suppressing the security plugin's broad
    // "object-injection" pattern check.
    /* eslint-disable security/detect-object-injection */
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (!v) throw new Error(`flag ${a} expects a value`);
      return v;
    };
    /* eslint-enable security/detect-object-injection */
    switch (a) {
      case '--slug':
        out.slug = next();
        break;
      case '--name':
        out.name = next();
        break;
      case '--visibility': {
        const v = next();
        if (v !== 'PRIVATE' && v !== 'RESTRICTED' && v !== 'PUBLIC') {
          throw new Error(`--visibility must be PRIVATE/RESTRICTED/PUBLIC, got ${v}`);
        }
        out.visibility = v;
        break;
      }
      case '--description':
        out.description = next();
        break;
      case '--manifest':
        out.manifest = next();
        break;
      case '--version':
        out.version = next();
        break;
      case '--notes':
        out.notes = next();
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!out.slug) throw new Error('--slug required');
  if (!out.name) throw new Error('--name required');
  if (!out.manifest) throw new Error('--manifest required');
  return out as Args;
}

async function main(): Promise<void> {
  const apiBase = env.API_BASE ?? 'https://dev.oci.ai4h.net';
  const token = env.ACCESS_TOKEN;
  if (!token) {
    console.error('ACCESS_TOKEN env required (Cognito access token from /dashboard).');
    exit(2);
  }

  const args = parseArgs();
  const manifestPath = resolve(process.cwd(), args.manifest);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied --manifest path is intentional
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Step 1: create dataset (200 on first run; 409 on retries — fine).
  console.log(`Creating dataset ${args.slug} (visibility=${args.visibility})…`);
  const createRes = await fetch(`${apiBase}/v2/catalog/datasets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      slug: args.slug,
      name: args.name,
      description: args.description,
      visibility: args.visibility,
    }),
  });
  if (createRes.status === 409) {
    console.log('  already exists; continuing to publish version.');
  } else if (!createRes.ok) {
    const body = await createRes.text();
    console.error(`  create failed: ${createRes.status} ${createRes.statusText}\n${body}`);
    exit(1);
  } else {
    console.log(`  created.`);
  }

  // Step 2: publish version with the manifest.
  console.log(`Publishing version ${args.version}…`);
  const publishRes = await fetch(
    `${apiBase}/v2/catalog/datasets/${encodeURIComponent(args.slug)}/versions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: args.version,
        croissant: manifest,
        notes: args.notes,
      }),
    },
  );
  if (!publishRes.ok) {
    const body = await publishRes.text();
    console.error(`  publish failed: ${publishRes.status} ${publishRes.statusText}\n${body}`);
    exit(1);
  }
  const detail = (await publishRes.json()) as {
    slug: string;
    latestVersion: string | null;
    conformanceVersion: string | null;
  };
  console.log(
    `  published — slug=${detail.slug} version=${detail.latestVersion} conformance=${detail.conformanceVersion}`,
  );
  console.log(`Visit ${apiBase}/catalog/${detail.slug}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  exit(1);
});

#!/usr/bin/env tsx
/**
 * Demo data for the AI for Good Lab walk-through (#639): scenario A
 * (publish, evaluate) and scenario B (request, approve, sign, download).
 * Runbook: docs/runbooks/demo-lab-2026-11-17.md.
 *
 * Everything goes through the HTTP API with a real user's token, so the
 * business rules apply and the restricted dataset is owned by the holder
 * account (its `hostId` is the holder's), which a SQL seed cannot do.
 *
 * Usage (from repo root; tokens are Cognito access tokens copied from
 * /dashboard on the target environment):
 *
 *   API_BASE=https://dev.oci.ai4h.net pnpm --filter @oci/api exec tsx scripts/lab-demo.ts check
 *   API_BASE=… HOLDER_TOKEN=… pnpm --filter @oci/api exec tsx scripts/lab-demo.ts seed
 *   API_BASE=… RESEARCHER_TOKEN=… pnpm --filter @oci/api exec tsx scripts/lab-demo.ts submit [--scored]
 *   API_BASE=… RESEARCHER_TOKEN=… SIGNER_EMAIL=… SIGNER_NAME=… … lab-demo.ts sign
 *   API_BASE=… RESEARCHER_TOKEN=… pnpm --filter @oci/api exec tsx scripts/lab-demo.ts visas
 *
 * `sign` and `visas` stand in for screens the web app doesn't have yet:
 * starting the DUA signature for an approved request, and showing the
 * researcher's GA4GH visas (each one verified against the JWKS).
 *
 * `seed` is safe to re-run: once the dataset has a published version it
 * stops without changing anything.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { validate } from '@oci/croissant';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const SLUG = 'lab-demo-chest-xr';
const NAME = 'Lab demo: synthetic chest X-ray (restricted)';
const DESCRIPTION =
  'Five synthetic chest radiographs, published by a data holder for the AI for Good Lab walk-through. ' +
  'The description is public; the files are released only after the holder approves an access request.';
const TASK_SLUG = 'idrid-dr-grading';
const VERSION = '1.0.0';
/** General research use + non-commercial use only. */
const DUO_TERMS = [
  { code: 'DUO_0000042', name: 'general research use' },
  { code: 'DUO_0000046', name: 'non-commercial use only' },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(here, '../../../packages/database/seed/fixtures/oci-demo-chest-xr');
const PREDICTIONS = path.resolve(here, 'fixtures/lab-demo/idrid-predictions.json');

const apiBase = (env.API_BASE ?? 'https://dev.oci.ai4h.net').replace(/\/+$/, '');

type Json = Record<string, unknown>;

async function call(
  method: string,
  route: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${apiBase}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  return { status: res.status, json };
}

function fail(step: string, r: { status: number; json: unknown }): never {
  console.error(`✗ ${step}: HTTP ${r.status}\n${JSON.stringify(r.json, null, 2)}`);
  exit(1);
}

function requireToken(name: 'HOLDER_TOKEN' | 'RESEARCHER_TOKEN'): string {
  // eslint-disable-next-line security/detect-object-injection -- fixed literal union
  const t = env[name];
  if (!t) {
    console.error(`${name} is required: sign in on ${apiBase} and copy the token from /dashboard.`);
    exit(2);
  }
  return t;
}

// --- check -----------------------------------------------------------------

async function check(): Promise<void> {
  let ok = true;
  const mark = (pass: boolean, line: string) => {
    if (!pass) ok = false;
    console.log(`${pass ? '✓' : '✗'} ${line}`);
  };

  const jwks = await call('GET', '/.well-known/jwks.json', null);
  const keys = (jwks.json as { keys?: unknown[] } | null)?.keys ?? [];
  mark(
    jwks.status === 200 && keys.length > 0,
    `JWKS lists ${keys.length} key(s): visas can be issued and verified (#620)`,
  );

  const index = await call('GET', '/v2/catalog/.well-known/croissant-catalog.json', null);
  const ids = ((index.json as { dataset?: Array<{ '@id'?: string }> } | null)?.dataset ?? []).map(
    (d) => d['@id'] ?? '',
  );
  mark(
    ids.some((id) => id.endsWith('/idrid-grading-demo')),
    `Croissant index lists idrid-grading-demo (${ids.length} public dataset(s))`,
  );

  const task = await call('GET', `/v2/evaluation/tasks/${TASK_SLUG}`, null);
  mark(task.status === 200, `Evaluation task ${TASK_SLUG} is live`);

  const holder = env.HOLDER_TOKEN;
  if (holder) {
    const ds = await call('GET', `/v2/catalog/datasets/${SLUG}`, holder);
    const d = ds.json as Json | null;
    mark(
      ds.status === 200 &&
        d?.visibility === 'RESTRICTED' &&
        d?.accessTier === 'REGISTERED' &&
        Array.isArray(d?.versions) &&
        d.versions.length > 0,
      `${SLUG} seeded: visibility=${String(d?.visibility)} tier=${String(d?.accessTier)} duo=${JSON.stringify(d?.duoTerms ?? [])}`,
    );
  } else {
    console.log(`· set HOLDER_TOKEN to also check ${SLUG}`);
  }

  exit(ok ? 0 : 1);
}

// --- seed (as the holder) ----------------------------------------------------

async function uploadFile(token: string, filename: string): Promise<Json> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- bundled fixture, fixed directory
  const bytes = readFileSync(path.join(IMAGES_DIR, filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const init = await call('POST', `/v2/catalog/datasets/${SLUG}/uploads`, token, {
    filename,
    contentType: 'image/png',
    contentSize: bytes.length,
    sha256,
  });
  if (init.status !== 201) fail(`init upload ${filename}`, init);
  const { uploadId, key } = init.json as { uploadId: string; key: string };

  const q = `key=${encodeURIComponent(key)}`;
  const part = await call(
    'GET',
    `/v2/catalog/datasets/${SLUG}/uploads/${encodeURIComponent(uploadId)}/parts/1/url?${q}`,
    token,
  );
  if (part.status !== 200) fail(`part URL ${filename}`, part);
  const put = await fetch((part.json as { url: string }).url, { method: 'PUT', body: bytes });
  if (!put.ok) {
    console.error(`✗ upload ${filename}: HTTP ${put.status} ${await put.text()}`);
    exit(1);
  }
  const etag = (put.headers.get('etag') ?? '').replaceAll('"', '');

  const done = await call(
    'POST',
    `/v2/catalog/datasets/${SLUG}/uploads/${encodeURIComponent(uploadId)}/complete?${q}` +
      `&contentType=image%2Fpng&contentSize=${bytes.length}&sha256=${sha256}`,
    token,
    { parts: [{ partNumber: 1, etag }] },
  );
  if (done.status !== 201) fail(`complete upload ${filename}`, done);
  const dist = done.json as { distributionId: string; contentUrl: string };
  console.log(`  ✓ ${filename} → ${dist.contentUrl}`);
  return {
    '@id': dist.distributionId,
    '@type': 'cr:FileObject',
    name: filename,
    encodingFormat: 'image/png',
    contentUrl: dist.contentUrl,
    contentSize: `${bytes.length} B`,
    sha256,
  };
}

function buildManifest(distribution: Json[]): Json {
  const base = JSON.parse(readFileSync(path.join(IMAGES_DIR, 'manifest.json'), 'utf8')) as Json;
  return {
    ...base,
    name: SLUG,
    description: DESCRIPTION,
    url: `${apiBase}/catalog/${SLUG}`,
    version: VERSION,
    datePublished: new Date().toISOString().slice(0, 10),
    'bio:consentNotes':
      'Synthetic images, no patient data. Released for general research, non-commercial use, after the holder approves the request.',
    'cr:consentCode': DUO_TERMS.map((t) => ({
      '@type': 'sc:DefinedTerm',
      '@id': `http://purl.obolibrary.org/obo/${t.code}`,
      termCode: t.code,
      name: t.name,
      inDefinedTermSet: 'http://purl.obolibrary.org/obo/duo.owl',
    })),
    distribution,
  };
}

async function seed(): Promise<void> {
  const token = requireToken('HOLDER_TOKEN');
  console.log(`Seeding ${SLUG} on ${apiBase} as the holder…`);

  const existing = await call('GET', `/v2/catalog/datasets/${SLUG}`, token);
  const versions = (existing.json as { versions?: unknown[] } | null)?.versions ?? [];
  if (existing.status === 200 && versions.length > 0) {
    console.log(`✓ ${SLUG} already has a published version; nothing to do.`);
    return;
  }

  if (existing.status === 404) {
    const created = await call('POST', '/v2/catalog/datasets', token, {
      slug: SLUG,
      name: NAME,
      description: DESCRIPTION,
      visibility: 'RESTRICTED',
      accessTier: 'REGISTERED',
      commercialUseTerms: 'NON_COMMERCIAL_ONLY',
    });
    if (created.status === 403) {
      console.error('✗ create: 403. Is the holder account in the `host` group (/admin/users)?');
      exit(1);
    }
    if (created.status !== 201 && created.status !== 200) fail('create dataset', created);
    console.log('  ✓ dataset created (RESTRICTED, tier REGISTERED, non-commercial)');
  } else if (existing.status !== 200) {
    fail('read dataset', existing);
  } else {
    console.log('  · dataset exists without a version (earlier run stopped); uploading files');
  }

  const files = [
    'sample-001.png',
    'sample-002.png',
    'sample-003.png',
    'sample-004.png',
    'sample-005.png',
  ];
  const distribution: Json[] = [];
  for (const f of files) distribution.push(await uploadFile(token, f));

  const manifest = buildManifest(distribution);
  const report = validate(manifest, { accessTier: 'REGISTERED' });
  const errors = report.issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    console.error(`✗ manifest invalid:\n${JSON.stringify(errors, null, 2)}`);
    exit(1);
  }

  const published = await call('POST', `/v2/catalog/datasets/${SLUG}/versions`, token, {
    version: VERSION,
    croissant: manifest,
    notes: 'Seeded for the AI for Good Lab walk-through (#639).',
  });
  if (published.status !== 201 && published.status !== 200) fail('publish version', published);
  console.log(`✓ published ${SLUG} ${VERSION}: ${apiBase}/catalog/${SLUG}`);
}

// --- submit (as the researcher) ----------------------------------------------

async function submit(scored: boolean): Promise<void> {
  const token = requireToken('RESEARCHER_TOKEN');

  const body = JSON.parse(readFileSync(PREDICTIONS, 'utf8')) as Json;
  const intent = scored ? 'SCORED' : 'VALIDATION';
  const r = await call('POST', `/v2/evaluation/tasks/${TASK_SLUG}/submissions`, token, {
    ...body,
    intent,
  });
  if (r.status >= 300) fail(`submit (${intent})`, r);
  console.log(`✓ ${intent} submission accepted:\n${JSON.stringify(r.json, null, 2)}`);
  if (scored) console.log(`See ${apiBase}/evaluation/${TASK_SLUG}`);
}

// --- sign the DUA (as the researcher) ----------------------------------------

async function sign(): Promise<void> {
  const token = requireToken('RESEARCHER_TOKEN');
  const signerEmail = env.SIGNER_EMAIL;
  const signerName = env.SIGNER_NAME;
  if (!signerEmail || !signerName) {
    console.error(
      'SIGNER_EMAIL and SIGNER_NAME are required: DocuSeal mails the signing link there.',
    );
    exit(2);
  }
  const mine = await call('GET', '/v2/me/access-requests', token);
  if (mine.status !== 200) fail('list my access requests', mine);
  // The newest APPROVED request for the demo dataset: a rehearsal leaves older ones behind.
  const rows = Array.isArray(mine.json) ? (mine.json as Json[]) : [];
  const approved = rows
    .filter((r) => r.status === 'APPROVED' && (r.dataset as Json | undefined)?.slug === SLUG)
    .sort((a, b) => String(b.decidedAt ?? '').localeCompare(String(a.decidedAt ?? '')))[0];
  if (!approved) {
    console.error(`✗ no APPROVED access request for ${SLUG}: the holder approves it first.`);
    exit(1);
  }
  const audience = approved.audience === 'BUILDER' ? 'BUILDER' : 'RESEARCHER';
  const r = await call('POST', '/v2/dua/sign-requests', token, {
    accessRequestId: approved.id,
    audience,
    signerEmail,
    signerName,
  });
  if (r.status !== 201) fail('create DUA signing request', r);
  const sig = (r.json as { signature?: Json } | null)?.signature ?? {};
  console.log(`✓ DUA sent for signature (status ${String(sig.status)}).`);
  console.log(`  DocuSeal mails the link to ${signerEmail}.`);
  if (sig.signerUrl) console.log(`  Or open it directly: ${String(sig.signerUrl)}`);
}

// --- visas (as the researcher) -----------------------------------------------

async function visas(): Promise<void> {
  const token = requireToken('RESEARCHER_TOKEN');
  const list = await call('GET', '/v2/me/passport/issued', token);
  if (list.status !== 200) fail('list issued visas', list);
  const items = (list.json as { items?: Array<Json> } | null)?.items ?? [];
  if (items.length === 0) {
    console.log('No visas issued yet. One is issued on approval and one when the DUA is signed.');
    return;
  }
  const jwks = createRemoteJWKSet(new URL(`${apiBase}/.well-known/jwks.json`));
  for (const v of items) {
    const jwt = await call('GET', `/v2/me/passport/issued/${String(v.id)}/jwt`, token);
    if (jwt.status !== 200) {
      console.log(
        `✗ ${String(v.visaType)} ${String(v.value)}: JWT not available (HTTP ${jwt.status})`,
      );
      continue;
    }
    try {
      const { payload, protectedHeader } = await jwtVerify((jwt.json as { jwt: string }).jwt, jwks);
      const claim = payload.ga4gh_visa_v1 as Json | undefined;
      console.log(
        `✓ ${String(claim?.type)} = ${String(claim?.value)}  issuer ${String(payload.iss)}  ` +
          `kid ${String(protectedHeader.kid)}  expires ${new Date((payload.exp ?? 0) * 1000).toISOString().slice(0, 10)}  (signature verified against the JWKS)`,
      );
    } catch (err) {
      console.log(
        `✗ ${String(v.visaType)} ${String(v.value)}: does not verify (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
}

// --- main --------------------------------------------------------------------

const [command, ...rest] = argv.slice(2);
const run =
  command === 'check'
    ? check()
    : command === 'seed'
      ? seed()
      : command === 'submit'
        ? submit(rest.includes('--scored'))
        : command === 'sign'
          ? sign()
          : command === 'visas'
            ? visas()
            : (console.error('usage: lab-demo.ts check | seed | submit [--scored] | sign | visas'),
              exit(2));

void Promise.resolve(run).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  exit(1);
});

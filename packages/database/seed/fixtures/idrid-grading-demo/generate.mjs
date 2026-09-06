// Generator for the IDRiD DR-grading demo slice (Phase C evaluation demo).
//
// Produces a SMALL, downsampled, class-stratified slice of the IDRiD
// "B. Disease Grading" testing set and wires it into the platform's
// bundled-fixture byte-hosting path (see docs/for-operators/demo-seed.md):
//
//   packages/database/seed/fixtures/idrid-grading-demo/
//     IDRiD_XXX.jpg              downsampled fundus images (the distributions)
//     manifest.json              Croissant 1.1 + BIOCroissant, FileObject dists
//     test-labels.hidden.csv     ground truth for the evaluation service (NOT a distribution)
//     seed.generated.sql         demo.sql section: dataset + version + distribution rows
//
// The uploader (apps/migrate/upload-fixtures.mjs) keys each distribution file as
//   <slug>/<distribution-@id>/<filename>
// and seed.generated.sql references those exact keys, so /download streams the bytes.
//
// IDRiD is CC BY 4.0 (open) — the images are hosted OPEN. The "sealed" property is
// that the ground-truth labels never leave the platform: they go to the evaluation
// service (test-labels.hidden.csv), never into distribution[]. On public IDRiD this
// demonstrates the *mechanics*; true data-never-moves is proven when a partner
// (e.g. Tsinghua) contributes data that genuinely cannot be exported.
//
// Node-only (no Python, per CLAUDE.md rule 9). Uses macOS `sips` for resize and
// `unzip` for extraction — this runs locally on an operator's Mac at fixture-build
// time; the *generated* artifacts are what ship.
//
// Usage (from repo root):
//   IDRID_GRADING_ZIP=/path/to/"B. Disease Grading.zip" \
//     node packages/database/seed/fixtures/idrid-grading-demo/generate.mjs
//   # or let it download from Zenodo:
//   node packages/database/seed/fixtures/idrid-grading-demo/generate.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SLUG = 'idrid-grading-demo';
const SLICE_SIZE = Number(process.env.IDRID_SLICE_SIZE ?? 30);
const MAX_DIM = Number(process.env.IDRID_MAX_DIM ?? 512);
const ZENODO_URL =
  'https://zenodo.org/api/records/17219542/files/B.%20Disease%20Grading.zip/content';
const HOST_ID = '00000000-0000-4000-8000-000000000099'; // dev-stub host, per demo.sql
const UPSTREAM_DOI = 'https://doi.org/10.3390/data3030025'; // Porwal et al., 2018, Data 3(3):25
// PROV-O activity timestamps for the slice. Bump when regenerating the slice
// with different parameters; keep as-is for a byte-identical regeneration.
const SLICE_GENERATED_AT = '2026-07-30T00:00:00Z';
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC-4122 URL namespace

// ----- deterministic UUIDv5 (sha1) so re-runs are idempotent -----------------
function uuid5(name, ns = UUID_NS) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// ----- 1. locate or download the grading zip ---------------------------------
let zipPath = process.env.IDRID_GRADING_ZIP;
const work = mkdtempSync(join(tmpdir(), 'idrid-'));
if (!zipPath) {
  zipPath = join(work, 'grading.zip');
  console.log('Downloading IDRiD grading set from Zenodo (~212 MB)…');
  sh('curl', ['-sS', '-L', '--max-time', '600', '-o', zipPath, ZENODO_URL]);
}
console.log(`Using zip: ${zipPath}`);

// ----- 2. extract testing images + testing labels ----------------------------
const imgDir = join(work, 'img');
const lblDir = join(work, 'lbl');
mkdirSync(imgDir, { recursive: true });
mkdirSync(lblDir, { recursive: true });
// -j junks internal paths; quote the glob-y entry names.
sh('unzip', [
  '-j',
  '-o',
  zipPath,
  'B. Disease Grading/1. Original Images/b. Testing Set/*',
  '-d',
  imgDir,
]);
sh('unzip', [
  '-j',
  '-o',
  zipPath,
  'B. Disease Grading/2. Groundtruths/*Testing Labels.csv',
  '-d',
  lblDir,
]);

// ----- 3. parse labels -------------------------------------------------------
const csvName = readdirSync(lblDir).find((f) => f.toLowerCase().endsWith('.csv'));
const rows = readFileSync(join(lblDir, csvName), 'utf8').split(/\r?\n/).filter(Boolean);
const header = rows
  .shift()
  .split(',')
  .map((s) => s.trim().toLowerCase());
const iName = header.findIndex((h) => h.includes('image'));
const iDr = header.findIndex((h) => h.includes('retinopathy'));
const iDme = header.findIndex((h) => h.includes('macular'));
const labels = new Map(); // imageId -> { dr, dme }
for (const line of rows) {
  const c = line.split(',');
  const id = (c[iName] ?? '').trim();
  if (!id) continue;
  labels.set(id, { dr: parseInt(c[iDr], 10), dme: parseInt(c[iDme] ?? '0', 10) });
}

// ----- 4. class-stratified slice (deterministic) -----------------------------
const byGrade = new Map();
for (const [id, l] of [...labels.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!byGrade.has(l.dr)) byGrade.set(l.dr, []);
  byGrade.get(l.dr).push(id);
}
const grades = [...byGrade.keys()].sort((a, b) => a - b);
const picked = [];
let round = 0;
while (picked.length < SLICE_SIZE) {
  let added = false;
  for (const g of grades) {
    const bucket = byGrade.get(g);
    if (round < bucket.length && picked.length < SLICE_SIZE) {
      picked.push(bucket[round]);
      added = true;
    }
  }
  if (!added) break;
  round += 1;
}
picked.sort();
console.log(`Selected ${picked.length} images across grades ${grades.join(',')}`);

// ----- 5. downsample into the fixture dir + hash -----------------------------
// clean prior slice images (keep scripts/docs)
for (const f of readdirSync(HERE)) {
  if (f.startsWith('IDRiD_') && f.endsWith('.jpg')) rmSync(join(HERE, f));
}
const distributions = [];
const hiddenLabelLines = ['Image,dr_grade,dme_risk'];
const datasetId = uuid5(`${SLUG}:dataset`);
const versionId = uuid5(`${SLUG}:version:1.0.0`);

for (const id of picked) {
  const srcName = readdirSync(imgDir).find((f) => f.startsWith(id + '.') || f === id + '.jpg');
  if (!srcName) {
    console.warn(`  ! image for ${id} not found in zip, skipping`);
    continue;
  }
  const outName = `${id}.jpg`;
  const outPath = join(HERE, outName);
  // sips: resize longest side to MAX_DIM, re-encode jpeg
  sh('sips', ['-Z', String(MAX_DIM), join(imgDir, srcName), '--out', outPath]);
  const bytes = readFileSync(outPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const distId = uuid5(`${SLUG}:dist:${outName}`);
  distributions.push({
    '@id': distId,
    '@type': 'cr:FileObject',
    name: outName,
    encodingFormat: 'image/jpeg',
    contentUrl: `/v2/catalog/datasets/${SLUG}/distributions/${distId}/download`,
    contentSize: `${bytes.length} B`,
    sha256,
  });
  const l = labels.get(id);
  hiddenLabelLines.push(`${id},${l.dr},${l.dme}`);
}
console.log(`Wrote ${distributions.length} downsampled images to ${HERE}`);

// ----- 6. manifest.json ------------------------------------------------------
const manifest = {
  '@context': {
    '@vocab': 'https://schema.org/',
    sc: 'https://schema.org/',
    cr: 'http://mlcommons.org/croissant/',
    rai: 'http://mlcommons.org/croissant/RAI/',
    prov: 'http://www.w3.org/ns/prov#',
    odrl: 'http://www.w3.org/ns/odrl/2/',
    dct: 'http://purl.org/dc/terms/',
    bio: 'https://oci.ai4h.net/biocroissant/v0.1#',
  },
  '@type': 'sc:Dataset',
  'dct:conformsTo': 'http://mlcommons.org/croissant/1.1',
  name: 'IDRiD — DR Grading (OCI demo slice)',
  description:
    `A ${distributions.length}-image, downsampled (${MAX_DIM}px) class-stratified slice of the ` +
    'IDRiD "Disease Grading" testing set, hosted in OCI storage to demonstrate the ' +
    'catalogue → gated download → evaluation flow end to end. Ground-truth grades are ' +
    'held by the evaluation service and are never published as a distribution. ' +
    'Derived from IDRiD (CC BY 4.0); see citeAs.',
  url: 'https://idrid.grand-challenge.org/',
  sameAs: UPSTREAM_DOI,
  license: 'https://creativecommons.org/licenses/by/4.0/',
  version: '1.0.0',
  datePublished: '2018-04-24',
  creator: [
    { '@type': 'sc:Person', name: 'Prasanna Porwal' },
    { '@type': 'sc:Person', name: 'Samiksha Pachade' },
    { '@type': 'sc:Person', name: 'Fabrice Meriaudeau' },
  ],
  publisher: { '@type': 'sc:Organization', name: 'OCI Platform (GI-AI4H) — demo slice of IDRiD' },
  keywords: [
    'diabetic retinopathy',
    'fundus photography',
    'disease grading',
    'ophthalmology',
    'demo',
  ],
  citeAs:
    '@article{porwal2018idrid, title={Indian Diabetic Retinopathy Image Dataset (IDRiD)...}, ' +
    'author={Porwal, Prasanna and others}, journal={Data}, volume={3}, number={3}, pages={25}, year={2018}, publisher={MDPI}}',
  distribution: distributions,
  recordSet: [
    {
      '@type': 'cr:RecordSet',
      '@id': 'disease-grading-labels',
      name: 'Disease grading labels (held by the evaluation service)',
      description:
        'Per-image DR severity (0-4) and DME risk (0-2). VALUES ARE NOT PUBLISHED — they are ' +
        'the hidden ground truth the evaluation service scores against.',
      field: [
        { '@type': 'cr:Field', '@id': 'labels/image_id', name: 'image_id', dataType: 'sc:Text' },
        {
          '@type': 'cr:Field',
          '@id': 'labels/dr_grade',
          name: 'dr_grade',
          description:
            'ICDR scale: 0 No DR; 1 Mild NPDR; 2 Moderate NPDR; 3 Severe NPDR; 4 Proliferative DR. Referable = grade >= 2.',
          dataType: ['sc:Integer', 'cr:Label'],
        },
        {
          '@type': 'cr:Field',
          '@id': 'labels/dme_risk',
          name: 'dme_risk',
          dataType: ['sc:Integer', 'cr:Label'],
        },
      ],
    },
  ],
  'bio:imagingModality': { '@type': 'sc:DefinedTerm', name: 'Colour fundus photography' },
  'bio:bodyRegion': { '@type': 'sc:DefinedTerm', name: 'Retina' },
  'bio:diseaseCondition': [
    { '@type': 'sc:DefinedTerm', name: 'Diabetic retinopathy', termCode: '9B71.0' },
  ],
  'rai:dataAnnotationProtocol':
    'Two ophthalmologists (>25 yrs) graded independently; a third adjudicated disagreements (from source IDRiD).',
  'bio:anonymizationLevel': 'ANONYMIZED',
  // ----- bio-prov v0.1 (docs/standards/bio-prov-v0.1.md, ADR-0022) ----------
  // The marker opts the manifest into the provenance layer. With H2 (timeframe)
  // and H6 (label protocol) filled, the slice is conformant at OPEN in strict
  // mode: P1–P4 come from the PROV-O block below; H1, H3, H4, H5 are MAY at OPEN.
  // No inter-rater agreement value: the IDRiD paper does not publish one.
  'bio:provenanceProfile': 'bio-prov/0.1',
  'rai:dataCollectionTimeframe':
    'IDRiD source collection published 2018; OCI demo slice prepared 30 July 2026',
  'bio:labelProtocol': {
    version: 'IDRiD 2018 disease-grading protocol',
    labelScale: 'ICDR 0–4; referable ≥ 2',
    gradersPerItem: 2,
    graderQualification: 'ophthalmologist, >25 years experience',
    adjudication: 'third grader adjudicated disagreements',
    perRaterLabelsRetained: false,
  },
  // ----- dataset-level provenance (PROV-O), usage policy (ODRL), consent (DUO) --
  // Prefixed keys on purpose (like the bio: keys above): the manifest UI groups
  // properties by namespace; the validator strips prefixes itself.
  'prov:wasDerivedFrom': {
    '@type': 'prov:Entity',
    '@id': UPSTREAM_DOI,
    name: 'IDRiD — Indian Diabetic Retinopathy Image Dataset, B. Disease Grading (testing set)',
  },
  'prov:wasGeneratedBy': {
    '@type': 'prov:Activity',
    '@id': '#activity-oci-demo-slice-v1',
    name: `Class-stratified ${distributions.length}-image slice of the IDRiD disease-grading testing set, downsampled to ${MAX_DIM} px`,
    'prov:startedAtTime': SLICE_GENERATED_AT,
    'prov:endedAtTime': SLICE_GENERATED_AT,
    'prov:used': UPSTREAM_DOI,
    'prov:wasAssociatedWith': {
      '@type': 'prov:SoftwareAgent',
      name: `oci-platform ${SLUG} generate.mjs`,
      'prov:actedOnBehalfOf': { '@type': 'prov:Organization', name: 'OCI Platform (GI-AI4H)' },
    },
  },
  'prov:wasAttributedTo': [
    {
      '@type': 'prov:Organization',
      // The IDRiD paper + idrid.grand-challenge.org name only "an eye clinic in
      // Nanded, Maharashtra, India" as the acquisition site — no institution.
      name: 'IDRiD consortium (Porwal et al., 2018) — source images captured at an eye clinic in Nanded, Maharashtra, India',
    },
    {
      '@type': 'prov:Organization',
      name: 'OCI Platform (GI-AI4H) — re-publisher of the demo slice',
    },
  ],
  // CC BY 4.0 as an ODRL offer: use / distribute / derive, with an attribution duty.
  'odrl:hasOffer': {
    '@type': 'odrl:Offer',
    '@id': '#offer-cc-by-4.0',
    'odrl:permission': [
      {
        'odrl:action': ['odrl:use', 'odrl:distribute', 'odrl:derive'],
        'odrl:target': SLUG,
        'odrl:duty': [{ 'odrl:action': 'odrl:attribute' }],
      },
    ],
  },
  // DUO_0000004 (no restriction) is the truthful code for a CC BY public dataset.
  'cr:consentCode': [
    {
      '@type': 'sc:DefinedTerm',
      '@id': 'http://purl.obolibrary.org/obo/DUO_0000004',
      termCode: 'DUO_0000004',
      name: 'no restriction',
      inDefinedTermSet: 'http://purl.obolibrary.org/obo/duo.owl',
    },
  ],
};
writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// ----- 7. hidden ground-truth labels (for the evaluation service) -----------
writeFileSync(join(HERE, 'test-labels.hidden.csv'), hiddenLabelLines.join('\n') + '\n');

// ----- 8. seed.generated.sql (demo.sql section) ------------------------------
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
// Denormalised DUO cache column (catalog.datasets.duo_terms) — mirrors what the
// API's publish path extracts from consentCode.
const duoTerms = (manifest['cr:consentCode'] ?? []).map((t) => t.termCode);
const duoTermsSql = `ARRAY[${duoTerms.map(q).join(', ')}]::text[]`;
const distValues = distributions
  .map((d) => {
    const key = `${SLUG}/${d['@id']}/${d.name}`;
    const size = parseInt(d.contentSize, 10);
    return `    ('${d['@id']}'::uuid, ver_id, '${d['@id']}',
     '${d.contentUrl}', 'image/jpeg', ${size}, '${d.sha256}',
     false, 'S3'::"catalog"."DistributionStorageBackend", bucket,
     '${key}', 'READY'::"catalog"."DistributionUploadStatus")`;
  })
  .join(',\n');

const sql = `-- GENERATED by fixtures/idrid-grading-demo/generate.mjs — do not hand-edit.
-- Append/merge this block into packages/database/seed/demo.sql (Section: datasets with real bytes).
-- Mirrors the oci-demo-chest-xr pattern: bytes uploaded by upload-fixtures.mjs to
-- <slug>/<distribution-@id>/<filename>; rows below reference the same keys.
-- The repo is the authority for this fixture's manifest: the dataset + version
-- rows refresh on conflict when the manifest content differs (so an edited
-- manifest.json reaches an already-seeded environment on the next deploy);
-- distributions stay DO NOTHING.

DO $idrid_demo$
DECLARE
  ds_id   uuid := '${datasetId}';
  ver_id  uuid := '${versionId}';
  bucket  text := COALESCE(current_setting('app.datasets_bucket', true), 'oci-datasets-local');
  payload jsonb := $manifest$${JSON.stringify(manifest)}$manifest$::jsonb;
BEGIN
  INSERT INTO "catalog"."datasets" (
    id, slug, name, description, host_id, visibility, status,
    access_tier, commercial_use_terms, conformance_version, croissant, duo_terms, updated_at
  ) VALUES (
    ds_id, '${SLUG}', ${q(manifest.name)},
    'Downsampled ${distributions.length}-image slice of the IDRiD DR-grading testing set, hosted in OCI storage for the Phase C evaluation demo. Ground truth held by the evaluation service.',
    '${HOST_ID}', 'PUBLIC', 'PUBLISHED', 'OPEN', 'OK', '1.1', payload,
    ${duoTermsSql}, CURRENT_TIMESTAMP
  ) ON CONFLICT (slug) DO UPDATE SET
    croissant = EXCLUDED.croissant,
    description = EXCLUDED.description,
    conformance_version = EXCLUDED.conformance_version,
    duo_terms = EXCLUDED.duo_terms,
    updated_at = CURRENT_TIMESTAMP
  WHERE "datasets".croissant IS DISTINCT FROM EXCLUDED.croissant;

  INSERT INTO "catalog"."dataset_versions" (
    id, dataset_id, version, croissant, published_by_id, published_at
  ) VALUES (
    ver_id, ds_id, '1.0.0', payload, '${HOST_ID}', CURRENT_TIMESTAMP
  ) ON CONFLICT (dataset_id, version) DO UPDATE SET
    croissant = EXCLUDED.croissant
  WHERE "dataset_versions".croissant IS DISTINCT FROM EXCLUDED.croissant;

  INSERT INTO "catalog"."distributions" (
    id, dataset_version_id, croissant_id, content_url, content_type,
    content_size_bytes, content_hash_sha256, requires_access,
    storage_backend, s3_bucket, s3_key, upload_status
  ) VALUES
${distValues}
  ON CONFLICT (id) DO NOTHING;
END $idrid_demo$;
`;
writeFileSync(join(HERE, 'seed.generated.sql'), sql);

// ----- done ------------------------------------------------------------------
rmSync(work, { recursive: true, force: true });
console.log('\nGenerated:');
console.log(
  `  ${distributions.length} images + manifest.json + test-labels.hidden.csv + seed.generated.sql`,
);
console.log('\nNext:');
console.log('  1. Review manifest.json and seed.generated.sql');
console.log('  2. Merge seed.generated.sql into packages/database/seed/demo.sql');
console.log('  3. Upload bytes + seed dev (needs AWS profile ai4h):');
console.log(
  '     OCI_DATASETS_BUCKET=oci-datasets-dev SEED_FIXTURES_DIR=packages/database/seed/fixtures \\',
);
console.log('       node apps/migrate/upload-fixtures.mjs');

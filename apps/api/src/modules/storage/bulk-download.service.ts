import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { DatasetSlug } from '@oci/shared-types';
import type { CognitoAccessTokenPayload } from 'aws-jwt-verify/jwt-model';
import { ZipFile } from 'yazl';
import {
  claimUniqueFilename,
  deriveDistributionFilename,
  safeFilenameSegment,
} from '../catalog/distribution-filename.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { PrismaService } from '../../prisma.service.js';
import { S3ClientProvider } from './s3-client.js';
import { StorageService } from './storage.service.js';

/** One file that will end up in the archive. */
export interface BulkDownloadEntry {
  distributionId: string;
  /** De-duplicated, single-segment ZIP entry name. */
  filename: string;
  s3Bucket: string;
  s3Key: string;
  /** From the row; `null` when neither manifest nor upload declared it. */
  sizeBytes: number | null;
}

/**
 * Everything the streaming step needs. Produced (and fully validated /
 * authorised / size-checked) by `plan()` so every error case is decided
 * BEFORE a single response byte is written — once the ZIP starts
 * streaming, the status line is already committed and a failure can
 * only truncate the download.
 */
export interface BulkDownloadPlan {
  slug: string;
  datasetName: string;
  version: string | null;
  /** Latest published version's manifest. */
  croissant: unknown;
  includeManifest: boolean;
  entries: BulkDownloadEntry[];
  /** Sum of known `contentSizeBytes`. Rows with a null size add 0. */
  totalBytes: number;
  /** How many eligible rows declared no size (excluded from totalBytes). */
  unknownSizeCount: number;
}

/**
 * `GET /v2/catalog/datasets/:slug/download` — stream the whole dataset
 * as a ZIP.
 *
 * Eligibility is deliberately narrow. A distribution is included only
 * when ALL of these hold:
 *
 *   - it belongs to the dataset's **latest** published version;
 *   - `storageBackend = S3` and `uploadStatus = READY` — we archive
 *     only bytes we hold. External `contentUrl`s are never proxied:
 *     doing so would turn the API into an open relay and would mean
 *     shipping bytes we've never seen;
 *   - `requiresAccess = false` — per-distribution gated files are
 *     excluded from the archive entirely rather than gated inside it.
 *
 * On top of that, the caller must clear `StorageService.
 * authoriseDatasetBytes` — the same gate the single-file download
 * enforces. The bulk route is not a way around an unapproved
 * AccessRequest.
 */
@Injectable()
export class BulkDownloadService {
  private readonly logger = new Logger(BulkDownloadService.name);

  /**
   * 2 GiB. Big enough for the seed datasets and any plausible
   * browser-driven pull; small enough that a Fargate task streaming
   * several at once stays well inside its network + time budget.
   * Override with `OCI_BULK_DOWNLOAD_MAX_BYTES`.
   */
  private static readonly DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

  constructor(
    @Inject(S3ClientProvider) private readonly s3: S3ClientProvider,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /**
   * Resolve, authorise and size-check a bulk download.
   *
   * @throws NotFoundException          dataset missing, or it has no published version
   * @throws ForbiddenException         caller fails the shared bytes gate
   * @throws ConflictException          nothing in the latest version is eligible
   * @throws PayloadTooLargeException   eligible bytes exceed the cap
   */
  async plan(args: {
    slug: DatasetSlug;
    includeManifest: boolean;
    user: CognitoAccessTokenPayload | undefined;
  }): Promise<BulkDownloadPlan> {
    const owner = await this.catalog.findOwnerBySlug(args.slug);
    if (!owner) throw new NotFoundException(`dataset "${args.slug}" not found`);

    // Authorise FIRST, before disclosing anything about the contents
    // (counts, sizes, filenames) via a 409/413 body. `requiresAccess:
    // false` because the query below drops those rows outright.
    const dataset = await this.storage.authoriseDatasetBytes({
      datasetId: owner.id,
      requiresAccess: false,
      user: args.user,
    });

    const version = (await this.prisma.client.datasetVersion.findFirst({
      where: { datasetId: owner.id },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, version: true, croissant: true },
    })) as { id: string; version: string; croissant: unknown } | null;

    if (!version) {
      throw new NotFoundException({
        message: `dataset "${args.slug}" has no published version yet`,
        slug: args.slug,
        reason: 'no-published-version',
      });
    }

    const rows = (await this.prisma.client.distribution.findMany({
      where: {
        datasetVersionId: version.id,
        storageBackend: 'S3',
        uploadStatus: 'READY',
        requiresAccess: false,
      },
      select: {
        id: true,
        croissantId: true,
        contentUrl: true,
        s3Bucket: true,
        s3Key: true,
        contentSizeBytes: true,
      },
      // Stable archive ordering — reruns produce the same layout, which
      // also makes the `-2`/`-3` de-duplication suffixes deterministic.
      orderBy: [{ croissantId: 'asc' }, { id: 'asc' }],
    })) as Array<{
      id: string;
      croissantId: string;
      contentUrl: string | null;
      s3Bucket: string | null;
      s3Key: string | null;
      contentSizeBytes: bigint | null;
    }>;

    const taken = new Set<string>();
    const entries: BulkDownloadEntry[] = [];
    let totalBytes = 0;
    let unknownSizeCount = 0;

    for (const row of rows) {
      // The `storageBackend=S3 AND uploadStatus=READY` filter should
      // guarantee both, but a half-written row must not become a
      // GetObject against `undefined`.
      if (!row.s3Bucket || !row.s3Key) continue;

      const derived =
        deriveDistributionFilename(row) ??
        safeFilenameSegment(row.croissantId) ??
        `distribution-${row.id}`;
      const filename = claimUniqueFilename(taken, derived);

      const sizeBytes = row.contentSizeBytes == null ? null : Number(row.contentSizeBytes);
      if (sizeBytes === null) unknownSizeCount += 1;
      else totalBytes += sizeBytes;

      entries.push({
        distributionId: row.id,
        filename,
        s3Bucket: row.s3Bucket,
        s3Key: row.s3Key,
        sizeBytes,
      });
    }

    if (entries.length === 0) {
      throw new ConflictException({
        message:
          `dataset "${args.slug}" has no bulk-downloadable files. A file is included only ` +
          `when the platform hosts its bytes (storageBackend=S3, uploadStatus=READY) and it ` +
          `is not individually access-gated (requiresAccess=false).`,
        slug: args.slug,
        version: version.version,
        reason: 'no-eligible-distributions',
        candidateCount: rows.length,
        eligibleCount: 0,
        hint: 'Externally-hosted distributions are not proxied — use each distribution’s contentUrl from the Croissant manifest.',
      });
    }

    const maxBytes = this.maxBytes();
    if (totalBytes > maxBytes) {
      throw new PayloadTooLargeException({
        message:
          `dataset "${args.slug}" is too large to stream as a single archive ` +
          `(${totalBytes} bytes across ${entries.length} files; cap is ${maxBytes} bytes).`,
        slug: args.slug,
        version: version.version,
        reason: 'bulk-download-too-large',
        totalBytes,
        maxBytes,
        fileCount: entries.length,
        hint: 'Download files individually via GET /v2/catalog/datasets/:slug/distributions/:distributionId/download, or use a bulk CLI once available.',
      });
    }

    return {
      slug: dataset.slug,
      datasetName: manifestString(version.croissant, 'name') ?? dataset.slug,
      version: version.version,
      croissant: version.croissant,
      includeManifest: args.includeManifest,
      entries,
      totalBytes,
      unknownSizeCount,
    };
  }

  /**
   * Build the ZIP stream for a `plan()`. Nothing is buffered: each S3
   * object is opened lazily (`addReadStreamLazy`) only when yazl
   * reaches that entry, so exactly one object body is in flight at a
   * time regardless of how many files the dataset has.
   */
  buildZip(plan: BulkDownloadPlan): Readable {
    const zip = new ZipFile();

    // Notices first so they land at the head of the archive — present
    // even if a later object stream dies mid-download. LICENSE.txt and
    // CITATION.txt are unconditional: CC BY-style attribution is a
    // condition of use, not a convenience, and it has to travel with
    // the bytes whether or not the manifest was requested.
    zip.addBuffer(Buffer.from(buildLicenseNotice(plan), 'utf8'), 'LICENSE.txt');
    zip.addBuffer(Buffer.from(buildCitationNotice(plan), 'utf8'), 'CITATION.txt');

    if (plan.includeManifest) {
      zip.addBuffer(
        Buffer.from(`${JSON.stringify(plan.croissant, null, 2)}\n`, 'utf8'),
        'croissant.json',
      );
    }

    for (const entry of plan.entries) {
      // No `size` option on purpose: `contentSizeBytes` comes from the
      // manifest and may be stale. yazl would abort the whole stream on
      // a mismatch; without it, sizes go in the data descriptor and the
      // truth from S3 wins.
      zip.addReadStreamLazy(entry.filename, (cb) => {
        this.openObject(entry).then(
          (stream) => cb(null, stream),
          (err: unknown) => {
            this.logger.error(
              `bulk download ${plan.slug}: failed to open s3://${entry.s3Bucket}/${entry.s3Key}`,
              err instanceof Error ? err.stack : String(err),
            );
            cb(err, Readable.from([]));
          },
        );
      });
    }

    zip.end();
    return zip.outputStream as Readable;
  }

  // ----- helpers ---------------------------------------------------

  private async openObject(entry: BulkDownloadEntry): Promise<Readable> {
    const out = await this.s3.client.send(
      new GetObjectCommand({ Bucket: entry.s3Bucket, Key: entry.s3Key }),
    );
    const body: unknown = out.Body;
    if (!(body instanceof Readable)) {
      throw new Error(`S3 returned a non-stream body for ${entry.s3Key}`);
    }
    return body;
  }

  /** Cap, read per-call so a task restart isn't needed to change it. */
  private maxBytes(): number {
    const raw = process.env.OCI_BULK_DOWNLOAD_MAX_BYTES;
    if (raw === undefined || raw.trim() === '') return BulkDownloadService.DEFAULT_MAX_BYTES;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `OCI_BULK_DOWNLOAD_MAX_BYTES="${raw}" is not a positive number; ` +
          `falling back to ${BulkDownloadService.DEFAULT_MAX_BYTES}`,
      );
      return BulkDownloadService.DEFAULT_MAX_BYTES;
    }
    return Math.floor(parsed);
  }
}

// ----- manifest field extraction -------------------------------------
//
// Manifests are stored as the host supplied them (unnormalised), so
// every read has to accept both the bare and `sc:`-prefixed key —
// same reason `extractDistributions` in catalog.service.ts does.

function manifestField(croissant: unknown, key: string): unknown {
  if (!croissant || typeof croissant !== 'object') return undefined;
  // Read through a Map rather than indexing with a caller-supplied key:
  // own enumerable properties only, so a manifest carrying a
  // `constructor` / `__proto__` key can't reach the prototype chain.
  const fields = new Map(Object.entries(croissant as Record<string, unknown>));
  return fields.get(key) ?? fields.get(`sc:${key}`);
}

function manifestString(croissant: unknown, key: string): string | null {
  const value = manifestField(croissant, key);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  // Croissant also allows `license` / `url` as an object with a `name`
  // or `@id`; take whichever reads as a label.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const candidate of [o.name, o['sc:name'], o['@id'], o.url]) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
    }
  }
  return null;
}

/** `creator` may be a string, a Person/Organization object, or an array of either. */
function manifestCreators(croissant: unknown): string[] {
  const raw = manifestField(croissant, 'creator');
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim() !== '') {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const name = [o.name, o['sc:name'], o['@id']].find(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      );
      const url = [o.url, o['sc:url']].find(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      );
      if (name) out.push(url ? `${name.trim()} <${url.trim()}>` : name.trim());
    }
  }
  return out;
}

function heading(title: string): string {
  return `${title}\n${'='.repeat(title.length)}\n`;
}

function section(title: string): string {
  return `${title}\n${'-'.repeat(title.length)}\n`;
}

/** Shared provenance block so LICENSE.txt and CITATION.txt agree. */
function provenanceBlock(plan: BulkDownloadPlan): string {
  const published = manifestString(plan.croissant, 'datePublished');
  const url = manifestString(plan.croissant, 'url');
  const lines = [
    `Dataset:    ${plan.datasetName}`,
    `Slug:       ${plan.slug}`,
    `Version:    ${plan.version ?? '(unversioned)'}`,
  ];
  if (url) lines.push(`Source:     ${url}`);
  if (published) lines.push(`Published:  ${published}`);
  lines.push(`Retrieved:  ${new Date().toISOString()} (bulk download, OCI Platform)`);
  lines.push(`Files:      ${plan.entries.length}`);
  return `${lines.join('\n')}\n`;
}

const MODIFICATION_NOTE =
  'Files in this archive are served from the OCI Platform’s object storage.\n' +
  'They may have been re-encoded, re-named, de-identified or otherwise\n' +
  'modified relative to the original publication. Archive filenames are\n' +
  'derived from platform storage keys and de-duplicated with a "-2", "-3"\n' +
  'suffix where two files shared a name, so they are not guaranteed to\n' +
  'match the names in the original release.\n' +
  '\n' +
  'The authoritative licence and provenance record is the dataset’s\n' +
  'Croissant manifest. Re-request this archive with `?manifest=true` to\n' +
  'get it as croissant.json, or fetch it directly from\n';

export function buildLicenseNotice(plan: BulkDownloadPlan): string {
  const license = manifestString(plan.croissant, 'license');
  const creators = manifestCreators(plan.croissant);

  let out = heading('Licence notice');
  out += '\n';
  out += provenanceBlock(plan);
  out += '\n';

  out += section('Licence');
  if (license) {
    out += `${license}\n`;
    out += '\n';
    out += 'Attribution is a condition of use. Give appropriate credit to the\n';
    out += 'creator(s) named below, link to the licence, and state whether you\n';
    out += 'made changes. Retain this notice when you redistribute the data.\n';
  } else {
    out += 'NOT DECLARED.\n';
    out += '\n';
    out += 'The Croissant manifest for this dataset declares no `license` field.\n';
    out += 'The OCI Platform therefore makes NO licence grant and will not infer\n';
    out += 'one on the host’s behalf. Absence of a licence is not permission:\n';
    out += 'confirm the terms with the dataset host before using or\n';
    out += 'redistributing these files.\n';
  }
  out += '\n';

  out += section('Creator(s)');
  if (creators.length > 0) {
    out += `${creators.map((c) => `- ${c}`).join('\n')}\n`;
  } else {
    out += 'Not declared in the manifest. Contact the dataset host for the\n';
    out += 'correct attribution before redistributing.\n';
  }
  out += '\n';

  out += section('Note on modifications');
  out += MODIFICATION_NOTE;
  out += `  /v2/catalog/datasets/${plan.slug}/croissant\n`;
  return out;
}

export function buildCitationNotice(plan: BulkDownloadPlan): string {
  const citeAs = manifestString(plan.croissant, 'citeAs');
  const creators = manifestCreators(plan.croissant);
  const license = manifestString(plan.croissant, 'license');
  const url = manifestString(plan.croissant, 'url');
  const published = manifestString(plan.croissant, 'datePublished');

  let out = heading('How to cite this dataset');
  out += '\n';
  out += provenanceBlock(plan);
  out += '\n';

  out += section('Preferred citation');
  if (citeAs) {
    out += `${citeAs}\n`;
    out += '\n';
    out += 'Supplied by the dataset host via the manifest’s `citeAs` field.\n';
    out += 'Use it verbatim.\n';
  } else {
    // Construct something usable rather than leaving the file empty,
    // but say plainly that the platform assembled it.
    const year = published ? (/\d{4}/.exec(published)?.[0] ?? null) : null;
    const authors = creators.length > 0 ? creators.join('; ') : '[creator not declared]';
    const parts = [authors, year ? `(${year})` : null, plan.datasetName];
    if (plan.version) parts.push(`Version ${plan.version}`);
    if (url) parts.push(url);
    out += `${parts.filter((p) => p !== null).join('. ')}.\n`;
    out += '\n';
    out += 'NOTE: the manifest declares no `citeAs`, so the OCI Platform\n';
    out += 'assembled the line above from the available metadata. Check it with\n';
    out += 'the dataset host before using it in a publication.\n';
  }
  out += '\n';

  out += section('Licence');
  out += license
    ? `${license} — see LICENSE.txt in this archive.\n`
    : 'Not declared — see LICENSE.txt in this archive before you use these files.\n';
  out += '\n';

  out += section('Note on modifications');
  out += MODIFICATION_NOTE;
  out += `  /v2/catalog/datasets/${plan.slug}/croissant\n`;
  return out;
}

/* eslint-disable security/detect-non-literal-fs-filename --
 * Every path below is a directory the operator named on the command line
 * joined to a file name that `SelectionSchema` restricts to
 * `[A-Za-z0-9_-]+.png`, so no path can leave the directory it was given. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readPngSize } from './png.js';
import { DATASET_SLUG, MAX_SIDE_PX, sha256Hex } from './profile.js';
import type { Selection, SelectionImage } from './selection-file.js';

/**
 * Fetch, verify and prepare the image files of the selection (#644).
 *
 * For every image: take the upstream file (from a local directory, or from a
 * base address into that directory), check it against the checksum pinned in
 * the selection, shrink it if its longest side exceeds 1024 px, and write the
 * file as it will be hosted. A file already within the limit is hosted byte
 * for byte as it came, so its hosted checksum is its upstream checksum.
 *
 * PINNING. The source publishes no per-file checksum, so the first fetch
 * records what it got (`pin`) and every later fetch must get the same bytes.
 * A mismatch stops the run and names the file: nothing is skipped.
 */

export interface PrepareOptions {
  selection: Selection;
  /** Directory holding the upstream files, also used as the download cache. */
  sourceDir: string;
  /** Directory the hosted files are written under, in `<dataset-slug>/`. */
  workDir: string;
  /** Record checksums that are not pinned yet. Without it, an unpinned file is an error. */
  pin: boolean;
  /** Accept new hosted bytes for an image that had to be resized (the resize library changed). */
  repinHosted?: boolean;
  /** Base address to download a missing upstream file from. HTTPS only, except on loopback. */
  baseUrl?: string;
  /** What to record as the place the files came from. Defaults to `baseUrl`. */
  fetchedFrom?: string;
  maxSide?: number;
}

export interface PrepareResult {
  selection: Selection;
  pinned: number;
  resized: number;
  downloaded: number;
  hostedBytes: number;
}

function assertSafeBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`--base-url must be an https address (got ${url.protocol}//${url.hostname}).`);
  }
  return url;
}

/** The upstream file, from `sourceDir` (or its `images/` folder), downloading it there if allowed. */
async function upstreamBytes(
  file: string,
  options: PrepareOptions,
): Promise<{ bytes: Buffer; downloaded: boolean }> {
  for (const candidate of [
    path.join(options.sourceDir, file),
    path.join(options.sourceDir, 'images', file),
  ]) {
    if (existsSync(candidate)) return { bytes: readFileSync(candidate), downloaded: false };
  }
  if (!options.baseUrl) {
    throw new Error(
      `${file} is not in ${options.sourceDir} (nor in its images/ folder), and no --base-url was given to fetch it from.`,
    );
  }
  const response = await fetch(new URL(file, assertSafeBaseUrl(options.baseUrl)));
  if (!response.ok)
    throw new Error(`${file}: the upstream address answered HTTP ${response.status}.`);
  // A redirect must not take the download off https: on a first fetch the
  // bytes received are what gets pinned.
  assertSafeBaseUrl(response.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(options.sourceDir, { recursive: true });
  writeFileSync(path.join(options.sourceDir, file), bytes);
  return { bytes, downloaded: true };
}

/** Shrink so the longest side is `maxSide`. The image library is loaded only when a file needs it. */
async function shrink(bytes: Buffer, maxSide: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp(bytes)
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function prepareImages(options: PrepareOptions): Promise<PrepareResult> {
  const maxSide = options.maxSide ?? MAX_SIDE_PX;
  const outDir = path.join(options.workDir, DATASET_SLUG);
  mkdirSync(outDir, { recursive: true });

  let pinned = 0;
  let resized = 0;
  let downloaded = 0;
  let hostedBytes = 0;
  const images: SelectionImage[] = [];

  for (const image of options.selection.images) {
    const fetched = await upstreamBytes(image.file, options);
    if (fetched.downloaded) downloaded += 1;
    const upstream = { sha256: sha256Hex(fetched.bytes), bytes: fetched.bytes.length };

    if (image.upstream === null) {
      if (!options.pin) {
        throw new Error(
          `${image.file} has no pinned checksum. Run once with --pin to record what was fetched, and review the result.`,
        );
      }
      pinned += 1;
    } else if (image.upstream.sha256 !== upstream.sha256) {
      throw new Error(
        `${image.file}: checksum mismatch. Pinned ${image.upstream.sha256}, fetched ${upstream.sha256}. Stopping; no file was accepted in its place.`,
      );
    }

    const size = readPngSize(fetched.bytes);
    const tooLarge = Math.max(size.width, size.height) > maxSide;
    const hostedFile = tooLarge ? await shrink(fetched.bytes, maxSide) : fetched.bytes;
    if (tooLarge) resized += 1;
    const hostedSize = readPngSize(hostedFile);
    if (Math.max(hostedSize.width, hostedSize.height) > maxSide) {
      throw new Error(`${image.file}: still larger than ${maxSide} px after resizing.`);
    }
    const hosted = { sha256: sha256Hex(hostedFile), bytes: hostedFile.length, ...hostedSize };

    if (image.hosted !== null && image.hosted.sha256 !== hosted.sha256 && !options.repinHosted) {
      throw new Error(
        tooLarge
          ? `${image.file}: the resized file differs from the one recorded in the selection (the image library may have changed). Run with --repin-hosted, then regenerate and review the manifest.`
          : `${image.file}: the hosted file differs from the one recorded in the selection.`,
      );
    }

    writeFileSync(path.join(outDir, image.file), hostedFile);
    hostedBytes += hostedFile.length;
    images.push({ ...image, upstream, hosted });
  }

  return {
    selection: {
      ...options.selection,
      source: {
        ...options.selection.source,
        imagesFetchedFrom:
          options.fetchedFrom ?? options.baseUrl ?? options.selection.source.imagesFetchedFrom,
      },
      images,
    },
    pinned,
    resized,
    downloaded,
    hostedBytes,
  };
}

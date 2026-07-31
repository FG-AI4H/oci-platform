/**
 * Filename derivation for catalog `Distribution` rows.
 *
 * There is deliberately no `filename` column on the Prisma model — the
 * name is a *view* over two columns that already exist, so it can't
 * drift out of sync with the bytes:
 *
 *   1. `s3Key` wins when set. Keys are minted by the upload path as
 *      `<slug>/<distribution-uuid>/<filename>` (see `sanitiseFilename`
 *      in `storage.service.ts`), so the basename is the name the host
 *      uploaded.
 *   2. `contentUrl` is the fallback for EXTERNAL rows (the IDRiD seed
 *      and other upstream-hosted manifests). We take the basename of
 *      the URL *path* — query strings and fragments are dropped —
 *      and only accept it when it actually looks like a filename.
 *      This matters because platform-hosted rows carry a contentUrl of
 *      `/v2/catalog/datasets/:slug/distributions/:id/download`, whose
 *      basename (`download`) is a route segment, not a name.
 *   3. Otherwise `null`. The UI falls back to `croissantId`.
 *
 * Security: the output is used both as a JSON field and as a ZIP entry
 * path (bulk download), so it must never carry a path. Every return
 * value is a single path segment with no `/`, no `\`, no leading dot,
 * and never `..`. Traversal attempts collapse to their last segment
 * (`../../etc/passwd` → `passwd`) rather than escaping.
 */

/**
 * Non-portable characters are folded to `_`, matching the upload
 * path's `sanitiseFilename`. Keeps derived names byte-identical to the
 * keys they came from for anything uploaded through the platform.
 */
const UNSAFE_CHARS = /[^A-Za-z0-9._-]+/g;

/** A dot-run (`.`, `..`, `...`) is a path artefact, never a filename. */
const DOT_RUN_ONLY = /^\.+$/;

/**
 * `name.ext` with a 1-10 char alphanumeric extension. Used only to
 * decide whether a URL basename is a filename or a route segment.
 */
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

/**
 * Reduce an arbitrary string to a single safe path segment, or `null`
 * when nothing usable survives.
 *
 * Splits on BOTH separators so a Windows-style `..\..\etc\passwd` is
 * treated as a path rather than a (very odd) filename.
 */
export function safeFilenameSegment(raw: string): string | null {
  const segments = raw.split(/[/\\]+/).filter((s) => s.length > 0);
  const tail = segments[segments.length - 1];
  if (tail === undefined) return null;
  if (DOT_RUN_ONLY.test(tail)) return null;
  // Leading dots are stripped so no caller can ever be handed a name
  // beginning `..` — belt and braces on top of the split above.
  const cleaned = tail.replace(/^\.+/, '').replace(UNSAFE_CHARS, '_');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Pathname of a URL, absolute or platform-relative. The base is only
 * there to make relative inputs parseable and is never emitted.
 * `URL` also collapses `..` segments for us, which is a bonus rather
 * than something we rely on (`safeFilenameSegment` is the real guard).
 */
function urlPathname(contentUrl: string): string | null {
  try {
    return new URL(contentUrl, 'https://placeholder.invalid').pathname;
  } catch {
    return null;
  }
}

/**
 * Percent-decode, tolerating malformed sequences. Decoding happens
 * BEFORE the path split so `%2e%2e%2f` can't smuggle a separator past
 * `safeFilenameSegment`.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The two columns filename derivation reads. */
export interface FilenameSource {
  s3Key?: string | null;
  contentUrl?: string | null;
}

/**
 * Derive the display / archive filename for a distribution.
 * Returns `null` when neither column yields something name-shaped.
 */
export function deriveDistributionFilename(row: FilenameSource): string | null {
  if (row.s3Key) {
    const fromKey = safeFilenameSegment(row.s3Key);
    if (fromKey !== null) return fromKey;
  }

  if (row.contentUrl) {
    const pathname = urlPathname(row.contentUrl);
    if (pathname !== null) {
      const fromUrl = safeFilenameSegment(safeDecode(pathname));
      // Only accept a URL basename that reads as a filename — see the
      // `/download` route-segment case in the module header.
      if (fromUrl !== null && HAS_EXTENSION.test(fromUrl)) return fromUrl;
    }
  }

  return null;
}

/**
 * Claim `filename` in `taken`, appending `-2`, `-3`, … before the
 * extension until it's free. Mutates `taken`.
 *
 * Comparison is case-insensitive: the output is a ZIP entry name and
 * `IMG.JPG` would clobber `img.jpg` on the case-insensitive filesystems
 * most people extract onto.
 */
export function claimUniqueFilename(taken: Set<string>, filename: string): string {
  const key = filename.toLowerCase();
  if (!taken.has(key)) {
    taken.add(key);
    return filename;
  }

  // Split on the LAST dot so `archive.tar.gz` becomes `archive.tar-2.gz`
  // rather than `archive-2.tar.gz`. Either is defensible; keeping the
  // final extension intact is what matters for openers. A leading dot
  // can't occur (stripped by `safeFilenameSegment`).
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  // `taken.size + 2` iterations is always enough to find a free slot,
  // so the loop is provably bounded.
  const ceiling = taken.size + 2;
  for (let n = 2; n <= ceiling; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    const candidateKey = candidate.toLowerCase();
    if (!taken.has(candidateKey)) {
      taken.add(candidateKey);
      return candidate;
    }
  }

  // Unreachable given the ceiling above; satisfies the type checker.
  throw new Error(`could not de-duplicate filename "${filename}"`);
}

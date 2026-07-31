import { describe, expect, it } from 'vitest';
import {
  claimUniqueFilename,
  deriveDistributionFilename,
  safeFilenameSegment,
} from './distribution-filename.js';

describe('deriveDistributionFilename', () => {
  it('takes the basename of s3Key', () => {
    expect(
      deriveDistributionFilename({
        s3Key: 'idrid/03e84220-36b6-4e0f-9a1e-8c2f0a1b2c3d/IDRiD_001.jpg',
        contentUrl: null,
      }),
    ).toBe('IDRiD_001.jpg');
  });

  it('prefers s3Key over contentUrl', () => {
    expect(
      deriveDistributionFilename({
        s3Key: 'idrid/uuid/from-key.png',
        contentUrl: 'https://upstream.example.org/files/from-url.png',
      }),
    ).toBe('from-key.png');
  });

  it('falls back to the basename of the contentUrl path', () => {
    expect(
      deriveDistributionFilename({
        s3Key: null,
        contentUrl: 'https://upstream.example.org/idrid/a/IDRiD_042.jpg',
      }),
    ).toBe('IDRiD_042.jpg');
  });

  it('ignores query string and fragment on the contentUrl', () => {
    expect(
      deriveDistributionFilename({
        s3Key: null,
        contentUrl: 'https://cdn.example.org/data/scan.dcm?token=abc123&v=2#page=3',
      }),
    ).toBe('scan.dcm');
  });

  it('percent-decodes the contentUrl path', () => {
    expect(
      deriveDistributionFilename({
        s3Key: null,
        contentUrl: 'https://cdn.example.org/data/IDRiD%20001.jpg',
      }),
    ).toBe('IDRiD_001.jpg');
  });

  it('returns null when neither column is set', () => {
    expect(deriveDistributionFilename({ s3Key: null, contentUrl: null })).toBeNull();
    expect(deriveDistributionFilename({})).toBeNull();
  });

  it('returns null for a contentUrl whose basename is a route segment, not a file', () => {
    // Platform-hosted rows carry exactly this shape; `download` is not
    // a filename and must not be rendered as one.
    expect(
      deriveDistributionFilename({
        s3Key: null,
        contentUrl:
          '/v2/catalog/datasets/idrid/distributions/03e84220-36b6-4e0f-9a1e-8c2f0a1b2c3d/download',
      }),
    ).toBeNull();
  });

  it('returns null for a directory-style contentUrl', () => {
    expect(
      deriveDistributionFilename({ s3Key: null, contentUrl: 'https://example.org/data/' }),
    ).toBeNull();
  });

  describe('path traversal', () => {
    it('collapses ../../etc/passwd in s3Key to its last segment', () => {
      const out = deriveDistributionFilename({ s3Key: '../../etc/passwd', contentUrl: null });
      expect(out).toBe('passwd');
      expect(out).not.toContain('..');
      expect(out).not.toContain('/');
    });

    it('collapses traversal in a contentUrl', () => {
      const out = deriveDistributionFilename({
        s3Key: null,
        contentUrl: 'https://evil.example.org/a/b/../../../../etc/passwd.txt',
      });
      expect(out).toBe('passwd.txt');
      expect(out).not.toContain('..');
      expect(out).not.toContain('/');
    });

    it('does not let percent-encoded separators smuggle a path through', () => {
      const out = deriveDistributionFilename({
        s3Key: null,
        contentUrl: 'https://evil.example.org/data/%2e%2e%2f%2e%2e%2fetc%2fpasswd.txt',
      });
      expect(out).toBe('passwd.txt');
      expect(out).not.toContain('/');
      expect(out).not.toContain('..');
    });

    it('handles Windows-style separators', () => {
      expect(deriveDistributionFilename({ s3Key: '..\\..\\windows\\system32\\evil.dll' })).toBe(
        'evil.dll',
      );
    });

    it('never emits a leading slash', () => {
      expect(deriveDistributionFilename({ s3Key: '/absolute/path/file.txt' })).toBe('file.txt');
    });

    it('never emits a leading dot run', () => {
      expect(deriveDistributionFilename({ s3Key: 'dir/...hidden.txt' })).toBe('hidden.txt');
    });

    it('returns null when the key is nothing but traversal', () => {
      expect(deriveDistributionFilename({ s3Key: '../..' })).toBeNull();
      expect(deriveDistributionFilename({ s3Key: '..' })).toBeNull();
      expect(deriveDistributionFilename({ s3Key: '/' })).toBeNull();
    });

    it('falls through to contentUrl when the s3Key yields nothing', () => {
      expect(
        deriveDistributionFilename({
          s3Key: '../..',
          contentUrl: 'https://example.org/real.csv',
        }),
      ).toBe('real.csv');
    });
  });

  it('folds non-portable characters to underscores', () => {
    expect(deriveDistributionFilename({ s3Key: 'a/b/scan (1)*.jpg' })).toBe('scan_1_.jpg');
  });

  it('folds a NUL byte rather than passing it on', () => {
    const out = deriveDistributionFilename({ s3Key: 'a/b/evil\u0000.jpg' });
    expect(out).toBe('evil_.jpg');
    expect(out).not.toContain('\u0000');
  });
});

describe('safeFilenameSegment', () => {
  it('returns null for empty and dot-run-only input', () => {
    expect(safeFilenameSegment('')).toBeNull();
    expect(safeFilenameSegment('.')).toBeNull();
    expect(safeFilenameSegment('..')).toBeNull();
    expect(safeFilenameSegment('....')).toBeNull();
  });

  it('accepts a bare name with no extension', () => {
    // Unlike the URL path, a croissantId fallback needn't look
    // file-shaped — it only has to be safe.
    expect(safeFilenameSegment('some-croissant-id')).toBe('some-croissant-id');
  });
});

describe('claimUniqueFilename', () => {
  it('returns the name unchanged when free', () => {
    const taken = new Set<string>();
    expect(claimUniqueFilename(taken, 'IDRiD_001.jpg')).toBe('IDRiD_001.jpg');
  });

  it('appends -2, -3 before the extension on collision', () => {
    const taken = new Set<string>();
    expect(claimUniqueFilename(taken, 'IDRiD_001.jpg')).toBe('IDRiD_001.jpg');
    expect(claimUniqueFilename(taken, 'IDRiD_001.jpg')).toBe('IDRiD_001-2.jpg');
    expect(claimUniqueFilename(taken, 'IDRiD_001.jpg')).toBe('IDRiD_001-3.jpg');
    expect(claimUniqueFilename(taken, 'IDRiD_001.jpg')).toBe('IDRiD_001-4.jpg');
  });

  it('de-duplicates extension-less names', () => {
    const taken = new Set<string>();
    expect(claimUniqueFilename(taken, 'README')).toBe('README');
    expect(claimUniqueFilename(taken, 'README')).toBe('README-2');
  });

  it('keeps the final extension on a multi-dot name', () => {
    const taken = new Set<string>();
    claimUniqueFilename(taken, 'archive.tar.gz');
    expect(claimUniqueFilename(taken, 'archive.tar.gz')).toBe('archive.tar-2.gz');
  });

  it('collides case-insensitively so extraction cannot clobber', () => {
    const taken = new Set<string>();
    expect(claimUniqueFilename(taken, 'Scan.JPG')).toBe('Scan.JPG');
    expect(claimUniqueFilename(taken, 'scan.jpg')).toBe('scan-2.jpg');
  });

  it('does not collide distinct names', () => {
    const taken = new Set<string>();
    expect(claimUniqueFilename(taken, 'a.jpg')).toBe('a.jpg');
    expect(claimUniqueFilename(taken, 'b.jpg')).toBe('b.jpg');
    expect(taken.size).toBe(2);
  });
});

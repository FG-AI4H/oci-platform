import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_NAMESPACES } from './client-namespaces';

/**
 * A client component that reads a namespace the layout does not send to
 * the browser shows raw keys. This walks `src/` for `'use client'` files
 * and checks each namespace they ask for is on the list.
 */

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('CLIENT_NAMESPACES', () => {
  it('lists every namespace a client component reads', () => {
    const listed = new Set<string>(CLIENT_NAMESPACES);
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (!/^\s*['"]use client['"]/.test(text)) continue;
      for (const match of text.matchAll(/useTranslations\(\s*['"]([A-Za-z]+)/g)) {
        const namespace = match[1];
        if (namespace && !listed.has(namespace)) missing.push(`${namespace} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

#!/usr/bin/env tsx
/**
 * Audit-coverage CI grep (ADR-0014, #258).
 *
 * Walks the declared audit-event taxonomy in `audit-taxonomy.json` and
 * checks that every "expected" action has at least one matching
 * `audit.emit({ action: 'x.y' })` or `audit.emitSync({ action: 'x.y' })`
 * call site under `apps/api/src/`.
 *
 * Entries that are not yet implemented are listed in
 * `audit-taxonomy.json::unimplemented` along with the tracking
 * follow-up. The CI check passes when:
 *
 *   expected = (found in code) ∪ (unimplemented allowlist)
 *
 * Stale `unimplemented` entries (i.e. an action listed there that *is*
 * already emitted) are reported as warnings — they mean someone wired
 * the event but forgot to clear the allowlist.
 *
 * Run with:
 *   pnpm exec tsx scripts/check-audit-coverage.ts
 *
 * Exit codes:
 *   0 — all expected actions emitted or properly deferred
 *   1 — missing coverage (build fails)
 *   2 — script-level error (config malformed, no source tree, …)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

interface Taxonomy {
  expected: string[];
  unimplemented: Record<string, string>;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const TAXONOMY_PATH = join(SCRIPT_DIR, 'audit-taxonomy.json');
const SCAN_ROOT = join(REPO_ROOT, 'apps', 'api', 'src');

/**
 * Matches `audit.emit({ ... })` or `audit.emitSync({ ... })` with both
 * `module` and `action` string literals somewhere in the (possibly
 * multi-line) object body. We capture the two fields independently
 * and concatenate them as `module.action` to match the taxonomy form.
 *
 * Tolerates leading whitespace + optional `await` / `this.` / `?.`
 * prefixes. The `[^}]*?` body match is lazy so we don't span past the
 * end of the object literal — emit calls don't nest objects deeply
 * enough (per ADR-0014 §5) for this to matter in practice.
 */
const EMIT_PATTERN = /\b(?:this\.)?audit\??\.emit(?:Sync)?\s*\(\s*\{([\s\S]*?)\}\s*[,)]/g;
const FIELD_PATTERN = /\b(module|action)\s*:\s*['"`]([a-zA-Z0-9._-]+)['"`]/g;

function loadTaxonomy(): Taxonomy {
  let raw: string;
  try {
    raw = readFileSync(TAXONOMY_PATH, 'utf8');
  } catch (err) {
    console.error(`Cannot read taxonomy at ${TAXONOMY_PATH}: ${asMessage(err)}`);
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Taxonomy JSON parse error: ${asMessage(err)}`);
    process.exit(2);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Taxonomy).expected) ||
    typeof (parsed as Taxonomy).unimplemented !== 'object'
  ) {
    console.error('Taxonomy is malformed: needs { expected: string[], unimplemented: object }');
    process.exit(2);
  }
  return parsed as Taxonomy;
}

function listTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      listTsFiles(full, out);
    } else if (
      st.isFile() &&
      full.endsWith('.ts') &&
      !full.endsWith('.spec.ts') &&
      !full.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface FoundCall {
  action: string;
  file: string;
}

function scanCallSites(files: string[]): FoundCall[] {
  const calls: FoundCall[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const callMatch of src.matchAll(EMIT_PATTERN)) {
      const body = callMatch[1] ?? '';
      let module: string | null = null;
      let action: string | null = null;
      for (const fieldMatch of body.matchAll(FIELD_PATTERN)) {
        if (fieldMatch[1] === 'module') module = fieldMatch[2] ?? null;
        if (fieldMatch[1] === 'action') action = fieldMatch[2] ?? null;
      }
      if (!module || !action) continue;
      calls.push({ action: `${module}.${action}`, file: relative(REPO_ROOT, file) });
    }
  }
  return calls;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function main(): void {
  const taxonomy = loadTaxonomy();
  const files = listTsFiles(SCAN_ROOT);
  const calls = scanCallSites(files);
  const foundActions = new Set(calls.map((c) => c.action));

  const expected = new Set(taxonomy.expected);
  const unimplemented = new Set(Object.keys(taxonomy.unimplemented));

  const missing: string[] = [];
  for (const action of expected) {
    if (foundActions.has(action)) continue;
    if (unimplemented.has(action)) continue;
    missing.push(action);
  }

  const stale: string[] = [];
  for (const action of unimplemented) {
    if (foundActions.has(action)) stale.push(action);
  }

  const unknown: { action: string; file: string }[] = [];
  for (const call of calls) {
    if (!expected.has(call.action)) unknown.push(call);
  }

  console.log(`audit-coverage: scanned ${files.length} files under apps/api/src`);
  console.log(`  expected actions:       ${expected.size}`);
  console.log(`  emit call sites:        ${calls.length} (${foundActions.size} distinct actions)`);
  console.log(`  deferred (allowlist):   ${unimplemented.size}`);

  if (stale.length > 0) {
    console.warn(
      '\n⚠  stale `unimplemented` entries (action is now emitted; remove from allowlist):',
    );
    for (const a of stale.sort()) console.warn(`     - ${a}`);
  }

  if (unknown.length > 0) {
    console.warn(
      '\n⚠  emit call sites with actions NOT in `expected` (add to taxonomy or rename):',
    );
    for (const u of unknown.sort((a, b) => a.action.localeCompare(b.action))) {
      console.warn(`     - ${u.action}  (${u.file})`);
    }
  }

  if (missing.length > 0) {
    console.error('\n✗  missing audit-event coverage:');
    for (const a of missing.sort()) console.error(`     - ${a}`);
    console.error(
      '\n   Either:\n' +
        '     1. Wire the emit() / emitSync() call in the owning module, OR\n' +
        '     2. Add the action to `scripts/audit-taxonomy.json::unimplemented` with a tracking issue.\n',
    );
    process.exit(1);
  }

  console.log('\n✓ audit-coverage: all expected actions covered or properly deferred');
  process.exit(0);
}

main();

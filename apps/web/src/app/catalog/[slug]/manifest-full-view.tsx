import { DefinitionItem, DefinitionList } from '@oci/ui';

/**
 * "Full manifest" view (PR L.2). Walks every populated key in the
 * Croissant document and renders it as a definition list, grouped by
 * JSON-LD namespace prefix (sc:, cr:, bio:, rai:, dct:, prov:, odrl:,
 * duo:, plus an "other" bucket for anything that doesn't carry a
 * known prefix).
 *
 * Compared to the curated Summary view (which picks ~10 fields), this
 * surfaces *everything*, with light formatting per value type:
 *
 *   - strings → mono-styled with break-all on URL-shaped values
 *   - arrays / objects → JSON-stringified into a `<pre>` block
 *   - primitives (number / boolean) → as-is
 *
 * Hosts who need to see the absolute structure (every nested
 * RecordSet / FileSet / Field type definition) drop to the Raw JSON
 * tree on the next tab.
 */

const KNOWN_PREFIXES = ['sc', 'cr', 'bio', 'rai', 'dct', 'prov', 'odrl', 'duo', 'foaf'] as const;

const PREFIX_LABEL: Record<string, string> = {
  sc: 'schema.org',
  cr: 'Croissant',
  bio: 'BioCroissant',
  rai: 'Responsible AI',
  dct: 'Dublin Core',
  prov: 'PROV-O',
  odrl: 'ODRL',
  duo: 'DUO',
  foaf: 'FOAF',
  '@': 'JSON-LD framing',
  other: 'Other',
};

function bucket(key: string): string {
  if (key.startsWith('@')) return '@';
  const colon = key.indexOf(':');
  if (colon < 0) return 'other';
  const prefix = key.slice(0, colon);
  return KNOWN_PREFIXES.includes(prefix as (typeof KNOWN_PREFIXES)[number]) ? prefix : 'other';
}

function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('/');
}

function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[var(--color-muted-foreground)]">—</span>;
  }
  if (typeof value === 'string') {
    if (isUrl(value)) {
      return <span className="font-mono text-xs break-all">{value}</span>;
    }
    return <span>{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono">{String(value)}</span>;
  }
  // Arrays + objects: pretty-print into a small pre block.
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-[var(--color-subtle)] p-2 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ManifestFullView({ manifest }: { manifest: unknown }) {
  if (!manifest || typeof manifest !== 'object') {
    return <p className="text-sm text-[var(--color-muted-foreground)]">No manifest available.</p>;
  }
  const entries = Object.entries(manifest as Record<string, unknown>);
  // Filter out empty values (null, "", []) so the view doesn't drown
  // the host in "—" rows.
  const populated = entries.filter(([, v]) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.length === 0) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });

  // Group by namespace prefix.
  const groups = new Map<string, Array<[string, unknown]>>();
  for (const [k, v] of populated) {
    const b = bucket(k);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b)!.push([k, v]);
  }

  // Display order: @-fields first, then known prefixes in our
  // canonical order, then `other`.
  const displayOrder = ['@', ...KNOWN_PREFIXES, 'other'].filter((b) => groups.has(b));

  if (displayOrder.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">Manifest is empty.</p>;
  }

  return (
    <div className="space-y-6">
      {displayOrder.map((b) => {
        const groupEntries = groups.get(b)!;
        return (
          <section key={b} aria-labelledby={`group-${b}`} className="space-y-2">
            <h3
              id={`group-${b}`}
              className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]"
            >
              {/* eslint-disable-next-line security/detect-object-injection */}
              {PREFIX_LABEL[b] ?? b}
            </h3>
            <DefinitionList>
              {groupEntries.map(([k, v]) => (
                <DefinitionItem key={k} term={<span className="font-mono text-xs">{k}</span>}>
                  <ValueCell value={v} />
                </DefinitionItem>
              ))}
            </DefinitionList>
          </section>
        );
      })}
    </div>
  );
}

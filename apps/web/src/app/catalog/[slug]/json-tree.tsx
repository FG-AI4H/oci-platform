/**
 * Tiny collapsible JSON tree viewer (PR L.2, #91-followup).
 *
 * Renders a JSON-LD payload (or any JSON value) as nested
 * `<details>` sections. Objects + arrays are collapsible; primitives
 * render inline. Keys are colour-coded by JSON-LD prefix when
 * applicable (sc:, cr:, bio:, rai:, dct:, prov:, odrl:, duo:).
 *
 * No JS required — `<details>` is a native HTML control. The whole
 * viewer is a server component; no client bundle.
 *
 * Top-level objects are open by default; nested ones default to
 * collapsed so the tree is scannable on first render.
 */

const PREFIX_TONE: Record<string, string> = {
  sc: 'text-[var(--color-info)]',
  cr: 'text-[var(--color-primary)]',
  bio: 'text-[var(--color-success)]',
  rai: 'text-[var(--color-warning)]',
  dct: 'text-[var(--color-muted-foreground)]',
  prov: 'text-[var(--color-muted-foreground)]',
  odrl: 'text-[var(--color-muted-foreground)]',
  duo: 'text-[var(--color-success)]',
};

function tonedKey(key: string) {
  const colon = key.indexOf(':');
  if (colon < 0) return null;
  const prefix = key.slice(0, colon);
  // PREFIX_TONE is a closed in-file map; lookup is safe.
  // eslint-disable-next-line security/detect-object-injection
  return PREFIX_TONE[prefix] ?? null;
}

interface NodeProps {
  /** The key for this node when it's an object property. */
  k: string | null;
  value: unknown;
  /** Whether this `<details>` should default to open. */
  defaultOpen?: boolean;
}

function JsonNode({ k, value, defaultOpen = false }: NodeProps) {
  const keyClass = k ? (tonedKey(k) ?? 'text-[var(--color-foreground)]') : '';
  const keyEl = k ? <span className={`font-mono ${keyClass}`}>&quot;{k}&quot;</span> : null;

  if (value === null) {
    return (
      <span>
        {keyEl}
        {keyEl ? <span>: </span> : null}
        <span className="text-[var(--color-muted-foreground)]">null</span>
      </span>
    );
  }

  if (typeof value === 'string') {
    return (
      <span>
        {keyEl}
        {keyEl ? <span>: </span> : null}
        <span className="text-[var(--color-success)] break-all">&quot;{value}&quot;</span>
      </span>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <span>
        {keyEl}
        {keyEl ? <span>: </span> : null}
        <span className="text-[var(--color-warning)]">{String(value)}</span>
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span>
          {keyEl}
          {keyEl ? <span>: </span> : null}
          <span>[]</span>
        </span>
      );
    }
    return (
      <details open={defaultOpen} className="ms-4">
        <summary className="cursor-pointer">
          {keyEl}
          {keyEl ? <span>: </span> : null}
          <span className="text-[var(--color-muted-foreground)]">[ {value.length} ]</span>
        </summary>
        <ul className="ms-4 list-none">
          {value.map((item, i) => (
            <li key={i}>
              <JsonNode k={String(i)} value={item} />
            </li>
          ))}
        </ul>
      </details>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <span>
          {keyEl}
          {keyEl ? <span>: </span> : null}
          <span>{'{}'}</span>
        </span>
      );
    }
    return (
      <details open={defaultOpen} className="ms-4">
        <summary className="cursor-pointer">
          {keyEl}
          {keyEl ? <span>: </span> : null}
          <span className="text-[var(--color-muted-foreground)]">
            {'{ '}
            {entries.length}
            {' }'}
          </span>
        </summary>
        <ul className="ms-4 list-none">
          {entries.map(([childKey, child]) => (
            <li key={childKey}>
              <JsonNode k={childKey} value={child} />
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return null;
}

export function JsonTree({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">No manifest available.</p>;
  }
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)] p-3 font-mono text-xs leading-relaxed">
      <JsonNode k={null} value={value} defaultOpen />
    </div>
  );
}

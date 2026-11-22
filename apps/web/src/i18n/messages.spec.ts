import { describe, expect, it } from 'vitest';
import en from './messages/en';
import fr from './messages/fr';

/**
 * The missing-key check (#654): it runs with the web app's unit tests in
 * CI. Every namespace in the English catalogue is in scope; French must
 * hold the same keys, with the same ICU arguments and the same rich-text
 * tags, so no page falls back to a raw key or drops a value.
 */

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/**
 * Argument names (`{count}`, `{count, plural, …}`, nested ones inside
 * plural branches) in an ICU message. A small walk over the braces: in
 * `one {file}` the braces hold a branch's text, not an argument.
 */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();

  // Text up to the closing brace of the enclosing branch (or the end).
  function text(start: number): number {
    let i = start;
    while (i < message.length) {
      const c = message.charAt(i);
      if (c === '}') return i + 1;
      i = c === '{' ? argument(i + 1) : i + 1;
    }
    return i;
  }

  // An argument, from just after its opening brace to just after its closing one.
  function argument(start: number): number {
    // eslint-disable-next-line security/detect-unsafe-regex -- test-only, run on this repo's own short catalogue strings
    const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([A-Za-z]+)\s*)?([,}])/.exec(
      message.slice(start),
    );
    if (!head) return start;
    if (head[1]) names.add(head[1]);
    let i = start + head[0].length;
    if (head[3] === '}') return i;
    if (head[2] === 'plural' || head[2] === 'select' || head[2] === 'selectordinal') {
      // Branches: `selector {text}` repeated, then the closing brace.
      while (i < message.length) {
        const c = message.charAt(i);
        if (c === '}') return i + 1;
        i = c === '{' ? text(i + 1) : i + 1;
      }
      return i;
    }
    // A style (`{n, number, percent}`): skip to the closing brace.
    const close = message.indexOf('}', i);
    return close === -1 ? message.length : close + 1;
  }

  text(0);
  return [...names].sort();
}

/** Rich-text tags (`<strong>…</strong>`) in a message. */
function tagsOf(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/<([A-Za-z][A-Za-z0-9]*)>/g)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}

const english = flatten(en as Tree);
const french = flatten(fr as Tree);

describe('argumentsOf', () => {
  it('reads arguments, not plural branch text', () => {
    expect(argumentsOf('{count, plural, one {file} other {# files}} of {total}')).toEqual([
      'count',
      'total',
    ]);
    expect(argumentsOf('{n, plural, =0 {none} other {{name} and # more}}')).toEqual(['n', 'name']);
    expect(argumentsOf('{ratio, number, percent} done')).toEqual(['ratio']);
  });
});

describe('message catalogues', () => {
  it('has every English key in French', () => {
    const missing = [...english.keys()].filter((key) => !french.has(key));
    expect(missing).toEqual([]);
  });

  it('has no French key that English lacks', () => {
    const extra = [...french.keys()].filter((key) => !english.has(key));
    expect(extra).toEqual([]);
  });

  it('has no empty message', () => {
    const empty = [...english, ...french]
      .filter(([, value]) => value.trim().length === 0)
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('uses the same ICU arguments in both languages', () => {
    const mismatched = [...english]
      .filter(([key]) => french.has(key))
      .filter(
        ([key, value]) =>
          argumentsOf(value).join() !== argumentsOf(french.get(key) ?? '').join() ||
          tagsOf(value).join() !== tagsOf(french.get(key) ?? '').join(),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('writes no straight apostrophe, which ICU reads as an escape', () => {
    const offending = [...english, ...french]
      .filter(([, value]) => value.includes("'"))
      .map(([key]) => key);
    expect(offending).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  parseSubgroupConfig,
  parseSubgroupFields,
  parseSubgroupResults,
  SubgroupConfigError,
} from './subgroup-config.js';

const FIELDS = [
  {
    key: 'sex',
    label: 'Sex',
    values: [
      { value: 'F', label: 'Female' },
      { value: 'M', label: 'Male' },
    ],
  },
];

describe('parseSubgroupFields', () => {
  it('reads the declared fields, and [] for the column default', () => {
    expect(parseSubgroupFields(FIELDS)).toEqual(FIELDS);
    expect(parseSubgroupFields([])).toEqual([]);
  });
});

describe('parseSubgroupConfig', () => {
  it('is null when no field is declared', () => {
    expect(parseSubgroupConfig([], null, ['a'])).toBeNull();
  });

  it('reads a map that covers the answer key', () => {
    expect(parseSubgroupConfig(FIELDS, { a: { sex: 'F' }, b: { sex: 'M' } }, ['a', 'b'])).toEqual({
      fields: FIELDS,
      values: { a: { sex: 'F' }, b: { sex: 'M' } },
    });
  });

  it('refuses, loudly, a map that misses an item, uses an undeclared value or is absent', () => {
    expect(() => parseSubgroupConfig(FIELDS, { a: { sex: 'F' } }, ['a', 'b'])).toThrow(
      SubgroupConfigError,
    );
    expect(() => parseSubgroupConfig(FIELDS, { a: { sex: 'X' } }, ['a'])).toThrow(
      SubgroupConfigError,
    );
    expect(() => parseSubgroupConfig(FIELDS, null, ['a'])).toThrow(SubgroupConfigError);
  });

  it('refuses a declaration that does not parse rather than reading it as none', () => {
    expect(() => parseSubgroupConfig([{ key: 'sex' }], { a: { sex: 'F' } }, ['a'])).toThrow(
      SubgroupConfigError,
    );
  });

  it('never puts an item’s value in the error', () => {
    try {
      parseSubgroupConfig(FIELDS, { a: { sex: 'Xq' } }, ['a']);
    } catch (err) {
      expect(String(err)).not.toContain('Xq');
    }
  });
});

describe('parseSubgroupResults', () => {
  it('is null for SQL NULL and for a value that does not parse', () => {
    expect(parseSubgroupResults(null)).toBeNull();
    expect(parseSubgroupResults({ minCellSize: 11 })).toBeNull();
  });
});

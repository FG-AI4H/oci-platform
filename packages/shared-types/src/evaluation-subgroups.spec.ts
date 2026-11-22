import { describe, expect, it } from 'vitest';
import {
  CreateEvaluationTaskRequestSchema,
  SubgroupCellSchema,
  SubgroupFieldsSchema,
  SubgroupResultsSchema,
} from './index.js';

const base = {
  slug: 'chest-finding',
  name: 'Chest X-ray finding',
  datasetSlug: 'chest-xr',
  taskKind: 'CLASSIFICATION' as const,
  numClasses: 2,
  referableThreshold: 1,
  groundTruth: { a: 1, b: 0, c: 0 },
};
const sex = {
  key: 'sex',
  label: 'Sex',
  values: [
    { value: 'F', label: 'Female' },
    { value: 'M', label: 'Male' },
  ],
};
const band = {
  key: 'ageBand',
  label: 'Age band',
  values: [
    { value: '18-39', label: '18 to 39' },
    { value: '60+', label: '60 and over' },
  ],
};
const values = {
  a: { sex: 'F', ageBand: '60+' },
  b: { sex: 'M', ageBand: '18-39' },
  c: { sex: 'F', ageBand: '18-39' },
};

const issues = (body: unknown) => {
  const parsed = CreateEvaluationTaskRequestSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('CreateEvaluationTaskRequestSchema — subgroups (#410)', () => {
  it('accepts a task without subgroups, as before', () => {
    expect(issues(base)).toEqual([]);
  });

  it('accepts a declaration whose map covers every item with declared values', () => {
    expect(issues({ ...base, subgroups: { fields: [sex, band], values } })).toEqual([]);
  });

  it('refuses an item with no values, a missing field and an undeclared value', () => {
    const found = issues({
      ...base,
      subgroups: {
        fields: [sex, band],
        values: {
          a: { sex: 'F', ageBand: '60+' },
          b: { sex: 'M' },
          c: { sex: 'X', ageBand: '60+' },
        },
      },
    });
    expect(found).toEqual([
      'subgroups.values.b.ageBand: item "b" has no value for field "ageBand"',
      'subgroups.values.c.sex: item "c" has a value for field "sex" that the field does not declare',
    ]);
    // The refusal names the item and the field, never the value it was given.
    expect(found.join(' ')).not.toContain('"X"');

    expect(
      issues({
        ...base,
        subgroups: { fields: [sex], values: { a: { sex: 'F' }, b: { sex: 'M' } } },
      }),
    ).toEqual(['subgroups.values.c: item "c" has no subgroup values']);
  });

  it('refuses an item outside the answer key and a field that is not declared', () => {
    expect(
      issues({
        ...base,
        subgroups: {
          fields: [sex],
          values: { a: { sex: 'F' }, b: { sex: 'M' }, c: { sex: 'F', site: '2' }, z: { sex: 'F' } },
        },
      }),
    ).toEqual([
      'subgroups.values.c.site: item "c" names field "site", which is not declared',
      'subgroups.values.z: item "z" is not in the answer key',
    ]);
  });

  it('refuses an empty field list, a field with one value and duplicate keys or values', () => {
    expect(issues({ ...base, subgroups: { fields: [], values } })).not.toEqual([]);
    expect(
      SubgroupFieldsSchema.safeParse([{ ...sex, values: [{ value: 'F', label: 'Female' }] }])
        .success,
    ).toBe(false);
    expect(SubgroupFieldsSchema.safeParse([sex, sex]).success).toBe(false);
    expect(
      SubgroupFieldsSchema.safeParse([
        {
          ...sex,
          values: [
            { value: 'F', label: 'Female' },
            { value: 'F', label: 'Again' },
          ],
        },
      ]).success,
    ).toBe(false);
  });

  it('refuses value codes and keys outside the safe character set', () => {
    for (const value of ['', ' F', 'F"x', 'F/x', 'a'.repeat(41), 'é']) {
      expect(
        SubgroupFieldsSchema.safeParse([
          {
            ...sex,
            values: [
              { value, label: 'x' },
              { value: 'M', label: 'Male' },
            ],
          },
        ]).success,
        value,
      ).toBe(false);
    }
    expect(SubgroupFieldsSchema.safeParse([{ ...sex, key: 'Age band' }]).success).toBe(false);
  });
});

describe('SubgroupCellSchema', () => {
  it('a withheld group carries no count and no figure', () => {
    expect(
      SubgroupCellSchema.safeParse({
        status: 'SUPPRESSED',
        value: '60+',
        label: '60 and over',
        itemCount: 4,
      }).success,
    ).toBe(false);
  });

  it('a group published by subgroup has no per-class table', () => {
    expect(
      SubgroupResultsSchema.safeParse({
        minCellSize: 11,
        fields: [
          {
            key: 'sex',
            label: 'Sex',
            cells: [
              {
                status: 'REPORTED',
                value: 'F',
                label: 'Female',
                itemCount: 20,
                scoredCount: 20,
                metrics: {
                  kind: 'CLASSIFICATION',
                  accuracy: 1,
                  balancedAccuracy: 1,
                  macroF1: 1,
                  perClass: [],
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

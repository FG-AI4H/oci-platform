import { z } from 'zod';

/**
 * Subgroup fields of an evaluation task (#410, ADR-0030).
 *
 * A task may declare a few fields (sex, age band, site, device) that its
 * results are broken down by. The declaration (keys, labels, allowed values)
 * is public configuration and is published with the task. The value of each
 * field for each item is NOT: per item, a sex and an age band are
 * quasi-identifiers, so the map is held server-side beside the answer key and
 * no read response carries it. Only aggregate results per subgroup leave the
 * API, and only for groups large enough to publish.
 *
 * This file holds the declaration and its validation against the answer key.
 * The result shapes live next to the score shapes in `index.ts`, because they
 * reuse the proportion and AUC estimates defined there.
 */

/**
 * The smallest number of scored items a subgroup must have for its results to
 * be published. A group of 1 to 10 is withheld. Taken from the CMS cell size
 * suppression policy (no cell of 1 to 10 may be shown, nor derived from other
 * reported figures), read on 2026-11-22; see ADR-0030 for why that rule.
 */
export const MIN_SUBGROUP_CELL_SIZE = 11;

/** At most this many fields per task: each one is a breakdown on every result page. */
export const MAX_SUBGROUP_FIELDS = 6;

/** At most this many values per field: a field with more is not a subgroup. */
export const MAX_SUBGROUP_VALUES = 20;

/** A field key, as code: `sex`, `ageBand`, `site`. */
export const SubgroupFieldKeySchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,39}$/, 'a field key is a letter then up to 39 letters or digits');

/**
 * A value code: `F`, `60+`, `18-39`, `<18`, `site 2`. Short, printable ASCII,
 * so it can be a column of a metadata file and a part of a URL fragment.
 */
export const SubgroupValueCodeSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9<>+=][A-Za-z0-9<>+=._ -]{0,39}$/,
    'a value is 1 to 40 letters, digits, spaces or the signs < > + = . _ -',
  );

const LabelSchema = z.string().trim().min(1).max(80);

export const SubgroupValueSchema = z
  .object({
    value: SubgroupValueCodeSchema,
    /** How the value is shown: "60 and over" for `60+`. */
    label: LabelSchema,
  })
  .strict();
export type SubgroupValue = z.infer<typeof SubgroupValueSchema>;

export const SubgroupFieldSchema = z
  .object({
    key: SubgroupFieldKeySchema,
    /** How the field is shown: "Age band" for `ageBand`. */
    label: LabelSchema,
    values: z.array(SubgroupValueSchema).min(2).max(MAX_SUBGROUP_VALUES),
  })
  .strict()
  .superRefine((field, ctx) => {
    const seen = new Set<string>();
    field.values.forEach((v, i) => {
      if (seen.has(v.value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', i, 'value'],
          message: `value "${v.value}" is declared twice`,
        });
      }
      seen.add(v.value);
    });
  });
export type SubgroupField = z.infer<typeof SubgroupFieldSchema>;

/** The declared fields of a task, in the order they are shown. */
export const SubgroupFieldsSchema = z
  .array(SubgroupFieldSchema)
  .max(MAX_SUBGROUP_FIELDS)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'key'],
          message: `field "${f.key}" is declared twice`,
        });
      }
      seen.add(f.key);
    });
  });

/** Each item's value for each declared field: `{ itemId: { fieldKey: value } }`. */
export const SubgroupItemValuesSchema = z.record(
  z.string().min(1).max(200),
  z.record(SubgroupFieldKeySchema, SubgroupValueCodeSchema),
);
export type SubgroupItemValues = z.infer<typeof SubgroupItemValuesSchema>;

/**
 * `subgroups` in a task-creation request: the declaration and the item map
 * together, so one cannot arrive without the other.
 */
export const SubgroupDeclarationSchema = z
  .object({
    fields: SubgroupFieldsSchema.min(1),
    values: SubgroupItemValuesSchema,
  })
  .strict();
export type SubgroupDeclaration = z.infer<typeof SubgroupDeclarationSchema>;

/** Report problems found by `subgroupDeclarationIssues`, at most this many. */
const MAX_REPORTED_ISSUES = 20;

/**
 * Check a declaration against the task's item set: every item has a value for
 * every declared field, every value is one the field declares, and the map
 * names no item and no field the task does not have. Returns the problems,
 * each with its path inside `subgroups`; an empty list means valid.
 *
 * The message names the item id and the field, never the value an item was
 * given: a refusal must not echo a quasi-identifier back.
 */
export function subgroupDeclarationIssues(
  declaration: SubgroupDeclaration,
  itemIds: readonly string[],
): { path: (string | number)[]; message: string }[] {
  /* eslint-disable security/detect-object-injection --
   * Both reads below are of a key whose own presence was checked first with
   * `hasOwnProperty`; nothing is written into the caller's objects. */
  const issues: { path: (string | number)[]; message: string }[] = [];
  const push = (path: (string | number)[], message: string) => {
    if (issues.length < MAX_REPORTED_ISSUES) issues.push({ path, message });
  };
  const allowed = new Map(
    declaration.fields.map((f) => [f.key, new Set(f.values.map((v) => v.value))]),
  );
  const items = new Set(itemIds);

  for (const itemId of itemIds) {
    const row = Object.prototype.hasOwnProperty.call(declaration.values, itemId)
      ? declaration.values[itemId]
      : undefined;
    if (row === undefined) {
      push(['values', itemId], `item "${itemId}" has no subgroup values`);
      continue;
    }
    for (const [key, values] of allowed) {
      const value = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
      if (value === undefined) {
        push(['values', itemId, key], `item "${itemId}" has no value for field "${key}"`);
      } else if (!values.has(value)) {
        push(
          ['values', itemId, key],
          `item "${itemId}" has a value for field "${key}" that the field does not declare`,
        );
      }
    }
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) {
        push(
          ['values', itemId, key],
          `item "${itemId}" names field "${key}", which is not declared`,
        );
      }
    }
  }
  for (const itemId of Object.keys(declaration.values)) {
    if (!items.has(itemId)) {
      push(['values', itemId], `item "${itemId}" is not in the answer key`);
    }
  }
  return issues;
}

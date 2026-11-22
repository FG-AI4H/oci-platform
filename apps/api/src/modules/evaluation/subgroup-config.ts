/**
 * Read the stored subgroup columns back (#410, ADR-0030). Pure.
 *
 * The columns are JSONB, so what comes out of them is validated with the same
 * schemas that guarded the way in, rather than cast. A value that no longer
 * matches is treated as absent: a corrupt declaration must not break a task's
 * page, and a corrupt item map must not produce a breakdown from partial
 * data.
 */

import {
  SubgroupFieldsSchema,
  SubgroupItemValuesSchema,
  SubgroupResultsSchema,
  subgroupDeclarationIssues,
  type SubgroupField,
  type SubgroupResults,
} from '@oci/shared-types';

import type { SubgroupConfig } from './subgroup-scoring.js';

/** The declared fields, or `[]` for none or for a stored value that does not parse. */
export function parseSubgroupFields(raw: unknown): SubgroupField[] {
  const parsed = SubgroupFieldsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** A task declares subgroup fields but its stored item map cannot be used. */
export class SubgroupConfigError extends Error {}

/**
 * The declaration and the item map together, for scoring. `null` when no
 * field is declared.
 *
 * When fields ARE declared, the item map must cover the answer key exactly,
 * with a declared value for every field; otherwise this throws. Scoring then
 * fails as a server error and writes nothing, rather than publishing a result
 * without the breakdown its task promises, or a breakdown computed on a
 * partial map. Only a write that bypassed the API (a seed, hand-written SQL)
 * can get here: the API validates both on the way in.
 *
 * The error names the task's problem, never an item's value.
 */
export function parseSubgroupConfig(
  rawFields: unknown,
  rawValues: unknown,
  itemIds: readonly string[],
): SubgroupConfig | null {
  const fields = parseSubgroupFields(rawFields);
  if (fields.length === 0) {
    // A declaration that does not parse is not "none": refuse it too.
    if (Array.isArray(rawFields) && rawFields.length > 0) {
      throw new SubgroupConfigError('stored subgroup fields do not match the declaration schema');
    }
    return null;
  }
  const values = SubgroupItemValuesSchema.safeParse(rawValues);
  if (!values.success) {
    throw new SubgroupConfigError('stored subgroup item values do not match their schema');
  }
  const issues = subgroupDeclarationIssues({ fields, values: values.data }, itemIds);
  if (issues.length > 0) {
    throw new SubgroupConfigError(
      `stored subgroup item values do not cover the answer key: ${issues.length} problem(s), first: ${issues[0]?.message ?? ''}`,
    );
  }
  return { fields, values: values.data };
}

/** Stored subgroup results, or `null` for none or for a value that does not parse. */
export function parseSubgroupResults(raw: unknown): SubgroupResults | null {
  if (raw === null || raw === undefined) return null;
  const parsed = SubgroupResultsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

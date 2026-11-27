import type { ToolsetResponse } from '@oci/shared-types';

/**
 * The toolset form (#830): what the browser sends, how it becomes the API's
 * `CreateToolsetRequest`, and how the schema's complaints find their way back
 * to the field that caused them.
 *
 * Validation is NOT here: the server actions parse the request this module
 * builds with the schemas of `@oci/shared-types`, the ones the API's pipe
 * uses. Pure, no I/O.
 */

export const TOOLSET_FORM_FIELDS = [
  'slug',
  'name',
  'kind',
  'summary',
  'url',
  'version',
  'licence',
  'maintainer',
  'contact',
  'datasetSlugs',
  'modelCardSlugs',
] as const;
export type ToolsetFormField = (typeof TOOLSET_FORM_FIELDS)[number];

/** What the user typed, as typed: echoed back into the form after an error. */
export type ToolsetFormValues = Record<ToolsetFormField, string>;

export function emptyToolsetFormValues(): ToolsetFormValues {
  return Object.fromEntries(
    TOOLSET_FORM_FIELDS.map((f) => [f, f === 'kind' ? 'NOTEBOOK' : '']),
  ) as ToolsetFormValues;
}

/** Read the submitted form. Unknown entries are ignored; text is kept as typed. */
export function readToolsetForm(formData: FormData): ToolsetFormValues {
  return Object.fromEntries(
    TOOLSET_FORM_FIELDS.map((f) => {
      const raw = formData.get(f);
      return [f, typeof raw === 'string' ? raw : ''];
    }),
  ) as ToolsetFormValues;
}

/** Identifiers typed in one box: separated by commas, spaces or line breaks. */
export function identifierList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The create request the form describes. Not validated: the caller parses it. */
export function toolsetRequestFromValues(values: ToolsetFormValues): Record<string, unknown> {
  return {
    slug: values.slug.trim(),
    name: values.name,
    kind: values.kind,
    summary: values.summary,
    url: values.url,
    version: values.version,
    licence: values.licence,
    maintainer: values.maintainer,
    contact: values.contact,
    datasetSlugs: identifierList(values.datasetSlugs),
    modelCardSlugs: identifierList(values.modelCardSlugs),
  };
}

/** The first message per field from a failed parse; a message no field owns goes to `other`. */
export function toolsetFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { fieldErrors: Map<ToolsetFormField, string>; other: string[] } {
  const fieldErrors = new Map<ToolsetFormField, string>();
  const other: string[] = [];
  for (const issue of issues) {
    const field = TOOLSET_FORM_FIELDS.find((f) => f === issue.path[0]);
    if (!field) other.push(issue.message);
    else if (!fieldErrors.has(field)) fieldErrors.set(field, issue.message);
  }
  return { fieldErrors, other };
}

/**
 * The identifiers the API refused as not on the platform or not visible to
 * the declarer, read from its 400 answer. Anything else gives two empty lists.
 */
export function unknownLinks(body: unknown): { datasets: string[]; modelCards: string[] } {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
  if (body === null || typeof body !== 'object') return { datasets: [], modelCards: [] };
  const answer = body as { unknownDatasets?: unknown; unknownModelCards?: unknown };
  return {
    datasets: strings(answer.unknownDatasets),
    modelCards: strings(answer.unknownModelCards),
  };
}

/** A saved toolset, as the form shows it for editing. Its declarer gets every identifier back. */
export function toolsetFormValuesFrom(toolset: ToolsetResponse): ToolsetFormValues {
  return {
    slug: toolset.slug,
    name: toolset.name,
    kind: toolset.kind,
    summary: toolset.summary,
    url: toolset.url,
    version: toolset.version ?? '',
    licence: toolset.licence ?? '',
    maintainer: toolset.maintainer,
    contact: toolset.contact ?? '',
    datasetSlugs: (toolset.datasetSlugs ?? toolset.datasets.map((d) => d.slug)).join(', '),
    modelCardSlugs: (toolset.modelCardSlugs ?? toolset.modelCards.map((m) => m.slug)).join(', '),
  };
}

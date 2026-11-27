import { describe, expect, it } from 'vitest';
import {
  CreateToolsetRequestSchema,
  UpdateToolsetRequestSchema,
  type ToolsetResponse,
} from '@oci/shared-types';
import {
  emptyToolsetFormValues,
  identifierList,
  readToolsetForm,
  toolsetFieldErrors,
  toolsetFormValuesFrom,
  toolsetRequestFromValues,
  unknownLinks,
  type ToolsetFormValues,
} from './toolset-form';

function filled(over: Partial<ToolsetFormValues> = {}): ToolsetFormValues {
  return {
    ...emptyToolsetFormValues(),
    slug: 'dr-grading-baseline',
    name: 'Diabetic retinopathy grading baseline',
    kind: 'NOTEBOOK',
    summary: 'Trains and scores a small baseline on the grading task, end to end.',
    url: 'https://github.com/example/dr-baseline',
    maintainer: 'Example Imaging Lab',
    ...over,
  };
}

describe('the toolset form (#830)', () => {
  it('reads the fields as typed and ignores the rest', () => {
    const fd = new FormData();
    fd.set('slug', ' dr-grading-baseline ');
    fd.set('status', 'PUBLISHED'); // not a field
    const values = readToolsetForm(fd);

    expect(values.slug).toBe(' dr-grading-baseline ');
    expect(values.name).toBe('');
    expect(values).not.toHaveProperty('status');
  });

  it('reads identifiers separated by commas, spaces or line breaks', () => {
    expect(identifierList(' idrid-grading,rsna-pneumonia-2018\n  isic-2019 ; ')).toEqual([
      'idrid-grading',
      'rsna-pneumonia-2018',
      'isic-2019',
    ]);
    expect(identifierList('  ')).toEqual([]);
  });

  it('builds a request the API schema accepts, blank options left out', () => {
    const parsed = CreateToolsetRequestSchema.parse(
      toolsetRequestFromValues(filled({ datasetSlugs: 'idrid-grading, rsna-pneumonia-2018' })),
    );

    expect(parsed).toMatchObject({
      slug: 'dr-grading-baseline',
      licence: null,
      version: null,
      contact: null,
      datasetSlugs: ['idrid-grading', 'rsna-pneumonia-2018'],
      modelCardSlugs: [],
    });
  });

  it('puts each complaint of the schema on its field', () => {
    const result = CreateToolsetRequestSchema.safeParse(
      toolsetRequestFromValues(
        filled({ url: 'javascript:alert(1)', summary: 'Short.', datasetSlugs: 'Not A Slug' }),
      ),
    );
    if (result.success) throw new Error('expected a refusal');

    const { fieldErrors, other } = toolsetFieldErrors(result.error.issues);

    expect([...fieldErrors.keys()].sort()).toEqual(['datasetSlugs', 'summary', 'url']);
    expect(other).toEqual([]);
  });

  it('reads the identifiers the API refused, and nothing from any other answer', () => {
    expect(
      unknownLinks({ message: 'x', unknownDatasets: ['private-ct'], unknownModelCards: [] }),
    ).toEqual({ datasets: ['private-ct'], modelCards: [] });
    expect(unknownLinks({ message: 'something else' })).toEqual({ datasets: [], modelCards: [] });
    expect(unknownLinks(null)).toEqual({ datasets: [], modelCards: [] });
  });

  it('shows a saved toolset for editing and sends back what the form owns', () => {
    const saved = {
      slug: 'dr-grading-baseline',
      name: 'Diabetic retinopathy grading baseline',
      kind: 'NOTEBOOK',
      summary: 'Trains and scores a small baseline on the grading task, end to end.',
      url: 'https://github.com/example/dr-baseline',
      licence: 'Apache-2.0',
      version: null,
      maintainer: 'Example Imaging Lab',
      contact: null,
      // One dataset is no longer visible: it is not in `datasets`, but its
      // declarer still gets its identifier back.
      datasets: [{ slug: 'idrid-grading', name: 'IDRiD' }],
      datasetSlugs: ['idrid-grading', 'now-private'],
      modelCards: [],
      modelCardSlugs: [],
    } as unknown as ToolsetResponse;

    const values = toolsetFormValuesFrom(saved);
    expect(values.datasetSlugs).toBe('idrid-grading, now-private');
    expect(values.licence).toBe('Apache-2.0');

    const { slug: _slug, ...body } = CreateToolsetRequestSchema.parse(
      toolsetRequestFromValues(values),
    );
    expect(UpdateToolsetRequestSchema.parse(body)).toMatchObject({
      licence: 'Apache-2.0',
      datasetSlugs: ['idrid-grading', 'now-private'],
    });
  });
});

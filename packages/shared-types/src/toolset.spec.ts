import { describe, expect, it } from 'vitest';
import {
  CreateToolsetRequestSchema,
  ListToolsetsQuerySchema,
  MAX_TOOLSET_LINKS,
  UpdateToolsetRequestSchema,
  canEditToolset,
  toolsetMovesFor,
  toolsetVisibleTo,
  type ToolsetStatus,
} from './toolset.js';

const base = {
  slug: 'dr-grading-baseline',
  name: 'Diabetic retinopathy grading baseline',
  kind: 'NOTEBOOK',
  summary: 'Trains and scores a small baseline on the grading task, end to end.',
  url: 'https://github.com/example/dr-baseline',
  maintainer: 'Example Imaging Lab',
};
const ok = (over: Record<string, unknown> = {}) =>
  CreateToolsetRequestSchema.safeParse({ ...base, ...over }).success;

describe('CreateToolsetRequestSchema (#830)', () => {
  it('accepts the required fields alone, with no link', () => {
    expect(CreateToolsetRequestSchema.parse(base)).toMatchObject({
      datasetSlugs: [],
      modelCardSlugs: [],
    });
  });

  it('reads a blank optional field as not given', () => {
    expect(
      CreateToolsetRequestSchema.parse({ ...base, licence: ' ', version: '', contact: '' }),
    ).toMatchObject({ licence: null, version: null, contact: null });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://example.org/x',
    'https://',
    'https://example.org/a b',
    'https://example.org/"><script>',
    'github.com/example/x',
  ])('refuses the address %s', (url) => {
    expect(ok({ url })).toBe(false);
  });

  it.each(['new', 'mine', 'Not_A_Slug', 'ab'])('refuses the identifier %s', (slug) => {
    expect(ok({ slug })).toBe(false);
  });

  it('refuses an unknown kind, a summary too short to say anything, and an unknown field', () => {
    expect(ok({ kind: 'DATASET' })).toBe(false);
    expect(ok({ summary: 'A notebook.' })).toBe(false);
    expect(ok({ status: 'PUBLISHED' })).toBe(false);
  });

  it('refuses a link listed twice and more links than the limit', () => {
    expect(ok({ datasetSlugs: ['idrid', 'idrid'] })).toBe(false);
    expect(ok({ modelCardSlugs: ['grader', 'grader'] })).toBe(false);
    const many = Array.from({ length: MAX_TOOLSET_LINKS + 1 }, (_, n) => `dataset-${n}`);
    expect(ok({ datasetSlugs: many })).toBe(false);
    expect(ok({ datasetSlugs: many.slice(1) })).toBe(true);
  });
});

describe('UpdateToolsetRequestSchema (#830)', () => {
  it('accepts one field and adds no default', () => {
    expect(UpdateToolsetRequestSchema.parse({ version: '1.1.0' })).toEqual({ version: '1.1.0' });
  });

  it('an empty list empties the links; a list left out leaves them alone', () => {
    expect(UpdateToolsetRequestSchema.parse({ datasetSlugs: [] })).toEqual({ datasetSlugs: [] });
  });

  it.each([{}, { slug: 'renamed' }, { status: 'PUBLISHED' }])('refuses %o', (body) => {
    expect(UpdateToolsetRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('who sees, edits and moves a toolset (#830, ADR-0031 decision 5)', () => {
  const stranger = { isOwner: false, isOperator: false };
  const owner = { isOwner: true, isOperator: false };
  const operator = { isOwner: false, isOperator: true };
  const ownerOperator = { isOwner: true, isOperator: true };

  it('a published toolset is public; a draft or a withdrawn one is not', () => {
    expect(toolsetVisibleTo('PUBLISHED', stranger)).toBe(true);
    for (const status of ['DRAFT', 'WITHDRAWN'] as ToolsetStatus[]) {
      expect(toolsetVisibleTo(status, stranger)).toBe(false);
      expect(toolsetVisibleTo(status, owner)).toBe(true);
      expect(toolsetVisibleTo(status, operator)).toBe(true);
    }
  });

  it('only its declarer edits a toolset, and only while it is a draft', () => {
    expect(canEditToolset('DRAFT', owner)).toBe(true);
    expect(canEditToolset('DRAFT', operator)).toBe(false);
    expect(canEditToolset('PUBLISHED', owner)).toBe(false);
    expect(canEditToolset('WITHDRAWN', owner)).toBe(false);
  });

  it('an operator publishes a draft; its declarer alone cannot', () => {
    expect(toolsetMovesFor('DRAFT', owner)).toEqual(['WITHDRAWN']);
    expect(toolsetMovesFor('DRAFT', operator)).toEqual(['PUBLISHED', 'WITHDRAWN']);
    expect(toolsetMovesFor('DRAFT', ownerOperator)).toEqual(['PUBLISHED', 'WITHDRAWN']);
    expect(toolsetMovesFor('DRAFT', stranger)).toEqual([]);
  });

  it('a published toolset can only be withdrawn, by its declarer or an operator', () => {
    expect(toolsetMovesFor('PUBLISHED', owner)).toEqual(['WITHDRAWN']);
    expect(toolsetMovesFor('PUBLISHED', operator)).toEqual(['WITHDRAWN']);
    expect(toolsetMovesFor('PUBLISHED', stranger)).toEqual([]);
  });

  it('withdrawn is terminal', () => {
    expect(toolsetMovesFor('WITHDRAWN', ownerOperator)).toEqual([]);
  });
});

describe('ListToolsetsQuerySchema (#830)', () => {
  it('reads an empty form as the first page of everything', () => {
    expect(ListToolsetsQuerySchema.parse({ q: '', kind: '', datasetSlug: '' })).toEqual({
      page: 1,
      limit: 24,
    });
  });

  it.each([{ q: 'x' }, { kind: 'TOOL' }, { page: '0' }, { limit: '101' }])('refuses %o', (q) => {
    expect(ListToolsetsQuerySchema.safeParse(q).success).toBe(false);
  });
});

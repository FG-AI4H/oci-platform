import { describe, expect, it } from 'vitest';
import { ListModelCardsQuerySchema, ModelCardSlugSchema } from './model-card.js';

describe('ListModelCardsQuerySchema (#591)', () => {
  it('applies the defaults', () => {
    expect(ListModelCardsQuerySchema.parse({})).toEqual({ sort: 'recent', page: 1, limit: 25 });
  });

  it.each([
    ['q', { q: 'a\0b' }],
    ['jurisdiction', { jurisdiction: 'E\0U' }],
  ])('rejects a NUL byte in %s — Postgres would 500 on it', (_field, input) => {
    expect(ListModelCardsQuerySchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { limit: '101' },
    { page: '0' },
    { sort: 'slug; DROP TABLE x' },
    { modelClass: "lmm'--" },
    { q: 'a'.repeat(201) },
  ])('rejects out-of-range or unknown input %o', (input) => {
    expect(ListModelCardsQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('ModelCardSlugSchema (#591)', () => {
  it('accepts a slug', () => {
    expect(ModelCardSlugSchema.parse('demo-retina-dr-grader')).toBe('demo-retina-dr-grader');
  });

  it.each(['../../admin', 'demo\0x', 'Upper-Case', 'ab', 'a'.repeat(121)])('rejects %j', (s) => {
    expect(ModelCardSlugSchema.safeParse(s).success).toBe(false);
  });
});

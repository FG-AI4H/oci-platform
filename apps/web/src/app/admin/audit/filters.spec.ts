import { describe, expect, it } from 'vitest';
import { apiQuery, pageQuery, readCursor, readFilters, utcInstant } from './filters';

describe('/admin/audit filters', () => {
  it('reads the filters from the URL and drops empty fields', () => {
    expect(
      readFilters({ subjectType: 'model-card', subjectId: '', actor: ['system', 'x'], other: 'y' }),
    ).toEqual({ subjectType: 'model-card', actor: 'system' });
    expect(readCursor({ cursor: ' abc ' })).toBe('abc');
  });

  it('reads datetime-local values as UTC', () => {
    expect(utcInstant('2026-11-22T09:30')).toBe('2026-11-22T09:30:00Z');
    expect(utcInstant('2026-11-22T09:30:15')).toBe('2026-11-22T09:30:15Z');
    expect(utcInstant('2026-11-22T09:30:00+01:00')).toBe('2026-11-22T09:30:00+01:00');
  });

  it('builds the API query with UTC times and the page link without them changed', () => {
    const filters = { action: 'prediction', from: '2026-11-22T09:30' };
    expect(apiQuery(filters, { limit: '50' })).toBe(
      'action=prediction&from=2026-11-22T09%3A30%3A00Z&limit=50',
    );
    expect(pageQuery(filters, { cursor: 'c' })).toBe(
      '?action=prediction&from=2026-11-22T09%3A30&cursor=c',
    );
    expect(pageQuery({})).toBe('');
  });
});

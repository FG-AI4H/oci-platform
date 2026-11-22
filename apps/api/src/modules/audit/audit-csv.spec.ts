import type { AuditEventView } from '@oci/shared-types';
import { describe, expect, it } from 'vitest';
import { AUDIT_CSV_COLUMNS, csvCell, toAuditCsv } from './audit-csv.js';

describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+1+2', "'+1+2"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
  ])('neutralises a formula start: %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('quotes commas, quotes and line breaks, and leaves plain text alone', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('model-card')).toBe('model-card');
    expect(csvCell('')).toBe('');
  });
});

describe('toAuditCsv', () => {
  const event: AuditEventView = {
    id: '11111111-1111-4111-8111-111111111111',
    sequenceNumber: '7',
    occurredAt: '2026-11-22T09:00:00.000Z',
    eventType: 'prediction.modelcard.status.changed',
    module: 'prediction',
    action: 'modelcard.status.changed',
    subjectType: 'model-card',
    subjectId: 'abc',
    actor: { kind: 'pseudonym', id: 'ps-0123456789abcdef01234567' },
    actorRoles: ['regulator', 'host'],
    payload: { to: 'PUBLISHED', reason: '=cmd', from: 'SUBMITTED' },
    pseudonymised: [],
    payloadHash: 'p'.repeat(64),
    previousHash: null,
    recordHash: 'r'.repeat(64),
    retentionClass: 'standard-7y',
  };

  it('writes a header and one CRLF-terminated row per event, payload in canonical form', () => {
    const lines = toAuditCsv([event]).split('\r\n');
    expect(lines[0]).toBe(AUDIT_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(lines[1]).toContain('pseudonym,ps-0123456789abcdef01234567,regulator;host');
    // Keys sorted (RFC 8785), in one quoted cell that starts with "{".
    expect(lines[1]).toContain('"{""from"":""SUBMITTED"",""reason"":""=cmd"",""to"":""PUBLISHED""}"');
  });

  it('writes the header only for no events', () => {
    expect(toAuditCsv([])).toBe(AUDIT_CSV_COLUMNS.join(',') + '\r\n');
  });

  it('guards a subject id that starts with a formula character', () => {
    expect(toAuditCsv([{ ...event, subjectId: '=1+1' }])).toContain(",'=1+1,");
  });
});

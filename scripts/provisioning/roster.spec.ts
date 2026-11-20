import { describe, expect, it } from 'vitest';
import { parseRoster, type RosterIssue } from './roster.js';

const HEADER = 'email,given_name,family_name,groups';
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function issuesOf(text: string): RosterIssue[] {
  const result = parseRoster(text);
  if (result.ok) throw new Error('expected the roster to be refused');
  return result.issues;
}

describe('parseRoster', () => {
  it('reads people, their names and their groups', () => {
    const result = parseRoster(
      [
        HEADER,
        'ada@example.org,Ada,Almeida,annotator',
        'ben@example.org,Ben,Brandt,annotator;reviewer',
        'cleo@example.org,Cleo,Castel,',
      ].join('\n'),
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          line: 2,
          email: 'ada@example.org',
          givenName: 'Ada',
          familyName: 'Almeida',
          groups: ['annotator'],
        },
        {
          line: 3,
          email: 'ben@example.org',
          givenName: 'Ben',
          familyName: 'Brandt',
          groups: ['annotator', 'reviewer'],
        },
        { line: 4, email: 'cleo@example.org', givenName: 'Cleo', familyName: 'Castel', groups: [] },
      ],
    });
  });

  it('lower-cases the e-mail, trims cells and drops a repeated group', () => {
    const result = parseRoster(
      `${HEADER}\n  Ada@Example.ORG , Ada , Almeida , annotator ; annotator;reviewer \n`,
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          line: 2,
          email: 'ada@example.org',
          givenName: 'Ada',
          familyName: 'Almeida',
          groups: ['annotator', 'reviewer'],
        },
      ],
    });
  });

  it('accepts a byte-order mark, CRLF line ends, blank lines and quoted cells', () => {
    const result = parseRoster(
      `${BYTE_ORDER_MARK}${HEADER}\r\n\r\n"dee@example.org","Dee","de la Cruz, Jr","annotator"\r\n\r\n`,
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          line: 3,
          email: 'dee@example.org',
          givenName: 'Dee',
          familyName: 'de la Cruz, Jr',
          groups: ['annotator'],
        },
      ],
    });
  });

  it('accepts the columns in another order', () => {
    const result = parseRoster(
      'groups,family_name,given_name,email\nreviewer,Brandt,Ben,ben@example.org',
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          line: 2,
          email: 'ben@example.org',
          givenName: 'Ben',
          familyName: 'Brandt',
          groups: ['reviewer'],
        },
      ],
    });
  });

  it('reads a semicolon-separated export when several groups are quoted', () => {
    const result = parseRoster(
      'email;given_name;family_name;groups\nben@example.org;Ben;Brandt;"annotator;reviewer"',
    );

    expect(result).toEqual({
      ok: true,
      entries: [
        {
          line: 2,
          email: 'ben@example.org',
          givenName: 'Ben',
          familyName: 'Brandt',
          groups: ['annotator', 'reviewer'],
        },
      ],
    });
  });

  it('explains the quoting when a semicolon-separated export has unquoted groups', () => {
    const issues = issuesOf(
      'email;given_name;family_name;groups\nben@example.org;Ben;Brandt;annotator;reviewer',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(2);
    expect(issues[0]?.message).toContain('expected 4 columns, found 5');
    expect(issues[0]?.message).toContain('"annotator;reviewer"');
  });

  it('refuses an unknown group and names the valid ones', () => {
    const issues = issuesOf(`${HEADER}\nada@example.org,Ada,Almeida,annotator;radiologist`);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(2);
    expect(issues[0]?.message).toContain('unknown group "radiologist"');
    expect(issues[0]?.message).toContain('annotator');
    expect(issues[0]?.message).toContain('campaign-manager');
  });

  it('treats group names as case-sensitive, as the user pool does', () => {
    const issues = issuesOf(`${HEADER}\nada@example.org,Ada,Almeida,Annotator`);

    expect(issues[0]?.message).toContain('unknown group "Annotator"');
  });

  it('reports every problem in the file, with its line', () => {
    const issues = issuesOf(
      [
        HEADER,
        'not-an-address,Ada,Almeida,annotator',
        'ben@example.org,,Brandt,annotator',
        'cleo@example.org,Cleo,Castel,nobody',
        'dee@example.org,Dee',
      ].join('\n'),
    );

    expect(issues.map((i) => i.line)).toEqual([2, 3, 4, 5]);
    expect(issues[0]?.message).toContain('is not an e-mail address');
    expect(issues[1]?.message).toBe('given_name is empty');
    expect(issues[2]?.message).toContain('unknown group "nobody"');
    expect(issues[3]?.message).toContain('expected 4 columns, found 2');
  });

  it('refuses the same e-mail twice, whatever its case', () => {
    const issues = issuesOf(
      `${HEADER}\nada@example.org,Ada,Almeida,annotator\nADA@example.org,Ada,Almeida,reviewer`,
    );

    expect(issues).toEqual([{ line: 3, message: 'ada@example.org is already on line 2' }]);
  });

  it('refuses a file without the header', () => {
    const issues = issuesOf('ada@example.org,Ada,Almeida,annotator');

    expect(issues).toEqual([{ line: 1, message: `the first line must be the header "${HEADER}"` }]);
  });

  it('refuses an empty file and a header with nobody under it', () => {
    expect(issuesOf('')[0]?.message).toContain('the file is empty');
    expect(issuesOf(`${HEADER}\n\n`)[0]?.message).toBe('the roster has no one in it');
  });

  it('refuses a quoted value that is never closed', () => {
    const issues = issuesOf(`${HEADER}\nada@example.org,"Ada,Almeida,annotator`);

    expect(issues).toEqual([{ line: 2, message: 'a quoted value is never closed' }]);
  });

  it('refuses a name with a control character', () => {
    const issues = issuesOf(`${HEADER}\nada@example.org,A\u0007da,Almeida,annotator`);

    expect(issues[0]?.message).toBe('given_name contains a control character');
  });
});

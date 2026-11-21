import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTIFYING_ATTRIBUTES } from '@oci/dicom';
import { describe, expect, it } from 'vitest';
import { ACCEPTABLE_BY_DECISION } from './arrival-check.js';
import { MAX_COUNTER_DIGITS, NEUTRAL_WORDS, nameProblem } from './name-rules.js';

/**
 * The conditions guide sent to an institution lists the attributes that
 * must be empty. That list is the platform's (`IDENTIFYING_ATTRIBUTES`
 * in `@oci/dicom`), which is also the one the arrival check refuses on.
 * These tests fail when the guide and the code drift apart, in either
 * language: add or remove the line in both guides when the table in
 * `packages/dicom/src/findings.ts` changes.
 */

const GUIDES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/for-hosts');
const LANGUAGES = [
  ['English', 'providing-an-exam-sample.md'],
  ['French', 'providing-an-exam-sample.fr.md'],
] as const;

function read(file: string): string {
  return readFileSync(path.join(GUIDES, file), 'utf8');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from === -1 || to === -1) throw new Error(`markers ${start} … ${end} not found`);
  return text.slice(from + start.length, to);
}

/** Lines of the first fenced block after a marker. */
function fenced(text: string, marker: string): string[] {
  const after = text.slice(text.indexOf(marker));
  const block = /```\n([\s\S]*?)```/.exec(after)?.[1] ?? '';
  return block.split('\n').filter((line) => line.trim() !== '');
}

describe.each(LANGUAGES)('the conditions guide, %s', (_language, file) => {
  const guide = read(file);

  it("lists exactly the platform's identifying attributes, in its order", () => {
    const rows = between(
      guide,
      '<!-- identifying-attributes:start -->',
      '<!-- identifying-attributes:end -->',
    )
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => /^\([0-9a-f]{4},[0-9a-f]{4}\)$/i.test(cells[1] ?? ''))
      .map((cells) => ({
        tag: (cells[1] ?? '').replace(/[(),]/g, '').toLowerCase(),
        attribute: cells[2] ?? '',
        label: cells[3] ?? '',
      }));

    expect(rows.map(({ tag, attribute }) => ({ tag, attribute }))).toEqual(
      IDENTIFYING_ATTRIBUTES.map(({ tag, attribute }) => ({ tag, attribute })),
    );
    // Every line says in plain words what the attribute is.
    expect(rows.every((row) => row.label.length > 3)).toBe(true);
  });

  it('names the whole-file findings the check also refuses', () => {
    expect(guide).toContain('BurnedInAnnotation');
    expect(guide).toMatch(/private tags|balise privée/);
    expect(guide).toMatch(/follow the pixel data|suivre les données d'image/);
  });

  it('shows names the naming convention accepts, and names it refuses', () => {
    const accepted = fenced(guide, '<!-- names:accepted -->');
    expect(accepted.length).toBeGreaterThanOrEqual(3);
    for (const example of accepted) {
      for (const component of example.split('/')) expect(nameProblem(component)).toBeNull();
    }
    // Lines with a space describe a kind of name; the others are names.
    const refused = fenced(guide, '<!-- names:refused -->').filter((line) => !line.includes(' '));
    expect(refused.length).toBeGreaterThanOrEqual(2);
    for (const example of refused) expect(nameProblem(example)).not.toBeNull();
  });

  it('states the limits of the convention as the code has them', () => {
    expect(MAX_COUNTER_DIGITS).toBe(5);
    expect(guide).toMatch(/more than five digits|plus de cinq chiffres/);
    const quoted = /\(([a-z, ]+) (?:and the like|et semblables)/.exec(guide)?.[1];
    expect(quoted).toBeDefined();
    for (const word of (quoted ?? '').split(', ')) expect(NEUTRAL_WORDS.has(word)).toBe(true);
  });

  it('limits a recorded decision to the five fields the check can accept', () => {
    expect(ACCEPTABLE_BY_DECISION).toEqual([
      'PatientName',
      'PatientID',
      'StudyDate',
      'SeriesDate',
      'AcquisitionDate',
    ]);
    expect(guide).toMatch(
      /patient name, patient number and the three dates, nothing else|nom du patient, numéro du patient et les trois dates, rien d'autre/,
    );
  });

  it('says what it is, and names no country, institution or law', () => {
    expect(guide).toMatch(/not legal advice|ne constitue pas un avis juridique/);
    expect(guide).not.toMatch(/GDPR|RGPD|HIPAA|Regulation \(EU\)|loi n°/i);
  });
});

describe('the French guide', () => {
  it('is marked as a draft to be reviewed before it is sent', () => {
    expect(read('providing-an-exam-sample.fr.md')).toMatch(/Projet de traduction, à relire/);
  });
});

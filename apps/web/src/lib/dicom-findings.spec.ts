import type { DicomUndecidedFinding } from '@oci/shared-types';
// The header check's own lists, reached by path: the web app does not
// depend on the header-reading package, and a test is no reason to.
import {
  IDENTIFYING_ATTRIBUTES,
  WHOLE_FILE_FINDING_ATTRIBUTES,
} from '../../../../packages/dicom/src/findings';
import { describe, expect, it } from 'vitest';
import {
  countOf,
  findingKind,
  findingToken,
  groupFindings,
  parseFindingToken,
} from './dicom-findings';

const finding = (overrides: Partial<DicomUndecidedFinding>): DicomUndecidedFinding => ({
  attribute: 'PatientID',
  valueDigest: 'ab'.repeat(32),
  value: 'STUDY-0001',
  valueTruncated: false,
  wholeFile: false,
  acceptable: true,
  instanceCount: 3,
  seriesCount: 1,
  ...overrides,
});

describe('findingKind', () => {
  it('names an attribute in plain words and says what to consider', () => {
    expect(findingKind('PatientID')).toMatchObject({ label: 'Patient ID', hasValue: true });
    expect(findingKind('StudyDate').hint).toContain('shifted');
  });

  it('marks the findings about the whole file, which have no value to show', () => {
    for (const attribute of ['BurnedInAnnotation', 'DataAfterPixelData', 'SequenceDepthExceeded']) {
      expect(findingKind(attribute).hasValue, attribute).toBe(false);
    }
  });

  it('names in plain words every attribute the header check looks for', () => {
    for (const { attribute } of IDENTIFYING_ATTRIBUTES) {
      // A keyword shown as itself means the label table fell behind the list.
      expect(findingKind(attribute).label, attribute).not.toBe(attribute);
      expect(findingKind(attribute).hasValue, attribute).toBe(true);
    }
    for (const attribute of WHOLE_FILE_FINDING_ATTRIBUTES) {
      expect(findingKind(attribute).label, attribute).not.toBe(attribute);
    }
  });

  it('shows a keyword it does not know as it is, rather than hiding the finding', () => {
    expect(findingKind('SomeNewAttribute')).toMatchObject({
      label: 'SomeNewAttribute',
      hasValue: true,
    });
  });
});

describe('finding tokens', () => {
  it('round-trips a finding through a form field', () => {
    const ref = { attribute: 'PatientName', valueDigest: 'cd'.repeat(32) };
    expect(parseFindingToken(findingToken(ref))).toEqual(ref);
  });

  it('refuses what is not a token', () => {
    expect(parseFindingToken('')).toBeNull();
    expect(parseFindingToken('no-separator')).toBeNull();
    expect(parseFindingToken(':digest-without-attribute')).toBeNull();
  });
});

describe('groupFindings', () => {
  it('groups by attribute, keeps the order given, and adds up the files', () => {
    const groups = groupFindings([
      finding({ value: 'STUDY-0001', instanceCount: 3 }),
      finding({ value: 'STUDY-0002', valueDigest: 'cd'.repeat(32), instanceCount: 1 }),
      finding({ attribute: 'StudyDate', value: '20200101', instanceCount: 4 }),
    ]);

    expect(
      groups.map((g) => [g.attribute, g.kind.label, g.findings.length, g.instanceCount]),
    ).toEqual([
      ['PatientID', 'Patient ID', 2, 4],
      ['StudyDate', 'Study date', 1, 4],
    ]);
  });

  it('is empty for nothing', () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('countOf', () => {
  it('agrees in number', () => {
    expect(countOf(1, 'image', 'images')).toBe('1 image');
    expect(countOf(0, 'image', 'images')).toBe('0 images');
    expect(countOf(12, 'image', 'images')).toBe('12 images');
  });
});

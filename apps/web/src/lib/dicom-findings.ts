import type { DicomUndecidedFinding } from '@oci/shared-types';

/**
 * How de-identification findings are named and grouped on the
 * operator's review screen (#674, ADR-0026).
 *
 * The index names a finding by its DICOM keyword. An operator reads
 * plain words, and needs to know what kind of finding it is: a value
 * to look at, or something about the file as a whole that has no value
 * to show.
 */
export interface FindingKind {
  label: string;
  /** What the operator has to consider before accepting it. */
  hint: string;
  /** False for findings about the file as a whole. */
  hasValue: boolean;
}

const KINDS: ReadonlyMap<string, FindingKind> = new Map([
  [
    'PatientName',
    { label: 'Patient name', hint: 'A code is fine. A name is not.', hasValue: true },
  ],
  [
    'PatientID',
    {
      label: 'Patient ID',
      hint: 'A study code is fine. A hospital number is not.',
      hasValue: true,
    },
  ],
  [
    'OtherPatientIDs',
    {
      label: 'Other patient IDs',
      hint: 'A study code is fine. A hospital number is not.',
      hasValue: true,
    },
  ],
  [
    'PatientBirthDate',
    {
      label: 'Patient birth date',
      hint: 'A real birth date identifies. A shifted or truncated one may not.',
      hasValue: true,
    },
  ],
  ['PatientAddress', { label: 'Patient address', hint: 'Should be empty.', hasValue: true }],
  [
    'PatientTelephoneNumbers',
    { label: 'Patient telephone', hint: 'Should be empty.', hasValue: true },
  ],
  [
    'AccessionNumber',
    {
      label: 'Accession number',
      hint: 'A hospital accession number links back to the record.',
      hasValue: true,
    },
  ],
  [
    'InstitutionName',
    {
      label: 'Institution name',
      hint: 'Acceptable only if the host agreed to be named.',
      hasValue: true,
    },
  ],
  [
    'InstitutionAddress',
    {
      label: 'Institution address',
      hint: 'Acceptable only if the host agreed to be named.',
      hasValue: true,
    },
  ],
  [
    'ReferringPhysicianName',
    {
      label: 'Referring physician',
      hint: 'A staff name. Should be empty or a code.',
      hasValue: true,
    },
  ],
  [
    'PerformingPhysicianName',
    {
      label: 'Performing physician',
      hint: 'A staff name. Should be empty or a code.',
      hasValue: true,
    },
  ],
  [
    'OperatorsName',
    { label: 'Operator', hint: 'A staff name. Should be empty or a code.', hasValue: true },
  ],
  [
    'StudyDate',
    { label: 'Study date', hint: 'A shifted date is fine. The real date is not.', hasValue: true },
  ],
  [
    'SeriesDate',
    { label: 'Series date', hint: 'A shifted date is fine. The real date is not.', hasValue: true },
  ],
  [
    'AcquisitionDate',
    {
      label: 'Acquisition date',
      hint: 'A shifted date is fine. The real date is not.',
      hasValue: true,
    },
  ],
  [
    'DeviceSerialNumber',
    { label: 'Device serial number', hint: 'Names one scanner, and so one site.', hasValue: true },
  ],
  ['StationName', { label: 'Station name', hint: 'Often names a room or a site.', hasValue: true }],
  [
    'PrivateTags',
    {
      label: 'Private tags',
      hint: 'Vendor fields the check cannot read. The value lists their groups.',
      hasValue: true,
    },
  ],
  [
    'BurnedInAnnotation',
    {
      label: 'Burned-in annotation',
      hint: 'The file says text is drawn into the picture. Look at the images.',
      hasValue: false,
    },
  ],
  [
    'DataAfterPixelData',
    {
      label: 'Content after the picture',
      hint: 'Something follows the pixel data that the check did not read.',
      hasValue: false,
    },
  ],
  [
    'SequenceDepthExceeded',
    {
      label: 'Deeply nested content',
      hint: 'Sequences nested deeper than the check goes.',
      hasValue: false,
    },
  ],
]);

export function findingKind(attribute: string): FindingKind {
  return (
    KINDS.get(attribute) ?? {
      // A keyword this screen does not know yet: show it as it is.
      label: attribute,
      hint: 'A populated attribute that de-identification normally removes.',
      hasValue: true,
    }
  );
}

/** How a finding travels through a form: `attribute:digest`. */
export function findingToken(finding: { attribute: string; valueDigest: string }): string {
  return `${finding.attribute}:${finding.valueDigest}`;
}

export function parseFindingToken(
  token: string,
): { attribute: string; valueDigest: string } | null {
  const at = token.indexOf(':');
  if (at <= 0) return null;
  return { attribute: token.slice(0, at), valueDigest: token.slice(at + 1) };
}

export interface FindingGroup {
  attribute: string;
  kind: FindingKind;
  findings: DicomUndecidedFinding[];
  /** Held files across the values of this attribute. */
  instanceCount: number;
}

/** Findings by attribute, in the order the API gave them. */
export function groupFindings(findings: readonly DicomUndecidedFinding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const group = groups.get(finding.attribute) ?? {
      attribute: finding.attribute,
      kind: findingKind(finding.attribute),
      findings: [],
      instanceCount: 0,
    };
    group.findings.push(finding);
    group.instanceCount += finding.instanceCount;
    groups.set(finding.attribute, group);
  }
  return [...groups.values()];
}

/** "1 image" / "12 images". */
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

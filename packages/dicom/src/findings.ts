import type { DataSet } from 'dicom-parser';
import type { DeidentificationFinding } from './types.js';

/**
 * The attributes whose presence is reported as a finding (ADR-0026).
 *
 * This is ADR-0010's `never` bucket read onto DICOM. It is deliberately
 * one flat table: adding an attribute is one line, and the list can be
 * read against DICOM PS3.15 Annex E without following code.
 */
export const IDENTIFYING_ATTRIBUTES: ReadonlyArray<{ tag: string; attribute: string }> = [
  // Patient
  { tag: '00100010', attribute: 'PatientName' },
  { tag: '00100020', attribute: 'PatientID' },
  { tag: '00101000', attribute: 'OtherPatientIDs' },
  { tag: '00100030', attribute: 'PatientBirthDate' },
  { tag: '00101040', attribute: 'PatientAddress' },
  { tag: '00102154', attribute: 'PatientTelephoneNumbers' },
  // Study
  { tag: '00080050', attribute: 'AccessionNumber' },
  // Institution
  { tag: '00080080', attribute: 'InstitutionName' },
  { tag: '00080081', attribute: 'InstitutionAddress' },
  // Staff
  { tag: '00080090', attribute: 'ReferringPhysicianName' },
  { tag: '00081050', attribute: 'PerformingPhysicianName' },
  { tag: '00081070', attribute: 'OperatorsName' },
  // Dates
  { tag: '00080020', attribute: 'StudyDate' },
  { tag: '00080021', attribute: 'SeriesDate' },
  { tag: '00080022', attribute: 'AcquisitionDate' },
  // Device
  { tag: '00181000', attribute: 'DeviceSerialNumber' },
  { tag: '00081010', attribute: 'StationName' },
];

const BURNED_IN_ANNOTATION = '00280301';

/** Sequences nest; a crafted file must not make the walk unbounded. */
const MAX_SEQUENCE_DEPTH = 8;

function text(dataSet: DataSet, tag: string): string | null {
  const value = dataSet.string(`x${tag}`);
  if (value === undefined) return null;
  const trimmed = value.replace(/\0/g, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function walk(
  dataSet: DataSet,
  depth: number,
  found: Map<string, DeidentificationFinding>,
  privateGroups: Set<string>,
): void {
  for (const { tag, attribute } of IDENTIFYING_ATTRIBUTES) {
    const value = text(dataSet, tag);
    if (value !== null) found.set(`${attribute}\u0000${value}`, { attribute, tag, value });
  }

  for (const [key, element] of Object.entries(dataSet.elements)) {
    // Keys are `xggggeeee`. An odd group number is a private group.
    const group = key.slice(1, 5);
    const groupNumber = Number.parseInt(group, 16);
    if (Number.isFinite(groupNumber) && groupNumber % 2 === 1 && groupNumber > 0x0008) {
      privateGroups.add(group);
    }
    if (depth >= MAX_SEQUENCE_DEPTH || !element.items) continue;
    for (const item of element.items) {
      if (item.dataSet) walk(item.dataSet, depth + 1, found, privateGroups);
    }
  }
}

/**
 * Findings for one parsed header, including inside sequences. The
 * result is sorted so that the same header always yields the same list.
 */
export function collectFindings(dataSet: DataSet): DeidentificationFinding[] {
  const found = new Map<string, DeidentificationFinding>();
  const privateGroups = new Set<string>();
  walk(dataSet, 0, found, privateGroups);

  if (text(dataSet, BURNED_IN_ANNOTATION)?.toUpperCase() === 'YES') {
    found.set('BurnedInAnnotation', {
      attribute: 'BurnedInAnnotation',
      tag: BURNED_IN_ANNOTATION,
      value: 'YES',
    });
  }
  if (privateGroups.size > 0) {
    found.set('PrivateTags', {
      attribute: 'PrivateTags',
      tag: null,
      // The groups, not the content: enough to see that the set changed.
      value: [...privateGroups].sort().join(','),
    });
  }

  return [...found.values()].sort(
    (a, b) => a.attribute.localeCompare(b.attribute) || a.value.localeCompare(b.value),
  );
}

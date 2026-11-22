/**
 * Builds small DICOM Part 10 files in memory, for tests.
 *
 * Synthetic on purpose: tests for identifying attributes need files
 * that have them populated, and no real file with a patient's name may
 * ever enter the repository. Every value here is invented.
 */

export type Vr =
  | 'UI'
  | 'CS'
  | 'LO'
  | 'SH'
  | 'PN'
  | 'DA'
  | 'DT'
  | 'DS'
  | 'IS'
  | 'US'
  | 'UL'
  | 'OW'
  | 'OB'
  | 'SQ';

export interface TestElement {
  /** `ggggeeee`, hex. */
  tag: string;
  vr: Vr;
  /** Text for string VRs, a number for US/UL, bytes for OW/OB, items for SQ. */
  value: string | number | Uint8Array | TestElement[][];
}

export const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
export const IMPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2';

const LONG_FORM: ReadonlySet<Vr> = new Set<Vr>(['OW', 'OB', 'SQ']);

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tagBytes(tag: string): Uint8Array {
  return concat([
    u16(Number.parseInt(tag.slice(0, 4), 16)),
    u16(Number.parseInt(tag.slice(4, 8), 16)),
  ]);
}

function valueBytes(element: TestElement, explicit: boolean): Uint8Array {
  const { vr, value } = element;
  if (vr === 'SQ') {
    const items = (value as TestElement[][]).map((item) => {
      const body = concat(item.map((child) => encodeElement(child, explicit)));
      return concat([tagBytes('fffee000'), u32(body.length), body]);
    });
    return concat(items);
  }
  if (value instanceof Uint8Array) return value;
  if (vr === 'US') return u16(value as number);
  if (vr === 'UL') return u32(value as number);
  const text = new TextEncoder().encode(String(value));
  if (text.length % 2 === 0) return text;
  // Values have even length: UIDs are padded with NUL, text with a space.
  return concat([text, new Uint8Array([vr === 'UI' ? 0x00 : 0x20])]);
}

function encodeElement(element: TestElement, explicit: boolean): Uint8Array {
  const value = valueBytes(element, explicit);
  if (!explicit) return concat([tagBytes(element.tag), u32(value.length), value]);
  const vr = new TextEncoder().encode(element.vr);
  return LONG_FORM.has(element.vr)
    ? concat([tagBytes(element.tag), vr, u16(0), u32(value.length), value])
    : concat([tagBytes(element.tag), vr, u16(value.length), value]);
}

/**
 * A Part 10 file: 128-byte preamble, `DICM`, a file meta group (always
 * explicit VR little endian), then the data set in `transferSyntaxUid`.
 * Elements are written in the order given; pass them sorted by tag.
 */
export function buildPart10(
  elements: TestElement[],
  transferSyntaxUid: string = EXPLICIT_VR_LITTLE_ENDIAN,
): Uint8Array {
  const explicit = transferSyntaxUid !== IMPLICIT_VR_LITTLE_ENDIAN;
  const meta = encodeElement({ tag: '00020010', vr: 'UI', value: transferSyntaxUid }, true);
  const groupLength = encodeElement({ tag: '00020000', vr: 'UL', value: meta.length }, true);
  return concat([
    new Uint8Array(128),
    new TextEncoder().encode('DICM'),
    groupLength,
    meta,
    ...elements.map((element) => encodeElement(element, explicit)),
  ]);
}

/** A minimal single-frame CT slice; `overrides` replace or add elements by tag. */
export function ctSlice(overrides: TestElement[] = [], transferSyntaxUid?: string): Uint8Array {
  const base: TestElement[] = [
    { tag: '00080016', vr: 'UI', value: '1.2.840.10008.5.1.4.1.1.2' },
    { tag: '00080018', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.1' },
    { tag: '00080060', vr: 'CS', value: 'CT' },
    { tag: '0020000d', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.100' },
    { tag: '0020000e', vr: 'UI', value: '1.2.826.0.1.3680043.8.498.200' },
    { tag: '00200011', vr: 'IS', value: '2' },
    { tag: '00200013', vr: 'IS', value: '1' },
    { tag: '00200032', vr: 'DS', value: '-100\\-100\\0' },
    { tag: '00200037', vr: 'DS', value: '1\\0\\0\\0\\1\\0' },
    { tag: '00280004', vr: 'CS', value: 'MONOCHROME2' },
    { tag: '00280010', vr: 'US', value: 4 },
    { tag: '00280011', vr: 'US', value: 4 },
    { tag: '00280030', vr: 'DS', value: '0.5\\0.5' },
    { tag: '00280100', vr: 'US', value: 16 },
    { tag: '00280103', vr: 'US', value: 1 },
    { tag: '00281050', vr: 'DS', value: '40' },
    { tag: '00281051', vr: 'DS', value: '80' },
    { tag: '7fe00010', vr: 'OW', value: new Uint8Array(32) },
  ];
  const byTag = new Map(base.map((element) => [element.tag, element]));
  for (const element of overrides) byTag.set(element.tag, element);
  const sorted = [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  return buildPart10(sorted, transferSyntaxUid);
}

/**
 * Names of the DICOM transfer syntaxes a CT export may use, and what is
 * known today about the built-in viewer showing them (ADR-0026, result
 * of the spike). The point of reporting it on arrival is that an
 * encoding nobody has tried is found before the workshop, not in the
 * room.
 */

export interface TransferSyntax {
  name: string;
  /**
   * `displayed`: rendered in the spike. `untested`: nobody has opened a
   * file of this encoding in the viewer yet. `refused`: the platform
   * does not read the header at all.
   */
  viewer: 'displayed' | 'untested' | 'refused';
  note: string;
}

const UNTESTED =
  'not tried in the built-in viewer yet; open one exam on the platform before relying on it.';

const KNOWN: ReadonlyMap<string, TransferSyntax> = new Map<string, TransferSyntax>([
  [
    '1.2.840.10008.1.2.1',
    { name: 'Explicit VR Little Endian', viewer: 'displayed', note: 'displayed by the viewer.' },
  ],
  [
    '1.2.840.10008.1.2.4.80',
    { name: 'JPEG-LS Lossless', viewer: 'displayed', note: 'displayed by the viewer.' },
  ],
  [
    '1.2.840.10008.1.2.4.70',
    {
      name: 'JPEG Lossless (Process 14, SV1)',
      viewer: 'displayed',
      note: 'displayed by the viewer.',
    },
  ],
  ['1.2.840.10008.1.2', { name: 'Implicit VR Little Endian', viewer: 'untested', note: UNTESTED }],
  ['1.2.840.10008.1.2.2', { name: 'Explicit VR Big Endian', viewer: 'untested', note: UNTESTED }],
  [
    '1.2.840.10008.1.2.1.99',
    {
      name: 'Deflated Explicit VR Little Endian',
      viewer: 'refused',
      note: 'the platform does not read deflated files; ask for an uncompressed export.',
    },
  ],
  ['1.2.840.10008.1.2.5', { name: 'RLE Lossless', viewer: 'untested', note: UNTESTED }],
  ['1.2.840.10008.1.2.4.50', { name: 'JPEG Baseline', viewer: 'untested', note: UNTESTED }],
  ['1.2.840.10008.1.2.4.51', { name: 'JPEG Extended', viewer: 'untested', note: UNTESTED }],
  [
    '1.2.840.10008.1.2.4.57',
    { name: 'JPEG Lossless (Process 14)', viewer: 'untested', note: UNTESTED },
  ],
  ['1.2.840.10008.1.2.4.81', { name: 'JPEG-LS Near-lossless', viewer: 'untested', note: UNTESTED }],
  ['1.2.840.10008.1.2.4.90', { name: 'JPEG 2000 Lossless', viewer: 'untested', note: UNTESTED }],
  ['1.2.840.10008.1.2.4.91', { name: 'JPEG 2000', viewer: 'untested', note: UNTESTED }],
]);

export function describeTransferSyntax(uid: string): TransferSyntax {
  return KNOWN.get(uid) ?? { name: 'unknown transfer syntax', viewer: 'untested', note: UNTESTED };
}

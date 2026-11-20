import type { DataSet } from 'dicom-parser';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/**
 * The text of one element, read from its raw bytes.
 *
 * Not the library's `string()`: that stops at the first NUL byte, so a
 * value that starts with one reads as empty while other software shows
 * it. Here NUL bytes are dropped and what remains is the value. Bytes
 * are decoded as UTF-8 when they are valid UTF-8 and as Latin-1
 * otherwise, which covers the two character sets seen in practice; the
 * other ISO 2022 sets come out imperfect but never empty.
 *
 * Throws when the element claims more bytes than the data holds, which
 * is how a header cut short shows up in an implicit VR file.
 */
export function elementText(dataSet: DataSet, tag: string): string | null {
  // `tag` is a constant of this package or a key of the parsed data set.
  // eslint-disable-next-line security/detect-object-injection
  const element = dataSet.elements[tag];
  if (!element || element.length === 0 || element.hadUndefinedLength) return null;

  const end = element.dataOffset + element.length;
  if (end > dataSet.byteArray.length) {
    throw new Error(`dicom header: element ${tag} runs past the end of the data`);
  }
  const raw = dataSet.byteArray.subarray(element.dataOffset, end);

  let decoded: string;
  try {
    decoded = utf8.decode(raw);
  } catch {
    decoded = latin1.decode(raw);
  }
  const cleaned = decoded.replace(/\0/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

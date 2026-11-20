import { crc32 } from 'node:zlib';

/**
 * Just enough PNG for the workshop tooling (#644): read the size of a file
 * from its header, and write an 8-bit greyscale image for the synthetic
 * stand-in.
 *
 * The writer stores the pixels uncompressed and builds the zlib stream by
 * hand. Compression would make the bytes depend on the zlib build, and the
 * stand-in files are pinned by checksum: the same pixels must give the same
 * file on every machine and every Node release.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && Buffer.from(bytes.subarray(0, SIGNATURE.length)).equals(SIGNATURE);
}

/** Width and height from the IHDR chunk. Throws on anything that is not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isPng(buffer) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG file');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function adler32(bytes: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of stored (uncompressed) blocks. */
function zlibStored(raw: Buffer): Buffer {
  const BLOCK = 65535;
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < raw.length || offset === 0; offset += BLOCK) {
    const block = raw.subarray(offset, offset + BLOCK);
    const header = Buffer.alloc(5);
    header.writeUInt8(offset + BLOCK >= raw.length ? 1 : 0, 0);
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(~block.length & 0xffff, 3);
    parts.push(header, block);
  }
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(adler32(raw));
  return Buffer.concat([...parts, trailer]);
}

/** Encode `width` x `height` grey pixels (one byte each, row by row) as a PNG. */
export function encodeGreyPng(pixels: Uint8Array, width: number, height: number): Buffer {
  if (pixels.length !== width * height) throw new Error('pixel count does not match the size');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  // Colour type 0 (greyscale), deflate, adaptive filtering, no interlace: all zero.

  const source = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), source.subarray(y * width, (y + 1) * width)); // filter: none
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

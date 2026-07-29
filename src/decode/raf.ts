/**
 * Fujifilm RAF container parsing.
 *
 * The RAF header is fixed-layout big-endian:
 *   0x00  16  magic "FUJIFILMCCD-RAW "
 *   0x10   4  format version ("0201")
 *   0x14   8  camera id
 *   0x1c  32  camera model, NUL-padded ("X-T1")
 *   0x3c   4  firmware version ("0400")
 *   0x54   4  offset of the embedded JPEG
 *   0x58   4  length of the embedded JPEG
 *
 * Verified against X-T1 firmware 4.00 files.
 */

const MAGIC = 'FUJIFILMCCD-RAW ';

export interface RafHeader {
  model: string;
  firmware: string;
  jpegOffset: number;
  jpegLength: number;
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    if (buf[i] === 0) break;
    s += String.fromCharCode(buf[i]);
  }
  return s;
}

export function isRaf(buf: Uint8Array): boolean {
  return buf.length > 0x5c && ascii(buf, 0, 16) === MAGIC;
}

export function parseRafHeader(buf: Uint8Array): RafHeader {
  if (!isRaf(buf)) throw new Error('Not a Fujifilm RAF file');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    model: ascii(buf, 0x1c, 0x1c + 32).trim(),
    firmware: ascii(buf, 0x3c, 0x3c + 4).trim(),
    jpegOffset: dv.getUint32(0x54, false),
    jpegLength: dv.getUint32(0x58, false),
  };
}

/**
 * The camera-rendered JPEG embedded in every RAF. On the X-T1 this is a
 * 1920x1280 preview rather than a full-resolution SOOC JPEG, but it is still
 * the camera's own rendering of the scene — which makes it our ground truth
 * for how close an emulated recipe actually gets.
 */
export function extractEmbeddedJpeg(buf: Uint8Array): Uint8Array | null {
  const { jpegOffset, jpegLength } = parseRafHeader(buf);
  if (!jpegOffset || !jpegLength || jpegOffset + jpegLength > buf.length) return null;
  const jpeg = buf.subarray(jpegOffset, jpegOffset + jpegLength);
  // sanity: must start with SOI
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  return jpeg;
}

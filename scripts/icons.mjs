import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ -1) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, crc]);
}
function icon(size) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const outside = Math.hypot(Math.max(.14 - u, 0, u - .86), Math.max(.14 - v, 0, v - .86)) > .13;
    let color = outside ? [0, 0, 0, 0] : [51, 104, 216, 255];
    const sheet = u > .25 && u < .72 && v > .19 && v < .81;
    const fold = u > .58 && v < .32 && u + v > .9;
    if (sheet && !fold) color = [246, 249, 255, 255];
    if (u > .36 && u < .62 && v > .40 && v < .45) color = [51, 104, 216, 255];
    if (u > .36 && u < .59 && v > .54 && v < .59) color = [51, 104, 216, 255];
    if (u > .36 && u < .55 && v > .67 && v < .71) color = [51, 104, 216, 255];
    const offset = y * (size * 4 + 1) + 1 + x * 4; rows.set(color, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export async function generateIcons(directory) {
  await mkdir(directory, { recursive: true });
  for (const size of [16, 32, 48, 128]) await writeFile(join(directory, size + '.png'), icon(size));
}

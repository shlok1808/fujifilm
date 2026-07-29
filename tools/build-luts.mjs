/**
 * Converts the .cube film simulation LUTs in luts/ into a compact binary form
 * served from public/luts/.
 *
 * A 32^3 .cube is ~786 kB of ASCII; the same data as 16-bit integers is 192 kB
 * and needs no parsing at load time. That matters because the N-up compare view
 * holds several LUTs in memory at once.
 *
 * Format (little-endian):
 *   uint32  size        edge length of the cube (32)
 *   uint16  rgb[size^3 * 3]   values scaled 0..65535
 *
 * Run automatically by `npm run build` via the prebuild hook.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SRC = 'luts';
const OUT = 'public/luts';

mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.cube'));
if (files.length === 0) {
  console.error(`no .cube files in ${SRC}/`);
  process.exit(1);
}

let totalIn = 0;
let totalOut = 0;

for (const file of files) {
  const text = readFileSync(join(SRC, file), 'utf8');
  let size = 0;
  const values = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }
    if (line.startsWith('TITLE') || line.startsWith('DOMAIN_')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) continue;
    values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }

  if (!size) throw new Error(`${file}: missing LUT_3D_SIZE`);
  const expected = size ** 3 * 3;
  if (values.length !== expected) {
    throw new Error(`${file}: expected ${expected} values, parsed ${values.length}`);
  }

  const buf = Buffer.alloc(4 + expected * 2);
  buf.writeUInt32LE(size, 0);
  for (let i = 0; i < expected; i++) {
    // .cube values can sit slightly outside 0..1; clamp rather than wrap.
    const v = Math.max(0, Math.min(1, values[i]));
    buf.writeUInt16LE(Math.round(v * 65535), 4 + i * 2);
  }

  const name = `${basename(file, '.cube')}.bin`;
  writeFileSync(join(OUT, name), buf);

  const inSize = Buffer.byteLength(text);
  totalIn += inSize;
  totalOut += buf.length;
  console.log(
    `${name.padEnd(24)} ${String(size).padStart(2)}^3  ` +
    `${(inSize / 1024).toFixed(0).padStart(4)} kB -> ${(buf.length / 1024).toFixed(0).padStart(4)} kB`,
  );
}

console.log(
  `\n${files.length} LUTs  ${(totalIn / 1024 / 1024).toFixed(2)} MB -> ` +
  `${(totalOut / 1024 / 1024).toFixed(2)} MB`,
);

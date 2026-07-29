/**
 * Fujifilm MakerNote reader — recovers the recipe a photo was actually shot with.
 *
 * Layout: "FUJIFILM" (8 bytes) + uint32 LE offset to a standard little-endian
 * TIFF IFD, offsets relative to the start of the MakerNote block. Reached by
 * walking JPEG APP1/Exif -> IFD0 -> ExifIFD -> tag 0x927c.
 *
 * Tag numbers and value encodings follow the ExifTool/exiv2 Fujifilm tables.
 * Verified against X-T1 firmware 4.00 files.
 */

import type { DynamicRange, FilmSim, Recipe, Strength } from '../model/recipe';
import { DEFAULT_RECIPE } from '../model/recipe';

const T = {
  Sharpness: 0x1001,
  WhiteBalance: 0x1002,
  Saturation: 0x1003,
  Contrast: 0x1004,
  ColorTemperature: 0x1005,
  WhiteBalanceFineTune: 0x100a,
  NoiseReduction: 0x100b,
  NoiseReduction2: 0x100e,
  Clarity: 0x100f,
  ShadowTone: 0x1040,
  HighlightTone: 0x1041,
  GrainEffect: 0x1047,
  ColorChromeEffect: 0x1048,
  GrainEffectSize: 0x104c,
  ColorChromeFxBlue: 0x104b,
  DynamicRange: 0x1400,
  FilmMode: 0x1401,
  DynamicRangeSetting: 0x1402,
  DevelopmentDynamicRange: 0x1403,
  AutoDynamicRange: 0x140b,
} as const;

const FILM_MODE: Record<number, FilmSim> = {
  0x000: 'provia',
  0x110: 'astia',
  0x120: 'astia',
  0x200: 'velvia',
  0x400: 'velvia',
  0x500: 'pro-neg-std',
  0x501: 'pro-neg-hi',
  0x600: 'classic-chrome',
  0x700: 'eterna',
  0x800: 'classic-neg',
  0x900: 'eterna-bleach-bypass',
  0xa00: 'nostalgic-neg',
  0xb00: 'reala-ace',
};

/** Tag 0x1003 doubles as both colour saturation and the monochrome modes. */
const SATURATION_AS_SIM: Record<number, FilmSim> = {
  0x300: 'mono',
  0x301: 'mono-ye',
  0x302: 'mono-r',
  0x303: 'mono-g',
  0x310: 'sepia',
  0x400: 'acros',
  0x401: 'acros-ye',
  0x402: 'acros-r',
  0x403: 'acros-g',
};

/**
 * Fuji encodes tone/colour params in 0x80 steps, with negatives as a signed
 * 32-bit wrap: 0x00 = 0, 0x80 = +1, 0xffffff80 = -1, and so on.
 */
function decodeStep(raw: number): number {
  const signed = raw | 0;
  return signed / 0x80;
}

const STRENGTH: Record<number, Strength> = { 0: 'off', 0x20: 'weak', 0x40: 'strong' };

const WB_MODE: Record<number, Recipe['whiteBalance']['mode']> = {
  0x000: 'auto',
  0x100: 'daylight',
  0x200: 'incandescent',
  0x300: 'fluorescent-1',
  0x400: 'fluorescent-2',
  0x500: 'fluorescent-3',
  0x600: 'shade',
  0xf00: 'kelvin',
};

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

interface Entry { tag: number; type: number; count: number; offset: number }

function readIfd(dv: DataView, base: number, le: boolean): Entry[] {
  const n = dv.getUint16(base, le);
  const out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const e = base + 2 + i * 12;
    out.push({
      tag: dv.getUint16(e, le),
      type: dv.getUint16(e + 2, le),
      count: dv.getUint32(e + 4, le),
      offset: e + 8,
    });
  }
  return out;
}

/** Locate the raw MakerNote block inside a JPEG. */
export function findMakerNote(jpeg: Uint8Array): { block: Uint8Array } | null {
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  let p = 2;
  while (p + 4 < jpeg.length) {
    if (jpeg[p] !== 0xff) return null;
    const marker = jpeg[p + 1];
    if (marker === 0xda) return null; // start of scan; metadata is behind us
    const len = dv.getUint16(p + 2, false);
    if (marker === 0xe1) {
      let sig = '';
      for (let i = p + 4; i < p + 10 && i < jpeg.length; i++) sig += String.fromCharCode(jpeg[i]);
      if (sig === 'Exif\0\0') {
        const tiff = p + 10;
        const le = dv.getUint16(tiff, false) === 0x4949;
        const ifd0 = tiff + dv.getUint32(tiff + 4, le);
        const exifPtr = readIfd(dv, ifd0, le).find((e) => e.tag === 0x8769);
        if (!exifPtr) return null;
        const exifIfd = tiff + dv.getUint32(exifPtr.offset, le);
        const mn = readIfd(dv, exifIfd, le).find((e) => e.tag === 0x927c);
        if (!mn) return null;
        const start = tiff + dv.getUint32(mn.offset, le);
        return { block: jpeg.subarray(start, start + mn.count) };
      }
    }
    p += 2 + len;
  }
  return null;
}

function readValues(block: Uint8Array): Map<number, number[]> {
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let sig = '';
  for (let i = 0; i < 8; i++) sig += String.fromCharCode(block[i]);
  if (sig !== 'FUJIFILM') return new Map();

  const ifdOff = dv.getUint32(8, true);
  const values = new Map<number, number[]>();
  for (const e of readIfd(dv, ifdOff, true)) {
    const unit = TYPE_SIZE[e.type] ?? 1;
    const size = unit * e.count;
    const at = size <= 4 ? e.offset : dv.getUint32(e.offset, true);
    if (at + size > block.byteLength) continue;
    const read = (i: number): number | null => {
      const o = at + i * unit;
      switch (e.type) {
        case 3: return dv.getUint16(o, true);
        case 4: return dv.getUint32(o, true);
        case 8: return dv.getInt16(o, true);
        case 9: return dv.getInt32(o, true);
        default: return null;
      }
    };
    if (read(0) === null) continue;
    // Cap the read: a few Fuji tags carry long payloads we have no use for.
    const n = Math.min(e.count, 8);
    const arr: number[] = [];
    for (let i = 0; i < n; i++) arr.push(read(i)!);
    values.set(e.tag, arr);
  }
  return values;
}

export interface AsShot {
  recipe: Recipe;
  /** every tag we read, for debugging and for adding new bodies */
  rawTags: Map<number, number[]>;
}

/**
 * Reconstruct the recipe a frame was shot with. Anything the body did not
 * record is left at its default rather than guessed.
 */
export function readAsShotRecipe(jpeg: Uint8Array): AsShot | null {
  const found = findMakerNote(jpeg);
  if (!found) return null;
  const raw = readValues(found.block);
  if (raw.size === 0) return null;

  /** scalar accessor — every tag below is single-valued except WB fine tune */
  const v = { get: (tag: number): number | undefined => raw.get(tag)?.[0] };

  const recipe: Recipe = {
    ...DEFAULT_RECIPE,
    id: 'as-shot',
    name: 'As shot',
    whiteBalance: { ...DEFAULT_RECIPE.whiteBalance },
    grain: { ...DEFAULT_RECIPE.grain! },
  };

  const sat = v.get(T.Saturation);
  if (sat !== undefined) {
    const asSim = SATURATION_AS_SIM[sat >>> 0];
    if (asSim) recipe.filmSim = asSim;
    else recipe.color = decodeStep(sat);
  }
  // FilmMode only carries the colour sims; a monochrome mode set above wins.
  const fm = v.get(T.FilmMode);
  if (fm !== undefined && !(sat !== undefined && SATURATION_AS_SIM[sat >>> 0])) {
    const sim = FILM_MODE[fm];
    if (sim) recipe.filmSim = sim;
  }

  const hi = v.get(T.HighlightTone);
  if (hi !== undefined) recipe.highlight = decodeStep(hi);
  const sh = v.get(T.ShadowTone);
  if (sh !== undefined) recipe.shadow = decodeStep(sh);

  // Sharpness is a plain 0..4 scale centred on 2 (X-T1 reports 3 for "Normal"
  // on some firmwares, hence the clamp rather than a strict mapping).
  const sharp = v.get(T.Sharpness);
  if (sharp !== undefined) {
    recipe.sharpness = sharp <= 4 ? Math.max(-2, Math.min(2, sharp - 2)) : decodeStep(sharp);
  }
  const nr = v.get(T.NoiseReduction2) ?? v.get(T.NoiseReduction);
  if (nr !== undefined) recipe.noiseReduction = nr > 0x1000 ? decodeStep(nr) : 0;

  // Dynamic range: prefer what was actually developed, fall back to the auto result.
  const dr = v.get(T.DevelopmentDynamicRange) ?? v.get(T.AutoDynamicRange);
  if (dr === 100 || dr === 200 || dr === 400) recipe.dynamicRange = dr as DynamicRange;

  const wb = v.get(T.WhiteBalance);
  if (wb !== undefined && WB_MODE[wb] !== undefined) recipe.whiteBalance.mode = WB_MODE[wb];
  const kelvin = v.get(T.ColorTemperature);
  if (kelvin !== undefined && kelvin > 1000) recipe.whiteBalance.kelvin = kelvin;

  // WB shift is stored as [red, blue] in 1/20ths of a camera grid step.
  const fine = raw.get(T.WhiteBalanceFineTune);
  if (fine && fine.length >= 2) {
    recipe.whiteBalance.shiftRed = Math.round((fine[0] | 0) / 20);
    recipe.whiteBalance.shiftBlue = Math.round((fine[1] | 0) / 20);
  }

  const clarity = v.get(T.Clarity);
  if (clarity !== undefined) recipe.clarity = (clarity | 0) / 1000;
  const grain = v.get(T.GrainEffect);
  if (grain !== undefined && STRENGTH[grain]) recipe.grain = { strength: STRENGTH[grain] };
  const cc = v.get(T.ColorChromeEffect);
  if (cc !== undefined && STRENGTH[cc]) recipe.colorChrome = STRENGTH[cc];
  const ccb = v.get(T.ColorChromeFxBlue);
  if (ccb !== undefined && STRENGTH[ccb]) recipe.colorChromeFxBlue = STRENGTH[ccb];

  return { recipe, rawTags: raw };
}

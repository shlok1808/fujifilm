/**
 * RAF -> linear scene-referred RGB, via libraw-wasm (which runs LibRaw in a
 * Web Worker, so this never blocks the UI thread).
 *
 * The decode settings below were validated against X-T1 firmware 4.00 files:
 * anything that leaves auto-brightness or the sRGB tone curve on gives us
 * display-referred data, which is the wrong input for a film-simulation LUT.
 * We want the scene as the sensor saw it and we apply all tone shaping ourselves.
 *
 * Measured on a 16MP X-T1 frame (M1 MacBook, Chromium):
 *   halfSize            ~130 ms   2467x1648   <- interactive preview
 *   full, userQual 12  ~7000 ms   4934x3296   <- export only
 * X-Trans bins cleanly at half size, so the fast path costs no visible quality
 * on screen; the slow path is reserved for full-resolution export.
 */

import LibRaw from 'libraw-wasm';
import { extractEmbeddedJpeg, parseRafHeader } from './raf';
import { readAsShotRecipe } from './fujiMakerNote';
import { cameraGeneration, type CameraGen, type Recipe } from '../model/recipe';

export interface DecodedImage {
  /** linear RGB, 16-bit, tightly packed RGBRGB… */
  data: Uint16Array;
  width: number;
  height: number;
  /** orientation flag from the raw file (LibRaw `flip` semantics) */
  flip: number;
}

export interface LoadedRaf {
  fileName: string;
  model: string;
  firmware: string;
  cameraGen: CameraGen;
  /** camera-rendered preview from the RAF — our ground-truth reference */
  embeddedJpeg: Blob | null;
  asShot: Recipe | null;
  asShotTags: Map<number, number[]> | null;
  preview: DecodedImage;
}

const BASE_SETTINGS = {
  useCameraWb: true,
  outputBps: 16,
  noAutoBright: true,
  gamm: [1, 1] as [number, number], // linear: we do our own tone mapping
  outputColor: 1,                   // sRGB primaries, still linear
} as const;

/** Fast path: half-resolution, good enough for everything on screen. */
export const PREVIEW_SETTINGS = { ...BASE_SETTINGS, halfSize: true, userQual: 0 };

/** Slow path: full resolution with the X-Trans-aware demosaic. */
export const EXPORT_SETTINGS = { ...BASE_SETTINGS, halfSize: false, userQual: 12 };

async function decode(bytes: Uint8Array, settings: object): Promise<DecodedImage> {
  const raw = new LibRaw();
  try {
    // libraw-wasm transfers the buffer to its worker, so hand it a copy —
    // otherwise the caller's array comes back detached and a second decode
    // (e.g. the export pass) would see an empty file.
    await raw.open(new Uint8Array(bytes), settings);
    const meta = await raw.metadata(true).catch(() => null);
    const img = await raw.imageData();
    if (!img?.data) {
      throw new Error('LibRaw could not decode this file — it may be corrupt or an unsupported RAF variant.');
    }

    let data = img.data as unknown as Uint16Array | Uint8Array;
    if (!(data instanceof Uint16Array)) {
      data = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    }
    return {
      data: data as Uint16Array,
      width: img.width,
      height: img.height,
      flip: (meta as { flip?: number } | null)?.flip ?? 0,
    };
  } finally {
    raw.dispose();
  }
}

export async function loadRaf(file: File): Promise<LoadedRaf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = parseRafHeader(bytes);

  const jpegBytes = extractEmbeddedJpeg(bytes);
  const asShot = jpegBytes ? readAsShotRecipe(jpegBytes) : null;

  const preview = await decode(bytes, PREVIEW_SETTINGS);

  return {
    fileName: file.name,
    model: header.model,
    firmware: header.firmware,
    cameraGen: cameraGeneration(header.model),
    // copy: the RAF buffer is large and we do not want to pin it alive
    embeddedJpeg: jpegBytes ? new Blob([jpegBytes.slice()], { type: 'image/jpeg' }) : null,
    asShot: asShot?.recipe ?? null,
    asShotTags: asShot?.rawTags ?? null,
    preview,
  };
}

/** Full-resolution decode, run on demand for export. */
export async function decodeFullResolution(file: File): Promise<DecodedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decode(bytes, EXPORT_SETTINGS);
}

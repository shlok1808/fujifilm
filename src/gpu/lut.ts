/**
 * Film simulation LUT loading.
 *
 * LUTs are fetched lazily and cached, so switching simulations (or comparing
 * several at once) costs one network round trip per look, ever.
 */

import { MONOCHROME_SIMS, type FilmSim } from '../model/recipe';

export interface Lut {
  size: number;
  /** RGB triples, 0..1, laid out for a 3D texture */
  data: Float32Array;
}

/**
 * Which LUT file backs each simulation.
 *
 * The monochrome family has no LUT in the profile pack, so those simulations
 * render through Provia — the same colour rendering the camera starts from —
 * and are converted to greyscale by the channel mixer in the develop shader.
 * That is closer than mixing straight from linear sensor data, but it does mean
 * ACROS shares PROVIA's tonality rather than having its own.
 */
const LUT_FILE: Record<FilmSim, string | null> = {
  provia: 'provia',
  velvia: 'velvia',
  astia: 'astia',
  'classic-chrome': 'classic-chrome',
  'pro-neg-hi': 'pro-neg-hi',
  'pro-neg-std': 'pro-neg-std',
  eterna: 'eterna',
  'eterna-bleach-bypass': 'bleach-bypass',
  'classic-neg': 'classic-neg',
  'nostalgic-neg': 'nostalgic-neg',
  'reala-ace': 'reala-ace',
  // monochrome family: Provia base + channel mixer
  acros: 'provia',
  'acros-ye': 'provia',
  'acros-r': 'provia',
  'acros-g': 'provia',
  mono: 'provia',
  'mono-ye': 'provia',
  'mono-r': 'provia',
  'mono-g': 'provia',
  sepia: 'provia',
};

const cache = new Map<string, Promise<Lut>>();

async function fetchLut(name: string): Promise<Lut> {
  const res = await fetch(`${import.meta.env.BASE_URL}luts/${name}.bin`);
  if (!res.ok) throw new Error(`Could not load LUT "${name}" (${res.status})`);
  const buf = await res.arrayBuffer();

  const size = new DataView(buf).getUint32(0, true);
  const count = size ** 3 * 3;
  const raw = new Uint16Array(buf, 4, count);

  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) data[i] = raw[i] / 65535;

  return { size, data };
}

export function loadLut(sim: FilmSim): Promise<Lut> | null {
  const name = LUT_FILE[sim];
  if (!name) return null;
  let entry = cache.get(name);
  if (!entry) {
    entry = fetchLut(name).catch((e) => {
      cache.delete(name); // let a later attempt retry rather than caching failure
      throw e;
    });
    cache.set(name, entry);
  }
  return entry;
}

/** True when the simulation is rendered as greyscale on top of its base LUT. */
export function isMonochrome(sim: FilmSim): boolean {
  return MONOCHROME_SIMS.has(sim);
}

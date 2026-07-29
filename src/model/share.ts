/**
 * Recipe <-> URL. Settings travel in the fragment so they never reach a server,
 * which keeps the "nothing leaves your browser" promise intact even for links.
 */

import { DEFAULT_RECIPE, type Recipe } from './recipe';

/** Compact wire form — short keys, and defaults omitted entirely. */
type Wire = Partial<{
  n: string; f: string; d: number; wr: number; wb: number; wm: string; wk: number;
  hi: number; sh: number; co: number; sp: number; nr: number; cl: number;
  g: string; gs: string; cc: string; cb: string; ec: number;
}>;

export function encodeRecipe(r: Recipe): string {
  const w: Wire = {};
  if (r.name && r.name !== DEFAULT_RECIPE.name) w.n = r.name;
  w.f = r.filmSim;
  if (r.dynamicRange !== 100) w.d = r.dynamicRange;
  if (r.whiteBalance.mode !== 'auto') w.wm = r.whiteBalance.mode;
  if (r.whiteBalance.kelvin) w.wk = r.whiteBalance.kelvin;
  if (r.whiteBalance.shiftRed) w.wr = r.whiteBalance.shiftRed;
  if (r.whiteBalance.shiftBlue) w.wb = r.whiteBalance.shiftBlue;
  if (r.highlight) w.hi = r.highlight;
  if (r.shadow) w.sh = r.shadow;
  if (r.color) w.co = r.color;
  if (r.sharpness) w.sp = r.sharpness;
  if (r.noiseReduction) w.nr = r.noiseReduction;
  if (r.clarity) w.cl = r.clarity;
  if (r.grain?.strength && r.grain.strength !== 'off') w.g = r.grain.strength;
  if (r.grain?.size) w.gs = r.grain.size;
  if (r.colorChrome && r.colorChrome !== 'off') w.cc = r.colorChrome;
  if (r.colorChromeFxBlue && r.colorChromeFxBlue !== 'off') w.cb = r.colorChromeFxBlue;
  if (r.exposureComp) w.ec = r.exposureComp;

  // base64url so the link survives copy/paste intact
  return btoa(JSON.stringify(w)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRecipe(token: string): Recipe | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const w = JSON.parse(atob(b64)) as Wire;
    if (!w.f) return null;
    return {
      ...DEFAULT_RECIPE,
      id: 'shared',
      name: w.n ?? 'Shared recipe',
      filmSim: w.f as Recipe['filmSim'],
      dynamicRange: (w.d ?? 100) as Recipe['dynamicRange'],
      whiteBalance: {
        mode: (w.wm ?? 'auto') as Recipe['whiteBalance']['mode'],
        kelvin: w.wk,
        shiftRed: w.wr ?? 0,
        shiftBlue: w.wb ?? 0,
      },
      highlight: w.hi ?? 0,
      shadow: w.sh ?? 0,
      color: w.co ?? 0,
      sharpness: w.sp ?? 0,
      noiseReduction: w.nr ?? 0,
      clarity: w.cl ?? 0,
      grain: { strength: (w.g ?? 'off') as 'off' | 'weak' | 'strong', size: w.gs as 'small' | 'large' | undefined },
      colorChrome: (w.cc ?? 'off') as Recipe['colorChrome'],
      colorChromeFxBlue: (w.cb ?? 'off') as Recipe['colorChromeFxBlue'],
      exposureComp: w.ec ?? 0,
    };
  } catch {
    return null;
  }
}

export function shareUrl(r: Recipe): string {
  return `${location.origin}${location.pathname}#r=${encodeRecipe(r)}`;
}

export function recipeFromLocation(): Recipe | null {
  const m = /[#&]r=([^&]+)/.exec(location.hash);
  return m ? decodeRecipe(m[1]) : null;
}

/**
 * Parse a recipe pasted as text, in the shape Fuji X Weekly and similar sites
 * publish them ("Highlight: +1", "Dynamic Range: DR200", …). Unrecognised lines
 * are ignored rather than failing the whole paste.
 */
export function parseRecipeText(text: string): Partial<Recipe> | null {
  const out: Partial<Recipe> = {};
  const wb = { mode: 'auto' as Recipe['whiteBalance']['mode'], shiftRed: 0, shiftBlue: 0 };
  let sawAnything = false;

  const SIMS: Array<[RegExp, Recipe['filmSim']]> = [
    [/classic\s*neg/i, 'classic-neg'], [/nostalgic\s*neg/i, 'nostalgic-neg'],
    [/classic\s*chrome/i, 'classic-chrome'], [/reala/i, 'reala-ace'],
    [/pro\s*neg\.?\s*hi/i, 'pro-neg-hi'], [/pro\s*neg\.?\s*std/i, 'pro-neg-std'],
    [/bleach/i, 'eterna-bleach-bypass'], [/eterna/i, 'eterna'],
    [/acros\s*\+\s*ye/i, 'acros-ye'], [/acros\s*\+\s*r/i, 'acros-r'],
    [/acros\s*\+\s*g/i, 'acros-g'], [/acros/i, 'acros'],
    [/sepia/i, 'sepia'],
    [/mono(chrome)?\s*\+\s*ye?/i, 'mono-ye'], [/mono(chrome)?\s*\+\s*r/i, 'mono-r'],
    [/mono(chrome)?\s*\+\s*g/i, 'mono-g'], [/mono(chrome)?/i, 'mono'],
    [/velvia|vivid/i, 'velvia'], [/astia|soft/i, 'astia'],
    [/provia|standard/i, 'provia'],
  ];

  const num = (s: string): number | null => {
    const m = /([+-]?\d+(?:\.\d+)?)/.exec(s);
    return m ? Number(m[1]) : null;
  };

  for (const line of text.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split(':');
    if (!rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (!val) continue;

    if (/film\s*sim/.test(key)) {
      for (const [re, sim] of SIMS) if (re.test(val)) { out.filmSim = sim; sawAnything = true; break; }
    } else if (/dynamic\s*range/.test(key)) {
      const n = num(val);
      if (n === 100 || n === 200 || n === 400) { out.dynamicRange = n; sawAnything = true; }
    } else if (/white\s*balance/.test(key)) {
      // e.g. "Auto, -1 Red & -1 Blue"
      if (/shade/i.test(val)) wb.mode = 'shade';
      else if (/daylight|sunny/i.test(val)) wb.mode = 'daylight';
      else if (/incandescent|tungsten/i.test(val)) wb.mode = 'incandescent';
      else if (/(\d{3,5})\s*k/i.test(val)) {
        wb.mode = 'kelvin';
        (wb as { kelvin?: number }).kelvin = Number(/(\d{3,5})\s*k/i.exec(val)![1]);
      }
      const r = /([+-]?\d+)\s*red/i.exec(val);
      const b = /([+-]?\d+)\s*blue/i.exec(val);
      if (r) wb.shiftRed = Number(r[1]);
      if (b) wb.shiftBlue = Number(b[1]);
      out.whiteBalance = wb;
      sawAnything = true;
    } else if (/highlight/.test(key)) {
      const n = num(val); if (n !== null) { out.highlight = n; sawAnything = true; }
    } else if (/shadow/.test(key)) {
      const n = num(val); if (n !== null) { out.shadow = n; sawAnything = true; }
    } else if (/^color$|colour|saturation/.test(key)) {
      const n = num(val); if (n !== null) { out.color = n; sawAnything = true; }
    } else if (/sharp/.test(key)) {
      const n = num(val); if (n !== null) { out.sharpness = n; sawAnything = true; }
    } else if (/noise/.test(key)) {
      const n = num(val); if (n !== null) { out.noiseReduction = n; sawAnything = true; }
    } else if (/clarity/.test(key)) {
      const n = num(val); if (n !== null) { out.clarity = n; sawAnything = true; }
    } else if (/grain/.test(key)) {
      const strength = /strong/i.test(val) ? 'strong' : /weak/i.test(val) ? 'weak' : 'off';
      out.grain = { strength, size: /large/i.test(val) ? 'large' : undefined };
      sawAnything = true;
    } else if (/chrome\s*fx\s*blue/.test(key)) {
      out.colorChromeFxBlue = /strong/i.test(val) ? 'strong' : /weak/i.test(val) ? 'weak' : 'off';
      sawAnything = true;
    } else if (/color\s*chrome/.test(key)) {
      out.colorChrome = /strong/i.test(val) ? 'strong' : /weak/i.test(val) ? 'weak' : 'off';
      sawAnything = true;
    } else if (/exposure/.test(key)) {
      const n = num(val); if (n !== null) { out.exposureComp = n; sawAnything = true; }
    }
  }

  return sawAnything ? out : null;
}

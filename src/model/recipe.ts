/**
 * The Fujifilm "recipe" model.
 *
 * The engine deliberately models the full modern parameter set even though the
 * X-T1 (X-Trans II) supports only a subset — that way a recipe written for an
 * X100VI can still be rendered onto an X-T1 file, which is something no
 * camera-tethered tool can do. `CAMERA_GEN_CAPS` records what each sensor
 * generation actually had, so the UI can mark params your body never shipped.
 */

export type FilmSim =
  | 'provia' | 'velvia' | 'astia' | 'classic-chrome'
  | 'pro-neg-hi' | 'pro-neg-std' | 'eterna' | 'eterna-bleach-bypass'
  | 'classic-neg' | 'nostalgic-neg' | 'reala-ace'
  | 'acros' | 'acros-ye' | 'acros-r' | 'acros-g'
  | 'mono' | 'mono-ye' | 'mono-r' | 'mono-g'
  | 'sepia';

export const MONOCHROME_SIMS: ReadonlySet<FilmSim> = new Set<FilmSim>([
  'acros', 'acros-ye', 'acros-r', 'acros-g',
  'mono', 'mono-ye', 'mono-r', 'mono-g', 'sepia',
]);

export const FILM_SIM_LABELS: Record<FilmSim, string> = {
  provia: 'PROVIA / Standard',
  velvia: 'Velvia / Vivid',
  astia: 'ASTIA / Soft',
  'classic-chrome': 'Classic Chrome',
  'pro-neg-hi': 'PRO Neg. Hi',
  'pro-neg-std': 'PRO Neg. Std',
  eterna: 'ETERNA / Cinema',
  'eterna-bleach-bypass': 'ETERNA Bleach Bypass',
  'classic-neg': 'Classic Neg.',
  'nostalgic-neg': 'Nostalgic Neg.',
  'reala-ace': 'REALA ACE',
  acros: 'ACROS',
  'acros-ye': 'ACROS +Ye',
  'acros-r': 'ACROS +R',
  'acros-g': 'ACROS +G',
  mono: 'Monochrome',
  'mono-ye': 'Monochrome +Ye',
  'mono-r': 'Monochrome +R',
  'mono-g': 'Monochrome +G',
  sepia: 'Sepia',
};

export type DynamicRange = 100 | 200 | 400;
export type Strength = 'off' | 'weak' | 'strong';

export type WhiteBalanceMode =
  | 'auto' | 'daylight' | 'shade' | 'fluorescent-1' | 'fluorescent-2'
  | 'fluorescent-3' | 'incandescent' | 'kelvin';

export interface WhiteBalance {
  mode: WhiteBalanceMode;
  /** only meaningful when mode === 'kelvin' */
  kelvin?: number;
  /** camera WB-shift grid, -9..+9 */
  shiftRed: number;
  shiftBlue: number;
}

export interface Recipe {
  id: string;
  name: string;
  author?: string;
  sourceUrl?: string;
  notes?: string;

  filmSim: FilmSim;
  dynamicRange: DynamicRange;
  whiteBalance: WhiteBalance;

  /** -2..+4 on modern bodies, -2..+2 on X-Trans II */
  highlight: number;
  shadow: number;
  /** -4..+4 (X-Trans II: -2..+2) */
  color: number;
  sharpness: number;
  noiseReduction: number;

  /** X-Trans IV and later */
  clarity?: number;            // -5..+5
  grain?: { strength: Strength; size?: 'small' | 'large' };
  colorChrome?: Strength;
  colorChromeFxBlue?: Strength;

  /** exposure compensation the recipe asks for, in stops */
  exposureComp?: number;

  /** lowest sensor generation that can shoot this recipe in-camera */
  minCameraGen?: 1 | 2 | 3 | 4 | 5;
}

export type CameraGen = 1 | 2 | 3 | 4 | 5;

export interface GenCaps {
  label: string;
  toneRange: [number, number];
  colorRange: [number, number];
  sharpnessRange: [number, number];
  nrRange: [number, number];
  clarity: boolean;
  grain: boolean;
  grainSize: boolean;
  colorChrome: boolean;
  colorChromeFxBlue: boolean;
  sims: ReadonlySet<FilmSim>;
}

const XT2_SIMS = new Set<FilmSim>([
  'provia', 'velvia', 'astia', 'classic-chrome', 'pro-neg-hi', 'pro-neg-std',
  'mono', 'mono-ye', 'mono-r', 'mono-g', 'sepia',
]);

/**
 * X-Trans II (X-T1, X100T, X-E2, X70 …): tone params are -2..+2, there is no
 * Grain / Clarity / Color Chrome, and ACROS does not exist yet. Classic Chrome
 * arrived on the X-T1 in firmware 4.00.
 */
export const CAMERA_GEN_CAPS: Record<CameraGen, GenCaps> = {
  1: {
    label: 'X-Trans I',
    toneRange: [-2, 2], colorRange: [-2, 2], sharpnessRange: [-2, 2], nrRange: [-2, 2],
    clarity: false, grain: false, grainSize: false, colorChrome: false, colorChromeFxBlue: false,
    sims: new Set<FilmSim>([...XT2_SIMS].filter((s) => s !== 'classic-chrome')),
  },
  2: {
    label: 'X-Trans II',
    toneRange: [-2, 2], colorRange: [-2, 2], sharpnessRange: [-2, 2], nrRange: [-2, 2],
    clarity: false, grain: false, grainSize: false, colorChrome: false, colorChromeFxBlue: false,
    sims: XT2_SIMS,
  },
  3: {
    label: 'X-Trans III',
    toneRange: [-2, 4], colorRange: [-4, 4], sharpnessRange: [-4, 4], nrRange: [-4, 4],
    clarity: false, grain: true, grainSize: false, colorChrome: false, colorChromeFxBlue: false,
    sims: new Set<FilmSim>([...XT2_SIMS, 'acros', 'acros-ye', 'acros-r', 'acros-g']),
  },
  4: {
    label: 'X-Trans IV',
    toneRange: [-2, 4], colorRange: [-4, 4], sharpnessRange: [-4, 4], nrRange: [-4, 4],
    clarity: true, grain: true, grainSize: true, colorChrome: true, colorChromeFxBlue: true,
    sims: new Set<FilmSim>([
      ...XT2_SIMS, 'acros', 'acros-ye', 'acros-r', 'acros-g',
      'eterna', 'eterna-bleach-bypass', 'classic-neg',
    ]),
  },
  5: {
    label: 'X-Trans V',
    toneRange: [-2, 4], colorRange: [-4, 4], sharpnessRange: [-4, 4], nrRange: [-4, 4],
    clarity: true, grain: true, grainSize: true, colorChrome: true, colorChromeFxBlue: true,
    sims: new Set<FilmSim>([
      ...XT2_SIMS, 'acros', 'acros-ye', 'acros-r', 'acros-g',
      'eterna', 'eterna-bleach-bypass', 'classic-neg', 'nostalgic-neg', 'reala-ace',
    ]),
  },
};

/** Map a camera model string (from the RAF header) to its sensor generation. */
export function cameraGeneration(model: string): CameraGen {
  const m = model.toUpperCase().replace(/\s+/g, '');
  const gen2 = ['X-T1', 'X-T10', 'X100S', 'X100T', 'X-E2', 'X-E2S', 'X70', 'X20', 'X30', 'XQ1', 'XQ2'];
  const gen1 = ['X-PRO1', 'X-E1', 'X-M1', 'X-A1'];
  const gen3 = ['X-PRO2', 'X-T2', 'X-T20', 'X100F', 'X-E3', 'X-H1'];
  const gen4 = ['X-T3', 'X-T4', 'X-T30', 'X-T30II', 'X100V', 'X-PRO3', 'X-S10', 'X-E4'];
  const gen5 = ['X-T5', 'X-H2', 'X-H2S', 'X-S20', 'X100VI', 'X-T50', 'X-M5', 'X-E5'];
  if (gen1.includes(m)) return 1;
  if (gen2.includes(m)) return 2;
  if (gen3.includes(m)) return 3;
  if (gen4.includes(m)) return 4;
  if (gen5.includes(m)) return 5;
  return 5; // unknown / newer body: assume most capable
}

export const DEFAULT_RECIPE: Recipe = {
  id: 'camera-default',
  name: 'Camera default',
  filmSim: 'provia',
  dynamicRange: 100,
  whiteBalance: { mode: 'auto', shiftRed: 0, shiftBlue: 0 },
  highlight: 0,
  shadow: 0,
  color: 0,
  sharpness: 0,
  noiseReduction: 0,
  clarity: 0,
  grain: { strength: 'off' },
  colorChrome: 'off',
  colorChromeFxBlue: 'off',
  exposureComp: 0,
};

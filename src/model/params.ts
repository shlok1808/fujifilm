/**
 * Recipe -> shader uniforms.
 *
 * This is the honest part of the project: Fujifilm does not publish what a
 * "Highlight +1" or "Color -2" actually does, so the constants below are
 * fitted approximations chosen to look right, not measurements. The calibration
 * tool in tools/calibrate/ exists to replace them with numbers derived from
 * real RAW+JPEG pairs shot on the camera itself.
 */

import { MONOCHROME_SIMS, type FilmSim, type Recipe, type Strength } from './recipe';

export interface RenderParams {
  exposure: number;
  wbRed: number;
  wbBlue: number;
  /** log2(DR/100): 0 for DR100, 1 for DR200, 2 for DR400 */
  drStops: number;
  highlight: number;
  shadow: number;
  color: number;
  sharpness: number;
  noiseReduction: number;
  clarity: number;
  monochrome: boolean;
  monoMix: Float32Array;
  toneTint: Float32Array;
  colorChrome: number;
  colorChromeBlue: number;
  grain: number;
  grainSize: number;
  seed: number;
}

const STRENGTH_VALUE: Record<Strength, number> = { off: 0, weak: 0.5, strong: 1 };

/**
 * Channel mixers for the monochrome filters. A colour filter on B&W film passes
 * its own colour and darkens the complement — a red filter darkens skies most,
 * yellow least, green lifts foliage.
 */
const MONO_MIX: Partial<Record<FilmSim, [number, number, number]>> = {
  mono: [0.2126, 0.7152, 0.0722],
  'mono-ye': [0.36, 0.56, 0.08],
  'mono-r': [0.60, 0.34, 0.06],
  'mono-g': [0.18, 0.72, 0.10],
  acros: [0.2126, 0.7152, 0.0722],
  'acros-ye': [0.36, 0.56, 0.08],
  'acros-r': [0.60, 0.34, 0.06],
  'acros-g': [0.18, 0.72, 0.10],
  sepia: [0.2126, 0.7152, 0.0722],
};

const SEPIA_TINT: [number, number, number] = [1.07, 0.94, 0.76];

/**
 * The camera's WB-shift grid. Each step is a small multiplier on the red or
 * blue channel; ±9 covers roughly ±0.35 in linear gain, which matches how
 * coarse the in-camera shift feels.
 */
function wbShiftGain(steps: number): number {
  return Math.pow(1.035, steps);
}

/** Preset white balances, as a red/blue gain pair relative to camera WB. */
const WB_PRESET: Record<string, [number, number]> = {
  auto: [1, 1],
  daylight: [1.0, 1.0],
  shade: [1.10, 0.90],
  cloudy: [1.06, 0.94],
  'fluorescent-1': [0.98, 1.06],
  'fluorescent-2': [1.00, 1.04],
  'fluorescent-3': [1.04, 1.00],
  incandescent: [0.82, 1.22],
  kelvin: [1, 1],
};

function kelvinGain(k: number): [number, number] {
  // Relative to ~5500K daylight; warmer target => more red, less blue.
  const ratio = 5500 / Math.max(2000, Math.min(12000, k));
  return [Math.pow(ratio, 0.55), Math.pow(1 / ratio, 0.55)];
}

export function recipeToParams(recipe: Recipe, seed = 0): RenderParams {
  const mono = MONOCHROME_SIMS.has(recipe.filmSim);

  let [wbRed, wbBlue] =
    recipe.whiteBalance.mode === 'kelvin' && recipe.whiteBalance.kelvin
      ? kelvinGain(recipe.whiteBalance.kelvin)
      : (WB_PRESET[recipe.whiteBalance.mode] ?? [1, 1]);

  wbRed *= wbShiftGain(recipe.whiteBalance.shiftRed);
  wbBlue *= wbShiftGain(recipe.whiteBalance.shiftBlue);

  const mix = MONO_MIX[recipe.filmSim] ?? [0.2126, 0.7152, 0.0722];

  return {
    exposure: recipe.exposureComp ?? 0,
    wbRed,
    wbBlue,
    drStops: Math.log2(recipe.dynamicRange / 100),
    highlight: recipe.highlight,
    shadow: recipe.shadow,
    color: mono ? 0 : recipe.color,
    sharpness: recipe.sharpness,
    // Only positive NR does anything; negative NR in-camera means "less
    // smoothing than default", which from raw is simply no smoothing.
    noiseReduction: Math.max(0, recipe.noiseReduction),
    clarity: recipe.clarity ?? 0,
    monochrome: mono,
    monoMix: new Float32Array(mix),
    toneTint: new Float32Array(recipe.filmSim === 'sepia' ? SEPIA_TINT : [1, 1, 1]),
    colorChrome: STRENGTH_VALUE[recipe.colorChrome ?? 'off'],
    colorChromeBlue: STRENGTH_VALUE[recipe.colorChromeFxBlue ?? 'off'],
    grain: STRENGTH_VALUE[recipe.grain?.strength ?? 'off'],
    grainSize: recipe.grain?.size === 'large' ? 2.5 : 1.4,
    seed,
  };
}

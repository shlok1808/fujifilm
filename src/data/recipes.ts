/**
 * Seed recipe library.
 *
 * Recipe *settings* are facts and aren't copyrightable, but the curation and
 * write-ups behind them are somebody's work — so every borrowed recipe here
 * carries its author and a link back, and only recipes actually verified
 * against their source are attributed. The two marked as our own are exactly
 * that: starting points authored for this app, not community recipes.
 *
 * Add your own with the "paste a recipe" box rather than expanding this file;
 * the intent is a small honest seed set, not a scrape of somebody's site.
 */

import type { Recipe } from '../model/recipe';

const base = {
  clarity: 0,
  grain: { strength: 'off' as const },
  colorChrome: 'off' as const,
  colorChromeFxBlue: 'off' as const,
  exposureComp: 0,
};

export const RECIPE_LIBRARY: Recipe[] = [
  {
    ...base,
    id: 'fxw-xt1-classic-chrome',
    name: 'Classic Chrome',
    author: 'Fuji X Weekly',
    sourceUrl: 'https://fujixweekly.com/2020/01/21/first-fujifilm-x-t1-film-simulation-recipes/',
    notes: 'Published for the X-T1 and other X-Trans II bodies.',
    filmSim: 'classic-chrome',
    dynamicRange: 200,
    whiteBalance: { mode: 'auto', shiftRed: -1, shiftBlue: -1 },
    highlight: 1,
    shadow: 1,
    color: 2,
    sharpness: 0,
    noiseReduction: -2,
    minCameraGen: 2,
  },
  {
    ...base,
    id: 'fxw-xt1-velvia',
    name: 'Velvia',
    author: 'Fuji X Weekly',
    sourceUrl: 'https://fujixweekly.com/2020/01/21/first-fujifilm-x-t1-film-simulation-recipes/',
    notes: 'Published for the X-T1 and other X-Trans II bodies.',
    filmSim: 'velvia',
    dynamicRange: 200,
    whiteBalance: { mode: 'auto', shiftRed: 0, shiftBlue: -2 },
    highlight: -1,
    shadow: -1,
    color: 2,
    sharpness: 0,
    noiseReduction: -2,
    minCameraGen: 2,
  },
  {
    ...base,
    id: 'fxw-xt1-monochrome',
    name: 'Monochrome +Y',
    author: 'Fuji X Weekly',
    sourceUrl: 'https://fujixweekly.com/2020/01/21/first-fujifilm-x-t1-film-simulation-recipes/',
    notes: 'Published as Monochrome (+Y, +R, +G); the +Ye variant is shown here.',
    filmSim: 'mono-ye',
    dynamicRange: 200,
    whiteBalance: { mode: 'auto', shiftRed: 0, shiftBlue: 0 },
    highlight: 1,
    shadow: 1,
    color: 0,
    sharpness: 1,
    noiseReduction: -2,
    minCameraGen: 2,
  },
  {
    ...base,
    id: 'lab-standard',
    name: 'Standard (neutral)',
    author: 'this app',
    notes: 'PROVIA with everything at zero — the reference point for comparisons.',
    filmSim: 'provia',
    dynamicRange: 100,
    whiteBalance: { mode: 'auto', shiftRed: 0, shiftBlue: 0 },
    highlight: 0,
    shadow: 0,
    color: 0,
    sharpness: 0,
    noiseReduction: 0,
    minCameraGen: 1,
  },
  {
    ...base,
    id: 'lab-soft-portrait',
    name: 'Soft portrait',
    author: 'this app',
    notes: 'ASTIA with lifted shadows and gentle colour — a starting point, not a community recipe.',
    filmSim: 'astia',
    dynamicRange: 200,
    whiteBalance: { mode: 'auto', shiftRed: 1, shiftBlue: -1 },
    highlight: -1,
    shadow: -1,
    color: 1,
    sharpness: -1,
    noiseReduction: -1,
    minCameraGen: 2,
  },
  {
    ...base,
    id: 'lab-eterna-muted',
    name: 'Muted cinema',
    author: 'this app',
    notes: 'ETERNA-based flat look. Your X-T1 cannot shoot ETERNA — rendered here anyway.',
    filmSim: 'eterna',
    dynamicRange: 400,
    whiteBalance: { mode: 'auto', shiftRed: 0, shiftBlue: 1 },
    highlight: 0,
    shadow: 1,
    color: -1,
    sharpness: 0,
    noiseReduction: -2,
    minCameraGen: 4,
  },
];

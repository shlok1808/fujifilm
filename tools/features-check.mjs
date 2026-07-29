/** Exercises export, share-link round trip, and recipe pasting. */
import { chromium } from 'playwright';
const RAF = '/Users/shloki/Desktop/fuji/DSCF0030.RAF';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-write','clipboard-read'] });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type()==='error') console.log('[console.error]', m.text()); });

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.setInputFiles('input[type=file]', RAF);
await p.waitForTimeout(3500);

// --- paste a recipe -------------------------------------------------------
await p.click('button:has-text("Paste recipe")');
await p.fill('textarea.paste', [
  'Film Simulation: Classic Chrome',
  'Dynamic Range: DR400',
  'White Balance: Auto, -2 Red & +3 Blue',
  'Highlight: +1',
  'Shadow: -1',
  'Color: +2',
  'Sharpness: -1',
  'Noise Reduction: -2',
].join('\n'));
await p.locator('textarea.paste').blur();
await p.waitForTimeout(900);
const afterPaste = await p.evaluate(() => ({
  sim: document.querySelector('aside select')?.value,
  dr: document.querySelectorAll('aside select')[1]?.value,
  sliders: [...document.querySelectorAll('.params input[type=range]')].map((i) =>
    [i.closest('label')?.querySelector('span')?.firstChild?.textContent?.trim(), i.value]),
}));
console.log('after paste  sim=%s dr=%s', afterPaste.sim, afterPaste.dr);
console.log('             ', JSON.stringify(afterPaste.sliders.filter(([k]) =>
  ['Shift Red','Shift Blue','Highlight','Shadow','Color','Sharpness','Noise reduction'].includes(k))));

// --- share link round trip ------------------------------------------------
await p.click('button:has-text("Share link")');
await p.waitForTimeout(600);
const url = await p.evaluate(() => location.href);
console.log('share url len', url.length, url.includes('#r=') ? 'has token' : 'NO TOKEN');

const p2 = await ctx.newPage();
await p2.goto(url, { waitUntil: 'networkidle' });
await p2.setInputFiles('input[type=file]', RAF);
await p2.waitForTimeout(3500);
const restored = await p2.evaluate(() => ({
  sim: document.querySelector('aside select')?.value,
  dr: document.querySelectorAll('aside select')[1]?.value,
  sliders: [...document.querySelectorAll('.params input[type=range]')].map((i) =>
    [i.closest('label')?.querySelector('span')?.firstChild?.textContent?.trim(), i.value]),
}));
console.log('after reload sim=%s dr=%s', restored.sim, restored.dr);
const same = JSON.stringify(afterPaste.sliders) === JSON.stringify(restored.sliders)
  && afterPaste.sim === restored.sim && afterPaste.dr === restored.dr;
console.log('round trip:', same ? 'MATCH' : 'MISMATCH');
if (!same) console.log('  ', JSON.stringify(restored.sliders));
await p2.close();

// --- full-resolution export ----------------------------------------------
const dl = p.waitForEvent('download', { timeout: 120000 });
await p.click('button:has-text("Export full size")');
const download = await dl;
const path = await download.path();
const { statSync } = await import('node:fs');
console.log('export:', download.suggestedFilename(), (statSync(path).size/1e6).toFixed(2), 'MB');
await b.close();

/**
 * The honest accuracy metric.
 *
 * Loads a RAF, renders the recipe the frame was *actually shot with* (read from
 * the MakerNote), and compares that against the camera's own JPEG embedded in
 * the same file. Reports CIE76 dE in Lab.
 *
 * This is the number that should fall as the LUTs and parameter mappings
 * improve, and the number to quote when saying "close, not identical".
 *
 * Usage:  node tools/ground-truth.mjs [file.RAF ...]      (dev server must be running)
 */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';

const DEFAULT_DIR = '/Users/shloki/Desktop/fuji';
let files = process.argv.slice(2);
if (files.length === 0) {
  // real photos only: blank frames have a tiny embedded JPEG
  files = readdirSync(DEFAULT_DIR)
    .filter((f) => /\.RAF$/i.test(f))
    .slice(0, 6)
    .map((f) => `${DEFAULT_DIR}/${f}`);
}

const SAMPLE_W = 320;
const SAMPLE_H = 213;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const rows = [];
for (const file of files) {
  // the drop zone unmounts once a photo is loaded, so start each file fresh
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', file);
  await page.waitForTimeout(3200);

  const meta = await page.evaluate(() => ({
    status: document.querySelector('.status')?.textContent ?? '',
    sim: document.querySelector('aside select')?.value ?? '',
  }));

  // reveal the camera JPEG overlay so we can sample it
  const toggle = page.locator('.viewer .toggle');
  if (!(await toggle.count())) { console.log(`${file}: no embedded JPEG, skipped`); continue; }
  await toggle.dispatchEvent('mousedown');
  await page.waitForFunction(() => {
    const i = document.querySelector('.viewer .reference');
    return i && i.complete && i.naturalWidth > 0;
  }, null, { timeout: 15000 });

  const result = await page.evaluate(async ([w, h]) => {
    const canvas = document.querySelector('canvas');
    const img = document.querySelector('.viewer .reference');

    const grab = (src, sw, sh, tw, th, frac) => {
      const off = document.createElement('canvas');
      off.width = tw; off.height = th;
      const ctx = off.getContext('2d', { willReadFrequently: true });
      const cw = sw * frac, ch = sh * frac;
      ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, tw, th);
      return ctx.getImageData(0, 0, tw, th).data;
    };

    // The camera's JPEG is framed slightly tighter than the raw active area, so
    // a like-for-like comparison has to fit the scale first. Without this the
    // measurement reports a geometric mismatch as if it were colour error.
    const ours = grab(canvas, canvas.width, canvas.height, w, h, 0.70);
    const oursLo = grab(canvas, canvas.width, canvas.height, 40, 27, 0.70);

    // sRGB -> linear -> XYZ (D65) -> Lab
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : t / 0.1284 + 4 / 29);
    const lab = (r, g, bl) => {
      r = lin(r); g = lin(g); bl = lin(bl);
      const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.9505;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.089;
      const fx = f(X), fy = f(Y), fz = f(Z);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };

    const meanDe = (A, B) => {
      let s2 = 0, n2 = 0;
      for (let i = 0; i < A.length; i += 4) {
        const a = lab(A[i], A[i + 1], A[i + 2]);
        const c = lab(B[i], B[i + 1], B[i + 2]);
        s2 += Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]); n2++;
      }
      return s2 / n2;
    };

    // Fit the camera crop fraction that best matches our field of view, so the
    // numbers below describe colour rather than framing.
    let bestFrac = 0.70, bestDe = Infinity;
    for (let fr = 0.50; fr <= 0.90001; fr += 0.02) {
      const d = meanDe(ours, grab(img, img.naturalWidth, img.naturalHeight, w, h, fr));
      if (d < bestDe) { bestDe = d; bestFrac = fr; }
    }
    const theirs = grab(img, img.naturalWidth, img.naturalHeight, w, h, bestFrac);
    const theirsLo = grab(img, img.naturalWidth, img.naturalHeight, 40, 27, bestFrac);
    const loSum = meanDe(oursLo, theirsLo);

    const deltas = [];
    const acc = { dL: 0, da: 0, db: 0, oL: 0, tL: 0, oa: 0, ta: 0, ob: 0, tb: 0, n: 0 };
    for (let i = 0; i < ours.length; i += 4) {
      const a = lab(ours[i], ours[i + 1], ours[i + 2]);
      const c = lab(theirs[i], theirs[i + 1], theirs[i + 2]);
      deltas.push(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]));
      acc.dL += a[0] - c[0]; acc.da += a[1] - c[1]; acc.db += a[2] - c[2];
      acc.oL += a[0]; acc.tL += c[0];
      acc.oa += a[1]; acc.ta += c[1];
      acc.ob += a[2]; acc.tb += c[2];
      acc.n++;
    }
    deltas.sort((x, y) => x - y);
    const mean = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    return {
      mean,
      lowFreq: loSum,
      fovRatio: bestFrac / 0.70,
      median: deltas[deltas.length >> 1],
      p95: deltas[Math.floor(deltas.length * 0.95)],
      dL: acc.dL / acc.n, da: acc.da / acc.n, db: acc.db / acc.n,
      oursL: acc.oL / acc.n, theirsL: acc.tL / acc.n,
      oursA: acc.oa / acc.n, theirsA: acc.ta / acc.n,
      oursB: acc.ob / acc.n, theirsB: acc.tb / acc.n,
    };
  }, [SAMPLE_W, SAMPLE_H]);
  await toggle.dispatchEvent('mouseup');

  rows.push({ file: file.split('/').pop(), sim: meta.sim, ...result });
}

console.log('\nRender of as-shot recipe  vs  camera JPEG        (CIE76 dE, lower is better)');
console.log('-'.repeat(74));
console.log('file             sim              meandE  lowFreq  median    p95  |  bias dL     da     db  | fov');
for (const r of rows) {
  console.log(
    `${r.file.padEnd(16)} ${r.sim.padEnd(16)} ` +
    `${r.mean.toFixed(1).padStart(6)}  ${r.lowFreq.toFixed(1).padStart(6)}  ${r.median.toFixed(1).padStart(6)}  ${r.p95.toFixed(1).padStart(5)}  |  ` +
    `${r.dL.toFixed(1).padStart(6)} ${r.da.toFixed(1).padStart(6)} ${r.db.toFixed(1).padStart(6)}  | ${r.fovRatio.toFixed(2)}`,
  );
}
console.log('\nmean Lab   ours -> camera');
for (const r of rows) {
  console.log(
    `${r.file.padEnd(16)} L ${r.oursL.toFixed(1).padStart(5)} -> ${r.theirsL.toFixed(1).padStart(5)}` +
    `   a ${r.oursA.toFixed(1).padStart(5)} -> ${r.theirsA.toFixed(1).padStart(5)}` +
    `   b ${r.oursB.toFixed(1).padStart(5)} -> ${r.theirsB.toFixed(1).padStart(5)}`,
  );
}
if (rows.length) {
  const avg = rows.reduce((s, r) => s + r.mean, 0) / rows.length;
  const avgLo = rows.reduce((s, r) => s + r.lowFreq, 0) / rows.length;
  console.log('-'.repeat(74));
  console.log(`overall mean dE: ${avg.toFixed(2)}   low-frequency dE: ${avgLo.toFixed(2)}`);
  console.log('\nlow-frequency dE is the colour/tone number; the per-pixel figure also');
  console.log('carries detail and alignment differences against the camera JPEG.');
  console.log('\ndE ~2.3 is the just-noticeable threshold; <5 reads as a close match,');
  console.log('>10 means the look is visibly different.');
}
await b.close();

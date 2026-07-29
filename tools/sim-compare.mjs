/** Renders one RAF through several simulations and reports how much each differs. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const RAF = process.argv[2] ?? '/Users/shloki/Desktop/fuji/DSCF0030.RAF';
const SIMS = process.argv.slice(3);
const sims = SIMS.length ? SIMS
  : ['provia', 'velvia', 'astia', 'classic-chrome', 'pro-neg-hi', 'eterna', 'classic-neg', 'acros'];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.setInputFiles('input[type=file]', RAF);
await p.waitForTimeout(3500);

const sample = () => p.evaluate(() => {
  const c = document.querySelector('canvas');
  const off = document.createElement('canvas');
  off.width = 64; off.height = 42;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0, 64, 42);
  return Array.from(ctx.getImageData(0, 0, 64, 42).data);
});

const results = [];
for (const sim of sims) {
  await p.selectOption('aside select', sim);
  await p.waitForTimeout(900);
  results.push({ sim, px: await sample() });
}

const mean = (px) => {
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; bl += px[i+2]; n++; }
  return [r/n, g/n, bl/n];
};
const diff = (a, b2) => {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    s += Math.abs(a[i]-b2[i]) + Math.abs(a[i+1]-b2[i+1]) + Math.abs(a[i+2]-b2[i+2]);
    n += 3;
  }
  return s / n;
};

const base = results[0];
console.log('\nsim               meanRGB              vs provia (mean abs diff / 255)');
console.log('-'.repeat(72));
for (const r of results) {
  const m = mean(r.px).map((v) => v.toFixed(0).padStart(3)).join(' ');
  const d = diff(base.px, r.px).toFixed(2);
  console.log(`${r.sim.padEnd(17)} ${m}        ${String(d).padStart(6)}`);
}
writeFileSync('/tmp/sims.json', JSON.stringify(results.map((r) => ({ sim: r.sim, mean: mean(r.px) })), null, 1));
await b.close();

/** Screenshots all three view modes against a real RAF. */
import { chromium } from 'playwright';
const RAF = process.argv[2] ?? '/Users/shloki/Desktop/fuji/DSCF0030.RAF';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.setInputFiles('input[type=file]', RAF);
await p.waitForTimeout(3500);

const stats = () => p.evaluate(() => {
  const c = document.querySelector('canvas');
  const o = document.createElement('canvas'); o.width = 120; o.height = 80;
  const x = o.getContext('2d'); x.drawImage(c, 0, 0, 120, 80);
  const d = x.getImageData(0, 0, 120, 80).data;
  // compare the four quadrants: distinct quadrant means the panes really differ
  const q = (x0, y0) => { let s = 0, n = 0;
    for (let y = y0; y < y0 + 40; y++) for (let xx = x0; xx < x0 + 60; xx++) {
      const i = (y * 120 + xx) * 4; s += 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; n++; }
    return +(s / n).toFixed(1); };
  return { w: c.width, h: c.height, tl: q(0,0), tr: q(60,0), bl: q(0,40), br: q(60,40) };
});

for (const [label, mode] of [['Single','Single'], ['Compare','Compare'], ['Slider','Slider']]) {
  await p.click(`.modes button:has-text("${mode}")`);
  await p.waitForTimeout(1600);
  console.log(`${label.padEnd(8)}`, JSON.stringify(await stats()));
  await p.screenshot({ path: `/tmp/mode-${mode.toLowerCase()}.png`, fullPage: true });
}
await b.close();

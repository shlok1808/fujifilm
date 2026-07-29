import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.setInputFiles('input[type=file]', '/Users/shloki/Desktop/fuji/DSCF0030.RAF');
await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  const off = document.createElement('canvas');
  off.width = 100; off.height = 100;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0, 100, 100);
  const d = ctx.getImageData(0, 0, 100, 100).data;
  const band = (y0, y1) => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < 100; x++) {
      const i = (y * 100 + x) * 4;
      s += 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; n++;
    }
    return +(s / n).toFixed(1);
  };
  return { top: band(0, 12), bottom: band(88, 100) };
});
console.log(`top=${r.top}  bottom=${r.bottom}  ->`,
  r.top > r.bottom ? 'SKY ON TOP (correct)' : 'SKY ON BOTTOM (flipped)');
await b.close();

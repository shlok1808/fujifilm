/** Exercises swapping photos mid-session and the compare picker. */
import { chromium } from 'playwright';
const A = '/Users/shloki/Desktop/fuji/DSCF0030.RAF';
const B = '/Users/shloki/Desktop/fuji/DSCF0011.RAF';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const shot = () => p.evaluate(() => {
  const c = document.querySelector('canvas');
  const o = document.createElement('canvas'); o.width = 40; o.height = 27;
  const x = o.getContext('2d'); x.drawImage(c, 0, 0, 40, 27);
  const d = x.getImageData(0, 0, 40, 27).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2];
  return { canvas: `${c.width}x${c.height}`, sig: Math.round(s / (d.length / 4)) };
});

await p.setInputFiles('input[type=file]', A);
await p.waitForTimeout(3400);
const first = await shot();
const nameA = await p.textContent('.meta .dim');
console.log('photo A  ', JSON.stringify(first), nameA.trim());

// swap photos without reloading
await p.click('button:has-text("Change photo")');
await p.setInputFiles('input[type=file]', B);
await p.waitForTimeout(3400);
const second = await shot();
const nameB = await p.textContent('.meta .dim');
console.log('photo B  ', JSON.stringify(second), nameB.trim());
console.log('swapped: ', first.sig !== second.sig && nameA !== nameB ? 'YES' : 'NO CHANGE');

// swap back, to prove it is not one-way
await p.click('button:has-text("Change photo")');
await p.setInputFiles('input[type=file]', A);
await p.waitForTimeout(3400);
const third = await shot();
console.log('back to A:', third.sig === first.sig ? 'MATCHES first load' : `differs (${third.sig} vs ${first.sig})`);

// compare picker: add sims up to the cap
await p.click('.modes button:has-text("Compare")');
await p.waitForTimeout(1200);
console.log('source toggle:', (await p.locator('.segmented button').allTextContents()).join(' | '));
for (const label of ['ETERNA / Cinema', 'ACROS', 'Classic Neg.', 'PRO Neg. Hi', 'Sepia']) {
  await p.click(`.picker .chip:has-text("${label}")`);
  await p.waitForTimeout(350);
}
await p.waitForTimeout(1200);
console.log('after adding 5 more:', JSON.stringify(await shot()));
console.log('panes selected:', await p.locator('.picker .chip.on').count());
await p.screenshot({ path: '/tmp/ui-many.png' });

// switch to saved recipes
await p.click('.segmented button:has-text("Saved recipes")');
await p.waitForTimeout(1200);
console.log('recipes mode:', JSON.stringify(await shot()), 'chips on:', await p.locator('.picker .chip.on').count());
await b.close();

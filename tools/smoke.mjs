import { chromium } from 'playwright';
const b = await chromium.launch();
const OUT = process.argv[2] || "/tmp/app.png";
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on('console', m => { if (m.type()==='error') console.log('[console.error]', m.text()); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.setInputFiles('input[type=file]', '/Users/shloki/Desktop/fuji/DSCF0030.RAF');
await p.waitForSelector('canvas', { timeout: 60000 });
await p.waitForTimeout(3000);
console.log('status:', await p.locator('.status').textContent().catch(()=>'(none)'));
const err = await p.locator('.error').textContent().catch(()=>null);
if (err) console.log('APP ERROR:', err);
// confirm the canvas actually has non-uniform content
const stats = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const off = document.createElement('canvas');
  off.width = 200; off.height = 140;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0, 200, 140);
  const d = ctx.getImageData(0,0,200,140).data;
  let min=255,max=0,sum=0,n=0; const seen=new Set();
  for (let i=0;i<d.length;i+=4){ const v=d[i]; if(v<min)min=v; if(v>max)max=v; sum+=v; n++; seen.add(v); }
  return { w:c.width, h:c.height, min, max, mean:+(sum/n).toFixed(1), distinct:seen.size };
});
console.log('canvas:', JSON.stringify(stats));
await p.screenshot({ path: OUT, fullPage: true });
await b.close();

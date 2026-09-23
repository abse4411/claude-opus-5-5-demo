import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await b.newPage();
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?q=low');
await page.waitForFunction(() => !!window.__debugGuns, null, { timeout: 60000 });
const res = await page.evaluate(() => {
  const logs = [];
  for (const id of ['molotov', 'frost', 'he']) {
    const g = window.__debugGuns.buildGun(id);
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position.array;
      let bad = false;
      for (let i = 0; i < pos.length; i++) if (Number.isNaN(pos[i])) bad = true;
      logs.push(`${id} ${o.geometry.type} count=${o.geometry.attributes.position.count} bad=${bad} attrs=${Object.keys(o.geometry.attributes).join('/')} indexed=${!!o.geometry.index}`);
    });
    const mm = window.__debugGuns.buildGunMerged(id);
    const arr = mm.geometry.attributes.position.array;
    let first = -1;
    for (let i = 0; i < arr.length; i++) if (Number.isNaN(arr[i])) { first = i; break; }
    logs.push(`${id} MERGED count=${arr.length} firstNaN@${first} groups=${mm.geometry.groups?.length || 0}`);
  }
  return logs;
});
console.log(res.join('\n'));
await b.close();

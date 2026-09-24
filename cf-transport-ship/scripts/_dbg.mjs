import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = pathToFileURL(resolve('dist/index.html')).href + '?autostart=1&q=low&nolock=1';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
for (let a = 0; a < 4; a++) {
  await page.goto(base + '&mode=infection&t=' + Date.now());
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  try {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      if (!p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade')) p.giveLoadout();
      st.side = 'human'; st.alive = true;
      st.humanSurviveTime = 45 * 4;
      g.fastForward(0.25, 1 / 30);
      const tier = rules.humanTier(p.id);
      const readyTxt = document.getElementById('wzTier').innerHTML;
      const main = p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade');
      main.mag = 1;
      const fired = g.woz.tryHumanUltimate(p);
      g.fastForward(0.25, 1 / 30);
      return { tier, readyTxt, fired, active: st.ultActiveT > 0 };
    });
    console.log(a, 'OK', JSON.stringify(r));
  } catch (e) { console.log(a, 'CRASH:', e.message.split('\n')[0]); }
}
await browser.close();

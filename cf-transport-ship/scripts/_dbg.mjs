import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = pathToFileURL(resolve('dist/index.html')).href + '?autostart=1&q=low&nolock=1';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + '&mode=infection');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const g = window.__game, rules = g.woz.rules, p = g.player;
  (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
  g.fastForward(20, 1 / 30);
  rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
  // 先疾冲一次（模拟上一迭代残留）
  rules.convertToMutant(p.id, 'nightrunner', false);
  g.woz.convertNow(p, true);
  rules.state(p.id).skillCharge = 1;
  rules.tryUseSkill(p.id);
  // 噬魂者迭代
  const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
  if (!v) return { ok: false };
  v.pos.set(p.pos.x - 5, v.pos.y, p.pos.z); v.protectT = 0; v.armor = 0;
  p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
  g.fastForward(1 / 30, 1 / 30);
  p.updateCamera(0.016);
  rules.convertToMutant(p.id, 'souleater', false);
  g.woz.convertNow(p, true);
  const st = rules.state(p.id);
  const stInfo = { charge: st.skillCharge, cls: st.cls, alive: st.alive };
  const fired = rules.tryUseSkill(p.id);
  const dist = +p.pos.distanceTo(v.pos).toFixed(1);
  return { ok: true, stInfo, fired, dist: dist, blind: v.blindT, vAlive: v.alive, vSide: rules.state(v.id).side, ppos: { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) }, vpos: { x: +v.pos.x.toFixed(1), z: +v.pos.z.toFixed(1) } };
});
console.log(JSON.stringify(r));
await browser.close();

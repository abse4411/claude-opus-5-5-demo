import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await b.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 140)));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?autostart=1&q=low&nolock=1&mode=infection');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });

// 确保玩家不是母体：爆发后检查，是母体就重开（最多 4 次）
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) {
    window.__game.fastForward(18, 1 / 30); // 购买期→爆发
    if (!window.__game.woz.rules.state(0).isMother) return;
    window.__game.woz.startMatch(); // 换种子重开
  }
});
console.log('玩家非母体:', await page.evaluate(() => !window.__game.woz.rules.state(0).isMother && window.__game.woz.rules.phase === 'battle'));

// ① 感染转化：母体爪杀玩家 → 原地变子体
const conv = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  const mother = g.woz.rules.players.findIndex((pl) => pl.isMother);
  const posBefore = p.pos.clone();
  g.damage(p, g.actors[mother], 9999, 'chest', 'claw', { x: 1, z: 0 }, false);
  g.fastForward(3, 1 / 30);
  const st = g.woz.rules.state(0);
  return { isMutant: st.side === 'mutant', cls: st.cls, inPlace: p.pos.distanceTo(posBefore) < 8 };
});
console.log('① 原地感染转化:', JSON.stringify(conv));

// ② 按 6 切换噬魂者（真实键盘事件）
await page.keyboard.down('Digit6');
await page.waitForTimeout(150);
await page.keyboard.up('Digit6');
const cls2 = await page.evaluate(() => window.__game.woz.rules.state(0).cls);
console.log('② 按 6 变身噬魂者:', cls2, cls2 === 'souleater' ? 'PASS' : 'FAIL');

// ③ 移速按当前武器：测 p.speed（持枪行走速度）
const spd = await page.evaluate(async () => {
  const g = window.__game, p = g.player;
  p.armor = 0; p.hp = 100; p.alive = true; p.pos.set(24, 0.02, 8);
  const WS = p.inv[0].constructor;
  const measure = async (id) => {
    p.inv[0] = new WS(id); p.slot = 0; p.soldier.setWeapon(id);
    p.pos.set(24, 0.02, 8); p.vel.set(0, 0, 0);
    let maxSpd = 0;
    p.keys.add('KeyW');
    const t0 = performance.now();
    while (performance.now() - t0 < 700) {
      await new Promise((r) => requestAnimationFrame(r));
      maxSpd = Math.max(maxSpd, p.speed || 0);
    }
    p.keys.delete('KeyW');
    return +maxSpd.toFixed(2);
  };
  const mg = await measure('minigun');
  const dg = await measure('deagle');
  return { minigun: mg, deagle: dg, faster: dg > mg };
});
console.log('③ 移速（当前武器）:', JSON.stringify(spd));

// ④ 丢弃/拾取
const drop = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  p.alive = true; p.hp = 100; p.protectT = 0;
  p.inv[0] = new (p.inv[0].constructor)('ak47'); p.slot = 0; p.soldier.setWeapon('ak47');
  const n0 = g.groundGuns.length;
  g.dropGun(p);
  const dropped = g.groundGuns.length > n0;
  g.tryPickup(p);
  return { dropped, now: p.inv[0].id };
});
console.log('④ 丢弃/拾取:', JSON.stringify(drop));
await b.close();

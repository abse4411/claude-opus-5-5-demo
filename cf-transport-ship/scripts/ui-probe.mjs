// UI 迭代探针：每个 UI 版本的验收断言 + 截图（无头 Edge）
// 用法: node scripts/ui-probe.mjs [v1|v2|...]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs';

const ver = process.argv[2] || 'v1';
fs.mkdirSync('scripts/shots', { recursive: true });
const base = pathToFileURL(resolve('dist/index.html')).href + '?autostart=1&q=low&nolock=1';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let passed = 0, failed = 0;
const check = (cond, name) => {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
};
const goto = async (q = '') => {
  await page.goto(base + q);
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(500);
};
const shot = (name, clip) => page.screenshot({ path: `scripts/shots/${ver}-${name}.png`, ...(clip ? { clip } : {}) });

if (ver === 'v1') {
  // 1) 五张地图雷达包围盒自适应
  for (const map of ['ship', 'city', 'lab', 'plaza', 'harbor']) {
    await goto('&map=' + map);
    const r = await page.evaluate(() => {
      const h = window.__game.hud;
      return { w: h.radarImg?.width, h: h.radarImg?.height, ox: h.radarOX, oz: h.radarOZ, map: window.__game.mapName };
    });
    check(r.w > 100 && r.h > 60 && Number.isFinite(r.ox), `雷达[${r.map}]: 画布 ${r.w}x${r.h} 偏移(${r.ox | 0},${r.oz | 0})`);
    await shot(`radar-${map}`, { x: 0, y: 0, width: 240, height: 240 });
  }
  // 2) 对抗模式：3 据点标记 + 靠近截图
  await goto('&mode=confront');
  {
    const ms = await page.evaluate(() => window.__game.woz.radarMarkers());
    check(ms.length === 3 && ms.every((m) => m.kind === 'point' && m.label), `对抗: 3 据点标记 (${ms.map((m) => m.label).join(',')})`);
    await page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.fastForward(3.5, 1 / 30);
      p.pos.set(g.woz.points[0].def.x + 2, 0.02, g.woz.points[0].def.z + 1);
    });
    await page.waitForTimeout(400);
    await shot('confront');
    await shot('confront-radar', { x: 0, y: 0, width: 240, height: 240 });
  }
  // 3) 爆破模式：站点 ☢ → 安放后红点
  await goto('&mode=demol');
  {
    const ms = await page.evaluate(() => window.__game.woz.radarMarkers());
    check(ms.length === 1 && ms[0].kind === 'site', '爆破: 站点 ☢ 标记');
    const st = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.fastForward(3.5, 1 / 30);
      for (const a of g.actors) {
        if (!a || a === p || !a.alive || a.protectT > 0) continue;
        g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
      }
      p.hp = 500; p.armor = 0; p.alive = true;
      p.pos.set(-30, 0.02, 0);
      p.keys.add('KeyE');
      g.fastForward(4.5, 1 / 30);
      p.keys.delete('KeyE');
      return { state: g.woz.bomb.state, markers: g.woz.radarMarkers() };
    });
    check(st.state === 'planted', `爆破: 安放成功 (${st.state})`);
    check(st.markers.some((m) => m.kind === 'bomb'), '爆破: 已安放核弹红点标记');
    await shot('demol');
    await shot('demol-radar', { x: 0, y: 0, width: 240, height: 240 });
  }
} else {
  console.log(`未知版本 ${ver}`); process.exit(2);
}

check(errors.length === 0, `无控制台错误${errors.length ? '：' + JSON.stringify(errors.slice(0, 3)) : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

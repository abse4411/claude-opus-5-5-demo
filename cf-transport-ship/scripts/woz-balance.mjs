// WOZ 平衡探针：无头快进完整对局，统计回合节奏与胜负分布
// 用法: node scripts/woz-balance.mjs [mode] [局数]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mode = process.argv[2] || 'infection';
const mapArg = process.argv[4] || 'ship';
const matches = Number(process.argv[3] || 3);
const url = pathToFileURL(resolve('dist/index.html')).href + `?autostart=1&q=low&nolock=1&mode=${mode}&map=${mapArg}`;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

for (let m = 1; m <= matches; m++) {
  await page.goto(url + `&t=${Date.now()}`); // 换种子：qs t 无副作用，仅强刷
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const g = window.__game;
    let rounds = 0, humanWins = 0, mutantWins = 0, avengerSeen = false, tideSeen = 0;
    const t0 = performance.now();
    while (g.playing && performance.now() - t0 < 60000) {
      const before = g.woz.round;
      g.fastForward(20, 1 / 30);
      if (g.woz.round > before) {
        rounds = g.woz.round - 1;
        if (g.woz.rules && g.woz.rules.avengerId() >= 0) avengerSeen = true;
        tideSeen = Math.max(tideSeen, g.woz.tide.length);
      }
    }
    const extra = g.woz.points.length
      ? ' 据点=' + g.woz.points.map((p) => p.name + ':' + p.owner).join(',')
      : '';
    return {
      ended: g.ended, score: { ...g.score }, rounds,
      avengerSeen, tideSeen, extra,
      lastResult: g.woz.rules ? g.woz.rules.result : null,
      simSeconds: Math.round(g.time),
    };
  });
  console.log(`对局${m}: ${r.score.GR}:${r.score.BL} ${r.ended ? '完赛' : '未完赛'} · ${r.rounds}+回合 · ${r.simSeconds}s模拟 · 复仇者=${r.avengerSeen} 尸潮峰值=${r.tideSeen}${r.extra}`);
}
await browser.close();

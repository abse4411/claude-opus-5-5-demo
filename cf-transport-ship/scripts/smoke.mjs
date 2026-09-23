// 无头冒烟测试：加载 dist/index.html，确认游戏启动且无 console 错误
// 用法: node scripts/smoke.mjs [mode]  （mode 可选 infection/revenge/tdm）
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mode = process.argv[2] || '';
const url = pathToFileURL(resolve('dist/index.html')).href
  + '?autostart=1&q=low&nolock=1' + (mode ? `&mode=${mode}` : '');

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(url);
await page.waitForFunction(() => window.__game && window.__game.frame > 30, null, { timeout: 60000 });
await page.waitForTimeout(6000);

const state = await page.evaluate(() => {
  const g = window.__game;
  return {
    playing: g.playing,
    mode: g.opts?.mode,
    actors: g.actors?.length ?? 0,
    score: g.score ? { ...g.score } : null,
    timeLeft: Math.round(g.timeLeft ?? -1),
    frame: g.frame ?? 0,
  };
});
console.log('STATE', JSON.stringify(state));
console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 8), null, 1) : 'none');
const ok = state.playing === true && state.actors > 0 && state.frame > 30
  && errors.filter((e) => !/favicon|WebGL warning/i.test(e)).length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
await browser.close();
process.exit(ok ? 0 : 1);

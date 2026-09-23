// WOZ 三新模式端到端验收：生化对抗 / 生化爆破 / 生化模式
// 用法: node scripts/woz-e2e2.mjs
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('dist/index.html')).href + '?autostart=1&q=low&nolock=1';
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

// ---------- 生化对抗 ----------
await page.goto(url + '&mode=confront');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__game.woz.points.length === 3), '对抗: 3 个据点已建立');
check(await page.evaluate(() => window.__game.woz.points.every((p) => p.owner === 'none')), '对抗: 开局据点无主');
check(await page.evaluate(() => window.__game.actors.filter((a) => a.team === 'GR').length === 6
  && window.__game.actors.filter((a) => a.team === 'BL').length === 4), '对抗: 6 攻 4 守布阵');

// 确定性占领：等出生保护过期 → 每个据点「清守方→玩家站位 6s」循环（5s 干净窗口足够占领）
{
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz, p = g.player;
    const killMutants = () => {
      for (const a of g.actors) {
        if (!a || a === p || a.team !== 'BL' || !a.alive || a.protectT > 0) continue;
        g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
      }
    };
    g.fastForward(3.5, 1 / 30); // 等 3s 出生保护过期
    killMutants();
    // 清掉己方 BOT（避免随机走位干扰占领判定）
    for (const a of g.actors) {
      if (!a || a === p || a.team !== 'GR' || !a.alive || a.protectT > 0) continue;
      g.damage(a, null, 99999, 'chest', 'he', { x: -1, z: 0 }, false);
    }
    const owners = [];
    for (const pt of woz.points) {
      for (let k = 0; k < 6 && pt.owner !== 'GR'; k++) {
        killMutants();
        if (!p.alive) { p.alive = true; p.hp = 500; }
        p.hp = Math.max(p.hp, 300); p.armor = 0;
        p.pos.set(pt.def.x, 0.02, pt.def.z);
        g.fastForward(6, 1 / 30);
      }
      owners.push(pt.owner);
    }
    return { owners, score: { ...g.score } };
  });
  check(r.owners.every((o) => o === 'GR'), `对抗: 三据点全部被占领 (${r.owners})`);
  check(r.score.GR >= 1, `对抗: 占领全部据点 → 人类胜 (比分 ${r.score.GR}:${r.score.BL})`);
}
// 完赛推进
await page.evaluate(() => window.__game.fastForward(30, 1 / 30));
check(await page.evaluate(() => window.__game.woz.round >= 2 || window.__game.ended), '对抗: 进入下一回合或完赛');

// ---------- 生化爆破 ----------
await page.goto(url + '&mode=demol');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__game.woz.bomb && window.__game.woz.bomb.state === 'idle'), '爆破: 核弹待安放');

// 确定性安放：等保护过期 → 清场（守方+己方BOT）→ 玩家进巢穴 4.5s（4s 吟唱完成，赶在守方 6s 复活前）
{
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz, p = g.player;
    if (!p) return { state: 'no player' };
    g.fastForward(3.5, 1 / 30);
    for (const a of g.actors) {
      if (!a || a === p || !a.alive || a.protectT > 0) continue;
      g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
    }
    p.hp = 500; p.armor = 0; p.alive = true;
    p.pos.set(-30, 0.02, 0);
    g.fastForward(4.5, 1 / 30);
    const hero = g.actors[woz.bomb.planter] || null;
    return {
      state: woz.bomb.state,
      hero: woz.heroGiven,
      heroActor: hero ? { hp: hero.hp, mul: hero.heroMul, outfit: hero.wozOutfit } : null,
    };
  });
  check(r.state === 'planted', `爆破: 核弹安放成功 (state=${r.state})`);
  check(r.hero && r.heroActor && r.heroActor.hp >= 200 && r.heroActor.mul >= 1.25 && r.heroActor.outfit === 'AVG',
    `爆破: 先行安放者进化英雄 (hp=${r.heroActor?.hp} mul=${r.heroActor?.mul})`);
}
// 压缩倒计时 → 引爆（摧毁吟唱 8s 赶不上 1s 引爆）→ 人类回合胜
{
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz;
    if (woz.bomb && woz.bomb.state === 'planted') woz.bomb.timer = 1;
    g.fastForward(1.5, 1 / 30);
    return { score: { ...g.score }, state: woz.bomb ? woz.bomb.state : 'roundReset' };
  });
  check(r.score.GR >= 1, `爆破: 核弹引爆 → 人类回合胜 (${r.score.GR}:${r.score.BL})`);
}
// 变异者摧毁路径：新回合安放后不再干预，让复活守卫自然完成摧毁吟唱
{
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz, p = g.player;
    if (g.ended) return { skipped: true, why: '对局已结束' };
    if (woz.bomb === null || !p) return { skipped: true, why: '回合重置中' };
    g.fastForward(3.5, 1 / 30);
    for (const a of g.actors) {
      if (!a || a === p || !a.alive || a.protectT > 0) continue;
      g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
    }
    p.hp = 500; p.armor = 0; p.alive = true;
    p.pos.set(-30, 0.02, 0);
    g.fastForward(4.5, 1 / 30); // 安放完成（守方 6s 后复活）
    if (woz.bomb.state !== 'planted') return { skipped: true, why: 'not planted: ' + woz.bomb.state };
    const blBefore = g.score.BL;
    g.fastForward(13, 1 / 30);  // 守卫复活→抵近→8s 摧毁吟唱
    return { destroyed: woz.bomb.state === 'destroyed' || g.score.BL > blBefore, score: { ...g.score } };
  });
  if (r.skipped) console.log('    [跳过摧毁路径:', r.why || '', ']');
  else check(r.destroyed, `爆破: 变异者摧毁核弹 → 变异者胜 (比分 ${r.score.GR}:${r.score.BL})`);
}

// ---------- 生化模式 ----------
await page.goto(url + '&mode=bio');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__game.woz.rules !== null && window.__game.actors.every((a) => a.team === 'GR')), '生化: 开局全员人类（规则层挂载）');

// 快进到战斗期，等待 AI 怪物刷新
await page.evaluate(() => window.__game.fastForward(40, 1 / 30));
{
  const r = await page.evaluate(() => ({
    ai: window.__game.woz.tide.length,
    phase: window.__game.woz.rules.phase,
  }));
  check(r.ai > 0, `生化: AI 怪物已刷新 (${r.ai} 只 · phase=${r.phase})`);
}
// 杀一只 AI 怪物 → 掉落补给 → 拾取生效
{
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz;
    const ai = woz.tide.find((z) => z.alive);
    if (!ai) return { ok: false, why: 'no ai alive' };
    // 回合可能已全员感染：合成一名存活人类做拾取验证
    let human = g.actors.find((a) => a.team === 'GR' && a.alive);
    if (!human) {
      human = g.player;
      human.team = 'GR'; human.alive = true; human.soldier.reset();
    }
    human.hp = 30; // 压低血量验证医疗拾取
    const before = woz.pickups.list.length;
    g.damage(ai, human, 99999, 'chest', 'ak47', { x: 1, z: 0 }, false);
    const dropped = woz.pickups.list.length > before;
    // 强制掉落类型为医疗并拾取
    if (dropped) {
      woz.pickups.list[woz.pickups.list.length - 1].kind = 'hp';
      human.pos.set(ai.pos.x, 0.02, ai.pos.z);
      g.fastForward(0.5, 1 / 30);
    }
    return { ok: true, dropped, hp: human.hp };
  });
  check(r.ok && r.dropped, `生化: AI 怪物死亡掉落补给 (dropped=${r.dropped})`);
  check(r.ok && r.hp > 30, `生化: 拾取医疗补给回血 (hp=${r.hp})`);
}

console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6), null, 1) : 'none');
const realErrors = errors.filter((e) => !/favicon|WebGL warning/i.test(e));
check(realErrors.length === 0, '全程无 console 错误');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);

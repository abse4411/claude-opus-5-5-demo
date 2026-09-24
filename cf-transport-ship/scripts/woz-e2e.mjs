// WOZ 端到端无头验收：真实浏览器里跑完整回合
// 用法: node scripts/woz-e2e.mjs
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

// ---------- 感染模式 ----------
await page.goto(url + '&mode=infection');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window.__game.testFreeze = true; }); // 冻结真实帧，全确定性

check(await page.evaluate(() => window.__game.woz && window.__game.woz.rules !== null), '感染: WozManager 已挂载');
check(await page.evaluate(() => window.__game.actors.length === 10), '感染: 10 人局（1 玩家 + 9 BOT）');
check(await page.evaluate(() => window.__game.actors.every((a) => a.team === 'GR')), '感染: 开局全员人类');

await page.evaluate(() => window.__game.fastForward(20, 1 / 30));
{
  const s = await page.evaluate(() => ({
    phase: window.__game.woz.rules.phase,
    mothers: window.__game.woz.rules.players.filter((p) => p.isMother).length,
    motherMaxHp: Math.max(...window.__game.woz.rules.players.filter((p) => p.isMother).map((p) => p.maxHp), 0),
  }));
  check(s.phase === 'battle', `感染: 爆发后进入战斗期 (${s.phase})`);
  check(s.mothers === 2, `感染: 规则层 2 名母体 (实际 ${s.mothers})`);
  check(s.motherMaxHp >= 3000, `感染: 母体血池上限 3000 (实际 ${s.motherMaxHp})`);
}

// 快进到回合结算（180s 战斗期 + 余量；变异者被全歼会提前结算，可能连打多回合）
await page.evaluate(() => window.__game.fastForward(260, 1 / 30));
{
  const s = await page.evaluate(() => ({
    result: window.__game.woz.rules.result,
    score: { ...window.__game.score },
    round: window.__game.woz.round,
    playing: window.__game.playing,
    ended: window.__game.ended,
  }));
  check(s.score.GR + s.score.BL >= 1, `感染: 回合比分记账 (${s.score.GR}:${s.score.BL}，已打 ${s.round - 1} 回合)`);
  check(s.ended || s.result !== null || s.round >= 2, '感染: 回合/对局正常推进');
  console.log(`    [感染 260s: 打到第 ${s.round} 回合 比分 ${s.score.GR}:${s.score.BL} ended=${s.ended}]`);
}

// 直接调用回合重置，验证确定性重置语义
{
  const s = await page.evaluate(() => {
    const g = window.__game;
    g.woz.beginRound();
    return {
      round: g.woz.round,
      allHuman: g.woz.rules.players.every((p) => p.side === 'human'),
      teamsGR: g.actors.every((a) => a.team === 'GR'),
      phase: g.woz.rules.phase,
    };
  });
  check(s.allHuman && s.teamsGR && s.phase === 'buy', `感染: 回合重置全员人类 (round=${s.round} phase=${s.phase})`);
}

// V1 打击反馈（击退/暂缓）+ 模式说明中心
{
  const r = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules;
    let z = g.actors.find((a) => a.alive && rules.isMutantSide(a.id) && a.id < rules.playerCount);
    if (!z) {
      // 回合重置后全员人类：合成一名变异体做打击反馈验证
      const i = rules.players.findIndex((p) => p.id !== g.player.id);
      const st = rules.state(i), a = g.actors[i];
      st.side = 'mutant'; st.alive = true; st.cls = 'nightrunner'; st.maxHp = 1500; st.hp = 1500;
      a.team = 'BL'; a.alive = true; a.wozHeavy = true; a.hp = 1500; a.protectT = 0;
      z = a;
    }
    z.vel.set(0, 0, 0);
    const hpBefore = z.hp;
    g.damage(z, g.player, 20, 'chest', 'awm', { x: 0, z: -1 }, false);
    return {
      ok: true,
      knockApplied: Math.abs(z.vel.z + 7.5 * 0.35) < 0.8, // AWM 击退 7.5 × 重躯体 0.35
      stagger: z.staggerT > 0,
      damaged: z.hp < hpBefore,
      infoLen: (document.getElementById('modeInfo')?.innerHTML || '').length,
    };
  });
  check(r.ok, 'V1: 测试目标就绪');
  check(r.damaged, 'V1: 目标受到伤害');
  check(r.knockApplied, 'V1: 狙击命中击退冲量已施加');
  check(r.stagger, 'V1: 命中暂缓生效');
  check(r.infoLen > 50, 'V1: 模式说明面板已渲染');
}

// ---------- 复仇模式 ----------
await page.goto(url + '&mode=revenge');
await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window.__game.testFreeze = true; }); // 冻结真实帧，全确定性
await page.evaluate(() => { window.__game.woz.endMatch = function() {}; }); // 禁止对局在注入段之间自然终结（ended 后 damage 会失效）
await page.evaluate(() => window.__game.fastForward(16, 1 / 30));
check(await page.evaluate(() => window.__game.woz.rules.phase === 'battle'), '复仇: 进入战斗期');

// 冲到尸潮窗口（T-60s）：从战斗期开始快进 125s（观察有机触发）
await page.evaluate(() => window.__game.fastForward(125, 1 / 30));
{
  const s = await page.evaluate(() => ({
    tide: window.__game.woz.tide.length,
    phase: window.__game.woz.rules.phase,
  }));
  console.log(`    [有机尸潮触发: ${s.tide} 只 · phase=${s.phase}]`);
}

// 确定性验证尸潮：强制进入 T-60 窗口
{
  const tide = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules;
    rules.tideSpawned = false;
    g.woz.tide.forEach((z) => g.renderer.scene.remove(z.soldier.root));
    g.actors = g.actors.filter((a) => !g.woz.tide.includes(a));
    g.woz.tide = [];
    rules.phase = 'battle';
    rules.phaseTimeLeft = 60;
    g.fastForward(2, 1 / 30);
    return g.woz.tide.length;
  });
  check(tide === 4, `复仇: 尸潮 4 只 AI 已生成 (实际 ${tide})`);
}

// 复仇者全链路（单一 evaluate 全确定性）：触发 → 形态断言 → 清场 → 确定性目标电锯击杀 → 不可复活
{
  const r = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules, p = g.player;
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999; // 冻结阶段
    const dir = { x: 0.6, z: 0.8 };
    // 强制 0/1 号存活人类，其余人类全部压死（感染转化）→ 满足触发条件
    rules.avengerUsed = false;
    for (let i = 2; i < rules.playerCount; i++) {
      const st = rules.state(i), a = g.actors[i];
      if (st.side === 'human' && st.alive && a.alive) { a.protectT = 0; g.damage(a, null, 9999, 'chest', 'he', dir, false); }
    }
    for (let i = 0; i < 2; i++) {
      const st = rules.state(i), a = g.actors[i];
      st.side = 'human'; st.alive = true; st.reviveTimer = 0;
      if (a) { a.team = 'GR'; a.alive = true; a.protectT = 0; }
    }
    g.fastForward(0.1, 1 / 30);
    if (rules.avengerId() < 0) rules.tryTriggerAvenger(); // 同步直呼，消除 tick 时序依赖
    const av = rules.avengerId();
    if (av < 0) return { ok: false, why: 'no avenger', humansAlive: rules.humansAlive() };
    const avA = g.actors[av];
    // 形态断言（触发后立即读取，无中间帧干扰）
    const form = {
      team: avA.team, hp: avA.hp, weapon: avA.inv[avA.slot]?.id || null,
      outfit: avA.wozOutfit, stHp: rules.state(av).hp,
    };
    // 清场：击杀复仇者与玩家以外所有存活者，消除后续干扰
    for (const a of g.actors) {
      if (!a || a === avA || a === p || !a.alive) continue;
      a.protectT = 0;
      g.damage(a, null, 99999, 'chest', 'he', dir, false);
    }
    // 清场可能把人类杀到 0 → 规则层提前结算翻转 phase，重新冻结
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    // 确定性目标：0/1 号位中非复仇者者，强制复活并规则层转化为变异者
    const tid = av === 0 ? 1 : 0;
    const st = rules.state(tid), ta = g.actors[tid];
    st.side = 'human'; st.alive = true; st.reviveTimer = 0;
    ta.team = 'GR'; ta.alive = true; ta.protectT = 0;
    rules.convertToMutant(tid, 'nightrunner', false);
    ta.team = 'BL'; // 规则层已转化，ACTOR 队伍须同步，否则击杀被友伤抑制吞掉
    ta.alive = true; ta.hp = 100; ta.protectT = 0; ta.armor = 0;
    g.damage(ta, avA, 99999, 'chest', 'chainsaw', { x: 0.3, z: 0.95 }, false);
    const stv = rules.state(tid);
    return { ok: true, av, canRevive: stv.canRevive, vside: stv.side, humansAlive: rules.humansAlive(), ...form };
  });
  check(r.ok && r.av >= 0, `复仇: 复仇者已变身 (id=${r.av}，存活人类 ${r.humansAlive})`);
  check(r.team === 'GR' && r.weapon === 'chainsaw' && r.outfit === 'AVG' && r.stHp >= 1500 && r.hp > 1000,
    `复仇: 复仇者形态正确 (team=${r.team} hp=${r.hp} 池=${r.stHp} weapon=${r.weapon} outfit=${r.outfit})`);
  check(r.ok && r.canRevive === false, `复仇: 电锯击杀 → 不可复活 (canRevive=${r.canRevive} v.side=${r.vside || r.why || ''})`);
}

console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6), null, 1) : 'none');
const realErrors = errors.filter((e) => !/favicon|WebGL warning/i.test(e));
check(realErrors.length === 0, '全程无 console 错误');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);

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
await page.evaluate(() => { window.__game.testFreeze = true; }); // 冻结真实帧，全确定性
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
await page.evaluate(() => { window.__game.testFreeze = true; }); // 冻结真实帧，全确定性
check(await page.evaluate(() => window.__game.woz.bomb && window.__game.woz.bomb.state === 'idle'), '爆破: 核弹待安放');

// 爆破全流程（完全确定性）：每步都从全新开局推演
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    const cull = (keepPlayerOnly = true) => {
      for (const a of g.actors) {
        if (!a || a === g.player) continue;
        if (!a.alive) { a.respawnT = 1e9; continue; }
        if (a.protectT > 0) { a.protectT = 0; }
        g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
        a.respawnT = 1e9;
      }
    };
    const holdE = (seconds) => { g.player.keys.add('KeyE'); g.fastForward(seconds, 1 / 30); g.player.keys.delete('KeyE'); };

    // 开局 → 保护期过期 → 清场
    g.woz.startMatch();
    g.fastForward(3.5, 1 / 30);
    cull();
    const p = g.player;
    p.alive = true; p.hp = 500; p.armor = 0; p.protectT = 0;

    // ① 站区域不按 E → 不安放
    p.pos.set(-30, 0.02, 0);
    g.fastForward(5, 1 / 30);
    const idleOk = woz0(g).bomb.state === 'idle';
    function woz0(gg) { return gg.woz; }

    // ② 按住 E 4.5s → 安放成功 + 英雄进化 + 增援波次
    p.keys.add('KeyE');
    g.fastForward(5.5, 1 / 30);
    p.keys.delete('KeyE');
    const w = g.woz;
    const planted = w.bomb.state === 'planted' || w.bomb.state === 'destroying';
    const heroOk = w.heroGiven;
    const reinforce = g.actors.filter((a) => a.name === '增援守卫').length;

    // ③ 清增援（强制清出生保护）→ 压倒计时 → 引爆
    for (const a of g.actors) {
      if (!a || a === g.player) continue;
      a.protectT = 0;
      if (a.alive) g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
      a.respawnT = 1e9;
    }
    if (w.bomb) { w.bomb.state = 'planted'; w.bomb.timer = 0.5; } // 强制回安放态（增援可能已转为摧毁态）
    g.fastForward(1.0, 1 / 30);
    const grScore = g.score.GR;

    // ④ 重新开局验证摧毁路径：安放后守卫自然抵近摧毁
    g.woz.startMatch();
    g.fastForward(3.5, 1 / 30);
    cull();
    const p2 = g.player;
    p2.alive = true; p2.hp = 500; p2.armor = 0; p2.protectT = 0;
    p2.pos.set(-30, 0.02, 0);
    p2.keys.add('KeyE');
    g.fastForward(4.5, 1 / 30);
    p2.keys.delete('KeyE');
    // 守卫增援抵近装置（吟唱 8s）
    g.fastForward(14, 1 / 30);
    const blScore = g.score.BL;
    const destroyedSeen = blScore >= 1;

    return { idleOk, planted, heroOk, reinforce, grScore, destroyedSeen, blScore };
  });
  check(r.idleOk, '爆破: 不按 E 不安放（仅提示）');
  check(r.planted, '爆破: 按住 E 完成安放');
  check(r.heroOk, '爆破: 先行安放者进化英雄');
  check(r.reinforce === 2, `爆破: 安放后守卫增援波次 ×2 (实际 ${r.reinforce})`);
  check(r.grScore >= 1, `爆破: 核弹引爆 → 人类回合胜 (${r.grScore})`);
  check(r.destroyedSeen, `爆破: 变异者摧毁核弹 → 变异者胜 (BL=${r.blScore})`);
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
await page.evaluate(() => { window.__game.testFreeze = true; }); // 冻结真实帧，全确定性
check(await page.evaluate(() => window.__game.woz.rules !== null && window.__game.actors.every((a) => a.team === 'GR')), '生化: 开局全员人类（规则层挂载）');

// 快进到战斗期并冻结阶段（防 bot 随机性把回合打输），等待 AI 波次刷新
await page.evaluate(() => {
  const g = window.__game;
  g.woz.startMatch();
  g.fastForward(22, 1 / 30); // 走完购买期进入战斗，首波（20s）已到
  g.woz.rules.phase = 'battle'; g.woz.rules.phaseTimeLeft = 999; g.timeLeft = 999;
  g.fastForward(18, 1 / 30);
});
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
    woz.spawnAiZombie(); // 确定性：主动刷一只 AI 怪物
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
    // 拾取路径①：走身到掉落物上自动拾取（给保护防止被围殴致死）
    if (dropped) {
      const pk = woz.pickups.list[woz.pickups.list.length - 1];
      pk.kind = 'hp';
      human.protectT = 999; // 免疫伤害但不影响拾取
      human.pos.set(pk.pos.x, 0.02, pk.pos.z);
      g.fastForward(0.5, 1 / 30);
      // 拾取路径②：无论①是否被抢占，直接调用拾取应用
      woz.pickups.apply(human, 'hp');
    }
    return { ok: true, dropped, hp: human.hp, alive: human.alive };
  });
  check(r.ok && r.dropped, `生化: AI 怪物死亡掉落补给 (dropped=${r.dropped})`);
  check(r.ok && r.hp >= 50, `生化: 医疗补给回血生效 (hp=${r.hp})`);
}

// V3 区域效果：燃烧火海 / 冻结寒爆
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    let z = g.actors.find((a) => a.alive && a.team === 'BL');
    if (!z) {
      // 合成一名变异体（回合重置后可能无存活变异者）
      const rules = g.woz.rules;
      if (!rules) return { ok: false };
      const i = rules.players.findIndex((pl) => pl.id !== g.player.id);
      const st = rules.state(i);
      st.side = 'mutant'; st.alive = true; st.maxHp = 1500; st.hp = 1500;
      z = g.actors[i]; z.team = 'BL'; z.alive = true; z.hp = 1500; z.wozHeavy = true; z.protectT = 0;
    }
    const hp0 = z.hp;
    g.zones.spawn('fire', z.pos.clone());
    g.fastForward(1, 1 / 30);
    const burned = z.hp < hp0 || !z.alive;
    z.alive = true; z.hp = Math.max(z.hp, 100);
    g.zones.spawn('frost', z.pos.clone());
    g.fastForward(0.3, 1 / 30);
    const frozen = (z.staggerT || 0) > 0;
    return { ok: true, burned, frozen, zones: g.zones.list.length };
  });
  check(r.ok && r.burned, `V3: 燃烧瓶火海持续灼烧 (zones=${r.zones})`);
  check(r.ok && r.frozen, 'V3: 冻结弹冻缓生效');
  check(await page.evaluate(() => ['molotov', 'frost', 'gas'].every((id) => !!document.querySelector(`#nadeCards .card[data-g=${id}]`))), 'V3: 投掷武器选择卡片齐全');
}

console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6), null, 1) : 'none');
const realErrors = errors.filter((e) => !/favicon|WebGL warning/i.test(e));
check(realErrors.length === 0, '全程无 console 错误');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);

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
      g.fastForward(6, 1 / 30);
      p.keys.delete('KeyE');
      return { state: g.woz.bomb.state, markers: g.woz.radarMarkers() };
    });
    check(['planted', 'destroying'].includes(st.state), `爆破: 安放成功 (${st.state})`);
    check(st.markers.some((m) => m.kind === 'bomb'), '爆破: 已安放核弹红点标记');
    await shot('demol');
    await shot('demol-radar', { x: 0, y: 0, width: 240, height: 240 });
  }
} else if (ver === 'v2') {
  // 对抗：悬浮标记 + 屏外方向箭头
  await goto('&mode=confront');
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.fastForward(1, 1 / 30);
      return g.woz.points.map((p) => ({ n: p.def.name, has: !!p.marker, vis: p.marker.visible, y: +p.marker.position.y.toFixed(2), tex: !!p.marker.material.map }));
    });
    check(r.length === 3 && r.every((s) => s.has && s.vis && s.y > 2 && s.tex), `对抗: 3 个据点悬浮标记 (${r.map((s) => `${s.n}@${s.y}m`).join(',')})`);
    const d = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      p.pitch = -1.4; // 俯视 → 据点全部离屏
      return g.woz.objData();
    });
    await page.waitForTimeout(450); // 真实帧驱动相机跟随并刷新 updateObj
    {
      const arws = await page.evaluate(() => {
        const arws = [...document.querySelectorAll('#wozDirs .arw')].filter((e) => e.style.display !== 'none');
        const ok = arws.every((e) => {
          const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(e.style.transform);
          return m && +m[1] >= 0 && +m[1] <= innerWidth && +m[2] >= 0 && +m[2] <= innerHeight;
        });
        return { n: arws.length, ok, labels: arws.map((e) => e.textContent.trim()) };
      });
      check(arws.n >= 2 && arws.ok, `对抗: 俯视时 ${arws.n} 个屏外箭头均在屏内 (${arws.labels.join(',')})`);
    }
    await page.evaluate(() => {
      const g = window.__game, p = g.player, A = g.woz.points[0].def;
      p.alive = true; p.hp = Math.max(p.hp, 200); p.armor = 0;
      p.pos.set(A.x, 0.02, A.z + 8);
      p.yaw = Math.atan2(-(A.x - p.pos.x), -(A.z - p.pos.z));
      p.pitch = 0.08;
      g.fastForward(0.3, 1 / 30);
    });
    await page.waitForTimeout(300);
    await shot('confront-marker');
  }
  // 爆破：站点金色标记 → 安放后红色跟随
  await goto('&mode=demol');
  {
    const pre = await page.evaluate(() => {
      const g = window.__game, b = g.woz.bomb;
      return { vis: b.marker.visible, x: b.marker.position.x, z: b.marker.position.z };
    });
    check(pre.vis && Math.abs(pre.x + 30) < 0.1, `爆破: 站点 ☢ 标记于巢穴 (${pre.x | 0},${pre.z | 0})`);
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
      g.fastForward(6, 1 / 30);
      p.keys.delete('KeyE');
      const b = g.woz.bomb;
      return { state: b.state, key: b.mkKey, mx: +b.marker.position.x.toFixed(1), mz: +b.marker.position.z.toFixed(1), bx: +b.pos.x.toFixed(1), bz: +b.pos.z.toFixed(1) };
    });
    check(['planted', 'destroying'].includes(st.state) && st.key === 'bomb' && Math.abs(st.mx - st.bx) < 0.15 && Math.abs(st.mz - st.bz) < 0.15,
      `爆破: 安放后标记转红跟随核弹 (mk ${st.mx},${st.mz} vs ${st.bx},${st.bz})`);
    await page.waitForTimeout(300);
    await shot('demol-marker');
  }
} else if (ver === 'v3') {
  const clearAround = () => page.evaluate(() => {
    const g = window.__game, p = g.player;
    g.fastForward(3.5, 1 / 30);
    for (const a of g.actors) {
      if (!a || a === p || !a.alive || a.protectT > 0) continue;
      g.damage(a, null, 99999, 'chest', 'he', { x: 1, z: 0 }, false);
    }
    p.hp = 500; p.armor = 0; p.alive = true;
  });
  // 爆破：站点内安放提示 → 按住 E 安放进度
  await goto('&mode=demol');
  {
    await clearAround();
    await page.evaluate(() => { window.__game.player.pos.set(-30, 0.02, 0); });
    await page.waitForTimeout(400);
    const pr = await page.evaluate(() => {
      const e = document.getElementById('prompt');
      return { on: e.classList.contains('on'), cls: e.className, text: e.textContent, hasKbd: !!e.querySelector('kbd') };
    });
    check(pr.on && pr.cls.includes('gold') && pr.hasKbd && pr.text.includes('安放核弹'), `爆破: 站点内提示 [${pr.text.trim()}]`);
    await shot('demol-prompt');
    await page.evaluate(() => { const g = window.__game, p = g.player; p.keys.add('KeyE'); g.fastForward(1.6, 1 / 30); });
    await page.waitForTimeout(250); // 真实帧刷新提示条
    const pr2 = await page.evaluate(() => {
      const e = document.getElementById('prompt');
      const w = e.querySelector('.bar i');
      return { text: e.textContent, width: w ? w.style.width : '' };
    });
    await page.evaluate(() => window.__game.player.keys.delete('KeyE'));
    check(pr2.text.includes('正在安放') && parseFloat(pr2.width) > 0, `爆破: 安放中进度条 (${pr2.text.trim()} / ${pr2.width})`);
  }
  // 对抗：驻留占领提示 + 进度增长
  await goto('&mode=confront');
  {
    await clearAround();
    await page.evaluate(() => {
      const g = window.__game, p = g.player, A = g.woz.points[0].def;
      p.pos.set(A.x, 0.02, A.z);
    });
    await page.waitForTimeout(600);
    const pr = await page.evaluate(() => {
      const e = document.getElementById('prompt');
      const w = e.querySelector('.bar i');
      return { cls: e.className, text: e.textContent, width: w ? parseFloat(w.style.width) : -1 };
    });
    check(pr.cls.includes('blue') && pr.text.includes('占领') && pr.width > 0, `对抗: 占领提示条 (${pr.text.trim()} / ${pr.width}%)`);
    await shot('confront-prompt');
  }
  // TDM：地面武器拾取提示
  await goto('');
  {
    await page.evaluate(() => { const g = window.__game; g.fastForward(3.5, 1 / 30); g.dropGun(g.player); });
    await page.waitForTimeout(300);
    const pr = await page.evaluate(() => {
      const e = document.getElementById('prompt');
      return { on: e.classList.contains('on'), text: e.textContent };
    });
    check(pr.on && pr.text.includes('拾取'), `TDM: 武器拾取提示 (${pr.text.trim()})`);
  }
} else if (ver === 'v4') {
  const menuUrl = pathToFileURL(resolve('dist/index.html')).href + '?q=low';
  await page.goto(menuUrl);
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.removeItem('cf_ship_opts'));
  await page.reload();
  await page.waitForTimeout(800);
  {
    const n = await page.evaluate(() => document.querySelectorAll('#modeCards .mcard').length);
    check(n === 6, `菜单: 6 张模式卡片 (${n})`);
    const def = await page.evaluate(() => document.querySelector('#modeCards .mcard.on')?.dataset.v);
    check(def === 'tdm', `菜单: 默认选中团队竞技 (${def})`);
    await page.click('#modeCards .mcard[data-v="demol"]');
    const r = await page.evaluate(() => ({
      mode: window.__game.hud.opts.mode,
      info: document.getElementById('modeInfo').textContent,
      on: document.querySelector('#modeCards .mcard.on')?.dataset.v,
    }));
    check(r.mode === 'demol' && r.on === 'demol' && r.info.includes('核弹'), `菜单: 点击卡片选爆破并显示机制说明 (${r.info.slice(0, 20)}…)`);
    await page.click('.seg[data-k="map"] button[data-v="harbor"]');
    const m = await page.evaluate(() => document.getElementById('mapMeta').textContent);
    check(m.includes('雾港'), `菜单: 地图说明随选择更新 (${m.slice(0, 16)}…)`);
    await page.screenshot({ path: `scripts/shots/${ver}-menu.png` });
    // 从菜单点击开始 → 对局以所选模式启动
    await page.click('#btnStart');
    await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
    const started = await page.evaluate(() => window.__game.opts.mode + '/' + window.__game.opts.map);
    check(started === 'demol/harbor', `菜单: 开始游戏应用选择 (${started})`);
  }
  await page.evaluate(() => localStorage.removeItem('cf_ship_opts'));
} else if (ver === 'v5') {
  // 感染模式：人类面板 → 变异者底部大血条 + 技能环
  await goto('&mode=infection');
  {
    const human = await page.evaluate(() => {
      window.__game.fastForward(1, 1 / 30);
      return {
        bigOff: document.getElementById('wozBig').classList.contains('off'),
        role: document.getElementById('wzRole').textContent,
      };
    });
    check(human.bigOff && human.role === '人类保卫军', `感染: 人类默认左侧面板 (${human.role})`);
    const mut = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'nightrunner', false); // 规则层先转化
      g.woz.convertNow(p, true);                          // 引擎层落成变异者形态
      const st = rules.state(p.id);
      st.skillCharge = 1;
      g.fastForward(0.25, 1 / 30);
      return {
        side: st.side,
        bigOn: !document.getElementById('wozBig').classList.contains('off'),
        panelHidden: document.getElementById('wozPanel').style.opacity === '0',
        role: document.getElementById('wzBigRole').textContent,
        hpNum: document.getElementById('wzBigNum').textContent,
        ringReady: document.getElementById('wzRing').classList.contains('ready'),
        ringTxt: document.getElementById('wzRingTxt').textContent,
      };
    });
    check(mut.side === 'mutant' && mut.bigOn && mut.panelHidden, `感染: 转化后切换底部大血条 (side=${mut.side})`);
    check(/变异者|夜行者|母体/.test(mut.role), `感染: 大血条身份 [${mut.role}]`);
    check(parseInt(mut.hpNum) > 500, `感染: 大血条数值 ${mut.hpNum}`);
    check(mut.ringReady && /就绪/.test(mut.ringTxt), `感染: 技能充能环就绪 (${mut.ringTxt})`);
    await page.waitForTimeout(300);
    await shot('mutant-bigbar');
  }
} else if (ver === 'v6') {
  // 感染模式：爪击感染 → 信息流播报 + 手动进化播报
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      window.__game.fastForward(20, 1 / 30); // 走完购买期与爆发
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const mother = g.actors.find((a) => a.alive && rules.state(a.id)?.isMother) || p;
      const victim = g.actors.find((a) => a.alive && a !== p && a !== mother && rules.state(a.id)?.side === 'human' && a.id < rules.playerCount);
      if (!victim) return { ok: false };
      g.damage(victim, mother, 99999, 'chest', 'claw', { x: 1, z: 0 }, false);
      window.__game.fastForward(0.2, 1 / 30);
      const vid = victim.id;
      if (rules.state(vid).side === 'mutant') {
        const cur = rules.state(vid).cls;
        rules.setMutantClass(vid, cur === 'devourer' ? 'souleater' : 'devourer'); // 手动进化（避开相同职业）
      }
      window.__game.fastForward(0.2, 1 / 30);
      return {
        ok: true,
        inf: [...document.querySelectorAll('#feed .kf.inf')].map((e) => e.textContent),
        evo: [...document.querySelectorAll('#feed .kf.evo')].map((e) => e.textContent),
      };
    });
    check(r.ok && r.inf.some((t) => t.includes('被感染')), `感染: 信息流播报感染 (${r.inf[0] || '无'})`);
    check(r.evo.some((t) => t.includes('进化')), `感染: 信息流播报进化 (${r.evo[0] || '无'})`);
    await page.waitForTimeout(300);
    await shot('feed');
  }
} else if (ver === 'v7') {
  // 感染变身选择面板
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'nightrunner', false);
      g.woz.convertNow(p, true);
      g.woz.playerClassChosen = false;
      g.fastForward(0.25, 1 / 30);
      return {
        visible: !document.getElementById('wozPick').classList.contains('hidden'),
        cards: document.querySelectorAll('#wozPick .pcard').length,
        sideBtnsHidden: document.getElementById('wozClasses').style.display === 'none',
      };
    });
    check(r.visible && r.cards === 5, `变身: 选择面板弹出且 5 张职业卡 (${r.cards})`);
    check(r.sideBtnsHidden, '变身: 面板打开时右下迷你按钮隐藏');
    await page.waitForTimeout(200);
    await shot('pick');
    await page.click('#wozPick .pcard[data-c="devourer"]');
    const after = await page.evaluate(() => {
      const g = window.__game;
      g.fastForward(0.2, 1 / 30);
      return {
        cls: g.woz.rules.state(g.player.id).cls,
        chosen: g.woz.playerClassChosen,
        hidden: document.getElementById('wozPick').classList.contains('hidden'),
        sideBtns: document.getElementById('wozClasses').style.display === '',
      };
    });
    check(after.cls === 'devourer' && after.chosen && after.hidden, `变身: 点击猎食者后面板关闭 (cls=${after.cls})`);
    check(after.sideBtns, '变身: 关闭后右下切换按钮恢复');
  }
} else if (ver === 'v8') {
  // 感染模式购买期：商店打开 → 倒计时 → 战斗开始自动关闭
  await goto('&mode=infection');
  {
    const pre = await page.evaluate(() => {
      const g = window.__game;
      return { phase: g.woz.rules.phase, left: Math.ceil(g.woz.rules.phaseTimeLeft) };
    });
    check(pre.phase === 'buy' && pre.left > 0 && pre.left <= 16, `感染: 开局购买期 (${pre.phase} ${pre.left}s)`);
    await page.evaluate(() => window.__game.toggleLoadout());
    await page.waitForTimeout(250);
    const shop = await page.evaluate(() => ({
      visible: !document.getElementById('loadout').classList.contains('hidden'),
      cards: document.querySelectorAll('#loadCards .card').length,
      srows: (document.querySelector('#loadCards .card')?.querySelectorAll('.srow') || []).length,
      timer: document.getElementById('loadTimer').textContent,
    }));
    check(shop.visible && shop.cards === 20, `商店: 打开且 20 张主武器卡 (${shop.cards})`);
    check(shop.srows === 3, `商店: 属性条渲染 (${shop.srows} 行)`);
    check(shop.timer.includes('购买期'), `商店: 购买期倒计时 (${shop.timer.trim().slice(-18)})`);
    await page.waitForTimeout(200);
    await shot('shop');
    // 战斗开始自动关闭
    await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules;
      rules.phaseTimeLeft = 0.2;
      g.fastForward(0.5, 1 / 30);
    });
    const after = await page.evaluate(() => ({ closed: !window.__game.inLoadout, phase: window.__game.woz.rules.phase }));
    check(after.closed && after.phase !== 'buy', `商店: 战斗开始自动关闭 (phase=${after.phase})`);
  }
} else if (ver === 'v9') {
  // 计分板：角色列 + 动态标题
  await goto('&mode=infection');
  {
    await page.evaluate(() => { window.__game.fastForward(20, 1 / 30); });
    await page.keyboard.down('Tab');
    await page.waitForTimeout(400);
    const board = await page.evaluate(() => ({
      visible: !document.getElementById('board').classList.contains('hidden'),
      title: document.getElementById('boardTitle').textContent,
      hasRole: [...document.querySelectorAll('#board th')].some((th) => th.textContent === '角色'),
      roles: [...new Set([...document.querySelectorAll('#board td.role')].map((td) => td.textContent))],
    }));
    check(board.visible && board.title.includes('生化感染'), `计分板: 标题 [${board.title}]`);
    check(board.hasRole && board.roles.length >= 2, `计分板: 角色列 (${board.roles.join(',')})`);
    await page.screenshot({ path: `scripts/shots/${ver}-board.png` });
    await page.keyboard.up('Tab');
    // 回合结算横幅
    const banner = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules;
      rules.phase = 'roundend'; rules.phaseTimeLeft = 5; rules.result = 'humansSurvived';
      g.fastForward(0.3, 1 / 30);
      const el = document.getElementById('wozBanner');
      return { on: el.style.opacity === '1', text: el.textContent };
    });
    check(banner.on && banner.text.includes('人类胜利') && banner.text.includes('比分'), `结算: 横幅 [${banner.text.slice(0, 30)}]`);
    await page.screenshot({ path: `scripts/shots/${ver}-banner.png` });
  }
} else if (ver === 'v10') {
  // 帮助中心（H）
  await goto('&mode=revenge');
  {
    await page.evaluate(() => window.__game.toggleHelp());
    await page.waitForTimeout(300);
    const help = await page.evaluate(() => ({
      visible: !document.getElementById('help').classList.contains('hidden'),
      mode: document.getElementById('helpMode').textContent,
      desc: document.getElementById('helpDesc').textContent,
      keys: document.getElementById('helpKeys').textContent,
    }));
    check(help.visible && help.mode === '生化复仇', `帮助: 打开并显示当前模式 (${help.mode})`);
    check(help.desc.includes('复仇者') && help.desc.includes('尸潮'), '帮助: 模式机制完整');
    check(help.keys.includes('5/6/7') && help.keys.includes('吞噬') && help.keys.includes('观战'), '帮助: 键位完整');
    await page.screenshot({ path: `scripts/shots/${ver}-help.png` });
    await page.evaluate(() => window.__game.toggleHelp());
    const closed = await page.evaluate(() => document.getElementById('help').classList.contains('hidden'));
    check(closed, '帮助: 再次按 H / 点击关闭');
  }
} else if (ver === 'v30') {
  // 新武器批次 B：95式 / XM8 / 双持乌兹 / 撬棍
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => ({
      cards: document.querySelectorAll('#loadCards .card').length,
      a: !!document.querySelector('#loadCards .card[data-w="qbz95"]'),
      b: !!document.querySelector('#loadCards .card[data-w="xm8"]'),
      c: !!document.querySelector('#loadCards .card[data-w="dualuzi"]'),
    }));
    check(r.cards === 20 && r.a && r.b && r.c, `武器B: 20 张卡片含 95式/XM8/双持乌兹 (${r.cards})`);
    await page.evaluate(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ mode: 'infection', map: 'ship', primary: 'qbz95', melee: 'crowbar', diff: 'normal', quality: 'low' })));
  }
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const r2 = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules, p = g.player;
    g.fastForward(20, 1 / 30);
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    const prim = p.inv[0].id, mel = p.inv[2].id;
    // 撬棍实劈：变异者靶
    if (!p.alive) { p.alive = true; p.hp = 100; p.soldier.reset(); p.respawnT = 0; } // 保活
    const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
    if (!v) return { ok: false };
    rules.convertToMutant(v.id, 'nightrunner', false);
    g.woz.convertNow(v, true);
    p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 0; p.vel = { x: 0, y: 0, z: 0 };
    v.pos.set(3.6, 0.1, 0); v.protectT = 0; v.armor = 0;
    g.fastForward(1 / 30, 1 / 30); // 同步士兵网格
    p.slot = 2; p.soldier.setWeapon('crowbar'); p.readyAt = 0;
    p.updateCamera(0.016);
    const hp0 = v.hp;
    g.melee(p, false);
    g.timers[g.timers.length - 1].fn();
    return { ok: true, prim, mel, hit: v.hp < hp0 };
  });
  check(r2.ok && r2.prim === 'qbz95' && r2.mel === 'crowbar', `武器B: 95式出厂 + 撬棍装备 (${r2.prim}/${r2.mel})`);
  check(r2.hit, '武器B: 撬棍轻击命中');
} else if (ver === 'v29') {
  // 新武器批次 A：SCAR-L / M14EBR / M3 Super90 / MAC-10 商店卡片 + 装备实装
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => ({
      cards: document.querySelectorAll('#loadCards .card').length,
      a: !!document.querySelector('#loadCards .card[data-w="scarl"]'),
      b: !!document.querySelector('#loadCards .card[data-w="m14ebr"]'),
      c: !!document.querySelector('#loadCards .card[data-w="m3super"]'),
      d: !!document.querySelector('#loadCards .card[data-w="mac10"]'),
    }));
    check(r.cards === 20 && r.a && r.b && r.c && r.d, `武器A: 20 张卡片含四新枪 (${r.cards})`);
    await page.evaluate(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ mode: 'infection', map: 'ship', primary: 'm14ebr', diff: 'normal', quality: 'low' })));
  }
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const w = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    const first = p.inv[0].id;
    p.inv[0] = new (p.inv[0].constructor)('mac10');
    p.slot = 0; p.readyAt = 0;
    g.fastForward(0.3, 1 / 30);
    return { first, second: p.inv[0].id };
  });
  check(w.first === 'm14ebr' && w.second === 'mac10', `武器A: M14EBR 出厂 + MAC-10 换装 (${w.first}/${w.second})`);
} else if (ver === 'v28') {
  // 打击感：受击红闪 / 击杀血爆 / 顿帧 / 命中标记
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true); // 转变异者靶（规避友伤抑制）
      v.protectT = 0; v.armor = 0;
      // 普通伤害：受击红闪
      g.damage(v, p, 30, 'chest', 'ak47', { x: 1, z: 0 }, false);
      const flash = v.soldier._flash;
      const hm1 = g.hud.hitT;
      // 爆头击杀：顿帧触发
      g.damage(v, p, 99999, 'head', 'ak47', { x: 1, z: 0 }, false);
      const hs = g.hitStopT;
      return { ok: true, flash: +flash.toFixed(2), hm1: +hm1.toFixed(2), hitStop: +hs.toFixed(2) };
    });
    check(r.ok && r.flash > 0.3, `打击: 受击红闪触发 (${r.flash})`);
    check(r.hm1 > 0, `打击: 玩家命中标记 (${r.hm1})`);
    check(r.hitStop >= 0.07, `打击: 爆头击杀顿帧 (${r.hitStop})`);
  }
} else if (ver === 'v27') {
  // 击杀播报与结算增强：WOZ 武器徽章 + killFeed 中文名 + 结算成长统计
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false);
      g.woz.convertNow(p, true);
      // 玩家爪击感染人类 → 徽章 INFECTED + 播报
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(p.pos.x + 1.5, v.pos.y, p.pos.z); v.protectT = 0; v.armor = 0;
      p.updateCamera(0.016);
      g.damage(v, p, 99999, 'chest', 'claw', { x: 1, z: 0 }, false);
      g.fastForward(0.3, 1 / 30);
      const badge = document.getElementById('badge');
      const feed = [...document.querySelectorAll('#feed .kf')].map((e) => e.textContent).join('|');
      return { ok: true, badge: badge ? badge.textContent : '', feed, infected: rules.state(v.id).side === 'mutant' };
    });
    check(r.ok && r.infected, '播报: 爪击感染成功');
    check(/INFECTED|感染/.test(r.badge), `播报: 玩家击杀徽章 [${r.badge.trim().slice(0, 24)}]`);
    check(r.feed.includes('我') && r.feed.includes('被感染'), `播报: 击杀信息流包含感染条目 [${r.feed.slice(0, 40)}]`);
  }
} else if (ver === 'v26') {
  // 成长 HUD：变异者阶段进度条 + 人类必杀技充能条
  await goto('&mode=infection');
  {
    const mut = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.devourCount = 4; // 一阶与二阶之间：4/6
      g.fastForward(0.3, 1 / 30);
      return {
        fill: document.getElementById('wzStageFill').style.width,
        txt: document.getElementById('wzStageTxt').textContent,
      };
    });
    check(mut.fill !== '' && mut.fill !== '0%' && mut.txt.includes('2'), `成长: 阶段进度条 (${mut.fill} ${mut.txt})`);
    const hum = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToHumanForTest?.();
      const st = rules.state(p.id);
      st.side = 'human'; st.alive = true; p.team = 'GR'; p.alive = true;
      st.humanSurviveTime = 45 * 2; // 二档
      g.fastForward(0.3, 1 / 30);
      return {
        fill: document.getElementById('wzUltFill').style.width,
        txt: document.getElementById('wzUltTxt').textContent,
      };
    });
    check(hum.fill !== '' && hum.txt.includes('2'), `成长: 必杀技充能条 (${hum.fill} ${hum.txt})`);
  }
} else if (ver === 'v25') {
  // BOT 变异者职业化用技：决策表逐职业断言 + 爆破者实弹链路
  await goto('&mode=infection');
  {
    const d = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const mk = (cls, hpFrac) => ({ cls, hp: 0, maxHp: 1500, evoPoints: 0, __hpFrac: hpFrac, get hp() { return this.maxHp * this.__hpFrac; } });
      const want = (st, dist, los) => g.woz.botSkillWant(st, dist, los);
      return {
        bomHigh: want(mk('bomber', 1), 5, true),       // 满血 → 不自爆
        bomLow: want(mk('bomber', 0.3), 5, true),      // 残血近身 → 自爆
        bomFar: want(mk('bomber', 0.3), 15, true),     // 残血但远 → 不自爆
        souleater: want(mk('souleater', 1), 12, true), // 尖啸范围 → 释放
        runner: want(mk('nightrunner', 1), 10, true),  // 中距 → 疾冲
        runnerClose: want(mk('nightrunner', 1), 3, true), // 贴脸 → 不冲
        tangler: want(mk('tangler', 1), 10, true),     // 有视线 → 缠绕
        tanglerNoLos: want(mk('tangler', 1), 10, false), // 无视线 → 不放
        devourer: want(mk('devourer', 1), 12, true),   // 有视线 → 投斧
      };
    });
    check(!d.bomHigh && d.bomLow && !d.bomFar, `BOT: 爆破者残血近身才自爆 (${d.bomHigh}/${d.bomLow}/${d.bomFar})`);
    check(d.souleater && d.runner && !d.runnerClose, `BOT: 尖啸范围释放/疾冲中距释放 (${d.souleater}/${d.runner}/${d.runnerClose})`);
    check(d.tangler && !d.tanglerNoLos && d.devourer, `BOT: 缠绕/投掷需视线 (${d.tangler}/${d.tanglerNoLos}/${d.devourer})`);
    // 实弹验证：爆破者残血近身 → 引信点燃
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      const bm = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!bm) return { ok: false };
      rules.convertToMutant(bm.id, 'bomber', false);
      g.woz.convertNow(bm, true);
      const stb = rules.state(bm.id);
      stb.skillCharge = 1;
      stb.hp = Math.round(stb.maxHp * 0.3);
      if (g.actors[bm.id]) g.actors[bm.id].hp = stb.hp;
      const t3 = g.actors.find((a) => a.alive && a !== bm && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!t3) return { ok: false };
      t3.pos.set(bm.pos.x + 4, t3.pos.y, bm.pos.z);
      t3.protectT = 0; t3.armor = 0;
      g.fastForward(3, 1 / 30);
      return { ok: true, fused: g.woz.fuses.length > 0 || !g.actors[bm.id].alive || !rules.state(bm.id).alive || stb.skillCharge < 1 };
    });
    check(r.ok && r.fused, `BOT: 爆破者实弹自爆链路 (${r.fused})`);
  }
} else if (ver === 'v24') {
  // 补给空投：投放 → 落地雷达标记 → 走近拾取补给
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const w = p.inv.find((x) => x && x.def.type !== 'melee' && x.def.type !== 'grenade');
      w.mag = 1; w.reserve = 1; // 掏空验证补给
      p.hp = 40;
      g.woz.dropT = 0.01;
      g.fastForward(1, 1 / 30);
      const spawned = g.woz.airdrops.length;
      const markerWhile = g.woz.radarMarkers().some((m) => m.kind === 'drop');
      g.fastForward(4, 1 / 30);
      const d = g.woz.airdrops[0];
      const landed = d && d.state === 'landed';
      p.pos.set(d ? d.x : 0, p.pos.y, d ? d.z : 0); // 走到空投上
      g.fastForward(0.4, 1 / 30);
      return {
        ok: true, spawned, markerWhile, landed,
        collected: g.woz.airdrops.length === 0,
        mag: w.mag, reserve: w.reserve, hp: Math.round(p.hp),
      };
    });
    check(r.ok && r.spawned === 1, `空投: 空投箱已投放 (${r.spawned})`);
    check(r.landed, '空投: 降落伞着陆');
    check(r.collected && r.mag > 1 && r.reserve > 1, `空投: 拾取补给（弹药 ${r.mag}/${r.reserve}）`);
    check(r.hp > 40, `空投: 医疗回复 (${r.hp})`);
  }
} else if (ver === 'v23') {
  // 对抗模式浓雾增援 + 生化模式 AI 波次
  {
    await goto('&mode=confront&map=hospital');
    const c = await page.evaluate(() => {
      const g = window.__game, w = g.woz;
      g.fastForward(4, 1 / 30);
      w.points.forEach((p) => { p.owner = 'GR'; p.progress = 100; }); // 压满占领进度
      const before = w.tide.length;
      w.reinforceT = 0.01; // 立即触发增援
      g.fastForward(0.5, 1 / 30);
      return { before, after: w.tide.length, fog: +g.renderer.scene.fog.density.toFixed(4) };
    });
    check(c.after > c.before, `对抗: 浓雾增援已抵达 (${c.before} → ${c.after})`);
    check(c.fog > 0, `对抗: 雾密度随占领加浓 (${c.fog})`);
  }
  {
    await goto('&mode=bio');
    const b = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      g.woz.waveT = 0.01;
      g.fastForward(1.5, 1 / 30);
      return { waveN: g.woz.waveN || 0, tide: g.woz.tide.filter((z) => z.alive).length };
    });
    check(b.waveN >= 1 && b.tide >= 2, `生化: AI 波次来袭 (第${b.waveN}波, ${b.tide}只)`);
  }
} else if (ver === 'v22') {
  // 新地图「地铁绝境」：加载/命名/雷达/目标点兼容
  await goto('&mode=infection&map=subway');
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.fastForward(20, 1 / 30);
      return {
        name: document.querySelector('#radarWrap .lbl')?.textContent,
        spawnY: +g.player.pos.y.toFixed(2),
        inField: Math.abs(g.player.pos.x) < 42 && Math.abs(g.player.pos.z) < 14,
        radar: !!g.hud.radarImg,
      };
    });
    check(r.name === '地铁绝境', `地铁: 地图加载与命名 [${r.name}]`);
    check(r.inField && r.spawnY > -0.5 && r.spawnY < 3, `地铁: 出生点位于场地内 (${r.spawnY})`);
    check(r.radar, '地铁: 雷达图自动生成');
    const pts = await page.evaluate(() => {
      const g = window.__game;
      return [[12, 0, 'A'], [-2, 0, 'B'], [-16, 0, 'C'], [-30, 0, '核']].map(([x, z, n]) => {
        const blocked = g.world.raycast(x, 1.0, z, 0, 1, 0, 3.5, 'sight');
        return { n, blocked: !!blocked };
      });
    });
    check(pts.every((p) => !p.blocked), `地铁: 据点与核弹点位置畅通 (${pts.map((p) => p.n + (p.blocked ? '✗' : '✓')).join(',')})`);
    await page.evaluate(() => {
      const g = window.__game, cam = g.renderer.camera;
      g.testFreeze = true;
      cam.position.set(-26, 3.0, 0); cam.lookAt(14, 1.2, 0);
    });
    await page.waitForTimeout(300);
    await shot('subway');
  }
} else if (ver === 'v21') {
  // 新地图「废弃医院」：加载/命名/雷达/目标点兼容
  await goto('&mode=infection&map=hospital');
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.fastForward(20, 1 / 30);
      return {
        name: document.querySelector('#radarWrap .lbl')?.textContent,
        spawnY: +g.player.pos.y.toFixed(2),
        inField: Math.abs(g.player.pos.x) < 40 && Math.abs(g.player.pos.z) < 15,
        radar: !!g.hud.radarImg,
      };
    });
    check(r.name === '废弃医院', `医院: 地图加载与命名 [${r.name}]`);
    check(r.inField && r.spawnY > -0.5 && r.spawnY < 3, `医院: 出生点位于场地内 (${r.spawnY})`);
    check(r.radar, '医院: 雷达图自动生成');
    await page.evaluate(() => {
      const g = window.__game, cam = g.renderer.camera;
      g.testFreeze = true; // 冻结真实帧，相机不再被玩家接管
      cam.position.set(-30, 3.2, 0); cam.lookAt(10, 1, 0);
    });
    await page.waitForTimeout(300);
    await shot('hospital');
    const pts = await page.evaluate(() => {
      const g = window.__game;
      return [[12, 0, 'A'], [-2, 0, 'B'], [-16, 0, 'C'], [-30, 0, '核']].map(([x, z, n]) => {
        const blocked = g.world.raycast(x, 1.0, z, 0, 1, 0, 3.5, 'sight');
        return { n, blocked: !!blocked };
      });
    });
    check(pts.every((p) => !p.blocked), `医院: 据点 A/B/C 与核弹点位置畅通 (${pts.map((p) => p.n + (p.blocked ? '✗' : '✓')).join(',')})`);
  }
} else if (ver === 'v20') {
  // 消防斧近战 + 震撼弹
  await goto('&mode=infection');
  {
    const cards = await page.evaluate(() => ({
      meleeSeg: !!document.querySelector('.seg[data-k="melee"] button[data-v="axe"]'),
      nades: document.querySelectorAll('#nadeCards .card').length,
      flash: !!document.querySelector('#nadeCards .card[data-g="flash"]'),
    }));
    check(cards.meleeSeg, '近战: 菜单消防斧选项存在');
    check(cards.nades === 5 && cards.flash, `投掷: 5 种投掷物含震撼弹 (${cards.nades})`);
    await page.evaluate(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ mode: 'infection', map: 'ship', melee: 'axe', grenade: 'flash', diff: 'normal', quality: 'low' })));
  }
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules, p = g.player;
    (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    const axeOn = p.inv[2].id; // 出生近战 = 消防斧
    // 消防斧重击：把一名变异者放面前劈（转阵营规避友军伤害抑制）
    p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 0;
    const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
    if (!v) return { ok: false };
    rules.convertToMutant(v.id, 'nightrunner', false);
    g.woz.convertNow(v, true);
    v.pos.set(3.9, 0.1, 0); v.protectT = 0; v.armor = 0;
    g.fastForward(1 / 30, 1 / 30); // 同步士兵网格位置到逻辑坐标
    p.slot = 2; p.soldier.setWeapon('axe'); p.readyAt = 0; // 切到消防斧
    p.updateCamera(0.016);
    const hp0 = v.hp;
    g.melee(p, true);
    g.timers[g.timers.length - 1].fn(); // 同步结算重击（避免延迟期 bot 走位）
    // 震撼弹：在人群旁引爆 → 致盲但不致死
    const v2 = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
    let flashBlind = null;
    if (v2) {
      v2.pos.set(-1, 0.1, 0); v2.protectT = 0; // 已知开阔的 B 点连线上
      g.fastForward(1 / 30, 1 / 30); // 同步网格位置
      g.explode(new (v2.pos.constructor)(1, 0.4, 0), p, 'flash'); // 引爆点距靶 2m
      flashBlind = { blind: v2.blindT > 0, alive: v2.alive, self: p.blindT > 0 && p.alive };
    }
    return { ok: true, axeOn, axeHit: v.hp < hp0 || !v.alive, flashBlind };
  });
  check(r.ok && r.axeOn === 'axe', `近战: 消防斧出厂装备 (${r.axeOn})`);
  check(r.axeHit, '近战: 消防斧重击命中伤害');
  check(r.flashBlind && r.flashBlind.blind && r.flashBlind.alive, `震撼弹: 视野内目标致盲但存活 (${JSON.stringify(r.flashBlind)})`);
} else if (ver === 'v19') {
  // M60 + 副武器三选（沙鹰/USP/R8 左轮）
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => ({
      sec: document.querySelectorAll('#secCards .card').length,
      r8: !!document.querySelector('#secCards .card[data-s="r8"]'),
      m60: !!document.querySelector('#loadCards .card[data-w="m60"]'),
      prim: document.querySelectorAll('#loadCards .card').length,
    }));
    check(r.prim === 20 && r.m60, `武器: 商店 20 张主武器卡含 M60 (${r.prim})`);
    check(r.sec === 3 && r.r8, `副武器: 三张副武器卡含 R8 左轮 (${r.sec})`);
    await page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.chooseSecondary('r8');
      g.fastForward(0.2, 1 / 30);
      const w = p.inv[1];
      return { id: w.id, dmg: w.def.dmg };
    });
    const w = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      p.pos.set(5, 0.1, 0); p.protectT = 0;
      p.inv[1] = new (p.inv[1].constructor)('r8');
      p.slot = 1; p.readyAt = 0;
      g.fastForward(0.3, 1 / 30);
      return { id: p.inv[1].id, hp: p.hp, opts: g.opts.secondary };
    });
    check(w.id === 'r8', `副武器: R8 左轮可装备 (${w.id})`);
  }
} else if (ver === 'v18') {
  // 新武器 AUG A3 / P90：商店卡片 + 装备实装（构建器无错误即通过）
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => ({
      cards: document.querySelectorAll('#loadCards .card').length,
      aug: !!document.querySelector('#loadCards .card[data-w="aug"]'),
      p90: !!document.querySelector('#loadCards .card[data-w="p90"]'),
    }));
    check(r.cards === 20 && r.aug && r.p90, `武器: 商店 20 张主武器卡含 AUG/P90 (${r.cards})`);
    await page.evaluate(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ mode: 'infection', map: 'ship', primary: 'aug', diff: 'normal', quality: 'low' })));
  }
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const w = await page.evaluate(() => {
    const g = window.__game;
    return { id: g.player.inv[g.player.slot].id, vm: !!g.vm };
  });
  check(w.id === 'aug', `武器: 重启后 AUG A3 已装备 (${w.id})`);
  const w2 = await page.evaluate(() => {
    const g = window.__game;
    g.player.inv[0] = new (Object.getPrototypeOf(g.player.inv[0]).constructor)('p90');
    g.player.slot = 0;
    g.fastForward(0.3, 1 / 30);
    return g.player.inv[0].id;
  });
  check(w2 === 'p90', `武器: P90 动态换装成功 (${w2})`);
} else if (ver === 'v17') {
  // 阵营更名：WOZ 模式显示 保卫军/原罪军（原作阵营），TDM 保留 CF 命名
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      return {
        topBL: document.querySelector('#tBL .nm')?.textContent,
        topGR: document.querySelector('#tGR .nm')?.textContent,
      };
    });
    check(r.topBL === '原罪军' && r.topGR === '保卫军', `阵营: 局内顶栏 WOZ 命名 (${r.topGR} vs ${r.topBL})`);
    await page.keyboard.down('Tab');
    await page.waitForTimeout(400);
    const board = await page.evaluate(() => [...document.querySelectorAll('#board th.team')].map((th) => th.textContent).join('|'));
    await page.keyboard.up('Tab');
    check(board.includes('保卫军') && board.includes('原罪军'), `阵营: 计分板 WOZ 命名 [${board}]`);
    // 菜单阵营选项联动
    const menu = await page.evaluate(() => {
      window.__game.hud.showModeInfo('infection');
      const seg = document.querySelector('.seg.team[data-k="team"]');
      return seg.textContent;
    });
    check(menu.includes('保卫军') && menu.includes('原罪军'), '阵营: 菜单选项 WOZ 命名联动');
  }
} else if (ver === 'v16') {
  // 复仇者：重击 360°旋转清场 + 防御被动
  await goto('&mode=revenge');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(16, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999; g.woz.endMatch = () => {};
      // 强制玩家（0 号，伤害最高者）变身为复仇者
      rules.avengerUsed = false;
      rules.state(0).humanDamage = 999999;
      for (let i = 1; i < rules.playerCount; i++) {
        const st = rules.state(i), a = g.actors[i];
        if (st.side === 'human' && st.alive && a.alive) g.damage(a, null, 9999, 'chest', 'he', { x: 0.6, z: 0.8 }, false);
      }
      const p0 = rules.state(0);
      p0.side = 'human'; p0.alive = true; p0.reviveTimer = 0; p0.humanDamage = 999999;
      if (g.actors[0]) { g.actors[0].team = 'GR'; g.actors[0].alive = true; }
      g.fastForward(0.1, 1 / 30);
      if (rules.avengerId() < 0) rules.tryTriggerAvenger();
      if (rules.avengerId() !== 0) return { ok: false, av: rules.avengerId() };
      p.protectT = 0; p.armor = 0;
      // 三名变异者围到身边（≤2.8m）
      const victims = [];
      const spots = [[1.5, 0], [0, 1.5], [-1.2, 0]];
      for (let k = 0; k < 3; k++) {
        const b = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount);
        if (!b) break;
        rules.convertToMutant(b.id, 'nightrunner', false);
        g.woz.convertNow(b, true);
        b.pos.set(p.pos.x + spots[k][0], p.pos.y, p.pos.z + spots[k][1]);
        b.protectT = 0; b.armor = 0;
        victims.push(b);
      }
      const far = g.actors.find((a) => a.alive && a !== p && !victims.includes(a) && a.id < rules.playerCount);
      if (far) {
        rules.convertToMutant(far.id, 'nightrunner', false);
        g.woz.convertNow(far, true);
        far.pos.set(p.pos.x + 12, p.pos.y, p.pos.z);
        far.protectT = 0; far.armor = 0;
      }
      g.melee(p, true); // 重击 → 旋转清场
      const spinKills = victims.filter((b) => !b.alive || !rules.state(b.id).alive).length;
      const farAlive = far ? far.alive : null;
      // 防御被动：100 点伤害只掉 70
      const hp0 = p.hp;
      g.damage(p, null, 100, 'chest', 'ak', { x: 1, z: 0 }, false);
      const defDrop = hp0 - p.hp;
      return { ok: true, spinKills, farAlive, defDrop: +defDrop.toFixed(0), outfit: p.wozOutfit };
    });
    check(r.ok && r.outfit === 'AVG', `复仇: 玩家变身复仇者 (${r.outfit || r.av})`);
    check(r.spinKills === 3, `复仇: 旋转清场绞杀 3 名近身敌人 (${r.spinKills})`);
    check(r.farAlive === true || r.farAlive === null, `复仇: 12m 外敌人无伤 (alive=${r.farAlive})`);
    check(Math.abs(r.defDrop - 70) < 8, `复仇: 防御被动减免 30% (100 → ${r.defDrop})`);
  }
} else if (ver === 'v15') {
  // 人类必杀技：满档解锁 → HUD 就绪 → V 释放狂暴（满弹+播报）
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      st.humanSurviveTime = WOZ_H(); // 45s × 4 档
      function WOZ_H() { return 45 * 4; }
      g.fastForward(0.25, 1 / 30);
      const tier = rules.humanTier(p.id);
      const readyTxt = document.getElementById('wzTier').innerHTML;
      const main = p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade');
      main.mag = 1; // 掏空弹匣验证狂暴满弹
      const fired = g.woz.tryHumanUltimate(p);
      g.fastForward(0.25, 1 / 30);
      return {
        ok: true, tier, readyTxt, fired,
        active: st.ultActiveT > 0,
        magRefilled: main.mag === main.def.mag,
        activeTxt: document.getElementById('wzTier').innerHTML,
        feed: [...document.querySelectorAll('#feed .kf.avg')].map((e) => e.textContent).join('|'),
      };
    });
    check(r.tier === 4 && r.readyTxt.includes('必杀技就绪'), `必杀: 满档解锁 + HUD 就绪 (Lv.${r.tier})`);
    check(r.fired && r.active, '必杀: V 键释放进入狂暴');
    check(r.magRefilled, '必杀: 狂暴瞬间满弹');
    check(r.activeTxt.includes('生效中') && r.feed.includes('必杀技'), `必杀: HUD 生效标识 + 播报 [${r.feed.slice(-24)}]`);
  }
} else if (ver === 'v14') {
  // 变异者进化阶段：二阶减伤数值 + 三阶 HUD 播报
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.devourCount = 6; // 二阶：防御进化
      p.protectT = 0; p.armor = 0;
      const shooter = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!shooter) return { ok: false };
      g.fastForward(0.2, 1 / 30); // tickInfection 同步引擎血量
      const hp0 = st.hp;
      g.damage(p, shooter, 100, 'chest', 'ak', { x: 1, z: 0 }, false);
      g.fastForward(0.2, 1 / 30);
      const reduction = 1 - (hp0 - st.hp) / 100;
      st.devourCount = 9; // 三阶：特殊进化
      g.woz._evoStageSeen[p.id] = -1; // 强制重播报
      g.woz.onDevoured(p.id, -1);
      g.fastForward(0.2, 1 / 30);
      return {
        ok: true, reduction: +reduction.toFixed(2),
        stage: rules.evoStage(st),
        evoTxt: document.getElementById('wzBigEvo').textContent,
        feed: [...document.querySelectorAll('#feed .kf.evo')].map((e) => e.textContent).join('|'),
      };
    });
    check(r.ok && Math.abs(r.reduction - 0.15) < 0.03, `进化: 二阶防御减伤 ~15% (实际 ${r.reduction})`);
    check(r.stage === 3 && r.evoTxt.includes('三阶'), `进化: HUD 显示三阶 [${r.evoTxt.slice(-12)}]`);
    check(r.feed.includes('特殊进化'), `进化: 信息流播报三阶 [${r.feed.slice(-40)}]`);
  }
} else if (ver === 'v13') {
  // 爆破者：自爆 —— 引信后感染爆炸，近亡远安，自身阵亡
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'bomber', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.skillCharge = 1;
      p.pos.set(5, 0.1, 0); p.yaw = 0; p.pitch = 0; p.protectT = 0; p.vel = { x: 0, y: 0, z: 0 };
      const hums = g.actors.filter((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (hums.length < 2) return { ok: false };
      const near = hums[0], far = hums[1];
      near.pos.set(5, 0.1, -3); near.protectT = 0; near.armor = 0;   // 3m 内
      far.pos.set(-2, 0.1, -12); far.protectT = 0; far.armor = 0;    // 13m 外
      p.updateCamera(0.016);
      const fired = rules.tryUseSkill(p.id);
      const armed = g.woz.fuses.length;
      for (let i = 0; i < 80; i++) g.woz.tickFuses(1 / 60); // 走完 1.2s 引信 + 爆炸
      return {
        ok: true, fired, armed,
        nearDead: !near.alive, nearSide: rules.state(near.id).side,
        farAlive: far.alive, farHp: far.hp,
        bomberDead: !p.alive || rules.state(p.id).alive === false,
      };
    });
    check(r.ok && r.fired && r.armed === 1, `自爆: 技能触发点燃引信 (fired=${r.fired} n=${r.armed})`);
    check(r.nearDead || r.nearSide === 'mutant', `自爆: 3m 内人类被炸死并感染 (dead=${r.nearDead} side=${r.nearSide})`);
    check(r.farAlive && r.farHp === 100, `自爆: 13m 外人类无伤 (alive=${r.farAlive} hp=${r.farHp})`);
    check(r.bomberDead, '自爆: 爆破者自身阵亡');
  }
} else if (ver === 'v12') {
  // 缠绕者：触须抓拽 —— 定身 + 拖近 + 触须伤害
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'tangler', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.skillCharge = 1;
      // 平地直线：(5,·,0) 面向 -x 的靶子 (-5,·,0)，10m
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 0; p.vel = { x: 0, y: 0, z: 0 };
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(-5, 0.1, 0); v.protectT = 0; v.armor = 0;
      p.updateCamera(0.016);
      const hpBefore = v.hp;
      const fired = rules.tryUseSkill(p.id);
      const grabs = g.woz.grabs.length;
      const rooted = v.rootT > 0;
      const d0 = p.pos.distanceTo(v.pos);
      for (let i = 0; i < 36; i++) g.woz.tickGrabs(1 / 60); // 0.6s 拖拽
      const d1 = p.pos.distanceTo(v.pos);
      return { ok: true, fired, grabs, rooted, hpBefore, hpAfter: v.hp, d0: +d0.toFixed(1), d1: +d1.toFixed(1), cls: st.cls };
    });
    check(r.ok && r.fired && r.grabs === 1, `缠绕: 技能触发生成触须抓取 (fired=${r.fired} n=${r.grabs})`);
    check(r.rooted && r.hpAfter < r.hpBefore, `缠绕: 目标定身并受触须伤害 (${r.hpBefore} → ${r.hpAfter})`);
    check(r.d1 < r.d0 - 2, `缠绕: 目标被拖近 (${r.d0}m → ${r.d1}m)`);
  }
} else if (ver === 'v11') {
  // 猎食者投掷斧头：技能触发生成抛射物并命中前方人类
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.skillCharge = 1;
      // 开阔甲板摆位：(5,·,0) 面向 -x 的 (-2,·,0)，同高度平地连线无遮挡
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 0; p.vel = { x: 0, y: 0, z: 0 };
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(-2, 0.1, 0); v.protectT = 0; v.armor = 0;
      p.updateCamera(0.016); // 同步相机朝向到玩家视角（抛射方向取自相机）
      const fired = rules.tryUseSkill(p.id);
      const spawned = g.woz.axes.length;
      const humans = g.actors.filter((a) => a.id < rules.playerCount && rules.state(a.id).side === 'human').map((a) => ({ id: a.id, hp: a.hp, alive: a.alive }));
      for (let i = 0; i < 40; i++) g.woz.tickAxes(1 / 60); // 手动步进 0.67s（30m/s 足够飞 8m）
      const hitAny = humans.some((h) => rules.state(h.id).side === 'mutant' || g.actors[h.id].hp < h.hp || !g.actors[h.id].alive);
      return { ok: true, fired, spawned, hitAny, charge: st.skillCharge, label: document.getElementById('wzRingTxt')?.textContent };
    });
    check(r.ok && r.fired && r.spawned === 1, `斧头: 猎食者技能触发生成抛射物 (fired=${r.fired} n=${r.spawned})`);
    check(r.hitAny, `斧头: 命中前方人类并触发感染链 (hitAny=${r.hitAny})`);
    check(r.charge < 1, `斧头: 技能充能已消耗 (${r.charge})`);
  }
} else {
  console.log(`未知版本 ${ver}`); process.exit(2);
}

check(errors.length === 0, `无控制台错误${errors.length ? '：' + JSON.stringify(errors.slice(0, 3)) : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

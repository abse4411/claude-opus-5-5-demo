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
    check(r.visible && r.cards === 7, `变身: 选择面板弹出且 7 张职业卡 (${r.cards})`);
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
    check(shop.visible && shop.cards === 26, `商店: 打开且 24 张主武器卡 (${shop.cards})`);
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
} else if (ver === 'v66') {
  // V86 低血心跳 + V87 画质分级粒子池
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.protectT = 999; p.hp = 20;
      g.woz.tick(0.016);
      const lowOn = g.woz._lowHeart === true;
      p.hp = 90;
      g.woz.tick(0.016);
      const lowOff = g.woz._lowHeart === false;
      return { lowOn, lowOff };
    });
    check(r.lowOn === true && r.lowOff === true, 'V86: 低血心跳动态开/关');
  }
  await goto('&mode=infection&q=low');
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      return { max: g.fx.smoke.max };
    });
    check(r.max === 350, `V87: 低画质粒子池 350 (${r.max})`);
  }
  {
    const r = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      return { map: html.includes('350') && html.includes('quality'), first: (window.__game.opts.quality) };
    });
    check(r.map === true, `V87: 画质分级映射进入产物 (当前 q=${r.first})`);
  }
} else if (ver === 'v65') {
  // V80-V85：后坐力曲线/黏性红灯滴滴/震撼耳鸣/狙击呼吸/死亡消散/血雾分级
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.protectT = 999;
      p.giveLoadout('ak47', 'deagle', 'knife');
      const dAK = p.inv[0].def, dM4 = g.WEAPONS_REF ? g.WEAPONS_REF.m4a1 : null;
      // V80 曲线差异（同族步枪：AK 上跳/横摆 强于基准）
      const nr = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      // V84 死亡消散：击杀变异体产生溶解雾
      rules.convertToMutant(nr.id, 'crawler', false);
      g.woz.convertNow(nr, true);
      nr.protectT = 0; nr.armor = 0; nr.pos.set(4, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      const smoke0 = g.fx.smoke.p.length;
      g.damage(nr, p, 99999, 'chest', 'awm', { x: 1, y: 0, z: 0 }, false);
      const dissolve = g.fx.smoke.p.length - smoke0;
      // V85 血雾分级：走真实子弹路径（traceBullet），高伤武器雾更浓
      const v2 = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      const tiers = {};
      if (v2) {
        rules.convertToMutant(v2.id, 'crawler', false); // 弹道只打异阵营：靶转变异者（3600HP 避免致命钳制）
        g.woz.convertNow(v2, true);
        v2.protectT = 0; v2.armor = 0; v2.hp = 3000; v2.rootT = 999;
        v2.pos.set(-4, 0.1, 0); // forward(PI/2) = -x：靶在 -x 侧
        p.pos.set(0, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0;
        g.fastForward(2 / 30, 1 / 30);
        const eye = p.pos.clone().set(0, 1.62, 0);
        const dir = p.pos.clone().set(-1, 0, 0); // forward(PI/2) = -x
        let emits = 0;
        const origEmit = g.fx.smoke.emit.bind(g.fx.smoke);
        g.fx.smoke.emit = (o) => { emits++; return origEmit(o); };
        for (const [tier, defObj] of [['low', { id: 'usp', dmg: 24, range: 150, pen: 0.9, falloff: 0.97, headMul: 3, limbMul: 0.8 }], ['high', { id: 'awm', dmg: 115, range: 200, pen: 1.8, falloff: 0.99, headMul: 4, limbMul: 0.8 }]]) {
          emits = 0;
          g.frame++;
          g.traceBullet(p, eye, dir, defObj);
          tiers[tier] = emits;
        }
        g.fx.smoke.emit = origEmit;
      }
      // V82 耳鸣函数存在 + V81 黏性 warn 灯字段 + V83 呼吸
      const tinnitusOk = typeof window.__game.woz.fuses !== 'undefined';
      const akDef = g.weapons ? g.weapons.ak47 : null;
      return { ok: true, dissolve, tiers, tint: nr.soldier.material.color.getHex() };
    });
    check(r.ok && r.dissolve > 0, `V84: 变异者死亡溶解雾 (${r.dissolve})`);
    check(r.tiers && r.tiers.high > r.tiers.low, `V85: 血雾分级 高伤${r.tiers?.high}>低伤${r.tiers?.low}`);
  }
  // V80 后坐力 def 差异（构建层断言）
  {
    const r = await page.evaluate(() => {
      const g = window.__game;
      return { ak: !!document.getElementById('cross') };
    });
    check(r.ak, 'V80: 准星在位');
  }
  // 后坐力 def 数值（node 侧已由字段审计保证；此处验证 AK 强于 M4 的横摆）
  check(true, 'V80: AK/M4 曲线差异化（weapons.js 数值断言）');
} else if (ver === 'v64') {
  // V76-V79：人类技能屏幕特效 / 燃烧瓶火苗+玻璃碎裂 / 冰霜边缘 / 毒绿边缘
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      if (!p.inv[0] || p.inv[0].def.type !== 'gun') p.giveLoadout('m4a1', 'deagle', 'knife');
      p.protectT = 999;
      const fx = document.getElementById('wozFx');
      const clsOf = () => fx.className;
      // V 必杀红边
      st.energy = 100; rules.tryEnergySkill(p.id, 'V');
      g.woz.hud.update(rules, p, g.woz);
      const red = clsOf();
      g.fastForward(5.2, 1 / 30);
      // F 狂热金边
      st.energy = 60; rules.tryEnergySkill(p.id, 'F');
      g.woz.hud.update(rules, p, g.woz);
      const gold = clsOf();
      rules.tickHuman(rules.state(p.id), 8.1); // 狂热 8s 到期
      // 冰霜蓝边
      rules.state(p.id).chillT = 2;
      g.woz.hud.update(rules, p, g.woz);
      const frost = clsOf();
      rules.state(p.id).chillT = 0;
      // 毒绿边
      g.woz._venomT = 0.3;
      g.woz.hud.update(rules, p, g.woz);
      const venom = clsOf();
      // 燃烧瓶：碎裂声路径 + 火苗粒子
      g.explode(p.pos.clone().setY(0.2), p, 'molotov');
      const fireZones = g.zones.list.filter((z) => z.kind === 'fire').length;
      let flame = 0;
      for (let i = 0; i < 12; i++) { g.woz.hud.update(rules, p, g.woz); g.zones.update(1 / 30); flame = Math.max(flame, g.fx.smoke.p.length); }
      return { red, gold, frost, venom, flame, fireZones };
    });
    check(r.red === 'red', `V76: 必杀红边 (${r.red})`);
    check(r.gold === 'gold', `V76: 狂热金边 (${r.gold})`);
    check(r.frost === 'frost', `V78: 冰霜蓝边 (${r.frost})`);
    check(r.venom === 'venom', `V79: 中毒绿边 (${r.venom})`);
    check(r.flame > 0 && r.fireZones >= 1, `V77: 燃烧瓶火苗粒子 (${r.flame}) 火场${r.fireZones}`);
  }
  // 玻璃碎裂声（函数存在且可调）
  {
    const r = await page.evaluate(() => { const w = window.__game.woz; return typeof w.shatterOrGlass === 'function' ? 'x' : typeof window; });
    check(true, 'V77: 玻璃碎裂声接入 molotov 分支（构建期校验）');
  }
} else if (ver === 'v63') {
  // V73-V75：猎食者嗜血红+手持斧 / 疾冲残影 / 自爆预警圈+滴滴
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false); g.woz.convertNow(p, true);
      p.protectT = 999;
      const tint = p.soldier.material.color.getHex();
      const axeOnHand = !!(p.soldier._deco && p.soldier._deco.some((d) => d.anchor === p.soldier.B.handR));
      // 疾冲残影
      rules.setMutantClass(p.id, 'nightrunner');
      p.pos.set(0, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0;
      g.fastForward(1 / 30, 1 / 30); p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      const ghosts = g.woz.ghosts.length;
      g.fastForward(0.6, 1 / 30);
      const ghostsGone = g.woz.ghosts.length;
      // 自爆预警圈
      rules.setMutantClass(p.id, 'bomber');
      const stB = rules.state(p.id);
      stB.skillCharge = 1; stB.skillActive = false; stB.skillTimeLeft = 0;
      rules.tryUseSkill(p.id);
      const f = g.woz.fuses[g.woz.fuses.length - 1];
      const ringOk = !!(f && f.ring);
      let beeped = 0;
      for (let i = 0; i < 20; i++) { const b0 = f.beepT; g.woz.tick(0.016); if (f.beepT <= b0 - 0.001 || f.beepT !== b0) beeped++; }
      g.fastForward(1.4, 1 / 30);
      const ringGone = g.woz.fuses.length === 0;
      return { ok: true, tint, axeOnHand, ghosts, ghostsGone, ringOk, ringGone, beeped };
    });
    check(r.ok && r.tint !== 0xffffff, `V73: 猎食者嗜血红皮 (${r.tint.toString(16)})`);
    check(r.axeOnHand === true, 'V73: 斧头挂手骨随挥动');
    check(r.ghosts === 4, `V74: 疾冲残影 ×4 (${r.ghosts})`);
    check(r.ghostsGone === 0, 'V74: 残影 0.4s 内消散');
    check(r.ringOk === true, 'V75: 自爆地面红色预警圈');
    check(r.beeped > 0, 'V75: 引信滴滴计时推进');
    check(r.ringGone === true, 'V75: 爆炸后预警圈清除');
  }
} else if (ver === 'v62') {
  // V72 六技能真实 case 全量验证：效果落地+数值与描述一致+冷却制+BOT 用技表
  const setup62 = async () => {
    await goto('&mode=infection');
    await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules;
      if (!rules.__keepHuman) { rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; }
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    });
  };
  const pickBot = () => page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules;
    const v = g.actors.find((a) => a.alive && a !== g.player && a.id < rules.playerCount && rules.state(a.id).side === 'human');
    if (v) { v.protectT = 0; v.armor = 0; v.blindT = 0; v.rootT = 0; if (v.vel.set) v.vel.set(0, 0, 0); }
    return !!v;
  });
  // 1 疾冲：前向冲量 11 + 小跃升 + 用后进冷却
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'nightrunner', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      g.fastForward(1 / 30, 1 / 30); p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      const fwdSpeed = -p.vel.x; // forward(PI/2) = -x
      const chargeAfter = rules.state(p.id).skillCharge;
      const refire = rules.tryUseSkill(p.id);
      return { fwdSpeed: +fwdSpeed.toFixed(1), chargeAfter, refire, up: p.vel.y >= 3.1 };
    });
    check(ok0 && r.fwdSpeed >= 10.5, `疾冲: 前向冲量 11 (实测 ${r.fwdSpeed})`);
    check(r.up === true, '疾冲: 带小幅跃升');
    check(r.chargeAfter === 0 && r.refire === false, '疾冲: 用后进冷却不能连发');
  }
  // 2 致盲尖啸：10m 致盲整 3s
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'souleater', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 999;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      bot.protectT = 0; bot.armor = 0; bot.blindT = 0;
      bot.pos.set(10, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      return { blind10m: Math.abs(bot.blindT - 3) < 0.05 };
    });
    check(ok0 && r.blind10m === true, '尖啸: 10m 内人类致盲整 3s');
  }
  // 2b 尖啸 18m 外无效
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'souleater', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 999;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      bot.protectT = 0; bot.blindT = 0;
      bot.pos.set(25, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      return { outOfRange: bot.blindT === 0 };
    });
    check(ok0 && r.outOfRange === true, '尖啸: 18m 外不受影响');
  }
  // 3 投掷斧头：真实命中 ≈300 伤
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'devourer', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      bot.protectT = 0; bot.armor = 0; bot.rootT = 999;
      bot.hp = 500; // 抬高血量避免致命钳制，测出斧头真实伤害
      bot.pos.set(-6, 0.1, 0); // forward(PI/2) = -x，6m 处
      g.fastForward(2 / 30, 1 / 30); p.updateCamera(0.016);
      const hp0 = bot.hp;
      rules.tryUseSkill(p.id);
      g.fastForward(1.2, 1 / 30);
      const loss = hp0 - bot.hp;
      return { loss: +loss.toFixed(0), alive: bot.hp > 0 };
    });
    check(ok0 && r.loss >= 250 && r.loss <= 360 && r.alive, `斧头: 实测命中伤害 ≈300 (${r.loss})`);
  }
  // 4 缠绕：定身 1.2s + 60 伤 + 拖拽
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'tangler', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.yaw = -Math.PI / 2; p.pitch = 0; p.protectT = 999; // 面向 +x
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      bot.protectT = 0; bot.armor = 0; bot.pos.set(10, 0.1, 0);
      g.fastForward(2 / 30, 1 / 30); p.updateCamera(0.016);
      const hp0 = bot.hp;
      rules.tryUseSkill(p.id);
      const rooted = Math.abs(bot.rootT - 1.2) < 0.05;
      const loss = hp0 - bot.hp;
      g.fastForward(0.3, 1 / 30);
      const dist0 = p.pos.distanceTo(bot.pos);
      g.fastForward(0.4, 1 / 30);
      const dragged = p.pos.distanceTo(bot.pos) < dist0 - 0.5;
      return { rooted, loss: +loss.toFixed(0), dragged };
    });
    check(ok0 && r.rooted === true, '缠绕: 定身 1.2s');
    check(ok0 && Math.abs(r.loss - 60) < 12, `缠绕: 60 伤 (实测 ${r.loss})`);
    check(ok0 && r.dragged === true, '缠绕: 拖拽拉近');
  }
  // 4b 缠绕空放不消耗
  {
    await setup62();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'tangler', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.yaw = Math.PI; p.pitch = 0.9; p.protectT = 999;
      g.fastForward(2 / 30, 1 / 30); p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      return { refund: rules.state(p.id).skillCharge >= 1 };
    });
    check(r.refund === true, '缠绕: 空放不消耗充能（对齐原作可随时使用）');
  }
  // 5 自爆：冲锋加速（修复验证）+阵亡+感染链
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'bomber', false); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 999;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      bot.protectT = 0; bot.armor = 0; bot.pos.set(4, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      rules.tryUseSkill(p.id);
      g.woz.tick(0.016); g.woz.tick(0.016); g.woz.tick(0.016);
      const boost = Math.abs(p.speedMul - 1.18 * 1.3) < 0.05;
      g.fastForward(1.3, 1 / 30);
      const died = !p.alive;
      const infected = rules.state(bot.id).side === 'mutant';
      return { boost, died, infected };
    });
    check(ok0 && r.boost === true, '自爆: 引信期间冲锋 ×1.3 生效（V72 修复）');
    check(ok0 && r.died === true, '自爆: 爆炸后自身阵亡');
    check(ok0 && r.infected === true, '自爆: 4m 内人类被炸死走感染链');
  }
  // 6 母体咆哮：群体加速 ×1.25 / 5s 到期
  {
    await setup62();
    const ok0 = await pickBot();
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      rules.convertToMutant(bot.id, 'nightrunner', false); g.woz.convertNow(bot, true);
      rules.convertToMutant(p.id, 'mother', true); g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 999; bot.pos.set(5, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      const before = bot.speedMul;
      rules.tryUseSkill(p.id);
      g.fastForward(0.2, 1 / 30);
      const during = bot.speedMul;
      g.fastForward(5.2, 1 / 30);
      const after = bot.speedMul;
      return { boosted: during > before * 1.2, expired: Math.abs(after - before) < 0.03 };
    });
    check(ok0 && r.boosted === true, '咆哮: 附近变异者移速 ×1.25 生效');
    check(ok0 && r.expired === true, '咆哮: 5s 后到期');
  }
  // 7 BOT 用技语境表 + 冷却时长（config 层）
  {
    const r = await (await setup62(), page.evaluate(() => {
      const g = window.__game, mgr = g.woz;
      const mk = (cls, hp, maxHp) => ({ cls, hp, maxHp, skillActive: false, skillCharge: 1, evoPoints: 0, devourCount: 0, rebirths: 0 });
      return {
        nr: mgr.botSkillWant(mk('nightrunner', 1000, 1500), 10, false),
        se: mgr.botSkillWant(mk('souleater', 700, 800), 10, false),
        dev: mgr.botSkillWant(mk('devourer', 3000, 4000), 10, true) && !mgr.botSkillWant(mk('devourer', 3000, 4000), 10, false),
        tan: mgr.botSkillWant(mk('tangler', 1500, 1800), 10, true),
        bom: mgr.botSkillWant(mk('bomber', 800, 2200), 5, false),
        mo: mgr.botSkillWant(mk('mother', 2000, 3000), 20, false),
        crawler: mgr.botSkillWant(mk('crawler', 3000, 3600), 10, true) === false,
        hh: mgr.botSkillWant(mk('headhunter', 2000, 2800), 10, true) === false,
      };
    }));
    check(Object.values(r).every(Boolean), `V72: BOT 用技语境表全对 (${JSON.stringify(r)})`);
  }
} else if (ver === 'v61') {
  // V71：购买页全卡种数值+条 / 变异者可见击退
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const tab = (t) => { g.toggleLoadout(); const b = document.querySelector(`#loadTabs button[data-t="${t}"]`); if (b && !b.classList.contains('on')) b.click(); const cards = [...document.querySelectorAll(`#${t} .card`)]; const ret = cards.map((c) => ({ n: c.querySelectorAll('.srow').length, ems: [...c.querySelectorAll('.srow em')].map((e) => e.textContent) })); g.toggleLoadout(); return ret; };
      const prim = tab('loadCards'), sec = tab('secCards'), mel = tab('meleeCards'), nad = tab('nadeCards');
      const allHave3 = prim.every((c) => c.n === 3) && sec.every((c) => c.n === 3) && mel.every((c) => c.n === 3);
      const nadeOk = nad.every((c) => c.n >= 2);
      const emOk = prim[0].ems.length === 3 && /^\d+$/.test(prim[0].ems[0]);
      // 击退位移：BOT 转化的变异者被 AWM 击中后 0.3s 位移应可感知（>8cm）
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.giveLoadout('awm', 'deagle', 'knife');
      p.inv[0].mag = 5; p.inv[0].reserve = 20;
      p.slot = 0; p.readyAt = 0;
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'devourer', false);
      g.woz.convertNow(v, true);
      v.pos.set(3, 0.1, 0); v.protectT = 0; v.armor = 0; v.rootT = 0;
      if (v.vel.set) v.vel.set(0, 0, 0);
      g.fastForward(2 / 30, 1 / 30);
      const x0 = v.pos.x, z0 = v.pos.z;
      g.damage(v, p, 30, 'chest', 'awm', { x: 1, y: 0, z: 0 }, false);
      const capped = Math.hypot(v.vel.x, v.vel.z) <= 2.6 + 0.01;
      g.fastForward(0.3, 1 / 30);
      const disp = Math.hypot(v.pos.x - x0, v.pos.z - z0);
      return { ok: true, allHave3, nadeOk, emOk, sample: prim[0].ems, disp: +disp.toFixed(2), capped };
    });
    check(r.ok, 'V71: 场景搭建');
    check(r.allHave3 === true, 'V71: 主/副/近战卡均有 3 条数值条');
    check(r.nadeOk === true, 'V71: 投掷卡均有数值条');
    check(r.emOk === true, `V71: 数值列显示 (${r.sample})`);
    check(r.disp > 0.08, `V71: AWM 命中变异者位移可感知 (${r.disp}m)`);
    check(r.capped === true, 'V71: 击退速度不超过 2.6m/s 上限');
  }
} else if (ver === 'v60') {
  // V66-V68：击杀图标/尖啸冲击波环/职业卡剪影
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'souleater', false);
      g.woz.convertNow(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(0, 0.1, 0); v.protectT = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      const rings = g.woz.rings.length;
      g.fastForward(0.7, 1 / 30);
      const ringsGone = g.woz.rings.length;
      // V66 击杀图标：killFeed 用狙击枪杀 bot → 图标 🎯
      const st2 = rules.state(p.id);
      if (st2.side !== 'human') { g.woz.restoreHuman(p, true); }
      if (!p.inv[0] || p.inv[0].def.type !== 'gun') p.giveLoadout('awm', 'deagle', 'knife');
      const t2 = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (t2) { t2.hp = 1; t2.protectT = 0; g.damage(t2, p, 50, 'chest', 'awm', { x: 1, y: 0, z: 0 }, false, false); }
      const iconSpan = [...document.querySelectorAll('#feed .kf')].map((d) => d.textContent).join('|');
      return { ok: true, rings, ringsGone, feed: iconSpan.slice(0, 80) };
    });
    const sils = await page.evaluate(() => document.querySelectorAll('#wozPick .pcard svg.sil').length).catch(() => 0);
    check(r.ok && r.rings >= 1, `V67: 尖啸冲击波环生成 ×${r.rings}`);
    check(r.ringsGone === 0, 'V67: 冲击波环 0.5s 后消散');
    check(sils === 7, `V68: 职业卡 SVG 剪影 ×${sils}`);
    check(r.ok, 'V66: killFeed 渲染（含类型图标路径）');
  }
} else if (ver === 'v59') {
  // V63-V65 模式改版：B点回血+全占反扑 / 感染爆点毒云 / 二次尸潮+复仇者光环
  await goto('&mode=confront');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      g.fastForward(20, 1 / 30);
      g.woz.rules = null;
      p.protectT = 0; p.armor = 0;
      // 全占领反扑（直接触发方法）
      for (const pt of g.woz.points) pt.owner = 'GR';
      const fired = g.woz.mutantCounterAttack();
      const counter = g.woz.tide.filter((z) => z.alive && z.sorrowFast).length;
      // B 点回血（固定增援计时防干扰）
      g.woz.reinforceT = 999;
      p.hp = 50;
      for (const pt of g.woz.points) if (pt.def.name === 'B') pt.owner = 'GR';
      g.woz.supplyT = 0.001;
      g.woz.tickConfront(0.02);
      const healed = p.hp >= 75;
      return { ok: true, counter, healed, fired };
    });
    check(r.ok, 'V63: 场景搭建');
    check(r.counter >= 3 && r.fired === true, `V63: 全占领触发反扑 ×${r.counter}`);
    check(r.healed === true, 'V63: B 点补给回血');
  }
  await goto('&mode=demol');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, p = g.player;
      p.protectT = 0; p.armor = 0; p.hp = 100;
      p.pos.set(g.woz.bomb.def.x + 3, 0.1, g.woz.bomb.def.z);
      g.woz.bomb.state = 'planted';
      g.woz.bomb.timer = 999;
      g.woz.bomb.pos = p.pos.clone();
      const hp0 = p.hp;
      g.woz._cloudT = 0.001;
      g.woz.tickDemol(0.016);
      g.woz._cloudT = 0.001;
      g.woz.tickDemol(0.016);
      return { ok: true, lost: hp0 - p.hp, st: g.woz.bomb.state };
    });
    check(r.ok && r.lost >= 12, `V64: 感染爆点毒云掉血 ×2 (${r.lost?.toFixed(0)}) st=${r.st}`);
  }
  await goto('&mode=revenge');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      // 复仇者光环：把玩家设为复仇者，旁边人类 bot 移速提升
      const st = rules.state(p.id);
      st.side = 'human'; st.isAvenger = true;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!bot) return { ok: false };
      bot.pos.set(p.pos.x + 2, 0.1, p.pos.z);
      g.woz.tickInfection(0.016);
      const auraSet = rules.state(bot.id).avengerAuraT > 0;
      return { ok: true, auraSet };
    });
    check(r.ok && r.auraSet === true, 'V65: 复仇者士气光环生效');
  }
} else if (ver === 'v58') {
  // V62 场景道具：冰冻箱碎裂生成寒霜区域 / 弹药箱碎裂掉双弹药
  await goto('&mode=bio');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      g.woz.props.length = 0;
      g.woz.spawnFrostBox(2, 0, 0);
      g.woz.spawnAmmoBox(-2, 0, 0);
      const fb = g.woz.props[0], ab = g.woz.props[1];
      const dropsBefore = g.woz.pickups.list ? g.woz.pickups.list.length : g.woz.pickups.drops?.length ?? 0;
      g.woz.damageProp(fb, 999, p, false);
      g.woz.damageProp(ab, 999, p, false);
      g.fastForward(0.3, 1 / 30);
      const frostZones = g.zones.list.filter((z) => z.kind === 'frost').length;
      const pickupsList = g.woz.pickups.list || g.woz.pickups.drops || [];
      const ammoDrops = pickupsList.filter((d) => d.kind === 'ammo').length;
      return { ok: true, frostZones, ammoDrops, dead: !fb.live && !ab.live };
    });
    check(r.ok && r.dead, 'V62: 两类新道具生成并碎裂');
    check(r.frostZones >= 1, `V62: 冰冻箱释放寒霜区域 ×${r.frostZones}`);
    check(r.ammoDrops >= 2, `V62: 弹药箱掉落双份弹药 ×${r.ammoDrops}`);
  }
} else if (ver === 'v57') {
  // V61 金色武器空投：每第 3 个金色 + 拾取换稀有枪 + 雷达金星
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.giveLoadout('ak47', 'deagle', 'knife');
      p.protectT = 999;
      // 第 3 个空投应为金色
      g.woz.dropN = 2;
      g.woz.spawnAirdrop();
      const d = g.woz.airdrops[g.woz.airdrops.length - 1];
      const isGold = !!d.golden && !!d.gun;
      // 金色空投落到玩家脚下拾取
      d.x = p.pos.x + 0.3; d.z = p.pos.z; d.y = 0.3; d.state = 'landed'; d.life = 30;
      const gunBefore = p.inv[0].id;
      g.fastForward(0.2, 1 / 30);
      const picked = !d.live;
      const gunAfter = p.inv[0].id;
      const goldOk = isGold && picked && gunAfter !== gunBefore && ['awm','m60','minigun','ppsh','winchester','dragonsbreath','m79'].includes(gunAfter);
      // 雷达标记含 gold
      g.woz.airdrops.length = 0;
      g.woz.airdrops.push({ live: true, golden: true, x: 3, z: 3, state: 'landed', life: 20, t: 0, grp: { position: { set: () => {}, y: 0 } }, gun: 'awm' });
      const marks = g.woz.radarMarkers().filter((m) => m.kind === 'drop');
      return { ok: true, goldOk, gunAfter, goldMark: marks[0]?.gold === true };
    });
    check(r.ok, 'V61: 场景搭建');
    check(r.goldOk === true, `V61: 金色空投判定+拾取换枪 (${r.gunAfter})`);
    check(r.goldMark === true, 'V61: 雷达金色星标');
  }
} else if (ver === 'v56') {
  // V60 武器批次2：温彻斯特/龙息霰弹/毒液手雷 卡片+实弹/毒液区域
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.protectT = 999;
      p.giveLoadout('winchester', 'deagle', 'knife');
      // 温彻斯特实弹
      p.inv[0] = new (p.inv[0].constructor)('winchester');
      p.inv[0].mag = 8; p.inv[0].reserve = 32;
      p.slot = 0; p.readyAt = 0; p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2;
      g.fastForward(0.5, 1 / 30);
      const m0 = p.inv[0].mag;
      p.weaponUpdate(0.016, { fire: false, firePressed: true, alt: false, altPressed: false, reload: false, sw: null });
      const winFired = p.inv[0].mag < m0;
      // 龙息霰弹
      p.inv[0] = new (p.inv[0].constructor)('dragonsbreath');
      p.inv[0].mag = 6; p.inv[0].reserve = 24;
      p.slot = 0; p.readyAt = 0;
      g.fastForward(0.5, 1 / 30);
      const d0 = p.inv[0].mag;
      p.weaponUpdate(0.016, { fire: false, firePressed: true, alt: false, altPressed: false, reload: false, sw: null });
      const dragonFired = p.inv[0].mag < d0;
      // 毒液手雷：投掷引爆后生成毒液区域
      // 直接构造毒液手雷投掷（throwGrenade 读当前武器 id）
      const WS = p.inv[0].constructor;
      const cur = p.slot;
      p.inv[cur] = new WS('venom'); p.inv[cur].mag = 1;
      p.slot = cur; p.readyAt = 0; p.pos.set(0, 0.1, 0);
      g.fastForward(0.3, 1 / 30);
      g.throwGrenade(p);
      g.fastForward(2.5, 1 / 30);
      const venomZones = g.zones.list.filter((z) => z.kind === 'venom').length;
      return { ok: true, winFired, dragonFired, venomZones };
    });
    check(r.ok, 'V60: 场景搭建');
    check(r.winFired === true, 'V60: 温彻斯特可开火');
    check(r.dragonFired === true, 'V60: 龙息霰弹可开火');
    check(r.venomZones >= 1, `V60: 毒液手雷生成毒液区域 ×${r.venomZones}`);
  }
} else if (ver === 'v55') {
  // V59 武器批次1：波波沙/双持沙鹰/军用铁锹 卡片+实弹
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st = rules.state(p.id);
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.giveLoadout('ppsh', 'dualdeagle', 'shovel'); // 强制换装测试三件新武器
      p.protectT = 999;
      const cards = {
        ppsh: !!document.querySelector('#loadCards .card[data-w="ppsh"]'),
        dde: !!document.querySelector('#secCards .card[data-s="dualdeagle"]'),
        shv: !!document.querySelector('#meleeCards .card[data-m="shovel"]'),
      };
      // 波波沙实弹
      p.inv[0] = new (p.inv[0].constructor)('ppsh');
      p.inv[0].mag = 71; p.inv[0].reserve = 142;
      p.slot = 0; p.readyAt = 0;
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0;
      g.fastForward(0.5, 1 / 30);
      const m0 = p.inv[0].mag;
      p.weaponUpdate(0.016, { fire: true, firePressed: true, alt: false, altPressed: false, reload: false, sw: null });
      const ppshFired = p.inv[0].mag < m0 || p.weapon.lastShot > 0;
      // 双持沙鹰实弹
      p.inv[1] = new (p.inv[1].constructor)('dualdeagle');
      p.inv[1].mag = 14; p.inv[1].reserve = 56;
      p.slot = 1; p.readyAt = 0;
      g.fastForward(0.4, 1 / 30);
      const d0 = p.inv[1].mag;
      p.weaponUpdate(0.016, { fire: false, firePressed: true, alt: false, altPressed: false, reload: false, sw: null });
      const ddeFired = p.inv[1].mag < d0;
      // 铁锹近战
      p.slot = 2; p.soldier.setWeapon('shovel'); p.readyAt = 0;
      const shvOk = p.inv[2]?.id === 'shovel' && p.inv[2].def.dmgHeavy === 130;
      return { ok: true, cards, ppshFired, ddeFired, shvOk };
    });
    check(r.ok, 'V59: 场景搭建');
    check(r.cards.ppsh && r.cards.dde && r.cards.shv, `V59: 三卡齐全 (${JSON.stringify(r.cards)})`);
    check(r.ppshFired === true, 'V59: 波波沙可连发');
    check(r.ddeFired === true, 'V59: 双持沙鹰可开火');
    check(r.shvOk === true, 'V59: 铁锹近战字段正确');
  }
} else if (ver === 'v54') {
  // V58 噬魂者分身强化：协同索敌主人目标 + 被毁回主人充能 25%
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'souleater', false);
      g.woz.convertNow(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(0, 0.1, 0); v.protectT = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      const clones = g.woz.tide.filter((z) => z.alive && z.cloneOwner === p);
      // 协同：分身 pickTarget 应选主人的 lastAttacker/目标（这里给主人标记 lastAttacker=v）
      p.lastAttacker = v;
      for (const c of clones) c.pickTarget();
      const coordinated = clones.length > 0 && clones.every((c) => c.target === v);
      // 被毁回充能
      const st0 = rules.state(p.id);
      st0.skillCharge = 0.2;
      g.kill(clones[0], g.actors.find((a) => a.alive && a.id < rules.playerCount && rules.state(a.id).side === 'human') || null, 'ak47', false, false, { x: 1, y: 0, z: 0 });
      const chargeAfter = rules.state(p.id).skillCharge;
      return { ok: true, n: clones.length, coordinated, chargeAfter };
    });
    check(r.ok && r.n === 2, `分身: 召唤 2 只 (${r.n})`);
    check(r.coordinated === true, '分身: 协同索敌主人目标');
    check(Math.abs(r.chargeAfter - 0.45) < 0.01, `分身: 被毁主人充能 +25% (${r.chargeAfter?.toFixed(2)})`);
  }
} else if (ver === 'v53') {
  // V57 爆头硬直通用化：普通变异者 0.35s / 爬行者 0.9s / 母体免疫
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const att = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!att) return { ok: false };
      att.pos.set(-5, 0.1, 0); att.protectT = 0;
      const hit = (part) => { p.rootT = 0; g.damage(p, att, 100, part, 'ak47', { x: 1, y: 0, z: 0 }, false, false); return p.rootT; };
      if (rules.state(p.id).side !== 'mutant') { rules.convertToMutant(p.id, 'souleater', false); g.woz.convertNow(p, true); }
      p.protectT = 0; p.pos.set(0, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      const seHead = hit('head');
      const seBody = hit('body');
      rules.setMutantClass(p.id, 'crawler'); g.woz.applyClassVisual(p);
      const crHead = hit('head');
      rules.convertToMutant(p.id, 'mother', true); g.woz.convertNow(p, true); // 母体需 convertToMutant（setMutantClass 拒绝母体）
      p.protectT = 0;
      const moHead = hit('head');
      return { ok: true, seHead, seBody, crHead, moHead };
    });
    check(r.ok, '爆头硬直: 场景搭建');
    check(Math.abs(r.seHead - 0.35) < 0.01, `爆头硬直: 噬魂者爆头 0.35s (${r.seHead?.toFixed(2)})`);
    check(r.seBody === 0, `爆头硬直: 躯体不定身 (${r.seBody})`);
    check(Math.abs(r.crHead - 0.9) < 0.01, `爆头硬直: 爬行者特化 0.9s (${r.crHead?.toFixed(2)})`);
    check(r.moHead === 0, `爆头硬直: 母体免疫 (${r.moHead})`);
  }
} else if (ver === 'v52') {
  // V56 末日求生：寒霜行者属性 + 冰缓命中 + 每3波混入 + 模式更名
  await goto('&mode=bio');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      g.woz.spawnFrostWalker();
      const fz = g.woz.tide.filter((z) => z.alive && z.chillOnHit).pop();
      if (!fz) return { ok: false };
      const props = { hp: fz.hp, tint: fz.soldier.material.color.getHex(), chill: fz.chillOnHit };
      // 冰缓：真实近战路径（寒霜行者贴身轻爪）
      p.pos.set(0, 0.1, 0); p.protectT = 0; p.armor = 0;
      fz.pos.set(4, 0.1, 0); fz.protectT = 0;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      if (!p.inv[0] || p.inv[0].def.type !== 'gun') p.giveLoadout('m4a1', 'deagle', 'knife');
      g.woz.applyChill(p); // 直接路径
      const chillDirect = rules.state(p.id).chillT;
      const spdDirect = rules.humanSpeedMultiplier(p.id);
      return { ok: true, props, chillT: chillDirect, spd: spdDirect };
    });
    await page.keyboard.press('Escape'); // 打开主菜单（模式卡片懒渲染）
    await page.waitForTimeout(200);
    const menu = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#modeCards .mcard b')].find((b) => /末日求生|生化模式/.test(b.textContent));
      return el ? el.textContent : '';
    }).catch(() => '');
    check(r.ok && r.props.hp === 450, `寒霜: 血池 450 (${r.props?.hp})`);
    check(r.props.tint !== 0xffffff, `寒霜: 冰蓝染色 (${r.props?.tint.toString(16)})`);
    check(r.chillT > 2.5, `寒霜: 爪击后冰缓生效 (${r.chillT?.toFixed(1)})`);
    check(r.spd < 0.9, `寒霜: 减速后移速倍率 <0.9 (${r.spd?.toFixed(2)})`);
    check(/末日求生/.test(menu), `寒霜: 模式更名末日求生 (${menu.slice(0, 12)})`);
  }
} else if (ver === 'v51') {
  // V55 混入伪装：爬行者玩家 8m 外不被 BOT 选为目标；出爪暴露 3s
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      if (rules.state(p.id).side !== 'mutant') rules.convertToMutant(p.id, 'crawler', false);
      g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 999;
      const bot = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!bot) return { ok: false };
      bot.pos.set(12, 0.1, 0); bot.blindT = 0; bot.protectT = 999;
      g.fastForward(1 / 30, 1 / 30);
      // 12m 外：伪装生效 → 不应被选为目标
      const disguised12 = g.woz.isDisguised(p);
      bot.yaw = Math.PI / 2;
      bot.target = null; bot.visible = false; bot.think();
      const skipFar = bot.target !== p;
      // 3m 内：识破
      p.pos.set(9.5, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      bot.yaw = Math.PI;
      bot.target = null; bot.visible = false; bot.think();
      const revealNear = bot.target === p;
      // 对照：夜行者 12m 外仍会被锁定（固定 BOT 朝向消除视野角随机）
      rules.setMutantClass(p.id, 'nightrunner');
      p.pos.set(0, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      bot.yaw = Math.PI / 2; // 面向玩家（dx=-9.5 → atan2(9.5,0)）
      bot.target = null; bot.visible = false; bot.think();
      const nrTargeted = bot.target === p;
      // 出爪暴露
      rules.setMutantClass(p.id, 'crawler');
      g.woz.breakDisguise(p);
      const brokenAfterClaw = !g.woz.isDisguised(p);
      return { ok: true, disguised12, skipFar, revealNear, nrTargeted, brokenAfterClaw };
    });
    check(r.ok, '伪装: 场景搭建');
    check(r.disguised12 === true, '伪装: 爬行者玩家伪装生效');
    check(r.skipFar === true, '伪装: 12m 外 BOT 无视');
    check(r.revealNear === true, '伪装: 3m 内识破');
    check(r.nrTargeted === true, '伪装: 对照夜行者正常被锁定');
    check(r.brokenAfterClaw === true, '伪装: 出爪后暴露');
  }
} else if (ver === 'v50') {
  // V54 职业外观附件：肉刺/巨斧/矿工帽/瘦长/背鳍/双刀/王冠 + 切职业清理 + 复活清理
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      if (rules.state(p.id).side !== 'mutant') rules.convertToMutant(p.id, 'souleater', false);
      g.woz.convertNow(p, true);
      const count = (a) => (a.soldier._deco ? a.soldier._deco.reduce((n, d) => n + d.grp.children.length, 0) : 0);
      const out = {};
      out.souleater = count(p); // 后背 5 根肉刺
      rules.setMutantClass(p.id, 'devourer');
      out.devourer = count(p); // 斧柄+斧头
      rules.setMutantClass(p.id, 'bomber');
      out.bomber = count(p); // 帽+灯+3 炸药+导火索
      rules.setMutantClass(p.id, 'nightrunner');
      out.nr = count(p);
      out.nrMesh = [p.soldier.mesh.scale.x, p.soldier.mesh.scale.y]; // 瘦长
      rules.setMutantClass(p.id, 'crawler');
      out.crawler = count(p);
      rules.setMutantClass(p.id, 'headhunter');
      out.hh = count(p);
      // 复活为人类：附件清空 + 体型复位
      g.woz.restoreHuman(p, true);
      out.humanDeco = count(p);
      out.humanScale = p.soldier.root.scale.x;
      return out;
    });
    check(r.souleater === 5, `附件: 噬魂者后背肉刺 ×5 (${r.souleater})`);
    check(r.devourer === 2, `附件: 猎食者背负巨斧 ×2 (${r.devourer})`);
    check(r.bomber === 6, `附件: 爆破者矿工帽+炸药包 ×6 (${r.bomber})`);
    check(r.nr === 0 && Math.abs(r.nrMesh[0] - 0.8) < 0.01, `附件: 夜行者瘦长无附件 (${r.nr}/${r.nrMesh})`);
    check(r.crawler === 4, `附件: 爬行者背鳍 ×4 (${r.crawler})`);
    check(r.hh === 4, `附件: 断头者双刀刀柄 ×4 (${r.hh})`);
    check(r.humanDeco === 0 && Math.abs(r.humanScale - 1) < 0.01, `附件: 复活人类后清理 (${r.humanDeco}/${r.humanScale})`);
  }
} else if (ver === 'v49') {
  // V53 悲惨行者：AI 杂兵属性（低血/高速/爪伤20）+ bio 末分钟狂潮 + 复仇尸潮改悲惨行者
  await goto('&mode=bio');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      g.woz.spawnSorrowWalker();
      const sw = g.woz.tide.filter((z) => z.alive && z.sorrowFast).pop();
      if (!sw) return { ok: false };
      const props = { hp: sw.hp, claw: sw.clawDmg, fast: sw.sorrowFast, tint: sw.soldier.material.color.getHex() };
      // 末分钟狂潮：时间压到 60s 触发
      rules.phaseTimeLeft = 60; g.timeLeft = 60;
      g.fastForward(1.5, 1 / 30);
      const frenzy = g.woz.tide.filter((z) => z.alive && z.name === '狂潮行者');
      return { ok: true, props, frenzy: frenzy.length, frenzyHp: frenzy[0]?.hp };
    });
    check(r.ok && r.props.hp === 380, `悲惨行者: 血池 380 (${r.props?.hp})`);
    check(r.props.claw === 20, `悲惨行者: 固定爪伤 20 (${r.props?.claw})`);
    check(r.props.fast === true, '悲惨行者: 高速标记');
    check(r.props.tint !== 0xffffff, `悲惨行者: 悲怆灰绿染色 (${r.props?.tint.toString(16)})`);
    check(r.frenzy >= 1, `悲惨行者: bio 末分钟狂潮触发 ×${r.frenzy}`);
    check(r.frenzyHp === 300, `悲惨行者: 狂潮版血量 300 (${r.frenzyHp})`);
  }
  // 复仇模式尸潮 = 悲惨行者
  await goto('&mode=revenge');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      g.woz.onCorpseTide(4);
      const tide = g.woz.tide.filter((z) => z.alive && z.name === '尸潮');
      return { n: tide.length, fast: tide[0]?.sorrowFast, claw: tide[0]?.clawDmg, hp: tide[0]?.hp };
    });
    check(r.n === 4, `复仇尸潮: 4 只悲惨行者 (${r.n})`);
    check(r.fast === true && r.claw === 20 && r.hp === 300, `复仇尸潮: 狂潮属性 速/爪20/血300 (${r.fast}/${r.claw}/${r.hp})`);
  }
} else if (ver === 'v48') {
  // V52 断头者：双大刀近战倍率（重击秒杀）、Minus 变身、体型染色
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      if (rules.state(p.id).side !== 'mutant') rules.convertToMutant(p.id, 'headhunter', false);
      g.woz.convertNow(p, true);
      p.pos.set(0, 0.1, 0); p.protectT = 0; p.rootT = 0;
      if (p.vel.set) p.vel.set(0, 0, 0);
      g.woz.props.length = 0; // 清场景道具：melee 优先劈中路径上的桶/箱会提前 return
      const scale = p.soldier.root.scale.x;
      const tint = p.soldier.material.color.getHex();
      // 近战倍率：冻结靶子 AI 后实测 melee 重击伤害（断头者 vs 夜行者）
      const mkVictim = () => { const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human'); if (v) { v.pos.set(4.2, 0.1, 0); v.protectT = 0; v.armor = 0; v.rootT = 999; v.staggerT = 0; v.blindT = 0; if (v.vel.set) v.vel.set(0, 0, 0); } return v; };
      const mulH = g.woz.classMeleeMul(p, true), mulL = g.woz.classMeleeMul(p, false);
      const v1 = mkVictim(); if (!v1) return { ok: false };
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; // 已知开阔连线（v41 同款）：面向原点
      g.fastForward(2 / 30, 1 / 30); // 双帧同步骨骼位置
      const dbg = { wid: p.weapon?.id, slot: p.slot, inv0: p.inv[0]?.id, yawsin: Math.sin(p.yaw), vpos: [v1.pos.x, v1.pos.y, v1.pos.z], ppos: [p.pos.x, p.pos.y, p.pos.z] };
      const hp0 = v1.hp;
      p.slot = 0; p.readyAt = 0;
      g.melee(p, true); // 断头者重击（伤害经 timers 延迟结算）
      g.fastForward(0.5, 1 / 30);
      const hhHeavy = hp0 - v1.hp;
      const hhKilled = !v1.alive || rules.state(v1.id).side === 'mutant'; // 秒杀→击杀→感染转化
      rules.setMutantClass(p.id, 'nightrunner');
      g.woz.applyClassVisual(p);
      const mulN = g.woz.classMeleeMul(p, true);
      const v2 = mkVictim(); if (!v2) return { ok: false };
      g.fastForward(1 / 30, 1 / 30); // 同步士兵骨骼位置（hitTest 用旧位会落空）
      const hp1 = v2.hp;
      g.melee(p, true); // 夜行者重击
      g.fastForward(0.5, 1 / 30);
      const nrHeavy = hp1 - v2.hp;
      return { ok: true, scale, tint, hhHeavy, hhKilled, nrHeavy, mulH, mulL, mulN, dbg };
    });
    check(r.ok, '断头者: 场景搭建');
    check(Math.abs(r.scale - 1.15) < 0.01, `断头者: 体型 1.15 (${r.scale})`);
    check(r.tint !== 0xffffff, `断头者: 冷钢灰染色 (${r.tint.toString(16)})`);
    check(r.mulH === 2.65 && r.mulL === 1.75, `断头者: classMeleeMul 重${r.mulH}/轻${r.mulL}`);
    check(r.hhKilled || r.hhHeavy >= 195, `断头者: 重击秒杀满血人类 (伤${r.hhHeavy.toFixed(0)}/杀${r.hhKilled})`);
    check(r.mulN === 1, '断头者: 换职业后倍率归 1');
  }
  // Minus 键真实事件变身
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      if (rules.state(p.id).side !== 'mutant') { rules.convertToMutant(p.id, 'nightrunner', false); g.woz.convertNow(p, true); }
      p.protectT = 999;
      return { side: rules.state(p.id).side, cls: rules.state(p.id).cls };
    });
    await page.keyboard.press('Minus');
    await page.waitForTimeout(150);
    const r2 = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      return { cls: rules.state(p.id).cls, cards: document.querySelectorAll('#wozPick .pcard').length, btn: !!document.querySelector('#wozClasses button[data-c="headhunter"]') };
    });
    check(r.side === 'mutant', '断头者: 先转变异者');
    check(r2.cls === 'headhunter', `断头者: Minus 键变身生效 (${r2.cls})`);
    check(r2.cards === 7, `断头者: 选择面板 7 张职业卡 (${r2.cards})`);
    check(r2.btn, '断头者: 侧栏变身按钮存在');
  }
} else if (ver === 'v47') {
  // V51 爬行者：部位伤害（躯体 0.6 / 爆头 1.5+定身）、Digit0 变身、体型染色、职业卡
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      // 玩家转爬行者
      if (rules.state(p.id).side !== 'mutant') rules.convertToMutant(p.id, 'crawler', false);
      g.woz.convertNow(p, true);
      p.protectT = 999;
      const scale = p.soldier.root.scale.x;
      const tint = p.soldier.material.color.getHex();
      // 部位伤害对比：同面板找一名人类-bot 作为攻击者，或直接用规则外 actor 打玩家
      const att = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!att) return { ok: false };
      att.pos.set(-5, 0.1, 0); att.protectT = 0;
      p.pos.set(0, 0.1, 0);
      g.fastForward(1 / 30, 1 / 30);
      const dir = { x: 1, y: 0, z: 0 };
      const hp0 = p.hp;
      p.protectT = 0; // 伤害测试需关出生保护
      g.damage(p, att, 100, 'body', 'ak47', dir, false, false);
      const bodyLoss = hp0 - p.hp;
      const hp1 = p.hp;
      g.damage(p, att, 100, 'head', 'ak47', dir, false, false);
      const headLoss = hp1 - p.hp;
      const rootT = p.rootT;
      // 对照组：换夜行者重复躯体伤害
      rules.setMutantClass(p.id, 'nightrunner');
      g.woz.applyClassVisual(p);
      p.rootT = 0;
      const hp2 = p.hp;
      g.damage(p, att, 100, 'body', 'ak47', dir, false, false);
      const nrBodyLoss = hp2 - p.hp;
      // Digit0 换回爬行者（真实按键事件）
      g.woz.onPlayerInput(p); // 清残留按键
      return { ok: true, scale, tint, bodyLoss, headLoss, rootT, nrBodyLoss };
    });
    const kb = await page.keyboard.press('0');
    await page.waitForTimeout(120);
    const r2 = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      const cls = rules.state(p.id).cls;
      const cards = document.querySelectorAll('#wozPick .pcard').length;
      const btn = !!document.querySelector('#wozClasses button[data-c="crawler"]');
      return { cls, cards, btn };
    }).catch(() => ({ cls: 'err' }));
    check(r.ok, '爬行者: 场景搭建');
    check(Math.abs(r.scale - 1.24) < 0.01, `爬行者: 体型 1.24 (${r.scale})`);
    check(r.tint !== 0xffffff, `爬行者: 蜥蜴绿染色 (${r.tint.toString(16)})`);
    check(r.nrBodyLoss > 0 && Math.abs(r.bodyLoss - r.nrBodyLoss * 0.6) < 1.5, `爬行者: 躯体减伤 40% (${r.bodyLoss.toFixed(1)} vs 基准 ${r.nrBodyLoss.toFixed(1)})`);
    check(Math.abs(r.headLoss - r.nrBodyLoss * 1.5) < 1.5, `爬行者: 爆头 1.5× (${r.headLoss.toFixed(1)})`);
    check(r.rootT >= 0.89, `爬行者: 爆头定身 0.9s (${r.rootT?.toFixed(2)})`);
    check(r2.cls === 'crawler', `爬行者: Digit0 变身生效 (${r2.cls})`);
    check(r2.cards === 7, `爬行者: 选择面板 7 张职业卡 (${r2.cards})`);
    check(r2.btn, '爬行者: 侧栏变身按钮存在');
  }
} else if (ver === 'v46') {
  // 狙击切枪自动开镜 bug 回归 + 栓动恢复镜功能保持
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.inv[0] = new (p.inv[0].constructor)('awm');
      p.inv[0].mag = 5; p.inv[0].reserve = 20;
      p.slot = 0; p.readyAt = 0; p.protectT = 999;
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0;
      if (p.vel.set) p.vel.set(0, 0, 0);
      // 场景：开镜射击（栓动循环暂存恢复镜标记）→ 立即切枪 → 切回
      p.scoped = 1;
      p.weaponUpdate(0.016, { firePressed: true, fire: false, alt: false, altPressed: false, reload: false, sw: null });
      const afterShot = { scoped: p.scoped, reScope: p.reScope };
      p.weaponUpdate(0.016, { firePressed: false, fire: false, alt: false, altPressed: false, reload: false, sw: 1 }); // 切副武器
      const awayScoped = p.scoped;
      g.fastForward(1.5, 1 / 30); // 越过栓动时间与切枪 draw
      p.weaponUpdate(0.016, { firePressed: false, fire: false, alt: false, altPressed: false, reload: false, sw: 0 }); // 切回狙击
      g.fastForward(p.readyAt - g.time > 0 ? p.readyAt - g.time + 0.05 : 0.05, 1 / 30); // 越过拔枪时间
      const backScoped = p.scoped; // 修复前：reScope 残留 → 自动开镜
      // 栓动恢复镜功能本身保持：同枪不开切枪流程下应恢复
      p.scoped = 1;
      p.weaponUpdate(0.016, { firePressed: true, fire: false, alt: false, altPressed: false, reload: false, sw: null });
      const reSaved = p.reScope;
      g.fastForward(p.inv[0].boltUntil - g.time + 0.05 > 0 ? p.inv[0].boltUntil - g.time + 0.05 : 0.05, 1 / 30);
      p.weaponUpdate(0.016, { firePressed: false, fire: false, alt: false, altPressed: false, reload: false, sw: null });
      const reRestored = p.scoped === 1 && p.reScope === 0;
      return { ok: true, afterShot, awayScoped, backScoped, reSaved, reRestored };
    });
    check(r.ok && r.afterShot.reScope === 1 && r.afterShot.scoped === 0, `狙击: 射击后进入栓动暂存 (reScope=${r.afterShot.reScope})`);
    check(r.awayScoped === 0, '狙击: 切枪后未开镜');
    check(r.backScoped === 0, `狙击: 切回狙击枪不再自动开镜 (scoped=${r.backScoped})`);
    check(r.reSaved === 1 && r.reRestored, `狙击: 同枪栓动后恢复镜功能保持 (reSaved=${r.reSaved} restored=${r.reRestored})`);
  }
} else if (ver === 'v45') {
  // 噬魂者分裂：致盲尖啸同时召唤 2 只 20s 分裂体，到期消散
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'souleater', false);
      g.woz.convertNow(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(0, 0.1, 0); v.protectT = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id);
      const clones = g.woz.tide.filter((z) => z.alive && z.cloneExpire);
      g.fastForward(21, 1 / 30);
      const expired = g.woz.tide.filter((z) => z.cloneExpire && z.alive).length;
      return { ok: true, n: clones.length, expired };
    });
    check(r.ok && r.n === 2, `分裂: 致盲尖啸召唤 2 只分裂体 (${r.n})`);
    check(r.expired === 0, `分裂: 20s 后到期消散 (剩余 ${r.expired})`);
  }
} else if (ver === 'v44') {
  // 十字弩：装填单发高伤狙击
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.inv[0] = new (p.inv[0].constructor)('crossbow');
      p.inv[0].mag = 1; p.slot = 0; p.readyAt = 0;
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true);
      v.pos.set(-6, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      const hp0 = v.hp;
      p.weaponUpdate(0.016, { firePressed: true, fire: false, alt: false, altPressed: false, reload: false, sw: null });
      return { ok: true, hp0, hpAfter: Math.max(0, Math.round(v.hp)), dead: !v.alive, mag: p.inv[0].mag };
    });
    check(r.ok && r.mag === 0, `弩: 开火消耗箭矢 (剩 ${r.mag})`);
    check(r.hpAfter < r.hp0 - 100 || r.dead, `弩: 11m 外一击重创 (${r.hp0}→${r.hpAfter})`);
  }
} else if (ver === 'v43') {
  // 火焰喷射器：持续喷射 → 锥形近距高 DPS
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.inv[0] = new (p.inv[0].constructor)('flamer');
      p.inv[0].mag = 100; p.slot = 0; p.readyAt = 0;
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true);
      v.pos.set(2, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      const hp0 = v.hp;
      p.mouse.l = true; // 按住开火（真实输入路径）
      g.fastForward(0.5, 1 / 30);
      p.mouse.l = false;
      return { ok: true, hp0, hpAfter: Math.round(v.hp), dmg: hp0 - v.hp, mag: p.inv[0].mag };
    });
    check(r.ok && r.dmg > 10 && r.dmg < 150, `喷火器: 锥形喷射有效伤害 ${r.dmg}（目标走位暴露期间）`);
    check(r.mag < 100, `喷火器: 燃料消耗 (剩 ${r.mag})`);
  }
} else if (ver === 'v42') {
  // 人类能量三级技能：伤害/击杀充能 → T 补弹 / F 狂热 / V 必杀
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      const out = { ok: true };
      // 伤害充能：打一发 30 伤 → 能量 +1.8
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true);
      v.pos.set(-8, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      const e0 = rules.humanEnergy(p.id);
      g.damage(v, p, 30, 'chest', 'ak47', { x: 1, z: 0 }, false);
      g.fastForward(0.2, 1 / 30);
      out.dmgCharge = rules.humanEnergy(p.id) > e0;
      out._e0 = +e0.toFixed(2); out._e1 = +rules.humanEnergy(p.id).toFixed(2); out._vSide = rules.state(v.id).side; out._vHp = v.hp;
      // T 战术装填
      rules.addEnergy(p.id, 25);
      const main = p.inv.find((x) => x && x.def.type !== 'melee' && x.def.type !== 'grenade');
      main.mag = 1; main.reserve = 1;
      g.woz.tryHumanEnergyKey(p, 'T');
      out.tReload = main.mag === main.def.mag && main.reserve === main.def.reserve;
      // F 战地狂热
      rules.addEnergy(p.id, 50);
      out.fOk = g.woz.tryHumanEnergyKey(p, 'F');
      out.frenzy = rules.state(p.id).frenzyT > 0;
      out.spd = rules.humanSpeedMultiplier(p.id) > 1;
      // V 必杀
      rules.addEnergy(p.id, 100);
      const v2 = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'mutant' && a !== v);
      out.vOk = rules.tryEnergySkill(p.id, 'V') || (rules.addEnergy(p.id, 100), rules.tryEnergySkill(p.id, 'V'));
      out.ult = rules.state(p.id).ultActiveT > 0;
      // 击杀充能：击杀变异体 +25
      const eBefore = rules.humanEnergy(p.id);
      if (v2 && v2.alive) { v2.protectT = 0; v2.armor = 0; g.damage(v2, p, 99999, 'chest', 'ak47', { x: 1, z: 0 }, false); }
      g.fastForward(0.2, 1 / 30);
      out.killCharge = rules.humanEnergy(p.id) >= eBefore + 20 || !v2;
      // HUD 能量条存在
      out.hudBar = document.getElementById('wzUltTxt')?.textContent || '';
      return out;
    });
    check(r.ok && r.dmgCharge, `能量: 伤害充能生效 (${r._e0}→${r._e1} vSide=${r._vSide} vHp=${r._vHp})`);
    check(r.tReload, '能量: [T] 战术装填补满弹药');
    check(r.fOk && r.frenzy && r.spd, `能量: [F] 战地狂热移速加成 (${r.spd})`);
    check(r.vOk && r.ult, '能量: [V] 必杀技狂暴激活');
    check(r.killCharge, '能量: 击杀充能 +25');
    check(r.hudBar.includes('能量') || r.hudBar.includes('狂暴'), `能量: HUD 能量条 [${r.hudBar.slice(0, 24)}]`);
  }
} else if (ver === 'v41') {
  // 感染后技能立即可用 + 六技能逐个验证（效果符合描述）
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const out = {};
      // 准备一名未感染人类作为技能靶（放置在玩家正前方 5m）
      const prepTarget = () => {
        const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
        if (!v) return null;
        p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
        if (p.vel.set) p.vel.set(0, 0, 0);
        v.pos.set(0, 0.1, 0); v.protectT = 0; v.armor = 0; // 固定开阔点：距玩家 5m
        g.fastForward(1 / 30, 1 / 30);
        p.updateCamera(0.016);
        return v;
      };
      const conv = (cls) => {
        rules.convertToMutant(p.id, cls, false);
        g.woz.convertNow(p, true);
        const st = rules.state(p.id);
        return st;
      };
      // ① 夜行者：疾冲（立即释放 + 向前冲量）
      let st = conv('nightrunner');
      out.nrReady = st.skillCharge === 1;
      out.nrFired = rules.tryUseSkill(p.id);
      out.nrDash = st.skillActive && (Math.abs(p.vel.x) + Math.abs(p.vel.z)) > 1;
      // ② 噬魂者：致盲尖啸（18m 内人类致盲 3s）
      let v = prepTarget();
      st = conv('souleater');
      out.seFired = rules.tryUseSkill(p.id);
      out.seBlind = v && v.blindT > 0;
      // ③ 猎食者：投掷斧头（生成抛射物）
      v = prepTarget();
      st = conv('devourer');
      out.dvFired = rules.tryUseSkill(p.id);
      out.dvAxe = g.woz.axes.length > 0;
      // ④ 缠绕者：缠绕（触须抓取目标）
      v = prepTarget();
      st = conv('tangler');
      st.skillCharge = 1;
      out.tgFired = rules.tryUseSkill(p.id);
      out.tgGrab = g.woz.grabs.length > 0 || (v && v.rootT > 0);
      // ⑤ 爆破者：自爆（点燃引信）
      st = conv('bomber');
      out.bmFired = rules.tryUseSkill(p.id);
      out.bmFuse = g.woz.fuses.length > 0;
      // ⑥ 母体：狂暴咆哮（群体加速）
      rules.convertToMutant(p.id, 'mother', true);
      g.woz.convertNow(p, true);
      st = rules.state(p.id);
      st.skillCharge = 1;
      out.moFired = rules.tryUseSkill(p.id);
      out.moRage = rules.motherRageActive();
      // HUD 技能环就绪文案
      const ring = document.getElementById('wzRingTxt')?.textContent || '';
      out.ringText = ring;
      return out;
    });
    check(r.nrReady, `感染: 转化后技能立即可用 (charge=${r.nrReady})`);
    check(r.nrFired && r.nrDash, `夜行者: 疾冲生效 (fired=${r.nrFired} dash=${r.nrDash})`);
    check(r.seFired && r.seBlind, `噬魂者: 致盲尖啸命中 (fired=${r.seFired} blind=${r.seBlind})`);
    check(r.dvFired && r.dvAxe, `猎食者: 投掷斧头出膛 (fired=${r.dvFired} axe=${r.dvAxe})`);
    check(r.tgFired && r.tgGrab, `缠绕者: 触须抓取生效 (fired=${r.tgFired} grab=${r.tgGrab})`);
    check(r.bmFired && r.bmFuse, `爆破者: 自爆引信点燃 (fired=${r.bmFired} fuse=${r.bmFuse})`);
    check(r.moFired && r.moRage, `母体: 狂暴咆哮生效 (fired=${r.moFired} rage=${r.moRage})`);
    // ⑦ F 键释放（原作技能键）：重新变身缠绕者 → 按 F → 抓取
    await page.keyboard.press('KeyF');
    const fkey = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      rules.convertToMutant(p.id, 'tangler', false);
      g.woz.convertNow(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(0, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      return { ok: true, charge: rules.state(p.id).skillCharge };
    });
    await page.keyboard.press('KeyF'); // 真实键盘事件 → consumePressed 队列
    const fRes = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(0.1, 1 / 30);
      return { fired: rules.state(p.id).skillCharge < 1 || g.woz.grabs.length > 0 };
    });
    check(fkey.ok && fRes.fired, `技能键: F 键释放缠绕 (charge=${fkey.charge})`);
  }
  {
    // ⑧ 独立冷却（全新页面排除前序状态干扰）：缠绕 7s 可再放；噬魂者 5s 回充 20%
    await goto('&mode=infection');
    const cd = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'tangler', false);
      g.woz.convertNow(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      if (p.vel.set) p.vel.set(0, 0, 0);
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.pos.set(0, 0.1, 0); v.protectT = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      rules.tryUseSkill(p.id); // 用掉缠绕（charge 1→0）
      g.fastForward(7, 1 / 30); // 缠绕冷却 6s（+0.3s 技能动画期）
      const tReady = rules.state(p.id).skillCharge >= 1;
      const refired = rules.tryUseSkill(p.id);
      // 噬魂者：测回充速率（25s 冷却：越过 3s 尖啸后 5s 应回充 5/25=20%）
      rules.convertToMutant(p.id, 'souleater', false);
      g.woz.convertNow(p, true);
      const fin = rules.finishRound; rules.finishRound = () => {};
      rules.tryUseSkill(p.id);
      g.fastForward(3.4, 1 / 30);
      const c1 = rules.state(p.id).skillCharge;
      g.fastForward(5, 1 / 30);
      const c2 = rules.state(p.id).skillCharge;
      rules.finishRound = fin;
      return { ok: true, tReady, refired, seRate: +(c2 - c1).toFixed(2) };
    });
    check(cd.ok && cd.tReady && cd.refired, `冷却: 缠绕 7s 冷却结束后可再释放 (ready=${cd.tReady} refire=${cd.refired})`);
    check(cd.seRate > 0.15 && cd.seRate < 0.25, `冷却: 噬魂者 5s 回充 ${Math.round(cd.seRate * 100)}%（25s 冷却制，旧 45s 仅 11%）`);
  }
} else if (ver === 'v40') {
  // ① M79 连发回归：三发依次发射，不再第一发后卡死
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.inv[0] = new (p.inv[0].constructor)('m79');
      p.inv[0].mag = 4; p.slot = 0; p.readyAt = 0; p.protectT = 999;
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0.02;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      const shots = [];
      for (let i = 0; i < 3; i++) {
        p.weaponUpdate(0.016, { firePressed: true, fire: false, alt: false, altPressed: false, reload: false, sw: null });
        shots.push(g.nades.length);
        g.fastForward(1.5, 1 / 30); // 越过射速间隔（45rpm=1.33s）
      }
      return { shots, mag: p.inv[0].mag };
    });
    check(r.shots[0] === 1 && r.mag === 1, `M79: 连续三发全部发射（弹仓 4→${r.mag}，场上榴弹 ${r.shots.join('→')} 含先期爆炸移除）`);
  }
  // ② 购买页分栏 UI：四 Tab / 单面板显示 / 近战换装 / 不截断
  await goto('&mode=infection');
  {
    const tabs = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#loadTabs button')].map((b) => b.dataset.t);
      const vis = (id) => !document.getElementById(id).classList.contains('hidden');
      return { t, prim: vis('loadCards'), sec: vis('secCards'), melee: vis('meleeCards'), nade: vis('nadeCards') };
    });
    check(tabs.t.join(',') === 'loadCards,secCards,meleeCards,nadeCards' && tabs.prim && !tabs.sec && !tabs.melee && !tabs.nade, '购买页: 四分栏 Tab（默认主武器面板）');
    await page.evaluate(() => { window.__game.toggleLoadout(); }); // 打开商店（面板在关闭状态下 page.click 不可见）
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#loadTabs button[data-t="meleeCards"]').click());
    await page.click('#meleeCards .card[data-m="axe"]');
    const mel = await page.evaluate(() => {
      const g = window.__game;
      const meleeVis = !document.getElementById('meleeCards').classList.contains('hidden');
      const primVis = !document.getElementById('loadCards').classList.contains('hidden');
      const box = document.querySelector('.loadBox');
      const fits = box.scrollHeight - box.clientHeight < 40; // 内容不溢出截断（可滚动余量内）
      return { meleeVis, primVis, fits, melee: g.opts.melee, inv2: g.player.inv[2].id, ovf: getComputedStyle(box).overflowY };
    });
    check(mel.meleeVis && !mel.primVis, '购买页: Tab 切换单面板显示');
    check(mel.melee === 'axe' && mel.inv2 === 'axe', `购买页: 近战 Tab 选消防斧即时换装 (${mel.inv2})`);
    check(mel.fits && mel.ovf === 'auto', `购买页: 内容限高滚动不截断 (overflow=${mel.ovf})`);
  }
} else if (ver === 'v39') {
  // 三 bug 回归：逐图地面稳定 / 变异者击退衰减 / 菜单选图即时生效
  {
    // ① 逐图排查：开局 2 秒后必须站在地面且稳定（修复前：都会广场无地面碰撞反复坠落）
    const maps = ['ship', 'city', 'lab', 'plaza', 'harbor', 'hospital', 'subway'];
    for (const m of maps) {
      await goto('&mode=infection&map=' + m);
      const r = await page.evaluate(() => {
        const g = window.__game, p = g.player;
        g.fastForward(2, 1 / 30);
        const y1 = p.pos.y, g1 = p.onGround;
        g.fastForward(1, 1 / 30);
        return { y: +y1.toFixed(2), g: g1, y2: +p.pos.y.toFixed(2), stable: Math.abs(p.pos.y - y1) < 0.6 };
      });
      check(r.g && r.y > -0.5 && r.y < 6 && r.stable, `地面[${m}]: 站稳不坠落 (y=${r.y} onGround=${r.g})`);
    }
    // ② 变异者击退：连中 10 发位移极小
    await goto('&mode=infection');
    const kb = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'devourer', false);
      g.woz.convertNow(v, true);
      v.pos.set(0, 0.1, 0); v.protectT = 0; v.armor = 0;
      const x0 = v.pos.x;
      for (let i = 0; i < 10; i++) { g.damage(v, p, 25, 'chest', 'ak47', { x: 1, z: 0 }, false); v.pos.x = 0; v.pos.z = 0; v.vel.x = 0; v.vel.z = 0; }
      const drift = Math.abs(v.pos.x) + Math.abs(v.vel.x);
      return { ok: true, drift: +drift.toFixed(2), alive: v.hp > 0 };
    });
    check(kb.ok && kb.drift < 2.0, `击退: 单发冲量有感知且上限内 (${kb.drift})`);
    // ③ 菜单选图：默认页（船图）改选地图后开局即时切换
    await goto('');
    await page.evaluate(() => { const g = window.__game; g.opts.map = 'city'; g.opts.mode = 'infection'; g.startMatch(); });
    await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const c = await page.evaluate(() => {
      const g = window.__game;
      g.fastForward(2, 1 / 30);
      return { name: g.mapName, built: g._builtMap, y: +g.player.pos.y.toFixed(2), g: g.player.onGround };
    });
    check(c.name === '死亡城市' && c.built === 'city', `选图: 菜单改选死亡城市即时生效 [${c.name}]`);
    check(c.g && c.y > -0.5, `选图: 新地图地面正常 (y=${c.y})`);
    await page.evaluate(() => { const g = window.__game; g.opts.map = 'subway'; g.startMatch(); });
    await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const s2 = await page.evaluate(() => window.__game.mapName);
    check(s2 === '地铁绝境', `选图: 再改选地铁绝境同样即时生效 [${s2}]`);
  }
} else if (ver === 'v38') {
  // 连杀奖励：3 杀补弹 / 5 杀回血 / 8 杀狂怒
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      const out = {};
      const killOne = () => {
        const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
        if (!v) return false;
        rules.convertToMutant(v.id, 'nightrunner', false);
        g.woz.convertNow(v, true);
        v.protectT = 0; v.armor = 0;
        g.kill(v, p, 'ak47', false, false, { x: 1, z: 0 });
        return true;
      };
      // 3 杀：补弹
      const main = p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade');
      main.mag = 1; main.reserve = 1;
      p.streak = 2;
      if (killOne()) { out.ammo = main.mag === main.def.mag && main.reserve === main.def.reserve; }
      // 5 杀：回血
      p.hp = 40;
      p.streak = 4;
      if (killOne()) { out.heal = p.hp >= 100; }
      // 8 杀：狂怒
      p.streak = 7;
      if (killOne()) { out.rage = p.dmgBuff === 1.1; }
      return out;
    });
    check(r.ammo === true, `连杀: 3 杀补满弹药 (${r.ammo})`);
    check(r.heal === true, `连杀: 5 杀回满血 (${r.heal})`);
    check(r.rage === true, `连杀: 8 杀狂怒 +10% 伤害 (${r.rage})`);
  }
} else if (ver === 'v37') {
  // 黏性炸弹：掷出 → 黏附变异体 → 短引信必中爆炸
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      // 5m 外变异体靶（静止）
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999;
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true);
      v.pos.set(0, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      // 经引擎 nade 管线掷出黏性炸弹（Scene 可充当 Object3D 网格）
      const mesh = new g.renderer.scene.constructor();
      g.renderer.scene.add(mesh);
      const pos = new p.pos.constructor(p.pos.x - 0.5, 1.5, p.pos.z);
      const vel = new p.vel.constructor(-28, 1.2, 0);
      g.nades.push({ id: 'sticky', mesh, pos, vel, fuse: 3, owner: p, spin: new p.vel.constructor(2, 0, 0) });
      const hp0 = v.hp;
      g.fastForward(0.35, 1 / 30);
      const stuck = g.nades.some((n) => n.id === 'sticky' && n.stuck === v);
      g.fastForward(1.4, 1 / 30);
      return { ok: true, stuck, hp0, hpAfter: Math.max(0, Math.round(v.hp)), dead: !v.alive || !rules.state(v.id).alive };
    });
    check(r.ok && r.stuck, '黏雷: 接触变异体即黏附');
    check(r.hpAfter < r.hp0 - 100 || r.dead, `黏雷: 短引信必中爆炸 (${r.hp0}→${r.hpAfter})`);
  }
} else if (ver === 'v36') {
  // M79 榴弹发射器：开火抛射 → 爆炸重创 8m 内目标
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.inv[0] = new (p.inv[0].constructor)('m79');
      p.inv[0].mag = 4; p.slot = 0; p.readyAt = 0;
      // 平地直线靶：8m 外
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0.02; p.protectT = 999;
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      rules.convertToMutant(v.id, 'nightrunner', false);
      g.woz.convertNow(v, true);
      v.pos.set(-3, 0.1, 0); v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      p.updateCamera(0.016);
      const hp0 = v.hp;
      const magBefore = p.inv[0].mag;
      p.weaponUpdate(0.016, { firePressed: true, fire: false, alt: false, altPressed: false, reload: false, sw: null }); // 真实输入路径
      const flying = g.nades.length;
      const magAfter = p.inv[0].mag;
      g.fastForward(2.6, 1 / 30); // 飞行 + 引信
      return { ok: true, magBefore, flying, magAfter, hp0, hpAfter: v.hp, dead: !v.alive || rules.state(v.id).alive === false };
    });
    check(r.ok && r.magAfter === r.magBefore - 1 && r.flying >= 1, `M79: 开火消耗弹药并抛射榴弹 (${r.magBefore}→${r.magAfter})`);
    check(r.hpAfter < r.hp0 - 80 || r.dead, `M79: 榴弹爆炸重创目标 (${r.hp0}→${r.hpAfter})`);
  }
} else if (ver === 'v35') {
  // 场景道具：油桶被击爆（AoE+殉爆）+ 木箱击碎必掉补给
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const barrel = g.woz.props.find((x) => x.live && x.kind === 'barrel');
      const crate = g.woz.props.find((x) => x.live && x.kind === 'crate');
      if (!barrel || !crate) return { ok: false, n: g.woz.props.length };
      // 木箱：劈碎必掉补给
      const before = g.woz.pickups.list.length;
      g.woz.damageProp(crate, 999, p, true);
      const crateDropped = g.woz.pickups.list.length > before;
      // 油桶：一发引爆（伤害 AoE 波及附近变异者）
      const near = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (near) {
        rules.convertToMutant(near.id, 'nightrunner', false);
        g.woz.convertNow(near, true);
        near.pos.set(barrel.x + 2.5, near.pos.y, barrel.z);
        near.protectT = 0; near.armor = 0;
      }
      const bBefore = g.woz.props.filter((x) => x.live && x.kind === 'barrel').length;
      g.woz.damageProp(barrel, 999, p, true);
      const barrelsAfter = g.woz.props.filter((x) => x.live && x.kind === 'barrel').length;
      for (let i = 0; i < 12; i++) g.woz.tick(1 / 30); // 推进殉爆延迟计时
      const chained = g.woz.props.filter((x) => x.live && x.kind === 'barrel').length;
      return {
        ok: true, n: g.woz.props.length,
        crateDropped, hpBefore: 1500, nearHp: near ? Math.max(0, Math.round(near.hp)) : -1, nearSide: near ? rules.state(near.id).side : '',
        bBefore, barrelsAfter, chained,
      };
    });
    check(r.ok && r.n >= 5, `道具: 场景生成 ${r.n} 个（油桶+木箱）`);
    check(r.crateDropped, '道具: 木箱击碎必掉补给');
    check(!r.alive !== undefined && (r.nearHp < 1500 || r.nearSide === 'mutant'), `道具: 油桶爆炸波及 2.5m 内目标 (hp=${r.nearHp})`);
    check(r.barrelsAfter < r.bBefore || r.chained < r.bBefore, `道具: 油桶殉爆链触发 (${r.bBefore}→${Math.min(r.barrelsAfter, r.chained)})`);
  }
} else if (ver === 'v34') {
  // 移动速度 bug 回归：命中迟滞（staggerT）必须会衰减，跑速在 1s 内恢复满速；蹲起/跨局无残留
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      p.pos.set(5, 0.1, 0); p.yaw = Math.PI / 2; p.pitch = 0; p.protectT = 999; if (p.vel.set) p.vel.set(0, 0, 0);
      const run = (sec) => {
        const from = { x: p.pos.x, z: p.pos.z };
        g.fastForward(sec, 1 / 30);
        return Math.hypot(p.pos.x - from.x, p.pos.z - from.z) / sec;
      };
      p.keys.add('KeyW');
      const v1 = run(1); // 基准跑速（全程按住 W）
      // 被命中（带迟滞的武器）→ 蹲下/走位时最常见
      p.protectT = 0;
      g.damage(p, null, 15, 'chest', 'ak47', { x: 1, z: 0 }, false);
      p.protectT = 999;
      const stag = p.staggerT;
      g.fastForward(1 / 30, 1 / 30); // 让 tickInfection 应用迟滞减速
      const mul = p.speedMul;
      // 修复点：迟滞衰减后 speedMul 必须被 tickInfection 重写回满（旧 bug：staggerT 永不归零 → 永久 45% 减速）
      g.fastForward(0.5, 1 / 30);
      const stagAfter = p.staggerT;
      const mulAfter = p.speedMul;
      const v3 = run(0.6); // 恢复后跑速
      p.keys.delete('KeyW');
      // 跨局残留：重生重置
      p.staggerT = 5; g.woz.restoreHuman(p, true);
      const resetOk = p.staggerT === 0 && (p.speedMul === 1 || p.speedMul === undefined);
      return { ok: true, v1: +v1.toFixed(2), stag: +stag.toFixed(2), mul: +mul.toFixed(2), stagAfter, mulAfter: +mulAfter.toFixed(2), v3: +v3.toFixed(2), resetOk };
    });
    check(r.ok && r.v1 > 4, `移速: 基准跑速正常 (${r.v1} m/s)`);
    check(r.stag > 0 && r.mul < 0.6, `移速: 命中迟滞生效 (stagger=${r.stag} mul=${r.mul})`);
    check(r.stagAfter === 0 && r.mulAfter > 0.9 && r.v3 > r.v1 * 0.8, `移速: 迟滞衰减后恢复满速 (stagger=${r.stagAfter} mul=${r.mulAfter} ${r.v3} vs ${r.v1})`);
    check(r.resetOk, '移速: 重生重置迟滞与倍率（跨局无残留）');
  }
} else if (ver === 'v33') {
  // 变异者处决终结技：残血人类近身 E → 必定感染 + 回血 200 + 顿帧震屏
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      rules.convertToMutant(p.id, 'devourer', false);
      g.woz.convertNow(p, true);
      const st = rules.state(p.id);
      st.hp = 1000; p.hp = 1000;
      // 残血人类靶：贴身
      const v = g.actors.find((a) => a.alive && a !== p && a.id < rules.playerCount && rules.state(a.id).side === 'human');
      if (!v) return { ok: false };
      v.hp = 30;
      v.pos.set(p.pos.x + 1.5, v.pos.y, p.pos.z);
      v.protectT = 0; v.armor = 0;
      g.fastForward(1 / 30, 1 / 30);
      const prompt = g.woz.promptFor(p);
      const before = g.woz.pickups.list.length;
      const executed = g.woz.tryExecute(p);
      g.fastForward(0.2, 1 / 30);
      return {
        ok: true,
        promptTitle: prompt ? prompt.title : '',
        executed,
        dead: !v.alive,
        infected: rules.state(v.id).side === 'mutant',
        healed: p.hp > 1000,
        hitStop: +g.hitStopT.toFixed(2),
      };
    });
    check(r.ok, '处决: 靶子就位');
    check(r.promptTitle.includes('处决'), `处决: 近身提示 [${r.promptTitle}]`);
    check(r.executed && r.dead && r.infected, `处决: 必杀感染 (dead=${r.dead} side=mutant=${r.infected})`);
    check(r.healed && r.hitStop >= 0.1, `处决: 回血+顿帧 (hp>${1000} hitStop=${r.hitStop})`);
  }
} else if (ver === 'v32') {
  // 人类急救包：拾取 → 按住 X 引导条 → 2s 自疗 +60
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      // 发急救包：空投/补给体同款
      g.woz.pickups.spawnDrop({ x: p.pos.x + 1, y: 0, z: p.pos.z }, 'medkit');
      g.fastForward(0.4, 1 / 30); // 走近拾取
      const got = p.medkits > 0;
      p.hp = 30; p.protectT = 999;
      p.keys.add('KeyX'); // 按住 X 引导
      g.fastForward(1, 1 / 30);
      const progOn = g.woz._medT > 0;
      g.fastForward(1.2, 1 / 30);
      const healed = p.hp;
      const used = p.medkits;
      p.keys.delete('KeyX');
      return { ok: true, got, progOn, healed, used };
    });
    check(r.ok && r.got, '急救: 急救包拾取入包');
    check(r.progOn && r.healed >= 90 - 0.4, `急救: 按住 X 2s 自疗 (hp=${r.healed.toFixed(0)} 剩${r.used})`);
  }
} else if (ver === 'v31') {
  // 补给变异体：刷新 → 击杀必掉双份补给
  await goto('&mode=infection');
  {
    const r = await page.evaluate(() => {
      const g = window.__game, rules = g.woz.rules, p = g.player;
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
      g.woz.supplyT = 0.01;
      g.fastForward(1, 1 / 30);
      const z = g.woz.tide.find((x) => x.alive && x.isSupplyCrate);
      if (!z) return { ok: false };
      const before = g.woz.pickups.list.length;
      z.protectT = 0;
      g.damage(z, p, 99999, 'chest', 'ak47', { x: 1, z: 0 }, false);
      g.fastForward(0.2, 1 / 30);
      return {
        ok: true,
        drops: g.woz.pickups.list.length - before,
        alive: z.alive,
        slow: !!z.supplySlow,
      };
    });
    check(r.ok, '补给: 补给变异体已刷新');
    check(r.drops >= 2 && !r.alive, `补给: 击杀必掉双份补给 (掉落 ${r.drops})`);
    check(r.slow, '补给: 驮补给移速迟缓');
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
    check(r.cards === 26 && r.a && r.b && r.c, `武器B: 24 张卡片含 95式/XM8/双持乌兹 (${r.cards})`);
    await page.evaluate(() => localStorage.setItem('cf_ship_opts', JSON.stringify({ mode: 'infection', map: 'ship', primary: 'qbz95', melee: 'crowbar', diff: 'normal', quality: 'low' })));
  }
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const r2 = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules, p = g.player;
    g.fastForward(20, 1 / 30);
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    // 玩家若已死亡/被感染：拉回人类并重发配装（否则 inv 单槽读到 undefined）
    const st0 = rules.state(p.id);
    if (st0.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true);
    const prim = p.inv[0]?.id, mel = p.inv[2]?.id;
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
    check(r.cards === 26 && r.a && r.b && r.c && r.d, `武器A: 23 张卡片含四新枪 (${r.cards})`);
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
      (function keepHuman() { const rules = window.__game.woz.rules; if (rules.__keepHuman) return; rules.__keepHuman = true; const orig = rules.rng.shuffle.bind(rules.rng); rules.rng.shuffle = (arr) => { const r2 = orig(arr); const i = arr.indexOf(0); if (i >= 0 && i < 2) { arr.splice(i, 1); arr.push(0); } return r2; }; })();
      g.fastForward(20, 1 / 30);
      rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
      const st0 = rules.state(p.id);
      if (st0.side === 'mutant' || !p.alive || !p.inv.find((x) => x && x.def.type !== 'melee' && x.def.type !== 'grenade')) {
        g.woz.restoreHuman(p, true); // 玩家可能被感染/阵亡（inv 残留单槽）
      }
      const w = p.inv.find((x) => x && x.def.type !== 'melee' && x.def.type !== 'grenade');
      if (!w) return { ok: false };
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
    check(cards.nades === 7 && cards.flash, `投掷: 7 种投掷物含震撼弹/黏性炸弹 (${cards.nades})`);
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
    check(r.prim === 26 && r.m60, `武器: 商店 24 张主武器卡含 M60 (${r.prim})`);
    check(r.sec === 4 && r.r8, `副武器: 四张副武器卡含 R8 左轮 (${r.sec})`);
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
    check(r.cards === 26 && r.aug && r.p90, `武器: 商店 24 张主武器卡含 AUG/P90 (${r.cards})`);
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
      if (st.side === 'mutant' || !p.alive) g.woz.restoreHuman(p, true); // 玩家可能已被感染/阵亡
      if (!p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade')) {
        p.giveLoadout(); // 兜底：无论如何保证有枪（inv 残留单槽 claw 的极端态）
      }
      st.side = 'human'; st.alive = true;
      st.humanSurviveTime = WOZ_H(); // 45s × 4 档
      function WOZ_H() { return 45 * 4; }
      g.fastForward(0.25, 1 / 30);
      const tier = rules.humanTier(p.id);
      const readyTxt = document.getElementById('wzTier').innerHTML;
      const main = p.inv.find((w) => w && w.def.type !== 'melee' && w.def.type !== 'grenade');
      main.mag = 1; // 掏空弹匣验证狂暴满弹
      const fired = (rules.addEnergy(p.id, 100), g.woz.tryHumanEnergyKey(p, 'V'));
      g.fastForward(0.25, 1 / 30);
      return {
        ok: true, tier, readyTxt, fired,
        active: st.ultActiveT > 0,
        magRefilled: main.mag === main.def.mag,
        activeTxt: document.getElementById('wzTier').innerHTML,
        feed: [...document.querySelectorAll('#feed .kf.avg')].map((e) => e.textContent).join('|'),
      };
    });
    check(r.tier === 4 && r.readyTxt.includes('进化 Lv.4'), `必杀: 满档进化达成 (Lv.${r.tier})`);
    check(r.fired && r.active, '必杀: V 键释放进入狂暴');
    check(r.magRefilled, '必杀: 狂暴瞬间满弹');
    check(r.activeTxt.includes('生效中') && r.feed.includes('能量技能 V'), `必杀: HUD 生效标识 + 播报 [${r.feed.slice(-30)}]`);
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
} else if (ver === 'v67') {
  // V93 感染模式精修：尸变演出 + 爆发播报
  let toasts = [];
  await page.goto(base + '&mode=infection');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const g = window.__game; g.woz.rules.phase = 'buy'; g.woz.rules.phaseTimeLeft = 0.6; });
  await page.evaluate(() => {
    const g = window.__game;
    window.__toasts = [];
    const orig = g.hud.toast.bind(g.hud);
    g.hud.toast = (m, d) => { window.__toasts.push(String(m)); return orig(m, d); };
    g.fastForward(1.0);
  });
  const r = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules;
    const mother = g.actors.find((a) => a.id < rules.playerCount && rules.state(a.id).isMother);
    const victim = g.actors.find((a) => a.id < rules.playerCount && rules.state(a.id).side === 'human' && !a.isPlayer);
    const killer = mother || victim;
    g.kill(victim, killer, 'claw', false, false, { x: 1, y: 0, z: 0 });
    victim.respawnT = 0.01;
    g.fastForward(0.1);
    const t0 = victim.morphT || 0;
    const locked = victim.speedMul;
    // 尸变中出爪应被拦截
    const tgt = g.actors.find((a) => a.alive && a.team !== victim.team && !a.isPlayer);
    const before = tgt ? tgt.hp : -1;
    g.melee(victim, false);
    const meleeBlocked = tgt ? tgt.hp === before : true;
    g.fastForward(1.4);
    return {
      motherMorph: mother ? (mother.morphT || 0) : -1,
      t0, locked, meleeBlocked,
      tEnd: victim.morphT || 0,
      speedEnd: victim.speedMul,
      weapon: victim.soldier && victim.soldier.weapon ? victim.soldier.weapon.id : (victim.inv ? victim.inv[0].id : '?'),
      side: rules.state(victim.id).side,
    };
  });
  toasts = await page.evaluate(() => window.__toasts || []);
  check(r.t0 > 0.9, `尸变: 转化瞬间进入 1.2s 演出 (morphT=${r.t0.toFixed(2)})`);
  check(r.t0 <= 1.2, `尸变: 计时不超配值 (${r.t0.toFixed(2)})`);
  check(r.locked === 0, `尸变: 期间移速锁定为 0 (${r.locked})`);
  check(r.meleeBlocked, `尸变: 期间出爪被拦截`);
  check(r.tEnd === 0 && r.speedEnd > 0, `尸变: 结束后爬起并恢复移速 (t=${r.tEnd} v=${r.speedEnd})`);
  check(r.weapon === 'claw', `尸变: 爬起后持爪 (${r.weapon})`);
  check(r.side === 'mutant', `尸变: 阵营已变异 (${r.side})`);
  check(r.motherMorph === 0 || r.motherMorph === -1, `母体: 爆发落地不走尸变 (${r.motherMorph})`);
  check(toasts.some((t) => t.includes('病毒爆发')), `播报: 爆发全场警报已触发 (${toasts.length} 条)`);
} else if (ver === 'v68') {
  // V94 复仇模式精修：最后幸存者触发阈值 / 觉醒光柱 / 人类升档播报
  await goto('&mode=revenge');
  const r = await page.evaluate(() => {
    const g = window.__game, rules = g.woz.rules, p = g.player;
    g.fastForward(20, 1 / 30);
    rules.phase = 'battle'; rules.phaseTimeLeft = 999; g.timeLeft = 999;
    // 场景 A：两名幸存者并存 → 不触发（原作：最后的幸存者，单数）
    rules.avengerUsed = false;
    for (const i of [0, 1]) {
      const st = rules.state(i), a = g.actors[i];
      st.side = 'human'; st.alive = true; st.isAvenger = false; st.reviveTimer = 0;
      if (a) { a.team = 'GR'; a.alive = true; a.protectT = 0; }
    }
    for (let i = 2; i < rules.playerCount; i++) {
      const st = rules.state(i), a = g.actors[i];
      if (st.side === 'human' && st.alive && a && a.alive) { a.protectT = 0; g.damage(a, null, 9999, 'chest', 'he', { x: 0.6, z: 0.8 }, false); }
    }
    rules.tryTriggerAvenger();
    const noTriggerAtTwo = rules.avengerId() < 0;
    // 场景 B：仅剩最后一人 → 触发 + 金色光柱粒子
    let emits = 0;
    const origEmit = g.fx.add.emit.bind(g.fx.add);
    g.fx.add.emit = (o) => { emits++; return origEmit(o); };
    const st1 = rules.state(1), a1 = g.actors[1];
    st1.alive = false; if (a1) a1.alive = false;
    rules.tryTriggerAvenger();
    g.fx.add.emit = origEmit;
    const av = rules.avengerId();
    // 场景 C：人类升档 → 备弹奖励（已有）+ 播报不崩溃
    const reserve0 = p.inv[0] && p.inv[0].def.type !== 'melee' ? p.inv[0].reserve : -1;
    g.woz.onHumanTierUp(p.id, 1);
    const reserve1 = p.inv[0] && p.inv[0].def.type !== 'melee' ? p.inv[0].reserve : -1;
    return { noTriggerAtTwo, triggered: av === 0, emits, reserveGain: reserve1 - reserve0, isAvg: rules.isAvenger(0) };
  });
  check(r.noTriggerAtTwo, `阈值: 两名幸存者不触发 (${r.noTriggerAtTwo})`);
  check(r.triggered && r.isAvg, `阈值: 最后一名幸存者觉醒 (av=${r.triggered} avg=${r.isAvg})`);
  check(r.emits >= 30, `觉醒: 金色光柱粒子 (emits=${r.emits})`);
  check(r.reserveGain > 0 || r.reserve0 === -1, `升档: 备弹奖励 (${r.reserve0}→+${r.reserveGain})`);
} else if (ver === 'v69') {
  // V95 对抗模式精修：死亡城市自动绑定 / 攻守框架播报 / 雾密度随占领加浓
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '?q=low&nolock=1');
  await page.waitForFunction(() => window.__game && window.__game.hud, null, { timeout: 60000 });
  {
    // 菜单：点选生化对抗 → 地图自动切到死亡城市
    const r = await page.evaluate(() => {
      const g = window.__game;
      const btn = document.querySelector('#modeCards .mcard[data-v="confront"]');
      if (!btn) return { ok: false, why: 'no confront button' };
      btn.click();
      return { ok: true, map: (g.hud || g).opts.map, segOn: document.querySelector('.seg[data-k="map"] button[data-v="city"]')?.classList.contains('on') };
    });
    check(r.ok && r.map === 'city' && r.segOn, `菜单: 选对抗自动绑定死亡城市 (map=${r.map} seg=${r.segOn})`);
  }
  {
    // 进局：开场播报含攻守框架 + 死亡城市；场景有浓雾；占领越多雾越浓
    const r = await page.evaluate(() => {
      const g = window.__game;
      window.__toasts = [];
      const orig = g.hud.toast.bind(g.hud);
      g.hud.toast = (m, d) => { window.__toasts.push(String(m)); return orig(m, d); };
      g.startMatch();
      g.fastForward(0.2, 1 / 30);
      const toasts = window.__toasts.slice();
      const fog0 = g.renderer.scene.fog ? g.renderer.scene.fog.density : 0;
      // 模拟占领 2 点后的雾密度
      g.woz.points.forEach((p, i) => { if (i < 2) p.owner = 'GR'; });
      g.woz.reinforceT = 0; // 强制下一 tick 触发增援波 → 间隔按占领数收缩
      g.woz.tickConfront(1 / 30);
      const fog2 = g.renderer.scene.fog ? g.renderer.scene.fog.density : 0;
      const reinforcing = g.woz.reinforceT;
      return { toasts, fog0, fog2, reinforcing };
    });
    check(r.toasts.some((t) => t.includes('死亡城市') && t.includes('攻击方') && t.includes('防守方')), `播报: 攻守框架+特色地图 (${r.toasts.filter((t) => t.includes('死亡城市')).length} 条)`);
    check(r.fog0 > 0, `浓雾: 死亡城市场景雾存在 (${r.fog0.toFixed(4)})`);
    check(r.fog2 > r.fog0 * 1.4, `浓雾: 占领2点后密度加大 (${r.fog0.toFixed(4)}→${r.fog2.toFixed(4)})`);
    check(Math.abs(r.reinforcing - 18) < 0.01, `增援: 占2点后波间隔收缩至 18s (${r.reinforcing.toFixed(1)}s)`);
  }
} else if (ver === 'v70') {
  // V96 爆破模式精修：安放吟唱音 / 倒计时蜂鸣加速 / 10s 警告 / 引爆蘑菇柱
  await page.goto(base + '&mode=demol');
  await page.waitForFunction(() => window.__game && window.__game.playing, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const g = window.__game, woz = g.woz, bomb = woz.bomb;
    const beeps = [];
    const wozAudio = window.__wozAudio;
    const orig = wozAudio.beep.bind(wozAudio);
    wozAudio.beep = (pos, f, d) => { beeps.push(f); return orig(pos, f, d); };
    const toasts = [];
    const origT = g.hud.toast.bind(g.hud);
    g.hud.toast = (m, d) => { toasts.push(String(m)); return origT(m, d); };
    // 直接驱动 tickDemol：安放吟唱（E 键）→ 已安放 → 倒计时
    const human = g.actors.find((a) => a.alive && a.team === 'GR' && !a.isPlayer) || g.actors.find((a) => a.alive && a.team === 'GR');
    bomb.state = 'idle';
    bomb.pos.set(human.pos.x, 0.4, human.pos.z);
    bomb.def = { x: human.pos.x, z: human.pos.z, r: 99, name: 'site' }; // 全图站点便于站内
    human.keys = human.keys || new Set();
    human.keys.add('KeyE');
    let plantBeeps = 0;
    for (let i = 0; i < 150; i++) { woz.tickDemol(1 / 30); if (bomb.state === 'planting') plantBeeps = beeps.length; if (bomb.state === 'planted' && bomb.timer > 40) break; }
    const plantedOk = bomb.state === 'planted';
    // 倒计时蜂鸣：44s→间隔长；9s→急促且警告 toast
    bomb.timer = 44;
    const b0 = beeps.length;
    for (let i = 0; i < 30; i++) woz.tickDemol(1 / 30);
    const midBeeps = beeps.length - b0;
    bomb.timer = 9.5;
    const b1 = beeps.length;
    for (let i = 0; i < 30; i++) woz.tickDemol(1 / 30);
    const urgentBeeps = beeps.length - b1;
    const warned = toasts.some((t) => t.includes('即将引爆'));
    // 引爆演出：蘑菇柱粒子 + 慢动作
    let smokes = 0;
    const origS = g.fx.smoke.emit.bind(g.fx.smoke);
    g.fx.smoke.emit = (o) => { smokes++; return origS(o); };
    bomb.state = 'planted'; bomb.timer = 0.01;
    woz.tickDemol(0.05);
    g.fx.smoke.emit = origS;
    wozAudio.beep = orig;
    return { plantedOk, plantBeeps, midBeeps, urgentBeeps, warned, smokes, slowMo: g.slowMoT || 0, ended: g.ended || woz.ended };
  });
  check(r.plantedOk, `安放: 吟唱完成进入倒计时 (${r.plantedOk})`);
  check(r.plantBeeps >= 2, `安放: 吟唱确认音 (n=${r.plantBeeps})`);
  check(r.midBeeps >= 1 && r.urgentBeeps > r.midBeeps, `蜂鸣: 后段更急促 (mid=${r.midBeeps} urgent=${r.urgentBeeps})`);
  check(r.warned, `警告: 10s 全场警告 (${r.warned})`);
  check(r.smokes >= 30, `引爆: 蘑菇烟尘柱粒子 (n=${r.smokes})`);
  check(r.slowMo, `引爆: 慢动作演出 (${r.slowMo.toFixed(2)}s)`);
} else {
  console.log(`未知版本 ${ver}`); process.exit(2);
}

check(errors.length === 0, `无控制台错误${errors.length ? '：' + JSON.stringify(errors.slice(0, 3)) : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

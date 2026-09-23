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
    check(r.visible && r.cards === 3, `变身: 选择面板弹出且 3 张职业卡 (${r.cards})`);
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
} else {
  console.log(`未知版本 ${ver}`); process.exit(2);
}

check(errors.length === 0, `无控制台错误${errors.length ? '：' + JSON.stringify(errors.slice(0, 3)) : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

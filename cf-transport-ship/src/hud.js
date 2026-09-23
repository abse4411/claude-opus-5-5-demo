// HUD 与菜单（DOM）
import { WEAPONS, PRIMARIES } from './weapons.js';

const TEAM_CN = { BL: '潜伏者', GR: '保卫者' };
const $ = (s, r = document) => r.querySelector(s);

const HS_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="none" stroke="#ff4030" stroke-width="3"><circle cx="20" cy="20" r="11"/><path d="M20 2v10M20 28v10M2 20h10M28 20h10"/></g><circle cx="20" cy="20" r="3.5" fill="#ff4030"/></svg>`);
const WB_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="15" y="4" width="10" height="32" fill="#bbb"/><path d="M2 20h36" stroke="#ffd24a" stroke-width="3"/></svg>`);
const BADGE_SVG = (color, inner) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="bg" cx="50%" cy="45%"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset="1" stop-color="#1a0a00" stop-opacity=".9"/></radialGradient></defs><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="url(#bg)" stroke="#ffd24a" stroke-width="3"/>${inner}</svg>`;
const SKULL = `<g fill="#fff"><path d="M50 22c-14 0-24 9-24 22 0 8 4 13 9 16v9h30v-9c5-3 9-8 9-16 0-13-10-22-24-22z"/><rect x="40" y="66" width="4" height="8"/><rect x="48" y="66" width="4" height="8"/><rect x="56" y="66" width="4" height="8"/></g><circle cx="41" cy="45" r="6" fill="#3a1500"/><circle cx="59" cy="45" r="6" fill="#3a1500"/>`;
const CROSSHAIR_B = `<g fill="none" stroke="#fff" stroke-width="4"><circle cx="50" cy="50" r="20"/><path d="M50 18v14M50 68v14M18 50h14M68 50h14"/></g><circle cx="50" cy="50" r="5" fill="#ff3020"/>`;

export class HUD {
  constructor(game) {
    this.g = game;
    this.root = $('#ui');
    this.root.innerHTML = TEMPLATE;
    this.el = {};
    for (const n of this.root.querySelectorAll('[id]')) this.el[n.id] = n;
    this.icons = {};
    this.feedItems = [];
    this.dmgDirs = [];
    this.hitT = 0; this.toastT = 0;
    this.slotsT = 0;
    this.radarCtx = this.el.radar.getContext('2d');
    const touch = matchMedia('(pointer:coarse)').matches;
    this.opts = { mode: 'tdm', map: 'ship', team: 'BL', primary: 'ak47', size: 6, diff: 'normal', goal: 50, tod: 'day', quality: touch ? 'low' : 'high', sens: 1.0, fov: 78, vol: 0.8 };
    try { Object.assign(this.opts, JSON.parse(localStorage.getItem('cf_ship_opts') || '{}')); } catch (e) { /* 忽略 */ }
    this.buildMenu();
    this.showModeInfo(this.opts.mode);
    this.showMapMeta(this.opts.map);
  }
  saveOpts() { try { localStorage.setItem('cf_ship_opts', JSON.stringify(this.opts)); } catch (e) { /* 忽略 */ } }

  // ---------- 模式机制说明 ----------
  static MODE_INFO = {
    tdm: { name: '团队竞技', desc: '经典 PVP 对战。<b>人类内战</b>：潜伏者 vs 保卫者，用枪械一决高下。率先达到目标击杀数或时间结束时比分领先的队伍获胜。阵亡 4 秒后在后方出生点复活。' },
    infection: { name: '生化感染', desc: '购买期结束后随机 <b>2 名玩家变为母体变异者</b>（3000HP）。变异者用利爪攻击人类，人类<b>阵亡即被感染</b>并转化为变异者。任意人类存活到 180 秒战斗期结束或全歼变异者=人类胜；全员感染=变异者胜。变异者按 <b>5/6/7/8</b> 变身夜行者/噬魂者/猎食者/缠绕者，<b>E</b> 吞噬尸体回血进化，<b>G</b> 释放技能。' },
    revenge: { name: '生化复仇', desc: '感染规则 + 双向进化：变异者可<b>复活并再变异</b>（HP×1.25/伤害×1.2）；人类濒败（存活≤2 人或剩余≤45 秒）时伤害最高者觉醒为<b>生化复仇者</b>——1500HP 电锯，轻击 500/重击必杀，被其击杀的变异者无法复活。最后 60 秒降临尸潮。' },
    bio: { name: '生化模式', desc: '经典感染变体：地图上持续刷新 <b>AI 变异爬行者</b>（300HP），击杀它们会掉落<b>医疗包/弹药箱/生化能量</b>（拾取后技能充满）三种补给。其余规则与生化感染一致。' },
    confront: { name: '生化对抗', desc: '人类攻方 vs 变异者守方。地图上有 <b>A/B/C 三个战术据点</b>：站入据点内人数占优即可推进占领进度（双方在场则争夺冻结）。<b>占领全部据点=人类胜</b>；守到时间耗尽=变异者胜。守卫变异者会分区驻守。双方阵亡后可复活。' },
    demol: { name: '生化爆破', desc: '人类攻入地图西侧的<b>变异者巢穴</b>，站入红色区域 4 秒<b>安放核弹</b>（倒计时 45 秒）。<b>率先完成安放的人类进化为英雄</b>（200HP/伤害×1.25/加速）。核弹引爆=人类胜；变异者站上核弹 8 秒将其摧毁，或安放前团灭人类=变异者胜。变异者限量复活。' },
  };
  showModeInfo(mode) {
    const info = HUD.MODE_INFO[mode];
    const el = document.getElementById('modeInfo');
    if (el && info) el.innerHTML = `<b style="color:#f5b321">${info.name}</b>｜${info.desc}`;
  }
  static MAP_META = {
    ship: '运输船：经典对称船舱攻防，中路集装箱与两侧二层管道。全部模式可用。',
    city: '死亡城市：三线开阔街道，巴士/喷泉/车阵掩体。爆破模式巢穴在西侧，对抗据点沿中路纵列分布。',
    lab: '生化实验室：室内环形动线，中央标本厅培养罐阵与玻璃观察窗掩体，近距离交火密集。',
    plaza: '都会广场：开阔环岛与中央雕像，三条大道辐射。视野开阔，适合狙击与尸潮冲锋。',
    harbor: '雾港：浓雾大幅降低可视距离，港区集装箱迷宫。适合伏击与听声辨位。',
  };
  showMapMeta(map) {
    const el = document.getElementById('mapMeta');
    if (el) el.textContent = HUD.MAP_META[map] || '';
  }

  // ---------- 菜单 ----------
  buildMenu() {
    const o = this.opts;
    const segs = this.root.querySelectorAll('.seg[data-k]');
    for (const s of segs) {
      const k = s.dataset.k;
      for (const b of s.querySelectorAll('button')) {
        if (String(o[k]) === b.dataset.v) b.classList.add('on');
        b.addEventListener('click', () => {
          for (const x of s.querySelectorAll('button')) x.classList.remove('on');
          b.classList.add('on');
          o[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
          this.saveOpts();
          if (k === 'mode') this.showModeInfo(o[k]);
          if (k === 'map') this.showMapMeta(o[k]);
          this.g.onOption?.(k, o[k]);
          this.g.audio?.playUI('click');
        });
      }
    }
    for (const sl of this.root.querySelectorAll('.slider[data-k]')) {
      const k = sl.dataset.k, inp = sl.querySelector('input'), sp = sl.querySelector('span');
      inp.value = o[k]; sp.textContent = (+o[k]).toFixed(k === 'fov' ? 0 : 2);
      inp.addEventListener('input', () => {
        o[k] = +inp.value; sp.textContent = (+inp.value).toFixed(k === 'fov' ? 0 : 2); this.saveOpts();
        this.g.onOption?.(k, o[k]);
      });
    }
    // WOZ 模式大卡片（替代模式 seg）
    for (const c of this.root.querySelectorAll('#modeCards .mcard')) {
      c.classList.toggle('on', String(o.mode) === c.dataset.v);
      c.addEventListener('click', () => {
        o.mode = c.dataset.v;
        for (const x of this.root.querySelectorAll('#modeCards .mcard')) x.classList.toggle('on', x === c);
        this.showModeInfo(o.mode);
        this.saveOpts();
        this.g.onOption?.('mode', o.mode);
        this.g.audio?.playUI('click');
      });
    }
    $('#btnStart').addEventListener('click', () => this.g.startMatch());
    $('#btnResume').addEventListener('click', () => this.g.resume());
    $('#btnQuit').addEventListener('click', () => this.g.quitToMenu());
    $('#btnAgain').addEventListener('click', () => this.g.startMatch());
    $('#btnMenu').addEventListener('click', () => this.g.quitToMenu());
    for (const c of this.root.querySelectorAll('#loadCards .card')) {
      c.addEventListener('click', () => {
        this.g.chooseLoadout(c.dataset.w);
        for (const x of this.root.querySelectorAll('#loadCards .card')) x.classList.toggle('on', x === c);
      });
    }
    for (const c of this.root.querySelectorAll('#nadeCards .card')) {
      c.addEventListener('click', () => {
        this.g.chooseGrenade?.(c.dataset.g);
        for (const x of this.root.querySelectorAll('#nadeCards .card')) x.classList.toggle('on', x === c);
      });
    }
    $('#btnLoadClose').addEventListener('click', () => this.g.closeLoadout());
    $('#btnHelpClose').addEventListener('click', () => this.g.toggleHelp());
    if (matchMedia('(pointer:coarse)').matches) $('#touchNote').classList.remove('hidden');
    for (const a of this.root.querySelectorAll('#clinks a, .mlinks a'))
      a.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }
  setIcons(icons) {
    this.icons = icons;
    for (const c of this.root.querySelectorAll('#loadCards .card')) c.querySelector('img').src = icons[c.dataset.w] || '';
    for (const c of this.root.querySelectorAll('#nadeCards .card')) c.querySelector('img').src = icons[c.dataset.g] || '';
  }
  syncControls() {
    const o = this.opts;
    for (const s of this.root.querySelectorAll('.seg[data-k]')) for (const b of s.querySelectorAll('button')) b.classList.toggle('on', String(o[s.dataset.k]) === b.dataset.v);
    for (const c of this.root.querySelectorAll('#modeCards .mcard')) c.classList.toggle('on', String(o.mode) === c.dataset.v);
    for (const sl of this.root.querySelectorAll('.slider[data-k]')) {
      const k = sl.dataset.k; sl.querySelector('input').value = o[k]; sl.querySelector('span').textContent = (+o[k]).toFixed(k === 'fov' ? 0 : 2);
    }
  }
  show(name) {
    if (name === 'menu' || name === 'pause') this.syncControls();
    for (const n of ['menu', 'pause', 'end', 'loadout', 'loading', 'help']) this.el[n].classList.toggle('hidden', n !== name);
    this.el.hud.classList.toggle('hidden', name === 'menu' || name === 'loading' || name === 'end');
  }
  // 帮助中心：当前模式机制 + 完整键位
  fillHelp(mode) {
    const info = HUD.MODE_INFO[mode];
    const el1 = document.getElementById('helpMode');
    const el2 = document.getElementById('helpDesc');
    const el3 = document.getElementById('helpKeys');
    if (el1) el1.textContent = info?.name || '';
    if (el2) el2.innerHTML = info?.desc || '';
    if (el3) el3.innerHTML = [
      '<kbd>W A S D</kbd> 移动 · <kbd>Shift</kbd> 静步 · <kbd>空格</kbd> 跳 · <kbd>C</kbd> 蹲',
      '<kbd>左键</kbd> 开火 · <kbd>右键</kbd> 开镜/重击 · <kbd>R</kbd> 换弹 · <kbd>B</kbd> 武器商店',
      '人类：<kbd>E</kbd> 拾取地面武器 / 按住安放核弹',
      '变异者：<kbd>E</kbd> 吞噬尸体回血 · <kbd>G</kbd> 释放职业技能 · <kbd>5/6/7/8</kbd> 切换形态',
      '死亡后：<kbd>空格</kbd> 切换 自由 / 队友第一人称 / 队友第三人称 观战',
      '<kbd>Tab</kbd> 计分板 · <kbd>H</kbd> 帮助 · <kbd>Esc</kbd> 暂停',
    ].map((s) => `<div>${s}</div>`).join('');
  }
  loading(p, text) { this.el.loadBar.style.width = (p * 100).toFixed(0) + '%'; if (text) this.el.loadTxt.textContent = text; }

  // ---------- 局内 ----------
  update(dt, s) {
    const e = this.el;
    // 比分与时间
    e.sBL.textContent = s.score.BL; e.sGR.textContent = s.score.GR;
    const tl = Math.max(0, s.timeLeft), mm = (tl / 60) | 0, ss = (tl % 60) | 0;
    e.sTime.textContent = `${mm}:${ss < 10 ? '0' : ''}${ss}`;
    e.sGoal.textContent = this.g.woz ? this.g.woz.modeCN() : `团队竞技 · 目标 ${s.goal}`;
    e.tBL.classList.toggle('mine', s.myTeam === 'BL'); e.tGR.classList.toggle('mine', s.myTeam === 'GR');
    // 生命护甲
    e.hpVal.textContent = Math.max(0, Math.ceil(s.hp));
    e.arVal.textContent = Math.max(0, Math.ceil(s.armor));
    e.hpBox.classList.toggle('low', s.hp <= 30 && s.alive);
    // 弹药
    const w = s.weapon;
    if (w) {
      const d = w.def;
      e.wName.textContent = d.hudName;
      if (d.type === 'melee') { e.aMag.textContent = '∞'; e.aRes.textContent = ''; }
      else if (d.type === 'grenade') { e.aMag.textContent = w.mag; e.aRes.textContent = ''; }
      else { e.aMag.textContent = w.mag; e.aRes.textContent = '/ ' + w.reserve; }
      e.aMag.classList.toggle('low', d.mag > 1 && w.mag <= Math.ceil(d.mag * 0.2));
      if (this.icons[d.id] && e.wIcon.dataset.id !== d.id) { e.wIcon.src = this.icons[d.id]; e.wIcon.dataset.id = d.id; }
      e.aHint.textContent = w.reloading ? '换弹中…' : (d.mag > 1 && w.mag === 0 && w.reserve === 0 ? '弹药耗尽' : (d.mag > 1 && w.mag === 0 ? '按 R 换弹' : ''));
    }
    // 准星
    const showX = s.alive && !s.scoped && w && w.def.type !== 'sniper';
    e.cross.style.display = showX ? '' : 'none';
    if (showX) {
      const gap = 4 + s.spreadPx;
      e.cT.style.top = -(gap + 9) + 'px'; e.cB.style.top = gap + 'px';
      e.cL.style.left = -(gap + 9) + 'px'; e.cR.style.left = gap + 'px';
    }
    e.scope.classList.toggle('on', !!s.scoped && s.alive);
    // 命中标记
    if (this.hitT > 0) { this.hitT -= dt; e.hit.style.opacity = Math.min(1, this.hitT * 5); } else e.hit.style.opacity = 0;
    // 受击方向
    for (const d of this.dmgDirs) {
      d.t -= dt;
      const rel = d.ang - s.yaw;
      d.el.style.transform = `rotate(${-rel}rad)`;
      d.el.style.opacity = Math.max(0, Math.min(1, d.t));
      if (d.t <= 0) d.el.remove();
    }
    this.dmgDirs = this.dmgDirs.filter((d) => d.t > 0);
    // 击杀信息淡出
    const now = performance.now();
    this.feedItems = this.feedItems.filter((f) => { if (now - f.t > (f.life || 7000)) { f.el.remove(); return false; } return true; });
    // 提示
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.style.opacity = 0; }
    // 中央信息
    if (!s.alive && s.respawnIn > 0) {
      e.center.classList.remove('hidden');
      e.cBig.innerHTML = s.killedBy || '你阵亡了';
      e.cSmall.textContent = s.respawnIn > 30 ? '你已出局 · 等待回合结束' : `${s.respawnIn.toFixed(1)} 秒后复活 · 按 B 更换武器`;
    } else e.center.classList.add('hidden');
    e.protect.textContent = s.protect > 0 && s.alive ? `出生保护 ${s.protect.toFixed(1)}s（开火即解除）` : '';
    e.nameTip.textContent = s.aimName || ''; e.nameTip.className = s.aimTeam || '';
    if (this.slotsT > 0) { this.slotsT -= dt; e.slots.style.opacity = Math.min(1, this.slotsT * 2); } else e.slots.style.opacity = 0;
    // 武器商店：WOZ 购买期倒计时
    const rules = this.g.woz?.rules;
    if (rules && rules.phase === 'buy') {
      e.loadTimer.innerHTML = ` ｜ ⏱ 购买期剩余 <b style="color:#ffd24a">${Math.ceil(rules.phaseTimeLeft)}</b> 秒（按 B 打开商店）`;
    } else if (e.loadTimer.innerHTML) {
      e.loadTimer.innerHTML = '';
    }
  }
  slots(inv, cur) {
    const e = this.el.slots;
    e.innerHTML = '';
    ['主武器', '副武器', '近身', '投掷'].forEach((lab, i) => {
      const w = inv[i];
      if (!w) return;
      const d = document.createElement('div');
      d.className = 's' + (i === cur ? ' on' : '');
      d.innerHTML = `<span>${w.def.name}</span><img src="${this.icons[w.id] || ''}"><b>${i + 1}</b>`;
      e.appendChild(d);
    });
    this.slotsT = 2.2;
  }
  killFeed(k, v, wid, hs, wb, mine) {
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' me' : '');
    const icon = this.icons[wid] ? `<img src="${this.icons[wid]}">` : `<span>[${WEAPONS[wid]?.name || wid}]</span>`;
    d.innerHTML = (k ? `<span class="k ${k.team}">${esc(k.name)}</span>` : '') + icon + (wb ? `<img class="hs" src="${WB_ICON}">` : '') + (hs ? `<img class="hs" src="${HS_ICON}">` : '') + `<span class="v ${v.team}">${esc(v.name)}</span>`;
    this.el.feed.prepend(d);
    this.feedItems.push({ el: d, t: performance.now() });
    while (this.feedItems.length > 6) { const f = this.feedItems.shift(); f.el.remove(); }
  }
  // WOZ 事件播报（感染/进化/复仇者/尸潮），cls: inf|evo|avg|tide
  eventFeed(html, cls, dur = 8) {
    const d = document.createElement('div');
    d.className = 'kf evt ' + (cls || '');
    d.innerHTML = html;
    this.el.feed.prepend(d);
    this.feedItems.push({ el: d, t: performance.now(), life: dur * 1000 });
    while (this.feedItems.length > 7) { const f = this.feedItems.shift(); f.el.remove(); }
  }
  hitmarker(hs, kill) {
    this.el.hit.className = kill ? 'kill' : hs ? 'hs' : '';
    this.hitT = kill ? 0.45 : 0.22;
  }
  damageFrom(ang) {
    const d = document.createElement('div'); d.className = 'dd';
    this.el.dmgDirs.appendChild(d);
    this.dmgDirs.push({ el: d, ang, t: 1.4 });
  }
  badge(text, sub, headshot) {
    const b = this.el.badge;
    b.classList.remove('show'); void b.offsetWidth;
    b.querySelector('.ico').innerHTML = BADGE_SVG(headshot ? '#c0301a' : '#b8860b', headshot ? CROSSHAIR_B : SKULL);
    b.querySelector('.txt').textContent = text;
    b.querySelector('.sub').textContent = sub || '';
    b.classList.add('show');
  }
  toast(text, dur = 2.5) { const t = this.el.toast; t.innerHTML = text; t.style.opacity = 1; this.toastT = dur; }
  // 底部中央情境交互提示条（目标区域 / 拾取），每帧由 game.updateHud 驱动
  setPrompt(p) {
    const e = this.el.prompt;
    if (!p) {
      if (this.promptOn) { e.classList.remove('on'); this.promptOn = false; this.promptSig = ''; }
      return;
    }
    const sig = p.kind + '|' + p.title + '|' + (p.sub || '');
    if (sig !== this.promptSig) {
      this.promptSig = sig;
      e.className = p.kind;
      e.innerHTML = `<div class="pcard"><div class="ttl">${p.title}</div>${p.prog !== undefined ? '<div class="bar"><i></i></div>' : ''}${p.sub ? `<div class="sub">${p.sub}</div>` : ''}</div>`;
      e.classList.add('on');
      this.promptOn = true;
    }
    if (p.prog !== undefined) {
      const bar = e.querySelector('.bar i');
      if (bar) bar.style.width = `${Math.max(0, Math.min(1, p.prog)) * 100}%`;
    }
  }
  scoreboard(show, actors, myId, score, roleOf) {
    this.el.board.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = (team) => actors.filter((a) => a.team === team).sort((a, b) => b.stats.k - a.stats.k || a.stats.d - b.stats.d)
      .map((a) => `<tr class="${a.id === myId ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td>${esc(a.name)}</td><td class="role">${roleOf ? roleOf(a) : '—'}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.hs}</td><td>${a.ping}</td></tr>`).join('');
    const tbl = (team) => `<table class="t${team}"><tr><th class="team">${TEAM_CN[team]} · ${score[team]}</th><th>角色</th><th>击杀</th><th>死亡</th><th>爆头</th><th>延迟</th></tr>${rows(team)}</table>`;
    this.el.boardBody.innerHTML = `<div class="cols">${tbl('BL')}${tbl('GR')}</div>`;
  }
  endScreen(win, score, actors, myId) {
    this.show('end');
    const r = this.el.endRes;
    r.textContent = win === null ? '平局' : win ? '胜利' : '失败';
    r.className = 'res ' + (win ? 'win' : 'lose');
    this.el.endSc.textContent = `潜伏者 ${score.BL} : ${score.GR} 保卫者`;
    const mvp = [...actors].sort((a, b) => (b.stats.k * 2 - b.stats.d + b.stats.hs) - (a.stats.k * 2 - a.stats.d + a.stats.hs))[0];
    this.el.endMvp.textContent = mvp ? `MVP：${mvp.name}（${mvp.stats.k} 杀 / ${mvp.stats.hs} 爆头）` : '';
    const me = actors.find((a) => a.id === myId);
    const acc = me && me.stats.shots ? ((me.stats.hits / me.stats.shots) * 100).toFixed(1) : '0';
    this.el.endMe.textContent = me ? `你的战绩：${me.stats.k} 击杀 · ${me.stats.d} 死亡 · ${me.stats.hs} 爆头 · 命中率 ${acc}%` : '';
    const rows = (team) => actors.filter((a) => a.team === team).sort((a, b) => b.stats.k - a.stats.k)
      .map((a) => `<tr class="${a.id === myId ? 'me' : ''}"><td>${esc(a.name)}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.hs}</td></tr>`).join('');
    const tbl = (team) => `<table class="t${team}"><tr><th class="team">${TEAM_CN[team]}</th><th>击杀</th><th>死亡</th><th>爆头</th></tr>${rows(team)}</table>`;
    this.el.endTable.innerHTML = `<div class="cols">${tbl('BL')}${tbl('GR')}</div>`;
  }
  // ---------- 小地图 ----------
  buildRadar(world) {
    const S = 8; // px/m
    const cols = [...world.colliders].filter((k) => k.solid && k.top > 0.3 && k.bottom < 2 && k.hx < 30 && k.tag !== 'deck').sort((a, b) => a.top - b.top);
    // 自动计算地图包围盒（旋转碰撞体按外接框计），任意地图通用
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const k of cols) {
      const c = Math.abs(Math.cos(k.yaw || 0)), s = Math.abs(Math.sin(k.yaw || 0));
      const ex = k.hx * c + k.hz * s, ez = k.hx * s + k.hz * c;
      x0 = Math.min(x0, k.x - ex); x1 = Math.max(x1, k.x + ex);
      z0 = Math.min(z0, k.z - ez); z1 = Math.max(z1, k.z + ez);
    }
    if (!isFinite(x0)) { x0 = -37; x1 = 37; z0 = -13; z1 = 13; }
    x0 -= 2; x1 += 2; z0 -= 2; z1 += 2;
    const W = Math.ceil((x1 - x0) * S), H = Math.ceil((z1 - z0) * S);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(70,80,84,0.95)'; x.fillRect(0, 0, W, H);
    const OX = -x0, OZ = -z0; // 世界坐标 → 画布像素偏移
    for (const k of cols) {
      if (k.bullet === 'pass' && k.mat !== 'mesh') continue;
      x.save();
      x.translate((k.x + OX) * S, (k.z + OZ) * S);
      x.rotate(-k.yaw);
      const hgt = k.top;
      x.fillStyle = k.mat === 'mesh' ? 'rgba(200,200,190,.5)' : hgt > 4 ? '#1d2327' : hgt > 2 ? '#2d353a' : hgt > 1.3 ? '#3b454b' : '#56616a';
      x.fillRect(-k.hx * S, -k.hz * S, k.hx * 2 * S, k.hz * 2 * S);
      x.strokeStyle = 'rgba(0,0,0,.5)'; x.lineWidth = 1;
      x.strokeRect(-k.hx * S, -k.hz * S, k.hx * 2 * S, k.hz * 2 * S);
      x.restore();
    }
    // 运输船管道顶棚（二楼）用虚线表示
    if (this.g?.mapName === '运输船') {
      x.strokeStyle = 'rgba(245,179,33,.35)'; x.setLineDash([6, 4]);
      x.strokeRect((-29.5 + OX) * S, (9.4 + OZ) * S, 36.6 * S, 2.44 * S);
      x.strokeRect((29.5 - 36.6 + OX) * S, (-11.84 + OZ) * S, 36.6 * S, 2.44 * S);
    }
    this.radarImg = c; this.radarS = S; this.radarOX = OX; this.radarOZ = OZ;
  }
  drawRadar(me, actors, t, markers) {
    const ctx = this.radarCtx, cv = this.el.radar;
    const W = cv.width = cv.clientWidth * 1.5 | 0, H = cv.height = cv.clientHeight * 1.5 | 0;
    ctx.clearRect(0, 0, W, H);
    if (!this.radarImg) return;
    const S = this.radarS, zoom = 0.55 * (W / 294);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(me.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(me.pos.x + this.radarOX) * S, -(me.pos.z + this.radarOZ) * S);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.radarImg, 0, 0);
    ctx.globalAlpha = 1;
    for (const a of actors) {
      if (a === me) continue;
      const seen = a.team === me.team || (a.radarT > 0);
      if (!seen) continue;
      const px = (a.pos.x + this.radarOX) * S, pz = (a.pos.z + this.radarOZ) * S;
      if (!a.alive) {
        if (a.team !== me.team || a.deadT > 5) continue;
        ctx.strokeStyle = '#9aa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - 8, pz - 8); ctx.lineTo(px + 8, pz + 8); ctx.moveTo(px + 8, pz - 8); ctx.lineTo(px - 8, pz + 8); ctx.stroke();
        continue;
      }
      ctx.fillStyle = a.team === me.team ? '#4fb0ff' : '#ff4a3a';
      if (a.team === me.team) {
        ctx.save(); ctx.translate(px, pz); ctx.rotate(-a.yaw);
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.min(1, a.radarT);
        ctx.beginPath(); ctx.arc(px, pz, 9, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    // 自己
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2 + 7, H / 2 + 8); ctx.lineTo(W / 2, H / 2 + 4); ctx.lineTo(W / 2 - 7, H / 2 + 8); ctx.closePath(); ctx.fill();
    // 视野扇形
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45);
    g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.arc(W / 2, H / 2, W * 0.45, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.closePath(); ctx.fill();
    // 目标点标记层（据点 / 核弹站点 / 已安放核弹），出界钳制到雷达边缘
    if (markers && markers.length) this.drawRadarMarkers(ctx, W, H, me, markers, t, zoom);
  }
  markerScreenPos(me, m, W, H, zoom) {
    const S = this.radarS;
    const dx = (m.x - me.pos.x) * S, dz = (m.z - me.pos.z) * S;
    const cos = Math.cos(me.yaw), sin = Math.sin(me.yaw);
    let sx = W / 2 + (dx * cos - dz * sin) * zoom;
    let sz = H / 2 + (dx * sin + dz * cos) * zoom;
    const M = 16;
    const off = sx < M || sx > W - M || sz < M || sz > H - M;
    return { x: Math.max(M, Math.min(W - M, sx)), y: Math.max(M, Math.min(H - M, sz)), off };
  }
  drawRadarMarkers(ctx, W, H, me, markers, t, zoom) {
    for (const m of markers) {
      const p = this.markerScreenPos(me, m, W, H, zoom);
      if (m.kind === 'point') {
        const col = m.owner === 'GR' ? '#4fa0ff' : m.owner === 'BL' ? '#ff6a4a' : '#cfd6dd';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const px = p.x + Math.cos(a) * 12, pz = p.y + Math.sin(a) * 12;
          i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(8,12,16,.85)'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
        ctx.fillStyle = col; ctx.font = '700 13px "Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(m.label, p.x, p.y + 1);
        if (m.contested) {
          ctx.globalAlpha = 0.45 + 0.45 * Math.abs(Math.sin(t * 6));
          ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, 7);
          ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (m.kind === 'site') {
        ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(t * 2.5));
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7);
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7);
        ctx.fillStyle = 'rgba(20,14,2,.8)'; ctx.fill();
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#ffd24a'; ctx.font = '700 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☢', p.x, p.y + 1);
      } else if (m.kind === 'bomb') {
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 10));
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, 7);
        ctx.fillStyle = '#ff3018'; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.font = '700 12px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☢', p.x, p.y + 1);
      }
    }
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const PRIM_CARDS = PRIMARIES.map((id) => {
  const d = WEAPONS[id];
  const sub = { ak47: '潜伏者经典 · 伤害高', m4a1: '保卫者经典 · 稳定', awm: '一枪致命 · 需开镜', mp5: '射速快 · 移动灵活' }[id] || '生化战场同源武器';
  const bar = (label, pct) => `<div class="srow"><span>${label}</span><i><b style="width:${Math.round(Math.min(1, pct) * 100)}%"></b></i></div>`;
  return `<div class="card" data-w="${id}"><img alt=""><b>${d.name}</b><small>${sub}</small>
    ${bar('伤害', d.dmg / 55)}${bar('射速', d.rpm / 900)}${bar('机动', (d.speed - 0.75) / 0.25)}
  </div>`;
}).join('');

const NADE_CARDS = ['he', 'molotov', 'frost', 'gas'].map((id) => {
  const d = WEAPONS[id];
  const sub = { he: '高爆 · 范围杀伤', molotov: '火海 · 持续灼烧', frost: '寒爆 · 大幅冻缓', gas: '毒雾 · 持续毒伤' }[id];
  return `<div class="card" data-g="${id}"><img alt=""><b>${d.name}</b><small>${sub}</small></div>`;
}).join('');

const MODE_CARDS = [
  ['tdm', '🔫', '团队竞技', '经典 PVP · 目标击杀'],
  ['infection', '☣️', '生化感染', '母体感染链 · 变异技能'],
  ['revenge', '⚡', '生化复仇', '复仇者电锯 · 尸潮'],
  ['bio', '🧟', '生化模式', 'AI 尸潮 · 补给掉落'],
  ['confront', '🚩', '生化对抗', '三据点攻防战'],
  ['demol', '☢️', '生化爆破', '安放核弹 · 英雄觉醒'],
].map(([v, ic, nm, tag]) => `<div class="mcard" data-v="${v}"><span class="ic">${ic}</span><b>${nm}</b><small>${tag}</small></div>`).join('');

const TEMPLATE = `
<div id="hud" class="hidden">
  <div id="score">
    <div class="team bl" id="tBL"><span class="nm">潜伏者</span><span class="pts" id="sBL">0</span></div>
    <div class="mid"><div class="time" id="sTime">10:00</div><div class="goal" id="sGoal"></div></div>
    <div class="team gr" id="tGR"><span class="pts" id="sGR">0</span><span class="nm">保卫者</span></div>
  </div>
  <div id="radarWrap"><canvas id="radar"></canvas><div class="lbl">运输船</div></div>
  <div id="clinks"><a href="https://github.com/riba2534/claude-opus-5-5-demo" target="_blank" rel="noopener noreferrer" title="GitHub 源码" aria-label="GitHub 源码"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a><a href="https://x.com/riba2534" target="_blank" rel="noopener noreferrer" title="X @riba2534" aria-label="X @riba2534"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg></a></div>
  <div id="feed"></div>
  <div id="vitals">
    <div class="vbox" id="hpBox"><div class="ic">✚</div><div class="val" id="hpVal">100</div></div>
    <div class="vbox" id="arBox"><div class="ic">⛨</div><div class="val" id="arVal">100</div></div>
  </div>
  <div id="slots"></div>
  <div id="ammo"><div class="wname" id="wName"></div><div class="row"><img class="wicon" id="wIcon" alt=""><span class="mag" id="aMag">30</span><span class="res" id="aRes">/ 90</span></div><div class="hint" id="aHint"></div></div>
  <div id="cross"><i class="t" id="cT"></i><i class="b" id="cB"></i><i class="l" id="cL"></i><i class="r" id="cR"></i></div>
  <div id="hit"><i></i><i></i><i></i><i></i></div>
  <div id="dmgDirs"></div>
  <div id="scope"><div class="ring"></div><div class="h"></div><div class="v"></div><div class="h2 l"></div><div class="h2 r"></div><div class="v2"></div><div class="dot"></div></div>
  <div id="badge"><div class="ico"></div><div class="txt"></div><div class="sub"></div></div>
  <div id="center" class="hidden"><div class="big" id="cBig"></div><div class="small" id="cSmall"></div></div>
  <div id="toast"></div>
  <div id="prompt"></div>
  <div id="protect"></div>
  <div id="nameTip"></div>
  <div id="board" class="hidden tbl"><h3><span id="boardTitle">运输船 · 团队竞技</span><span>Tab</span></h3><div id="boardBody"></div></div>
  <div id="touch" class="hidden"></div>
</div>

<div id="loading" class="screen"><div class="t">运 输 船</div><div class="s" id="loadTxt">LOADING</div><div class="bar"><i id="loadBar"></i></div><div class="tip">小提示：蹲下再跳（蹲跳）可以跳得更高，踩着木箱就能爬上对面集装箱的二楼。</div></div>

<div id="menu" class="screen hidden">
  <div class="menuBox">
    <div class="title">
      <div class="logo">CROSSFIRE · 团队竞技</div>
      <h1>运输船</h1>
      <div class="en">TRANSPORT SHIP</div>
      <p>联合国维和行动在监视非法军火出口时，发现一艘从俄罗斯驶往尼日利亚的可疑货轮。保卫者（Global Risk）奉命登船突击检查，却遭到潜伏者（Black List）伏击。<br>船头船尾两个船舱出生，中路 V 形斜放集装箱、两侧 L 形箱堆，左右各有一条只能从己方出生点进入的集装箱管道，管道顶上就是可以架枪的二楼。</p>
      <div class="keys">
        <kbd>W A S D</kbd><span>移动　<kbd>Shift</kbd> 静步　<kbd>空格</kbd> 跳　<kbd>C</kbd> 蹲</span>
        <kbd>鼠标左键</kbd><span>开火　<kbd>右键</kbd> 狙击开镜 / 刀重击</span>
        <kbd>1 2 3 4</kbd><span>主武器 / 手枪 / 刀 / 手雷　<kbd>Q</kbd> 快切　<kbd>滚轮</kbd> 切换</span>
        <kbd>R</kbd><span>换弹　<kbd>F</kbd> 检视武器　<kbd>B</kbd> 更换主武器</span>
        <kbd>Tab</kbd><span>计分板　<kbd>Esc</kbd> 暂停 / 设置</span>
      </div>
      <div class="note hidden" id="touchNote">检测到触屏设备：已启用虚拟摇杆（左侧移动、右侧滑动视角）。电脑 + 鼠标体验最佳。</div>
    </div>
    <div class="opts">
      <div class="mcards" id="modeCards">${MODE_CARDS}</div>
      <div id="modeInfo" style="grid-column:1/-1;margin:2px 0 8px;padding:8px 12px;border:1px solid rgba(245,179,33,.35);border-radius:8px;background:rgba(20,16,6,.5);font:12px/1.7 "PingFang SC","Microsoft YaHei",sans-serif;color:#d8cdb0;text-align:left"></div>
      <div class="opt"><div class="lab">地图</div><div class="seg" data-k="map"><button data-v="ship">运输船</button><button data-v="city">死亡城市</button><button data-v="lab">生化实验室</button><button data-v="plaza">都会广场</button><button data-v="harbor">雾港</button></div></div>
      <div class="mapMeta" id="mapMeta"></div>
      <div class="opt"><div class="lab">阵营</div><div class="seg team" data-k="team"><button data-v="BL">潜伏者<small>Black List</small></button><button data-v="GR">保卫者<small>Global Risk</small></button></div></div>
      <div class="opt"><div class="lab">主武器</div><div class="seg" data-k="primary"><button data-v="ak47">AK-47</button><button data-v="m4a1">M4A1</button><button data-v="awm">AWM</button><button data-v="mp5">MP5</button></div></div>
      <div class="row2">
        <div class="opt"><div class="lab">对战规模</div><div class="seg" data-k="size"><button data-v="4">4v4</button><button data-v="6">6v6</button><button data-v="8">8v8</button></div></div>
        <div class="opt"><div class="lab">目标击杀</div><div class="seg" data-k="goal"><button data-v="30">30</button><button data-v="50">50</button><button data-v="100">100</button></div></div>
      </div>
      <div class="opt"><div class="lab">电脑难度</div><div class="seg" data-k="diff"><button data-v="easy">简单</button><button data-v="normal">普通</button><button data-v="hard">困难</button><button data-v="hell">地狱</button></div></div>
      <div class="row2">
        <div class="opt"><div class="lab">时间</div><div class="seg" data-k="tod"><button data-v="day">白天</button><button data-v="dusk">黄昏</button><button data-v="night">夜晚</button></div></div>
        <div class="opt"><div class="lab">画质</div><div class="seg" data-k="quality"><button data-v="low">流畅</button><button data-v="medium">均衡</button><button data-v="high">极致</button></div></div>
      </div>
      <div class="row3">
        <div class="opt"><div class="lab">灵敏度</div><div class="slider" data-k="sens"><input type="range" min="0.2" max="3" step="0.05"><span></span></div></div>
        <div class="opt"><div class="lab">视野 FOV</div><div class="slider" data-k="fov"><input type="range" min="65" max="100" step="1"><span></span></div></div>
        <div class="opt"><div class="lab">音量</div><div class="slider" data-k="vol"><input type="range" min="0" max="1" step="0.05"><span></span></div></div>
      </div>
      <button class="go" id="btnStart">开 始 游 戏</button>
      <div class="note">点击开始后鼠标将被锁定，按 Esc 暂停。画质切换会重新加载页面。</div>
      <div class="mlinks"><a href="https://github.com/riba2534/claude-opus-5-5-demo" target="_blank" rel="noopener noreferrer">GitHub 源码</a><span>·</span><a href="https://x.com/riba2534" target="_blank" rel="noopener noreferrer">X @riba2534</a></div>
    </div>
  </div>
</div>

<div id="pause" class="screen hidden"><div class="pauseBox"><h2>暂停</h2>
  <div class="opt"><div class="lab">鼠标灵敏度</div><div class="slider" data-k="sens"><input type="range" min="0.2" max="3" step="0.05"><span></span></div></div>
  <div class="opt"><div class="lab">视野 FOV</div><div class="slider" data-k="fov"><input type="range" min="65" max="100" step="1"><span></span></div></div>
  <div class="opt"><div class="lab">音量</div><div class="slider" data-k="vol"><input type="range" min="0" max="1" step="0.05"><span></span></div></div>
  <div class="opt"><div class="lab">时间</div><div class="seg" data-k="tod"><button data-v="day">白天</button><button data-v="dusk">黄昏</button><button data-v="night">夜晚</button></div></div>
  <button class="go" id="btnResume">继 续</button><button class="go sec" id="btnQuit" style="margin-top:10px">退出到主菜单</button>
</div></div>

<div id="loadout" class="screen hidden"><div class="loadBox"><h2>武器商店 · 装备配置</h2><div class="sub">复活时生效；在出生点内立即生效。副武器沙漠之鹰、军刀、手雷自动配备。<span id="loadTimer"></span></div>
  <div class="cards" id="loadCards">${PRIM_CARDS}</div>
    <div class="opt"><div class="lab">投掷武器</div></div>
    <div class="cards" id="nadeCards">${NADE_CARDS}</div>
  <button class="go sec" id="btnLoadClose" style="margin-top:14px">确 定（B）</button>
</div></div>

<div id="help" class="screen hidden"><div class="loadBox"><h2>帮助中心 · <span id="helpMode"></span></h2>
  <div class="helpGrid">
    <div class="hcard"><h3>模式机制</h3><p id="helpDesc"></p></div>
    <div class="hcard"><h3>交互按键</h3><p id="helpKeys"></p></div>
  </div>
  <button class="go sec" id="btnHelpClose" style="margin-top:14px">关闭（H）</button>
</div></div>

<div id="end" class="screen hidden"><div class="endBox">  <div class="res" id="endRes">胜利</div><div class="sc" id="endSc"></div><div class="mvp" id="endMvp"></div><div class="mvp" id="endMe" style="color:#dfe4e8"></div>
  <div id="endTable" class="tbl"></div>
  <div style="display:flex;gap:10px;margin-top:16px"><button class="go" id="btnAgain">再 来 一 局</button><button class="go sec" id="btnMenu">主菜单</button></div>
</div></div>
`;

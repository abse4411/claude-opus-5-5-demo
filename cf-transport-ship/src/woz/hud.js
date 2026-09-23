// WOZ HUD：身份牌 / 技能充能 / 吞噬提示 / 存活比 / 致盲遮罩 / 职业变身
import { CLASS_LABEL, SKILL_LABEL, skillOf, WOZ } from './config.js';

// 感染变身选择面板卡片（WOZ 特色：感染后自选形态）
const CLASS_PICK = [
  { c: 'nightrunner', key: '5', name: '夜行者', desc: '高机动刺客 · 疾冲突进', sp: 5, hp: 3, sk: 4 },
  { c: 'souleater', key: '6', name: '噬魂者', desc: '致盲尖啸 · 瘫痪人类视野', sp: 3, hp: 3, sk: 5 },
  { c: 'devourer', key: '7', name: '猎食者', desc: '投掷斧头 · 远程斩杀', sp: 2, hp: 4, sk: 4 },
  { c: 'tangler', key: '8', name: '缠绕者', desc: '触须缠绕 · 拖拽撕碎防线', sp: 3, hp: 4, sk: 5 },
];
const statRow = (label, v) => `<div class="stat"><span>${label}</span><i><b style="width:${v * 20}%"></b></i></div>`;

const PANEL_CSS = `
#wozPanel{position:absolute;left:18px;bottom:96px;width:210px;font:13px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;color:#eee;text-shadow:0 1px 2px #000;pointer-events:none;user-select:none;transition:opacity .2s}
#wozPanel .card{background:rgba(8,10,14,.62);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 11px;margin-top:6px}
#wozPanel .role{font-size:15px;font-weight:700}
#wozPanel .bar{height:8px;background:rgba(255,255,255,.14);border-radius:5px;overflow:hidden;margin-top:4px}
#wozPanel .bar i{display:block;height:100%;border-radius:5px;transition:width .12s}
#wozPanel .row{display:flex;justify-content:space-between;align-items:center;margin-top:5px;font-size:12px;color:#cfd6dd}
#wozPanel .skillReady{color:#ffd24a;font-weight:700}
#wozTop{position:absolute;top:110px;left:50%;transform:translateX(-50%);font:600 13px "PingFang SC","Microsoft YaHei",sans-serif;color:#dfe6ec;text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap;background:rgba(8,10,14,.55);padding:3px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14)}
#wozBlind{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .15s}
#wozClasses{position:absolute;right:14px;bottom:120px;display:flex;flex-direction:column;gap:8px;pointer-events:auto}
#wozClasses button{width:112px;padding:8px 0;border:1px solid rgba(255,140,60,.55);border-radius:8px;background:rgba(30,12,6,.72);color:#ffb488;font:600 13px "PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer}
#wozClasses button:hover{background:rgba(80,30,12,.85);color:#ffd9b8}
#wozBanner{position:absolute;top:20%;left:50%;transform:translateX(-50%);font:700 34px "PingFang SC","Microsoft YaHei",sans-serif;color:#60e0ff;text-shadow:0 0 18px rgba(60,180,255,.8),0 2px 4px #000;opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap;text-align:center;animation:wozBannerIn .5s ease-out}
@keyframes wozBannerIn{0%{transform:translateX(-50%) scale(1.22)}100%{transform:translateX(-50%) scale(1)}}
#wozObj{position:absolute;top:78px;left:50%;transform:translateX(-50%);display:flex;gap:10px;pointer-events:none}
#wozObj .pt{min-width:64px;padding:4px 10px;border-radius:6px;background:rgba(8,10,14,.66);border:1px solid rgba(255,255,255,.16);font:700 15px "PingFang SC","Microsoft YaHei",sans-serif;text-align:center;text-shadow:0 1px 2px #000}
#wozObj .pt small{display:block;font-size:10px;font-weight:400;opacity:.85}
#wozObj .oGR{color:#8cc8ff;border-color:rgba(90,160,230,.6)}
#wozObj .oBL{color:#ff9b70;border-color:rgba(230,90,60,.6)}
#wozObj .oNone{color:#cfd6dd}
#wozObj .bomb{color:#ffd24a;border-color:rgba(255,210,74,.7);font-size:17px}
#wozBig{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:480px;pointer-events:none;user-select:none;text-align:center;transition:opacity .2s}
#wozBig.off{opacity:0}
#wozBig .role{font:700 15px "PingFang SC","Microsoft YaHei",sans-serif;color:#ff8a5c;text-shadow:0 1px 3px #000;margin-bottom:5px}
#wozBig .hpwrap{position:relative;height:24px;border:2px solid rgba(255,255,255,.28);border-radius:7px;background:rgba(10,6,4,.78);overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.55)}
#wozBig .hpwrap i{display:block;height:100%;background:linear-gradient(180deg,#ff7850,#c23618);transition:width .12s}
#wozBig .hpnum{position:absolute;inset:0;font:700 14px/20px "Microsoft YaHei",sans-serif;color:#fff;text-shadow:0 1px 2px #000;letter-spacing:1px}
#wozBig .sub{display:flex;justify-content:space-between;align-items:center;margin-top:5px;font:12px "PingFang SC","Microsoft YaHei",sans-serif;color:#cfd6dd;text-shadow:0 1px 2px #000}
#wozBig .sub .devour{color:#ffd24a}
#wozBig.avg .role{color:#60e0ff}
#wozBig.avg .hpwrap i{background:linear-gradient(180deg,#7ce4ff,#1f7fd0)}
#wozBig .ringwrap{position:absolute;right:-76px;top:-6px;width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center}
#wozBig .ring{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(#ffd24a 0deg,rgba(255,255,255,.16) 0deg);box-shadow:0 2px 8px rgba(0,0,0,.5)}
#wozBig .ring .in{width:50px;height:50px;border-radius:50%;background:#151009;display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 17px/1 "Microsoft YaHei",sans-serif;color:#ffd24a}
#wozBig .ring .in small{font:400 9px/1.4 "Microsoft YaHei",sans-serif;color:#9aa4ae}
#wozBig .ring.ready{box-shadow:0 0 16px rgba(255,210,74,.85)}
#wozDirs{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#wozDirs .arw{position:absolute;left:0;top:0;will-change:transform;color:#fff}
#wozDirs .tri{position:absolute;left:-9px;top:-10px;width:0;height:0;border-top:10px solid transparent;border-bottom:10px solid transparent;border-left:18px solid currentColor;filter:drop-shadow(0 1px 3px rgba(0,0,0,.85))}
#wozDirs .lab{position:absolute;font:700 13px "Microsoft YaHei",sans-serif;text-shadow:0 1px 3px #000;transform:translate(-50%,-50%)}
#wozPick{position:absolute;left:50%;top:24%;transform:translateX(-50%);width:580px;padding:14px 18px 12px;background:rgba(8,10,14,.9);border:1px solid rgba(255,140,60,.55);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.65);text-align:center;pointer-events:auto;backdrop-filter:blur(4px);animation:wozPickIn .22s ease-out}
@keyframes wozPickIn{0%{transform:translateX(-50%) scale(.9);opacity:0}100%{transform:translateX(-50%) scale(1);opacity:1}}
#wozPick.hidden{display:none}
#wozPick .ptitle{font:700 18px "Microsoft YaHei",sans-serif;color:#ffb488;text-shadow:0 1px 3px #000;margin-bottom:10px;letter-spacing:2px}
#wozPick .pcards{display:flex;gap:10px}
#wozPick .pcard{flex:1;padding:10px 8px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(30,12,6,.55);cursor:pointer;transition:all .12s}
#wozPick .pcard:hover{border-color:#ffb488;background:rgba(90,36,14,.7);transform:translateY(-2px)}
#wozPick .pcard b{display:block;font:700 15px "Microsoft YaHei",sans-serif;color:#ffd9b8}
#wozPick .pcard kbd{display:inline-block;margin-top:3px;padding:0 7px;border:1px solid rgba(255,140,60,.6);border-radius:4px;color:#ffb488;font:700 11px/16px Consolas,monospace}
#wozPick .pcard .d{display:block;font:11px/1.5 "Microsoft YaHei",sans-serif;color:#c9b39a;margin:5px 0 6px}
#wozPick .stat{display:flex;align-items:center;gap:5px;margin-top:3px}
#wozPick .stat span{width:28px;text-align:left;font:10px "Microsoft YaHei",sans-serif;color:#9a8a7a}
#wozPick .stat i{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;display:block;text-align:left}
#wozPick .stat i b{display:inline-block;height:100%;background:linear-gradient(90deg,#ff8a50,#ffce70);border-radius:3px}
#wozPick .pbar{height:4px;margin-top:10px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
#wozPick .pbar i{display:block;height:100%;width:100%;background:#ff8a50;border-radius:2px}
#wozPick .phint{margin-top:6px;font:11px "Microsoft YaHei",sans-serif;color:#9a8a7a}
`;

export class WozHud {
  constructor(game) {
    this.g = game;
    this.mounted = false;
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    style.id = 'wozStyle';
    document.head.appendChild(style);
    const ui = document.getElementById('ui');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="wozBlind"></div>
      <div id="wozTop"></div>
      <div id="wozObj"></div>
      <div id="wozDirs"></div>
      <div id="wozPanel">
        <div class="card">
          <div class="role" id="wzRole">人类保卫军</div>
          <div id="wzHpWrap"><div class="bar"><i id="wzHp" style="width:100%;background:#8cc8ff"></i></div></div>
          <div class="row"><span id="wzHpTxt">100 HP</span><span id="wzTier"></span></div>
          <div class="row"><span id="wzEvo"></span><span id="wzDevour" style="color:#ffd24a"></span></div>
        </div>
      </div>
      <div id="wozBig" class="off">
        <div class="role" id="wzBigRole">变异者</div>
        <div class="hpwrap"><i id="wzBigHp"></i><div class="hpnum" id="wzBigNum"></div></div>
        <div class="sub"><span class="devour" id="wzBigDevour"></span><span id="wzBigEvo"></span></div>
        <div class="ringwrap"><div class="ring" id="wzRing"><div class="in"><span id="wzRingChar">?</span><small id="wzRingTxt">0%</small></div></div></div>
      </div>
      <div id="wozClasses"></div>
      <div id="wozBanner"></div>
      <div id="wozPick" class="hidden">
        <div class="ptitle">☠ 选择你的变异者形态</div>
        <div class="pcards">
          ${CLASS_PICK.map((k) => `
            <div class="pcard" data-c="${k.c}">
              <b>${k.name}</b><kbd>${k.key}</kbd>
              <span class="d">${k.desc}</span>
              ${statRow('速度', k.sp)}${statRow('血量', k.hp)}${statRow('技能', k.sk)}
            </div>`).join('')}
        </div>
        <div class="pbar"><i id="wzPickBar"></i></div>
        <div class="phint">按 5 / 6 / 7 或点击卡片选择 · 超时默认夜行者</div>
      </div>
    `;
    ui.appendChild(wrap);
    this.el = {
      blind: document.getElementById('wozBlind'),
      top: document.getElementById('wozTop'),
      obj: document.getElementById('wozObj'),
      dirs: document.getElementById('wozDirs'),
      panel: document.getElementById('wozPanel'),
      role: document.getElementById('wzRole'),
      hp: document.getElementById('wzHp'),
      hpWrap: document.getElementById('wzHpWrap'),
      hpTxt: document.getElementById('wzHpTxt'),
      tier: document.getElementById('wzTier'),
      evo: document.getElementById('wzEvo'),
      devour: document.getElementById('wzDevour'),
      big: document.getElementById('wozBig'),
      bigRole: document.getElementById('wzBigRole'),
      bigHp: document.getElementById('wzBigHp'),
      bigNum: document.getElementById('wzBigNum'),
      bigDevour: document.getElementById('wzBigDevour'),
      bigEvo: document.getElementById('wzBigEvo'),
      ring: document.getElementById('wzRing'),
      ringChar: document.getElementById('wzRingChar'),
      ringTxt: document.getElementById('wzRingTxt'),
      classes: document.getElementById('wozClasses'),
      banner: document.getElementById('wozBanner'),
      pick: document.getElementById('wozPick'),
      pickBar: document.getElementById('wzPickBar'),
    };
    this.bannerT = 0;
    this.pickShownAt = -1;
    this.pickBound = false;
  }

  unmount() {
    for (const id of ['wozPanel', 'wozBig', 'wozBlind', 'wozTop', 'wozObj', 'wozDirs', 'wozClasses', 'wozBanner', 'wozPick', 'wozStyle']) {
      document.getElementById(id)?.remove();
    }
    this.mounted = false;
  }

  update(rules, player, mgr) {
    if (!this.mounted) return;
    const st = rules.state(player.id);
    const g = this.g;
    // 顶栏：阶段 + 存活比
    const phase = rules.phase === 'buy' ? '购买期'
      : rules.phase === 'battle' ? '感染战'
      : rules.phase === 'roundend' ? (rules.result === 'humansSurvived' ? '人类胜利！' : '变异者胜利！') : '';
    this.el.top.textContent = rules.phase === 'battle' || rules.phase === 'roundend'
      ? `${phase} ${Math.max(0, rules.phaseTimeLeft) | 0}s ｜ 人类 ${rules.humansAlive()} · 变异者 ${rules.mutantsAlive()}`
      : `${phase} ${Math.max(0, rules.phaseTimeLeft) | 0}s`;
    // 身份牌：变异者/复仇者 → 底部中央大血条；人类 → 左侧紧凑面板
    const mutant = st.side === 'mutant';
    const avenger = st.isAvenger;
    if (mutant || avenger) {
      this.el.big.classList.remove('off');
      this.el.big.classList.toggle('avg', !!avenger);
      this.el.panel.style.opacity = 0;
      this.g.hud.el.vitals.style.opacity = 0; // 基础生命框与大血条重复，隐藏
      const cap = rules.effectiveMaxHp(st);
      this.el.bigRole.textContent = avenger ? '⚡ 生化复仇者' : `☣ ${CLASS_LABEL[st.cls] || '变异者'}${st.isMother ? ' · 母体' : ''}`;
      this.el.bigHp.style.width = `${Math.max(0, Math.min(1, st.hp / cap)) * 100}%`;
      this.el.bigNum.textContent = `${Math.max(0, st.hp) | 0} / ${cap | 0}`;
      const corpse = mgr.findCorpse(player);
      this.el.bigDevour.textContent = st.devourCooldown > 0 ? '吞噬冷却中…'
        : corpse >= 0 ? '[E] 吞噬尸体' : '';
      this.el.bigEvo.textContent = avenger ? '被复仇者击杀的变异者无法复活'
        : `进化 ${st.evoPoints} 点 · 吞噬 ${st.devourCount} 次`;
      if (avenger) {
        this.el.ringChar.textContent = '⚡';
        this.el.ringTxt.textContent = '电锯';
        this.el.ring.style.background = 'conic-gradient(#60e0ff 360deg, rgba(255,255,255,.16) 0deg)';
        this.el.ring.classList.add('ready');
      } else {
        const sk = skillOf(st.cls);
        const pct = Math.max(0, Math.min(1, st.skillCharge));
        this.el.ringChar.textContent = (SKILL_LABEL[sk] || '?').slice(0, 1);
        this.el.ringTxt.textContent = st.skillActive ? '生效中' : st.skillCharge >= 1 ? '就绪 [G]' : `${(pct * 100) | 0}%`;
        this.el.ring.style.background = `conic-gradient(${st.skillCharge >= 1 ? '#ffd24a' : '#ff8a5c'} ${pct * 360}deg, rgba(255,255,255,.16) 0deg)`;
        this.el.ring.classList.toggle('ready', st.skillCharge >= 1 && !st.skillActive);
      }
    } else {
      this.el.big.classList.add('off');
      this.el.panel.style.opacity = '';
      this.g.hud.el.vitals.style.opacity = '';
      this.el.role.textContent = '人类保卫军';
      this.el.role.style.color = '#8cc8ff';
      this.el.hp.style.width = `${Math.max(0, player.hp)}%`;
      this.el.hp.style.background = '#8cc8ff';
      this.el.hpTxt.textContent = `${Math.max(0, player.hp) | 0} HP · 护甲 ${player.armor | 0}`;
      const tier = rules.humanTier(player.id);
      this.el.tier.textContent = tier > 0 ? `进化 Lv.${tier}` : '';
      this.el.evo.textContent = this.g.opts.mode === 'revenge' ? '濒败时觉醒复仇者' : `击杀 ${player.stats.k}`;
      this.el.devour.textContent = '';
    }
    // 致盲遮罩
    this.el.blind.style.opacity = player.alive ? Math.min(1, (player.blindT || 0) / WOZ.blindWailDuration * 1.2) : 0;
    // 子体变身按钮
    const showClasses = mutant && !st.isMother && rules.phase === 'battle';
    // 感染变身选择面板（WOZ 特色）：尚未主动选择职业时弹出
    const needPick = !avenger && mutant && !st.isMother && rules.phase === 'battle' && mgr.pickNeeded && mgr.pickNeeded();
    if (needPick) {
      if (!this.pickBound) {
        this.pickBound = true;
        for (const el of this.el.pick.querySelectorAll('.pcard')) {
          el.addEventListener('click', () => {
            if (mgr.rules.setMutantClass(mgr.g.player.id, el.dataset.c)) mgr.playerClassChosen = true;
          });
        }
      }
      if (this.el.pick.classList.contains('hidden')) this.pickShownAt = this.g.time;
      this.el.pick.classList.remove('hidden');
      const left = Math.max(0, 1 - (this.g.time - this.pickShownAt) / 10);
      this.el.pickBar.style.width = `${left * 100}%`;
      if (left <= 0) mgr.playerClassChosen = true; // 超时默认夜行者
      this.el.classes.style.display = 'none';
    } else {
      this.el.pick.classList.add('hidden');
      this.el.classes.style.display = '';
    }
    if (showClasses && !this.classBtns) {
      this.classBtns = document.createElement('div');
      this.classBtns.innerHTML = `
        <button data-c="nightrunner">[5] 夜行者</button>
        <button data-c="souleater">[6] 噬魂者</button>
        <button data-c="devourer">[7] 猎食者</button>
        <button data-c="tangler">[8] 缠绕者</button>
      `;
      this.classBtns.addEventListener('click', (e) => {
        const c = e.target?.dataset?.c;
        if (c) mgr.rules.setMutantClass(player.id, c);
      });
      this.el.classes.appendChild(this.classBtns);
    } else if (!showClasses && this.classBtns) {
      this.classBtns.remove();
      this.classBtns = null;
    }
    // 回合结算横幅
    if (rules.phase === 'roundend' && rules.result) {
      const key = 'r' + mgr.round + ':' + rules.result;
      if (this._lastResultKey !== key) {
        this._lastResultKey = key;
        const humanWin = rules.result === 'humansSurvived';
        this.showBanner(humanWin ? '🛡 人类胜利！' : '☣ 变异者胜利！',
          humanWin ? '#8cc8ff' : '#ff7040',
          `第 ${mgr.round} 回合结束 · 比分 人类 ${mgr.score.GR} : ${mgr.score.BL} 变异者`, 3.5);
      }
    }
    // 横幅淡出
    if (this.bannerT > 0) {
      this.bannerT -= 1 / 60;
      if (this.bannerT <= 0) this.el.banner.style.opacity = 0;
    }
  }

  // 目标物模式顶栏：据点归属/进度 + 核弹状态（每帧由 tickConfront/tickDemol 调用）
  updateObj(data) {
    if (!this.mounted) return;
    this.updateDirs(this.g.woz);
    let html = '';
    for (const p of data.points) {
      const cls = p.owner === 'GR' ? 'oGR' : p.owner === 'BL' ? 'oBL' : 'oNone';
      const state = p.contested ? '争夺中' : p.owner === 'GR' ? '已占领' : p.owner === 'BL' ? '变异者控制' : `${p.progress}%`;
      html += `<div class="pt ${cls}">${p.name}<small>${state}</small></div>`;
    }
    if (data.bomb) {
      const b = data.bomb;
      if (b.state === 'planted' || b.state === 'destroying') {
        html += `<div class="pt bomb">☢ ${b.timer}s<small>${b.state === 'destroying' ? `摧毁中 ${(b.prog * 100) | 0}%` : '倒计时'}</small></div>`;
      } else if (b.state === 'planting') {
        html += `<div class="pt bomb">☢ 安放中<small>${(b.prog * 100) | 0}%</small></div>`;
      } else if (b.canPlant || b.state === 'planting') {
        html += `<div class="pt bomb">☢ ${b.state === 'planting' ? `安放中 ${(b.prog * 100) | 0}%` : '<b>按住 E 安放核弹</b>'}<small>站点内</small></div>`;
      } else {
        html += `<div class="pt oNone">☢ 核弹<small>待安放 · 冲入巢穴</small></div>`;
      }
    }
    if (data.buffs && (data.buffs.atk || data.buffs.speed || data.buffs.supply)) {
      const b = [];
      if (data.buffs.atk) b.push('攻击+10%');
      if (data.buffs.speed) b.push('移速+8%');
      if (data.buffs.supply) b.push('弹药补给中');
      html += `<div class="pt oGR">增益<small>${b.join(' · ')}</small></div>`;
    }
    this.el.obj.innerHTML = html;
  }

  // 屏幕外目标方向箭头（未占领据点 / 核弹），贴屏幕边缘指向
  updateDirs(mgr) {
    if (!mgr.offscreenDirs) return;
    const dirs = mgr.offscreenDirs(this.g.renderer.camera);
    const pool = this.dirPool || (this.dirPool = []);
    while (pool.length < dirs.length) {
      const root = document.createElement('div');
      root.className = 'arw';
      root.innerHTML = '<i class="tri"></i><b class="lab"></b>';
      this.el.dirs.appendChild(root);
      pool.push({ root, tri: root.querySelector('.tri'), lab: root.querySelector('.lab') });
    }
    const cx = innerWidth / 2, cy = innerHeight / 2, inset = 70;
    for (let i = 0; i < pool.length; i++) {
      const el = pool[i];
      if (i >= dirs.length) { el.root.style.display = 'none'; continue; }
      el.root.style.display = '';
      const d = dirs[i];
      const ang = -d.ang; // NDC(y 上正) → CSS(y 下正)
      const c = Math.cos(ang), s = Math.sin(ang);
      const t = Math.min(
        Math.abs(c) > 1e-4 ? (cx - inset) / Math.abs(c) : 1e9,
        Math.abs(s) > 1e-4 ? (cy - inset) / Math.abs(s) : 1e9,
      );
      el.root.style.color = d.css;
      el.root.style.transform = `translate(${(cx + c * t).toFixed(1)}px,${(cy + s * t).toFixed(1)}px)`;
      el.tri.style.transform = `rotate(${ang}rad)`;
      el.lab.style.left = `${(-c * 36).toFixed(1)}px`;
      el.lab.style.top = `${(-s * 36).toFixed(1)}px`;
      el.lab.textContent = d.label;
    }
  }

  avengerBanner(name) {
    this.showBanner(`⚡ ${name} 觉醒为生化复仇者`, '#60e0ff');
  }

  // 通用大横幅（复仇者觉醒 / 回合结算）
  showBanner(html, color, sub = '', dur = 3) {
    if (!this.mounted) return;
    this.el.banner.innerHTML = `<div style="color:${color}">${html}</div>${sub ? `<small style="display:block;font:600 16px/1.6 'Microsoft YaHei',sans-serif;color:#dfe6ec;margin-top:8px;text-shadow:0 1px 3px #000">${sub}</small>` : ''}`;
    this.el.banner.style.opacity = 1;
    this.bannerT = dur;
  }

  onRoundStart() {
    if (this.mounted) { this.el.banner.style.opacity = 0; this._lastResultKey = ''; }
  }
}

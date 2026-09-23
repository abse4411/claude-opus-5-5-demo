// WOZ HUD：身份牌 / 技能充能 / 吞噬提示 / 存活比 / 致盲遮罩 / 职业变身
import { CLASS_LABEL, SKILL_LABEL, skillOf, WOZ } from './config.js';

const PANEL_CSS = `
#wozPanel{position:absolute;left:18px;bottom:96px;width:236px;font:13px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;color:#eee;text-shadow:0 1px 2px #000;pointer-events:none;user-select:none}
#wozPanel .card{background:rgba(8,10,14,.62);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:9px 12px;margin-top:6px}
#wozPanel .role{font-size:16px;font-weight:700}
#wozPanel .bar{height:9px;background:rgba(255,255,255,.14);border-radius:5px;overflow:hidden;margin-top:4px}
#wozPanel .bar i{display:block;height:100%;border-radius:5px;transition:width .12s}
#wozPanel .row{display:flex;justify-content:space-between;align-items:center;margin-top:5px;font-size:12px;color:#cfd6dd}
#wozPanel .skillReady{color:#ffd24a;font-weight:700}
#wozTop{position:absolute;top:46px;left:50%;transform:translateX(-50%);font:600 14px "PingFang SC","Microsoft YaHei",sans-serif;color:#dfe6ec;text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap}
#wozBlind{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .15s}
#wozClasses{position:absolute;right:14px;bottom:120px;display:flex;flex-direction:column;gap:8px;pointer-events:auto}
#wozClasses button{width:112px;padding:8px 0;border:1px solid rgba(255,140,60,.55);border-radius:8px;background:rgba(30,12,6,.72);color:#ffb488;font:600 13px "PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer}
#wozClasses button:hover{background:rgba(80,30,12,.85);color:#ffd9b8}
#wozBanner{position:absolute;top:20%;left:50%;transform:translateX(-50%);font:700 34px "PingFang SC","Microsoft YaHei",sans-serif;color:#60e0ff;text-shadow:0 0 18px rgba(60,180,255,.8),0 2px 4px #000;opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}
#wozObj{position:absolute;top:46px;left:50%;transform:translateX(-50%);display:flex;gap:10px;pointer-events:none}
#wozObj .pt{min-width:64px;padding:4px 10px;border-radius:6px;background:rgba(8,10,14,.66);border:1px solid rgba(255,255,255,.16);font:700 15px "PingFang SC","Microsoft YaHei",sans-serif;text-align:center;text-shadow:0 1px 2px #000}
#wozObj .pt small{display:block;font-size:10px;font-weight:400;opacity:.85}
#wozObj .oGR{color:#8cc8ff;border-color:rgba(90,160,230,.6)}
#wozObj .oBL{color:#ff9b70;border-color:rgba(230,90,60,.6)}
#wozObj .oNone{color:#cfd6dd}
#wozObj .bomb{color:#ffd24a;border-color:rgba(255,210,74,.7);font-size:17px}
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
      <div id="wozPanel">
        <div class="card">
          <div class="role" id="wzRole">人类保卫军</div>
          <div id="wzHpWrap"><div class="bar"><i id="wzHp" style="width:100%;background:#ff5040"></i></div></div>
          <div class="row"><span id="wzHpTxt">100 HP</span><span id="wzTier"></span></div>
          <div class="row"><span>技能</span><span id="wzSkill" class="skillReady">—</span></div>
          <div class="bar"><i id="wzCharge" style="width:0%;background:#ffd24a"></i></div>
          <div class="row"><span id="wzEvo">进化 0 点</span><span id="wzDevour" style="color:#ffd24a"></span></div>
        </div>
      </div>
      <div id="wozClasses"></div>
      <div id="wozBanner"></div>
    `;
    ui.appendChild(wrap);
    this.el = {
      blind: document.getElementById('wozBlind'),
      top: document.getElementById('wozTop'),
      obj: document.getElementById('wozObj'),
      panel: document.getElementById('wozPanel'),
      role: document.getElementById('wzRole'),
      hp: document.getElementById('wzHp'),
      hpWrap: document.getElementById('wzHpWrap'),
      hpTxt: document.getElementById('wzHpTxt'),
      tier: document.getElementById('wzTier'),
      skill: document.getElementById('wzSkill'),
      charge: document.getElementById('wzCharge'),
      evo: document.getElementById('wzEvo'),
      devour: document.getElementById('wzDevour'),
      classes: document.getElementById('wozClasses'),
      banner: document.getElementById('wozBanner'),
    };
    this.bannerT = 0;
  }

  unmount() {
    for (const id of ['wozPanel', 'wozBlind', 'wozTop', 'wozClasses', 'wozBanner', 'wozStyle']) {
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
    // 身份牌
    const mutant = st.side === 'mutant';
    const avenger = st.isAvenger;
    this.el.role.textContent = avenger ? '⚡ 生化复仇者' : mutant ? (CLASS_LABEL[st.cls] || '变异者') : '人类保卫军';
    this.el.role.style.color = avenger ? '#60e0ff' : mutant ? '#ff7040' : '#8cc8ff';
    if (mutant || avenger) {
      this.el.hpWrap.style.display = '';
      const cap = rules.effectiveMaxHp(st);
      this.el.hp.style.width = `${Math.max(0, Math.min(1, st.hp / cap)) * 100}%`;
      this.el.hpTxt.textContent = `${Math.max(0, st.hp) | 0} / ${cap | 0} HP`;
      this.el.tier.textContent = st.evoPoints > 0 ? `进化 ${st.evoPoints} 点` : '';
      const sk = skillOf(st.cls);
      this.el.skill.textContent = st.skillActive ? `${SKILL_LABEL[sk]} 生效中`
        : st.skillCharge >= 1 ? `${SKILL_LABEL[sk]} 就绪 [G]` : `${SKILL_LABEL[sk]} ${(st.skillCharge * 100) | 0}%`;
      this.el.skill.className = st.skillCharge >= 1 && !st.skillActive ? 'skillReady' : '';
      this.el.charge.style.width = `${(st.skillCharge * 100) | 0}%`;
      this.el.evo.textContent = `吞噬 ${st.devourCount} 次`;
      this.el.evo.style.display = '';
      // 吞噬提示
      const corpse = mgr.findCorpse(player);
      this.el.devour.textContent = st.devourCooldown > 0 ? '吞噬冷却中…'
        : corpse >= 0 ? '[E] 吞噬尸体' : '';
    } else {
      this.el.hpWrap.style.display = '';
      this.el.hp.style.width = `${Math.max(0, player.hp)}%`;
      this.el.hp.style.background = '#8cc8ff';
      this.el.hpTxt.textContent = `${Math.max(0, player.hp) | 0} HP · 护甲 ${player.armor | 0}`;
      const tier = rules.humanTier(player.id);
      this.el.tier.textContent = tier > 0 ? `进化 Lv.${tier}` : '';
      this.el.skill.textContent = this.g.opts.mode === 'revenge' ? '濒败时觉醒复仇者' : '撑到回合结束';
      this.el.skill.className = '';
      this.el.charge.style.width = `${Math.min(100, (st.humanSurviveTime / WOZ.humanTierSeconds) * 100)}%`;
      this.el.evo.textContent = `击杀 ${player.stats.k}`;
      this.el.devour.textContent = '';
    }
    this.el.hp.style.background = mutant || avenger ? '#ff5040' : '#8cc8ff';
    // 致盲遮罩
    this.el.blind.style.opacity = player.alive ? Math.min(1, (player.blindT || 0) / WOZ.blindWailDuration * 1.2) : 0;
    // 子体变身按钮
    const showClasses = mutant && !st.isMother && rules.phase === 'battle';
    if (showClasses && !this.classBtns) {
      this.classBtns = document.createElement('div');
      this.classBtns.innerHTML = `
        <button data-c="nightrunner">[5] 夜行者</button>
        <button data-c="souleater">[6] 噬魂者</button>
        <button data-c="devourer">[7] 暴食者</button>
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
    // 横幅淡出
    if (this.bannerT > 0) {
      this.bannerT -= 1 / 60;
      if (this.bannerT <= 0) this.el.banner.style.opacity = 0;
    }
  }

  // 目标物模式顶栏：据点归属/进度 + 核弹状态
  updateObj(data) {
    if (!this.mounted) return;
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
      } else {
        html += `<div class="pt oNone">☢ 核弹<small>待安放 · 冲入巢穴</small></div>`;
      }
    }
    this.el.obj.innerHTML = html;
  }

  avengerBanner(name) {
    if (!this.mounted) return;
    this.el.banner.textContent = `⚡ ${name} 觉醒为生化复仇者`;
    this.el.banner.style.opacity = 1;
    this.bannerT = 3;
  }

  onRoundStart() {
    if (this.mounted) this.el.banner.style.opacity = 0;
  }
}

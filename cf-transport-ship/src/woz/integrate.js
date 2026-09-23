// WOZ 模式与对局主控的集成层：回合流程 / 感染转化 / 复活 / 技能落地 / 胜负结算
// 阵营约定：人类 = GR（保卫者），变异者 = BL（潜伏者，出生点在船尾舱）
import * as THREE from 'three';
import { WeaponState } from '../weapons.js';
import { Soldier } from '../character.js';
import { Player } from '../player.js';
import { Bot, BOT_NAMES } from '../bots.js';
import { WozRules } from './rules.js';
import { Zombie, toZombieAI, stripZombieAI } from './zombie.js';
import { WozHud } from './hud.js';
import { wozAudio } from './audio.js';
import { CapturePoint, NuclearBomb } from './objectives.js';
import { Pickups } from './pickups.js';
import { WOZ, MutantClass, CLASS_LABEL, CONFRONT, DEMOL, BIO } from './config.js';

const ROUND_WINS = 3;
const _fwd = new THREE.Vector3();

export class WozManager {
  constructor(game) {
    this.g = game;
    this.rules = null;
    this.round = 0;
    this.seed = (Date.now() & 0xffff) || 7;
    this.score = { GR: 0, BL: 0 };   // 回合比分（人类 / 变异者）
    this.pendingConvert = new Set();  // 死亡人类等待变异重生
    this.tide = [];                   // 尸潮 / AI 怪物
    this.hud = new WozHud(game);
    wozAudio.mount(game);
    this.growlT = 2;
    // 目标物模式（对抗 / 爆破）
    this.points = [];
    this.bomb = null;
    this.pickups = new Pickups(game);
    this.aiT = 0;
    this.heroGiven = false;
    this.playerClassChosen = false; // 玩家是否已主动选择变异者职业
  }

  // 模式分类：infection 族（感染/复仇/生化）走规则层；对抗/爆破走目标物逻辑
  cat() {
    if (this.mode === 'confront') return 'confront';
    if (this.mode === 'demol') return 'demol';
    return 'infection';
  }

  // ================= 开局 =================
  startMatch() {
    const g = this.g, o = g.opts;
    this.mode = o.mode;
    if (this.cat() !== 'infection') return this.startObjectives();
    g.audio.init(); g.audio.setVolumes({ master: o.vol }); g.audio.startAmbient(); g.audio.playUI('start');
    for (const a of g.actors) g.renderer.scene.remove(a.soldier.root);
    for (const t of g.tags) g.renderer.scene.remove(t.sprite);
    for (const n of g.nades) g.renderer.scene.remove(n.mesh);
    for (const z of this.tide) g.renderer.scene.remove(z.soldier.root);
    g.actors = []; g.nades = []; g.tags = []; g.timers = [];
    this.tide = []; this.pendingConvert.clear();
    g.score = this.score = { GR: 0, BL: 0 };  // 回合比分（与对局比分同一对象，供 HUD/结算）
    this.round = 0;
    this.mode = o.mode;
    g.goal = ROUND_WINS;
    g.env.apply(o.tod); g.applyFogOverride();

    // 10 人局：玩家 + 9 BOT，全员人类
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    g.player = new Player(g, { id: id++, name: '我', team: 'GR' });
    g.player.primary = o.primary;
    g.player.bind(document.getElementById('c'));
    g.actors.push(g.player);
    const prim = (i) => ['ak47', 'awm', 'famas', 'mp5', 'thompson', 'm24', 'm4a1', 'spas', 'g3sg1'][i % 9];
    for (let i = 0; i < 9; i++) {
      const b = new Bot(g, { id: id++, name: names.pop() || 'Bot' + id, team: 'GR', diff: o.diff });
      b.primary = prim(i);
      g.actors.push(b);
    }
    this.rules = new WozRules(this.mode, g.actors.length, this);
    this.beginRound();
    g.vm.setTeam('GR');
    g.vm.equip(g.player.weapon.id, 0.6);
    g.hud.slots(g.player.inv, 0);
    g.playing = true; g.paused = false; g.ended = false;
    this.hud.mount();
    g.hud.show(null);
    g.lock();
    setTimeout(() => g.audio.announce('Go go go!'), 400);
    const modeName = this.mode === 'revenge' ? '生化复仇' : this.mode === 'bio' ? '生化模式' : '生化感染';
    g.hud.toast(`<b style="color:#ff5040">${modeName}</b> · 先胜 ${ROUND_WINS} 回合 · 感染所有人类即变异者胜利`, 4);
  }

  // ---- 对抗 / 爆破：目标物模式开局 ----
  startObjectives() {
    const g = this.g, o = g.opts;
    g.audio.init(); g.audio.setVolumes({ master: o.vol }); g.audio.startAmbient(); g.audio.playUI('start');
    for (const a of g.actors) g.renderer.scene.remove(a.soldier.root);
    for (const t of g.tags) g.renderer.scene.remove(t.sprite);
    for (const n of g.nades) g.renderer.scene.remove(n.mesh);
    this.disposeObjectives();
    g.actors = []; g.nades = []; g.tags = []; g.timers = [];
    this.tide = []; this.pendingConvert.clear();
    g.score = this.score = { GR: 0, BL: 0 };
    this.round = 1;
    this.rules = null;
    this.heroGiven = false;
    g.env.apply(o.tod); g.applyFogOverride();
    const isConfront = this.mode === 'confront';
    const cfg = isConfront ? CONFRONT : DEMOL;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    g.player = new Player(g, { id: id++, name: '我', team: 'GR' });
    g.player.primary = o.primary;
    g.player.bind(document.getElementById('c'));
    g.actors.push(g.player);
    for (let i = 0; i < cfg.humans - 1; i++) {
      const b = new Bot(g, { id: id++, name: names.pop() || 'Bot' + id, team: 'GR', diff: o.diff });
      b.primary = ['ak47', 'awm', 'famas', 'thompson', 'm4a1', 'spas'][i % 6];
      g.actors.push(b);
    }
    for (let i = 0; i < cfg.mutants; i++) {
      const z = new Zombie(g, { id: id++, name: isConfront ? '守卫变异者' : '守巢变异者', team: 'BL' });
      if (isConfront) z.wozGuard = CONFRONT.points[i % CONFRONT.points.length]; // 分区驻守
      g.actors.push(z);
      if (!isConfront) z.wozRevives = DEMOL.mutantRespawns;
    }
    if (isConfront) this.points = CONFRONT.points.map((d) => new CapturePoint(g, d));
    else this.bomb = new NuclearBomb(g, DEMOL.site);
    for (const a of g.actors) {
      g.spawnActor(a, true);
      if (a.isZombie) { this.formZombie(a, isConfront ? 2500 : DEMOL.guardHp); a.protectT = 0.5; }
    }
    g.vm.setTeam('GR');
    g.vm.equip(g.player.weapon.id, 0.6);
    g.hud.slots(g.player.inv, 0);
    g.playing = true; g.paused = false; g.ended = false;
    this.hud.mount();
    g.hud.show(null);
    g.lock();
    setTimeout(() => g.audio.announce('Go go go!'), 400);
    g.timeLeft = isConfront ? CONFRONT.battleTime : DEMOL.battleTime;
    const modeName = isConfront ? '生化对抗' : '生化爆破';
    const tip = isConfront
      ? `人类攻方：占领全部 <b style="color:#8cc8ff">3</b> 个据点！变异者：守住到时间耗尽`
      : `人类攻方：冲入巢穴安放<b style="color:#ffd24a">核弹</b>！变异者：消灭人类或摧毁装置`;
    g.hud.toast(`<b style="color:#ff5040">${modeName}</b> · 先胜 ${ROUND_WINS} 回合 · ${tip}`, 4.5);
  }

  beginRound() {
    const g = this.g;
    this.round++;
    this.playerClassChosen = false;
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    // 清理尸潮
    for (const z of this.tide) g.renderer.scene.remove(z.soldier.root);
    this.tide = [];
    // 全员复活为人类，回 GR 出生点
    this.pendingConvert.clear();
    for (const a of g.actors) {
      this.restoreHuman(a, true);
    }
    this.rules.beginRound(this.seed);
    g.timeLeft = WOZ.buyTime + WOZ.battleTime + WOZ.roundEndTime + 30;
    if (g.player.alive) {
      g.vm.setVisible(true);
      g.vm.equip(g.player.weapon.id, 0.5);
      g.hud.slots(g.player.inv, g.player.slot);
    }
    g.audio.playUI('buy');
    g.hud.toast(`第 ${this.round} 回合 · 购买期`, 2);
    this.hud.onRoundStart();
  }

  restoreHuman(a, spawn) {
    const g = this.g;
    if (a.wozOutfit && a.wozOutfit !== 'GR') {
      g.renderer.scene.remove(a.soldier.root);
      a.soldier = new Soldier('GR');
      g.renderer.scene.add(a.soldier.root);
      if (a.isPlayer) a.soldier.root.visible = false;
    }
    if (a.isZombie) stripZombieAI(a);
    a.team = 'GR';
    a.wozOutfit = 'GR';
    a.speedMul = 1;
    a.wozOut = false;
    a.respawnT = 0;
    if (spawn) g.spawnActor(a, a.isPlayer && this.round === 1);
  }

  // ================= 每帧 =================
  tick(dt) {
    const g = this.g;
    if (!g.playing || g.ended) return;
    // 购买期结束自动关闭武器商店
    if (this.rules) {
      if (this.rules.phase === 'buy') this._buyOpen = true;
      else if (this._buyOpen) { this._buyOpen = false; if (g.inLoadout) g.closeLoadout(); }
    }
    if (this.cat() === 'confront') return this.tickConfront(dt);
    if (this.cat() === 'demol') return this.tickDemol(dt);
    this.tickInfection(dt);
  }

  tickInfection(dt) {
    const g = this.g, rules = this.rules;
    if (!rules) return;
    // 引擎伤害 → 规则层血池
    for (let i = 0; i < g.actors.length; i++) {
      const a = g.actors[i];
      if (i >= rules.playerCount) break;
      const st = rules.state(i);
      if (st.side === 'mutant' && st.alive && a.alive) st.hp = a.hp;
    }
    rules.tick(dt);
    // 规则层治疗 → 引擎血量；同步移速与尸体状态
    for (let i = 0; i < rules.playerCount; i++) {
      const a = g.actors[i], st = rules.state(i);
      if (st.side === 'mutant' && st.alive) {
        if (a.alive) a.hp = st.hp;
        a.speedMul = rules.mutantSpeedMultiplier(i);
        // 静止不动缓慢回血（对齐原作：变异者蛰伏回复）
        if (a.alive && (a.speed || 0) < 0.6 && rules.phase === 'battle') {
          const cap = rules.effectiveMaxHp(st);
          if (st.hp < cap) { st.hp = Math.min(cap, st.hp + 22 * dt); }
        }
      } else if (st.side === 'human') {
        a.speedMul = rules.humanSpeedMultiplier(i);
      }
      if (a.alive && a.staggerT > 0) a.speedMul = (a.speedMul || 1) * 0.45; // 命中暂缓减速
      if (a.blindT > 0) a.blindT = Math.max(0, a.blindT - dt);
    }
    this.devourAndSkills(dt);
    this.ambientGrowl(dt);
    // 生化模式：AI 怪物刷新 + 掉落拾取
    if (this.mode === 'bio') {
      this.aiT -= dt;
      const alive = this.tide.filter((z) => z.alive).length;
      if (this.aiT <= 0 && alive < BIO.aiMax && rules.phase === 'battle') {
        this.aiT = BIO.aiInterval;
        this.spawnAiZombie();
      }
      for (const ev of this.pickups.update(dt)) {
        if (ev.actor.isPlayer) wozAudio.devour(null);
      }
    }
    this.hud.update(rules, g.player, this);
    // 回合推进
    if (rules.phase === 'idle' && rules.result && !g.ended) {
      if (this.score.GR >= ROUND_WINS || this.score.BL >= ROUND_WINS) this.endMatch();
      else this.beginRound();
    }
  }

  // ---- 生化模式 AI 怪物 ----
  spawnAiZombie() {
    const g = this.g;
    const z = new Zombie(g, { id: 100 + this.tide.length + ((Math.random() * 90) | 0), name: '变异爬行者', team: 'BL', wozExtra: true });
    g.actors.push(z);
    this.tide.push(z);
    const sp = this.pickSpawn('BL');
    z.spawn(sp);
    this.formZombie(z, BIO.aiHp);
    z.protectT = 0.5;
    z.soldier.root.scale.setScalar(0.92);
  }

  // 统一：把角色落成持爪变异体形态（守卫/AI/转化共用）
  formZombie(a, hp) {
    a.hp = Math.max(1, Math.round(hp));
    a.armor = 0;
    a.wozHeavy = true;
    a.wozMaxHp = a.hp;
    a.inv = [new WeaponState('claw')];
    a.inv[0].patternSeed = Math.random() * 6;
    a.slot = 0;
    a.readyAt = this.g.time + 0.3;
    a.soldier.setWeapon('claw');
    return a;
  }

  // ---- 生化对抗：占领据点 ----
  tickConfront(dt) {
    const g = this.g;
    // 据点增益：A=攻击+10%，B=弹药补给（每 10s），C=移速+8%
    const owned = (n) => this.points.find((p) => p.def.name === n)?.owner === 'GR';
    this.buffAtk = owned('A');
    this.buffSpeed = owned('C');
    this.supplyT = (this.supplyT ?? 10) - dt;
    if (owned('B') && this.supplyT <= 0) {
      this.supplyT = 10;
      for (const a of g.actors) {
        if (!a.alive || a.team !== 'GR') continue;
        for (const w of a.inv) { const d = w.def; if (d.type !== 'melee' && d.type !== 'grenade') w.reserve += Math.ceil(d.mag / 2); }
      }
      if (g.player.alive) g.hud.toast('据点 B 弹药补给已下发', 1.5);
    }
    for (const p of this.points) {
      const ev = p.update(dt);
      if (ev === 'captured') {
        g.hud.toast(`据点 <b style="color:#8cc8ff">${p.def.name}</b> 已占领！`, 2);
        wozAudio.avenger(null);
      }
    }
    for (const a of g.actors) if (a.alive && a.team === 'GR') a.speedMul = 1 + (this.buffSpeed ? 0.08 : 0);
    if (this.points.every((p) => p.owner === 'GR')) return this.endObjectives('GR', '人类攻占了全部据点！');
    if (g.timeLeft <= 0) return this.endObjectives('BL', '时间耗尽，变异者守住了据点！');
    this.hud.updateObj(this.objData());
  }

  // ---- 生化爆破：核弹装置 ----
  tickDemol(dt) {
    const g = this.g;
    const ev = this.bomb.update(dt);
    if (ev === 'planted') {
      const hero = g.actors[this.bomb.planter];
      if (hero && !this.heroGiven) this.evolveHero(hero);
      // 守卫增援波次：安放后立刻空降 2 名守卫
      for (let i = 0; i < 2; i++) {
        const z = new Zombie(g, { id: 90 + i, name: '增援守卫', team: 'BL' });
        g.actors.push(z);
        this.tide.push(z);
        const sp = this.pickSpawn('BL');
        z.spawn(sp);
        this.formZombie(z, DEMOL.guardHp);
        z.wozRevives = 1;
        z.protectT = 0.5;
      }
      g.hud.toast('<b style="color:#ffd24a">核弹已安放！</b>变异者增援已抵达，守住 45 秒！', 3.5);
      wozAudio.tide();
    } else if (ev === 'detonated') {
      g.fx.explosion(this.bomb.pos.clone());
      g.fx.shake = 2;
      return this.endObjectives('GR', '核弹引爆，变异者巢穴覆灭！');
    } else if (ev === 'destroyed') {
      return this.endObjectives('BL', '核弹被变异者摧毁！');
    }
    // 安放前人类全灭 → 变异者胜
    if ((this.bomb.state === 'idle' || this.bomb.state === 'planting') && !g.actors.some((a) => a.alive && a.team === 'GR')) {
      return this.endObjectives('BL', '人类全灭！');
    }
    this.hud.updateObj(this.objData());
  }

  evolveHero(a) {
    this.heroGiven = true;
    if (a.wozOutfit !== 'AVG') {
      this.g.renderer.scene.remove(a.soldier.root);
      a.soldier = new Soldier('AVG');
      this.g.renderer.scene.add(a.soldier.root);
      if (a.isPlayer) a.soldier.root.visible = false;
    }
    a.wozOutfit = 'AVG';
    a.hp = DEMOL.heroHp;
    a.armor = 100;
    a.heroMul = DEMOL.heroDamage;
    a.speedMul = DEMOL.heroSpeed;
    if (a.isPlayer) {
      this.g.hud.toast('<b style="color:#60e0ff">你率先安放核弹，进化为英雄！</b>', 3.5);
      this.g.audio.announce('Hero online!');
    }
    wozAudio.avenger(a.isPlayer ? null : a.pos.clone());
  }

  // 目标物模式回合/对局结算
  endObjectives(winner, msg) {
    const g = this.g;
    this.score[winner]++;
    const hero = this.g.player.team === 'GR';
    const win = winner === 'GR';
    g.hud.toast(`<b style="color:${win ? '#8cc8ff' : '#ff5040'}">${hero ? (win ? '胜利！' : '失败！') : (win ? '失败！' : '胜利！')}</b> ${msg}（${this.score.GR}:${this.score.BL}）`, 3.5);
    if (this.score.GR >= ROUND_WINS || this.score.BL >= ROUND_WINS) return this.endMatch();
    // 下一回合
    this.round++;
    this.disposeObjectives();
    if (this.mode === 'confront') this.points = CONFRONT.points.map((d) => new CapturePoint(g, d));
    else this.bomb = new NuclearBomb(g, DEMOL.site);
    this.heroGiven = false;
    for (const a of g.actors) {
      if (a.isZombie && a.wozRevives !== undefined) a.wozRevives = DEMOL.mutantRespawns;
      g.spawnActor(a, false);
      if (a.isZombie) this.formZombie(a, a.wozMaxHp || 2000);
      else { a.heroMul = 1; a.speedMul = 1; }
    }
    g.timeLeft = this.mode === 'confront' ? CONFRONT.battleTime : DEMOL.battleTime;
    g.hud.toast(`第 ${this.round} 回合开始`, 2);
  }

  disposeObjectives() {
    for (const p of this.points) p.dispose();
    this.points = [];
    if (this.bomb) { this.bomb.dispose(); this.bomb = null; }
    this.pickups.clear();
  }

  // BOT 目标物战术：对抗 → 攻方冲未占领据点 / 守方分区驻守；爆破 → 攻方推巢穴，守方护巢
  botObjective(bot) {
    if (this.cat() === 'confront') {
      if (bot.team === 'BL') {
        const gd = bot.wozGuard;
        if (!gd) return null;
        // 距驻点 >7m 时回防，否则就地缠斗
        return Math.hypot(bot.pos.x - gd.x, bot.pos.z - gd.z) > 7
          ? [gd.x + (Math.random() - 0.5) * 3, gd.z + (Math.random() - 0.5) * 3]
          : null;
      }
      const open = this.points.filter((p) => p.owner !== 'GR');
      if (open.length === 0) return null;
      // 就近优先（带随机性分散兵力）
      open.sort((a, b) => bot.pos.distanceTo(new THREE.Vector3(a.def.x, 0, a.def.z))
        - bot.pos.distanceTo(new THREE.Vector3(b.def.x, 0, b.def.z)));
      const pt = (Math.random() < 0.7 ? open[0] : open[(Math.random() * open.length) | 0]).def;
      return [pt.x + (Math.random() - 0.5) * 2, pt.z + (Math.random() - 0.5) * 2];
    }
    if (this.cat() === 'demol') {
      if (bot.team === 'BL') {
        const d = this.bomb ? this.bomb.def : DEMOL.site;
        return Math.hypot(bot.pos.x - d.x, bot.pos.z - d.z) > 9
          ? [d.x + (Math.random() - 0.5) * 4, d.z + (Math.random() - 0.5) * 4]
          : null;
      }
      if (!this.bomb || this.bomb.state === 'planted' || this.bomb.state === 'destroying') return null;
      const d = this.bomb.def;
      return [d.x + (Math.random() - 0.5) * 4, d.z + (Math.random() - 0.5) * 4];
    }
    return null;
  }

  objData() {
    return {
      mode: this.mode,
      points: this.points.map((p) => ({ name: p.def.name, owner: p.owner, progress: Math.round(p.progress), contested: p.contested })),
      bomb: this.bomb ? { state: this.bomb.state, timer: Math.max(0, Math.ceil(this.bomb.timer)), prog: this.bomb.progress, canPlant: this.bomb.canPlant } : null,
      buffs: { atk: !!this.buffAtk, speed: !!this.buffSpeed, supply: this.points.find((p) => p.def.name === 'B')?.owner === 'GR' } ,
    };
  }

  // 小地图目标点标记（据点 / 核弹站点 / 已安放核弹）
  radarMarkers() {
    const ms = [];
    for (const p of this.points) {
      ms.push({ kind: 'point', x: p.def.x, z: p.def.z, label: p.def.name, owner: p.owner, contested: p.contested });
    }
    if (this.bomb) {
      const b = this.bomb;
      if (b.state === 'planted' || b.state === 'destroying') ms.push({ kind: 'bomb', x: b.pos.x, z: b.pos.z });
      else if (b.state !== 'detonated' && b.state !== 'destroyed') ms.push({ kind: 'site', x: b.def.x, z: b.def.z });
    }
    return ms;
  }

  // 屏幕外目标方向（未占领据点 / 核弹），供屏幕边缘箭头使用
  offscreenDirs(cam) {
    const list = [];
    const v = new THREE.Vector3();
    const consider = (x, z, label, css) => {
      v.set(x, 1.5, z).project(cam);
      const behind = v.z > 1;
      if (!behind && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.95) return; // 已在屏内
      let dx = v.x, dy = v.y;
      if (behind) { dx = -dx; dy = -dy; }
      if (Math.hypot(dx, dy) < 1e-4) return;
      list.push({ ang: Math.atan2(dy, dx), label, css });
    };
    for (const p of this.points) {
      if (p.owner === 'GR') continue;
      consider(p.def.x, p.def.z, p.def.name, p.contested ? '#ffd24a' : '#cfd6dd');
    }
    if (this.bomb && this.bomb.state !== 'detonated' && this.bomb.state !== 'destroyed') {
      const b = this.bomb;
      const planted = b.state === 'planted' || b.state === 'destroying';
      consider((planted ? b.pos.x : b.def.x), (planted ? b.pos.z : b.def.z), '☢', planted ? '#ff4030' : '#ffd24a');
    }
    return list;
  }

  // 玩家所处目标区域的情境交互提示（null = 无提示）
  promptFor(p) {
    if (!p || !p.alive) return null;
    const human = p.team === 'GR';
    for (const pt of this.points) {
      const d = Math.hypot(p.pos.x - pt.def.x, p.pos.z - pt.def.z);
      if (d > pt.def.r) continue;
      if (human) {
        if (pt.contested) return { kind: 'gold', title: '据点争夺冻结！', sub: '击退区域内变异者即可推进占领', prog: pt.progress / 100 };
        if (pt.owner === 'GR') {
          const buffs = { A: '攻击 +10%', B: '弹药持续补给', C: '移动速度 +8%' }[pt.def.name];
          return { kind: 'blue', title: `${pt.def.name} 点已占领`, sub: buffs ? `增益生效：${buffs}` : '守住据点' };
        }
        return { kind: 'blue', title: `正在占领 ${pt.def.name} 点`, sub: '保持驻留直到进度走满', prog: pt.progress / 100 };
      }
      if (pt.contested) return { kind: 'red', title: '人类正在抢占据点！', sub: '冲入据点击退他们', prog: pt.progress / 100 };
      if (pt.owner !== 'BL') return { kind: 'red', title: `人类占领 ${pt.def.name} 点中`, sub: '进入据点阻止占领', prog: pt.progress / 100 };
      return { kind: 'red', title: `${pt.def.name} 点已控制`, sub: '继续守住据点' };
    }
    if (this.bomb) {
      const b = this.bomb;
      const siteD = Math.hypot(p.pos.x - b.def.x, p.pos.z - b.def.z);
      const bombD = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      if (human) {
        if (b.state === 'idle' && siteD <= b.def.r) {
          return { kind: 'gold', title: '按住 <kbd>E</kbd> 安放核弹', sub: `安放需 ${DEMOL.plantTime} 秒 · 率先安放者进化为英雄`, prog: 0 };
        }
        if (b.state === 'planting' && siteD <= b.def.r) return { kind: 'gold', title: '正在安放核弹…', sub: '松开 E 将中断安放', prog: b.progress };
        if (b.state === 'planted' || b.state === 'destroying') {
          return {
            kind: 'red',
            title: `核弹已安放 · ${Math.max(0, Math.ceil(b.timer))}s 后引爆`,
            sub: bombD <= b.def.r + 4 ? '警报：变异者正在摧毁核弹！' : '撤离或防守核弹',
            prog: 1 - Math.max(0, b.timer) / DEMOL.bombTime,
          };
        }
      } else {
        if ((b.state === 'idle' || b.state === 'planting') && siteD <= b.def.r + 4) {
          return b.state === 'idle'
            ? { kind: 'red', title: '巢穴防线', sub: '阻止人类在此安放核弹！' }
            : { kind: 'red', title: '人类正在安放核弹！', sub: '冲进站点打断他们！' };
        }
        if (b.state === 'planted' && bombD <= 3.5) return { kind: 'red', title: '正在摧毁核弹…', sub: '停留在核弹旁保持摧毁进度', prog: b.progress };
        if (b.state === 'planted') return { kind: 'red', title: `核弹已安放 · ${Math.max(0, Math.ceil(b.timer))}s`, sub: '靠近核弹将其摧毁！' };
        if (b.state === 'destroying' && bombD <= 3.5) return { kind: 'red', title: '正在摧毁核弹…', sub: '停留直到摧毁完成', prog: b.progress };
      }
    }
    return null;
  }

  devourAndSkills(dt) {
    const g = this.g, rules = this.rules;
    void dt;
    // BOT 变异者：低血自动吞噬 / 充能满自动放技能
    for (const a of g.actors) {
      if (a.isPlayer || !a.alive || !rules.isMutantSide(a.id) || a.id >= rules.playerCount) continue;
      const st = rules.state(a.id);
      if (!st.alive || st.side !== 'mutant') continue;
      if (st.devourCooldown <= 0 && st.hp < this.effMaxHp(st) * 0.6) {
        const c = this.findCorpse(a);
        if (rules.tryDevour(a.id, c)) a.hp = st.hp;
      }
      if (!st.skillActive && st.skillCharge >= 1 && Math.random() < 0.02) {
        const enemy = this.nearestEnemy(a);
        const dist = enemy ? a.pos.distanceTo(enemy.pos) : 1e9;
        if (dist < 25 || st.hp < this.effMaxHp(st) * 0.4) rules.tryUseSkill(a.id);
      }
    }
  }

  effMaxHp(st) {
    return st.maxHp + st.evoPoints * WOZ.evoHpPerPoint;
  }

  findCorpse(a) {
    const g = this.g, rules = this.rules;
    let best = -1, bestD = 2.5;
    for (let i = 0; i < rules.playerCount; i++) {
      if (i === a.id) continue;
      const other = g.actors[i], st = rules.state(i);
      if (other.alive || st.side !== 'mutant') continue;
      const d = other.pos.distanceTo(a.pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  nearestEnemy(a) {
    const g = this.g, rules = this.rules;
    let best = null, bestD = Infinity;
    for (let i = 0; i < g.actors.length; i++) {
      const o = g.actors[i];
      if (!o.alive || o === a) continue;
      if (rules.isMutantSide(i) === rules.isMutantSide(a.id)) continue;
      const d = o.pos.distanceTo(a.pos);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  ambientGrowl(dt) {
    this.growlT -= dt;
    if (this.growlT <= 0) {
      this.growlT = 4 + Math.random() * 6;
      const rules = this.rules;
      const mutants = this.g.actors.filter((a) => a.alive && rules.isMutantSide(a.id));
      if (mutants.length && this.rules.phase === 'battle') {
        const m = mutants[(Math.random() * mutants.length) | 0];
        wozAudio.growl(m.isPlayer ? null : m.pos.clone());
      }
    }
  }

  // ================= 玩家按键（在 pressed.clear() 前由 player.update 调用） =================
  onPlayerInput(p) {
    const g = this.g, rules = this.rules;
    if (!rules || rules.phase !== 'battle' || !p.alive) return;
    if (!rules.isMutantSide(p.id)) return;
    const st = rules.state(p.id);
    if (!st.alive) return;
    // E 吞噬
    if (p.consumePressed('KeyE')) {
      const corpse = this.findCorpse(p);
      if (rules.tryDevour(p.id, corpse)) {
        p.hp = st.hp;
        g.hud.toast('吞噬！恢复血量并获得进化点', 1.5);
      } else if (corpse >= 0) g.hud.toast('吞噬冷却中…', 1);
      else g.hud.toast('附近没有可吞噬的变异者尸体', 1);
    }
    // G 技能
    if (p.consumePressed('KeyG')) {
      if (!rules.tryUseSkill(p.id)) g.hud.toast(`技能充能 ${(st.skillCharge * 100) | 0}%`, 1);
    }
    // 5/6/7 子体变身
    for (const [code, cls] of [['Digit5', MutantClass.Nightrunner], ['Digit6', MutantClass.Souleater], ['Digit7', MutantClass.Devourer]]) {
      if (p.consumePressed(code) && rules.setMutantClass(p.id, cls)) this.playerClassChosen = true;
    }
  }

  // 感染变身选择面板：玩家已转化但尚未主动选职业（WOZ 特色交互）
  pickNeeded() {
    const rules = this.rules, p = this.g.player;
    if (!rules || rules.phase !== 'battle' || this.playerClassChosen) return false;
    const st = rules.state(p.id);
    return st.side === 'mutant' && !st.isMother;
  }

  // ================= 死亡 / 重生 =================
  onKill(victim, attacker) {
    const g = this.g, rules = this.rules;
    if (!rules) {
      // 目标物模式（对抗/爆破）：无感染转化，按模式重生策略
      if (this.cat() === 'confront') {
        victim.respawnT = victim.team === 'GR' ? CONFRONT.humanRespawn : CONFRONT.mutantRespawn;
      } else {
        if (victim.team === 'BL' && victim.wozRevives > 0) {
          victim.wozRevives--;
          victim.respawnT = 6;
          g.hud.toast('守巢变异者强化复活！', 1.5);
        } else victim.respawnT = 1e9;
      }
      return;
    }
    const vid = victim.id;
    if (vid >= rules.playerCount) {
      // 生化模式：AI 怪物死亡掉落补给
      if (this.mode === 'bio') this.pickups.randomDrop(victim.pos);
      return;
    } // 尸潮 AI 不进规则层
    const attId = attacker && attacker !== victim && attacker.id < rules.playerCount ? attacker.id : -1;
    const wasHuman = rules.state(vid).side === 'human';
    rules.reportDeath(vid, attId);
    victim.respawnT = wasHuman ? 2.2 : 1.2;
    if (wasHuman) this.pendingConvert.add(vid);
    // 人类侧击杀奖励（原作击杀发钱 → 这里给进化学击杀计数已在规则层处理）
    if (this.rules.humansAlive() === 0) return; // 结果已由规则层结算
  }

  onRespawnDue(a) {
    const g = this.g, rules = this.rules;
    if (!rules) {
      if (a.respawnT > 1e8) { a.wozOut = true; return; }
      g.spawnActor(a, false);
      if (a.isZombie) { this.formZombie(a, a.wozMaxHp || 2000); a.protectT = 0.5; }
      return;
    }
    if (a.id >= rules.playerCount) {
      // 尸潮 AI：死亡即退场
      a.respawnT = 1e9;
      a.wozOut = true;
      g.renderer.scene.remove(a.soldier.root);
      return;
    }
    const st = rules.state(a.id);
    if (st.side === 'mutant' && !st.alive) {
      if (st.reviveTimer > 0) { a.respawnT = Math.min(st.reviveTimer, 0.5); return; } // 等复活倒计时
      // 感染模式阵亡变异者：本回合退场
      a.respawnT = 1e9;
      a.wozOut = true;
      return;
    }
    if (this.pendingConvert.has(a.id)) {
      this.pendingConvert.delete(a.id);
      this.convertNow(a, true); // 原地变身（对齐原作：感染后在原地转化，不去复活点）
      return;
    }
    if (st.alive && st.side === 'mutant') { this.convertNow(a, true); return; } // 复仇模式再变异重生
    // 保险：人类正常重生（不应发生）
    g.spawnActor(a);
    a.hp = 100; a.armor = 100;
  }

  // 把引擎角色落成变异者形态
  convertNow(a, keepPos = false) {
    const g = this.g, rules = this.rules;
    const st = rules.state(a.id);
    if (a.team !== 'BL') {
      g.renderer.scene.remove(a.soldier.root);
      a.soldier = new Soldier('MUT');
      g.renderer.scene.add(a.soldier.root);
      if (a.isPlayer) a.soldier.root.visible = false;
    }
    a.team = 'BL';
    a.wozOutfit = 'MUT';
    a.wozHeavy = true;
    a.wozOut = false;
    const sp = this.pickSpawn('BL');
    if (!keepPos) {
      a.pos.set(sp.x, 0.02, sp.z); a.vel.set(0, 0, 0);
      a.yaw = sp.yaw; a.pitch = 0;
    }
    a.alive = true; a.deadT = 0; a.respawnT = 0;
    a.hp = Math.max(1, Math.round(st.hp));
    a.armor = 0;
    a.height = 1.8; a.eyeH = 1.62; a.crouch = false;
    a.protectT = 1.0;
    a.inv = [new WeaponState('claw')];
    a.inv[0].patternSeed = Math.random() * 6;
    a.slot = 0; a.lastSlot = 0;
    a.readyAt = g.time + 0.3;
    a.soldier.reset();
    a.soldier.setWeapon('claw');
    a.soldier.root.position.copy(a.pos);
    a.soldier.root.visible = !a.isPlayer;
    a.soldier.root.scale.setScalar(st.isMother ? 1.28 : st.cls === MutantClass.Devourer ? 1.18 : 1.08);
    if (a.isPlayer) {
      a.deathCam = null;
      g.vm.equip('claw', 0.4);
      g.vm.setVisible(true);
      g.hud.slots(a.inv, 0);
      g.hud.toast(`你被感染了！当前形态：<b style="color:#ff7040">${CLASS_LABEL[st.cls] || '变异者'}</b>（右下可变身职业）`, 3.5);
      g.audio.setLowHealth(false);
      wozAudio.convert(a.pos.clone());
    } else wozAudio.convert(a.pos.clone());
    if ((a instanceof Bot) && !a.isZombie) toZombieAI(a);
    wozAudio.growl(a.isPlayer ? null : a.pos.clone());
  }

  pickSpawn(team) {
    const g = this.g;
    const pts = g.map.spawns[team];
    let best = pts[0], bestScore = -1e9;
    for (const p of pts) {
      let sc = Math.random() * 3;
      for (const o of g.actors) {
        if (!o.alive) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (d < 1.2) sc -= 100;
        if ((o.team === 'GR') !== (team === 'GR')) sc += Math.min(d, 40) * 0.1;
      }
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    return best;
  }

  // ================= 伤害调整 =================
  adjustDamage(v, att) {
    const rules = this.rules;
    let mul = 1;
    if (att && att.heroMul) mul *= att.heroMul; // 爆破模式英雄
    if (!rules) {
      if (att && att.team === 'GR' && this.cat() === 'confront' && this.buffAtk) mul *= 1.1; // 据点 A 增益
      return mul;
    }
    if (att && att.id < rules.playerCount) {
      const st = rules.state(att.id);
      if (st.side === 'mutant') mul *= rules.damageMultiplier(st);
    }
    if (v.id < rules.playerCount) {
      const vs = rules.state(v.id);
      if (vs.side === 'mutant') {
        if (vs.skillActive && vs.cls === MutantClass.Devourer) mul *= 1 - WOZ.hardenReduction;
      } else {
        mul *= 1 - rules.humanDamageReduction(v.id);
      }
    }
    return mul;
  }

  // ================= 规则层回调 =================
  onMutantConverted(id, cls, isMother, rebirth) {
    // 母体：爆发瞬间直接落地引擎形态；再变异：即时重生
    if (rebirth || isMother) {
      const a = this.g.actors[id];
      if (a) this.convertNow(a);
      else this.pendingConvert.add(id);
    }
    void cls;
  }

  onMutantClassChanged(id, cls) {
    const g = this.g, a = g.actors[id];
    if (!a) return;
    const st = this.rules.state(id);
    a.hp = Math.max(1, st.hp);   // 规则层已按新职业重置血池
    a.soldier.root.scale.setScalar(st.cls === MutantClass.Devourer ? 1.18 : 1.08); // 体型同步
    if (this._autoCls === id) { this._autoCls = -1; } // 感染时的自动默认职业不重复播报
    else g.hud.eventFeed(`${a.name} 进化为 <b>${CLASS_LABEL[cls] || '变异者'}</b>`, 'evo');
    if (a.isPlayer) g.hud.toast(`已变身：<b style="color:#ff7040">${CLASS_LABEL[cls]}</b>`, 2);
  }

  onInfected(victimId, attackerId) {
    const v = this.g.actors[victimId], at = this.g.actors[attackerId];
    this.g.hud.eventFeed(`${v?.name || '?'} ☣ 被感染了${at ? ` · ${at.name}` : ''}`, 'inf');
    // BOT 子体随机职业（玩家保留默认夜行者自选变身）
    const a = v;
    if (!a || a.isPlayer || this.rules.state(victimId).isMother) return;
    this._autoCls = victimId;
    const r = Math.random();
    const changed = this.rules.setMutantClass(victimId, r < 0.5 ? MutantClass.Nightrunner : r < 0.8 ? MutantClass.Souleater : MutantClass.Devourer);
    if (!changed) this._autoCls = -1; // 职业未变（默认夜行者）时清除抑制标记，避免吃掉后续手动播报
  }

  onSkillFired(id, skill) {
    const g = this.g, a = g.actors[id];
    if (!a) return;
    if (skill === 'dash') {
      a.forward(_fwd);
      a.vel.x += _fwd.x * 11; a.vel.z += _fwd.z * 11;
      a.vel.y = Math.max(a.vel.y, 3.2);
      wozAudio.dash(a.isPlayer ? null : a.pos.clone());
      if (a.isPlayer) g.hud.toast('疾冲！', 0.8);
    } else if (skill === 'blindWail') {
      wozAudio.wail(a.isPlayer ? null : a.pos.clone());
      for (let i = 0; i < this.rules.playerCount; i++) {
        const h = g.actors[i], st = this.rules.state(i);
        if (st.side !== 'human' || !h.alive) continue;
        if (h.pos.distanceTo(a.pos) <= WOZ.blindWailRange) h.blindT = WOZ.blindWailDuration;
      }
      if (a.isPlayer) g.hud.toast('致盲尖啸！', 1);
    } else if (skill === 'rage') {
      wozAudio.wail(a.isPlayer ? null : a.pos.clone());
      if (a.isPlayer) g.hud.toast('狂暴咆哮！附近变异者加速', 1.5);
    } else if (skill === 'harden') {
      wozAudio.harden(a.isPlayer ? null : a.pos.clone());
      if (a.isPlayer) g.hud.toast('硬化！减伤 70%', 1);
    }
  }

  onAvengerTransformed(id) {
    const g = this.g, a = g.actors[id], st = this.rules.state(id);
    if (a.team !== 'GR') {
      g.renderer.scene.remove(a.soldier.root);
      a.soldier = new Soldier('AVG');
      g.renderer.scene.add(a.soldier.root);
      if (a.isPlayer) a.soldier.root.visible = false;
    }
    a.team = 'GR';
    a.wozOutfit = 'AVG';
    a.hp = Math.round(st.hp);
    a.armor = 0;
    a.heroLight = new THREE.PointLight(0x60e0ff, 2.4, 9);
    a.heroLight.position.set(0, 1.6, 0);
    a.soldier.root.add(a.heroLight); // 英雄光环
    a.wozOut = false; a.alive = true; a.respawnT = 0;
    a.inv = a.inv.map((w) => (w && w.def.type === 'melee' ? new WeaponState('chainsaw') : w));
    if (!a.inv.some((w) => w && w.id === 'chainsaw')) a.inv[2] = new WeaponState('chainsaw');
    a.slot = 2; // 电锯在军刀槽，按 3 可切回主武器/副武器/投掷
    a.readyAt = g.time + 0.5;
    a.soldier.reset();
    a.soldier.setWeapon('chainsaw');
    a.soldier.root.position.copy(a.pos);
    a.soldier.root.visible = !a.isPlayer;
    if (a.isPlayer) {
      g.vm.equip('chainsaw', 0.5);
      g.vm.setVisible(true);
      g.hud.slots(a.inv, 0);
      g.hud.toast('<b style="color:#60e0ff">生化复仇者觉醒！</b> 电锯轻击 500 · 重击必杀', 4);
    }
    g.audio.announce('Avenger online!');
    wozAudio.avenger(a.isPlayer ? null : a.pos.clone());
    g.hud.eventFeed(`⚡ ${a.name} 觉醒为<b>生化复仇者</b>！`, 'avg', 10);
    this.hud.avengerBanner(a.name);
  }

  onDevoured(mutantId, corpseId) {
    void corpseId;
    const a = this.g.actors[mutantId];
    if (a) wozAudio.devour(a.isPlayer ? null : a.pos.clone());
  }

  onMutantKilledByHuman(victimId, killerId) {
    void victimId; void killerId;
  }

  onHumanTierUp(id, tier) {
    const g = this.g, a = g.actors[id];
    if (!a) return;
    // 进化奖励：全部武器备弹 +1 弹匣
    for (const w of a.inv) {
      const d = w.def;
      if (d.type !== 'melee' && d.type !== 'grenade') w.reserve += d.mag;
    }
    if (a.isPlayer) g.hud.toast(`人类进化 <b style="color:#8cc8ff">Lv.${tier}</b>：移速提升 · 备弹增加 · 减伤提升`, 2.5);
  }

  onCorpseTide(count) {
    const g = this.g;
    g.hud.eventFeed(`☠ <b>尸潮降临！</b>${count} 只 AI 变异者涌入战场`, 'tide', 10);
    for (let i = 0; i < count; i++) {
      const z = new Zombie(g, { id: 100 + i, name: '尸潮', team: 'BL', wozExtra: true });
      g.actors.push(z);
      this.tide.push(z);
      const sp = this.pickSpawn('BL');
      z.spawn(sp);
      z.hp = WOZ.childHp; z.armor = 0;
      z.inv = [new WeaponState('claw')];
      z.slot = 0;
      z.soldier.setWeapon('claw');
      z.protectT = 1;
    }
    g.hud.toast('<b style="color:#ff5040">尸潮来袭！</b>', 3);
    wozAudio.tide();
  }

  onResult(result) {
    const g = this.g;
    if (result === 'humansSurvived') this.score.GR++;
    else this.score.BL++;
    const human = result === 'humansSurvived';
    g.hud.toast(human
      ? `<b style="color:#8cc8ff">人类胜利！</b> (${this.score.GR} : ${this.score.BL})`
      : `<b style="color:#ff5040">变异者胜利！</b> (${this.score.GR} : ${this.score.BL})`, 3.5);
    g.audio.playUI(human ? 'roundEnd' : 'death');
  }

  endMatch() {
    const g = this.g;
    g.ended = true; g.playing = false;
    this.disposeObjectives();
    const win = this.score.GR === this.score.BL ? null : this.score.GR > this.score.BL;
    g.hud.endScreen(win, this.score, g.actors, g.player.id);
    g.audio.playUI('roundEnd'); g.audio.setLowHealth(false);
    g.audio.announce(win ? 'Mission accomplished' : win === null ? 'Draw' : 'Mission failed');
    if (document.pointerLockElement) document.exitPointerLock();
    g.vm.setVisible(false);
    this.hud.unmount();
  }

  onQuit() {
    this.hud.unmount();
    this.disposeObjectives();
  }
}

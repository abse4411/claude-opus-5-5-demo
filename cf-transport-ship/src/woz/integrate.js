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
import { WOZ, MutantClass, CLASS_LABEL, CONFRONT, DEMOL, BIO, AIRDROP } from './config.js';
import { audio } from '../audio.js';

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
    this.disguiseReveal = WOZ.disguiseReveal; // V55 混入伪装识破距离（bots.js 读取）
    // 目标物模式（对抗 / 爆破）
    this.points = [];
    this.bomb = null;
    this.pickups = new Pickups(game);
    this.aiT = 0;
    this.heroGiven = false;
    this.playerClassChosen = false; // 玩家是否已主动选择变异者职业
    this.axes = [];                   // 猎食者投掷斧头抛射物
    this.grabs = [];                  // 缠绕者触须拖拽
    this.fuses = [];                  // 爆破者自爆引信
    this.airdrops = [];               // 补给空投
    this.dropT = AIRDROP.first;
    this.supplyT = 45;                // 补给变异体刷新（V35）
    this.props = [];                  // 场景道具：爆炸油桶 / 可破坏木箱（V39）
    this._evoStageSeen = {};          // 进化阶段播报去重
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
    g.player.secondary = o.secondary;
    g.player.melee = o.melee;
    g.player.bind(document.getElementById('c'));
    g.actors.push(g.player);
    const prim = (i) => ['ak47', 'awm', 'famas', 'mp5', 'thompson', 'm24', 'm4a1', 'spas', 'g3sg1', 'aug', 'p90', 'scarl', 'm14ebr', 'm3super', 'mac10', 'qbz95', 'xm8', 'dualuzi'][i % 18];
    for (let i = 0; i < 9; i++) {
      const b = new Bot(g, { id: id++, name: names.pop() || 'Bot' + id, team: 'GR', diff: o.diff });
      b.primary = prim(i);
      b.secondary = ['deagle', 'usp', 'r8'][i % 3];
      g.actors.push(b);
    }
    this.rules = new WozRules(this.mode, g.actors.length, this);
    this.beginRound();
    g.vm.setTeam('GR');
    g.vm.equip(g.player.weapon.id, 0.6);
    g.hud.slots(g.player.inv, 0);
    g.playing = true; g.paused = false; g.ended = false;
    this.spawnProps(); // 对抗/爆破也生成场景道具（V39）
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
    g.player.secondary = o.secondary;
    g.player.melee = o.melee;
    g.player.bind(document.getElementById('c'));
    g.actors.push(g.player);
    for (let i = 0; i < cfg.humans - 1; i++) {
      const b = new Bot(g, { id: id++, name: names.pop() || 'Bot' + id, team: 'GR', diff: o.diff });
      b.primary = ['ak47', 'awm', 'famas', 'thompson', 'm4a1', 'spas', 'aug', 'p90', 'scarl', 'm14ebr', 'm3super', 'mac10'][i % 12];
      b.secondary = ['deagle', 'usp', 'r8'][i % 3];
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
    this._evoStageSeen = {};
    this.waveT = undefined; this.waveN = 0; this._bioFrenzy = false; // 波次/狂潮状态复位
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    // 清理尸潮与抛射物
    for (const z of this.tide) g.renderer.scene.remove(z.soldier.root);
    this.tide = [];
    this.clearAxes();
    this.clearGrabs();
    this.clearFuses();
    this.clearAirdrops();
    this.dropT = AIRDROP.first;
    this.spawnProps();
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
    if (a.evoLight) { a.evoLight.parent?.remove(a.evoLight); a.evoLight = null; } // 清三阶进化光效
    a.rootT = 0;
    if (spawn) g.spawnActor(a, a.isPlayer && this.round === 1);
  }

  // ================= 每帧 =================
  tick(dt) {
    const g = this.g;
    if (!g.playing || g.ended) return;
    this.tickAxes(dt);
    this.tickGrabs(dt);
    this.tickFuses(dt);
    this.tickAirdrops(dt);
    // 购买期结束自动关闭武器商店
    if (this.rules) {
      if (this.rules.phase === 'buy') this._buyOpen = true;
      else if (this._buyOpen) { this._buyOpen = false; if (g.inLoadout) g.closeLoadout(); }
    }
    if (this.cat() === 'confront') return this.tickConfront(dt);
    if (this.cat() === 'demol') return this.tickDemol(dt);
    this.tickInfection(dt);
  }

  // ---- 猎食者投掷斧头（原作技能）：直线带重力 arc 抛射物 ----
  throwAxe(a) {
    const g = this.g;
    const dir = new THREE.Vector3();
    if (a.isPlayer) g.renderer.camera.getWorldDirection(dir);
    else a.forward(dir);
    const pos = a.pos.clone(); pos.y += 1.5;
    // 稍作上抬补偿重力下坠，近距平直远距抛物
    dir.y += a.isPlayer ? 0.02 : Math.min(0.09, a.pos.distanceTo(this.nearestEnemy(a)?.pos ?? a.pos) * 0.004);
    dir.normalize();
    const grp = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.66, 0.05), new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.04), new THREE.MeshLambertMaterial({ color: 0xc8ccd2, emissive: 0x361111 }));
    blade.position.y = 0.28;
    grp.add(handle, blade);
    grp.position.copy(pos);
    g.renderer.scene.add(grp);
    const mul = a.id >= 0 && a.id < this.rules.playerCount ? this.rules.damageMultiplier(this.rules.state(a.id)) : 1;
    this.axes.push({ live: true, mesh: grp, pos, vel: dir.multiplyScalar(WOZ.axeSpeed), owner: a, dmg: WOZ.axeDamage * mul, life: WOZ.axeLifetime });
    if (a.isPlayer) g.hud.toast('投掷斧头！', 0.8);
    g.audio.playGrenadeThrow();
    wozAudio.axeThrow(a.isPlayer ? null : a.pos.clone());
  }

  tickAxes(dt) {
    const g = this.g;
    for (const ax of this.axes) {
      if (!ax.live) continue;
      ax.life -= dt;
      ax.vel.y -= WOZ.axeGravity * dt;
      const step = ax.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hitWall = len > 0 ? g.world.raycast(ax.pos.x, ax.pos.y, ax.pos.z, step.x / len, step.y / len, step.z / len, len, 'bullet') : null;
      ax.pos.add(step);
      ax.mesh.position.copy(ax.pos);
      ax.mesh.rotation.x -= 16 * dt;
      let hitActor = null;
      for (const v of g.actors) {
        if (!v.alive || v === ax.owner || v.team === ax.owner.team || v.wozOut) continue;
        const dx = v.pos.x - ax.pos.x, dz = v.pos.z - ax.pos.z;
        if (dx * dx + dz * dz > 0.85) continue;
        const dy = ax.pos.y - v.pos.y;
        if (dy > -0.3 && dy < 1.8) { hitActor = v; break; } // 命中身体区间（脚部-0.3 ~ 头部1.8）
      }
      if (hitActor) {
        ax.live = false;
        const dir = ax.vel.clone().setY(0).normalize();
        g.damage(hitActor, ax.owner, ax.dmg, 'chest', 'claw', dir, false); // claw 标签走变异者击杀链
        g.fx.bloodSplat(hitActor.pos);
      } else if (hitWall || ax.life <= 0 || ax.pos.y < 0.05) {
        ax.live = false;
        if (hitWall) g.audio.playGrenadeBounce(ax.pos.clone());
      }
    }
    this.clearAxes(true);
  }

  clearAxes(keep = false) {
    for (const ax of this.axes) {
      if (!keep || !ax.live) {
        this.g.renderer.scene.remove(ax.mesh);
        ax.dead = true;
      }
    }
    this.axes = keep ? this.axes.filter((ax) => ax.live) : [];
  }

  // ---- 缠绕者缠绕（原作技能）：触须远程抓住人类并拖拽过来 ----
  fireEntangle(a) {
    const g = this.g, rules = this.rules;
    // 选目标：玩家按准星方向夹角选最近；BOT 取最近敌人
    let best = null, bestScore = 1e9;
    const camDir = new THREE.Vector3();
    if (a.isPlayer) g.renderer.camera.getWorldDirection(camDir);
    for (const v of g.actors) {
      if (!v.alive || v === a || v.team === a.team || v.wozOut || v.id >= rules.playerCount) continue;
      const d = a.pos.distanceTo(v.pos);
      if (d > WOZ.entangleRange) continue;
      let score = d;
      if (a.isPlayer) {
        const to = new THREE.Vector3(v.pos.x - a.pos.x, (v.pos.y + 1.2) - (a.pos.y + 1.5), v.pos.z - a.pos.z).normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(to.dot(camDir), -1, 1));
        if (ang > 0.25) continue; // 准星 14° 内才算瞄准
        score = ang;
      }
      if (score < bestScore) { bestScore = score; best = v; }
    }
    const st = rules.state(a.id);
    if (!best) { // 空放不消耗充能
      st.skillCharge = 1; st.skillActive = false; st.skillTimeLeft = 0;
      if (a.isPlayer) g.hud.toast('缠绕：准星内没有目标', 1);
      return;
    }
    best.protectT = 0;
    best.rootT = WOZ.entangleRootTime;
    g.damage(best, a, WOZ.entangleDamage * (a.id < rules.playerCount ? rules.damageMultiplier(st) : 1), 'chest', 'claw', new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), false);
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 1, 6), new THREE.MeshLambertMaterial({ color: 0x8a2f1d, emissive: 0x2a0a04 }));
    g.renderer.scene.add(tent);
    this.grabs.push({ live: true, v: best, owner: a, t: 0, tent });
    wozAudio.entangle(a.isPlayer ? null : a.pos.clone());
    if (a.isPlayer) g.hud.toast('缠绕！拖拽目标中', 1);
    if (best.isPlayer) { g.hud.toast('<b style="color:#ff5040">被触须缠住了！</b>', 1.5); g.fx.shake = 1.2; }
  }

  tickGrabs(dt) {
    const g = this.g;
    const UP = new THREE.Vector3(0, 1, 0);
    for (const gr of this.grabs) {
      if (!gr.live) continue;
      gr.t += dt;
      const { v, owner } = gr;
      if (!v.alive || !owner.alive || gr.t > WOZ.entangleRootTime || v.wozOut) { gr.live = false; continue; }
      v.rootT = Math.max(v.rootT || 0, 0.05);
      // 拖拽：向缠绕者位移，墙体拦截则原地绷紧
      const dx = owner.pos.x - v.pos.x, dz = owner.pos.z - v.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.5) {
        const step = Math.min(WOZ.entangleDragSpeed * dt, dist - 1.5);
        const nx = dx / dist, nz = dz / dist;
        if (!g.world.raycast(v.pos.x, v.pos.y + 0.9, v.pos.z, nx, 0, nz, step + 0.3, 'move')) {
          v.pos.x += nx * step; v.pos.z += nz * step;
          if (v.isPlayer) g.fx.shake = Math.max(g.fx.shake || 0, 0.35);
        }
      }
      // 触须视觉：缠绕者胸口 → 目标胸口
      const a1 = owner.pos.clone(); a1.y += 1.4;
      const a2 = v.pos.clone(); a2.y += 1.2;
      const mid = a1.clone().add(a2).multiplyScalar(0.5);
      const dir = a2.clone().sub(a1);
      const len = Math.max(0.1, dir.length());
      gr.tent.position.copy(mid);
      gr.tent.quaternion.setFromUnitVectors(UP, dir.normalize());
      gr.tent.scale.set(1, len, 1);
    }
    for (const gr of this.grabs) {
      if (!gr.live) g.renderer.scene.remove(gr.tent);
    }
    this.grabs = this.grabs.filter((gr) => gr.live);
  }

  clearGrabs() {
    for (const gr of this.grabs) this.g.renderer.scene.remove(gr.tent);
    this.grabs = [];
  }

  // ---- 爆破者自爆（原作技能）：1.2s 引信冲锋 → 感染爆炸 ----
  armSelfDestruct(a) {
    const g = this.g;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    g.renderer.scene.add(core);
    this.fuses.push({ live: true, a, t: WOZ.selfDestructFuse, core });
    wozAudio.fuse(a.isPlayer ? null : a.pos.clone());
    if (a.isPlayer) g.hud.toast('<b style="color:#ff5040">自爆引信已点燃！</b>冲进人堆！', 1.5);
    else g.hud.eventFeed(`${a.name} 点燃了自爆引信！`, 'avg');
  }

  tickFuses(dt) {
    const g = this.g;
    for (const f of this.fuses) {
      if (!f.live) continue;
      f.t -= dt;
      if (!f.a.alive) { f.live = false; continue; }
      // 冲锋加速 + 红色脉冲预警
      f.a.speedMul = (f.a.speedMul || 1) * WOZ.selfDestructSpeed;
      f.core.position.copy(f.a.pos); f.core.position.y += 1.2;
      const pulse = 0.35 + 0.45 * Math.abs(Math.sin(f.t * 18));
      f.core.material.opacity = pulse;
      f.core.scale.setScalar(1 + (WOZ.selfDestructFuse - f.t) * 0.8);
      if (f.t <= 0) {
        f.live = false;
        const c = f.a.pos.clone(); c.y += 1;
        g.fx.explosion(c);
        g.fx.shake = 2.2;
        const owner = f.a;
        for (const v of g.actors) {
          if (!v.alive || v === owner || v.team === owner.team || v.wozOut) continue;
          const d = owner.pos.distanceTo(v.pos);
          if (d > WOZ.selfDestructRadius) continue;
          const dmg = WOZ.selfDestructDamage * (1 - (d / WOZ.selfDestructRadius) * 0.6);
          const dir = new THREE.Vector3(v.pos.x - owner.pos.x, 0, v.pos.z - owner.pos.z).normalize();
          g.damage(v, owner, dmg, 'chest', 'claw', dir, false); // claw 标签 → 击杀感染链
        }
        g.damage(owner, null, 99999, 'chest', 'claw', new THREE.Vector3(0, 1, 0), false); // 自爆阵亡
      }
    }
    for (const f of this.fuses) if (!f.live) g.renderer.scene.remove(f.core);
    this.fuses = this.fuses.filter((f) => f.live);
  }

  clearFuses() {
    for (const f of this.fuses) this.g.renderer.scene.remove(f.core);
    this.fuses = [];
  }

  // ---- 场景道具（V39）：爆炸油桶 + 可破坏木箱（射击/近战/爆炸均可破坏，油桶殉爆） ----
  spawnProps() {
    const g = this.g;
    this.clearProps();
    let barrels = 0, crates = 0, frostBoxes = 0, ammoBoxes = 0;
    for (let i = 0; i < 60 && (barrels < 5 || crates < 4); i++) {
      const x = (Math.random() - 0.5) * 64, z = (Math.random() - 0.5) * 24;
      // 找地面：从高处向下射线，落不到地面（海面外）则跳过
      const h = g.world.raycast(x, 30, z, 0, -1, 0, 60, 'move');
      if (!h) continue;
      const y = 30 - h.t;
      if (y < 0.2 || y > 6) continue;
      // 与已有道具保持间距
      if (this.props.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      const roll = Math.random();
      if (barrels <= crates && barrels < 5) { this.spawnBarrel(x, y, z); barrels++; }
      else if (roll < 0.5 && crates < 4) { this.spawnCrate(x, y, z); crates++; }
      else if (roll < 0.75 && frostBoxes < 2) { this.spawnFrostBox(x, y, z); frostBoxes++; }
      else if (ammoBoxes < 2) { this.spawnAmmoBox(x, y, z); ammoBoxes++; }
      else if (crates < 4) { this.spawnCrate(x, y, z); crates++; }
    }
  }

  spawnBarrel(x, y, z) {
    const g = this.g;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), new THREE.MeshLambertMaterial({ color: 0xb03020 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.18, 12), new THREE.MeshLambertMaterial({ color: 0xe8c832 }));
    band.position.y = 0.12;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12), new THREE.MeshLambertMaterial({ color: 0x701e14 }));
    lid.position.y = 0.55;
    grp.add(body, band, lid);
    grp.position.set(x, y, z);
    g.renderer.scene.add(grp);
    this.props.push({ live: true, kind: 'barrel', grp, x, y, z, hp: 40, r: 0.55 });
  }

  spawnCrate(x, y, z) {
    const g = this.g;
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.16, 0.96), new THREE.MeshLambertMaterial({ color: 0x6a4e28 }));
    plank.position.y = 0.2;
    const plank2 = plank.clone(); plank2.position.y = -0.22;
    grp.add(box, plank, plank2);
    grp.position.set(x, y + 0.46, z);
    grp.rotation.y = Math.random() * 6;
    g.renderer.scene.add(grp);
    this.props.push({ live: true, kind: 'crate', grp, x, y, z, hp: 80, r: 0.6 });
  }

  // 射线找最近道具（from..maxT 区间内）
  propRay(o, dir, minT, maxT) {
    let best = null, bestT = maxT;
    for (const p of this.props) {
      if (!p.live) continue;
      // 视作竖直圆柱：先做 2D 圆相交，再卡高度
      const ox = o.x - p.x, oz = o.z - p.z;
      const b = ox * dir.x + oz * dir.z;
      const c = ox * ox + oz * oz - p.r * p.r;
      const disc = b * b - c * (dir.x * dir.x + dir.z * dir.z);
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / (dir.x * dir.x + dir.z * dir.z);
      if (t < minT) t = (-b + sq) / (dir.x * dir.x + dir.z * dir.z);
      if (t < minT || t >= bestT) continue;
      const hy = o.y + dir.y * t;
      if (hy < p.y - 0.15 || hy > p.y + (p.kind === 'barrel' ? 1.1 : 0.95)) continue;
      best = p; bestT = t;
    }
    return best ? { prop: best, t: bestT } : null;
  }

  // 冰冻箱（V62）：击碎释放寒霜区域，冻缓区域内角色
  spawnFrostBox(x, y, z) {
    const g = this.g;
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x9ad8e8, emissive: 0x1a4a5a }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.14, 0.84), new THREE.MeshLambertMaterial({ color: 0xd8f4fc, emissive: 0x2a6a7a }));
    band.position.y = 0.18;
    grp.add(box, band);
    grp.position.set(x, y + 0.4, z);
    g.renderer.scene.add(grp);
    this.props.push({ live: true, kind: 'frostbox', grp, x, y, z, hp: 60, r: 0.5 });
  }

  // 弹药箱（V62）：击碎爆出双份弹药补给
  spawnAmmoBox(x, y, z) {
    const g = this.g;
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.12, 0.64), new THREE.MeshLambertMaterial({ color: 0xc8b860 }));
    band.position.y = 0.1;
    grp.add(box, band);
    grp.position.set(x, y + 0.3, z);
    g.renderer.scene.add(grp);
    this.props.push({ live: true, kind: 'ammobox', grp, x, y, z, hp: 80, r: 0.55 });
  }

  damageProp(prop, dmg, shooter, silent) {
    if (!prop.live) return;
    prop.hp -= dmg;
    prop.grp.position.x = prop.x + (Math.random() - 0.5) * 0.06; // 受击晃动
    if (prop.hp > 0) return;
    prop.live = false;
    this.g.renderer.scene.remove(prop.grp);
    if (prop.kind === 'barrel') this.detonateBarrel(prop, shooter);
    else if (prop.kind === 'frostbox') this.breakFrostBox(prop, silent);
    else if (prop.kind === 'ammobox') this.breakAmmoBox(prop, silent);
    else this.breakCrate(prop, shooter, silent);
  }

  detonateBarrel(prop, shooter) {
    const g = this.g;
    const c = new THREE.Vector3(prop.x, prop.y + 0.6, prop.z);
    g.fx.explosion(c);
    g.fx.shake = Math.max(g.fx.shake || 0, 1.8);
    audio.playExplosion(c);
    // AoE：对 actors（he 结算：击杀走感染链，队友免伤由友伤抑制处理）
    const R = 5.5, DMG = 110;
    for (const v of g.actors) {
      if (!v.alive) continue;
      const d = Math.hypot(v.pos.x - prop.x, v.pos.z - prop.z);
      if (d > R || Math.abs(v.pos.y - prop.y) > 3.5) continue;
      const dir = new THREE.Vector3(v.pos.x - prop.x, 0, v.pos.z - prop.z).normalize();
      g.damage(v, shooter, DMG * (1 - d / R * 0.55), 'chest', 'he', dir, false);
    }
    // 殉爆：附近油桶延迟起爆
    for (const p2 of this.props) {
      if (!p2.live || p2 === prop || p2.kind !== 'barrel') continue;
      const d = Math.hypot(p2.x - prop.x, p2.z - prop.z);
      if (d < R) {
        const delay = 0.12 + d * 0.04;
        const pp = p2;
        g.timers.push({ t: g.time + delay, fn: () => this.damageProp(pp, 999, shooter, true) });
      }
    }
  }

  breakCrate(prop, shooter, silent) {
    const g = this.g;
    // 木片飞溅
    for (let i = 0; i < 3; i++) {
      g.fx.impact(new THREE.Vector3(prop.x + (Math.random() - 0.5) * 0.6, prop.y + 0.3 + Math.random() * 0.5, prop.z + (Math.random() - 0.5) * 0.6),
        new THREE.Vector3(0, 1, 0), 'wood', new THREE.Vector3(0, 1, 0));
    }
    if (!silent) audio.playImpact(new THREE.Vector3(prop.x, prop.y + 0.5, prop.z), 'wood');
    // 必掉一份补给
    this.pickups.randomDrop({ x: prop.x, y: 0, z: prop.z });
  }

  breakFrostBox(prop, silent) {
    const g = this.g;
    if (!silent) audio.playImpact(new THREE.Vector3(prop.x, prop.y + 0.5, prop.z), 'wood');
    this.g.zones.spawn('frost', new THREE.Vector3(prop.x, 0.1, prop.z)); // 寒霜区域（V56 复用）
    g.hud.eventFeed('❄ 冰冻箱击碎，寒霜弥漫', 'evt');
  }

  breakAmmoBox(prop, silent) {
    const g = this.g;
    if (!silent) audio.playImpact(new THREE.Vector3(prop.x, prop.y + 0.5, prop.z), 'wood');
    this.pickups.spawnDrop({ x: prop.x, y: 0, z: prop.z }, 'ammo');
    this.pickups.spawnDrop({ x: prop.x + 0.7, y: 0, z: prop.z + 0.4 }, 'ammo');
  }

  clearProps() {
    for (const p of this.props) if (p.live) this.g.renderer.scene.remove(p.grp);
    this.props = [];
  }

  propAlive() { return this.props.some((p) => p.live); }

  // ---- 人类急救包（V36 交互）：按住 X 2s 自疗 +60，移动/受击打断 ----
  tickMedkit(dt) {
    const g = this.g, p = g.player;
    if (!p.alive || p.team !== 'GR' || !(p.medkits > 0) || p.hp >= 100) { this._medT = 0; return; }
    const holding = p.keys.has('KeyX') && (p.speed || 0) < 2;
    if (!holding) { this._medT = 0; return; }
    this._medT += dt;
    if (this._medT >= 2) {
      this._medT = 0;
      p.medkits--;
      p.hp = Math.min(100, p.hp + 60);
      g.hud.toast('<b style="color:#4aff8a">急救包使用成功！</b>+60 HP', 2);
      g.hud.eventFeed(`${p.name} 使用了急救包`, 'evt');
    }
  }

  // ---- 补给空投（V24）：战斗期周期空投全补给箱，雷达金菱形标记 ----
  // V61 金色武器空投：每第 3 个空投为金色，附带随机稀有枪械
  static GOLD_GUNS = ['awm', 'm60', 'minigun', 'ppsh', 'winchester', 'dragonsbreath', 'm79'];
  spawnAirdrop() {
    const g = this.g;
    this.dropN = (this.dropN || 0) + 1;
    const golden = this.dropN % 3 === 0;
    const sp = this.pickSpawn(Math.random() < 0.5 ? 'GR' : 'BL');
    const grp = new THREE.Group();
    const boxMat = golden ? new THREE.MeshLambertMaterial({ color: 0xffd24a, emissive: 0x8a6a00 }) : new THREE.MeshLambertMaterial({ color: 0xb08828, emissive: 0x382200 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), boxMat);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.14, 0.94), new THREE.MeshLambertMaterial({ color: 0xd8d2c0, emissive: 0x333020 }));
    const chuteMat = golden ? new THREE.MeshLambertMaterial({ color: 0xffe080, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }) : new THREE.MeshLambertMaterial({ color: 0xd85840, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const chute = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 8, 1, true), chuteMat);
    chute.position.y = 1.4;
    grp.add(box, stripe, chute);
    grp.position.set(sp.x, 26, sp.z);
    g.renderer.scene.add(grp);
    const gun = golden ? WozManager.GOLD_GUNS[(Math.random() * WozManager.GOLD_GUNS.length) | 0] : null;
    this.airdrops.push({ live: true, grp, chute, x: sp.x, z: sp.z, y: 26, state: 'fall', t: 0, golden, gun });
    if (golden) {
      g.hud.toast('<b style="color:#ffd24a">★ 金色武器空投！</b>内含稀有枪械', 3);
      g.hud.eventFeed('★ 金色武器空投正在降落', 'evt');
    } else {
      g.hud.toast('<b style="color:#ffd24a">补给空投已投放！</b>注意雷达标记', 2.5);
      g.hud.eventFeed('📦 补给空投正在降落', 'evt');
    }
  }

  tickAirdrops(dt) {
    const g = this.g, rules = this.rules;
    // 只在感染族战斗期投放
    if (rules && rules.phase === 'battle' && this.cat() === 'infection') {
      this.dropT -= dt;
      if (this.dropT <= 0) {
        this.dropT = AIRDROP.interval;
        this.spawnAirdrop();
      }
    }
    for (const d of this.airdrops) {
      if (!d.live) continue;
      d.t += dt;
      if (d.state === 'fall') {
        d.y -= AIRDROP.fallSpeed * dt;
        if (d.y <= 0.3) {
          d.y = 0.3;
          d.state = 'landed';
          d.grp.remove(d.chute);
          d.life = AIRDROP.life;
          g.audio.playGrenadeBounce(new THREE.Vector3(d.x, 1, d.z));
        }
        d.grp.position.y = d.y;
      } else {
        d.life -= dt;
        d.grp.position.y = 0.3 + Math.sin(d.t * 3) * 0.06;
        // 人类拾取：走近即得（全弹药 + 医疗 + 手雷）
        const p = g.player;
        const taker = p.alive && p.team === 'GR' && Math.hypot(p.pos.x - d.x, p.pos.z - d.z) < 1.4 ? p
          : g.actors.find((a) => a.alive && a.team === 'GR' && !a.isPlayer && Math.hypot(a.pos.x - d.x, a.pos.z - d.z) < 1.2);
        if (taker) {
          for (const w of taker.inv) {
            if (w && w.def.type !== 'melee') { w.reserve = w.def.reserve; if (w.def.type !== 'grenade') w.mag = w.def.mag; else w.mag = Math.min(1, w.mag + 1); }
          }
          if (taker.hp > 0) taker.hp = Math.min(taker.wozMaxHp || 100, taker.hp + 60);
          if (taker.team === 'GR') taker.medkits = Math.min(1, (taker.medkits || 0) + 1); // 空投附带急救包
          if (d.golden && d.gun) {
            // V61 金色武器：替换主武器为随机稀有枪（满弹药）
            const WS = taker.inv[0]?.constructor;
            if (WS) {
              const gw = new WS(d.gun);
              taker.inv[0] = gw;
              if (taker.slot === 0) { taker.soldier.setWeapon(d.gun); if (taker.isPlayer) g.vm.equip(d.gun, 0.4); }
              taker.readyAt = Math.min(taker.readyAt, g.time + 0.3);
              g.hud.toast(`<b style="color:#ffd24a">★ 获得金色武器！</b>${gw.def.name} · 弹药补满 · 医疗 · 手雷`, 3);
              g.hud.eventFeed(`${taker.name} 获取了金色武器空投（${gw.def.name}）`, 'evt');
              if (taker.isPlayer) g.hud.slots(taker.inv, taker.slot);
            }
          } else {
            g.hud.toast(`<b style="color:#ffd24a">获得空投补给！</b>弹药补满 · 医疗 · 手雷`, 2.5);
            g.hud.eventFeed(`${taker.name} 获取了补给空投`, 'evt');
          }
          audio.playUI('buy');
          d.live = false;
        } else if (d.life <= 0) d.live = false; // 无人认领超时消散
      }
    }
    for (const d of this.airdrops) if (!d.live) g.renderer.scene.remove(d.grp);
    this.airdrops = this.airdrops.filter((d) => d.live);
  }

  clearAirdrops() {
    for (const d of this.airdrops) this.g.renderer.scene.remove(d.grp);
    this.airdrops = [];
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
    }
    this.devourAndSkills(dt);
    this.ambientGrowl(dt);
    this.tickMedkit(dt);
    // 分裂体到期消散（V48）
    for (const z of this.tide) {
      if (z.alive && z.cloneExpire && g.time >= z.cloneExpire) {
        z.cloneExpire = 0;
        g.damage(z, null, 99999, 'chest', 'claw', { x: 0, z: 1 }, false);
        z.respawnT = 1e9; z.wozOut = true;
      }
    }
    // 补给变异体（V35）：感染族战斗期周期出现，场上最多 1 只
    if (rules.phase === 'battle' && this.cat() === 'infection') {
      this.supplyT -= dt;
      const supplyAlive = this.tide.some((z) => z.alive && z.isSupplyCrate);
      if (this.supplyT <= 0 && !supplyAlive) {
        this.supplyT = 45;
        this.spawnSupplyZombie();
      }
    }
    // 生化模式：AI 怪物波次刷新（原作尸潮感）+ 掉落拾取
    if (this.mode === 'bio') {
      this.waveT = (this.waveT ?? BIO.waveFirst) - dt;
      const alive = this.tide.filter((z) => z.alive).length;
      if (this.waveT <= 0 && alive < BIO.aiMax && rules.phase === 'battle') {
        this.waveT = BIO.waveInterval;
        this.waveN = (this.waveN || 0) + 1;
        const n = Math.min(BIO.aiMax - alive, 1 + this.waveN);
        for (let i = 0; i < n; i++) this.spawnAiZombie();
        let frost = '';
        if (this.waveN % 3 === 0 && alive + n < BIO.aiMax + 2) { this.spawnFrostWalker(); frost = ' <b style="color:#86c8e0">含寒霜行者！</b>'; }
        g.hud.toast(`<b style="color:#ff7040">第 ${this.waveN} 波</b> 变异爬行者来袭 ×${n}！${frost}`, 2.5);
        wozAudio.tide();
      }
      // 末分钟狂潮（V53 调研：最后 1 分钟大批 AI 变异者，HP 低每击 20HP）
      if (!this._bioFrenzy && rules.phase === 'battle' && rules.phaseTimeLeft <= 60) {
        this._bioFrenzy = true;
        const n = Math.min(WOZ.sorrowFrenzyCount, Math.max(0, BIO.aiMax + 2 - alive));
        for (let i = 0; i < n; i++) this.spawnSorrowWalker(WOZ.sorrowFrenzyHp, '狂潮行者');
        g.slowMoT = Math.max(g.slowMoT || 0, 0.5); g.slowMoScale = 0.4;
        g.hud.toast('<b style="color:#ff5040">末日狂潮！</b>大批悲惨行者涌入战场', 3);
        g.hud.eventFeed(`☠ 末分钟狂潮：${n} 只悲惨行者高速突进`, 'tide', 10);
        wozAudio.tide();
      }
    }
    // 掉落拾取：全感染族可用（V35 补给变异体/急救包落地在感染/复仇也生效）
    for (const ev of this.pickups.update(dt)) {
      if (ev.actor.isPlayer) wozAudio.devour(null);
    }
    this.hud.update(rules, g.player, this);
    // 回合推进
    if (rules.phase === 'idle' && rules.result && !g.ended) {
      if (this.score.GR >= ROUND_WINS || this.score.BL >= ROUND_WINS) this.endMatch();
      else this.beginRound();
    }
  }

  // ---- 生化模式 AI 怪物 ----
  // 噬魂者分裂体（V48）：短命 AI 复制体，随主人阵营攻击人类
  spawnCloneZombie(owner, i) {
    const g = this.g;
    const z = new Zombie(g, { id: 60 + i * 3 + ((Math.random() * 50) | 0), name: '分裂体', team: 'BL' });
    g.actors.push(z);
    this.tide.push(z);
    const ang = Math.random() * Math.PI * 2;
    z.spawn({ x: owner.pos.x + Math.cos(ang) * 1.6, z: owner.pos.z + Math.sin(ang) * 1.6, yaw: owner.yaw });
    this.formZombie(z, 400);
    z.protectT = 0.4;
    z.soldier.root.scale.setScalar(0.85);
    z.soldier.material.color.setHex(0x7a4a8a); // 紫灰分裂体
    z.cloneExpire = g.time + 20; // 20s 后消散
    z.cloneOwner = owner; // V58：协同索敌 + 被毁回主人充能
    return z;
  }

  // 补给变异体（V35）：驮补给的特感，击杀必掉双份补给
  spawnSupplyZombie() {
    const g = this.g;
    const z = new Zombie(g, { id: 70 + this.tide.length + ((Math.random() * 90) | 0), name: '补给变异体', team: 'BL' });
    g.actors.push(z);
    this.tide.push(z);
    z.spawn(this.pickSpawn('BL'));
    this.formZombie(z, 600);
    z.protectT = 0.5;
    z.supplySlow = true;
    z.isSupplyCrate = true;
    z.soldier.root.scale.setScalar(1.15);
    z.soldier.material.color.setHex(0x9a7440); // 土黄补给驮色
    g.hud.toast('<b style="color:#ffd24a">补给变异体出现了！</b>击杀掉落双份补给', 2.5);
    g.hud.eventFeed('📦 补给变异体混入了尸群', 'evt');
    return z;
  }

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

  // 寒霜行者（V56 末日求生）：冰霜系 AI 特感，爪击命中最速减速 3s
  spawnFrostWalker() {
    const g = this.g;
    const z = new Zombie(g, { id: 95 + this.tide.length + ((Math.random() * 90) | 0), name: '寒霜行者', team: 'BL', wozExtra: true });
    g.actors.push(z);
    this.tide.push(z);
    z.spawn(this.pickSpawn('BL'));
    this.formZombie(z, WOZ.frostHp);
    z.protectT = 0.5;
    z.chillOnHit = true;
    z.soldier.root.scale.setScalar(0.95);
    z.soldier.material.color.setHex(0x86c8e0); // 寒霜冰蓝
    return z;
  }

  // 冰缓命中（V56）：目标规则层人类减速，玩家出提示
  applyChill(v) {
    const rules = this.rules;
    if (!rules || !v?.alive || v.id >= rules.playerCount) return;
    const st = rules.state(v.id);
    if (st.side !== 'human' || !st.alive) return;
    st.chillT = WOZ.frostChillTime;
    if (v.isPlayer) this.g.hud.toast('<b style="color:#86c8e0">寒霜减速！</b>移速降低 3 秒', 1.5);
  }

  // 悲惨行者（V53）：AI 杂兵特感——低血高速固定爪伤 20（调研：对抗/爆破/复仇出没，末分钟狂潮主力）
  spawnSorrowWalker(hp = WOZ.sorrowHp, name = '悲惨行者') {
    const g = this.g;
    const z = new Zombie(g, { id: 90 + this.tide.length + ((Math.random() * 90) | 0), name, team: 'BL', wozExtra: true });
    g.actors.push(z);
    this.tide.push(z);
    z.spawn(this.pickSpawn('BL'));
    this.formZombie(z, hp);
    z.protectT = 0.4;
    z.sorrowFast = true;
    z.clawDmg = WOZ.sorrowDmg;
    z.soldier.root.scale.setScalar(0.95);
    z.soldier.material.color.setHex(0x6e7a78); // 悲怆灰绿
    return z;
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
    // 浓雾增援（原作死亡城市机制）：占领进度越深，变异者增援越频繁越凶
    const captured = this.points.filter((p) => p.owner === 'GR').length;
    this.reinforceT = (this.reinforceT ?? CONFRONT.reinforceFirst) - dt;
    if (this.reinforceT <= 0) {
      this.reinforceT = Math.max(CONFRONT.reinforceMin, CONFRONT.reinforceFirst - captured * 6);
      const n = 1 + (captured >= 2 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        // V53：增援混编悲惨行者（调研：对抗模式中出现且速度较快）
        if (captured >= 1 && i === 0) this.spawnSorrowWalker();
        else {
          const z = new Zombie(g, { id: 80 + this.tide.length + ((Math.random() * 90) | 0), name: '浓雾增援', team: 'BL' });
          g.actors.push(z);
          this.tide.push(z);
          z.spawn(this.pickSpawn('BL'));
          this.formZombie(z, 1000);
          z.protectT = 0.5;
        }
      }
      g.hud.toast('<b style="color:#ff5040">变异者突破浓雾增援！</b>', 2);
      wozAudio.tide();
    }
    // 雾密度随占领进度加浓
    const fog = g.renderer.scene.fog;
    if (fog) {
      if (this._baseFog === undefined) this._baseFog = fog.density;
      if (this._baseFog > 0) fog.density = this._baseFog * (1 + captured * 0.25);
    }
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
    this.g.slowMoT = 0.8; this.g.slowMoScale = 0.35; // 决胜慢动作（V32）
    const g = this.g;
    this.score[winner]++;
    this.hud.showBanner(
      winner === 'GR' ? '🛡 人类胜利！' : '☣ 变异者胜利！',
      winner === 'GR' ? '#8cc8ff' : '#ff7040',
      `${msg} · 比分 人类 ${this.score.GR} : ${this.score.BL} 变异者`, 3.5);
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
    for (const d of this.airdrops) ms.push({ kind: 'drop', x: d.x, z: d.z, gold: d.golden });
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
    // 处决提示（V37）：变异者对残血人类近身
    if (this.rules && this.rules.phase === 'battle' && this.rules.isMutantSide(p.id) && p.alive && this.findExecuteTarget(p)) {
      return { kind: 'red', title: '[E] 处决', sub: '残血人类 · 必定感染 +200 血' };
    }
    // 急救包引导（V36）：按住 X 自疗
    if (this._medT > 0 && p.alive && p.team === 'GR' && p.medkits > 0) {
      return { kind: 'gold', title: '包扎中…', sub: '松开或移动会打断', prog: Math.min(1, this._medT / 2) };
    }

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
      if (!st.skillActive && st.skillCharge >= 1 && Math.random() < 0.06) {
        // 职业化用技（V25）：各变异者按语境释放，不再无脑空放
        const enemy = this.nearestEnemy(a);
        const dist = enemy ? a.pos.distanceTo(enemy.pos) : 1e9;
        let los = false;
        if (enemy) {
          const eye = enemy.soldier.chestWorld(new THREE.Vector3());
          const from = a.pos.clone(); from.y += 1.5;
          const dir = eye.clone().sub(from);
          const L = dir.length(); dir.divideScalar(L || 1);
          los = L > 0.5 && !g.world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, L, 'sight');
        }
        if (this.botSkillWant(st, dist, los)) rules.tryUseSkill(a.id);
      }
    }
  }

  effMaxHp(st) {
    return st.maxHp + st.evoPoints * WOZ.evoHpPerPoint;
  }

  // BOT 用技决策表（V25）：按职业语境判定（纯逻辑，可单测）
  botSkillWant(st, dist, hasLos) {
    if (st.cls === MutantClass.Crawler) return false; // 纯属性型无技能
    if (st.cls === MutantClass.Bomber) return st.hp < this.effMaxHp(st) * 0.45 && dist < 9; // 残血冲人堆自爆
    if (st.cls === MutantClass.Souleater) return dist < WOZ.blindWailRange * 0.9;           // 尖啸开团致盲
    if (st.cls === MutantClass.Nightrunner) return dist > 5 && dist < 16;                    // 疾冲拉近
    if (st.cls === MutantClass.Devourer || st.cls === MutantClass.Tangler) return dist > 4 && dist < 20 && hasLos; // 投掷/缠绕需视线
    return dist < 25 || st.hp < this.effMaxHp(st) * 0.4; // 母体咆哮
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
    // 人类能量三级技能（V46）：[T] 战术装填 / [V] 必杀技·狂暴（[F] 在 player.js 路由）
    if (!rules.isMutantSide(p.id)) {
      if (p.consumePressed('KeyT')) this.tryHumanEnergyKey(p, 'T');
      if (p.consumePressed('KeyV')) this.tryHumanEnergyKey(p, 'V');
    }
    if (!rules.isMutantSide(p.id)) return;
    const st = rules.state(p.id);
    if (!st.alive) return;
    // E 处决 / 吞噬（残血人类近身时处决优先）
    if (p.consumePressed('KeyE')) {
      if (this.tryExecute(p)) {
        // 处决成功（击杀链已走感染+回血）
      } else {
        const corpse = this.findCorpse(p);
        if (rules.tryDevour(p.id, corpse)) {
          p.hp = st.hp;
          g.hud.toast('吞噬！恢复血量并获得进化点', 1.5);
        } else if (corpse >= 0) g.hud.toast('吞噬冷却中…', 1);
        else g.hud.toast('附近没有可吞噬的变异者尸体', 1);
      }
    }
    // G 技能（F 亦可，见 player.js 的变异者 F 路由）
    if (p.consumePressed('KeyG') || p.consumePressed('KeyF')) {
      if (!rules.tryUseSkill(p.id)) g.hud.toast(`技能冷却中 ${(st.skillCharge * 100) | 0}%`, 1);
    }
    // 5/6/7/8/9/0/- 子体变身（V51 增爬行者，V52 增断头者）
    for (const [code, cls] of [['Digit5', MutantClass.Nightrunner], ['Digit6', MutantClass.Souleater], ['Digit7', MutantClass.Devourer], ['Digit8', MutantClass.Tangler], ['Digit9', MutantClass.Bomber], ['Digit0', MutantClass.Crawler], ['Minus', MutantClass.Headhunter]]) {
      if (p.consumePressed(code) && rules.setMutantClass(p.id, cls)) this.playerClassChosen = true;
    }
  }

  // 处决终结技（V37 交互）：变异者对残血（≤40）近身人类 E 键必杀——必定感染 + 回血 200
  findExecuteTarget(mutant) {
    const g = this.g, rules = this.rules;
    if (!rules || !rules.isMutantSide(mutant.id)) return null;
    for (const v of g.actors) {
      if (!v.alive || v === mutant || v.id >= rules.playerCount) continue;
      if (rules.isMutantSide(v.id)) continue;
      if (v.hp > 40) continue;
      const d = mutant.pos.distanceTo(v.pos);
      if (d > 2.2) continue;
      const eye = mutant.soldier.chestWorld(new THREE.Vector3());
      const c = v.soldier.chestWorld(new THREE.Vector3());
      const dir = c.clone().sub(eye); const L = dir.length(); dir.divideScalar(L || 1);
      if (g.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, L, 'sight')) continue;
      return { v, dir };
    }
    return null;
  }

  tryExecute(mutant) {
    const g = this.g, rules = this.rules;
    const t = this.findExecuteTarget(mutant);
    if (!t) return false;
    const { v, dir } = t;
    v.protectT = 0; v.armor = 0;
    const st = rules.state(mutant.id);
    g.damage(v, mutant, 99999, 'chest', 'claw', dir, false); // claw 标签 → 必定感染
    if (mutant.alive) {
      st.hp = Math.min(rules.effectiveMaxHp(st), st.hp + 200);
      mutant.hp = Math.max(1, Math.round(st.hp));
    }
    g.fx.shake = Math.max(g.fx.shake || 0, 1.4);
    g.hitStopT = Math.max(g.hitStopT, 0.1);
    if (mutant.isPlayer) g.hud.toast(`<b style="color:#ff5040">处决！</b>感染 +200 血`, 2);
    g.hud.eventFeed(`${mutant.name} <b>处决</b>了 ${v.name}！`, 'inf');
    wozAudio.devour(mutant.isPlayer ? null : mutant.pos.clone());
    return true;
  }

  // 人类能量三级技能（V46）：[T] 战术装填(25) / [F] 战地狂热(50) / [V] 必杀技·狂暴(100)
  tryHumanEnergyKey(p, level) {
    const g = this.g, rules = this.rules;
    const costs = { T: WOZ.energyCostT, F: WOZ.energyCostF, V: WOZ.energyCostV };
    if (!rules.tryEnergySkill(p.id, level)) {
      g.hud.toast(`能量不足：需要 ${costs[level]}（当前 ${rules.humanEnergy(p.id) | 0}）`, 1.2);
      return false;
    }
    const st = rules.state(p.id);
    if (level === 'T') {
      for (const w of p.inv) if (w && w.def.type !== 'melee' && w.def.type !== 'grenade') { w.mag = w.def.mag; w.reserve = w.def.reserve; }
      g.hud.slots(p.inv, p.slot);
      g.hud.toast('<b style="color:#8cc8ff">战术装填！</b>弹药全满', 1.5);
    } else if (level === 'F') {
      g.hud.toast('<b style="color:#8cc8ff">战地狂热！</b>8 秒移速 +10%', 1.5);
    } else {
      for (const w of p.inv) if (w && w.def.type !== 'melee' && w.def.type !== 'grenade') w.mag = w.def.mag; // 狂暴：瞬间满弹
      g.hud.toast('<b style="color:#ffd24a">必杀技：狂暴！</b>5 秒伤害 ×1.5', 2);
      wozAudio.ult();
    }
    g.hud.eventFeed(`${p.name} 释放了<b>能量技能 ${level}</b>`, 'avg');
    return true;
  }

  onHumanUltimate(id) {
    void id; // 表现已在能量技能路径处理；规则层回调占位
  }

  // 引擎伤害上报 → 规则层（变异者技能充能 / 人类能量充能，V46）
  reportDamage(att, v, amount) {
    const rules = this.rules;
    if (!rules || !att || att === v || !v.alive || amount <= 0) return;
    if (att.id < 0 || att.id >= rules.playerCount) return;
    rules.reportDamage(att.id, v.id, amount);
  }

  // 复仇者旋转清场（原作：被包围时原地旋转一周清除所有近身敌人）——重击的 360° 版本
  spinAttack(a) {
    const g = this.g;
    const eye = a.eye(new THREE.Vector3());
    let hits = 0;
    for (const b of g.actors) {
      if (!b.alive || b === a || b.team === a.team || b.wozOut) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > WOZ.avengerSpinRadius) continue;
      const dir = new THREE.Vector3(dx, (b.pos.y + 1.2) - eye.y, dz).normalize();
      if (g.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, Math.min(dist + 0.4, WOZ.avengerSpinRadius), 'sight')) continue;
      g.damage(b, a, 9999, 'chest', 'chainsaw', dir, false, true);
      g.fx.bloodSplat(b.pos);
      hits++;
    }
    g.fx.shake = Math.max(g.fx.shake || 0, 1.2);
    if (hits) {
      audio.playKnife('heavy', 'flesh', a.isPlayer ? null : eye);
      if (a.isPlayer) g.hud.toast(`<b style="color:#60e0ff">旋转清场！</b>绞碎 ${hits} 名近身敌人`, 1.5);
      g.hud.eventFeed(`${a.name} 旋转清场绞碎了 ${hits} 名敌人！`, 'avg');
    } else {
      audio.playKnife('heavy', 'wall', a.isPlayer ? null : eye);
    }
  }

  // 变异者 F 键技能（原作技能键）：由 player.js 直接路由
  onPlayerSkillKey(p) {
    const rules = this.rules;
    if (!rules || rules.phase !== 'battle' || !p.alive) return;
    if (!rules.tryUseSkill(p.id)) this.g.hud.toast(`技能冷却中 ${(rules.state(p.id).skillCharge * 100) | 0}%`, 1);
  }

  // 感染变身选择面板：玩家已转化但尚未主动选职业（WOZ 特色交互）
  pickNeeded() {
    const rules = this.rules, p = this.g.player;
    if (!rules || rules.phase !== 'battle' || this.playerClassChosen) return false;
    const st = rules.state(p.id);
    return st.side === 'mutant' && !st.isMother;
  }

  // 模式中文名（计分板标题等）
  modeCN() {
    return { infection: '生化感染', revenge: '生化复仇', bio: '生化模式', confront: '生化对抗', demol: '生化爆破' }[this.mode] || this.mode;
  }

  // 计分板角色列
  roleLabel(a) {
    const rules = this.rules;
    if (!rules) return a.team === 'BL' ? '变异者' : '人类佣兵';
    if (a.id >= rules.playerCount) return 'AI 尸潮';
    const st = rules.state(a.id);
    if (!st || st.side === 'human') return '人类';
    if (st.isAvenger) return '复仇者';
    if (st.isMother) return '母体';
    return CLASS_LABEL[st.cls] || '变异者';
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
      // 尸潮 AI：生化模式掉落；补给变异体必掉双份（V35）
      if (victim.isSupplyCrate) {
        this.pickups.randomDrop(victim.pos);
        this.pickups.spawnDrop({ x: victim.pos.x + 0.8, y: 0, z: victim.pos.z + 0.5 }, 'medkit');
        g.hud.toast('<b style="color:#ffd24a">补给变异体被击杀！</b>快去拾取', 2);
      } else if (this.mode === 'bio') this.pickups.randomDrop(victim.pos);
      // V58 分身反馈：分裂体被击杀 → 主人回充能 25%（原作"复制繁殖"能量联动）
      if (victim.cloneOwner && victim.cloneOwner.alive) {
        const oid = victim.cloneOwner.id;
        if (oid < rules.playerCount && rules.isMutantSide(oid)) {
          const st = rules.state(oid);
          st.skillCharge = Math.min(1, st.skillCharge + 0.25);
          if (victim.cloneOwner.isPlayer) g.hud.toast('分裂体被击毁 · 充能 +25%', 1);
        }
      }
      return;
    } // 尸潮 AI 不进规则层
    const attId = attacker && attacker !== victim && attacker.id < rules.playerCount ? attacker.id : -1;
    const wasHuman = rules.state(vid).side === 'human';
    rules.reportDeath(vid, attId);
    if (attId >= 0 && !wasHuman) rules.addEnergy(attId, WOZ.energyPerKill); // 击杀充能（V46）
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
    this.applyClassVisual(a);
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
      else mul *= rules.humanDamageBoost(att.id); // 三档威力 / 必杀技狂暴
    }
    if (v.id < rules.playerCount) {
      const vs = rules.state(v.id);
      if (vs.side === 'mutant') {
        mul *= 1 - rules.evoDamageReduction(vs); // 二阶防御进化
      } else {
        mul *= 1 - rules.humanDamageReduction(v.id);
        if (vs.isAvenger) mul *= 1 - WOZ.avengerDef; // 复仇者防御被动
      }
    }
    return mul;
  }

  // ================= 规则层回调 =================
  // 部位伤害：V51 爬行者（躯体 0.6 / 爆头 1.5 定身 0.9s）；V57 通用化——全变异者爆头硬直 0.35s（母体免疫）
  classPartDamage(v, part) {
    const rules = this.rules;
    if (!rules || !v || v.id >= rules.playerCount) return 1;
    const st = rules.state(v.id);
    if (st.side !== 'mutant') return 1;
    if (part === 'head') {
      if (st.cls === MutantClass.Crawler) {
        if (v.alive) v.rootT = Math.max(v.rootT || 0, WOZ.crawlerHeadStop);
        return WOZ.crawlerHeadMul;
      }
      if (v.alive && !st.isMother) v.rootT = Math.max(v.rootT || 0, WOZ.headStopAll);
      return 1;
    }
    return st.cls === MutantClass.Crawler ? WOZ.crawlerBodyArmor : 1;
  }

  isClass(v, key) {
    const rules = this.rules;
    if (!rules || !v || v.id >= rules.playerCount) return false;
    return rules.state(v.id).cls === key;
  }

  // V55 混入伪装：附身爬行者的玩家混入 AI 变异者群（调研：伺机对人类发动闪电突袭）
  isDisguised(a) {
    const rules = this.rules;
    if (!rules || !a?.isPlayer || !a.alive) return false;
    if (this.g.time < (a._disguiseBreakT || 0)) return false; // 出爪暴露中
    const st = rules.state(a.id);
    return st.side === 'mutant' && st.cls === MutantClass.Crawler;
  }

  breakDisguise(a) {
    if (this.isDisguised(a)) {
      a._disguiseBreakT = this.g.time + WOZ.disguiseBreak;
      if (a.isPlayer) this.g.hud.toast('<b style="color:#ff5040">伪装暴露！</b>', 1.5);
    }
  }

  // V52 断头者双大刀近战倍率
  classMeleeMul(a, heavy) {
    const rules = this.rules;
    if (!rules || !a || a.id >= rules.playerCount) return 1;
    const st = rules.state(a.id);
    if (st.side !== 'mutant') return 1;
    if (st.cls === MutantClass.Headhunter) return heavy ? WOZ.headhunterHeavyMul : WOZ.headhunterLightMul;
    return 1;
  }

  // 职业外观：体型 + 皮肤乘法染色（新 Soldier 材质为白，restoreHuman 重建时自动复位）
  applyClassVisual(a) {
    const st = this.rules?.state(a.id);
    if (!st || st.side !== 'mutant') return;
    const cls = st.cls;
    const scale = st.isMother ? 1.28 : cls === MutantClass.Crawler ? 1.24 : cls === MutantClass.Devourer ? 1.18 : cls === MutantClass.Headhunter ? 1.15 : 1.08;
    a.soldier.root.scale.setScalar(scale);
    if (cls === MutantClass.Crawler) a.soldier.material.color.setHex(0x9cc08a); // 蜥蜴沼泽绿
    else if (cls === MutantClass.Headhunter) a.soldier.material.color.setHex(0xaab2c0); // 断头者：冷钢灰蓝
    else a.soldier.material.color.setHex(0xffffff);
    this.applyClassAttachments(a);
  }

  // V54 职业外观附件（调研外形全程序化）：噬魂者后背肉刺 / 猎食者背负巨斧 / 爆破者矿工帽+炸药包 /
  // 夜行者瘦骨嶙峋 / 爬行者蜥蜴背鳍 / 断头者双肩大刀 / 母体王冠肩甲。挂在骨骼上随动画联动。
  applyClassAttachments(a) {
    const S = a.soldier;
    if (S._deco) {
      for (const { anchor, grp } of S._deco) {
        anchor.remove(grp);
        grp.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
      }
      S._deco = null;
    }
    if (S.mesh) S.mesh.scale.set(1, 1, 1);
    const st = this.rules?.state(a.id);
    if (!st || st.side !== 'mutant') return;
    const cls = st.cls;
    const deco = [];
    const mk = (anchor) => { const grp = new THREE.Group(); anchor.add(grp); deco.push({ anchor, grp }); return grp; };
    const mat = (c, e = 0x000000, ei = 1) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.08, emissive: e, emissiveIntensity: ei });
    const add = (grp, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); grp.add(mesh); return mesh; };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cone = (r, h) => new THREE.ConeGeometry(r, h, 6);
    const spine = () => mk(S.B.spine), head = () => mk(S.B.head);

    if (cls === MutantClass.Souleater) {
      // 后背肉刺：缺氧培养皿试验致畸（调研：双手和后背异形般的肉刺）
      const g = spine(), m = mat(0x8a2a1a, 0x551108, 0.5);
      for (let i = 0; i < 5; i++) add(g, cone(0.045, 0.28 + (i % 3) * 0.1), m, (i - 2) * 0.075, 0.16 - Math.abs(i - 2) * 0.04, -0.14 - (i % 2) * 0.05, -2.2 + (i - 2) * 0.14);
    } else if (cls === MutantClass.Devourer) {
      // 背负巨斧：投掷用战斧（调研：掷巨斧/体形厚实）
      const g = spine(), wood = mat(0x4a3420), steel = mat(0x828a92, 0x14181d, 0.7);
      add(g, box(0.05, 0.92, 0.05), wood, 0.02, 0.1, -0.18, 0.25, 0, 0.18);
      add(g, box(0.3, 0.17, 0.04), steel, 0.12, 0.5, -0.25, 0.25, 0, 0.18);
    } else if (cls === MutantClass.Bomber) {
      // 矿工帽 + 背后炸药包（调研：原为矿工，手握炸药包）
      const cap = head(), lampM = mat(0xfff2c0, 0xffe080, 1.6), capM = mat(0xc8a020), tnt = mat(0x8a2018), rope = mat(0xd8c8a0);
      add(cap, box(0.26, 0.1, 0.27), capM, 0, 0.09, 0);
      add(cap, box(0.07, 0.05, 0.07), lampM, 0, 0.15, 0.08);
      const g = spine();
      for (let i = 0; i < 3; i++) add(g, box(0.06, 0.26, 0.06), tnt, 0.05 - i * 0.05, 0.05, -0.17, 0, 0, 0.12 - i * 0.12);
      add(g, box(0.14, 0.04, 0.04), rope, 0, 0.16, -0.17);
    } else if (cls === MutantClass.Nightrunner) {
      // 瘦骨嶙峋（调研：瘦弱的夜行者/瘦骨嶙峋的外表）
      if (S.mesh) S.mesh.scale.set(0.8, 1.05, 0.8);
    } else if (cls === MutantClass.Crawler) {
      // 蜥蜴背鳍（调研：森林海岛蜥蜴基因）
      const g = spine(), m = mat(0x46633a, 0x142010, 0.4);
      for (let i = 0; i < 4; i++) add(g, cone(0.05, 0.26 - i * 0.04), m, 0, 0.14 + i * 0.13, -0.02 - i * 0.05, 0, 0, 0);
    } else if (cls === MutantClass.Headhunter) {
      // 双肩大刀 X 交叉（调研：手持两把大刀）
      const g = spine(), steel = mat(0x9aa2ac, 0x181c22, 0.8), grip = mat(0x2c2320);
      add(g, box(0.045, 1.0, 0.03), steel, 0.11, 0.12, -0.17, 0, 0, 0.55);
      add(g, box(0.045, 1.0, 0.03), steel, -0.11, 0.12, -0.17, 0, 0, -0.55);
      add(g, box(0.05, 0.14, 0.05), grip, 0.24, -0.3, -0.17, 0, 0, 0.55);
      add(g, box(0.05, 0.14, 0.05), grip, -0.24, -0.3, -0.17, 0, 0, -0.55);
    } else if (st.isMother) {
      // 母体王冠 + 肩甲（变异者之母威压感）
      const g = head(), m = mat(0x6a1410, 0xff4020, 0.55);
      for (let i = 0; i < 5; i++) add(g, cone(0.03, 0.16 + (i % 2) * 0.08), m, (i - 2) * 0.055, 0.16, -0.02 + Math.abs(i - 2) * -0.03, -0.3 + (i - 2) * 0.15);
      const s = spine(), sm = mat(0x4a1210, 0x300804, 0.4);
      add(s, box(0.14, 0.1, 0.2), sm, 0.24, 0.24, 0);
      add(s, box(0.14, 0.1, 0.2), sm, -0.24, 0.24, 0);
    }
    S._deco = deco.length ? deco : null;
  }

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
    this.applyClassVisual(a);    // 体型 + 职业染色同步（V51）
    if (this._autoCls === id) { this._autoCls = -1; } // 感染时的自动默认职业不重复播报
    else g.hud.eventFeed(`${a.name} 进化为 <b>${CLASS_LABEL[cls] || '变异者'}</b>`, 'evo');
    if (a.isPlayer) {
      g.hud.toast(`已变身：<b style="color:#ff7040">${CLASS_LABEL[cls]}</b>`, 2);
      if (cls === MutantClass.Crawler) g.hud.toast('<b style="color:#8fc88a">混入伪装</b>：士兵 8m 外无法识破你，出爪会短暂暴露', 3.5); // V55
    }
  }

  onInfected(victimId, attackerId) {
    const v = this.g.actors[victimId], at = this.g.actors[attackerId];
    this.g.hud.eventFeed(`${v?.name || '?'} ☣ 被感染了${at ? ` · ${at.name}` : ''}`, 'inf');
    // BOT 子体随机职业（玩家保留默认夜行者自选变身）
    const a = v;
    if (!a || a.isPlayer || this.rules.state(victimId).isMother) return;
    this._autoCls = victimId;
    const r = Math.random();
    const changed = this.rules.setMutantClass(victimId, r < 0.27 ? MutantClass.Nightrunner : r < 0.46 ? MutantClass.Souleater : r < 0.61 ? MutantClass.Devourer : r < 0.74 ? MutantClass.Tangler : r < 0.85 ? MutantClass.Bomber : r < 0.93 ? MutantClass.Crawler : MutantClass.Headhunter);
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
      // 分裂个体（V48，调研：噬魂者可复制分裂个体）：召唤 2 只 20s 短命分裂体
      if (!a.cloneCd || g.time - a.cloneCd > 30) {
        a.cloneCd = g.time;
        for (let i = 0; i < 2; i++) this.spawnCloneZombie(a, i);
      }
      if (a.isPlayer) g.hud.toast('致盲尖啸！分裂体已分离', 1);
    } else if (skill === 'rage') {
      wozAudio.wail(a.isPlayer ? null : a.pos.clone());
      if (a.isPlayer) g.hud.toast('狂暴咆哮！附近变异者加速', 1.5);
    } else if (skill === 'harden') {
      wozAudio.harden(a.isPlayer ? null : a.pos.clone());
      if (a.isPlayer) g.hud.toast('硬化！减伤 70%', 1);
    } else if (skill === 'axeThrow') {
      this.throwAxe(a);
    } else if (skill === 'entangle') {
      this.fireEntangle(a);
    } else if (skill === 'selfDestruct') {
      this.armSelfDestruct(a);
    }
  }

  onAvengerTransformed(id) {
    const g = this.g, a = g.actors[id], st = this.rules.state(id);
    g.slowMoT = 0.9; g.slowMoScale = 0.35; // 复仇者觉醒慢动作（V32）
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
    const sawAt = a.inv.findIndex((w) => w && w.id === 'chainsaw');
    if (sawAt < 0) a.inv[2] = new WeaponState('chainsaw');
    a.slot = sawAt >= 0 ? sawAt : 2; // 电锯槽（转化体单槽 inv 时落在实际所在槽）
    a.readyAt = g.time + 0.5;
    a.soldier.reset();
    a.soldier.setWeapon('chainsaw');
    a.soldier.root.position.copy(a.pos);
    a.soldier.root.visible = !a.isPlayer;
    if (a.isPlayer) {
      g.vm.equip('chainsaw', 0.5);
      g.vm.setVisible(true);
      g.hud.slots(a.inv, 0);
      g.hud.toast('<b style="color:#60e0ff">生化复仇者觉醒！</b> 电锯轻击 500 · 重击 360°旋转清场', 4);
    }
    g.audio.announce('Avenger online!');
    wozAudio.avenger(a.isPlayer ? null : a.pos.clone());
    g.hud.eventFeed(`⚡ ${a.name} 觉醒为<b>生化复仇者</b>！`, 'avg', 10);
    this.hud.avengerBanner(a.name);
  }

  onDevoured(mutantId, corpseId) {
    void corpseId;
    const g = this.g, rules = this.rules;
    const a = g.actors[mutantId];
    if (a) wozAudio.devour(a.isPlayer ? null : a.pos.clone());
    // 进化阶段播报 + 三阶特殊进化表现（体型/发光/回满增量）
    if (!a || !rules) return;
    const st = rules.state(mutantId);
    const stage = rules.evoStage(st);
    if (this._evoStageSeen[mutantId] !== stage) {
      this._evoStageSeen[mutantId] = stage;
      const names = ['', '一阶进化：攻击强化', '二阶进化：防御强化', '三阶进化：特殊进化！'];
      if (names[stage]) {
        wozAudio.evo(a.isPlayer ? null : a.pos.clone());
        if (a.isPlayer) g.hud.toast(`<b style="color:#ffb040">${names[stage]}</b>`, 2);
        g.hud.eventFeed(`${a.name} 达成<b>${names[stage]}</b>`, 'evo');
      }
      if (stage >= 3) {
        a.soldier.root.scale.multiplyScalar(1.12);
        if (!a.evoLight) {
          a.evoLight = new THREE.PointLight(0xff5030, 1.6, 7);
          a.evoLight.position.set(0, 1.6, 0);
          a.soldier.root.add(a.evoLight);
        }
        if (a.isPlayer) { st.hp = Math.min(rules.effectiveMaxHp(st), st.hp + WOZ.evoStageHpBonus); a.hp = Math.max(1, Math.round(st.hp)); }
      }
    }
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
    this.g.slowMoT = 0.7; this.g.slowMoScale = 0.4; // 尸潮降临慢动作（V32）
    const g = this.g;
    g.hud.eventFeed(`☠ <b>尸潮降临！</b>${count} 只 AI 变异者涌入战场`, 'tide', 10);
    for (let i = 0; i < count; i++) {
      // V53：尸潮改为悲惨行者（调研：末分钟大批 AI 变异者 HP 低/每击 20HP/速度快）
      this.spawnSorrowWalker(WOZ.sorrowFrenzyHp, '尸潮');
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
    g.slowMoT = 0.8; g.slowMoScale = 0.35; // 感染族决胜慢动作（V32）
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

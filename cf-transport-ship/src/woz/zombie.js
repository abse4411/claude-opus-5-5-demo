// 变异者 AI：近战追击型，复用 NavGrid 寻路与 Actor 移动
import * as THREE from 'three';
import { Actor } from '../actor.js';
import { WOZ, MutantClass } from './config.js';

const _v = new THREE.Vector3();

// 人类 BOT 被感染后：把 Zombie 的行为方法以自身属性覆盖到 Bot 实例上
// （实例属性优先于 Bot.prototype，恢复人类时再逐一删除）
const ZOMBIE_METHODS = ['update', 'pickTarget'];

export function toZombieAI(a) {
  for (const k of ZOMBIE_METHODS) a[k] = Zombie.prototype[k];
  a.isZombie = true;
  a.wozExtra = false;
  a.thinkT = 0; a.path = null; a.pi = 0; a.target = null;
  a.stuckT = 0;
  if (a.lastCheck) a.lastCheck.set(0, 0, 0); else a.lastCheck = new THREE.Vector3();
  a.wantJump = false;
}

export function stripZombieAI(a) {
  for (const k of ZOMBIE_METHODS) delete a[k];
  a.isZombie = false;
}

export class Zombie extends Actor {
  constructor(game, o) {
    super(game, o);
    this.thinkT = 0;
    this.path = null; this.pi = 0;
    this.target = null;
    this.stuckT = 0; this.lastCheck = new THREE.Vector3();
    this.wantJump = false;
    this.wozExtra = !!o.wozExtra;   // 尸潮 AI：死亡后不参与规则层
    this.isZombie = true;
  }

  pickTarget() {
    let best = null, bestD = Infinity;
    for (const a of this.game.actors) {
      if (!a.alive || a.team === this.team) continue;
      const d = a.pos.distanceTo(this.pos);
      if (d < bestD) { bestD = d; best = a; }
    }
    this.target = best;
    return best;
  }

  update(dt) {
    const g = this.game, now = g.time;
    if (!this.alive) return;
    // 命中暂缓：移动迟滞 + 攻击硬直（衰减统一在 game.simulate 全角色处理）
    const staggered = this.staggerT > 0;
    const rules = g.woz?.rules;
    this.thinkT -= dt;
    let repath = false;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + Math.random() * 0.1;
      const t = this.pickTarget();
      if (t && (!this.path || this.pathFor !== t.id || this.pi >= this.path.length)) repath = true;
    }
    const t = this.target && this.target.alive ? this.target : this.pickTarget();
    let wishX = 0, wishZ = 0, dYaw = this.yaw, fire = false;
    let inRange = false;
    if (t) {
      const dist = t.pos.distanceTo(this.pos);
      // 视线直连时放弃绕路
      const e = this.eye(_v);
      const tp = t.soldier.chestWorld(new THREE.Vector3());
      const d3 = tp.clone().sub(e); const L = d3.length(); d3.divideScalar(L || 1);
      const clear = dist < 26 && !g.world.raycast(e.x, e.y, e.z, d3.x, d3.y, d3.z, L - 0.1, 'sight');
      if (clear) {
        this.path = null;
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, hd = Math.hypot(dx, dz);
        if (hd > WOZ.clawRange * 0.8) { wishX = dx / hd; wishZ = dz / hd; }
        dYaw = Math.atan2(-dx, -dz);
        inRange = hd < WOZ.clawRange;
      } else if (repath || !this.path || this.pi >= this.path.length) {
        this.path = g.nav.findPath(this.pos.x, this.pos.z, t.pos.x, t.pos.z);
        this.pi = 1;
      } else {
        const wp = this.path[this.pi];
        const dx = wp[0] - this.pos.x, dz = wp[1] - this.pos.z, dd = Math.hypot(dx, dz);
        if (dd < 0.6) this.pi++;
        else { wishX = dx / dd; wishZ = dz / dd; dYaw = Math.atan2(-dx, -dz); }
      }
      // 近身狂乱跳（翻越掩体）
      if (dist < 4 && this.onGround && Math.random() < dt * 0.6) this.wantJump = true;
    }
    // 分离（避免叠罗汉）
    for (const a of g.actors) {
      if (a === this || !a.alive || a.team !== this.team) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-4) { const d = Math.sqrt(d2); wishX += dx / d * 0.5; wishZ += dz / d * 0.5; }
    }
    // 卡住检测：1 秒位移 <0.3m 就跳
    this.stuckT += dt;
    if (this.stuckT > 1.0) {
      if (this.lastCheck.distanceTo(this.pos) < 0.3 && (wishX || wishZ)) this.wantJump = true;
      this.lastCheck.copy(this.pos); this.stuckT = 0;
    }
    // 职业移速（疾冲由 rules 倍率体现）
    this.speedMul = rules ? rules.mutantSpeedMultiplier(this.id) : WOZ.mutantSpeed;
    if (this.supplySlow) this.speedMul *= 0.75; // 补给变异体（V35）：驮着补给跑不快
    const turn = (9 + Math.random() * 2) * dt;
    const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    this.yaw = wrapPi(this.yaw + THREE.MathUtils.clamp(wrapPi(dYaw - this.yaw), -turn, turn));
    const mStag = staggered ? 0.3 : 1;
    if (this.rootT > 0) { this.rootT -= dt; this.move(dt, 0, 0, false, false, false); } // 被缠绕定身
    else this.move(dt, wishX * mStag, wishZ * mStag, this.wantJump, false, false);
    this.wantJump = false;
    // 攻击输入交给武器状态机（含攻速间隔）；暂缓硬直期间无法出爪
    const facing = Math.abs(wrapPi(dYaw - this.yaw)) < 0.7;
    this.weaponUpdate(dt, { fire: inRange && facing && !staggered, firePressed: inRange && facing && !staggered });
  }
}

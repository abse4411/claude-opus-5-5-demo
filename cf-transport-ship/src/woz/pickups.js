// 生化模式：AI 怪物掉落的补给/技能道具（走近拾取）
import * as THREE from 'three';
import { BIO } from './config.js';

const KINDS = {
  hp: { color: 0xff4a3a, label: '医疗补给 +50 HP' },
  ammo: { color: 0xffd24a, label: '弹药箱 · 备弹 +1 弹匣' },
  skill: { color: 0x60e0ff, label: '生化能量 · 技能充满' },
};

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawnDrop(pos, kind) {
    if (!KINDS[kind]) return;
    const c = KINDS[kind].color;
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    box.position.y = 0.55;
    const light = new THREE.PointLight(c, 2, 5);
    light.position.y = 0.8;
    g.add(box, light);
    g.position.set(pos.x, 0, pos.z);
    this.game.renderer.scene.add(g);
    this.list.push({ g, box, kind, pos: g.position, life: 20 });
  }

  // 随机掉落：医疗 / 弹药 / 生化能量
  randomDrop(pos) {
    const r = Math.random();
    const kind = r < 0.4 ? 'hp' : r < 0.75 ? 'ammo' : 'skill';
    this.spawnDrop(pos, kind);
  }

  /**
   * @returns 拾取事件数组 [{actor, kind}]
   */
  update(dt) {
    const events = [];
    this.list = this.list.filter((p) => {
      p.life -= dt;
      p.box.rotation.y += dt * 2.4;
      p.box.position.y = 0.55 + Math.sin(this.game.time * 3 + p.pos.x) * 0.08;
      let taken = false;
      for (const a of this.game.actors) {
        if (!a.alive || a.team !== 'GR') continue;
        if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 1.25) {
          this.apply(a, p.kind);
          events.push({ actor: a, kind: p.kind });
          taken = true;
          break;
        }
      }
      if (taken || p.life <= 0) {
        this.game.renderer.scene.remove(p.g);
        return false;
      }
      return true;
    });
    return events;
  }

  apply(a, kind) {
    const g = this.game, rules = g.woz?.rules;
    if (kind === 'hp') {
      a.hp = Math.min(100, a.hp + BIO.dropHeal);
    } else if (kind === 'ammo') {
      for (const w of a.inv) {
        const d = w.def;
        if (d.type !== 'melee' && d.type !== 'grenade') w.reserve += d.mag * BIO.dropAmmoMags;
      }
    } else if (kind === 'skill' && rules) {
      const st = a.id < rules.playerCount ? rules.state(a.id) : null;
      if (st) st.skillCharge = 1;
    }
    if (a.isPlayer) g.hud.toast(`拾取 ${KINDS[kind].label}`, 1.5);
    this.game.onFootstep ? null : null;
  }

  clear() {
    for (const p of this.list) this.game.renderer.scene.remove(p.g);
    this.list = [];
  }
}

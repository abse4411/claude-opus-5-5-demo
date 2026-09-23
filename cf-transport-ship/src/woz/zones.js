// WOZ 区域效果：燃烧瓶火海 / 冻结弹寒爆 / 毒气弹毒雾
import * as THREE from 'three';

const KINDS = {
  fire: { r: 3.2, life: 5, dps: 14, color: 0xff5a1a, label: '火海' },
  gas: { r: 3.6, life: 6, dps: 9, color: 0x6ae05a, label: '毒雾' },
  frost: { r: 4.6, life: 4, dps: 0, color: 0x9adfff, label: '寒爆' },
};

export class Zones {
  static _dir = { x: 0, z: 1 };
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(kind, pos) {
    const k = KINDS[kind];
    if (!k) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(k.r - 0.3, k.r, 32),
      new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotateX(-Math.PI / 2);
    ring.position.set(pos.x, 0.08, pos.z);
    const light = new THREE.PointLight(k.color, kind === 'frost' ? 1.5 : 3, k.r * 2.2);
    light.position.set(pos.x, 0.8, pos.z);
    this.game.renderer.scene.add(ring);
    this.game.renderer.scene.add(light);
    this.list.push({ kind, pos: pos.clone(), ring, light, life: k.life });
  }

  update(dt) {
    const g = this.game;
    this.list = this.list.filter((z) => {
      z.life -= dt;
      z.ring.material.opacity = 0.25 + Math.abs(Math.sin(g.time * 4)) * 0.3;
      if (z.kind === 'fire') z.light.intensity = 2.4 + Math.sin(g.time * 13) * 1.2;
      // 结算伤害/减速（火与毒对所有人生效，冻结主要冻结变异者）
      for (const a of g.actors) {
        if (!a.alive) continue;
        const d = Math.hypot(a.pos.x - z.pos.x, a.pos.z - z.pos.z);
        if (d > KINDS[z.kind].r) continue;
        if (z.kind === 'frost') {
          a.staggerT = Math.max(a.staggerT || 0, 0.4);
          if (a.vel) { a.vel.x *= 0.9; a.vel.z *= 0.9; }
          continue;
        }
        const heavy = a.wozHeavy ? 0.8 : 1; // 变异者体表宽，毒火持续伤害略降
        g.damage(a, null, KINDS[z.kind].dps * dt * heavy, 'chest', 'zone' + z.kind, Zones._dir, false);
      }
      if (z.life <= 0) {
        g.renderer.scene.remove(z.ring);
        g.renderer.scene.remove(z.light);
        return false;
      }
      return true;
    });
  }

  clear() {
    for (const z of this.list) {
      this.game.renderer.scene.remove(z.ring);
      this.game.renderer.scene.remove(z.light);
    }
    this.list = [];
  }
}

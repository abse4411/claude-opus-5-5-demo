// WOZ 目标物：据点占领（生化对抗）与核弹装置（生化爆破）
// 纯状态机 + 简单视觉标识，胜负判定数据由 WozManager 消费
import * as THREE from 'three';
import { DEMOL } from './config.js';

const COL = {
  none: 0x9aa4ad,
  GR: 0x4a90d9,
  BL: 0xd94a3a,
};

// 目标点悬浮标记（世界内精灵，穿墙可见；颜色随归属/状态刷新）
const MKR = { GR: '#4fa0ff', BL: '#ff6a4a', none: '#cfd6dd', gold: '#ffd24a', red: '#ff4030' };

function hexPath(x, cx, cy, r) {
  x.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
}

function drawLetterMarker(x, col, label) {
  x.clearRect(0, 0, 128, 128);
  x.globalAlpha = 0.82; x.fillStyle = '#0a0e12'; hexPath(x, 64, 58, 42); x.fill(); x.globalAlpha = 1;
  x.lineWidth = 7; x.strokeStyle = col; hexPath(x, 64, 58, 42); x.stroke();
  x.fillStyle = col; x.font = '700 50px "Microsoft YaHei",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 64, 60);
  x.beginPath(); x.moveTo(64, 104); x.lineTo(80, 124); x.lineTo(48, 124); x.closePath();
  x.fillStyle = col; x.fill();
}

function drawNukeMarker(x, col) {
  x.clearRect(0, 0, 128, 128);
  x.globalAlpha = 0.82; x.beginPath(); x.arc(64, 58, 38, 0, 7); x.fillStyle = '#140e02'; x.fill(); x.globalAlpha = 1;
  x.lineWidth = 7; x.strokeStyle = col; x.beginPath(); x.arc(64, 58, 38, 0, 7); x.stroke();
  x.fillStyle = col; x.font = '700 46px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('☢', 64, 60);
  x.beginPath(); x.moveTo(64, 104); x.lineTo(80, 124); x.lineTo(48, 124); x.closePath(); x.fill();
}

function markerSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  spr.renderOrder = 999;
  spr.scale.set(1.6, 1.6, 1);
  spr.userData = { x, tex };
  return spr;
}

function refreshMarker(spr, col, label) {
  if (label !== undefined) drawLetterMarker(spr.userData.x, col, label);
  else drawNukeMarker(spr.userData.x, col);
  spr.userData.tex.needsUpdate = true;
}

function zoneRing(x, z, r, color) {
  const geo = new THREE.RingGeometry(r - 0.35, r, 40);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, 0.06, z);
  return m;
}

// ---------------- 据点 ----------------
export class CapturePoint {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.owner = 'none';
    this.progress = 50; // 0=BL 完全控制, 100=GR 完全占领
    this.contested = false;
    this.ring = zoneRing(def.x, def.z, def.r, COL.none);
    game.renderer.scene.add(this.ring);
    this.marker = markerSprite();
    this.marker.position.set(def.x, 2.6, def.z);
    refreshMarker(this.marker, MKR.none, def.name);
    this.mkKey = 'none';
    game.renderer.scene.add(this.marker);
  }

  humansIn() {
    return this.inZone().filter((a) => a.team === 'GR').length;
  }

  mutantsIn() {
    return this.inZone().filter((a) => a.team === 'BL').length;
  }

  inZone() {
    return this.game.actors.filter((a) => a.alive
      && Math.hypot(a.pos.x - this.def.x, a.pos.z - this.def.z) <= this.def.r);
  }

  update(dt) {
    const h = this.humansIn(), m = this.mutantsIn();
    this.contested = h > 0 && m > 0;
    if (h > m) this.progress = Math.min(100, this.progress + dt * 100 / 10 * Math.min(3, h - m + 1) / 1);
    else if (m > h) this.progress = Math.max(0, this.progress - dt * 100 / 10 * Math.min(3, m - h + 1) / 1);
    if (this.progress >= 100 && this.owner !== 'GR') {
      this.owner = 'GR';
      return 'captured';
    }
    if (this.progress <= 0 && this.owner !== 'BL') {
      this.owner = 'BL';
      return 'lost';
    }
    // 视觉
    const c = this.contested ? 0xffd24a : COL[this.owner];
    this.ring.material.color.setHex(c);
    this.ring.material.opacity = 0.4 + Math.abs(Math.sin(this.game.time * 2)) * (this.contested ? 0.4 : 0.15);
    // 悬浮标记：归属色 / 争夺金色脉冲 / 上下浮动
    const key = this.contested ? 'c' : this.owner;
    if (key !== this.mkKey) {
      this.mkKey = key;
      refreshMarker(this.marker, this.contested ? MKR.gold : MKR[this.owner] || MKR.none, this.def.name);
    }
    this.marker.position.y = 2.55 + Math.sin(this.game.time * 1.7 + this.def.x) * 0.1;
    this.marker.material.opacity = this.contested ? 0.68 + 0.32 * Math.abs(Math.sin(this.game.time * 6)) : 0.96;
    return null;
  }

  dispose() {
    this.game.renderer.scene.remove(this.ring);
    this.game.renderer.scene.remove(this.marker);
  }
}

// ---------------- 核弹装置 ----------------
export class NuclearBomb {
  /**
   * state: idle(待安放) → planting → planted(倒计时) → destroying → detonated | destroyed
   */
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.state = 'idle';
    this.progress = 0;      // 安放/破坏吟唱进度 0..1
    this.timer = 0;         // 安放后倒计时
    this.planter = -1;      // 率先安放者（英雄）
    this.pos = new THREE.Vector3(def.x, 0.4, def.z);
    // 装置模型：核弹桶 + 警示环
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 14),
      new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 }));
    body.position.y = 0.45;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.08, 14),
      new THREE.MeshStandardMaterial({ color: 0xd9b13a, roughness: 0.4, emissive: 0x553300 }));
    cap.position.y = 0.92;
    const light = new THREE.PointLight(0xff4422, 3, 8);
    light.position.y = 1.2;
    g.add(body, cap, light);
    g.position.copy(this.pos);
    this.light = light;
    this.mesh = g;
    this.ring = zoneRing(def.x, def.z, def.r, 0xd9b13a);
    this.marker = markerSprite();
    this.marker.position.set(def.x, 2.6, def.z);
    refreshMarker(this.marker, MKR.gold);
    this.mkKey = 'idle';
    game.renderer.scene.add(this.mesh);
    game.renderer.scene.add(this.ring);
    game.renderer.scene.add(this.marker);
  }

  inSite(a) {
    return a.alive && a.team === 'GR'
      && Math.hypot(a.pos.x - this.def.x, a.pos.z - this.def.z) <= this.def.r;
  }

  mutantsNear() {
    return this.game.actors.filter((a) => a.alive && a.team === 'BL'
      && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) <= 2.2);
  }

  humansInSite(holding = true) {
    return this.game.actors.filter((a) => this.inSite(a)
      && (!holding || a.isPlayer ? !!(a.keys && a.keys.has('KeyE')) : true));
  }

  get canPlant() {
    return this.state === 'idle' && this.humansInSite(true).length > 0;
  }

  /**
   * @returns 事件 'planted' | 'detonated' | 'destroyed' | null
   */
  update(dt) {
    const g = this.game;
    let ev = null;
    if (this.state === 'idle') {
      if (this.humansInSite(true).length > 0) {
        this.state = 'planting'; // 区域内有人按住 E（BOT 视作持续按住）
        this.progress = 0;
      } else if (this.humansInSite(false).length > 0) {
        this.ring.material.color.setHex(0xffe08a); // 在区域内但未按键：高亮提示
      }
    }
    if (this.state === 'planting') {
      const planters = this.humansInSite(true); // 必须按住 E
      if (planters.length === 0) {
        this.state = 'idle';
        this.progress = 0;
      } else {
        this.progress += dt / DEMOL.plantTime;
        if (this.progress >= 1) {
          this.state = 'planted';
          this.timer = DEMOL.bombTime;
          this.planter = planters[0].id;
          this.mesh.position.copy(planters[0].pos.clone().setY(0.4));
          this.pos.copy(this.mesh.position);
          ev = 'planted';
        }
      }
    } else if (this.state === 'planted') {
      this.timer -= dt;
      this.light.intensity = 3 + Math.sin(g.time * 8) * 2;
      const m = this.mutantsNear();
      if (m.length > 0) {
        this.state = 'destroying';
        this.progress = 0;
      }
      if (this.timer <= 0) {
        this.state = 'detonated';
        ev = 'detonated';
      }
    } else if (this.state === 'destroying') {
      const m = this.mutantsNear();
      if (m.length === 0) {
        this.state = 'planted';
      } else {
        this.progress += dt * m.length / DEMOL.destroyTime;
        if (this.progress >= 1) {
          this.state = 'destroyed';
          ev = 'destroyed';
        }
      }
    }
    void g;
    // 悬浮标记：站点金色呼吸 / 已安放红色快闪跟随 / 结束隐藏
    const st = this.state;
    if (st === 'detonated' || st === 'destroyed') {
      this.marker.visible = false;
    } else {
      this.marker.visible = true;
      const planted = st === 'planted' || st === 'destroying';
      const key = planted ? 'bomb' : 'site';
      if (key !== this.mkKey) {
        this.mkKey = key;
        refreshMarker(this.marker, planted ? MKR.red : MKR.gold);
      }
      const px = planted ? this.pos.x : this.def.x, pz = planted ? this.pos.z : this.def.z;
      this.marker.position.set(px, 2.55 + Math.sin(g.time * 1.7) * 0.1, pz);
      this.marker.material.opacity = planted
        ? 0.45 + 0.55 * Math.abs(Math.sin(g.time * 9))
        : 0.65 + 0.3 * Math.abs(Math.sin(g.time * 2.5));
    }
    return ev;
  }

  dispose() {
    this.game.renderer.scene.remove(this.mesh);
    this.game.renderer.scene.remove(this.ring);
    this.game.renderer.scene.remove(this.marker);
  }
}

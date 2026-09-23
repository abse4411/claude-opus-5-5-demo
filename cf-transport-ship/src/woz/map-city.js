// 死亡城市：废弃街区夜战地图（WOZ 专属）
// 设计原则（调研归纳）：三线通路（北巷/中央大道/南巷）、出生呼吸点、
// 阻塞点控制节奏、视线掩体打断长走廊、跳点守位（喷泉/车顶/垃圾箱）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- 程序化贴图 ----------
function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(x, base, vary, size) {
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 14; i++) {
    const v = (Math.random() - 0.5) * vary;
    x.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    x.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}

export function buildCityMap(scene, T, world, variant = 'street') {
  if (variant === 'plaza') return buildPlaza(scene, T, world);
  const meshes = [];
  const lampSpots = [];
  const anim = [];
  const mats = {};

  // ---- 材质 ----
  const asphaltTex = canvasTex(512, (x, s) => {
    noiseFill(x, '#1d2024', 46, s);
    x.strokeStyle = 'rgba(210,200,120,.5)'; x.lineWidth = 5; x.setLineDash([26, 22]);
    x.beginPath(); x.moveTo(s / 2, 0); x.lineTo(s / 2, s); x.stroke();
  }, 8);
  const brickTex = canvasTex(256, (x, s) => {
    noiseFill(x, '#3a2e2a', 40, s);
    x.strokeStyle = 'rgba(20,14,12,.9)'; x.lineWidth = 2;
    for (let r = 0; r < 8; r++) {
      x.beginPath(); x.moveTo(0, r * s / 8); x.lineTo(s, r * s / 8); x.stroke();
      const off = r % 2 ? s / 12 : 0;
      for (let cB = 0; cB < 6; cB++) { x.beginPath(); x.moveTo(off + cB * s / 6, r * s / 8); x.lineTo(off + cB * s / 6, (r + 1) * s / 8); x.stroke(); }
    }
  }, 3);
  const concreteTex = canvasTex(256, (x, s) => noiseFill(x, '#4a4d50', 36, s), 2);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    road: std({ map: asphaltTex, roughness: 0.95, metalness: 0.05 }),
    walk: std({ map: concreteTex, roughness: 0.9 }),
    brick: std({ map: brickTex, roughness: 0.92 }),
    ruin: std({ color: 0x3c3a36, roughness: 0.95 }),
    car0: std({ color: 0x6e2f2a, roughness: 0.45, metalness: 0.5 }),
    car1: std({ color: 0x2c4a5e, roughness: 0.45, metalness: 0.5 }),
    car2: std({ color: 0x5a5a52, roughness: 0.5, metalness: 0.4 }),
    glass: std({ color: 0x101820, roughness: 0.2, metalness: 0.6 }),
    barrier: std({ map: concreteTex, color: 0xb8b4a8, roughness: 0.9 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    dark: std({ color: 0x17181c, roughness: 0.9 }),
  };
  const batch = {};
  function B(key, mat) {
    if (!batch[key]) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      batch[key] = { mesh, geos: [] };
      scene.add(mesh);
      meshes.push(mesh);
    }
    return batch[key];
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  function put(key, geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    e.set(0, ry, 0); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y, z), q, one.clone().multiply(new THREE.Vector3(sx, sy, sz)));
    B(key, M[key] || M.dark).geos.push(geo.clone().applyMatrix4(m4));
  }
  const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // 碰撞实体
  function solid(x, z, sx, sz, h, ry = 0, y = 0) {
    world.add({ x, y: y + h / 2, z, sx: ry ? sz : sx, sz: ry ? sx : sz, sy: h, yaw: ry, mat: 'concrete', bullet: 'block', sight: true, surface: 'metal' });
  }

  // ---- 地面（柏油路面 + 两侧人行道） ----
  {
    const g = new THREE.PlaneGeometry(76, 26); g.rotateX(-Math.PI / 2);
    put('road', g, 0, 0, 0);
    const w1 = new THREE.PlaneGeometry(76, 2.4); w1.rotateX(-Math.PI / 2);
    put('walk', w1, 0, 0.06, 10.4);
    put('walk', w1, 0, 0.06, -10.4);
  }

  // ---- 边界（城市围墙） ----
  solid(0, -12.6, 76, 1, 3.2, 0); put('brick', BX(76, 3.2, 1), 0, 1.6, -12.6);
  solid(0, 12.6, 76, 1, 3.2, 0); put('brick', BX(76, 3.2, 1), 0, 1.6, 12.6);
  solid(-37.6, 0, 1, 26, 3.2, 0); put('brick', BX(1, 3.2, 26), -37.6, 1.6, 0);
  solid(37.6, 0, 1, 26, 3.2, 0); put('brick', BX(1, 3.2, 26), 37.6, 1.6, 0);

  // ---- 建筑排（北 z≈5.4 / 南 z≈-5.4，留出 x=±15 十字巷口）----
  function buildingRow(zSign) {
    const z = zSign * 5.4;
    const segs = [[-30, 10], [-16, 8], [16, 8], [30, 10]]; // [中心x, 长度]；±15 与 ±(15..16) 之间为巷口
    for (const [cx, len] of segs) {
      const h = 5.2;
      solid(cx, z, len, 3, h);
      put('brick', BX(len, h, 3), cx, h / 2, z);
      // 沿街雨棚与窗户装饰（不碰撞）
      put('dark', BX(len * 0.9, 0.18, 0.8), cx, 2.6, z - zSign * 1.7);
      for (let wx = cx - len / 2 + 1.4; wx <= cx + len / 2 - 1.4; wx += 2.2) {
        put('glass', BX(1.1, 1.2, 0.1), wx, 3.9, z - zSign * 1.53);
      }
    }
  }
  buildingRow(1); buildingRow(-1);

  // ---- 出生呼吸点（两端庭院：立柱 + 顶棚掩体，无直接视线） ----
  function spawnYard(xSign) {
    const x = xSign * 31;
    for (const dz of [-6, 6]) {
      solid(x, dz, 1.2, 1.2, 3.4);
      put('concrete', BX(1.2, 3.4, 1.2), x, 1.7, dz);
    }
    put('dark', BX(3.4, 0.3, 14.6), x, 3.55, 0);
    solid(x, 0, 3.4, 0.4, 3.0); // 中央门柱
    put('brick', BX(0.5, 3.0, 0.5), x, 1.5, 0);
  }
  spawnYard(1); spawnYard(-1);

  // ---- 中央广场（交战热区）：喷泉 + 巴士残骸 + 轿车 ----
  {
    // 喷泉（守点 H1：跳上 0.55m 池沿）
    const fg = new THREE.CylinderGeometry(2.3, 2.5, 0.55, 8); fg.translate(0, 0.275, 0);
    put('concrete', fg, 0, 0, 0);
    solid(0, 0, 4.1, 4.1, 0.55);
    const pil = new THREE.CylinderGeometry(0.4, 0.55, 1.6, 8); pil.translate(0, 0.8, 0);
    put('concrete', pil, 0, 0.55, 0);
    solid(0, 0, 1.1, 1.1, 2.1);
    // 巴士残骸（守点 H2：经轿车跳上车顶 1.5m）
    solid(4.5, -1.2, 7.4, 2.4, 1.5, 0.12);
    put('car', BX(7.4, 1.0, 2.4), 4.5, 0.5, -1.2, 0.12);
    put('glass', BX(6.6, 0.55, 2.2), 4.5, 1.15, -1.2, 0.12);
    put('dark', BX(7.4, 0.35, 2.4), 4.5, 1.45, -1.2, 0.12);
    // 轿车（掩体 / 跳板）
    const car = (x, z, ry, ci) => {
      solid(x, z, 4.2, 1.9, 1.25, ry);
      put('car' + ci, BX(4.2, 0.55, 1.9), x, 0.4, z, ry);
      put('glass', BX(2.0, 0.5, 1.7), x, 0.95, z, ry);
      put('car' + ci, BX(4.2, 0.3, 1.9), x, 1.1, z, ry);
    };
    car(-4.5, 2.2, 0.06, 0); car(6.5, 2.4, -0.08, 1); car(-7.5, -2.4, 0.1, 2); car(19, 2, 0.04, 0); car(-24, -2.2, -0.05, 1);
    // 电线杆与路灯（灯位供点光源）
    for (const [lx, lz] of [[-15, 4.4], [15, 4.4], [-15, -4.4], [15, -4.4], [0, 4.2], [-30, 4.2], [30, 4.2], [-30, -4.2], [30, -4.2]]) {
      solid(lx, lz, 0.35, 0.35, 4.6);
      put('dark', BX(0.28, 4.6, 0.28), lx, 2.3, lz);
      put('lamp', BX(0.9, 0.16, 0.4), lx, 4.55, lz);
      lampSpots.push(new THREE.Vector3(lx, 4.3, lz));
    }
  }

  // ---- 北巷 / 南巷 掩体（垃圾箱、沙袋、瓦砾） ----
  function laneProps(zSign) {
    const z = zSign * 9;
    // 垃圾箱（守点 H3：跳上 1.35m）
    solid(-8, z, 2.4, 1.3, 1.35);
    put('dark', BX(2.4, 1.35, 1.3), -8, 0.675, z);
    // 木箱跳板
    solid(-10.2, z + zSign * 0.4, 1.2, 1.2, 0.7);
    put('ruin', BX(1.2, 0.7, 1.2), -10.2, 0.35, z + zSign * 0.4);
    // 巷口沙袋墙
    for (const sx of [-15, 15]) {
      solid(sx, zSign * 4.9, 2.6, 0.9, 0.95);
      put('barrier', BX(2.6, 0.95, 0.9), sx, 0.475, zSign * 4.9);
    }
    // 瓦砾堆
    for (const [rx, rs] of [[5, 1], [-22, 1.4], [24, 1.2]]) {
      solid(rx, z - zSign * 0.5, 1.6 * rs, 1.2 * rs, 0.55 * rs);
      put('ruin', BX(1.6 * rs, 0.55 * rs, 1.2 * rs), rx, 0.275 * rs, z - zSign * 0.5);
    }
    // 巷口阻塞路障（x=±15 十字巷）
    for (const sx of [-15, 15]) {
      solid(sx, zSign * 2.2, 0.9, 2.4, 0.95);
      put('barrier', BX(0.9, 0.95, 2.4), sx, 0.475, zSign * 2.2);
    }
  }
  laneProps(1); laneProps(-1);

  // ---- 中路阻塞路障（控制节奏的 chokepoint）----
  for (const [bx, bz, ry] of [[-15, 0, 0], [15, 0, 0]]) {
    solid(bx, bz, 0.9, 3.2, 0.95, ry);
    put('barrier', BX(0.9, 0.95, 3.2), bx, 0.475, bz, ry);
  }

  // ---- 出生点（西侧 BL 变异者 / 东侧 GR 人类）----
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -7 + (i % 5) * 3.4, xx = -33.8 + Math.floor(i / 5) * 2.6;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }

  // ---- 合批提交 ----
  for (const key of Object.keys(batch)) {
    const b = batch[key];
    b.mesh.geometry = mergeGeometries(b.geos, false);
    b.mesh.geometry.computeBoundingSphere();
  }

  // 灯光闪烁
  anim.push((dt, t) => {
    const f = 0.82 + Math.sin(t * 23) * 0.05 + (Math.sin(t * 7.3) > 0.96 ? -0.5 : 0);
    for (const m of meshes) if (m.material === M.lamp) m.material.color.setScalar(0.7 + f * 0.3);
  });

  return {
    spawns, lampSpots, funnelTop: new THREE.Vector3(0, 9, 0), meshes, materials: mats,
    update(dt, t) { for (const f of anim) f(dt, t); },
  };
}


// ---- 都会广场变体：开阔中央广场 + 雕像环岛 + 地铁口 + 花坛阵 ----
export function buildPlazaMap(scene, T, world) {
  const meshes = [];
  const lampSpots = [];
  const batch = {};
  const floorTex = canvasTex(512, (x, s2) => {
    noiseFill(x, '#2a2d33', 40, s2);
    x.strokeStyle = 'rgba(160,160,160,.4)'; x.lineWidth = 2;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, i * s2 / 4); x.lineTo(s2, i * s2 / 4); x.stroke(); }
  }, 8);
  const M = {
    plaza: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }),
    statue: new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.4, metalness: 0.6 }),
    hedge: new THREE.MeshStandardMaterial({ color: 0x1e3a24, roughness: 0.95 }),
    stair: new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.15, metalness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 }),
  };
  function B(key, mat) {
    if (!batch[key]) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.castShadow = mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      batch[key] = { mesh, geos: [] }; scene.add(mesh); meshes.push(mesh);
    }
    return batch[key];
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  function put(key, geo, x, y, z, ry = 0) {
    e.set(0, ry, 0); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, y, z), q, one);
    B(key, M[key] || M.dark).geos.push(geo.clone().applyMatrix4(m4));
  }
  const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  function solid(x, z, sx, sz, h, ry = 0) {
    world.add({ x, y: h / 2, z, sx: ry ? sz : sx, sz: ry ? sx : sz, sy: h, yaw: ry, mat: 'concrete', bullet: 'block', sight: true, surface: 'metal' });
  }
  const fg = new THREE.PlaneGeometry(76, 26); fg.rotateX(-Math.PI / 2);
  put('plaza', fg, 0, 0, 0);
  // 边界
  solid(0, -12.6, 76, 1, 3.2); put('dark', BX(76, 3.2, 1), 0, 1.6, -12.6);
  solid(0, 12.6, 76, 1, 3.2); put('dark', BX(76, 3.2, 1), 0, 1.6, 12.6);
  solid(-37.6, 0, 1, 26, 3.2); put('dark', BX(1, 3.2, 26), -37.6, 1.6, 0);
  solid(37.6, 0, 1, 26, 3.2); put('dark', BX(1, 3.2, 26), 37.6, 1.6, 0);
  // 中央环岛雕像（守点：跳上基座 0.8m）
  solid(0, 0, 4.4, 4.4, 0.8);
  put('statue', BX(4.4, 0.8, 4.4), 0, 0.4, 0);
  solid(0, 0, 1.2, 1.2, 2.6);
  put('statue', BX(1.2, 1.8, 1.2), 0, 0.8, 0);
  put('statue', BX(1.6, 0.5, 1.6), 0, 2.4, 0);
  // 地铁口（下沉不做出入口，做低矮掩体）
  for (const [mx, mz] of [[-12, -6], [12, 6]]) {
    solid(mx, mz, 3.4, 0.7, 1.1);
    put('stair', BX(3.4, 1.1, 0.7), mx, 0.55, mz);
  }
  // 花坛阵（灌木掩体）
  for (const [hx, hz] of [[-18, -4], [-14, 4], [16, -4], [20, 4], [-6, 7.5], [8, -7.5], [-28, 5], [28, -5]]) {
    solid(hx, hz, 2.2, 1.1, 0.85);
    put('hedge', BX(2.2, 0.85, 1.1), hx, 0.425, hz);
  }
  // 路灯
  for (const [lx, lz] of [[-20, 0], [0, 9], [0, -9], [20, 0], [-32, -6], [32, 6]]) {
    put('dark', BX(0.28, 4.4, 0.28), lx, 2.2, lz);
    lampSpots.push(new THREE.Vector3(lx, 4.1, lz));
  }
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -7 + (i % 5) * 3.4, xx = -33.8 + Math.floor(i / 5) * 2.6;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }
  for (const key of Object.keys(batch)) {
    const b = batch[key];
    b.mesh.geometry = mergeGeometries(b.geos, false);
    b.mesh.geometry.computeBoundingSphere();
  }
  return {
    spawns, lampSpots, funnelTop: new THREE.Vector3(0, 8, 0), meshes, materials: {},
    update() {},
  };
}

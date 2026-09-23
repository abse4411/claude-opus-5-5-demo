// 生化实验室：室内走廊 + 中央标本厅（WOZ 地图 2）
// 设计：环形动线（中厅 + 南北实验室）、玻璃视线阻断、化验台掩体、跳点标本台
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLabMap(scene, T, world) {
  const meshes = [];
  const lampSpots = [];
  const anim = [];
  const batch = {};

  const floorTex = canvasTex(512, (x, s) => {
    x.fillStyle = '#23282e'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      x.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
    x.strokeStyle = 'rgba(90,200,180,.35)'; x.lineWidth = 3;
    x.strokeRect(8, 8, s - 16, s - 16);
  }, 8);
  const wallTex = canvasTex(256, (x, s) => {
    x.fillStyle = '#2a3238'; x.fillRect(0, 0, s, s);
    x.fillStyle = 'rgba(106,224,255,.08)';
    for (let i = 0; i < 6; i++) x.fillRect(0, i * s / 6, s, s / 18);
  }, 3);
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.2 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fd8e8, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.4 }),
    table: new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.4, metalness: 0.5 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x0e3a3a, roughness: 0.6, emissive: 0x0a2828 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x1a5a6a, emissive: 0x0a4050, roughness: 0.2, transparent: true, opacity: 0.7 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xaef0ff }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.85 }),
  };
  function B(key, mat) {
    if (!batch[key]) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      batch[key] = { mesh, geos: [] };
      scene.add(mesh); meshes.push(mesh);
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
    world.add({ x, y: h / 2, z, sx: ry ? sz : sx, sz: ry ? sx : sz, sy: h, yaw: ry, mat: 'metal', bullet: 'block', sight: true, surface: 'metal' });
  }

  // 地板
  {
    const g = new THREE.PlaneGeometry(76, 26); g.rotateX(-Math.PI / 2);
    put('floor', g, 0, 0, 0);
  }
  // 地面碰撞体（防坠落）
  world.add({ x: 0, y: -0.5, z: 0, sx: 80, sy: 1, sz: 28, yaw: 0, mat: 'metal', surface: 'metal' });

  // 外墙
  solid(0, -12.6, 76, 1, 4); put('wall', BX(76, 4, 1), 0, 2, -12.6);
  solid(0, 12.6, 76, 1, 4); put('wall', BX(76, 4, 1), 0, 2, 12.6);
  solid(-37.6, 0, 1, 26, 4); put('wall', BX(1, 4, 26), -37.6, 2, 0);
  solid(37.6, 0, 1, 26, 4); put('wall', BX(1, 4, 26), 37.6, 2, 0);

  // 中央标本厅（x -8..8）：培养罐阵 + 中央标本台（守点 H1）
  for (const [tx, tz] of [[-5, -3.2], [-1.5, -3.2], [2, -3.2], [-3.2, 3.2], [0.5, 3.2], [4, 3.2]]) {
    solid(tx, tz, 0.9, 0.9, 1.9);
    put('tank', new THREE.CylinderGeometry(0.45, 0.45, 1.9, 12), tx, 0.95, tz);
  }
  solid(0.5, 0, 3.2, 3.2, 0.6); // 标本台
  put('table', BX(3.2, 0.6, 3.2), 0.5, 0.3, 0);
  put('lamp', BX(2.2, 0.1, 1.6), 0.5, 2.4, 0);
  lampSpots.push(new THREE.Vector3(0.5, 2.2, 0));

  // 南北实验室墙（x -14..-9 与 9..14 为通道口）
  for (const s of [1, -1]) {
    solid(-2.5, s * 5.8, 9, 0.8, 3.4);
    put('wall', BX(9, 3.4, 0.8), -2.5, 1.7, s * 5.8);
    solid(11.5, s * 5.8, 5, 0.8, 3.4);
    put('wall', BX(5, 3.4, 0.8), 11.5, 1.7, s * 5.8);
    // 玻璃观察窗（不阻挡移动，阻挡子弹视线由 sight 决定——这里设为透明装饰）
    put('glass', BX(8, 1.4, 0.12), -2.5, 2.2, s * 5.35);
  }

  // 西侧变异体培养舱（BL 方向装饰墙 + 化验台掩体）
  for (const [tx, tz] of [[-24, -4], [-20, 4], [-27, 0.5]]) {
    solid(tx, tz, 2.6, 1.1, 1.0);
    put('table', BX(2.6, 1.0, 1.1), tx, 0.5, tz);
  }
  // 东侧人类前哨化验台
  for (const [tx, tz] of [[22, -3], [26, 3.5]]) {
    solid(tx, tz, 2.6, 1.1, 1.0);
    put('table', BX(2.6, 1.0, 1.1), tx, 0.5, tz);
  }

  // 走廊顶灯
  for (const [lx, lz] of [[-30, 0], [-18, 8.5], [-18, -8.5], [-5, 0], [5, 8.5], [5, -8.5], [18, 0], [30, 0]]) {
    put('lamp', BX(1.6, 0.08, 0.5), lx, 3.85, lz);
    lampSpots.push(new THREE.Vector3(lx, 3.6, lz));
  }

  // 出生点（西 BL / 东 GR）
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
  anim.push((dt, t) => {
    M.tank.emissiveIntensity = 0.6 + Math.sin(t * 2.2) * 0.25;
    M.lamp.color.setScalar(0.85 + Math.sin(t * 17) * 0.08);
  });

  return {
    spawns, lampSpots, funnelTop: new THREE.Vector3(0, 8, 0), meshes, materials: {},
    update(dt, t) { for (const f of anim) f(dt, t); },
  };
}

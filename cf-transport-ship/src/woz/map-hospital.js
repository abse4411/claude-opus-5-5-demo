// 废弃医院：末日医疗中心夜战地图（WOZ 地图 6）
// 设计：十字走廊动线（中部走廊带 z∈[-4..4] 全程畅通，兼容对抗/爆破固定点位）、
// 中央大厅接待台掩体、东侧病房床阵、西侧手术室、北侧药房、南侧停尸间（惊悚核心）、
// 频闪应急灯氛围、跳点（药柜顶/接待台/床铺）
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
function grime(x, s, n, a) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = `rgba(20,14,10,${Math.random() * a})`;
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 14, 0, 7); x.fill();
  }
}

export function buildHospitalMap(scene, T, world) {
  const meshes = [];
  const lampSpots = [];
  const anim = [];
  const batch = {};

  const floorTex = canvasTex(512, (x, s) => {
    x.fillStyle = '#3a3d38'; x.fillRect(0, 0, s, s);
    grime(x, s, 60, 0.18);
    x.strokeStyle = 'rgba(180,180,170,.25)'; x.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * s / 8, 0); x.lineTo(i * s / 8, s); x.stroke(); }
  }, 10);
  const wallTex = canvasTex(256, (x, s) => {
    x.fillStyle = '#4a5148'; x.fillRect(0, 0, s, s);
    grime(x, s, 30, 0.22);
    x.fillStyle = 'rgba(210,220,200,.12)';
    x.fillRect(0, s * 0.72, s, s * 0.045);
  }, 4);
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7, metalness: 0.15 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.2 }),
    bed: new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.4, metalness: 0.6 }),
    sheet: new THREE.MeshStandardMaterial({ color: 0xb8b4a4, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 }),
    white: new THREE.MeshStandardMaterial({ color: 0xcfd6d2, roughness: 0.5 }),
    blood: new THREE.MeshStandardMaterial({ color: 0x4a120e, roughness: 0.5, emissive: 0x1c0402 }),
    green: new THREE.MeshStandardMaterial({ color: 0x274234, roughness: 0.6, emissive: 0x0c1f14 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xd8ffe8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x191c19, roughness: 0.85 }),
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

  // 地板 80×30 + 地面碰撞
  {
    const g = new THREE.PlaneGeometry(80, 30); g.rotateX(-Math.PI / 2);
    put('floor', g, 0, 0, 0);
  }
  world.add({ x: 0, y: -0.5, z: 0, sx: 84, sy: 1, sz: 34, yaw: 0, mat: 'metal', surface: 'metal' });

  // 外墙
  solid(0, -14.6, 80, 1, 4.5); put('wall', BX(80, 4.5, 1), 0, 2.25, -14.6);
  solid(0, 14.6, 80, 1, 4.5); put('wall', BX(80, 4.5, 1), 0, 2.25, 14.6);
  solid(-39.6, 0, 1, 30, 4.5); put('wall', BX(1, 4.5, 30), -39.6, 2.25, 0);
  solid(39.6, 0, 1, 30, 4.5); put('wall', BX(1, 4.5, 30), 39.6, 2.25, 0);
  // 隐形高栏（防爆炸击退把玩家抛出屋顶）
  world.add({ x: 0, y: 15, z: -14.6, sx: 80, sy: 30, sz: 1, yaw: 0, mat: 'metal', bullet: 'block', sight: false, surface: 'metal' });
  world.add({ x: 0, y: 15, z: 14.6, sx: 80, sy: 30, sz: 1, yaw: 0, mat: 'metal', bullet: 'block', sight: false, surface: 'metal' });
  world.add({ x: -39.6, y: 15, z: 0, sx: 1, sy: 30, sz: 30, yaw: 0, mat: 'metal', bullet: 'block', sight: false, surface: 'metal' });
  world.add({ x: 39.6, y: 15, z: 0, sx: 1, sy: 30, sz: 30, yaw: 0, mat: 'metal', bullet: 'block', sight: false, surface: 'metal' });

  // 中央大厅（x -8..8）：接待台 + 候诊椅 + 吊灯
  solid(0, 3.5, 6, 1.2, 1.1);
  put('wood', BX(6, 1.1, 1.2), 0, 0.55, 3.5);
  put('white', BX(6.2, 0.12, 1.4), 0, 1.14, 3.5);
  for (const [cx, cz] of [[-5.5, 6], [-3.5, 6], [5.5, 6], [3.5, 6], [-5.5, -6], [5.5, -6]]) {
    solid(cx, cz, 0.7, 0.7, 0.9);
    put('bed', BX(0.7, 0.9, 0.7), cx, 0.45, cz);
  }
  put('lamp', BX(2.6, 0.1, 1.2), 0, 4.1, 0);
  lampSpots.push(new THREE.Vector3(0, 3.9, 0));

  // 十字走廊隔墙（z=±4.2 走廊南墙 / 房间开口留 5m 门洞；中部走廊带畅通）
  for (const s of [1, -1]) {
    // 大厅两侧墙：x -20..-12 与 12..20（中间 x -12..12 为大厅开敞区）
    solid(-24, s * 5, 16, 0.8, 3.6);
    put('wall', BX(16, 3.6, 0.8), -24, 1.8, s * 5);
    solid(24, s * 5, 16, 0.8, 3.6);
    put('wall', BX(16, 3.6, 0.8), 24, 1.8, s * 5);
  }
  // 东西走廊隔墙（x=±12 的南北向墙，留门洞）
  for (const s of [1, -1]) {
    solid(s * 12, s * 10, 0.8, 8, 3.6);
    put('wall', BX(0.8, 3.6, 8), s * 12, 1.8, s * 10);
  }

  // 东侧病房：三间，床阵（床头板 + 床架 + 隔帘轨）
  for (let r = 0; r < 3; r++) {
    const bx = 18 + (r % 2) * 9, bz = 8.5 + Math.floor(r / 2) * 0; // 病房在 x 14..38, z 6..14
    const rows = [[16 + r * 8, 9], [16 + r * 8, 12.2]];
    for (const [bx2, bz2] of rows) {
      solid(bx2, bz2, 2.2, 0.9, 0.6);
      put('bed', BX(2.2, 0.6, 0.9), bx2, 0.3, bz2);
      put('sheet', BX(2.0, 0.16, 0.8), bx2, 0.66, bz2);
      put('white', BX(0.12, 1.1, 0.9), bx2 - 1.0, 1.1, bz2);
    }
  }
  put('blood', BX(3.4, 0.02, 2.4), 24, 0.02, 10.5); // 病房血迹

  // 西侧手术室：手术台 + 无影灯 + 器械台
  solid(-26, 9.5, 2.4, 1.0, 0.9);
  put('white', BX(2.4, 0.9, 1.0), -26, 0.45, 9.5);
  put('green', BX(1.6, 0.08, 0.6), -26, 0.95, 9.5);
  put('lamp', BX(1.4, 0.14, 0.9), -26, 3.2, 9.5);
  lampSpots.push(new THREE.Vector3(-26, 3.0, 9.5));
  for (const [tx, tz] of [[-32, 7], [-32, 12.2]]) {
    solid(tx, tz, 2.0, 0.9, 1.0);
    put('white', BX(2.0, 1.0, 0.9), tx, 0.5, tz);
  }

  // 北侧药房：药柜阵列（跳点掩体）
  for (const [cx, cz] of [[-8, -11.5], [-3, -11.5], [2, -11.5], [7, -11.5]]) {
    solid(cx, cz, 3.2, 1.1, 2.1);
    put('white', BX(3.2, 2.1, 1.1), cx, 1.05, cz);
    put('green', BX(2.8, 0.5, 0.06), cx, 1.35, cz + 0.58);
  }

  // 南侧停尸间：停尸台双排 + 冷柜墙（惊悚核心，血迹 + 频闪灯）
  for (const [mx, mz] of [[-4, 10.5], [0, 10.5], [4, 10.5], [-2, 12.8], [2, 12.8]]) {
    solid(mx, mz, 2.2, 0.9, 0.75);
    put('white', BX(2.2, 0.75, 0.9), mx, 0.38, mz);
    put('blood', BX(1.6, 0.02, 0.6), mx, 0.78, mz);
  }
  solid(0, 13.8, 14, 0.6, 2.4);
  put('white', BX(14, 2.4, 0.6), 0, 1.2, 13.8); // 冷柜墙
  put('blood', BX(4.2, 0.02, 2.6), 0, 0.02, 11.5);
  lampSpots.push(new THREE.Vector3(0, 3.2, 11));

  // 走廊应急灯（部分频闪）
  const flicker = [];
  for (const [lx, lz, fl] of [[-34, 0, 1], [-18, 0, 0], [-6, 0, 0], [6, 0, 0], [18, 0, 1], [34, 0, 0], [0, 9, 0], [0, -9, 1]]) {
    put('lamp', BX(1.4, 0.08, 0.42), lx, 4.0, lz);
    lampSpots.push(new THREE.Vector3(lx, 3.8, lz));
    if (fl) flicker.push(lx * 7 + lz);
  }
  anim.push((dt, t) => {
    void dt;
    const f = 0.72 + Math.sin(t * 23) * 0.28 * (Math.sin(t * 3.1) > 0.6 ? 1 : 0.12);
    M.lamp.color.setRGB(0.62 * f + 0.3, 0.9 * f + 0.2, 0.75 * f + 0.2);
  });

  // 出生点（西 BL / 东 GR）
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -6 + (i % 5) * 3, xx = -37 + Math.floor(i / 5) * 2.6;
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
    update(dt, t) { for (const f of anim) f(dt, t); },
  };
}

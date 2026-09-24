// 地铁绝境：地下地铁站台夜战地图（WOZ 地图 7）
// 设计：中央站台（z -5..5 全程畅通，兼容固定目标点位）、双侧轨道槽（沉深 1.4m，车厢掩体）、
// 立柱阵列打断长视线、隧道口即双方出生方向、灯箱/长椅/闸机/售票亭地铁元素、荧光灯频闪
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
    x.fillStyle = `rgba(12,14,16,${Math.random() * a})`;
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 12, 0, 7); x.fill();
  }
}

export function buildSubwayMap(scene, T, world) {
  const meshes = [];
  const lampSpots = [];
  const anim = [];
  const batch = {};

  const floorTex = canvasTex(512, (x, s) => {
    x.fillStyle = '#33373b'; x.fillRect(0, 0, s, s);
    grime(x, s, 50, 0.2);
    x.strokeStyle = 'rgba(220,220,210,.2)'; x.lineWidth = 3;
    for (let i = 0; i <= 6; i++) { x.beginPath(); x.moveTo(0, i * s / 6); x.lineTo(s, i * s / 6); x.stroke(); }
  }, 10);
  const wallTex = canvasTex(256, (x, s) => {
    x.fillStyle = '#3c4248'; x.fillRect(0, 0, s, s);
    grime(x, s, 26, 0.24);
    x.fillStyle = 'rgba(120,190,220,.14)';
    x.fillRect(s * 0.1, s * 0.2, s * 0.8, s * 0.14); // 广告灯箱带
  }, 4);
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65, metalness: 0.2 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75, metalness: 0.25 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0x4a5258, roughness: 0.5, metalness: 0.5 }),
    train: new THREE.MeshStandardMaterial({ color: 0x7a8489, roughness: 0.35, metalness: 0.6 }),
    trainWin: new THREE.MeshStandardMaterial({ color: 0x101c22, roughness: 0.2, metalness: 0.7, emissive: 0x061014 }),
    bench: new THREE.MeshStandardMaterial({ color: 0x6a5842, roughness: 0.8 }),
    sign: new THREE.MeshBasicMaterial({ color: 0x8fe8c0 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xcfe8ff }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.9 }),
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

  // 站台地板 84×28 + 地面
  {
    const g = new THREE.PlaneGeometry(84, 28); g.rotateX(-Math.PI / 2);
    put('floor', g, 0, 0, 0);
  }
  world.add({ x: 0, y: -0.5, z: 0, sx: 88, sy: 1, sz: 32, yaw: 0, mat: 'metal', surface: 'metal' });

  // 侧墙 + 天花板（封闭地下感）
  solid(0, -13.6, 84, 1, 5); put('wall', BX(84, 5, 1), 0, 2.5, -13.6);
  solid(0, 13.6, 84, 1, 5); put('wall', BX(84, 5, 1), 0, 2.5, 13.6);
  // 东西隧道端墙（黑洞洞的隧道口氛围）
  solid(41.6, 0, 1, 28, 5); put('dark', BX(1, 5, 28), 41.6, 2.5, 0);
  solid(-41.6, 0, 1, 28, 5); put('dark', BX(1, 5, 28), -41.6, 2.5, 0);
  put('dark', BX(84, 0.4, 28), 0, 5.2, 0); // 天花板（装饰，不阻挡抛射物也无所谓）
  {
    // 天花板碰撞（防手雷/跳越出界）
    world.add({ x: 0, y: 5.6, z: 0, sx: 84, sy: 0.8, sz: 28, yaw: 0, mat: 'metal', bullet: 'block', sight: false, surface: 'metal' });
  }

  // 双侧轨道槽（装饰性下沉，站台边缘护栏）
  for (const s of [1, -1]) {
    put('dark', BX(84, 0.1, 5.4), 0, -0.2, s * 10.6); // 道床
    for (let i = 0; i < 2; i++) {
      const rz = s * (9.4 + i * 2.4);
      put('train', BX(84, 0.12, 0.14), 0, 0.02, rz); // 钢轨
    }
    // 站台边缘（护栏矮墙，可跳越）
    solid(0, s * 6.4, 84, 0.3, 1.0);
    put('pillar', BX(84, 1.0, 0.3), 0, 0.5, s * 6.4);
    // 停靠车厢 ×2（大掩体，车窗 emission）
    for (const tx of [-18, 14]) {
      solid(tx, s * 10.6, 17, 3.0, 3.4);
      put('train', BX(17, 3.4, 3.0), tx, 1.7, s * 10.6);
      put('trainWin', BX(15, 1.0, 0.1), tx, 2.3, s * 10.6 + s * 1.55);
    }
  }

  // 立柱阵列（z=±4.8，每 12m；视线打断 + 贴柱走位）
  for (let i = -3; i <= 3; i++) {
    for (const s of [1, -1]) {
      solid(i * 12, s * 4.8, 1.0, 1.0, 5);
      put('pillar', BX(1.0, 5, 1.0), i * 12, 2.5, s * 4.8);
    }
  }

  // 站厅元素：长椅 / 闸机 / 售票亭 / 站牌灯箱
  for (const [bx, s] of [[-8, 1], [-8, -1], [9, 1], [9, -1]]) {
    solid(bx, s * 5.6, 2.2, 0.6, 0.8);
    put('bench', BX(2.2, 0.8, 0.6), bx, 0.4, s * 5.6);
  }
  for (const gx of [-3, -1.2, 1.2, 3]) {
    put('dark', BX(0.5, 1.1, 0.12), gx, 0.55, 0); // 闸机（装饰，不设碰撞避免堵中路）
  }
  solid(26, -3.4, 1.6, 1.6, 2.2);
  put('bench', BX(1.6, 2.2, 1.6), 26, 1.1, -3.4); // 售票亭
  put('sign', BX(4.2, 0.5, 0.1), 0, 3.4, 6.1); // 站牌灯箱
  put('sign', BX(4.2, 0.5, 0.1), -26, 3.4, -6.1);

  // 荧光灯带 + 频闪
  const flickerAt = [];
  for (let i = -3; i <= 3; i++) {
    put('lamp', BX(2.6, 0.08, 0.5), i * 12, 5.0, 0);
    lampSpots.push(new THREE.Vector3(i * 12, 4.8, 0));
    if (i === -1 || i === 2) flickerAt.push(i);
  }
  anim.push((dt, t) => {
    void dt;
    const f = 0.8 + Math.sin(t * 31) * 0.2 * (Math.sin(t * 2.7) > 0.7 ? 1 : 0.08);
    M.lamp.color.setRGB(0.75 * f + 0.2, 0.85 * f + 0.15, 1.0 * f);
  });

  // 出生点（西 BL / 东 GR，隧道口方向）
  const spawns = { BL: [], GR: [] };
  for (let i = 0; i < 10; i++) {
    const zz = -5 + (i % 5) * 2.6, xx = -39 + Math.floor(i / 5) * 2.4;
    spawns.BL.push({ x: xx, z: zz, yaw: -Math.PI / 2 });
    spawns.GR.push({ x: -xx, z: -zz, yaw: Math.PI / 2 });
  }

  for (const key of Object.keys(batch)) {
    const b = batch[key];
    b.mesh.geometry = mergeGeometries(b.geos, false);
    b.mesh.geometry.computeBoundingSphere();
  }

  return {
    spawns, lampSpots, funnelTop: new THREE.Vector3(0, 6, 0), meshes, materials: {},
    update(dt, t) { for (const f of anim) f(dt, t); },
  };
}

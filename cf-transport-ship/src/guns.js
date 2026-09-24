// 枪械模型：程序化构建。局部坐标：枪口朝 -Z，上 +Y，右 +X，原点在握把上方
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, normalFromHeight } from './textures.js';

let M = null;
function wearTextures() {
  const S = 256;
  const n = fbm(S, S, 8, 8, 5, 4242);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 150 + n[i] * 105;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const rough = new THREE.CanvasTexture(c); rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  const nrm = new THREE.CanvasTexture(normalFromHeight(n, S, S, 1.2)); nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  // 木纹
  const wc = document.createElement('canvas'); wc.width = wc.height = 256;
  const wx = wc.getContext('2d');
  const g = fbm(256, 256, 1, 24, 4, 777);
  const wi = wx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 0.65 + g[i] * 0.55;
    wi.data[i * 4] = 120 * v; wi.data[i * 4 + 1] = 62 * v; wi.data[i * 4 + 2] = 30 * v; wi.data[i * 4 + 3] = 255;
  }
  wx.putImageData(wi, 0, 0);
  const wood = new THREE.CanvasTexture(wc); wood.colorSpace = THREE.SRGBColorSpace; wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  return { rough, nrm, wood };
}

export function gunMaterials() {
  if (M) return M;
  const w = wearTextures();
  const mk = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, roughnessMap: w.rough, normalMap: w.nrm, normalScale: new THREE.Vector2(0.3, 0.3), ...extra });
  M = {
    metal: mk(0x2b2d30, 0.42, 0.85),
    black: mk(0x16171a, 0.6, 0.35),
    steel: mk(0x8e939a, 0.28, 0.95),
    wood: new THREE.MeshStandardMaterial({ map: w.wood, roughness: 0.55, metalness: 0.05, normalMap: w.nrm, normalScale: new THREE.Vector2(0.4, 0.4) }),
    bakelite: mk(0x6a2e14, 0.45, 0.1),
    olive: mk(0x4d5638, 0.62, 0.2),
    tan: mk(0x8f7a55, 0.6, 0.15),
    rubber: mk(0x121212, 0.85, 0.0),
    brass: mk(0xc8a04a, 0.3, 1.0),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.05, metalness: 0.9, emissive: 0x051018 }),
    blade: mk(0xc9ced4, 0.18, 1.0),
    red: mk(0x8a1a14, 0.5, 0.2),
  };
  return M;
}

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (name) m.name = name;
  parent.add(m);
  return m;
}
const RB = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CZ = (r, len, seg = 14, r2) => { const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg); g.rotateX(Math.PI / 2); return g; };
const CX = (r, len, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };
const CY = (r, len, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg);
function anchor(g, name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); g.add(o); return o; }

function curvedMag(g, mat, segs, x0, y0, z0, w, segH, segD, curve) {
  const mag = new THREE.Group(); mag.name = 'mag';
  mag.position.set(x0, y0, z0);
  let y = 0, z = 0, a = 0;
  for (let i = 0; i < segs; i++) {
    const m = part(mag, RB(w, segH + 0.004, segD, 0.003), mat, 0, y - segH / 2, z);
    m.rotation.x = -a;
    y -= Math.cos(a) * segH; z -= Math.sin(a) * segH;
    a += curve;
  }
  part(mag, RB(w + 0.004, 0.012, segD + 0.006, 0.003), mat, 0, y - 0.004, z, -a + curve);
  g.add(mag);
  return mag;
}

const builders = {
  ak47(m) {
    const g = new THREE.Group();
    part(g, RB(0.046, 0.058, 0.25), m.metal, 0, 0.035, -0.05);
    part(g, RB(0.043, 0.022, 0.21, 0.008), m.metal, 0, 0.07, -0.03);
    part(g, BX(0.03, 0.02, 0.05), m.metal, 0, 0.08, -0.175);
    part(g, RB(0.052, 0.046, 0.2, 0.01), m.wood, 0, 0.022, -0.275);
    part(g, CZ(0.019, 0.17), m.wood, 0, 0.066, -0.26);
    part(g, CZ(0.0085, 0.3), m.metal, 0, 0.042, -0.47);
    part(g, CZ(0.006, 0.26), m.metal, 0, 0.066, -0.43);
    part(g, BX(0.02, 0.038, 0.022), m.metal, 0, 0.066, -0.55);
    part(g, BX(0.004, 0.02, 0.004), m.metal, 0, 0.093, -0.55);
    part(g, CZ(0.013, 0.05), m.metal, 0, 0.042, -0.63);
    part(g, BX(0.03, 0.012, 0.03), m.metal, 0, 0.018, -0.39);
    curvedMag(g, m.bakelite, 5, 0, 0.005, -0.1, 0.03, 0.045, 0.07, 0.11);
    part(g, RB(0.03, 0.1, 0.042, 0.008), m.bakelite, 0, -0.045, 0.035, 0.32);
    part(g, BX(0.006, 0.006, 0.06), m.metal, 0, -0.012, -0.015);
    part(g, BX(0.004, 0.03, 0.004), m.metal, 0, -0.018, -0.03);
    // 木托
    const st = part(g, RB(0.042, 0.068, 0.27, 0.012), m.wood, 0, 0.004, 0.2, -0.1);
    part(st, BX(0.044, 0.1, 0.012), m.metal, 0, -0.012, 0.135);
    const bolt = part(g, CX(0.006, 0.03), m.steel, 0.034, 0.06, -0.08, 0, 0, 0, 'bolt');
    void bolt;
    anchor(g, 'grip', 0, -0.035, 0.03);
    anchor(g, 'fore', 0, 0.0, -0.29);
    anchor(g, 'muzzle', 0, 0.042, -0.66);
    anchor(g, 'eject', 0.03, 0.068, -0.04);
    anchor(g, 'magwell', 0, -0.02, -0.12);
    return g;
  },
  m4a1(m) {
    const g = new THREE.Group();
    part(g, RB(0.042, 0.05, 0.23), m.black, 0, 0.05, -0.04);
    part(g, BX(0.022, 0.01, 0.22), m.metal, 0, 0.08, -0.05);
    for (let i = 0; i < 11; i++) part(g, BX(0.026, 0.004, 0.008), m.metal, 0, 0.087, -0.15 + i * 0.02);
    part(g, RB(0.03, 0.03, 0.045), m.black, 0, 0.1, 0.03); // 后准星
    part(g, BX(0.004, 0.012, 0.004), m.metal, 0, 0.12, 0.035);
    part(g, RB(0.036, 0.05, 0.17), m.black, 0, 0.005, -0.02);
    part(g, RB(0.036, 0.05, 0.06), m.black, 0, -0.03, -0.085);
    part(g, CZ(0.026, 0.21, 12), m.black, 0, 0.046, -0.28);
    for (let i = 0; i < 6; i++) part(g, CZ(0.0265, 0.006, 12), m.metal, 0, 0.046, -0.2 - i * 0.032);
    part(g, CZ(0.008, 0.22), m.metal, 0, 0.046, -0.48);
    part(g, BX(0.018, 0.055, 0.018), m.black, 0, 0.068, -0.41); // 三角准星座
    part(g, BX(0.004, 0.02, 0.004), m.metal, 0, 0.105, -0.41);
    part(g, CZ(0.011, 0.05, 8), m.metal, 0, 0.046, -0.6);
    curvedMag(g, m.metal, 4, 0, -0.04, -0.085, 0.028, 0.045, 0.062, 0.06);
    part(g, RB(0.028, 0.09, 0.036, 0.007), m.black, 0, -0.04, 0.035, 0.38);
    part(g, CZ(0.016, 0.17), m.black, 0, 0.046, 0.145);
    part(g, RB(0.042, 0.075, 0.1, 0.01), m.black, 0, 0.03, 0.235);
    part(g, BX(0.03, 0.01, 0.02), m.black, 0, 0.078, 0.07, 0, 0, 0, 'bolt');
    part(g, BX(0.002, 0.03, 0.05), m.black, 0.022, 0.05, -0.04);
    anchor(g, 'grip', 0, -0.035, 0.035);
    anchor(g, 'fore', 0, 0.02, -0.28);
    anchor(g, 'muzzle', 0, 0.046, -0.63);
    anchor(g, 'eject', 0.026, 0.055, -0.03);
    anchor(g, 'magwell', 0, -0.06, -0.085);
    return g;
  },
  awm(m) {
    const g = new THREE.Group();
    part(g, RB(0.055, 0.075, 0.46, 0.012), m.olive, 0, 0.004, -0.02);
    part(g, RB(0.05, 0.05, 0.22, 0.012), m.olive, 0, -0.005, -0.33);
    part(g, CZ(0.022, 0.24), m.metal, 0, 0.05, -0.08);
    part(g, CZ(0.013, 0.56, 12), m.metal, 0, 0.05, -0.5);
    part(g, RB(0.036, 0.032, 0.07, 0.006), m.metal, 0, 0.05, -0.8);
    // 瞄准镜
    part(g, CZ(0.018, 0.3), m.black, 0, 0.118, -0.07);
    part(g, CZ(0.03, 0.09, 16, 0.019), m.black, 0, 0.118, -0.25);
    part(g, CZ(0.025, 0.06, 16), m.black, 0, 0.118, 0.1);
    part(g, CZ(0.027, 0.002, 16), m.glass, 0, 0.118, -0.296);
    part(g, CY(0.011, 0.035), m.black, 0, 0.145, -0.07);
    part(g, CX(0.011, 0.035), m.black, 0.028, 0.118, -0.07);
    for (const z of [-0.14, 0.0]) part(g, BX(0.03, 0.04, 0.022), m.metal, 0, 0.088, z);
    const bolt = new THREE.Group(); bolt.name = 'bolt'; bolt.position.set(0.024, 0.05, 0.02);
    part(bolt, CX(0.005, 0.045), m.steel, 0.02, 0, 0);
    part(bolt, new THREE.SphereGeometry(0.011, 10, 8), m.black, 0.045, -0.006, 0);
    g.add(bolt);
    const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -0.035, -0.07);
    part(mag, RB(0.034, 0.06, 0.085, 0.004), m.metal, 0, -0.03, 0);
    g.add(mag);
    part(g, RB(0.035, 0.1, 0.045, 0.01), m.olive, 0, -0.07, 0.08, 0.3);
    part(g, RB(0.05, 0.16, 0.045, 0.01), m.olive, 0, -0.02, 0.3);
    part(g, RB(0.04, 0.04, 0.18, 0.01), m.olive, 0, 0.05, 0.22);
    part(g, BX(0.052, 0.17, 0.014), m.rubber, 0, -0.02, 0.33);
    for (const x of [-0.012, 0.012]) part(g, CZ(0.004, 0.2), m.black, x, -0.035, -0.4);
    anchor(g, 'grip', 0, -0.05, 0.075);
    anchor(g, 'fore', 0, -0.02, -0.3);
    anchor(g, 'muzzle', 0, 0.05, -0.84);
    anchor(g, 'eject', 0.03, 0.06, -0.08);
    anchor(g, 'magwell', 0, -0.05, -0.07);
    anchor(g, 'scope', 0, 0.118, 0.13);
    return g;
  },
  mp5(m) {
    const g = new THREE.Group();
    part(g, RB(0.042, 0.06, 0.32, 0.014), m.black, 0, 0.042, -0.09);
    part(g, RB(0.046, 0.05, 0.15, 0.012), m.black, 0, 0.02, -0.31);
    part(g, CZ(0.009, 0.08), m.metal, 0, 0.046, -0.41);
    part(g, CZ(0.012, 0.02), m.metal, 0, 0.046, -0.45);
    part(g, CY(0.014, 0.024), m.black, 0, 0.085, 0.02);
    part(g, BX(0.024, 0.03, 0.02), m.black, 0, 0.083, -0.38);
    part(g, CZ(0.009, 0.14), m.black, -0.024, 0.066, -0.3);
    curvedMag(g, m.metal, 4, 0, 0.0, -0.13, 0.026, 0.042, 0.052, 0.14);
    part(g, RB(0.03, 0.095, 0.04, 0.008), m.black, 0, -0.04, 0.03, 0.3);
    for (const x of [-0.016, 0.016]) part(g, CZ(0.005, 0.2), m.metal, x, 0.035, 0.15);
    part(g, RB(0.045, 0.07, 0.018, 0.005), m.black, 0, 0.03, 0.25);
    part(g, BX(0.012, 0.012, 0.03), m.black, -0.02, 0.07, -0.2, 0, 0, 0, 'bolt');
    anchor(g, 'grip', 0, -0.035, 0.03);
    anchor(g, 'fore', 0, 0.0, -0.3);
    anchor(g, 'muzzle', 0, 0.046, -0.46);
    anchor(g, 'eject', 0.025, 0.055, -0.07);
    anchor(g, 'magwell', 0, -0.02, -0.13);
    return g;
  },
  deagle(m) {
    const g = new THREE.Group();
    const slide = new THREE.Group(); slide.name = 'slide'; g.add(slide);
    part(slide, RB(0.032, 0.042, 0.255, 0.006), m.steel, 0, 0.062, -0.075);
    part(slide, BX(0.012, 0.006, 0.23), m.metal, 0, 0.086, -0.075);
    part(slide, BX(0.004, 0.01, 0.006), m.metal, 0, 0.094, -0.19);
    for (let i = 0; i < 6; i++) part(slide, BX(0.034, 0.03, 0.003), m.metal, 0, 0.062, 0.02 + i * 0.008);
    part(g, RB(0.03, 0.032, 0.18, 0.005), m.metal, 0, 0.026, -0.05);
    part(g, RB(0.034, 0.115, 0.055, 0.012), m.rubber, 0, -0.04, 0.025, 0.24);
    part(g, BX(0.006, 0.006, 0.07), m.metal, 0, -0.003, -0.035);
    part(g, BX(0.006, 0.03, 0.006), m.metal, 0, -0.018, -0.07);
    part(g, BX(0.008, 0.02, 0.012), m.metal, 0, 0.075, 0.06);
    const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -0.03, 0.02); mag.rotation.x = 0.24;
    part(mag, BX(0.022, 0.1, 0.04), m.metal, 0, -0.04, 0); g.add(mag);
    anchor(g, 'grip', 0, -0.04, 0.03);
    anchor(g, 'fore', -0.02, -0.05, 0.02);
    anchor(g, 'muzzle', 0, 0.062, -0.21);
    anchor(g, 'eject', 0.02, 0.07, -0.03);
    anchor(g, 'magwell', 0, -0.1, 0.04);
    return g;
  },
  knife(m) {
    const g = new THREE.Group();
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.014); sh.lineTo(0.15, -0.012); sh.quadraticCurveTo(0.19, -0.008, 0.2, 0.012);
    sh.lineTo(0.13, 0.016); sh.lineTo(0.12, 0.012); sh.lineTo(0.03, 0.016); sh.lineTo(0, 0.016); sh.closePath();
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.002, bevelSegments: 1 });
    bg.translate(0, 0, -0.002); bg.rotateY(Math.PI / 2);
    part(g, bg, m.blade, 0, 0.0, -0.035);
    part(g, RB(0.018, 0.05, 0.012, 0.003), m.metal, 0, 0.0, -0.03);
    part(g, RB(0.024, 0.03, 0.11, 0.01), m.rubber, 0, 0.0, 0.03);
    for (let i = 0; i < 4; i++) part(g, BX(0.026, 0.032, 0.004), m.black, 0, 0, -0.005 + i * 0.022);
    part(g, RB(0.026, 0.032, 0.018, 0.006), m.metal, 0, 0, 0.09);
    anchor(g, 'grip', 0, 0, 0.03);
    anchor(g, 'muzzle', 0, 0, -0.23);
    return g;
  },
  claw(m) {
    // 变异者利爪：掌板 + 三片扇形骨刺
    const g = new THREE.Group();
    part(g, RB(0.09, 0.03, 0.11, 0.01), m.rubber, 0, 0, 0.03);
    for (let i = 0; i < 3; i++) {
      const fan = (i - 1) * 0.026;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.008 + fan * 0.4); sh.lineTo(0.13, 0.004 + fan);
      sh.quadraticCurveTo(0.19, 0.002 + fan * 1.2, 0.24, fan * 1.6);
      sh.lineTo(0.12, -0.006 + fan * 0.6); sh.lineTo(0, -0.008);
      sh.closePath();
      const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.007, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.0012, bevelSegments: 1 });
      bg.translate(0, 0, -0.0035); bg.rotateY(Math.PI / 2);
      part(g, bg, m.blade, 0, 0.004, -0.05);
    }
    anchor(g, 'grip', 0, 0, 0.04);
    anchor(g, 'muzzle', 0, 0, -0.2);
    return g;
  },
  chainsaw(m) {
    // 复仇者电锯：机身 + 导板 + 锯齿
    const g = new THREE.Group();
    part(g, RB(0.075, 0.11, 0.24, 0.012), m.olive, 0, 0, 0.06);
    part(g, RB(0.08, 0.03, 0.06, 0.008), m.rubber, 0, -0.055, 0.13);
    part(g, CY(0.02, 0.016), m.black, 0.045, 0.02, 0.06, 0, 0, Math.PI / 2);
    part(g, RB(0.014, 0.055, 0.4, 0.004), m.metal, 0, 0.005, -0.24);
    part(g, RB(0.03, 0.026, 0.36, 0.003), m.blade, 0, 0.005, -0.26);
    for (let i = 0; i < 10; i++) part(g, BX(0.034, 0.008, 0.018), m.steel, 0, -0.006, -0.1 - i * 0.036);
    anchor(g, 'grip', 0, -0.02, 0.1);
    anchor(g, 'muzzle', 0, 0, -0.44);
    return g;
  },
  // ---- V2 扩充枪模（紧凑程序化造型，共用锚点） ----
  sticky(m) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshLambertMaterial({ color: 0x4a5a30 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.03, 10), new THREE.MeshLambertMaterial({ color: 0xc8b820 }));
    band.rotation.x = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), m.metal);
    cap.position.y = 0.09;
    g.add(ball, band, cap);
    anchor(g, 'grip', 0, -0.06, 0);
    return g;
  },
  m79shell(m) {
    const g = new THREE.Group();
    part(g, CZ(0.035, 0.1, 10), m.metal, 0, 0, 0);                       // 弹体
    part(g, CZ(0.036, 0.016, 10), m.dark, 0, 0, 0.04);                   // 收口环
    part(g, RB(0.05, 0.02, 0.05, 0.005), m.dark, 0, 0, -0.02);           // 弹带
    anchor(g, 'grip', 0, -0.05, 0);
    return g;
  },
  flash(m) {
    const g = new THREE.Group();
    part(g, CZ(0.045, 0.13), m.metal, 0, 0, 0);                          // 圆柱弹体
    part(g, CZ(0.046, 0.02), m.dark, 0, 0, -0.055);                      // 上箍带
    part(g, CZ(0.046, 0.02), m.dark, 0, 0, 0.055);                       // 下箍带
    part(g, CY(0.014, 0.03), m.metal, 0, 0.08, 0);                       // 引信帽
    part(g, BX(0.012, 0.024, 0.03), m.steel, 0, 0.1, 0.012);             // 保险片
    anchor(g, 'grip', 0, -0.05, 0);
    return g;
  },
  axe(m) {
    const g = new THREE.Group();
    part(g, RB(0.034, 0.72, 0.036, 0.012), m.wood, 0, 0, 0, 0, 0, 0);        // 柄
    part(g, RB(0.026, 0.16, 0.03, 0.008), m.wood, 0, 0.2, 0.02);             // 柄尾握段
    const head = part(g, RB(0.05, 0.14, 0.055, 0.012), m.steel, 0, 0.36, 0); // 斧头
    part(head, BX(0.012, 0.11, 0.16), m.steel, 0.028, 0, -0.03);             // 斧刃
    part(head, BX(0.014, 0.06, 0.04), m.metal, -0.03, 0, 0.01);              // 尾锤
    part(g, CZ(0.02, 0.045), m.metal, 0, 0.36, 0, 0, 0, Math.PI / 2);        // 固定箍
    anchor(g, 'grip', 0, -0.3, 0); anchor(g, 'muzzle', 0, 0.36, 0);
    return g;
  },
  famas(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.09, 0.42, 0.01), m.black, 0, 0, -0.03);          // 无托机身
    part(g, RB(0.03, 0.03, 0.3, 0.006), m.metal, 0, 0.055, -0.2);       // 提把瞄具
    part(g, BX(0.024, 0.24, 0.05), m.steel, 0, -0.02, -0.28);           // 枪管
    part(g, RB(0.03, 0.1, 0.05, 0.01), m.rubber, 0, -0.07, 0.1);        // 握把
    part(g, RB(0.028, 0.12, 0.06, 0.01), m.rubber, 0, -0.05, -0.02);    // 弹匣
    anchor(g, 'grip', 0, -0.05, 0.1); anchor(g, 'muzzle', 0, 0, -0.42);
    return g;
  },
  crossbow(m) {
    const g = new THREE.Group();
    part(g, RB(0.04, 0.07, 0.5, 0.012), m.dark, 0, 0, -0.05);           // 弩身
    part(g, RB(0.5, 0.035, 0.045, 0.01), m.metal, 0, 0.03, -0.16);      // 横弓
    part(g, BX(0.006, 0.006, 0.5), m.steel, 0, 0.03, -0.16);            // 弓弦
    part(g, RB(0.026, 0.16, 0.05, 0.01), m.rubber, 0, -0.06, 0.08);     // 握把
    part(g, RB(0.03, 0.045, 0.1, 0.008), m.dark, 0, 0.065, -0.08);      // 瞄具
    part(g, RB(0.034, 0.06, 0.18, 0.01), m.wood, 0, -0.015, 0.18);      // 托
    part(g, BX(0.012, 0.22, 0.014), m.steel, 0, 0.02, -0.1);            // 上膛箭
    anchor(g, 'grip', 0, -0.055, 0.08); anchor(g, 'muzzle', 0, 0.03, -0.32);
    return g;
  },
  flamer(m) {
    const g = new THREE.Group();
    part(g, CZ(0.05, 0.42, 12), m.dark, 0, 0.02, -0.16);                // 主喷管
    part(g, CZ(0.056, 0.05, 12), m.metal, 0, 0.02, -0.38);              // 喷口箍
    part(g, CZ(0.02, 0.14, 8), m.steel, 0, 0.05, -0.44);                // 点火嘴
    part(g, CZ(0.07, 0.3, 12), m.metal, 0.09, -0.05, 0.02, 0, 0, 0.12); // 侧挂燃料罐
    part(g, RB(0.04, 0.1, 0.05, 0.01), m.rubber, 0, -0.08, 0.06);       // 握把
    part(g, RB(0.045, 0.035, 0.12, 0.008), m.rubber, 0, -0.035, -0.16); // 前护木
    anchor(g, 'grip', 0, -0.07, 0.06); anchor(g, 'muzzle', 0, 0.02, -0.42);
    return g;
  },
  m79(m) {
    const g = new THREE.Group();
    part(g, CZ(0.045, 0.5, 12), m.dark, 0, 0.03, -0.18);                // 粗发射管
    part(g, CZ(0.05, 0.06, 12), m.black, 0, 0.03, -0.4);                // 管口箍
    part(g, RB(0.05, 0.09, 0.14, 0.01), m.black, 0, -0.02, 0.1);        // 机匣
    part(g, RB(0.03, 0.1, 0.05, 0.01), m.rubber, 0, -0.08, 0.1);        // 握把
    part(g, RB(0.05, 0.05, 0.12, 0.012), m.wood, 0, -0.045, -0.12);     // 护木
    part(g, RB(0.04, 0.09, 0.16, 0.014), m.wood, 0, 0.02, 0.24);        // 肩托
    part(g, BX(0.016, 0.03, 0.03), m.metal, 0, 0.075, -0.05);           // 准星
    anchor(g, 'grip', 0, -0.07, 0.1); anchor(g, 'muzzle', 0, 0.03, -0.44);
    return g;
  },
  qbz95(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.085, 0.4, 0.012), m.black, 0, 0, -0.02);         // 无托机匣
    part(g, RB(0.03, 0.022, 0.22, 0.008), m.dark, 0, 0.058, -0.1);      // 提把瞄具
    part(g, RB(0.028, 0.1, 0.05, 0.01), m.black, 0, -0.06, 0.05);       // 无托握把
    part(g, RB(0.03, 0.13, 0.055, 0.01), m.dark, 0, -0.05, 0.12);       // 后置弹匣
    part(g, BX(0.026, 0.24, 0.045), m.steel, 0, -0.005, -0.3);          // 枪管
    part(g, CZ(0.016, 0.1), m.metal, 0, 0.025, -0.48);                  // 消焰器
    anchor(g, 'grip', 0, -0.055, 0.05); anchor(g, 'muzzle', 0, 0.025, -0.54);
    return g;
  },
  xm8(m) {
    const g = new THREE.Group();
    part(g, RB(0.052, 0.085, 0.42, 0.016), m.olive, 0, 0, -0.02);       // 圆润机匣
    part(g, CZ(0.02, 0.06), m.dark, 0, 0.062, -0.02, Math.PI / 2, 0, 0);// 穿越提把
    part(g, BX(0.026, 0.25, 0.045), m.steel, 0, -0.005, -0.3);          // 枪管
    part(g, RB(0.028, 0.13, 0.052, 0.01), m.rubber, 0, -0.055, 0.0);    // 握把
    part(g, RB(0.03, 0.12, 0.05, 0.01), m.rubber, 0, -0.045, -0.08);    // 弹匣
    part(g, RB(0.04, 0.07, 0.18, 0.014), m.olive, 0, 0.005, 0.2);       // 枪托
    anchor(g, 'grip', 0, -0.05, 0.02); anchor(g, 'muzzle', 0, 0.02, -0.46);
    return g;
  },
  dualuzi(m) {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      part(g, RB(0.045, 0.075, 0.24, 0.01), m.black, sx * 0.05, 0, -0.04);      // 双机匣
      part(g, CZ(0.012, 0.07), m.metal, sx * 0.05, 0.028, -0.2);                // 双枪管
      part(g, RB(0.026, 0.14, 0.045, 0.008), m.dark, sx * 0.05, -0.09, -0.03);  // 双弹匣
    }
    part(g, RB(0.03, 0.09, 0.05, 0.01), m.rubber, 0, -0.055, 0.1);              // 中央握把
    anchor(g, 'grip', 0, -0.05, 0.09); anchor(g, 'muzzle', 0, 0.028, -0.26);
    return g;
  },
  shovel(m) {
    const g = new THREE.Group();
    part(g, RB(0.03, 0.62, 0.03, 0.012), m.metal, 0, 0, 0);                 // 锹柄
    part(g, RB(0.034, 0.1, 0.036, 0.012), m.wood, 0, -0.26, 0);             // 柄尾握套
    part(g, RB(0.11, 0.16, 0.016, 0.01), m.steel, 0, 0.36, 0);              // 锹头
    part(g, RB(0.09, 0.05, 0.02, 0.008), m.metal, 0, 0.27, 0);              // 连接颈
    anchor(g, 'grip', 0, -0.24, 0); anchor(g, 'muzzle', 0, 0.42, 0);
    return g;
  },
  ppsh(m) {
    const g = new THREE.Group();
    part(g, RB(0.042, 0.075, 0.3, 0.01), m.metal, 0, 0, -0.05);             // 机匣
    part(g, RB(0.034, 0.03, 0.22, 0.008), m.wood, 0, -0.005, -0.28);        // 上木护木
    part(g, CZ(0.011, 0.1), m.metal, 0, 0.02, -0.46);                       // 枪管
    part(g, RB(0.026, 0.05, 0.05, 0.008), m.dark, 0, 0.052, -0.06);         // 照门座
    part(g, RB(0.055, 0.12, 0.09, 0.014), m.steel, 0, -0.1, -0.02);         // 弹鼓
    part(g, RB(0.03, 0.11, 0.05, 0.01), m.wood, 0, -0.06, 0.1);             // 握把
    part(g, RB(0.035, 0.05, 0.14, 0.01), m.wood, 0, -0.02, 0.22);           // 枪托
    anchor(g, 'grip', 0, -0.06, 0.08); anchor(g, 'muzzle', 0, 0.02, -0.52);
    return g;
  },
  dualdeagle(m) {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      part(g, RB(0.03, 0.07, 0.13, 0.008), m.metal, sx * 0.045, 0, -0.01);   // 双套筒
      part(g, CZ(0.01, 0.06), m.steel, sx * 0.045, 0.02, -0.1);              // 双枪管
      part(g, RB(0.026, 0.1, 0.042, 0.008), m.rubber, sx * 0.045, -0.065, 0.02); // 双握把
    }
    part(g, RB(0.02, 0.02, 0.09, 0.006), m.dark, 0, 0.045, -0.02);           // 连接桥
    anchor(g, 'grip', 0, -0.06, 0.05); anchor(g, 'muzzle', 0, 0.02, -0.16);
    return g;
  },
  crowbar(m) {
    const g = new THREE.Group();
    part(g, RB(0.03, 0.5, 0.032, 0.012), m.metal, 0, 0, 0);             // 主杆
    part(g, RB(0.032, 0.12, 0.034, 0.01), m.metal, 0, 0.24, 0.015, 0.5);// 弯钩端
    part(g, RB(0.034, 0.06, 0.05, 0.01), m.steel, 0, 0.27, 0.04);       // 撬爪
    part(g, RB(0.034, 0.1, 0.036, 0.012), m.rubber, 0, -0.2, 0);        // 握把套
    anchor(g, 'grip', 0, -0.22, 0); anchor(g, 'muzzle', 0, 0.27, 0);
    return g;
  },
  scarl(m) {
    const g = new THREE.Group();
    part(g, RB(0.048, 0.082, 0.44, 0.012), m.olive, 0, 0, -0.03);       // 沙色机匣
    part(g, RB(0.03, 0.024, 0.26, 0.008), m.dark, 0, 0.06, -0.14);      // 顶部导轨
    part(g, BX(0.026, 0.26, 0.045), m.steel, 0, -0.01, -0.3);           // 枪管
    part(g, CZ(0.016, 0.1), m.metal, 0, 0.028, -0.5);                   // 消焰器
    part(g, RB(0.028, 0.12, 0.05, 0.01), m.rubber, 0, -0.06, 0.07);     // 握把
    part(g, RB(0.028, 0.14, 0.055, 0.01), m.rubber, 0, -0.05, -0.05);   // 弹匣
    part(g, RB(0.04, 0.075, 0.2, 0.012), m.olive, 0, 0.005, 0.19, -0.05); // 伸缩托
    anchor(g, 'grip', 0, -0.055, 0.08); anchor(g, 'muzzle', 0, 0.028, -0.56);
    return g;
  },
  m14ebr(m) {
    const g = new THREE.Group();
    part(g, RB(0.046, 0.082, 0.52, 0.012), m.black, 0, 0, -0.05);       // 机匣
    part(g, RB(0.028, 0.03, 0.34, 0.008), m.dark, 0, 0.058, -0.2);      // 战术导轨
    part(g, RB(0.034, 0.045, 0.09, 0.008), m.dark, 0, 0.085, -0.1);     // 瞄准镜
    part(g, BX(0.026, 0.28, 0.045), m.steel, 0, -0.005, -0.38);         // 枪管
    part(g, RB(0.028, 0.11, 0.05, 0.01), m.rubber, 0, -0.06, 0.09);     // 握把
    part(g, RB(0.03, 0.1, 0.06, 0.01), m.rubber, 0, -0.045, -0.06);     // 弹匣
    part(g, RB(0.038, 0.09, 0.24, 0.012), m.dark, 0, -0.005, 0.22);     // 枪托
    part(g, BX(0.016, 0.05, 0.03), m.metal, 0, -0.03, -0.28);           // 两脚架
    anchor(g, 'grip', 0, -0.055, 0.09); anchor(g, 'muzzle', 0, 0.005, -0.54);
    return g;
  },
  m3super(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.075, 0.48, 0.012), m.black, 0, 0, -0.04);        // 机匣
    part(g, CZ(0.024, 0.4, 10), m.steel, 0, 0.03, -0.28);               // 泵动枪管
    part(g, RB(0.042, 0.04, 0.14, 0.01), m.wood, 0, -0.02, -0.3);       // 护木泵
    part(g, RB(0.03, 0.1, 0.05, 0.01), m.rubber, 0, -0.06, 0.09);       // 握把
    part(g, RB(0.038, 0.075, 0.22, 0.012), m.wood, 0, -0.01, 0.2);      // 枪托
    anchor(g, 'grip', 0, -0.055, 0.09); anchor(g, 'muzzle', 0, 0.03, -0.5);
    return g;
  },
  mac10(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.08, 0.24, 0.012), m.black, 0, 0, -0.02);         // 方盒机匣
    part(g, CZ(0.014, 0.08), m.metal, 0, 0.03, -0.18);                  // 短枪管
    part(g, RB(0.032, 0.16, 0.05, 0.008), m.dark, 0, -0.09, -0.02);     // 垂直弹匣
    part(g, RB(0.026, 0.09, 0.05, 0.01), m.rubber, 0, -0.05, 0.08);     // 握把
    part(g, RB(0.026, 0.02, 0.12, 0.006), m.steel, 0, -0.015, 0.12);    // 折叠托杆
    anchor(g, 'grip', 0, -0.045, 0.06); anchor(g, 'muzzle', 0, 0.03, -0.24);
    return g;
  },
  aug(m) {
    const g = new THREE.Group();
    part(g, RB(0.052, 0.088, 0.44, 0.014), m.olive, 0, 0, -0.02);       // 无托机身（橄榄绿）
    part(g, RB(0.034, 0.026, 0.24, 0.008), m.dark, 0, 0.062, -0.16);    // 一体瞄具提把
    part(g, BX(0.026, 0.26, 0.05), m.steel, 0, -0.015, -0.3);           // 枪管护罩
    part(g, CZ(0.017, 0.12), m.metal, 0, 0.03, -0.48);                  // 枪管
    part(g, RB(0.028, 0.13, 0.055, 0.01), m.rubber, 0, -0.06, 0.06);    // 握把
    part(g, RB(0.03, 0.11, 0.05, 0.01), m.rubber, 0, -0.048, -0.06);    // 弹匣（AUG 透明匣）
    part(g, RB(0.04, 0.07, 0.2, 0.012), m.olive, 0, 0.005, 0.2, -0.06); // 枪托
    anchor(g, 'grip', 0, -0.055, 0.08); anchor(g, 'muzzle', 0, 0.03, -0.54);
    return g;
  },
  p90(m) {
    const g = new THREE.Group();
    part(g, RB(0.062, 0.09, 0.42, 0.02), m.black, 0, 0, -0.02);         // 扁圆机身
    part(g, RB(0.05, 0.03, 0.3, 0.01), m.dark, 0, 0.058, -0.08);        // 顶置 50 发弹匣
    part(g, RB(0.03, 0.06, 0.14, 0.01), m.dark, 0, 0.03, 0.16);         // 枪托颈
    part(g, CZ(0.014, 0.1), m.metal, 0, 0.035, -0.28);                  // 短枪管
    part(g, RB(0.028, 0.09, 0.05, 0.01), m.rubber, 0, -0.06, 0.04);     // 握把
    part(g, BX(0.02, 0.012, 0.1), m.metal, 0, 0.012, -0.24);            // 下导轨
    anchor(g, 'grip', 0, -0.05, 0.06); anchor(g, 'muzzle', 0, 0.035, -0.36);
    return g;
  },
  thompson(m) {
    const g = new THREE.Group();
    part(g, RB(0.045, 0.075, 0.4, 0.012), m.black, 0, 0, -0.02);
    part(g, new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), m.metal, 0, -0.05, 0.06, 0, 0, Math.PI / 2);
    part(g, BX(0.024, 0.26, 0.045), m.steel, 0, 0, -0.28);
    part(g, RB(0.03, 0.12, 0.05, 0.01), m.rubber, 0, -0.08, 0.08);
    part(g, RB(0.03, 0.05, 0.14, 0.01), m.rubber, 0, -0.03, -0.16);
    anchor(g, 'grip', 0, -0.06, 0.08); anchor(g, 'muzzle', 0, 0, -0.4);
    return g;
  },
  minigun(m) {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.06, 0.07, 0.3, 10), m.dark, 0, 0, 0.08, Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), m.metal, Math.cos(a) * 0.032, Math.sin(a) * 0.032, -0.22, Math.PI / 2, 0, 0);
    }
    part(g, RB(0.1, 0.12, 0.08, 0.01), m.rubber, 0, -0.08, 0.12);
    anchor(g, 'grip', 0, -0.06, 0.12); anchor(g, 'muzzle', 0, 0, -0.46);
    return g;
  },
  m60(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.085, 0.46, 0.012), m.black, 0, 0, -0.04);            // 机匣
    part(g, BX(0.026, 0.3, 0.05), m.steel, 0, 0.005, -0.34);                // 枪管
    part(g, RB(0.036, 0.05, 0.14, 0.01), m.dark, 0, 0.028, -0.3);           // 导气箍
    part(g, RB(0.032, 0.11, 0.05, 0.01), m.rubber, 0, -0.075, 0.08);        // 握把
    part(g, BX(0.05, 0.016, 0.16), m.metal, 0.045, -0.03, -0.05);           // 弹链盒
    part(g, RB(0.03, 0.07, 0.22, 0.012), m.rubber, 0, -0.02, 0.2);          // 枪托
    part(g, BX(0.018, 0.05, 0.02), m.metal, 0, -0.02, -0.18);               // 两脚架（折叠）
    anchor(g, 'grip', 0, -0.06, 0.08); anchor(g, 'muzzle', 0, 0.005, -0.5);
    return g;
  },
  spas(m) {
    const g = new THREE.Group();
    part(g, RB(0.05, 0.07, 0.5, 0.012), m.black, 0, 0, -0.05);
    part(g, new THREE.CylinderGeometry(0.022, 0.022, 0.44, 10), m.steel, 0, 0.035, -0.2, Math.PI / 2, 0, 0);
    part(g, RB(0.04, 0.035, 0.16, 0.01), m.rubber, 0, -0.055, -0.18);
    part(g, RB(0.032, 0.1, 0.05, 0.01), m.rubber, 0, -0.07, 0.1);
    anchor(g, 'grip', 0, -0.05, 0.1); anchor(g, 'muzzle', 0, 0, -0.44);
    return g;
  },
  g3sg1(m) {
    const g = new THREE.Group();
    part(g, RB(0.045, 0.08, 0.55, 0.012), m.black, 0, 0, -0.05);
    part(g, BX(0.024, 0.3, 0.045), m.steel, 0, 0.005, -0.36);
    part(g, new THREE.CylinderGeometry(0.026, 0.026, 0.14, 10), m.dark, 0, 0.07, -0.02, Math.PI / 2, 0, 0);
    part(g, RB(0.03, 0.06, 0.1, 0.008), m.dark, 0, 0.075, -0.14);
    part(g, RB(0.03, 0.11, 0.05, 0.01), m.rubber, 0, -0.08, 0.08);
    part(g, RB(0.035, 0.09, 0.16, 0.012), m.rubber, 0, -0.01, 0.16);
    anchor(g, 'grip', 0, -0.06, 0.09); anchor(g, 'muzzle', 0, 0, -0.54);
    return g;
  },
  m24(m) {
    const g = new THREE.Group();
    part(g, RB(0.042, 0.075, 0.52, 0.012), m.olive, 0, 0, -0.04);
    part(g, BX(0.022, 0.28, 0.04), m.steel, 0, 0.005, -0.34);
    part(g, new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10), m.dark, 0, 0.068, -0.03, Math.PI / 2, 0, 0);
    part(g, RB(0.028, 0.05, 0.1, 0.008), m.dark, 0, 0.072, -0.13);
    part(g, RB(0.03, 0.11, 0.05, 0.01), m.rubber, 0, -0.075, 0.08);
    anchor(g, 'grip', 0, -0.055, 0.09); anchor(g, 'muzzle', 0, 0, -0.52);
    return g;
  },
  usp(m) {
    const g = new THREE.Group();
    part(g, RB(0.032, 0.06, 0.2, 0.01), m.black, 0, 0, -0.02);
    part(g, RB(0.03, 0.1, 0.045, 0.008), m.dark, 0, -0.06, 0.02);
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), m.dark, 0, 0.005, -0.14, Math.PI / 2, 0, 0);
    anchor(g, 'grip', 0, -0.05, 0.03); anchor(g, 'muzzle', 0, 0, -0.17);
    return g;
  },
  r8(m) {
    const g = new THREE.Group();
    part(g, RB(0.034, 0.062, 0.16, 0.01), m.steel, 0, 0, -0.02);
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.055, 10), m.metal, 0, 0, -0.09, Math.PI / 2, 0, 0);
    part(g, BX(0.02, 0.22, 0.035), m.steel, 0, 0.005, -0.2);
    part(g, RB(0.032, 0.1, 0.05, 0.008), m.rubber, 0, -0.065, 0.03);
    anchor(g, 'grip', 0, -0.055, 0.04); anchor(g, 'muzzle', 0, 0, -0.28);
    return g;
  },
  molotov(m) {
    const g = new THREE.Group();
    const b = new THREE.SphereGeometry(0.036, 12, 10); b.scale(1, 1.5, 1);
    part(g, b, new THREE.MeshStandardMaterial({ color: 0xb46a1e, emissive: 0x502800, roughness: 0.35 }), 0, 0, 0);
    part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), m.metal, 0, 0.062, 0);
    part(g, BX(0.008, 0.09, 0.008), m.rubber, 0.012, 0.09, 0);
    anchor(g, 'grip', 0, 0, 0); anchor(g, 'muzzle', 0, 0, -0.05);
    return g;
  },
  frost(m) {
    const g = new THREE.Group();
    const b = new THREE.SphereGeometry(0.04, 14, 12);
    part(g, b, new THREE.MeshStandardMaterial({ color: 0x9adfff, emissive: 0x1a5a80, roughness: 0.25, metalness: 0.3 }), 0, 0, 0);
    part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), m.metal, 0, 0.055, 0);
    anchor(g, 'grip', 0, 0, 0); anchor(g, 'muzzle', 0, 0, -0.05);
    return g;
  },
  gas(m) {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.032, 0.032, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.5, metalness: 0.3 }), 0, 0, 0);
    part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), m.metal, 0, 0.06, 0);
    for (let i = 0; i < 4; i++) part(g, BX(0.004, 0.02, 0.004), m.dark, 0, 0.052, 0.02, 0, i * 1.57);
    anchor(g, 'grip', 0, 0, 0); anchor(g, 'muzzle', 0, 0, -0.06);
    return g;
  },
  he(m) {
    const g = new THREE.Group();
    const body = new THREE.SphereGeometry(0.034, 16, 12); body.scale(1, 1.25, 1);
    part(g, body, m.olive, 0, 0, 0);
    part(g, CY(0.014, 0.03), m.metal, 0, 0.047, 0);
    const lever = part(g, BX(0.012, 0.07, 0.006), m.metal, 0.0, 0.03, 0.03, -0.35, 0, 0, 'lever');
    void lever;
    const pin = part(g, new THREE.TorusGeometry(0.012, 0.0022, 6, 14), m.steel, 0.022, 0.055, 0, 0, Math.PI / 2, 0, 'pin');
    void pin;
    part(g, BX(0.07, 0.012, 0.004), m.tan, 0, -0.005, 0.034);
    anchor(g, 'grip', 0, 0, 0.0);
    anchor(g, 'muzzle', 0, 0, -0.04);
    return g;
  },
};

export function buildGun(id) {
  const m = gunMaterials();
  const g = builders[id](m);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

// 第三人称：合并为单个网格（按材质分组）
const merged = {};
export function buildGunMerged(id) {
  if (!merged[id]) {
    const g = buildGun(id);
    g.updateMatrixWorld(true);
    const groups = new Map();
    g.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const keep = new THREE.BufferGeometry();
      keep.setAttribute('position', geo.attributes.position);
      keep.setAttribute('normal', geo.attributes.normal);
      keep.setAttribute('uv', geo.attributes.uv || new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (geo.index) keep.setIndex(geo.index);
      const k = o.material.uuid;
      if (!groups.has(k)) groups.set(k, { mat: o.material, geos: [] });
      groups.get(k).geos.push(keep.index ? keep.toNonIndexed() : keep);
    });
    const mats = [], geos = [];
    for (const { mat, geos: gs } of groups.values()) { mats.push(mat); geos.push(mergeGeometries(gs, false)); }
    const all = mergeGeometries(geos, true);
    const anchors = {};
    g.traverse((o) => { if (!o.isMesh && o.name && o !== g) anchors[o.name] = o.getWorldPosition(new THREE.Vector3()); });
    merged[id] = { geo: all, mats, anchors };
  }
  const d = merged[id];
  const mesh = new THREE.Mesh(d.geo, d.mats);
  mesh.castShadow = true;
  mesh.userData.anchors = d.anchors;
  return mesh;
}

// 调试钩子：定位 NaN 几何来源
if (typeof window !== 'undefined') window.__debugGuns = { buildGun, buildGunMerged, WEAPON_IDS: Object.keys(builders) };

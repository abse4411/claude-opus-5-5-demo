// 武器数据（参考穿越火线手感：步枪首发精准，连射上跳后左右摆动；狙击枪开镜才准）
// knock: 命中击退冲量(m/s)；stagger: 命中暂缓时长(s)——WOZ 打击反馈
export const WEAPONS = {
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 0, type: 'rifle', auto: true,
    dmg: 36, headMul: 4.0, limbMul: 0.78, rpm: 600, mag: 30, reserve: 90, reload: 2.45, draw: 0.85,
    speed: 0.93, range: 220, falloff: 0.985, pen: 1.2, armorPen: 0.78, knock: 2.2, stagger: 0.12,
    spread: { base: 0.0028, move: 0.045, air: 0.16, crouch: 0.6, perShot: 0.0055, max: 0.05, recover: 7 },
    recoil: { up: 0.0105, upMax: 0.11, side: 0.0062, sideStart: 5, recover: 6.5 },
    sound: 'ak47', hudName: 'AK-47',
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1', slot: 0, type: 'rifle', auto: true,
    dmg: 32, headMul: 4.0, limbMul: 0.8, rpm: 700, mag: 30, reserve: 90, reload: 2.3, draw: 0.8,
    speed: 0.95, range: 220, falloff: 0.985, pen: 1.0, armorPen: 0.72, knock: 2.0, stagger: 0.1,
    spread: { base: 0.0024, move: 0.04, air: 0.15, crouch: 0.6, perShot: 0.0044, max: 0.042, recover: 8 },
    recoil: { up: 0.0082, upMax: 0.085, side: 0.0048, sideStart: 6, recover: 7 },
    sound: 'm4a1', hudName: 'M4A1',
  },
  awm: {
    id: 'awm', name: 'AWM', slot: 0, type: 'sniper', auto: false,
    dmg: 118, headMul: 2.2, limbMul: 0.82, rpm: 41, mag: 5, reserve: 20, reload: 3.5, draw: 1.1,
    speed: 0.82, range: 400, falloff: 0.998, pen: 2.6, armorPen: 0.95, bolt: 1.35, knock: 7.5, stagger: 0.45,
    spread: { base: 0.06, scoped: 0.0004, move: 0.09, air: 0.22, crouch: 0.85, perShot: 0, max: 0.2, recover: 3 },
    recoil: { up: 0.035, upMax: 0.035, side: 0.004, sideStart: 0, recover: 4 },
    zoom: [30, 11], sound: 'awm', hudName: 'AWM',
  },
  mp5: {
    id: 'mp5', name: 'MP5', slot: 0, type: 'smg', auto: true,
    dmg: 25, headMul: 3.6, limbMul: 0.85, rpm: 800, mag: 30, reserve: 120, reload: 2.1, draw: 0.6,
    speed: 1.0, range: 120, falloff: 0.97, pen: 0.6, armorPen: 0.6, knock: 1.6, stagger: 0.08,
    spread: { base: 0.004, move: 0.022, air: 0.12, crouch: 0.7, perShot: 0.0035, max: 0.04, recover: 9 },
    recoil: { up: 0.0058, upMax: 0.06, side: 0.004, sideStart: 5, recover: 8 },
    sound: 'mp5', hudName: 'MP5',
  },
  deagle: {
    id: 'deagle', name: '沙漠之鹰', slot: 1, type: 'pistol', auto: false,
    dmg: 54, headMul: 3.8, limbMul: 0.75, rpm: 260, mag: 7, reserve: 35, reload: 2.0, draw: 0.55,
    speed: 1.0, range: 150, falloff: 0.98, pen: 1.0, armorPen: 0.8, knock: 3.2, stagger: 0.2,
    spread: { base: 0.004, move: 0.05, air: 0.18, crouch: 0.7, perShot: 0.028, max: 0.07, recover: 5 },
    recoil: { up: 0.03, upMax: 0.09, side: 0.008, sideStart: 1, recover: 5 },
    sound: 'deagle', hudName: 'DESERT EAGLE',
  },
  knife: {
    id: 'knife', name: '军刀', slot: 2, type: 'melee', auto: true,
    dmgLight: 52, dmgHeavy: 100, rangeLight: 1.9, rangeHeavy: 1.6, rateLight: 0.42, rateHeavy: 1.05, draw: 0.4,
    speed: 1.08, sound: 'knife', hudName: 'KNIFE', knock: 3.5, stagger: 0.18, mag: 0, reserve: 0,
  },
  claw: {
    id: 'claw', name: '利爪', slot: 2, type: 'melee', auto: true,
    dmgLight: 40, dmgHeavy: 75, rangeLight: 2.0, rangeHeavy: 1.7, rateLight: 0.55, rateHeavy: 1.0, draw: 0.3,
    speed: 1.0, sound: 'knife', hudName: 'CLAW', knock: 4.0, stagger: 0.2, mag: 0, reserve: 0,
  },
  chainsaw: {
    id: 'chainsaw', name: '电锯', slot: 2, type: 'melee', auto: true, continuous: true,
    dmgLight: 60, dmgHeavy: 9999, rangeLight: 2.2, rangeHeavy: 1.9, rateLight: 0.12, rateHeavy: 1.2, draw: 0.6,
    speed: 1.02, sound: 'knife', hudName: 'CHAINSAW', knock: 0.6, stagger: 0.1, mag: 0, reserve: 0,
  },

  // ---- V2 扩充（FAMAS/G3SG1/M24 为调研确认的原作武器；霰弹枪对应原作"防守必备"）----
  famas: {
    id: 'famas', name: 'FAMAS', slot: 0, type: 'rifle', auto: true,
    dmg: 30, headMul: 4.0, limbMul: 0.8, rpm: 1000, mag: 25, reserve: 75, reload: 2.3, draw: 0.8,
    speed: 0.96, range: 200, falloff: 0.985, pen: 1.0, armorPen: 0.74, knock: 1.8, stagger: 0.1,
    spread: { base: 0.003, move: 0.038, air: 0.14, crouch: 0.6, perShot: 0.004, max: 0.038, recover: 9 },
    recoil: { up: 0.007, upMax: 0.07, side: 0.0045, sideStart: 6, recover: 8 },
    sound: 'ak47', hudName: 'FAMAS',
  },
  thompson: {
    id: 'thompson', name: '汤普森', slot: 0, type: 'smg', auto: true,
    dmg: 26, headMul: 3.6, limbMul: 0.85, rpm: 780, mag: 50, reserve: 150, reload: 2.6, draw: 0.65,
    speed: 1.0, range: 110, falloff: 0.965, pen: 0.55, armorPen: 0.58, knock: 1.4, stagger: 0.07,
    spread: { base: 0.0045, move: 0.024, air: 0.13, crouch: 0.7, perShot: 0.003, max: 0.045, recover: 9 },
    recoil: { up: 0.005, upMax: 0.05, side: 0.0042, sideStart: 5, recover: 9 },
    sound: 'mp5', hudName: 'THOMPSON',
  },
  minigun: {
    id: 'minigun', name: '加特林', slot: 0, type: 'rifle', auto: true,
    dmg: 21, headMul: 3.0, limbMul: 0.85, rpm: 1200, mag: 100, reserve: 200, reload: 5.5, draw: 1.4,
    speed: 0.72, range: 150, falloff: 0.97, pen: 0.9, armorPen: 0.62, knock: 1.3, stagger: 0.06,
    spread: { base: 0.011, move: 0.03, air: 0.2, crouch: 0.8, perShot: 0.0016, max: 0.06, recover: 6 },
    recoil: { up: 0.0035, upMax: 0.03, side: 0.0035, sideStart: 4, recover: 7 },
    sound: 'ak47', hudName: 'MINIGUN',
  },
  spas: {
    id: 'spas', name: 'SPAS-12', slot: 0, type: 'shotgun', auto: false,
    dmg: 11, pellets: 8, pelletSpread: 0.075, headMul: 2.2, limbMul: 0.9, rpm: 70, mag: 8, reserve: 32, reload: 3.4, draw: 1.0,
    speed: 0.9, range: 42, falloff: 0.9, pen: 0.3, armorPen: 0.5, knock: 0.9, stagger: 0.07,
    spread: { base: 0.012, move: 0.02, air: 0.1, crouch: 0.7, perShot: 0, max: 0.03, recover: 4 },
    recoil: { up: 0.045, upMax: 0.05, side: 0.006, sideStart: 0, recover: 5 },
    sound: 'deagle', hudName: 'SPAS-12',
  },
  g3sg1: {
    id: 'g3sg1', name: 'G3SG1', slot: 0, type: 'sniper', auto: true,
    dmg: 76, headMul: 2.6, limbMul: 0.85, rpm: 280, mag: 20, reserve: 60, reload: 3.6, draw: 1.1,
    speed: 0.8, range: 320, falloff: 0.995, pen: 2.2, armorPen: 0.92, knock: 6, stagger: 0.35,
    spread: { base: 0.05, scoped: 0.0012, move: 0.1, air: 0.24, crouch: 0.8, perShot: 0.004, max: 0.14, recover: 4 },
    recoil: { up: 0.03, upMax: 0.06, side: 0.005, sideStart: 0, recover: 4 },
    zoom: [30, 15], sound: 'awm', hudName: 'G3SG1',
  },
  m24: {
    id: 'm24', name: 'M24', slot: 0, type: 'sniper', auto: false,
    dmg: 100, headMul: 2.4, limbMul: 0.84, rpm: 50, mag: 6, reserve: 30, reload: 3.2, draw: 1.05,
    speed: 0.84, range: 360, falloff: 0.997, pen: 2.4, armorPen: 0.94, bolt: 1.25, knock: 6.5, stagger: 0.4,
    spread: { base: 0.055, scoped: 0.0006, move: 0.1, air: 0.24, crouch: 0.85, perShot: 0, max: 0.18, recover: 4 },
    recoil: { up: 0.033, upMax: 0.038, side: 0.004, sideStart: 0, recover: 4 },
    zoom: [30, 12], sound: 'awm', hudName: 'M24',
  },
  usp: {
    id: 'usp', name: 'USP', slot: 1, type: 'pistol', auto: false,
    dmg: 30, headMul: 3.8, limbMul: 0.75, rpm: 380, mag: 12, reserve: 48, reload: 2.0, draw: 0.5,
    speed: 1.0, range: 140, falloff: 0.98, pen: 0.8, armorPen: 0.66, knock: 1.7, stagger: 0.12,
    spread: { base: 0.0035, move: 0.045, air: 0.16, crouch: 0.7, perShot: 0.024, max: 0.06, recover: 5 },
    recoil: { up: 0.024, upMax: 0.06, side: 0.006, sideStart: 1, recover: 6 },
    sound: 'mp5', hudName: 'USP',
  },
  r8: {
    id: 'r8', name: 'R8 左轮', slot: 1, type: 'pistol', auto: false,
    dmg: 70, headMul: 3.4, limbMul: 0.75, rpm: 140, mag: 6, reserve: 24, reload: 3.0, draw: 0.6,
    speed: 0.98, range: 160, falloff: 0.985, pen: 1.6, armorPen: 0.88, knock: 4.5, stagger: 0.3,
    spread: { base: 0.004, move: 0.05, air: 0.18, crouch: 0.7, perShot: 0.03, max: 0.07, recover: 4 },
    recoil: { up: 0.04, upMax: 0.09, side: 0.008, sideStart: 1, recover: 5 },
    sound: 'deagle', hudName: 'R8 REVOLVER',
  },

  // ---- V18 扩充（WOZ 时代风格枪械补全）----
  aug: {
    id: 'aug', name: 'AUG A3', slot: 0, type: 'rifle', auto: true,
    dmg: 33, headMul: 4.0, limbMul: 0.8, rpm: 720, mag: 30, reserve: 90, reload: 2.4, draw: 0.75,
    speed: 0.97, range: 220, falloff: 0.988, pen: 1.05, armorPen: 0.76, knock: 1.9, stagger: 0.11,
    spread: { base: 0.0026, move: 0.034, air: 0.14, crouch: 0.6, perShot: 0.0038, max: 0.034, recover: 9 },
    recoil: { up: 0.006, upMax: 0.06, side: 0.004, sideStart: 5, recover: 8 },
    sound: 'ak47', hudName: 'AUG A3',
  },
  p90: {
    id: 'p90', name: 'P90', slot: 0, type: 'smg', auto: true,
    dmg: 24, headMul: 3.4, limbMul: 0.86, rpm: 900, mag: 50, reserve: 100, reload: 2.7, draw: 0.6,
    speed: 1.02, range: 110, falloff: 0.96, pen: 0.72, armorPen: 0.66, knock: 1.3, stagger: 0.07,
    spread: { base: 0.0042, move: 0.022, air: 0.12, crouch: 0.7, perShot: 0.0026, max: 0.04, recover: 10 },
    recoil: { up: 0.004, upMax: 0.05, side: 0.0035, sideStart: 4, recover: 9 },
    sound: 'mp5', hudName: 'P90',
  },
  m60: {
    id: 'm60', name: 'M60', slot: 0, type: 'rifle', auto: true,
    dmg: 38, headMul: 3.2, limbMul: 0.9, rpm: 550, mag: 100, reserve: 200, reload: 5.0, draw: 1.3,
    speed: 0.78, range: 180, falloff: 0.98, pen: 1.2, armorPen: 0.8, knock: 3.0, stagger: 0.22,
    spread: { base: 0.009, move: 0.032, air: 0.2, crouch: 0.7, perShot: 0.0018, max: 0.05, recover: 7 },
    recoil: { up: 0.006, upMax: 0.08, side: 0.007, sideStart: 6, recover: 7 },
    sound: 'ak47', hudName: 'M60',
  },

  // ---- V33（WOZ 时代枪械再扩充）----
  scarl: {
    id: 'scarl', name: 'SCAR-L', slot: 0, type: 'rifle', auto: true,
    dmg: 32, headMul: 3.9, limbMul: 0.82, rpm: 620, mag: 30, reserve: 90, reload: 2.4, draw: 0.75,
    speed: 0.97, range: 210, falloff: 0.987, pen: 1.05, armorPen: 0.78, knock: 2.0, stagger: 0.11,
    spread: { base: 0.0028, move: 0.034, air: 0.14, crouch: 0.6, perShot: 0.0037, max: 0.034, recover: 9 },
    recoil: { up: 0.0058, upMax: 0.06, side: 0.004, sideStart: 5, recover: 8 },
    sound: 'ak47', hudName: 'SCAR-L',
  },
  m14ebr: {
    id: 'm14ebr', name: 'M14EBR', slot: 0, type: 'rifle', auto: false,
    dmg: 52, headMul: 3.2, limbMul: 0.88, rpm: 260, mag: 20, reserve: 60, reload: 2.8, draw: 0.85,
    speed: 0.9, range: 280, falloff: 0.992, pen: 1.8, armorPen: 0.88, knock: 4.2, stagger: 0.28,
    spread: { base: 0.0018, move: 0.05, air: 0.2, crouch: 0.55, perShot: 0.008, max: 0.05, recover: 6 },
    recoil: { up: 0.018, upMax: 0.07, side: 0.006, sideStart: 3, recover: 7 },
    sound: 'awm', hudName: 'M14EBR',
  },
  m3super: {
    id: 'm3super', name: 'M3 Super90', slot: 0, type: 'shotgun', auto: false,
    dmg: 12, pellets: 8, pelletSpread: 0.065, headMul: 2.2, limbMul: 0.9, rpm: 90, mag: 8, reserve: 32, reload: 3.0, draw: 0.95,
    speed: 0.92, range: 40, falloff: 0.88, pen: 0.3, armorPen: 0.5, knock: 1.1, stagger: 0.09,
    spread: { base: 0.01, move: 0.022, air: 0.1, crouch: 0.7, perShot: 0, max: 0.03, recover: 5 },
    recoil: { up: 0.05, upMax: 0.055, side: 0.006, sideStart: 0, recover: 5 },
    sound: 'deagle', hudName: 'M3 SUPER 90',
  },
  mac10: {
    id: 'mac10', name: 'MAC-10', slot: 0, type: 'smg', auto: true,
    dmg: 21, headMul: 3.2, limbMul: 0.86, rpm: 1080, mag: 32, reserve: 96, reload: 2.2, draw: 0.55,
    speed: 1.04, range: 80, falloff: 0.94, pen: 0.55, armorPen: 0.5, knock: 1.1, stagger: 0.06,
    spread: { base: 0.006, move: 0.024, air: 0.12, crouch: 0.7, perShot: 0.0026, max: 0.055, recover: 8 },
    recoil: { up: 0.0038, upMax: 0.05, side: 0.005, sideStart: 4, recover: 8 },
    sound: 'mp5', hudName: 'MAC-10',
  },

  // ---- V34（枪械收尾 + 新近战）----
  qbz95: {
    id: 'qbz95', name: '95式', slot: 0, type: 'rifle', auto: true,
    dmg: 30, headMul: 4.0, limbMul: 0.8, rpm: 650, mag: 30, reserve: 90, reload: 2.3, draw: 0.7,
    speed: 0.99, range: 200, falloff: 0.986, pen: 1.0, armorPen: 0.72, knock: 1.8, stagger: 0.1,
    spread: { base: 0.003, move: 0.032, air: 0.14, crouch: 0.6, perShot: 0.0034, max: 0.034, recover: 9 },
    recoil: { up: 0.0052, upMax: 0.055, side: 0.0038, sideStart: 5, recover: 9 },
    sound: 'ak47', hudName: 'QBZ-95',
  },
  xm8: {
    id: 'xm8', name: 'XM8', slot: 0, type: 'rifle', auto: true,
    dmg: 29, headMul: 3.8, limbMul: 0.82, rpm: 700, mag: 30, reserve: 90, reload: 2.2, draw: 0.7,
    speed: 1.0, range: 190, falloff: 0.985, pen: 0.95, armorPen: 0.7, knock: 1.7, stagger: 0.1,
    spread: { base: 0.0032, move: 0.03, air: 0.13, crouch: 0.6, perShot: 0.0032, max: 0.036, recover: 10 },
    recoil: { up: 0.005, upMax: 0.05, side: 0.0036, sideStart: 5, recover: 9 },
    sound: 'mp5', hudName: 'XM8',
  },
  dualuzi: {
    id: 'dualuzi', name: '双持乌兹', slot: 0, type: 'smg', auto: true,
    dmg: 17, headMul: 3.0, limbMul: 0.86, rpm: 1200, mag: 64, reserve: 128, reload: 3.0, draw: 0.6,
    speed: 1.02, range: 75, falloff: 0.93, pen: 0.5, armorPen: 0.45, knock: 1.0, stagger: 0.05,
    spread: { base: 0.007, move: 0.026, air: 0.13, crouch: 0.75, perShot: 0.0024, max: 0.06, recover: 8 },
    recoil: { up: 0.0034, upMax: 0.05, side: 0.006, sideStart: 6, recover: 8 },
    sound: 'mp5', hudName: 'DUAL UZI',
  },
  crowbar: {
    id: 'crowbar', name: '撬棍', slot: 2, type: 'melee', auto: true,
    dmgLight: 60, dmgHeavy: 110, rangeLight: 2.0, rangeHeavy: 1.7, rateLight: 0.38, rateHeavy: 1.0, draw: 0.4,
    speed: 1.05, sound: 'knife', hudName: 'CROWBAR', knock: 5.0, stagger: 0.24, mag: 0, reserve: 0,
  },

  // ---- V40（榴弹发射器）----
  m79: {
    id: 'm79', name: 'M79 榴弹枪', slot: 0, type: 'launcher', auto: false,
    dmg: 1, rpm: 45, mag: 4, reserve: 8, reload: 3.2, draw: 0.9, speed: 0.88, sound: 'grenade', hudName: 'M79',
  },
  m79shell: {
    id: 'm79shell', name: '40mm 榴弹', slot: 3, type: 'grenade', auto: false,
    dmg: 150, radius: 6, fuse: 2.5, knock: 8, stagger: 0.5, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: '40MM', mag: 1, reserve: 0,
  },

  // ---- V20（近战/投掷扩展）----
  axe: {
    id: 'axe', name: '消防斧', slot: 2, type: 'melee', auto: true,
    dmgLight: 75, dmgHeavy: 140, rangeLight: 2.1, rangeHeavy: 1.8, rateLight: 0.62, rateHeavy: 1.3, draw: 0.5,
    speed: 0.94, sound: 'knife', hudName: 'FIRE AXE', knock: 6.5, stagger: 0.35, mag: 0, reserve: 0,
  },
  flash: {
    id: 'flash', name: '震撼弹', slot: 3, type: 'grenade', auto: false,
    dmg: 4, radius: 10, fuse: 1.6, blind: 2.4, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'FLASHBANG', mag: 1, reserve: 0,
  },
  sticky: {
    id: 'sticky', name: '黏性炸弹', slot: 3, type: 'grenade', auto: false,
    dmg: 160, radius: 4.5, fuse: 3.0, stickFuse: 1.1, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'STICKY BOMB', mag: 1, reserve: 0,
  },
  molotov: {
    id: 'molotov', name: '燃烧瓶', slot: 3, type: 'grenade', auto: false,
    dmg: 14, radius: 3.2, fuse: 1.8, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'MOLOTOV', mag: 1, reserve: 0,
  },
  frost: {
    id: 'frost', name: '冻结弹', slot: 3, type: 'grenade', auto: false,
    dmg: 6, radius: 4.6, fuse: 2.0, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'FROST GRENADE', mag: 1, reserve: 0,
  },
  gas: {
    id: 'gas', name: '毒气弹', slot: 3, type: 'grenade', auto: false,
    dmg: 9, radius: 3.6, fuse: 2.2, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'GAS GRENADE', mag: 1, reserve: 0,
  },
  he: {
    id: 'he', name: '手雷', slot: 3, type: 'grenade', auto: false,
    dmg: 108, radius: 7.2, fuse: 2.6, knock: 9, stagger: 0.5, count: 1, draw: 0.5, speed: 1.0, sound: 'grenade', hudName: 'HE GRENADE', mag: 1, reserve: 0,
  },
};

export const PRIMARIES = ['ak47', 'm4a1', 'awm', 'mp5', 'famas', 'thompson', 'minigun', 'spas', 'g3sg1', 'm24', 'aug', 'p90', 'm60', 'scarl', 'm14ebr', 'm3super', 'mac10', 'qbz95', 'xm8', 'dualuzi', 'm79'];
// V19：副武器三选（沙鹰默认；R8 左轮为原作风格高伤手炮）
export const SECONDARIES = ['deagle', 'usp', 'r8'];
// V45：近战 selectable（电锯为复仇者/变异者专属不在列）
export const MELEES = ['knife', 'axe', 'crowbar'];

export class WeaponState {
  constructor(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.nextFire = 0;
    this.reloadUntil = 0;
    this.shotsFired = 0;   // 本次连射计数
    this.spreadAcc = 0;    // 连射累积扩散
    this.lastShot = -10;
    this.boltUntil = 0;
  }
  get reloading() { return this.reloadUntil > 0; }
  canReload() {
    const d = this.def;
    return d.type !== 'melee' && d.type !== 'grenade' && this.mag < d.mag && this.reserve > 0 && !this.reloading;
  }
  finishReload() {
    const need = this.def.mag - this.mag, take = Math.min(need, this.reserve);
    this.mag += take; this.reserve -= take; this.reloadUntil = 0;
  }
  refill() { this.mag = this.def.mag; this.reserve = this.def.reserve; this.reloadUntil = 0; this.boltUntil = 0; }
}

// 当前散布（弧度，锥半角）
export function currentSpread(ws, st) {
  const s = ws.def.spread;
  if (!s) return 0;
  let v = s.base;
  if (ws.def.type === 'sniper') v = st.scoped && st.scopeReady ? s.scoped : s.base;
  const sp = st.speed || 0; // 水平速度 m/s
  v += s.move * Math.min(1, Math.max(0, (sp - 0.6) / 5.5));
  if (!st.onGround) v += s.air;
  v += ws.spreadAcc;
  if (st.crouch && st.onGround) v *= s.crouch;
  return Math.min(v, s.max + s.base + (st.onGround ? 0 : s.air));
}

// 后坐力：返回本发的 [pitch, yaw] 增量（弧度）
export function recoilKick(ws, rnd) {
  const r = ws.def.recoil;
  const n = ws.shotsFired;
  let up = r.up * (n < 3 ? 1.25 : 1) * (0.85 + rnd() * 0.3);
  let side = 0;
  if (n >= r.sideStart) {
    // 左右摆动（慢周期）+ 随机
    const phase = Math.sin(n * 0.55 + (ws.patternSeed || 0));
    side = r.side * (phase * 1.3 + (rnd() - 0.5) * 0.9);
  } else side = (rnd() - 0.5) * r.side * 0.4;
  return [up, side];
}

// 在锥内随机扰动方向（dir 已归一化，就地修改）
export function jitterDir(dir, spread, rnd) {
  if (spread <= 0) return dir;
  // 构造正交基
  const ax = Math.abs(dir.x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = dir.y * ax[2] - dir.z * ax[1], uy = dir.z * ax[0] - dir.x * ax[2], uz = dir.x * ax[1] - dir.y * ax[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = dir.y * uz - dir.z * uy, vy = dir.z * ux - dir.x * uz, vz = dir.x * uy - dir.y * ux;
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  dir.x += ux * ca + vx * sa; dir.y += uy * ca + vy * sa; dir.z += uz * ca + vz * sa;
  return dir.normalize();
}

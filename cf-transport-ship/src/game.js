// 对局主控
import * as THREE from 'three';
import { Renderer } from './render.js';
import { buildTextures } from './textures.js';
import { buildMap } from './map.js';
import { buildCityMap, buildPlazaMap, buildHarborMap } from './woz/map-city.js';
import { buildLabMap } from './woz/map-lab.js';
import { buildHospitalMap } from './woz/map-hospital.js';
import { buildSubwayMap } from './woz/map-subway.js';
import { Environment } from './env.js';
import { World, NavGrid } from './physics.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { WEAPONS, WeaponState, jitterDir } from './weapons.js';
import { buildGunMerged } from './guns.js';
import { Player } from './player.js';
import { Bot, BOT_NAMES } from './bots.js';
import { TouchControls } from './touch.js';
import { Zones } from './woz/zones.js';
import { WozManager } from './woz/integrate.js';
import { wozAudio } from './woz/audio.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'ULTRA KILL', 'RAMPAGE', 'UNSTOPPABLE', 'GODLIKE'];
const MULTI_CN = ['', '', '双杀', '三杀', '四杀', '五杀', '六杀！', '无人能挡', '超神'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();
const dir0 = { x: 0, z: 1 };

// 全部地图定义（含寻路网格边界）
const MAPS = {
  ship: { name: '运输船', build: buildMap, nav: [-36.2, -12.1, 36.2, 12.1] },
  city: { name: '死亡城市', build: buildCityMap, nav: [-36, -11.5, 36, 11.5] },
  lab: { name: '生化实验室', build: buildLabMap, nav: [-36, -11.5, 36, 11.5] },
  plaza: { name: '都会广场', build: buildPlazaMap, nav: [-36, -11.5, 36, 11.5] },
  harbor: { name: '雾港', build: buildHarborMap, nav: [-36, -11.5, 36, 11.5] },
  hospital: { name: '废弃医院', build: buildHospitalMap, nav: [-38.5, -13.5, 38.5, 13.5] },
  subway: { name: '地铁绝境', build: buildSubwayMap, nav: [-40.5, -12.5, 40.5, 12.5] },
};

export class Game {
  constructor() {
    this.time = 0; this.frame = 0;
    this.playing = false; this.paused = false; this.locked = false;
    this.actors = []; this.nades = []; this.timers = []; this.tags = [];
    this.score = { BL: 0, GR: 0 };
    this.audio = audio;
    this.woz = null;
    this.zones = new Zones(this);
    this.groundGuns = [];
    this.qs = new URLSearchParams(location.search);
  }
  async init() {
    this.hud = new HUD(this);
    this.opts = this.hud.opts;
    if (this.qs.get('q')) this.opts.quality = this.qs.get('q');
    if (this.qs.get('mode')) this.opts.mode = this.qs.get('mode');
    if (this.qs.get('map')) this.opts.map = this.qs.get('map');
    this.hud.show('loading');
    this.hud.loading(0.05, '初始化渲染器');
    await nextFrame();
    this.renderer = new Renderer(document.getElementById('c'), this.opts.quality);
    this.renderer.camera.fov = this.opts.fov;
    this.hud.loading(0.12, '生成集装箱 / 甲板 / 船体纹理');
    await nextFrame(); await nextFrame();
    this.T = buildTextures(this.opts.quality);
    this.hud.loading(0.55, '搭建运输船');
    await nextFrame();
    this.world = new World();
    this._builtMap = this.opts.map;
    const mapDef = MAPS[this.opts.map] || MAPS.ship;
    this.mapName = mapDef.name;
    document.querySelector('#radarWrap .lbl').textContent = mapDef.name;
    this.map = mapDef.build(this.renderer.scene, this.T, this.world);
    this.world.build(); // 重建空间哈希（船图内部已调，其余地图在此统一构建，否则无碰撞）
    this.applyFogOverride();
    this.hud.loading(0.68, '天空与海洋');
    await nextFrame();
    this.env = new Environment(this.renderer.renderer, this.renderer.scene, this.opts.quality);
    this.env.extraScenes = [this.renderer.vmScene];
    this.env.apply(this.opts.tod);
    this.fx = new Effects(this.renderer.scene, this.T, this.renderer.camera, this.opts.quality);
    this.fx.initAmbient(this.map.funnelTop);
    this.vm = new ViewModel(this.renderer.vmScene, this.T, this.opts.team);
    this.hud.loading(0.8, '计算寻路网格');
    await nextFrame();
    const nav = (MAPS[this._builtMap] || MAPS.ship).nav;
    this.nav = new NavGrid(this.world, nav[0], nav[1], nav[2], nav[3], 0.5, 0.42);
    this.hud.buildRadar(this.world);
    this.hud.loading(0.88, '武器图标 / 预编译着色器');
    await nextFrame();
    this.hud.setIcons(this.makeIcons());
    // 投掷卡片图标随武器图标一并生成（makeIcons 遍历 WEAPONS 全部键）
    this.lampLights();
    this.renderer.camera.position.set(-20, 12, 30); this.renderer.camera.lookAt(0, 2, 0);
    try { this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera); } catch (e) { /* 忽略 */ }
    this.hud.loading(1, '完成');
    await nextFrame();
    this.hud.show('menu');
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.touch = new TouchControls(this);
    this.touchMode = this.touch.enabled;
    this.last = performance.now();
    this.hitStopT = 0;             // 打击感顿帧（V31）：重击/击杀瞬间时间变慢
    this.slowMoT = 0; this.slowMoScale = 0.35; // 慢动作时刻（V32）
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    if (this.qs.has('autostart')) setTimeout(() => this.startMatch(), 300);
    window.__game = this;
  }
  applyFogOverride() {
    if (this.map?.fogDensity && this.renderer.scene.fog) this.renderer.scene.fog.density = this.map.fogDensity;
  }
  lampLights() {
    // 管道内的少量真实点光源（换图时先移除旧的）
    if (this._lamps) for (const l of this._lamps) this.renderer.scene.remove(l);
    this._lamps = [];
    for (const p of this.map.lampSpots.slice(0, this.opts.quality === 'low' ? 0 : 4)) {
      const l = new THREE.PointLight(0xffd9a0, 5, 9, 1.8);
      l.position.copy(p);
      this.renderer.scene.add(l);
      this._lamps.push(l);
    }
  }

  // 切换地图（V46 修复③：主菜单选图即时生效，无需刷新网页）
  ensureMap(key) {
    if (this._builtMap === key && this.map) return;
    const def = MAPS[key] || MAPS.ship;
    if (this.map) for (const m of this.map.meshes || []) this.renderer.scene.remove(m);
    this.world = new World();
    this.map = def.build(this.renderer.scene, this.T, this.world);
    this.world.build();
    this.mapName = def.name;
    this._builtMap = key;
    document.querySelector('#radarWrap .lbl').textContent = def.name;
    this.applyFogOverride();
    if (this.fx) this.fx.initAmbient(this.map.funnelTop);
    const nav = def.nav;
    this.nav = new NavGrid(this.world, nav[0], nav[1], nav[2], nav[3], 0.5, 0.42);
    this.hud.buildRadar(this.world);
    this.lampLights();
  }
  makeIcons() {
    const r = this.renderer.renderer;
    const W = 256, H = 96;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const scene = new THREE.Scene();
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    const out = {};
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const buf = new Uint8Array(W * H * 4);
    for (const id of Object.keys(WEAPONS)) {
      const m = buildGunMerged(id);
      scene.add(m);
      const box = new THREE.Box3().setFromObject(m);
      const cz = (box.min.z + box.max.z) / 2, cy = (box.min.y + box.max.y) / 2;
      const hw = (box.max.z - box.min.z) / 2 * 1.08, hh = (box.max.y - box.min.y) / 2 * 1.08;
      const ext = Math.max(hw, hh * W / H);
      cam.left = -ext; cam.right = ext; cam.top = ext * H / W; cam.bottom = -ext * H / W;
      cam.position.set(2, cy, cz); cam.lookAt(0, cy, cz); cam.updateProjectionMatrix();
      r.setRenderTarget(rt); r.clear(); r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
        img.data[d] = img.data[d + 1] = img.data[d + 2] = 245; img.data[d + 3] = buf[s + 3] > 10 ? 235 : 0;
      }
      ctx.putImageData(img, 0, 0);
      out[id] = c.toDataURL();
      scene.remove(m);
    }
    r.setRenderTarget(null); r.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    return out;
  }

  // ================= 流程 =================
  startMatch() {
    const o = this.opts;
    this.ensureMap(o.map); // 修复③：主菜单改选地图后开局即时切换（此前只在刷新页面时生效）
    if (o.mode && o.mode !== 'tdm') {
      if (!this.woz) this.woz = new WozManager(this);
      this.woz.startMatch();
      return;
    }
    audio.init(); audio.setVolumes({ master: o.vol }); audio.startAmbient(); audio.playUI('start');
    for (const a of this.actors) this.renderer.scene.remove(a.soldier.root);
    for (const t of this.tags) this.renderer.scene.remove(t.sprite);
    for (const n of this.nades) this.renderer.scene.remove(n.mesh);
    for (const gg of this.groundGuns) this.renderer.scene.remove(gg.mesh);
    this.groundGuns = [];
    this.actors = []; this.nades = []; this.tags = []; this.timers = [];
    this.score = { BL: 0, GR: 0 };
    this.goal = o.goal; this.timeLeft = 600;
    this.env.apply(o.tod); this.applyFogOverride();
    const my = o.team, other = my === 'BL' ? 'GR' : 'BL';
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    this.player = new Player(this, { id: id++, name: '我', team: my });
    this.player.primary = o.primary;
    this.player.secondary = o.secondary;
    this.player.melee = o.melee;
    this.player.bind(document.getElementById('c'));
    this.actors.push(this.player);
    const N = o.size;
    const prim = (team, i) => {
      if (i === 1 && N >= 4) return 'awm';
      if (i === 3 && N >= 6) return 'mp5';
      if (i === 5) return team === 'BL' ? 'm4a1' : 'ak47';
      return team === 'BL' ? 'ak47' : 'm4a1';
    };
    for (const team of [my, other]) {
      const count = team === my ? N - 1 : N;
      for (let i = 0; i < count; i++) {
        const b = new Bot(this, { id: id++, name: names.pop() || 'Bot' + id, team, diff: o.diff });
        b.primary = prim(team, team === my ? i + 1 : i);
        this.actors.push(b);
        if (team === my) this.addTag(b);
      }
    }
    for (const a of this.actors) this.spawnActor(a, true);
    this.vm.setTeam(my); this.vm.equip(this.player.weapon.id, 0.6);
    this.hud.slots(this.player.inv, 0);
    this.playing = true; this.paused = false; this.ended = false;
    this.hud.show(null);
    this.lock();
    setTimeout(() => audio.announce('Go go go!'), 400);
    this.hud.toast(`团队竞技 · 率先达到 <b style="color:#f5b321">${this.goal}</b> 击杀的队伍获胜`, 3.5);
  }
  addTag(b) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const x = c.getContext('2d');
    x.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.8)'; x.strokeText(b.name, 128, 24);
    x.fillStyle = b.team === 'BL' ? '#ff9b70' : '#8cc8ff'; x.fillText(b.name, 128, 24);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }));
    s.scale.set(1.3, 0.244, 1); s.renderOrder = 20;
    this.renderer.scene.add(s);
    this.tags.push({ sprite: s, actor: b });
  }
  spawnActor(a, first) {
    const pts = this.map.spawns[a.team];
    let best = null, bestScore = -1e9;
    for (const p of pts) {
      let sc = Math.random() * 3;
      for (const o of this.actors) {
        if (!o.alive || o === a) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (d < 1.2) sc -= 100;
        if (o.team !== a.team) sc += Math.min(d, 40) * 0.1;
      }
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    a.spawn(best);
    if (a instanceof Bot) a.onSpawn();
    if (a.isPlayer) {
      a.deathCam = null;
      this.vm.equip(a.weapon.id, first ? 0.6 : 0.5);
      this.vm.setVisible(true);
      this.hud.slots(a.inv, a.slot);
      audio.setLowHealth(false);
    }
  }
  lock() {
    if (this.touchMode || this.qs.has('nolock')) { this.locked = true; return; }
    const c = document.getElementById('c');
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (e) { /* 忽略 */ } });
    } catch (e) { try { c.requestPointerLock(); } catch (e2) { /* 忽略 */ } }
  }
  onLockChange() {
    this.locked = document.pointerLockElement === document.getElementById('c');
    document.body.classList.toggle('lk', this.locked);
    if (this.locked) {
      if (this.paused) this.resume(true);
    } else if (this.playing && !this.ended && !this.inLoadout && !this.qs.has('nolock')) {
      this.pause();
    }
  }
  pause() {
    this.paused = true; this.hud.show('pause');
    this.hud.scoreboard(false);
  }
  resume(fromLock) {
    this.paused = false; this.hud.show(null);
    if (!fromLock) this.lock();
  }
  quitToMenu() {
    this.playing = false; this.paused = false; this.ended = true;
    if (this.woz) this.woz.onQuit();
    audio.stopAmbient(); audio.setLowHealth(false);
    for (const a of this.actors) this.renderer.scene.remove(a.soldier.root);
    for (const t of this.tags) this.renderer.scene.remove(t.sprite);
    this.actors = []; this.tags = [];
    this.player = null;
    this.vm.setVisible(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show('menu');
  }
  toggleLoadout() {
    if (!this.playing) return;
    if (this.inLoadout) { this.closeLoadout(); return; }
    this.inLoadout = true; this.hud.show('loadout');
    for (const x of document.querySelectorAll('#loadCards .card')) x.classList.toggle('on', x.dataset.w === (this.player.nextPrimary || this.player.primary));
    if (document.pointerLockElement) document.exitPointerLock();
  }
  // 帮助中心（H）：当前模式机制 + 键位
  toggleHelp() {
    if (!this.playing) return;
    if (this.helpOpen) { this.helpOpen = false; this.hud.show(null); this.lock(); return; }
    if (this.inLoadout) this.closeLoadout();
    this.helpOpen = true;
    this.hud.fillHelp(this.opts.mode);
    this.hud.show('help');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeLoadout() {
    this.inLoadout = false; this.hud.show(null); this.lock();
  }
  // ---- 武器丢弃 / 拾取 ----
  spawnGroundGun(pos, ws) {
    const mesh = buildGunMerged(ws.id);
    mesh.scale.setScalar(1.5);
    mesh.rotation.set(0, Math.random() * 6, Math.PI / 2);
    mesh.position.set(pos.x, 0.25, pos.z);
    this.renderer.scene.add(mesh);
    this.groundGuns.push({ id: ws.id, mag: ws.mag, reserve: ws.reserve, mesh, pos: mesh.position });
  }
  dropGun(a) {
    const w = a.weapon;
    if (!w || !['rifle', 'smg', 'sniper', 'pistol', 'shotgun'].includes(w.def.type)) return;
    const eye = a.eye(new THREE.Vector3());
    const fwd = a.forward(new THREE.Vector3());
    this.spawnGroundGun(eye.addScaledVector(fwd, 0.8), w);
    a.inv[a.slot] = new WeaponState('knife');
    a.slot = 2; a.readyAt = this.time + 0.3;
    a.soldier.setWeapon('knife');
    if (a.isPlayer) { this.vm.equip('knife', 0.3); this.hud.slots(a.inv, 2); }
    audio.playWeaponSwitch('knife');
  }
  tryPickup(a) {
    if (this.woz?.rules?.isMutantSide(a.id)) return; // 变异者 E 是吞噬
    let best = null, bestD = 1.8;
    for (const gg of this.groundGuns) {
      const d = Math.hypot(a.pos.x - gg.pos.x, a.pos.z - gg.pos.z);
      if (d < bestD) { bestD = d; best = gg; }
    }
    if (!best) return;
    const slot = WEAPONS[best.id].slot;
    const cur = a.inv[slot];
    if (cur && cur.id !== 'knife' && ['rifle', 'smg', 'sniper', 'pistol', 'shotgun'].includes(cur.def.type)) {
      this.spawnGroundGun(a.pos.clone(), cur); // 手上武器交换到地上
    }
    a.inv[slot] = new WeaponState(best.id);
    a.inv[slot].mag = best.mag; a.inv[slot].reserve = best.reserve;
    a.slot = slot; a.readyAt = this.time + WEAPONS[best.id].draw;
    a.soldier.setWeapon(best.id);
    if (a.isPlayer) { this.vm.equip(best.id, 0.4); this.hud.slots(a.inv, a.slot); }
    audio.playWeaponSwitch(best.id);
    this.renderer.scene.remove(best.mesh);
    this.groundGuns.splice(this.groundGuns.indexOf(best), 1);
  }
  nearGroundGun(a) {
    let best = null, bestD = 1.8;
    for (const gg of this.groundGuns) {
      const d = Math.hypot(a.pos.x - gg.pos.x, a.pos.z - gg.pos.z);
      if (d < bestD) { bestD = d; best = gg; }
    }
    return best;
  }
  chooseGrenade(id) {
    const p = this.player;
    p.nextGrenade = id; this.opts.grenade = id; this.hud.saveOpts();
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) {
      p.inv[3] = new (p.inv[3].constructor)(id);
      p.slot = 3; p.readyAt = this.time + WEAPONS[id].draw; p.soldier.setWeapon(id);
      this.vm.equip(id, WEAPONS[id].draw); this.hud.slots(p.inv, 3);
      this.hud.toast(`已换用 ${WEAPONS[id].name}`, 1.5);
    } else this.hud.toast(`复活后使用 ${WEAPONS[id].name}`, 1.5);
    audio.playUI('buy');
  }
  chooseMelee(id) {
    const p = this.player;
    p.melee = id; this.opts.melee = id; this.hud.saveOpts();
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) {
      p.inv[2] = new WeaponState(id);
      if (p.slot === 2) { p.readyAt = this.time + WEAPONS[id].draw; p.soldier.setWeapon(id); this.vm.equip(id, WEAPONS[id].draw); }
      this.hud.slots(p.inv, p.slot);
      this.hud.toast(`近战换用 ${WEAPONS[id].name}`, 1.5);
    } else this.hud.toast(`复活后使用 ${WEAPONS[id].name}`, 1.5);
    audio.playUI('buy');
  }
  chooseSecondary(id) {
    const p = this.player;
    p.secondary = id; this.opts.secondary = id; this.hud.saveOpts();
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) {
      p.inv[1] = new (p.inv[1].constructor)(id);
      if (p.slot === 1) { p.readyAt = this.time + WEAPONS[id].draw; p.soldier.setWeapon(id); this.vm.equip(id, WEAPONS[id].draw); }
      this.hud.slots(p.inv, p.slot);
      this.hud.toast(`副武器换用 ${WEAPONS[id].name}`, 1.5);
    } else this.hud.toast(`复活后使用 ${WEAPONS[id].name}`, 1.5);
    audio.playUI('buy');
  }
  chooseLoadout(id) {
    const p = this.player;
    p.nextPrimary = id; this.opts.primary = id; this.hud.saveOpts();
    const inSpawn = p.alive && (p.team === 'BL' ? p.pos.x < -28.3 : p.pos.x > 28.3);
    if (inSpawn) {
      p.primary = id; p.inv[0] = new (p.inv[0].constructor)(id); p.inv[0].patternSeed = Math.random() * 6;
      p.slot = 0; p.readyAt = this.time + WEAPONS[id].draw; p.soldier.setWeapon(id);
      this.vm.equip(id, WEAPONS[id].draw); this.hud.slots(p.inv, 0);
      this.hud.toast(`已更换为 ${WEAPONS[id].name}`, 1.5);
    } else this.hud.toast(`复活后使用 ${WEAPONS[id].name}`, 1.5);
    audio.playUI('buy');
  }
  onOption(k, v) {
    if (k === 'vol') audio.setVolumes({ master: v });
    if (k === 'fov' && this.renderer) { this.renderer.camera.fov = v; this.renderer.camera.updateProjectionMatrix(); }
    if (k === 'tod' && this.env) { this.env.apply(v); this.applyFogOverride(); }
    if (k === 'quality') { this.hud.saveOpts(); location.reload(); }
    if (k === 'team' && this.vm) this.vm.setTeam(v);
  }
  endMatch() {
    this.ended = true; this.playing = false;
    const my = this.player.team, other = my === 'BL' ? 'GR' : 'BL';
    const win = this.score[my] === this.score[other] ? null : this.score[my] > this.score[other];
    this.hud.endScreen(win, this.score, this.actors, this.player.id);
    audio.playUI('roundEnd'); audio.setLowHealth(false);
    audio.announce(win ? 'Mission accomplished' : win === null ? 'Draw' : 'Mission failed');
    if (document.pointerLockElement) document.exitPointerLock();
    this.vm.setVisible(false);
  }

  // ================= 战斗 =================
  fireWeapon(a, ws, spread) {
    const d = ws.def;
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    jitterDir(dir, spread, Math.random);
    let muzzle;
    if (a.isPlayer) {
      const cam = this.renderer.camera;
      const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      muzzle = cam.position.clone().addScaledVector(dir, 0.9).addScaledVector(right, 0.14).addScaledVector(up, -0.1);
      this.vm.fire();
      this.fx.light(cam.position.clone().addScaledVector(dir, 1.2), d.type === 'sniper' ? 10 : 5, 0.06);
      audio.playShot(d.sound, null);
      if (Math.random() < 0.5) audio.playShellDrop(null);
    } else {
      muzzle = a.soldier.muzzleWorld(new THREE.Vector3());
      this.fx.muzzle(muzzle, dir, d.type === 'sniper' ? 1.6 : d.type === 'smg' ? 0.8 : 1);
      a.soldier.kick();
      audio.playShot(d.sound, muzzle);
    }
    a.radarT = 1.6;
    // 让附近的机器人听到
    for (const b of this.actors) if (b !== a && b.hear && b.team !== a.team && b.pos.distanceTo(a.pos) < 45) b.hear(a.pos, true);
    // 霰弹等多弹丸武器：每颗弹丸独立散布与判定
    const pellets = d.pellets || 1;
    let end = null;
    for (let pi = 0; pi < pellets; pi++) {
      const dirP = pi === 0 ? dir : jitterDir(dir.clone(), d.pelletSpread ?? 0.06, Math.random);
      const eP = this.traceBullet(a, eye, dirP, d);
      if (pi === 0) end = eP;
      if (pellets === 1 || pi % 3 === 0) this.fx.tracer(muzzle, eP);
    }
    // 子弹掠过玩家
    const p = this.player;
    if (p && p.alive && a !== p && a.team !== p.team) {
      const hp = p.eye(_v);
      const t = _d.copy(hp).sub(eye).dot(dir);
      if (t > 2 && t < eye.distanceTo(end)) {
        const closest = eye.clone().addScaledVector(dir, t);
        if (closest.distanceTo(hp) < 1.3) audio.playBulletWhiz(closest);
      }
    }
  }
  traceBullet(shooter, o, dir, d) {
    const range = d.range;
    const hits = this.world.raycastAll(o.x, o.y, o.z, dir.x, dir.y, dir.z, range);
    let power = d.pen, mul = 1, wall = false, from = 0;
    this.frame++;
    for (let i = 0; i <= hits.length; i++) {
      const h = hits[i];
      const lim = h ? h.t : range;
      // 角色命中
      let best = null, bestT = lim, part = null;
      for (const a of this.actors) {
        if (!a.alive || a === shooter || a.team === shooter.team) continue;
        const r = a.soldier.hitTest(o, dir, bestT, this.frame);
        if (r && r.t > from - 0.01 && r.t < bestT) { best = a; bestT = r.t; part = r.part; }
      }
      // WOZ 场景道具（油桶/木箱）：比角色更近则先命中道具
      if (this.woz && this.woz.props.length) {
        const ph = this.woz.propRay(o, dir, from, best ? bestT : lim);
        if (ph) {
          const pt = o.clone().addScaledVector(dir, ph.t);
          this.fx.impact(pt, _v.copy(dir).negate(), ph.prop.kind === 'barrel' ? 'metal' : 'wood', dir);
          audio.playImpact(pt, ph.prop.kind === 'barrel' ? 'metal' : 'wood');
          this.woz.damageProp(ph.prop, d.dmg * mul * (d.explosive ? 0 : 1), shooter);
          return pt;
        }
      }
      if (best) {
        const pt = o.clone().addScaledVector(dir, bestT);
        const dist = bestT;
        const partMul = part === 'head' ? d.headMul : part === 'arm' || part === 'leg' ? d.limbMul : 1;
        const dmg = d.dmg * mul * Math.pow(d.falloff, dist / 10) * partMul;
        const bloodTier = dmg > 55 ? 3 : dmg > 28 ? 2 : 1; // V85 血雾按伤害分级
        for (let bi = 0; bi < bloodTier; bi++) this.fx.impact(pt, _v.copy(dir).negate(), 'flesh', dir);
        audio.playImpact(pt, 'flesh');
        this.damage(best, shooter, dmg, part, d.id, dir, wall);
        return pt;
      }
      if (!h) break;
      const pt = o.clone().addScaledVector(dir, h.t);
      const n = new THREE.Vector3(h.nx, h.ny, h.nz);
      const mat = h.collider.mat;
      this.fx.impact(pt, n, mat, dir);
      if (pt.distanceTo(this.renderer.camera.position) < 40) audio.playImpact(pt, mat === 'wood' ? 'wood' : 'metal');
      if (h.collider.bullet === 'pen') {
        const thick = h.exit - h.t;
        const cost = thick * (mat === 'wood' ? 1.0 : 1.9);
        if (power > cost) {
          power -= cost; mul *= 0.6; wall = true; from = h.exit;
          const ep = o.clone().addScaledVector(dir, h.exit);
          this.fx.impact(ep, dir.clone(), mat, dir);
          continue;
        }
      } else if (Math.random() < 0.08 && mat === 'metal') audio.playRicochet(pt);
      return pt;
    }
    return o.clone().addScaledVector(dir, range);
  }
  sawCut(a, d, heavy) {
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    this.frame++;
    let hit = null;
    for (const b of this.actors) {
      if (!b.alive || b === a || b.team === a.team) continue;
      const r = b.soldier.hitTest(eye, dir, d.rangeLight, this.frame);
      if (r && (!hit || r.t < hit.t)) hit = { a: b, t: r.t, part: r.part };
    }
    if (!hit) { wozAudio.saw(a.isPlayer ? null : eye, 0); return; } // V102 挥空：锯链怠速嗡鸣
    const dmg = heavy ? d.dmgHeavy : d.dmgLight;
    this.damage(hit.a, a, dmg, hit.part, a.weapon?.id || 'chainsaw', dir, false, true);
    this.fx.impact(eye.clone().addScaledVector(dir, hit.t), dir.clone().negate(), 'flesh', dir);
    wozAudio.saw(a.isPlayer ? null : eye, heavy ? 1 : 0.6); // V102 切割负载掉速音
    audio.playKnife('light', 'flesh', a.isPlayer ? null : eye);
  }
  melee(a, heavy) {
    if (a.morphT > 0) return; // V93 尸变中不可出爪
    a.soldier?.attack?.(heavy); // V98 第三人称近战挥砍
    this.woz?.breakDisguise?.(a); // V55 伪装：出爪暴露
    const d = WEAPONS[a.weapon?.id] || WEAPONS.knife;
    const range = heavy ? d.rangeHeavy : d.rangeLight;
    const eye = a.eye(new THREE.Vector3());
    const base = a.forward(new THREE.Vector3());
    if (a.isPlayer) this.vm.melee(heavy);
    // 复仇者重击 = 旋转清场（原作：原地旋转一周清除所有近身敌人）
    if (heavy && a.wozOutfit === 'AVG' && this.woz?.rules?.isAvenger?.(a.id)) { this.woz.spinAttack(a); return; }
    this.frame++;
    let hit = null;
    for (const off of [0, 0.12, -0.12, 0.24, -0.24]) {
      const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
      for (const b of this.actors) {
        if (!b.alive || b === a || b.team === a.team) continue;
        const r = b.soldier.hitTest(eye, dir, range, this.frame);
        if (r && (!hit || r.t < hit.t)) hit = { a: b, t: r.t, part: r.part, dir };
      }
      if (hit) break;
    }
    // 隔墙不可命中（变异者爪击/军刀均受视线遮挡约束）
    if (hit && this.world.raycast(eye.x, eye.y, eye.z, hit.dir.x, hit.dir.y, hit.dir.z, hit.t - 0.05, 'sight')) hit = null;
    // 近战劈道具（V39）：伤害 ×1.5
    if (this.woz && this.woz.props.length) {
      const ph = this.woz.propRay(eye, base, 0.2, range);
      if (ph && (!hit || ph.t < hit.t)) {
        if (a.isPlayer) this.fx.shake = Math.max(this.fx.shake || 0, 0.2);
        this.woz.damageProp(ph.prop, (heavy ? d.dmgHeavy : d.dmgLight) * 1.5, a);
        audio.playKnife(heavy ? 'heavy' : 'light', 'wall', a.isPlayer ? null : eye);
        return;
      }
    }
    if (a.isPlayer) this.fx.shake = Math.max(this.fx.shake || 0, heavy ? 0.3 : 0.12); // 近战出手/命中震屏（V32）
    const delay = heavy ? 0.33 : 0.1;
    this.timers.push({
      t: this.time + delay, fn: () => {
        if (!a.alive) return;
        if (hit && hit.a.alive) {
          a.protectT = 0; // 出手即解除出生保护
          const vf = hit.a.forward(new THREE.Vector3()); vf.y = 0; vf.normalize();
          const back = vf.dot(_v.copy(hit.dir).setY(0).normalize()) > 0.5;
          let dmg = heavy ? d.dmgHeavy : d.dmgLight;
          if (a.clawDmg) dmg = heavy ? a.clawDmg * 1.8 : a.clawDmg; // AI 杂兵固定爪伤（V53 悲惨行者/末分钟狂潮）
          if (back) dmg *= heavy ? 2 : 1.6;
          if (hit.part === 'head') dmg *= 1.3;
          // V52 断头者双大刀：轻/重击倍率（重击近身即可秒杀满血人类，原作"时常可以秒杀对手"）
          if (this.woz) dmg *= this.woz.classMeleeMul(a, heavy);
          const pt = eye.clone().addScaledVector(hit.dir, hit.t);
          this.fx.impact(pt, hit.dir.clone().negate(), 'flesh', hit.dir);
          audio.playKnife(heavy ? 'heavy' : 'light', 'flesh', a.isPlayer ? null : eye);
          this.damage(hit.a, a, dmg, hit.part, a.weapon?.id || 'knife', hit.dir, false, true);
          if (a.chillOnHit) this.woz?.applyChill?.(hit.a); // 寒霜行者冰缓（V56）
        } else {
          const w = this.world.raycast(eye.x, eye.y, eye.z, base.x, base.y, base.z, range, 'bullet');
          if (w) {
            const pt = eye.clone().addScaledVector(base, w.t);
            this.fx.impact(pt, new THREE.Vector3(w.nx, w.ny, w.nz), w.collider.mat, base);
            audio.playKnife(heavy ? 'heavy' : 'light', 'wall', a.isPlayer ? null : eye);
          } else audio.playKnife(heavy ? 'heavy' : 'light', 'miss', a.isPlayer ? null : eye);
        }
      },
    });
  }
  // 火焰喷射器（V47）：锥形持续伤害 + 火焰粒子 + 点燃视觉
  flameAttack(a, d) {
    const eye = a.eye(new THREE.Vector3());
    const fwd = a.forward(new THREE.Vector3());
    const COS = Math.cos(0.24); // 约 28° 半角锥
    for (const v of this.actors) {
      if (!v.alive || v === a || v.team === a.team) continue;
      const to = new THREE.Vector3(v.pos.x - eye.x, (v.pos.y + 1.0) - eye.y, v.pos.z - eye.z);
      const dist = to.length();
      if (dist > d.range) continue;
      to.divideScalar(dist || 1);
      if (to.dot(fwd) < COS) continue;
      if (this.world.raycast(eye.x, eye.y, eye.z, to.x, to.y, to.z, dist, 'sight')) continue;
      this.damage(v, a, d.dmg, 'chest', 'flamer', to, false, true);
      if (Math.random() < 0.25) this.fx.impact(new THREE.Vector3(v.pos.x, v.pos.y + 1.2, v.pos.z), new THREE.Vector3(0, 1, 0), 'flesh', new THREE.Vector3(0, 1, 0));
    }
    // 火舌粒子：沿射向呈锥形喷出
    const tip = eye.clone().addScaledVector(fwd, 1.2);
    for (let i = 0; i < 6; i++) {
      const sp = 8 + Math.random() * 8, jx = (Math.random() - 0.5) * 2.2, jy = (Math.random() - 0.3) * 2.2, jz = (Math.random() - 0.5) * 2.2;
      this.fx.smoke.emit({ x: tip.x, y: tip.y, z: tip.z, vx: fwd.x * sp + jx, vy: fwd.y * sp + jy + 1.2, vz: fwd.z * sp + jz, life: 0, max: 0.3 + Math.random() * 0.25, s0: 0.3, s1: 1.3, r: 1.9, g: 0.9 + Math.random() * 0.5, b: 0.15, a0: 0.85, a1: 0, grav: 1.2, drag: 3 });
    }
    this.fx.light(tip, 7, 0.07, 0xff8030, 12);
    if (a.isPlayer) this.fx.shake = Math.max(this.fx.shake || 0, 0.045);
    audio.playFootstep(a.isPlayer ? null : eye, 'metal', { run: true, crouch: false }); // 喷射低鸣（复用脚步声近似）
  }
  fireLauncher(a, w) {
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    if (a.isPlayer) this.vm.melee(false); // 视觉后坐
    this.fx.shake = Math.max(this.fx.shake || 0, 0.35);
    audio.playGrenadeThrow();
    audio.playImpact(eye, 'metal');
    const mesh = buildGunMerged('he');
    mesh.scale.setScalar(0.85);
    const vel = dir.clone().multiplyScalar(23);
    vel.y += 1.5;
    this.nades.push({ id: 'm79shell', mesh, pos: eye.clone().addScaledVector(dir, 0.55), vel, fuse: WEAPONS.m79shell.fuse, owner: a, spin: new THREE.Vector3(6, 2, 0) });
    this.renderer.scene.add(mesh);
    if (a.isPlayer) this.hud.slots(a.inv, a.slot);
  }
  throwGrenade(a) {
    const eye = a.eye(new THREE.Vector3());
    const dir = a.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    const pos = eye.clone().addScaledVector(dir, 0.5).addScaledVector(right, 0.12);
    const vel = dir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 2.8, 0)).addScaledVector(a.vel, 0.6);
    const mesh = buildGunMerged('he'); mesh.scale.setScalar(1.3);
    mesh.position.copy(pos); this.renderer.scene.add(mesh);
    this.nades.push({ id: a.weapon.id, mesh, pos, vel, fuse: WEAPONS[a.weapon.id]?.fuse ?? WEAPONS.he.fuse, owner: a, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) });
    audio.playGrenadeThrow();
    if (a.isPlayer) audio.announce('Fire in the hole!');
    for (const b of this.actors) if (b.hear && b.team !== a.team && b.pos.distanceTo(pos) < 20) b.hear(pos, false);
  }
  updateNades(dt) {
    const W = this.world;
    this.nades = this.nades.filter((n) => {
      n.fuse -= dt;
      // 黏性炸弹（V41）：飞行中接触变异体即黏附跟随，短引信必中
      if (n.id === 'sticky' && n.stuck === undefined) {
        for (const a of this.actors) {
          if (!a.alive || a === n.owner || a.team === n.owner.team || a.wozOut) continue;
          if (Math.hypot(a.pos.x - n.pos.x, a.pos.z - n.pos.z) < 1.0 && n.pos.y > a.pos.y - 0.4 && n.pos.y < a.pos.y + 2) {
            n.stuck = a;
            n.fuse = Math.min(n.fuse, WEAPONS.sticky.stickFuse);
            n.mesh.scale.setScalar(0.8);
            audio.playImpact(n.pos.clone(), 'flesh');
            if (a.isPlayer) this.hud.toast('<b style="color:#ff5040">黏性炸弹黏住了你！</b>', 1.2);
            break;
          }
        }
      }
      if (n.stuck) {
        const a = n.stuck;
        if (!a.alive) { n.fuse = Math.min(n.fuse, 0.15); }
        n.pos.set(a.pos.x, a.pos.y + 1.3, a.pos.z);
        n.mesh.position.copy(n.pos);
        n.mesh.rotation.z += dt * 3;
        // V81 黏附状态：红灯快闪 + 加速滴滴（引信越短越急促）
        if (!n.warn) {
          n.warn = new THREE.PointLight(0xff3020, 3, 4);
          n.warn.position.copy(n.pos);
          this.renderer.scene.add(n.warn);
        } else { n.warn.position.copy(n.pos); n.warn.intensity = 1.5 + Math.abs(Math.sin(n.fuse * 22)) * 3; }
        n.beepT = (n.beepT || 0) - dt;
        if (n.beepT <= 0) { n.beepT = Math.max(0.1, n.fuse * 0.25); wozAudio.beep(n.pos.clone(), 1200, 0.05); }
        if (n.fuse <= 0) {
          this.explode(n.pos.clone(), n.owner, 'sticky');
          if (a.alive) this.fx.bloodBurst(a.pos, new THREE.Vector3(0, 0, 1));
          this.renderer.scene.remove(n.mesh);
          if (n.warn) this.renderer.scene.remove(n.warn);
          return false;
        }
        return true;
      }
      const steps = 3, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        n.vel.y -= 14 * h;
        const sp = n.vel.length();
        if (sp < 1e-4) continue;
        const d = n.vel.clone().divideScalar(sp);
        const L = sp * h + 0.07;
        const hit = W.raycast(n.pos.x, n.pos.y, n.pos.z, d.x, d.y, d.z, L, 'move');
        if (hit) {
          const nn = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
          n.pos.addScaledVector(d, Math.max(0, hit.t - 0.07));
          const vn = n.vel.dot(nn);
          n.vel.addScaledVector(nn, -1.45 * vn).multiplyScalar(0.55);
          if (Math.abs(vn) > 2) audio.playGrenadeBounce(n.pos.clone());
          if (nn.y > 0.7 && Math.abs(n.vel.y) < 1.2) { n.vel.y = 0; n.vel.x *= 0.8; n.vel.z *= 0.8; }
          n.spin.multiplyScalar(0.6);
        } else n.pos.addScaledVector(n.vel, h);
      }
      n.mesh.position.copy(n.pos);
      n.mesh.rotation.x += n.spin.x * dt; n.mesh.rotation.y += n.spin.y * dt;
      if (n.fuse <= 0) { this.explode(n.pos.clone(), n.owner, n.id); this.renderer.scene.remove(n.mesh); return false; }
      return true;
    });
  }
  explode(p, owner, wid = 'he') {
    void 0;
    if (wid === 'flash') {
      // 震撼弹：视野内致盲（对齐原作致盲机制），微伤
      this.fx.explosion(p);
      audio.playExplosion(p);
      const d = WEAPONS.flash;
      for (const a of this.actors) {
        if (!a.alive) continue;
        const c = a.soldier.chestWorld(new THREE.Vector3());
        const dist = c.distanceTo(p);
        if (dist > d.radius) continue;
        const dir = c.clone().sub(p); const L = dir.length(); dir.divideScalar(L || 1);
        if (this.world.raycast(p.x, p.y + 0.2, p.z, dir.x, dir.y, dir.z, Math.max(0, L - 0.3), 'sight')) continue;
        const k = 1 - dist / d.radius;
        a.blindT = Math.max(a.blindT || 0, d.blind * k);
        if (a.isPlayer) {
          this.dmgFlash = Math.max(this.dmgFlash || 0, 0.8); this.fx.shake = Math.max(this.fx.shake, 0.6);
          wozAudio.tinnitus(d.blind * k); // V82 耳鸣：高频衰减正弦
        }
        if (dist < 2.5) this.damage(a, owner, d.dmg, 'chest', 'flash', dir, false);
      }
      return;
    }
    if (wid === 'molotov' || wid === 'frost' || wid === 'gas' || wid === 'venom') {
      this.zones.spawn(wid === 'molotov' ? 'fire' : wid, p.clone());
      this.fx.explosion(p);
      audio.playExplosion(p);
      if (wid === 'molotov') wozAudio.shatter(p); // V77 玻璃碎裂
      // 投掷型区域武器：燃烧/毒雾小量即时伤害 + 持续区域
      for (const a of this.actors) {
        if (!a.alive) continue;
        const c = a.soldier.chestWorld(new THREE.Vector3());
        if (c.distanceTo(p) <= 2.2) this.damage(a, owner, wid === 'frost' ? 6 : wid === 'venom' ? 18 : 14, 'chest', wid, dir0, false);
      }
      return;
    }
    const d = WEAPONS[wid] || WEAPONS.he;
    this.fx.explosion(p);
    audio.playExplosion(p);
    const camD = this.renderer.camera.position.distanceTo(p);
    this.fx.shake = Math.max(this.fx.shake, Math.max(0, 1.4 - camD / 18));
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.team === owner.team && a !== owner) continue;
      const c = a.soldier.chestWorld(new THREE.Vector3());
      const dist = c.distanceTo(p);
      if (dist > d.radius) continue;
      const dir = c.clone().sub(p); const L = dir.length(); dir.divideScalar(L || 1);
      const blocked = this.world.raycast(p.x, p.y + 0.2, p.z, dir.x, dir.y, dir.z, Math.max(0, L - 0.3), 'bullet');
      let dmg = d.dmg * Math.pow(1 - dist / d.radius, 1.1);
      if (blocked) dmg *= 0.2;
      if (dmg > 1) this.damage(a, owner, dmg, 'chest', 'he', dir, false);
    }
    for (const b of this.actors) if (b.hear && b.pos.distanceTo(p) < 40) b.hear(p, true);
    // 爆炸波及场景道具（V39）：油桶殉爆链
    if (this.woz && this.woz.props.length) {
      const wdef = WEAPONS[wid] || WEAPONS.he;
      for (const pr of this.woz.props) {
        if (!pr.live) continue;
        const pd = Math.hypot(pr.x - p.x, pr.z - p.z);
        if (pd < wdef.radius) {
          const pdmg = wdef.dmg * (1 - Math.min(1, pd / wdef.radius));
          if (pdmg > 10) this.woz.damageProp(pr, pdmg, owner, true);
        }
      }
    }
  }
  damage(v, att, amt, part, wid, dir, wall, melee) {
    if (!v.alive || v.protectT > 0) return;
    if (att && att !== v && att.team === v.team) return;
    const def = WEAPONS[wid];
    let hpD = amt;
    if (att && att.dmgBuff > 1) hpD *= att.dmgBuff; // 连杀狂怒（V43）
    if (this.woz) hpD *= this.woz.adjustDamage(v, att);
    // V51 爬行者：蜥蜴巨躯——躯体减伤 40%，爆头 1.5 倍伤并定身（原作：抗射击/爆头停止移动）
    if (this.woz) hpD *= this.woz.classPartDamage(v, part);
    if (v.armor > 0 && part !== 'leg') {
      const ap = def?.armorPen ?? 0.75;
      hpD = amt * ap;
      v.armor = Math.max(0, v.armor - amt * (1 - ap) * 1.4);
    }
    v.hp -= hpD;
    // WOZ 打击反馈：击退冲量 + 命中暂缓（变异者躯体重，击退衰减但暂缓吃满）
    if (dir && v.alive) {
      const kdef = WEAPONS[wid] || {};
      const heavy = v.wozHeavy ? 0.5 : 1; // 变异者质量大：击退减半但仍可感知（0.12 配 9/s 摩擦位移仅 1-2cm 不可见；2.6m/s 上限防连发推走）
      if (kdef.knock) {
        v.vel.x += dir.x * kdef.knock * heavy; v.vel.z += dir.z * kdef.knock * heavy;
        if (v.wozHeavy) { // 变异者击退速度上限 2.6m/s
          const hs = Math.hypot(v.vel.x, v.vel.z);
          if (hs > 2.6) { v.vel.x *= 2.6 / hs; v.vel.z *= 2.6 / hs; }
        }
      }
      if (kdef.stagger) v.staggerT = Math.max(v.staggerT || 0, kdef.stagger);
    }
    v.lastAttacker = att; v.lastHurt = this.time;
    const killed = v.hp <= 0;
    if (att && att !== v) att.stats.hits++;
    if (this.woz) this.woz.reportDamage(att, v, Math.min(hpD, amt * 2)); // 伤害上报（充能/能量）
    // 打击感（V31）：受击者红闪；重击/爆头/爆炸击杀触发顿帧
    if (v.soldier && !v.isPlayer) {
      v.soldier.hitFlash(Math.min(1, 0.35 + hpD / 80) + (part === 'head' ? 0.25 : 0));
      // V99 受击踉跄：爆头甩动更猛（打击感）
      if (dir) v.soldier.hitFlinch(dir.x, dir.z, Math.min(1, 0.5 + hpD / 60) + (part === 'head' ? 0.35 : 0));
    }
    if (killed && att && att !== v) {
      const heavyKill = melee || part === 'head' || wid === 'he' || wid === 'chainsaw';
      if (heavyKill) this.hitStopT = Math.max(this.hitStopT, 0.07);
    }
    if (v.isPlayer) {
      if (att && att !== v) this.hud.damageFrom(Math.atan2(-(att.pos.x - v.pos.x), -(att.pos.z - v.pos.z)));
      v.aimPunch += Math.min(0.05, hpD * 0.0012);
      audio.playHurt(Math.min(100, hpD));
      this.dmgFlash = Math.min(1.2, (this.dmgFlash || 0) + hpD / 45);
      if (v.hp <= 30 && !killed) audio.setLowHealth(true);
    } else if (v.onDamaged) v.onDamaged(att);
    if (att && att.isPlayer && att !== v) {
      this.hud.hitmarker(part === 'head', killed);
      audio.playHitmarker(part === 'head');
    }
    if (killed) this.kill(v, att, wid, part === 'head' && !melee, wall, dir);
  }
  kill(v, att, wid, hs, wall, dir) {
    v.alive = false; v.hp = 0; v.deadT = 0; v.respawnT = 4.0; v.stats.d++;
    v.scoped = 0; v.dmgBuff = 1; v.streak = 0;
    // V72 毒云等无方向伤害：dir 可为 null（修复 e2e2 demol 毒云击杀崩溃）
    v.soldier.die(dir ? dir.x : 0, dir ? dir.z : 1, hs);
    if (v.wozHeavy) {
      // V84 变异者死亡溶解：躯体上升的暗红雾团
      for (let i = 0; i < 8; i++) this.fx.smoke.emit({ x: v.pos.x + (Math.random() - 0.5) * 0.6, y: v.pos.y + 0.4 + Math.random() * 1.2, z: v.pos.z + (Math.random() - 0.5) * 0.6, vx: 0, vy: 0.9 + Math.random() * 0.8, vz: 0, life: 0, max: 0.9 + Math.random() * 0.5, s0: 0.3, s1: 0.9, r: 0.75, g: 0.16, b: 0.1, a0: 0.5, a1: 0, drag: 0.8 });
      wozAudio.growl(v.pos.clone()); // V101 变异者死亡嘶吼（低沉收场）
    }
    audio.playDeath(v.soldier.chestWorld(new THREE.Vector3()));
    const p = this.player;
    if (att && att !== v) {
      att.stats.k++; if (hs) att.stats.hs++;
      if (!this.woz) this.score[att.team]++;
      att.multi = this.time - att.lastKillT < 5 ? att.multi + 1 : 1;
      att.lastKillT = this.time; att.streak++;
      // 连杀奖励（V43）：3 杀补弹 / 5 杀回血 / 8 杀狂怒（死亡清空）
      const rewards = { 3: 'ammo', 5: 'heal', 8: 'rage' };
      if (rewards[att.streak]) this.streakReward(att, rewards[att.streak], att.streak);
    }
    this.hud.killFeed(att && att !== v ? att : null, v, wid, hs, wall, att === p || v === p);
    if (att === p && v !== p) {
      const m = Math.min(att.multi, 8);
      let text, sub = `击杀 ${v.name}`;
      if (m >= 2) { text = MULTI[m]; sub = MULTI_CN[m] + ' · ' + sub; setTimeout(() => audio.announce(MULTI[m].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) + '!'), 150); }
      else if (hs) { text = 'HEADSHOT'; sub = '爆头 · ' + sub; setTimeout(() => audio.announce('Headshot!'), 150); }
      else if (wid === 'knife') { text = 'KNIFE KILL'; sub = '刀杀 · ' + sub; }
      else if (wid === 'he') { text = 'GRENADE KILL'; sub = '手雷击杀 · ' + sub; }
      else if (wid === 'axe') { text = 'AXE KILL'; sub = '消防斧劈杀 · ' + sub; }
      else if (wid === 'chainsaw') { text = 'EXECUTED'; sub = '电锯处决 · ' + sub; }
      else if (wid === 'claw') { text = 'INFECTED'; sub = '感染 · 爪击击杀 · ' + sub; }
      else if (wall) { text = 'WALLBANG'; sub = '穿墙击杀 · ' + sub; }
      else { text = 'KILL'; }
      this.hud.badge(text, sub, hs);
      audio.playKillConfirm(hs);
    }
    if (v === p) {
      p.startDeathCam(att);
      this.vm.setVisible(false);
      audio.setLowHealth(false);
      const wn = WEAPONS[wid]?.name || wid;
      this.killedBy = att && att !== v ? `被 <span style="color:${att.team === 'BL' ? '#ff9b70' : '#8cc8ff'}">${att.name}</span> 用 ${wn}${hs ? ' <span style="color:#ff5040">爆头</span>' : ''}击杀` : '你阵亡了';
    }
    // 爆头击杀：头部血爆 + 更强顿帧（V49）
    if (hs) {
      const head = v.soldier.headWorld ? v.soldier.headWorld(new THREE.Vector3()) : v.pos.clone().setY(v.pos.y + 1.6);
      this.fx.bloodBurst(head, dir);
      if (att === p) this.hitStopT = Math.max(this.hitStopT, 0.09);
    }
    this.fx.bloodBurst(v.pos, dir);
    if (att === p && v !== p && p.multi >= 2) this.hitStopT = Math.max(this.hitStopT, 0.1); // 多杀顿帧更强
    if (this.woz) { this.woz.onKill(v, att); return; }
    if (this.score.BL >= this.goal || this.score.GR >= this.goal) setTimeout(() => { if (this.playing) this.endMatch(); }, 1200);
  }

  // ================= 事件音效 =================
  onJump(a) { audio.playJump(a.isPlayer ? null : a.pos.clone()); }
  onLand(a, sp) { audio.playLand(a.isPlayer ? null : a.pos.clone(), a.ground?.surface || 'metal', Math.min(1, sp / 10)); }
  streakReward(a, kind, streak) {
    if (kind === 'ammo') {
      for (const w of a.inv) if (w && w.def.type !== 'melee' && w.def.type !== 'grenade') { w.mag = w.def.mag; w.reserve = w.def.reserve; }
    } else if (kind === 'heal') {
      const cap = a.wozMaxHp || 100;
      a.hp = cap;
      if (this.woz?.rules && a.id < this.woz.rules.playerCount) this.woz.rules.state(a.id).hp = cap;
    } else if (kind === 'rage') {
      a.dmgBuff = 1.1;
    }
    const CN = { ammo: '弹药补给', heal: '战地医疗', rage: '狂怒（伤害 +10%）' };
    if (a.isPlayer) this.hud.toast(`<b style="color:#ffd24a">${streak} 连杀！</b>奖励：${CN[kind]}`, 2);
    this.hud.eventFeed(`${a.name} 达成 ${streak} 连杀 · ${CN[kind]}`, 'avg');
    audio.playUI('buy');
  }
  onFootstep(a) {
    // 变异者重脚步（V42 压迫感）：玩家 10m 内每步低频闷响 + 极轻微震屏
    if (a.isZombie) {
      const pl = this.player;
      const d = pl && pl.alive ? a.pos.distanceTo(pl.pos) : 1e9;
      if (d < 10) {
        this.fx.shake = Math.max(this.fx.shake || 0, 0.05 * (1 - d / 10));
        audio.playHurt(6);
      }
    }
    if (!a.isPlayer && a.pos.distanceTo(this.renderer.camera.position) > 30) return;
    audio.playFootstep(a.isPlayer ? null : a.pos.clone(), a.ground?.surface || 'metal', { run: true, crouch: a.crouch });
    if (!a.walk) for (const b of this.actors) if (b.hear && b.team !== a.team && b.pos.distanceTo(a.pos) < 12) b.hear(a.pos, false);
  }
  onSwitch(a) {
    if (!a.isPlayer) return;
    this.vm.equip(a.weapon.id, a.weapon.def.draw);
    audio.playWeaponSwitch(a.weapon.id);
    this.hud.slots(a.inv, a.slot);
  }
  onReloadStart(a, empty) {
    if (!a.isPlayer) return;
    const d = a.weapon.def, t = this.time, id = d.id;
    this.vm.reload(d.reload, empty);
    this.timers.push({ t: t + d.reload * 0.2, fn: () => audio.playReload(id, 'magout') });
    this.timers.push({ t: t + d.reload * 0.6, fn: () => audio.playReload(id, 'magin') });
    if (empty) this.timers.push({ t: t + d.reload * 0.82, fn: () => audio.playReload(id, id === 'awm' ? 'bolt' : 'boltback') });
    if (empty) this.timers.push({ t: t + d.reload * 0.88, fn: () => audio.playReload(id, 'boltforward') });
  }
  onReloadDone() { }
  onScope(a) { if (a.isPlayer) audio.playScope(a.scoped > 0); }
  onDryFire(a) { if (a.isPlayer) audio.playDryFire(); }
  onGrenadeStart(a) { if (a.isPlayer) { this.vm.throwNade(); audio.playGrenadePin(); } }

  // ================= 主循环 =================
  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000; this.last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    let scale = 1;
    if (this.hitStopT > 0) { this.hitStopT -= dt; scale = Math.min(scale, 0.22); } // 顿帧：22% 慢速流逝
    if (this.slowMoT > 0) { this.slowMoT -= dt; scale = Math.min(scale, this.slowMoScale); } // 慢动作时刻
    dt *= scale;
    const R = this.renderer, cam = R.camera;
    this.realTime = (this.realTime || 0) + dt;
    const active = this.playing && !this.paused && !this.testFreeze; // testFreeze: e2e 冻结真实帧，仅 fastForward 驱动
    if (active) this.simulate(dt);
    else if (!this.playing) {
      // 菜单：环绕运输船
      const t = this.realTime * 0.045;
      cam.position.set(Math.cos(t) * 46 - 6, 13 + Math.sin(t * 2.1) * 3, Math.sin(t) * 34);
      cam.lookAt(-4, 1.5, 0);
      cam.fov = 60; cam.updateProjectionMatrix();
    }
    this.renderFrame(dt);
  }
  // 调试：无渲染快进
  fastForward(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds && this.playing; t += step) this.simulate(step);
    return { score: this.score, time: this.time.toFixed(1), kills: this.actors.map((a) => a.name + ':' + a.stats.k + '/' + a.stats.d).join(' ') };
  }
  simulate(dt) {
    const cam = this.renderer.camera;
    {
      this.time += dt;
      this.timeLeft -= dt;
      for (let i = this.timers.length - 1; i >= 0; i--) if (this.time >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
      this.player.update(dt);
      for (const a of this.actors) {
        if (a.isPlayer) continue;
        a.update(dt);
      }
      for (const a of this.actors) {
        a.radarT = Math.max(0, a.radarT - dt);
        if (a.blindT > 0) a.blindT = Math.max(0, a.blindT - dt); // 震撼弹/尖啸致盲统一衰减
        if (a.staggerT > 0) a.staggerT = Math.max(0, a.staggerT - dt); // 命中暂缓统一衰减（原来只有僵尸会恢复→人类被打后永久减速）
        if (a.alive) {
          a.protectT = Math.max(0, a.protectT - dt);
          const s = a.soldier;
          s.root.position.copy(a.pos);
          s.root.rotation.y = a.yaw;
          const fwd = (a.vel.x * -Math.sin(a.yaw) + a.vel.z * -Math.cos(a.yaw)) / Math.max(0.01, a.speed || 0);
          s.update(dt, { speed: a.speed || 0, fwd, crouch: a.crouch, pitch: a.pitch + a.punchP, onGround: a.onGround, reloading: a.weapon?.reloading });
          // 出生保护闪烁
          if (!a.isPlayer) s.mesh.visible = !(a.protectT > 0 && Math.sin(this.time * 30) > 0.3);
        } else {
          a.deadT += dt;
          a.soldier.update(dt, {});
          if (a.blindT > 0) a.blindT = Math.max(0, a.blindT - dt);
          a.respawnT -= dt;
          if (a.respawnT <= 0 && !this.ended) this.woz ? this.woz.onRespawnDue(a) : this.spawnActor(a);
        }
      }
      this.updateNades(dt);
      this.zones.update(dt);
      if (this.woz) this.woz.tick(dt);
      if (this.timeLeft <= 0 && !this.ended && !this.woz) this.endMatch();
      // 队友名字
      for (const t of this.tags) {
        const a = t.actor;
        t.sprite.visible = a.alive && a.pos.distanceTo(cam.position) < 45;
        if (t.sprite.visible) { a.soldier.headWorld(t.sprite.position); t.sprite.position.y += 0.42; }
      }
    }
  }
  renderFrame(dt) {
    const R = this.renderer, cam = R.camera;
    // 第一人称武器
    if (this.player && this.playing) {
      const p = this.player;
      if (this.frame % 6 === 0 || !this.lightK) this.updateLightProbe();
      this.frame++;
      const sunCam = this.env.sunDir.clone().applyQuaternion(cam.quaternion.clone().invert());
      this.vm.setVisible(p.alive && !(p.scoped && p.weapon.def.type === 'sniper'));
      this.vm.update(dt, { speed: p.speed || 0, onGround: p.onGround, crouch: p.crouch, lookDX: p.lookDX, lookDY: p.lookDY, sunDirCam: sunCam, light: this.lightK, indoor: this.indoorK > 0.5 });
      R.vmScene.environmentIntensity = 0.75 * (0.35 + 0.65 * (1 - this.indoorK));
    }
    this.fx.update(dt, this.realTime, cam, this.env.shipSpeed);
    this.env.update(dt, this.realTime, cam.position);
    this.map.update(dt, this.realTime);
    // 帧率统计与画质建议
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 1) {
      this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0;
      const lbl = document.querySelector('#radarWrap .lbl');
        if (lbl) lbl.textContent = `${this.mapName} · ${this.fps} FPS`;
      if (this.playing && !this.paused && this.time > 8 && !this.fpsHinted && this.fps < 32 && this.opts.quality !== 'low') {
        this.fpsHinted = true;
        this.hud.toast('帧率较低：可按 Esc 在主菜单把画质调到「均衡」或「流畅」', 5);
      }
    }
    // 音频监听者
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion), up = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, fwd, up);
    audio.update(dt);
    // HUD
    if (this.player && (this.playing || this.ended)) this.updateHUD(dt);
    // 屏幕特效
    const fxu = R.fx.uniforms;
    this.dmgFlash = Math.max(0, (this.dmgFlash || 0) - dt * 1.6);
    fxu.uTime.value = this.realTime;
    fxu.uDamage.value = this.dmgFlash;
    const p = this.player;
    fxu.uLowHP.value = p && p.alive && this.playing ? Math.max(0, (35 - p.hp) / 35) : 0;
    fxu.uDeath.value = p && !p.alive && this.playing ? Math.min(1, p.deadT * 2) : 0;
    fxu.uProtect.value = p && p.alive && this.playing ? Math.min(1, p.protectT) : 0;
    fxu.uVignette.value = p && p.scoped ? 0 : 0.3;
    R.render();
  }
  updateLightProbe() {
    const p = this.player, e = p.eye(_v), s = this.env.sunDir;
    const sunBlocked = !!this.world.raycast(e.x, e.y, e.z, s.x, s.y, s.z, 80, 'sight');
    const roof = !!this.world.raycast(e.x, e.y, e.z, 0, 1, 0, 5, 'sight');
    const tl = sunBlocked ? 0.22 : 1, ti = roof ? 1 : 0;
    this.lightK = this.lightK === undefined ? tl : this.lightK + (tl - this.lightK) * 0.35;
    this.indoorK = this.indoorK === undefined ? ti : this.indoorK + (ti - this.indoorK) * 0.35;
  }
  updateHUD(dt) {
    const p = this.player, cam = this.renderer.camera, w = p.weapon;
    let spreadPx = 0;
    if (w && w.def.spread) {
      const sp = Math.min(0.12, w.spreadAcc + w.def.spread.base * 2 + (p.speed > 0.6 ? w.def.spread.move * Math.min(1, p.speed / 5.7) : 0) + (p.onGround ? 0 : w.def.spread.air * 0.5)) * (p.crouch ? 0.7 : 1);
      spreadPx = Math.tan(sp) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * window.innerHeight / 2;
    }
    // 准星下的角色名
    let aimName = '', aimTeam = '';
    if (p.alive && this.frame % 4 === 0) {
      const o = cam.position, d = _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const wh = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 80, 'sight');
      const lim = wh ? wh.t : 80;
      let best = null, bt = lim;
      this.frame++;
      for (const a of this.actors) {
        if (a === p || !a.alive) continue;
        const r = a.soldier.hitTest(o, d, bt, this.frame);
        if (r) { best = a; bt = r.t; }
      }
      this.aimTarget = best;
    }
    if (this.aimTarget && this.aimTarget.alive) { aimName = this.aimTarget.name; aimTeam = this.aimTarget.team; }
    this.hud.update(dt, {
      score: this.score, timeLeft: this.timeLeft, goal: this.goal, myTeam: p.team,
      hp: p.hp, armor: p.armor, alive: p.alive, weapon: w, scoped: p.scoped && w.def.type === 'sniper', spreadPx,
      yaw: p.yaw, respawnIn: p.respawnT, killedBy: this.killedBy, protect: p.protectT, aimName, aimTeam,
    });
    this.hud.drawRadar(p, this.actors, this.time, this.woz ? this.woz.radarMarkers() : null);
    // 底部中央情境提示条：目标区域 > 武器拾取
    let prompt = this.woz ? this.woz.promptFor(p) : null;
    if (!prompt && p.alive && !(this.woz?.rules?.isMutantSide(p.id))) {
      const gg = this.nearGroundGun(p);
      if (gg) prompt = { kind: 'gold', title: `按 <kbd>E</kbd> 拾取 ${WEAPONS[gg.id].name}`, sub: `弹匣 ${gg.mag} / 备弹 ${gg.reserve}` };
    }
    this.hud.setPrompt(prompt);
    const tab = p.keys.has('Tab') && this.playing && !this.paused;
    if (tab !== this.boardShown || (tab && this.frame % 20 === 0)) {
      this.boardShown = tab;
      const title = document.getElementById('boardTitle');
      if (title) title.textContent = `${this.mapName} · ${this.woz ? this.woz.modeCN() : '团队竞技'}`;
      this.hud.scoreboard(tab, this.actors, p.id, this.score, this.woz ? (a) => this.woz.roleLabel(a) : null);
    }
  }
}

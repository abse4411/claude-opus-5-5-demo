// WOZ 专用合成音效：独立小型 WebAudio 合成器（定位音量随距离衰减）
let ctx = null;
let gameRef = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function out(pos) {
  // 按与相机的距离做音量衰减
  const c = ac();
  const g = c.createGain();
  let vol = 1;
  if (pos && gameRef?.renderer) {
    const cam = gameRef.renderer.camera.position;
    const d = Math.hypot(pos.x - cam.x, pos.y - cam.y, pos.z - cam.z);
    vol = Math.max(0, 1 - d / 48) ** 1.4;
  }
  g.connect(c.destination);
  g.gain.value = 0;
  return { c, g, vol };
}

function env(g, t0, a, peak, d) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
}

function noiseBuf(c, dur) {
  const n = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return n;
}

function play(pos, build) {
  try {
    const { c, g, vol } = out(pos);
    if (vol <= 0.01) return;
    const t0 = c.currentTime + 0.01;
    build(c, g, t0, vol);
  } catch (e) { /* 音频失败不影响游戏 */ }
}

export const wozAudio = {
  mount(game) { gameRef = game; },

  // 变异嘶吼：锯齿低吼 + 呼吸噪声
  growl(pos) {
    play(pos, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(72, t0);
      o.frequency.exponentialRampToValueAtTime(46, t0 + 0.55);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 4;
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.5);
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 500; nf.Q.value = 0.7;
      const ng = c.createGain(); env(ng, t0, 0.08, 0.05 * v, 0.45);
      o.connect(f); f.connect(g);
      n.connect(nf); nf.connect(ng); ng.connect(g);
      env(g, t0, 0.06, 0.22 * v, 0.55);
      o.start(t0); o.stop(t0 + 0.7); n.start(t0); n.stop(t0 + 0.55);
    });
  },

  // 感染转化：上行咆哮
  convert(pos) {
    play(pos, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(55, t0);
      o.frequency.exponentialRampToValueAtTime(150, t0 + 0.7);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(240, t0);
      f.frequency.exponentialRampToValueAtTime(1400, t0 + 0.7); f.Q.value = 6;
      o.connect(f); f.connect(g);
      env(g, t0, 0.05, 0.3 * v, 0.85);
      o.start(t0); o.stop(t0 + 0.95);
    });
  },

  // 疾冲：噪声呼啸
  dash(pos) {
    play(pos, (c, g, t0, v) => {
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.35);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t0);
      f.frequency.exponentialRampToValueAtTime(2400, t0 + 0.28);
      n.connect(f); f.connect(g);
      env(g, t0, 0.02, 0.25 * v, 0.3);
      n.start(t0); n.stop(t0 + 0.35);
    });
  },

  // 致盲尖啸：高频颤音
  wail(pos) {
    play(pos, (c, g, t0, v) => {
      for (const [f0, f1, dt] of [[880, 1320, 1.1], [1175, 1760, 0.9]]) {
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + dt);
        const trem = c.createOscillator(); trem.frequency.value = 9;
        const tg = c.createGain(); tg.gain.value = 0.08;
        trem.connect(tg);
        tg.connect(g.gain); // 颤音调制总增益
        o.connect(g);
        const peak = 0.16 * v;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dt);
        o.start(t0); o.stop(t0 + dt + 0.05); trem.start(t0); trem.stop(t0 + dt + 0.05);
      }
    });
  },

  // 硬化：金属闷响
  harden(pos) {
    play(pos, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 170;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      o.connect(f); f.connect(g);
      env(g, t0, 0.005, 0.2 * v, 0.22);
      o.start(t0); o.stop(t0 + 0.25);
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.12);
      const nf = c.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 2000;
      const ng = c.createGain(); env(ng, t0, 0.003, 0.1 * v, 0.1);
      n.connect(nf); nf.connect(ng); ng.connect(g);
      n.start(t0); n.stop(t0 + 0.13);
    });
  },

  // 吞噬：湿嚼三连
  devour(pos) {
    play(pos, (c, g, t0, v) => {
      for (let i = 0; i < 3; i++) {
        const t = t0 + i * 0.13;
        const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.1);
        const f = c.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(900 - i * 200, t);
        const ng = c.createGain(); env(ng, t, 0.008, 0.22 * v, 0.09);
        n.connect(f); f.connect(ng); ng.connect(g);
        n.start(t); n.stop(t + 0.11);
      }
    });
  },

  // 投掷斧头（V26）：破空呼啸
  axeThrow(pos) {
    play(pos, (c, g, t0, v) => {
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.3);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(1600, t0);
      f.frequency.exponentialRampToValueAtTime(500, t0 + 0.26);
      const trem = c.createOscillator(); trem.frequency.value = 13; // 斧刃旋转切风
      const tg = c.createGain(); tg.gain.value = 0.12;
      trem.connect(tg); tg.connect(g.gain);
      n.connect(f); f.connect(g);
      env(g, t0, 0.01, 0.2 * v, 0.26);
      n.start(t0); n.stop(t0 + 0.3); trem.start(t0); trem.stop(t0 + 0.3);
    });
  },

  // 缠绕（V26）：触须鞭击 + 湿润收缩
  entangle(pos) {
    play(pos, (c, g, t0, v) => {
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.22);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(400, t0);
      f.frequency.exponentialRampToValueAtTime(2600, t0 + 0.1);
      f.frequency.exponentialRampToValueAtTime(300, t0 + 0.2);
      n.connect(f); f.connect(g);
      env(g, t0, 0.005, 0.24 * v, 0.2);
      n.start(t0); n.stop(t0 + 0.22);
      const o = c.createOscillator(); o.type = 'sawtooth'; // 湿性低鸣
      o.frequency.setValueAtTime(160, t0 + 0.08);
      o.frequency.exponentialRampToValueAtTime(70, t0 + 0.3);
      const og = c.createGain(); env(og, t0 + 0.08, 0.02, 0.12 * v, 0.22);
      o.connect(og); og.connect(g);
      o.start(t0 + 0.08); o.stop(t0 + 0.32);
    });
  },

  // 自爆引信（V26）：加速蜂鸣
  fuse(pos) {
    play(pos, (c, g, t0, v) => {
      for (let i = 0; i < 6; i++) {
        const t = t0 + i * (0.09 + i * 0.012);
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 980 + i * 60;
        const og = c.createGain(); env(og, t, 0.004, 0.1 * v, 0.05);
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 0.06);
      }
    });
  },

  // 人类必杀技（V26）：上行能量爆发
  ult() {
    play(null, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t0);
      o.frequency.exponentialRampToValueAtTime(720, t0 + 0.35);
      const f = c.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(600, t0);
      f.frequency.exponentialRampToValueAtTime(4200, t0 + 0.35);
      o.connect(f); f.connect(g);
      env(g, t0, 0.02, 0.2 * v, 0.5);
      o.start(t0); o.stop(t0 + 0.55);
      [440, 554, 659].forEach((f0, i) => { // 确认和弦
        const h = c.createOscillator(); h.type = 'triangle'; h.frequency.value = f0;
        const hg = c.createGain(); env(hg, t0 + 0.36 + i * 0.05, 0.01, 0.07 * v, 0.4);
        h.connect(hg); hg.connect(g);
        h.start(t0 + 0.36 + i * 0.05); h.stop(t0 + 0.9);
      });
    });
  },

  // 进化阶段升迁（V26）：变异咆哮上扬
  evo(pos) {
    play(pos, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(90, t0);
      o.frequency.exponentialRampToValueAtTime(240, t0 + 0.4);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
      o.connect(f); f.connect(g);
      env(g, t0, 0.04, 0.26 * v, 0.5);
      o.start(t0); o.stop(t0 + 0.55);
      const n = c.createBufferSource(); n.buffer = noiseBuf(c, 0.4); // 喉音气声
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1;
      nf.frequency.setValueAtTime(300, t0);
      nf.frequency.exponentialRampToValueAtTime(900, t0 + 0.35);
      const ng = c.createGain(); env(ng, t0, 0.05, 0.14 * v, 0.38);
      n.connect(nf); nf.connect(ng); ng.connect(g);
      n.start(t0); n.stop(t0 + 0.42);
    });
  },

  // 复仇者觉醒：上行电音和弦
  avenger(pos) {
    play(pos, (c, g, t0, v) => {
      [220, 277, 330, 440].forEach((f0, i) => {
        const o = c.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(f0, t0 + i * 0.07);
        const og = c.createGain();
        env(og, t0 + i * 0.07, 0.02, 0.09 * v, 0.6);
        o.connect(og); og.connect(g);
        o.start(t0 + i * 0.07); o.stop(t0 + i * 0.07 + 0.65);
      });
    });
  },

  // 尸潮来袭：低鸣号角
  tide() {
    play(null, (c, g, t0, v) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
      const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 61.5;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      o.connect(f); o2.connect(f); f.connect(g);
      env(g, t0, 0.25, 0.28 * Math.max(0.6, v), 1.6);
      o.start(t0); o.stop(t0 + 1.9); o2.start(t0); o2.stop(t0 + 1.9);
    });
  },
};

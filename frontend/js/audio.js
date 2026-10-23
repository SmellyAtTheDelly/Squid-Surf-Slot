/* Squid Squad — procedural audio: every sound and the music are synthesized with Web Audio, no files. */
(function () {
  'use strict';
  let ctx = null, master, comp, sfxBus, musicBus, ambBus, revIn, musicRevIn, noiseBuf, brownBuf;
  let muted = false, musicMuted = false;
  let effectsVolume = 1, musicVolume = 1, ducked = false;
  const MUSIC_VOL = 0.34;

  function volume(v, fallback) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
  function storedVolume(key) { const v = localStorage.getItem(key); return v == null || v.trim() === '' ? 1 : volume(v, 1); }

  function load() {
    try {
      muted = localStorage.getItem('ss_muted') === '1';
      musicMuted = localStorage.getItem('ss_music') === '0';
      effectsVolume = storedVolume('ss_effectsVolume');
      musicVolume = storedVolume('ss_musicVolume');
    } catch (e) { /* storage unavailable */ }
  }
  load();

  function gainNode(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }

  function makeNoise(sec) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function makeBrown(sec) {
    const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  function makeImpulse(sec, decay) {
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    master = gainNode(muted ? 0 : 0.9, comp);
    sfxBus = gainNode(0.85 * effectsVolume, master);
    musicBus = gainNode(musicGain(), master);
    ambBus = gainNode(0.55 * effectsVolume, master);
    const rev = ctx.createConvolver(), musicRev = ctx.createConvolver();
    rev.buffer = musicRev.buffer = makeImpulse(2.6, 2.4);
    revIn = gainNode(1);
    musicRevIn = gainNode(1);
    revIn.connect(rev); rev.connect(gainNode(0.55 / 0.85, sfxBus));
    musicRevIn.connect(musicRev); musicRev.connect(gainNode(0.55 / MUSIC_VOL, musicBus));
    noiseBuf = makeNoise(2);
    brownBuf = makeBrown(6);
    startAmbient();
  }

  function resume() { if (ctx && ctx.state !== 'running') ctx.resume(); }
  const now = () => ctx.currentTime;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- voice helpers ----------
  function env(g, t, a, peak, dur, curve) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (curve === 'lin') g.gain.linearRampToValueAtTime(0.0001, t + dur);
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function send(node, amt, dest) { if (amt) { const s = gainNode(amt); node.connect(s); s.connect(dest === musicBus ? musicRevIn : revIn); } }

  function tone(o) {
    const t = o.t != null ? o.t : now();
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.setValueAtTime(o.filter.f, t);
      if (o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t + (o.filter.dur || o.dur));
      f.Q.value = o.filter.q || 0.8;
      osc.connect(f); node = f;
    }
    const g = ctx.createGain();
    env(g, t, o.a || 0.005, o.vol != null ? o.vol : 0.3, o.dur, o.curve);
    node.connect(g); g.connect(o.dest || sfxBus);
    send(g, o.send, o.dest);
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1];
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.05);
    }
    osc.start(t); osc.stop(t + o.dur + 0.05);
    return osc;
  }

  function noise(o) {
    const t = o.t != null ? o.t : now();
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brownBuf : noiseBuf;
    src.loop = true;
    let node = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.setValueAtTime(o.filter.f, t);
      if (o.filter.f2) f.frequency.exponentialRampToValueAtTime(o.filter.f2, t + (o.filter.dur || o.dur));
      f.Q.value = o.filter.q || 0.8;
      src.connect(f); node = f;
    }
    const g = ctx.createGain();
    env(g, t, o.a || 0.004, o.vol != null ? o.vol : 0.2, o.dur, o.curve);
    node.connect(g); g.connect(o.dest || sfxBus);
    send(g, o.send, o.dest);
    src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.05);
    return src;
  }

  function bell(f, t, vol, dur, dest, sendAmt) {
    const parts = [[1, 1], [2.0, 0.5], [3.01, 0.28], [4.2, 0.18], [5.43, 0.1]];
    for (const [m, v] of parts) tone({ f: f * m, t, dur: dur * (1.2 - m * 0.12), vol: vol * v, a: 0.002, dest, send: sendAmt });
  }

  // ---------- sound effects ----------
  const fx = {
    click() { tone({ f: 1250, f2: 700, dur: 0.06, vol: 0.12 }); },
    hover() { tone({ f: 1800, f2: 1500, dur: 0.035, vol: 0.04 }); },
    bet(up) { tone({ f: up ? 660 : 520, f2: up ? 990 : 380, dur: 0.09, vol: 0.12, type: 'triangle' }); },
    spin() {
      noise({ dur: 0.38, vol: 0.16, a: 0.06, filter: { type: 'bandpass', f: 350, f2: 2600, q: 1.4 } });
      tone({ f: 260, f2: 120, dur: 0.22, vol: 0.18, type: 'sine' });
      tone({ f: 520, f2: 1040, dur: 0.12, vol: 0.05, type: 'triangle', t: now() + 0.03 });
    },
    reelStop(i) {
      const t = now();
      tone({ f: 150 - i * 6, f2: 52, dur: 0.16, vol: 0.42, t });
      noise({ t, dur: 0.07, vol: 0.14, filter: { type: 'lowpass', f: 2600, q: 0.5 } });
      tone({ f: 420 + i * 30, f2: 260, dur: 0.07, vol: 0.06, type: 'triangle', t });
    },
    scatterLand(n) {
      const f = [784, 988, 1175, 1397, 1568][Math.min(4, n)];
      bell(f, now(), 0.16, 1.6, sfxBus, 0.35);
      noise({ dur: 0.5, vol: 0.05, a: 0.01, filter: { type: 'highpass', f: 7000 }, send: 0.3 });
    },
    wildLand() {
      const t = now();
      tone({ f: 620, f2: 170, dur: 0.28, vol: 0.28, vib: [28, 40], t });
      tone({ f: 90, f2: 50, dur: 0.22, vol: 0.3, t });
      for (let i = 0; i < 4; i++) fx.bubble(t + 0.08 + i * 0.06, 0.06);
    },
    bubble(t, vol) {
      t = t || now();
      const f = 300 + Math.random() * 500;
      tone({ f, f2: f * (2.4 + Math.random()), dur: 0.07, vol: vol || 0.05, t, a: 0.003 });
    },
    winSmall() {
      const t = now();
      [74, 77, 81].forEach((m, i) => bell(mtof(m), t + i * 0.07, 0.11, 0.9, sfxBus, 0.25));
    },
    winMed() {
      const t = now();
      [74, 77, 81, 86, 89].forEach((m, i) => bell(mtof(m), t + i * 0.065, 0.12, 1.1, sfxBus, 0.3));
      noise({ t: t + 0.3, dur: 0.6, vol: 0.05, filter: { type: 'highpass', f: 6000 }, send: 0.3 });
    },
    coin() {
      const f = 2400 + Math.random() * 900;
      tone({ f, dur: 0.12, vol: 0.05, a: 0.001 });
      tone({ f: f * 1.5, dur: 0.08, vol: 0.03, a: 0.001 });
    },
    tick() { tone({ f: 1900 + Math.random() * 300, dur: 0.03, vol: 0.05, type: 'triangle' }); },
    bigWin(tier) {
      const t = now();
      const roots = [62, 65, 69][Math.min(2, tier)];
      // brass stab chord
      for (const iv of [0, 4, 7, 12]) {
        for (const d of [-8, 8]) tone({ f: mtof(roots + iv - 12), dur: 1.6, vol: 0.07, a: 0.02, type: 'sawtooth', detune: d, t, filter: { type: 'lowpass', f: 600, f2: 3200, dur: 0.15, q: 1 }, send: 0.25 });
      }
      // timpani + crash
      tone({ f: 110, f2: 62, dur: 0.9, vol: 0.5, t });
      noise({ t, dur: 0.25, vol: 0.18, filter: { type: 'lowpass', f: 400 } });
      noise({ t, dur: 2.2, vol: 0.12, filter: { type: 'highpass', f: 5000 }, send: 0.4 });
      [0, 1, 2, 3].forEach(i => bell(mtof(roots + 24 + [0, 4, 7, 12][i]), t + 0.12 + i * 0.08, 0.08, 1.4, sfxBus, 0.35));
    },
    tierUp() {
      const t = now();
      noise({ t, dur: 0.6, vol: 0.12, a: 0.2, filter: { type: 'bandpass', f: 500, f2: 5000, q: 2 } });
      tone({ f: 220, f2: 880, dur: 0.5, vol: 0.08, type: 'sawtooth', t, filter: { type: 'lowpass', f: 1500 } });
    },
    bonusTrigger() {
      const t = now();
      // gong
      [[73, 0.3], [146.8, 0.15], [197, 0.12], [263, 0.08], [341, 0.06]].forEach(([f, v]) => tone({ f, dur: 3.5, vol: v, a: 0.01, t, send: 0.5 }));
      noise({ t, dur: 1.5, vol: 0.12, filter: { type: 'lowpass', f: 900 }, send: 0.4 });
      // rising swirl
      for (let i = 0; i < 10; i++) bell(mtof(62 + [0, 3, 7, 10, 12, 15, 19, 22, 24, 27][i]), t + 0.4 + i * 0.07, 0.07, 1.1, sfxBus, 0.4);
    },
    fsStart() {
      const t = now();
      [62, 65, 69, 72, 74, 77, 81, 86].forEach((m, i) => bell(mtof(m), t + i * 0.05, 0.09, 1.5, sfxBus, 0.45));
      tone({ f: 55, f2: 36, dur: 1.4, vol: 0.4, t });
    },
    ink() {
      const t = now();
      noise({ t, dur: 0.35, vol: 0.28, filter: { type: 'lowpass', f: 2200, f2: 180, q: 3 } });
      tone({ f: 180, f2: 60, dur: 0.3, vol: 0.3, t, vib: [20, 25] });
    },
    whoosh() { noise({ dur: 0.45, vol: 0.12, a: 0.12, filter: { type: 'bandpass', f: 500, f2: 1800, q: 2.5 } }); },
    swoosh() { noise({ dur: 0.9, vol: 0.2, a: 0.25, filter: { type: 'bandpass', f: 200, f2: 900, q: 1.5 } }); },
    rumble(dur) { noise({ brown: true, dur: dur || 1.6, vol: 0.6, a: 0.15, filter: { type: 'lowpass', f: 220 } }); },
    squadAlarm() {
      const t = now();
      for (let i = 0; i < 2; i++) {
        tone({ f: mtof(62), dur: 0.26, vol: 0.12, type: 'square', t: t + i * 0.5, filter: { type: 'lowpass', f: 900 }, a: 0.02 });
        tone({ f: mtof(57), dur: 0.26, vol: 0.12, type: 'square', t: t + i * 0.5 + 0.25, filter: { type: 'lowpass', f: 900 }, a: 0.02 });
      }
      fx.rumble(1.2);
    },
    sticky() {
      const t = now();
      tone({ f: 1400, f2: 1100, dur: 0.12, vol: 0.12, type: 'square', t, filter: { type: 'bandpass', f: 2500, q: 4 } });
      tone({ f: 2100, f2: 1700, dur: 0.1, vol: 0.08, type: 'square', t: t + 0.06, filter: { type: 'bandpass', f: 3200, q: 4 } });
      tone({ f: 95, f2: 45, dur: 0.35, vol: 0.4, t });
    },
    mult() {
      const t = now();
      [81, 86, 93].forEach((m, i) => tone({ f: mtof(m), dur: 0.25, vol: 0.07, t: t + i * 0.05, type: 'triangle', send: 0.3 }));
    },
    retrigger() { fx.fsStart(); fx.winMed(); },
    transition() {
      const t = now();
      noise({ t, dur: 1.4, vol: 0.32, a: 0.4, filter: { type: 'lowpass', f: 300, f2: 1600, dur: 0.6 } });
      tone({ f: 60, f2: 30, dur: 1.5, vol: 0.45, t: t + 0.1 });
    },
    denied() { tone({ f: 220, f2: 160, dur: 0.18, vol: 0.12, type: 'square', filter: { type: 'lowpass', f: 800 } }); },
    totalWin() { fx.bigWin(0); },
    // ---- bonus games ----
    chestShake() {
      const t = now();
      for (let i = 0; i < 6; i++) noise({ t: t + i * 0.055, dur: 0.05, vol: 0.13, filter: { type: 'bandpass', f: 600 + Math.random() * 400, q: 3 } });
      tone({ f: 95, f2: 70, dur: 0.35, vol: 0.14, t });
    },
    chestOpen() {
      const t = now();
      tone({ f: 260, f2: 140, dur: 0.35, vol: 0.07, type: 'sawtooth', t, filter: { type: 'bandpass', f: 900, q: 6 } });
      noise({ t, dur: 0.22, vol: 0.2, filter: { type: 'lowpass', f: 3200 } });
      tone({ f: 72, f2: 40, dur: 0.45, vol: 0.45, t });
      [79, 83, 86, 91].forEach((m, i) => bell(mtof(m), t + 0.05 + i * 0.05, 0.07, 1.0, sfxBus, 0.3));
    },
    coins(n) {
      const t = now();
      for (let i = 0; i < (n || 12); i++) {
        const f = 2200 + Math.random() * 1600;
        tone({ f, dur: 0.1, vol: 0.04, a: 0.001, t: t + i * 0.035 + Math.random() * 0.02 });
        tone({ f: f * 1.5, dur: 0.06, vol: 0.02, a: 0.001, t: t + i * 0.035 });
      }
    },
    roar() {
      const t = now();
      for (const d of [-22, 0, 17]) tone({ f: 60, f2: 36, glide: 1.7, dur: 1.9, vol: 0.17, a: 0.08, type: 'sawtooth', detune: d, t, filter: { type: 'lowpass', f: 460, f2: 170, dur: 1.7, q: 2 }, vib: [27, 7], send: 0.45 });
      noise({ brown: true, t, dur: 1.9, vol: 0.55, a: 0.1, filter: { type: 'lowpass', f: 320 } });
      noise({ t, dur: 1.0, vol: 0.13, a: 0.05, filter: { type: 'bandpass', f: 420, f2: 150, q: 3 } });
      tone({ f: 46, f2: 26, dur: 1.3, vol: 0.55, t });
    },
    pearlLand(k) {
      const t = now(), f = mtof(84 + Math.min(12, (k || 0) * 2));
      bell(f, t, 0.12, 1.2, sfxBus, 0.4);
      tone({ f: f * 0.5, dur: 0.25, vol: 0.06, t, type: 'triangle' });
      fx.bubble(t + 0.03, 0.05);
    },
    jackpotPearl() { const t = now(); [72, 76, 79, 84, 88].forEach((m, i) => bell(mtof(m), t + i * 0.06, 0.1, 1.4, sfxBus, 0.4)); },
    goldPearl() {
      const t = now();
      for (let i = 0; i < 12; i++) bell(mtof(72 + i * 2), t + i * 0.04, 0.06, 1.0, sfxBus, 0.45);
      noise({ t, dur: 1, vol: 0.06, a: 0.3, filter: { type: 'highpass', f: 6000 }, send: 0.5 });
    },
    respinReset() { const t = now(); [79, 84, 88].forEach((m, i) => tone({ f: mtof(m), dur: 0.22, vol: 0.08, t: t + i * 0.07, type: 'triangle', send: 0.3 })); },
    respinLose() { tone({ f: 440, f2: 290, dur: 0.28, vol: 0.07, type: 'triangle' }); },
    cellSpin() { noise({ dur: 0.18, vol: 0.05, a: 0.03, filter: { type: 'bandpass', f: 1800, f2: 900, q: 2 } }); },
    lifeGain() { const t = now(); bell(mtof(84), t, 0.12, 1.2, sfxBus, 0.4); bell(mtof(91), t + 0.1, 0.12, 1.4, sfxBus, 0.4); },
    lifeLose() { tone({ f: 330, f2: 100, dur: 0.7, vol: 0.13, type: 'sawtooth', filter: { type: 'lowpass', f: 900 } }); },
    multUp() { const t = now(); [76, 83, 88, 95].forEach((m, i) => tone({ f: mtof(m), dur: 0.3, vol: 0.07, t: t + i * 0.05, type: 'triangle', send: 0.35 })); },
    wheelTick() {
      tone({ f: 1700 + Math.random() * 200, f2: 900, dur: 0.035, vol: 0.09, a: 0.001 });
      noise({ dur: 0.02, vol: 0.05, filter: { type: 'highpass', f: 4000 } });
    },
    wheelStart() { fx.swoosh(); fx.spin(); },
    wheelStop() {
      const t = now();
      tone({ f: 98, f2: 60, dur: 1.2, vol: 0.4, t });
      [74, 78, 81, 86].forEach((m, i) => bell(mtof(m), t + i * 0.08, 0.1, 1.6, sfxBus, 0.45));
      noise({ t, dur: 1.8, vol: 0.1, filter: { type: 'highpass', f: 5000 }, send: 0.4 });
    },
    cardHover() { tone({ f: 1500, f2: 1900, dur: 0.06, vol: 0.04, type: 'triangle' }); },
    // bonus-buy dive: a sonar ping that drops in pitch the deeper the station, the winch rattling, and the plunge
    sonar(depth) {
      const t = now(), f = [1320, 1100, 900, 720][depth || 0];
      tone({ f, dur: 1.2, vol: 0.09, a: 0.004, t, send: 0.7 });
      tone({ f: f * 2.01, dur: 0.4, vol: 0.02, a: 0.004, t, send: 0.5 });
      tone({ f, dur: 0.9, vol: 0.03, a: 0.004, t: t + 0.34, send: 0.7 });
      for (let i = 0; i < 3; i++) fx.bubble(t + 0.12 + i * 0.07, 0.03);
    },
    winch() {
      const t = now();
      for (let i = 0; i < 8; i++) noise({ t: t + i * 0.05, dur: 0.035, vol: 0.045, filter: { type: 'bandpass', f: 2200 + Math.random() * 1600, q: 4 } });
      tone({ f: 150, f2: 90, dur: 0.45, vol: 0.1, t, type: 'triangle', filter: { type: 'lowpass', f: 600 } });
    },
    anteOn() {
      const t = now();
      [72, 79, 84].forEach((m, i) => bell(mtof(m), t + i * 0.06, 0.08, 1.1, sfxBus, 0.4));
      tone({ f: 220, f2: 440, dur: 0.25, vol: 0.12, t, type: 'triangle' });
      for (let i = 0; i < 6; i++) fx.bubble(t + 0.05 + i * 0.05, 0.045);
    },
    anteOff() {
      const t = now();
      tone({ f: 660, f2: 260, dur: 0.22, vol: 0.12, t, type: 'triangle' });
      tone({ f: 140, f2: 90, dur: 0.2, vol: 0.12, t });
    },
    plunge() {
      const t = now();
      noise({ t, dur: 1.2, vol: 0.26, a: 0.02, filter: { type: 'lowpass', f: 3200, f2: 160, dur: 1.1 } });
      tone({ f: 190, f2: 38, dur: 1.2, vol: 0.34, t });
      for (let i = 0; i < 14; i++) fx.bubble(t + 0.04 + i * 0.04, 0.055);
      bell(mtof(62), t + 0.08, 0.05, 1.8, sfxBus, 0.6);
    },
    cardPick() {
      const t = now();
      noise({ t, dur: 0.9, vol: 0.2, a: 0.05, filter: { type: 'lowpass', f: 2400, f2: 200, dur: 0.8 } });
      tone({ f: 300, f2: 60, dur: 0.9, vol: 0.25, t });
      for (let i = 0; i < 6; i++) fx.bubble(t + 0.1 + i * 0.05, 0.06);
    },
    awaken() {
      fx.roar();
      const t = now();
      [50, 53, 57, 62].forEach(m => tone({ f: mtof(m), dur: 2.4, vol: 0.06, a: 0.3, type: 'sawtooth', t: t + 0.2, filter: { type: 'lowpass', f: 700 }, send: 0.4 }));
    },
    rage() { const t = now(); tone({ f: 72, f2: 40, dur: 0.25, vol: 0.35, t }); tone({ f: 72, f2: 40, dur: 0.25, vol: 0.25, t: t + 0.2 }); },
    jackpot(tier) { fx.bigWin(Math.min(2, tier || 0)); fx.goldPearl(); },
  };

  // ---------- anticipation (looping tension) ----------
  let ant = null;
  function anticipationStart() {
    if (!ctx || ant) return;
    const t = now();
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(2400, t + 3.5);
    const oscs = [0, 7, 12].map((iv, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(mtof(50 + iv), t); o.frequency.linearRampToValueAtTime(mtof(62 + iv), t + 3.5);
      o.detune.value = i * 6; o.connect(f); o.start(t); return o;
    });
    const trem = ctx.createOscillator(), tg = ctx.createGain();
    trem.frequency.value = 9; tg.gain.value = 0.05; trem.connect(tg); tg.connect(g.gain); trem.start(t);
    f.connect(g); g.connect(sfxBus); send(g, 0.2);
    const nz = noise({ dur: 6, vol: 0.05, a: 0.4, filter: { type: 'highpass', f: 5000 } });
    ant = { g, oscs, trem, nz };
  }
  function anticipationStop() {
    if (!ant) return;
    const t = now();
    ant.g.gain.cancelScheduledValues(t);
    ant.g.gain.setValueAtTime(ant.g.gain.value, t);
    ant.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    ant.oscs.forEach(o => o.stop(t + 0.2)); ant.trem.stop(t + 0.2);
    try { ant.nz.stop(t + 0.05); } catch (e) { /* already stopped */ }
    ant = null;
  }

  // ---------- coin count loop ----------
  let countTimer = null;
  function countStart(rate) {
    countStop();
    countTimer = setInterval(() => { if (Math.random() < 0.7) fx.coin(); else fx.tick(); }, rate || 70);
  }
  function countStop() { if (countTimer) { clearInterval(countTimer); countTimer = null; } }

  // ---------- ambient underwater bed ----------
  function startAmbient() {
    const src = ctx.createBufferSource(); src.buffer = brownBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.7;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.06; lg.gain.value = 140; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    const g = gainNode(0.22);
    src.connect(f); f.connect(g); g.connect(ambBus); src.start();
    // whale-ish distant moan every so often + random bubbles
    const bubbleLoop = () => {
      if (ctx && !muted) {
        const n = 1 + Math.floor(Math.random() * 4), t = now();
        for (let i = 0; i < n; i++) fx.bubble(t + i * (0.05 + Math.random() * 0.08), 0.018 + Math.random() * 0.02);
      }
      setTimeout(bubbleLoop, 1500 + Math.random() * 4000);
    };
    setTimeout(bubbleLoop, 2000);
    const moan = () => {
      if (ctx && !muted) {
        const t = now(), b = 90 + Math.random() * 60;
        tone({ f: b, f2: b * 1.5, glide: 2.5, dur: 4, vol: 0.035, a: 1.2, curve: 'lin', type: 'triangle', dest: ambBus, send: 0.8, vib: [4, 3], filter: { type: 'lowpass', f: 600 } });
      }
      setTimeout(moan, 22000 + Math.random() * 25000);
    };
    setTimeout(moan, 9000);
  }

  // ---------- music ----------
  const CH = {
    Dm: { root: 50, tones: [62, 65, 69] }, C: { root: 48, tones: [60, 64, 67] }, Bb: { root: 46, tones: [58, 62, 65] },
    A: { root: 45, tones: [57, 61, 64] }, Gm: { root: 43, tones: [55, 58, 62] }, F: { root: 41, tones: [57, 60, 65] },
    Em: { root: 40, tones: [59, 64, 67] }, G: { root: 43, tones: [59, 62, 67] }, D: { root: 38, tones: [57, 62, 66] },
    Am: { root: 45, tones: [57, 60, 64] }, E: { root: 40, tones: [56, 59, 64] },
  };
  // Pearl Reef: dreamy bell arpeggios in E minor
  const REEF_MEL = [[0, 0, 79, 3], [0, 3, 78, 3], [1, 0, 76, 4], [1, 4, 74, 2], [2, 0, 74, 3], [2, 3, 79, 3], [3, 0, 78, 6]];
  // Captain's Vault: sneaky pizzicato in A minor
  const VAULT_MEL = [
    [0, 0, 69, 1], [0, 1, 72, 1], [0, 2, 76, 1], [0, 3, 75, 2], [0, 5, 76, 1], [1, 0, 77, 2], [1, 2, 74, 1], [1, 3, 77, 1], [1, 4, 81, 2],
    [2, 0, 80, 1], [2, 1, 76, 1], [2, 2, 71, 1], [2, 3, 74, 2], [2, 5, 80, 1], [3, 0, 81, 3], [3, 3, 69, 3],
  ];
  // Wheel of the Deep: heroic fanfare in D major
  const WHEEL_MEL = [[0, 0, 74, 2], [0, 2, 78, 1], [0, 3, 81, 3], [1, 0, 83, 2], [1, 2, 81, 1], [1, 3, 79, 3], [2, 0, 76, 2], [2, 2, 78, 1], [2, 3, 79, 1], [2, 4, 81, 2], [3, 0, 86, 6]];
  // Choose your dive: slow and mysterious
  const SELECT_MEL = [[0, 0, 81, 6], [1, 0, 77, 6], [2, 0, 79, 6], [3, 0, 76, 3], [3, 3, 73, 3]];
  // [bar, eighth, midi, lengthInEighths]  — 6/8 sea-shanty in D minor
  const BASE_MEL = [
    [0, 0, 69, 2], [0, 2, 74, 1], [0, 3, 74, 2], [0, 5, 76, 1],
    [1, 0, 77, 2], [1, 2, 76, 1], [1, 3, 74, 3],
    [2, 0, 72, 2], [2, 2, 74, 1], [2, 3, 76, 2], [2, 5, 72, 1],
    [3, 0, 67, 2], [3, 2, 69, 1], [3, 3, 72, 3],
    [4, 0, 74, 2], [4, 2, 70, 1], [4, 3, 77, 2], [4, 5, 74, 1],
    [5, 0, 76, 2], [5, 2, 72, 1], [5, 3, 67, 2], [5, 5, 72, 1],
    [6, 0, 69, 2], [6, 2, 74, 1], [6, 3, 77, 2], [6, 5, 76, 1],
    [7, 0, 73, 3], [7, 3, 69, 3],
  ];
  const BONUS_MEL = [
    [0, 0, 74, 1], [0, 1, 74, 1], [0, 2, 77, 1], [0, 3, 81, 1], [0, 4, 77, 1], [0, 5, 74, 1],
    [1, 0, 74, 1], [1, 1, 74, 1], [1, 2, 77, 1], [1, 3, 82, 1], [1, 4, 77, 1], [1, 5, 74, 1],
    [2, 0, 79, 1], [2, 1, 77, 1], [2, 2, 74, 1], [2, 3, 70, 1], [2, 4, 74, 1], [2, 5, 79, 1],
    [3, 0, 73, 1], [3, 1, 76, 1], [3, 2, 81, 2], [3, 4, 76, 1], [3, 5, 73, 1],
  ];
  const THEMES = {
    base: { eighth: 0.29, chords: ['Dm', 'Dm', 'C', 'C', 'Bb', 'C', 'Dm', 'A'], mel: BASE_MEL },
    bonus: { eighth: 0.205, chords: ['Dm', 'Bb', 'Gm', 'A'], mel: BONUS_MEL },
    reef: { eighth: 0.25, chords: ['Em', 'C', 'G', 'D'], mel: REEF_MEL },
    vault: { eighth: 0.19, chords: ['Am', 'Dm', 'E', 'Am'], mel: VAULT_MEL },
    wheel: { eighth: 0.21, chords: ['D', 'G', 'A', 'D'], mel: WHEEL_MEL },
    select: { eighth: 0.34, chords: ['Dm', 'Bb', 'Gm', 'A'], mel: SELECT_MEL },
  };
  const music = { on: false, theme: 'base', pending: null, step: 0, next: 0, timer: null };

  function marimba(m, t, dur, vol) {
    const f = mtof(m);
    tone({ f, t, dur: Math.max(0.35, dur), vol, a: 0.003, dest: musicBus, send: 0.25 });
    tone({ f: f * 4, t, dur: 0.08, vol: vol * 0.25, a: 0.001, dest: musicBus });
    tone({ f: f * 2, t, dur: 0.25, vol: vol * 0.2, a: 0.002, dest: musicBus });
  }
  function squeeze(m, t, dur, vol) { // accordion-ish
    for (const d of [-7, 7]) tone({ f: mtof(m), t, dur, vol, a: 0.02, type: 'sawtooth', detune: d, dest: musicBus, filter: { type: 'lowpass', f: 1400, q: 0.6 }, curve: 'lin', send: 0.12 });
  }
  function pluckBass(m, t, dur, vol) {
    tone({ f: mtof(m), t, dur, vol, a: 0.004, type: 'triangle', dest: musicBus, filter: { type: 'lowpass', f: 900, f2: 200, dur } });
    tone({ f: mtof(m), t, dur: dur * 0.6, vol: vol * 0.6, a: 0.004, type: 'sine', dest: musicBus });
  }
  function strings(m, t, dur, vol) {
    for (const d of [-9, 0, 9]) tone({ f: mtof(m), t, dur, vol, a: 0.015, type: 'sawtooth', detune: d, dest: musicBus, filter: { type: 'lowpass', f: 2600, f2: 900, dur }, send: 0.2 });
  }
  function shaker(t, vol) { noise({ t, dur: 0.05, vol, filter: { type: 'highpass', f: 7000 }, dest: musicBus }); }
  function kick(t, vol) { tone({ f: 130, f2: 42, dur: 0.18, vol, t, dest: musicBus }); }
  function tom(t, vol, f) { tone({ f: f || 160, f2: (f || 160) * 0.55, dur: 0.28, vol, t, dest: musicBus, send: 0.15 }); noise({ t, dur: 0.06, vol: vol * 0.3, filter: { type: 'lowpass', f: 1200 }, dest: musicBus }); }
  function snare(t, vol) { noise({ t, dur: 0.14, vol, filter: { type: 'bandpass', f: 2200, q: 0.7 }, dest: musicBus, send: 0.15 }); tone({ f: 220, f2: 150, dur: 0.08, vol: vol * 0.5, t, dest: musicBus }); }

  function playStep(step, t) {
    const th = THEMES[music.theme];
    const bars = th.chords.length;
    const e = step % 6, bar = Math.floor(step / 6) % bars, loop = Math.floor(step / (6 * bars));
    const ch = CH[th.chords[bar]];
    const E = th.eighth;
    if (music.theme === 'base') {
      if (e === 0) { pluckBass(ch.root - 12 + 12, t, E * 2.5, 0.32); kick(t, 0.18); }
      if (e === 3) pluckBass(ch.root + 7, t, E * 2.5, 0.26);
      if (e === 1 || e === 2 || e === 4 || e === 5) for (const m of ch.tones) squeeze(m - 12, t, E * 0.7, 0.018);
      shaker(t, e === 0 || e === 3 ? 0.05 : 0.025);
      for (const n of th.mel) {
        if (n[0] === bar && n[1] === e) {
          if (loop % 2 === 0) marimba(n[2], t, n[3] * E, 0.14);
          else { squeeze(n[2], t, n[3] * E * 0.95, 0.03); marimba(n[2] + 12, t, n[3] * E, 0.05); }
        }
      }
    } else if (music.theme === 'reef') {
      // shimmering bell arpeggio over a soft pad
      const arp = [0, 1, 2, 1, 2, 0];
      const m = ch.tones[arp[e]] + 12 + (e === 4 ? 12 : 0);
      tone({ f: mtof(m), t, dur: 1.4, vol: 0.05, a: 0.004, dest: musicBus, send: 0.5 });
      tone({ f: mtof(m) * 3, t, dur: 0.4, vol: 0.012, a: 0.002, dest: musicBus, send: 0.5 });
      if (e === 0) {
        for (const tn of ch.tones) squeeze(tn - 12, t, E * 6, 0.012);
        pluckBass(ch.root, t, E * 5, 0.22);
      }
      if (e === 0 || e === 3) shaker(t, 0.02);
      for (const n of th.mel) if (n[0] === bar && n[1] === e && loop % 2 === 1) marimba(n[2], t, n[3] * E, 0.08);
    } else if (music.theme === 'vault') {
      // pizzicato strings and a ticking clock
      const pluck = (m, v) => tone({ f: mtof(m), t, dur: 0.16, vol: v, a: 0.002, type: 'triangle', dest: musicBus, filter: { type: 'lowpass', f: 2400 } });
      if (e === 0 || e === 3) pluck(ch.root + (e === 3 ? 7 : 0), 0.28);
      else for (const tn of ch.tones) pluck(tn - 12, 0.05);
      tone({ f: e % 2 ? 2600 : 3200, t, dur: 0.03, vol: 0.025, a: 0.001, dest: musicBus });
      if (e === 0) kick(t, 0.12);
      for (const n of th.mel) if (n[0] === bar && n[1] === e) marimba(n[2] + (loop % 2 ? 12 : 0), t, n[3] * E, 0.09);
    } else if (music.theme === 'wheel') {
      // brass fanfare with toms and a snare pickup
      if (e === 0 || e === 3) {
        for (const tn of ch.tones) for (const d of [-8, 8]) tone({ f: mtof(tn), t, dur: E * 2.4, vol: 0.016, a: 0.02, type: 'sawtooth', detune: d, dest: musicBus, filter: { type: 'lowpass', f: 700, f2: 2600, dur: 0.12 }, send: 0.25 });
        tom(t, 0.26, e === 0 ? 100 : 130);
        pluckBass(ch.root + 12, t, E * 2.5, 0.28);
      }
      if (e === 5) { snare(t, 0.08); snare(t + E * 0.5, 0.1); }
      shaker(t, 0.03);
      for (const n of th.mel) if (n[0] === bar && n[1] === e) { marimba(n[2], t, n[3] * E, 0.1); squeeze(n[2], t, n[3] * E * 0.9, 0.02); }
    } else if (music.theme === 'select') {
      // slow pads, heartbeat, a lone bell
      if (e === 0) {
        for (const tn of ch.tones) strings(tn - 12, t, E * 6.5, 0.014);
        pluckBass(ch.root - 12 + 12, t, E * 5, 0.24);
      }
      if (e === 0) kick(t, 0.22);
      if (e === 1) kick(t, 0.14);
      for (const n of th.mel) if (n[0] === bar && n[1] === e) tone({ f: mtof(n[2]), t, dur: 2.4, vol: 0.06, a: 0.01, dest: musicBus, send: 0.6 });
    } else {
      pluckBass(ch.root + (e === 3 ? 12 : 0), t, E * 0.9, 0.3);
      if (e === 0 || e === 3) { tom(t, 0.3, e === 0 ? 110 : 140); kick(t, 0.25); }
      if (e === 3) snare(t, 0.12);
      shaker(t, e % 3 === 0 ? 0.06 : 0.035);
      if (e === 0) for (const m of ch.tones) strings(m, t, E * 2.6, 0.022);
      if (e === 4) for (const m of ch.tones) strings(m + 12, t, E * 0.8, 0.016);
      for (const n of th.mel) {
        if (n[0] === bar && n[1] === e) {
          const oct = loop % 2 === 0 ? 0 : -12;
          marimba(n[2] + oct, t, n[3] * E, 0.11);
          if (loop % 2 === 1) squeeze(n[2] + oct, t, n[3] * E * 0.9, 0.02);
        }
      }
    }
  }

  function schedule() {
    if (!ctx) return;
    while (music.next < ctx.currentTime + 0.18) {
      if (music.pending && music.step % 6 === 0) { music.theme = music.pending; music.pending = null; music.step = 0; }
      playStep(music.step, music.next);
      music.next += THEMES[music.theme].eighth;
      music.step++;
    }
  }
  function startMusic(theme) {
    if (!ctx) return;
    if (!music.on) {
      music.on = true; music.theme = theme; music.step = 0; music.next = ctx.currentTime + 0.12;
      music.timer = setInterval(schedule, 30);
    } else if (theme !== music.theme) music.pending = theme;
  }
  function musicGain() { return musicMuted ? 0 : MUSIC_VOL * musicVolume * (ducked ? 0.3 : 1); }
  function fadeGain(node, value, duration) {
    if (!ctx) return;
    const t = now(), p = node.gain;
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
    p.linearRampToValueAtTime(value, t + duration);
  }
  function duck(on) {
    ducked = !!on;
    if (ctx) fadeGain(musicBus, musicGain(), 0.4);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('ss_muted', muted ? '1' : '0'); } catch (e) {}
    if (ctx) fadeGain(master, muted ? 0 : 0.9, 0.05);
  }
  function setMusicMuted(m) {
    musicMuted = !!m;
    try { localStorage.setItem('ss_music', musicMuted ? '0' : '1'); } catch (e) {}
    if (ctx) fadeGain(musicBus, musicGain(), 0.1);
  }
  function setEffectsVolume(v) {
    effectsVolume = volume(v, effectsVolume);
    try { localStorage.setItem('ss_effectsVolume', String(effectsVolume)); } catch (e) {}
    if (ctx) { fadeGain(sfxBus, 0.85 * effectsVolume, 0.05); fadeGain(ambBus, 0.55 * effectsVolume, 0.05); }
    return effectsVolume;
  }
  function setMusicVolume(v) {
    musicVolume = volume(v, musicVolume);
    try { localStorage.setItem('ss_musicVolume', String(musicVolume)); } catch (e) {}
    if (ctx) fadeGain(musicBus, musicGain(), 0.05);
    return musicVolume;
  }

  function play(name, ...args) {
    if (!ctx || muted) return;
    const f = fx[name];
    if (f) { try { f(...args); } catch (e) { console.warn('sfx', name, e); } }
  }

  window.SFX = {
    init, resume, play, startMusic, duck, setMuted, setMusicMuted, setEffectsVolume, setMusicVolume,
    isMuted: () => muted, isMusicMuted: () => musicMuted,
    getEffectsVolume: () => effectsVolume, getMusicVolume: () => musicVolume,
    anticipationStart: () => { if (ctx && !muted) anticipationStart(); }, anticipationStop,
    countStart: r => { if (ctx && !muted) countStart(r); }, countStop,
  };
})();

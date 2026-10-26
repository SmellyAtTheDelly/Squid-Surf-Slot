/* Squid Squad — living ocean: depth-layered sea creatures, kelp, bubbles, plankton and light. Screen-space (CSS px). */
(function () {
  'use strict';
  const { TAU, rnd, clamp, lerp } = window.FX;
  const PAL = ['12,62,92', '70,6,12'];          // depth tint: base game blue / bonus blood red
  const DEPTHS = [{ amt: 0.62, blur: 2.2, sat: 0.7 }, { amt: 0.42, blur: 0.9, sat: 0.8 }, { amt: 0.2, blur: 0.3, sat: 0.88 }];
  const SPR = {};
  const life = [];
  let bubbles = [], bokeh = [], plankton = [], glows = [], kelps = [];
  let W = 1, H = 1, hs = 1;
  // per-scene switches: the vault is indoors (no creatures, kelp or sun rays)
  const opts = { creatures: true, kelp: true, rays: true };
  function setScene(o) { Object.assign(opts, o); }
  const timers = { fish: 1.5, school: 6, turtle: 16, manta: 24, squid: 9, bubble: 0, bokeh: 3 };
  let rayTex = [null, null], bubbleSpr = null, bubbleSoft = null, glowSpr = [null, null], dotSpr = null;

  function cv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

  // ---------- sprite preparation ----------
  function variant(img, pal, depth, maxW, extraDark) {
    const s = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const pad = Math.ceil(depth.blur * 3.5) + 3;
    const c = cv(w + pad * 2, h + pad * 2), g = c.getContext('2d');
    if ('filter' in g) g.filter = `${depth.blur ? `blur(${depth.blur}px) ` : ''}saturate(${depth.sat || 0.85})`;
    g.drawImage(img, pad, pad, w, h);
    if ('filter' in g) g.filter = 'none';
    g.globalCompositeOperation = 'source-atop';
    const amt = Math.min(0.95, depth.amt + (extraDark || 0));
    g.fillStyle = `rgba(${pal},${amt})`; g.fillRect(0, 0, c.width, c.height);
    // gentle top light so creatures read as lit from the surface
    const lg = g.createLinearGradient(0, 0, 0, c.height);
    lg.addColorStop(0, `rgba(190,240,255,${0.14 * (1 - amt)})`); lg.addColorStop(0.5, 'rgba(190,240,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function prep(img, maxW, extraDark) {
    // [palette][depth]
    return PAL.map(pal => DEPTHS.map(d => variant(img, pal, d, maxW, extraDark)));
  }
  function init(IMG) {
    if (window.SpriteGL) SpriteGL.init();
    SPR.yellow = prep(IMG.f_yellow, 360);
    SPR.purple = prep(IMG.f_purple, 360);
    SPR.sardine = prep(IMG.f_sardine, 150);
    SPR.manta = prep(IMG.f_manta, 420, 0.1);
    SPR.squid = PAL.map(pal => [variant(IMG.f_bigsquid, pal, { amt: 0.8, blur: 3 }, 1100)]);
    SPR.turtle = prep(IMG.f_turtle, 460);
    SPR.kelp = PAL.map(pal => [variant(IMG.f_kelp, pal, { amt: 0.55, blur: 1.5 }, 300), variant(IMG.f_kelp, pal, { amt: 0.48, blur: 0 }, 340)]);
    SPR.jelly = PAL.map((pal, i) => DEPTHS.map(d => variant(IMG.f_jelly, i ? '255,60,40' : pal, { amt: d.amt * 0.35, blur: d.blur }, 260)));
    buildParticles();
  }
  function buildParticles() {
    // high quality bubble: refractive body, bright rim with a hint of iridescence, two speculars
    const N = 96;
    bubbleSpr = cv(N, N);
    let g = bubbleSpr.getContext('2d'), c = N / 2;
    let gr = g.createRadialGradient(c, c, N * 0.1, c, c, N * 0.49);
    gr.addColorStop(0, 'rgba(160,230,255,0.03)'); gr.addColorStop(0.68, 'rgba(160,230,255,0.10)');
    gr.addColorStop(0.86, 'rgba(210,248,255,0.42)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, N * 0.49, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = N * 0.025;
    g.strokeStyle = 'rgba(255,140,230,0.35)'; g.beginPath(); g.arc(c, c, N * 0.44, Math.PI * 0.15, Math.PI * 0.75); g.stroke();
    g.strokeStyle = 'rgba(120,255,230,0.35)'; g.beginPath(); g.arc(c, c, N * 0.44, Math.PI * 0.85, Math.PI * 1.35); g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(c - N * 0.17, c - N * 0.19, N * 0.12, N * 0.06, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(c + N * 0.2, c + N * 0.21, N * 0.035, 0, TAU); g.fill();
    // soft out-of-focus version for depth / foreground bokeh
    bubbleSoft = cv(N, N);
    g = bubbleSoft.getContext('2d');
    gr = g.createRadialGradient(c, c, 0, c, c, N * 0.48);
    gr.addColorStop(0, 'rgba(200,245,255,0.10)'); gr.addColorStop(0.7, 'rgba(200,245,255,0.22)'); gr.addColorStop(0.9, 'rgba(230,252,255,0.45)'); gr.addColorStop(1, 'rgba(230,252,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, N * 0.48, 0, TAU); g.fill();
    // glows: bioluminescent cyan and ember red
    glowSpr = [['130,255,240', '40,200,255'], ['255,170,90', '255,50,30']].map(([a, b]) => {
      const s = cv(64, 64), q = s.getContext('2d');
      const r = q.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, `rgba(${a},0.9)`); r.addColorStop(0.4, `rgba(${b},0.28)`); r.addColorStop(1, `rgba(${b},0)`);
      q.fillStyle = r; q.fillRect(0, 0, 64, 64);
      return s;
    });
    dotSpr = cv(32, 32);
    g = dotSpr.getContext('2d');
    gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(230,245,255,0.95)'); gr.addColorStop(0.35, 'rgba(210,235,250,0.45)'); gr.addColorStop(1, 'rgba(210,235,250,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    // god-ray texture: soft across the width, fading with depth
    rayTex = [['200,245,255'], ['255,120,80']].map(([rgb]) => {
      const s = cv(64, 512), q = s.getContext('2d');
      const hz = q.createLinearGradient(0, 0, 64, 0);
      hz.addColorStop(0, `rgba(${rgb},0)`); hz.addColorStop(0.5, `rgba(${rgb},1)`); hz.addColorStop(1, `rgba(${rgb},0)`);
      q.fillStyle = hz; q.fillRect(0, 0, 64, 512);
      q.globalCompositeOperation = 'destination-in';
      const vt = q.createLinearGradient(0, 0, 0, 512);
      vt.addColorStop(0, 'rgba(0,0,0,1)'); vt.addColorStop(0.45, 'rgba(0,0,0,0.45)'); vt.addColorStop(1, 'rgba(0,0,0,0)');
      q.fillStyle = vt; q.fillRect(0, 0, 64, 512);
      return s;
    });
  }

  // ---------- layout ----------
  function resize(w, h) {
    W = w; H = h; hs = H / 900;
    plankton = [];
    for (let i = 0; i < 170; i++) {
      const z = Math.pow(Math.random(), 1.6);
      plankton.push({ x: Math.random() * W, y: Math.random() * H, z, ph: rnd(0, TAU), tw: rnd(0.5, 2) });
    }
    glows = [];
    for (let i = 0; i < 34; i++) glows.push({ x: Math.random() * W, y: rnd(0.15, 1) * H, z: rnd(0.2, 1), ph: rnd(0, TAU), sp: rnd(0.6, 1.8) });
    kelps = [];
    const near = (x, hh, flip) => ({ x, h: H * hh, flip, ph: rnd(0, TAU), layer: 1 });
    const far = (x, hh) => ({ x, h: H * hh, flip: Math.random() < 0.5, ph: rnd(0, TAU), layer: 0 });
    kelps.push(far(W * 0.15, 0.3), far(W * 0.29, 0.22), far(W * 0.72, 0.26), far(W * 0.87, 0.33));
    kelps.push(near(W * 0.005, 0.52, false), near(W * 0.045, 0.36, true));
    kelps.push(near(W * 0.995, 0.55, true), near(W * 0.955, 0.38, false));
    if (!life.some(c => c.type === 'jelly')) {
      for (let i = 0; i < 3; i++) spawnJelly(rnd(0.25, 1.05) * H);
    }
  }

  // ---------- spawners ----------
  function spawnFish() {
    const z = rnd(0.2, 0.9), dir = Math.random() < 0.5 ? 1 : -1;
    const kind = Math.random() < 0.5 ? 'yellow' : 'purple';
    const w = (50 + 120 * z) * hs * rnd(0.85, 1.15);
    life.push({ type: 'fish', kind, z, dir, w, x: dir > 0 ? -w : W + w, y0: rnd(0.1, 0.75) * H, vx: dir * (45 + 95 * z) * hs * rnd(0.8, 1.2), t: 0, ph: rnd(0, TAU), bob: rnd(0.4, 0.9), tail: rnd(9, 13) });
  }
  function spawnSchool() {
    const z = rnd(0.15, 0.55), dir = Math.random() < 0.5 ? 1 : -1, n = 16 + ((Math.random() * 16) | 0);
    const w = (26 + 30 * z) * hs;
    const R = (60 + 90 * z) * hs;
    const members = Array.from({ length: n }, () => ({ ox: rnd(-1, 1) * R * 1.6, oy: rnd(-1, 1) * R * 0.6, ph: rnd(0, TAU), s: rnd(0.8, 1.15), lag: rnd(0, 0.5) }));
    life.push({ type: 'school', z, dir, w, R, members, x: dir > 0 ? -R * 3 : W + R * 3, y0: rnd(0.12, 0.55) * H, vx: dir * (70 + 70 * z) * hs, t: 0, glint: 0 });
  }
  function spawnJelly(y) {
    const z = rnd(0.2, 0.75);
    life.push({ type: 'jelly', z, x: rnd(0.08, 0.92) * W, y: y != null ? y : H + 120 * hs, w: (40 + 70 * z) * hs, t: 0, ph: rnd(0, TAU), drift: rnd(-8, 8) * hs });
  }
  function spawnTurtle() {
    const z = rnd(0.45, 0.8), dir = Math.random() < 0.5 ? 1 : -1, w = (120 + 90 * z) * hs;
    life.push({ type: 'turtle', z, dir, w, x: dir > 0 ? -w : W + w, y0: rnd(0.2, 0.55) * H, vx: dir * (26 + 22 * z) * hs, t: 0, ph: rnd(0, TAU) });
  }
  function spawnManta() {
    const z = rnd(0.12, 0.3), dir = Math.random() < 0.5 ? 1 : -1, w = (170 + 120 * z) * hs;
    life.push({ type: 'manta', z, dir, w, x: dir > 0 ? -w : W + w, y0: rnd(0.12, 0.4) * H, vy: rnd(-6, 6) * hs, vx: dir * (30 + 20 * z) * hs, t: 0, ph: rnd(0, TAU) });
  }
  function spawnSquid() {
    const dir = Math.random() < 0.5 ? 1 : -1, w = W * rnd(0.5, 0.75);
    life.push({ type: 'squid', z: 0.08, dir, w, x: dir > 0 ? -w * 0.6 : W + w * 0.6, y0: rnd(0.22, 0.45) * H, vx: dir * W / rnd(26, 34), t: 0, ph: rnd(0, TAU) });
  }

  // ---------- update ----------
  function update(dt, t, mix) {
    for (const k in timers) timers[k] -= dt;
    if (timers.fish <= 0) { spawnFish(); if (Math.random() < 0.35) spawnFish(); timers.fish = rnd(3, 7); }
    if (timers.school <= 0) { spawnSchool(); timers.school = rnd(14, 24); }
    if (timers.turtle <= 0) { spawnTurtle(); timers.turtle = rnd(30, 50); }
    if (timers.manta <= 0) { spawnManta(); timers.manta = rnd(35, 60); }
    if (timers.squid <= 0 && !life.some(c => c.type === 'squid')) { spawnSquid(); timers.squid = rnd(28, 48); }
    if (life.filter(c => c.type === 'jelly').length < 3 && Math.random() < dt * 0.2) spawnJelly();

    for (let i = life.length - 1; i >= 0; i--) {
      const c = life[i];
      c.t += dt;
      if (c.type === 'jelly') {
        const p = Math.max(0, Math.sin(c.t * 2.2 + c.ph));
        c.y -= (6 + 34 * p * p) * hs * (0.6 + c.z * 0.6) * dt;
        c.x += Math.sin(c.t * 0.3 + c.ph) * c.drift * dt;
        if (c.y < -c.w * 3) life.splice(i, 1);
        continue;
      }
      const jet = c.type === 'squid' ? 0.55 + 0.9 * Math.pow(Math.max(0, Math.sin(c.t * 0.85 + c.ph)), 2) : c.type === 'fish' ? 1 + 0.25 * Math.sin(c.t * 1.4 + c.ph) : 1;
      c.x += c.vx * jet * dt;
      if (c.type === 'manta') c.y0 += c.vy * dt;
      const span = c.type === 'school' ? c.R * 4 : c.w;
      if ((c.vx > 0 && c.x > W + span * 1.2) || (c.vx < 0 && c.x < -span * 1.2)) life.splice(i, 1);
    }

    // rising bubble streams from the wreck
    if (timers.bubble <= 0) {
      timers.bubble = rnd(0.12, 0.5);
      const vents = [[0.13, 0.8], [0.21, 0.63], [0.81, 0.72], [0.9, 0.56], [0.52, 0.98], [0.66, 0.9], [0.36, 0.95]];
      const v = Math.random() < 0.8 ? vents[(Math.random() * vents.length) | 0] : [Math.random(), 1.03];
      const n = 1 + ((Math.random() * (Math.random() < 0.2 ? 9 : 3)) | 0);
      const z = rnd(0.2, 1);
      for (let k = 0; k < n; k++) {
        const r = (2 + Math.pow(Math.random(), 2) * 11) * hs * (0.5 + z * 0.7);
        bubbles.push({ x: v[0] * W + rnd(-6, 6) * hs, y: v[1] * H + k * r * 3.2, r, z, vy: -rnd(30, 60) * hs, ph: rnd(0, TAU), wf: rnd(3, 7), wa: rnd(8, 22) * hs, t: 0 });
      }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      const term = -(60 + b.r * 9) * (0.6 + b.z * 0.6);
      b.vy += (term - b.vy) * Math.min(1, dt * 1.5);
      b.y += b.vy * dt;
      b.x += Math.cos(b.t * b.wf + b.ph) * b.wa * dt;
      if (b.y < -20) bubbles.splice(i, 1);
    }
    if (bubbles.length > 420) bubbles.splice(0, bubbles.length - 420);

    if (timers.bokeh <= 0) {
      timers.bokeh = rnd(1.5, 4.5);
      const r = rnd(18, 60) * hs;
      bokeh.push({ x: rnd(0.05, 0.95) * W, y: H + r * 2, r, vy: -rnd(70, 140) * hs, ph: rnd(0, TAU), t: 0, a: rnd(0.12, 0.28) });
    }
    for (let i = bokeh.length - 1; i >= 0; i--) {
      const b = bokeh[i];
      b.t += dt; b.y += b.vy * dt; b.x += Math.sin(b.t * 1.4 + b.ph) * 14 * hs * dt;
      if (b.y < -b.r * 2) bokeh.splice(i, 1);
    }

    for (const p of plankton) {
      const sp = (4 + 14 * p.z) * hs;
      p.x += (Math.sin(p.y * 0.006 + t * 0.25 + p.ph) * sp * 0.9) * dt;
      p.y += (Math.cos(p.x * 0.005 + t * 0.2) * sp * 0.5 + 3 * hs) * dt;
      if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
      if (p.y < -10) p.y = H + 10;
      if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
    }
    for (const q of glows) {
      q.y -= (3 + 6 * q.z) * hs * dt * (1 + mix * 2.5);
      q.x += Math.sin(t * 0.4 + q.ph) * 6 * hs * dt;
      if (q.y < -20) { q.y = H + 20; q.x = Math.random() * W; }
    }
  }

  // ---------- drawing ----------
  // A warped sprite. On the GPU it is one smooth mesh (no seams or stair-steps); without WebGL it falls back to
  // thin strips. d = { mode: 0 tail wave | 1 sway up from the base | 2 hanging | 3 wings, amp, k, ph, pow, cut }
  let post = [];
  function warp(g, c, cx, cy, w, h, d) {
    if (window.SpriteGL && SpriteGL.active) { SpriteGL.add(g, c, cx, cy, w, h, d); return; }
    const cut = d.cut || 1, pw = d.pow || 1;
    const fn = d.mode === 0 ? u => Math.pow(Math.max(0, (cut - u) / cut), pw)
      : d.mode === 1 ? v => Math.pow(1 - v, pw)
        : d.mode === 2 ? v => Math.pow(v, pw)
          : u => Math.pow(Math.abs(u - 0.5) * 2, pw);
    const vertical = d.mode === 1 || d.mode === 2;
    const n = Math.max(8, Math.min(90, Math.round((vertical ? h : w) / 2.5)));
    if (vertical) {
      const sh = c.height / n, dh = h / n;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, off = (d.amp || 0) * fn(u) * Math.sin((d.ph || 0) + u * (d.k || 0));
        const sy = i * sh, shh = Math.min(sh + 0.5, c.height - sy);
        g.drawImage(c, 0, sy, c.width, shh, cx - w / 2 + off, cy - h / 2 + i * dh, w, dh * shh / sh);
      }
    } else {
      const sw = c.width / n, dw = w / n;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, off = (d.amp || 0) * fn(u) * Math.sin((d.ph || 0) + u * (d.k || 0));
        const sx = i * sw, sww = Math.min(sw + 0.5, c.width - sx);
        g.drawImage(c, sx, 0, sww, c.height, cx - w / 2 + i * dw, cy - h / 2 + off, dw * sww / sw, h);
      }
    }
  }
  // Collect warped sprites drawn by fn, render them in one GPU pass, then run deferred 2D effects on top.
  function batch(g, fn) {
    post = [];
    const useGL = window.SpriteGL && SpriteGL.ok;
    if (useGL) SpriteGL.begin();
    fn();
    if (useGL) SpriteGL.flush(g);
    const p = post; post = [];
    for (const f of p) f();
  }
  // draw both palettes cross-faded by the bonus mix
  function dual(g, set, depthIdx, mix, alpha, fn) {
    const a = set[0][depthIdx], b = set[1][depthIdx];
    if (mix < 0.02) { g.globalAlpha = alpha; fn(a); }
    else if (mix > 0.98) { g.globalAlpha = alpha; fn(b); }
    else { g.globalAlpha = alpha * (1 - mix); fn(a); g.globalAlpha = alpha * mix; fn(b); }
    g.globalAlpha = 1;
  }
  const dIdx = z => (z < 0.36 ? 0 : z < 0.66 ? 1 : 2);

  function drawCreature(g, c, t, mix) {
    switch (c.type) {
      case 'fish': {
        const set = SPR[c.kind], img = set[0][0];
        const h = c.w * img.height / img.width;
        const y = c.y0 + Math.sin(c.t * c.bob + c.ph) * H * 0.025;
        const pitch = Math.cos(c.t * c.bob + c.ph) * 0.12;
        g.save(); g.translate(c.x, y); g.scale(c.dir, 1); g.rotate(pitch);
        dual(g, set, dIdx(c.z), mix, 0.95, s => warp(g, s, 0, 0, c.w, h, { mode: 0, amp: h * 0.13, k: 4.2, ph: c.t * c.tail + c.ph, pow: 1.7, cut: 1 }));
        g.restore();
        break;
      }
      case 'school': {
        const set = SPR.sardine, img = set[0][0];
        const di = dIdx(c.z);
        const cyb = c.y0 + Math.sin(c.t * 0.45) * H * 0.07;
        const turn = Math.sin(c.t * 0.45) * 0.25;
        for (let i = 0; i < c.members.length; i++) {
          const m = c.members[i];
          const w = c.w * m.s, h = w * img.height / img.width;
          const x = c.x + m.ox + Math.sin(c.t * 1.2 + m.ph) * c.R * 0.15 - c.vx * m.lag * 0.4;
          const y = cyb + m.oy + Math.cos(c.t * 1.05 + m.ph) * c.R * 0.12 + Math.sin(c.t * 0.45 - m.lag) * H * 0.02;
          g.save(); g.translate(x, y); g.scale(c.dir, 1); g.rotate(-turn * c.dir * 0.6);
          dual(g, set, di, mix, 0.9, s => warp(g, s, 0, 0, w, h, { mode: 0, amp: h * 0.18, k: 3, ph: c.t * 16 + m.ph, pow: 1.5, cut: 1 }));
          g.restore();
          // silver glints as the school turns (drawn after the fish)
          const gl = Math.sin(c.t * 2.2 + m.ph * 3);
          if (gl > 0.93) post.push(() => {
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = (gl - 0.93) * 10 * (1 - mix * 0.6);
            g.drawImage(dotSpr, x - w * 0.4, y - w * 0.4, w * 0.8, w * 0.8);
            g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
          });
        }
        break;
      }
      case 'jelly': {
        const set = SPR.jelly, img = set[0][0];
        const p = Math.max(0, Math.sin(c.t * 2.2 + c.ph));
        const w = c.w * (1 + 0.1 * p), h = c.w * img.height / img.width * (1 - 0.06 * p);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (0.2 + 0.18 * p) * (0.5 + c.z * 0.5);
        const gw = c.w * 3;
        g.drawImage(glowSpr[mix > 0.5 ? 1 : 0], c.x - gw / 2, c.y - h * 0.32 - gw / 2, gw, gw);
        g.globalCompositeOperation = 'source-over';
        dual(g, set, dIdx(c.z), mix, 0.55 + 0.35 * c.z, s => warp(g, s, c.x, c.y, w, h, { mode: 2, amp: w * 0.08, k: 5, ph: c.t * 2.4 + c.ph, pow: 1.6 }));
        break;
      }
      case 'turtle': {
        const set = SPR.turtle, img = set[0][0];
        const h = c.w * img.height / img.width;
        const y = c.y0 + Math.sin(c.t * 0.7 + c.ph) * H * 0.02;
        const stroke = Math.sin(c.t * 1.6 + c.ph);
        g.save(); g.translate(c.x, y); g.scale(c.dir, 1); g.rotate(Math.cos(c.t * 0.7 + c.ph) * 0.07);
        dual(g, set, dIdx(c.z), mix, 0.95, s => warp(g, s, 0, 0, c.w, h * (1 + stroke * 0.03), { mode: 3, amp: h * 0.04, k: 0, ph: c.t * 1.6 + c.ph, pow: 1.4 }));
        g.restore();
        break;
      }
      case 'manta': {
        const set = SPR.manta, img = set[0][0];
        const h = c.w * img.height / img.width;
        const flap = Math.sin(c.t * 1.3 + c.ph);
        g.save(); g.translate(c.x, c.y0 + Math.sin(c.t * 0.4) * H * 0.03);
        g.rotate(c.dir * Math.PI / 2 + Math.sin(c.t * 0.4) * 0.12);
        g.scale(0.84 + 0.16 * Math.abs(Math.cos(c.t * 0.65 + c.ph)), 1);
        dual(g, set, dIdx(c.z), mix, 0.85, s => warp(g, s, 0, 0, c.w, h, { mode: 3, amp: h * 0.06 * flap, k: 0, ph: 1.5708, pow: 2 }));
        g.restore();
        break;
      }
      case 'squid': {
        const set = SPR.squid, img = set[0][0];
        const h = c.w * img.height / img.width;
        const y = c.y0 + Math.sin(c.t * 0.35) * H * 0.03;
        const squeeze = Math.pow(Math.max(0, Math.sin(c.t * 0.85 + c.ph)), 2);
        g.save(); g.translate(c.x, y); g.scale(c.dir, 1);
        g.scale(1 + squeeze * 0.04, 1 - squeeze * 0.06);
        dual(g, set, 0, mix, 0.75, s => warp(g, s, 0, 0, c.w, h, { mode: 0, amp: h * 0.22, k: 3.2, ph: c.t * 2 + c.ph, pow: 1.8, cut: 0.62 }));
        // eye glow, drawn over the body
        const m = g.getTransform(), ex = c.w * (0.64 - 0.5), ey = h * (0.41 - 0.5), er = h * 0.5, ea = 0.5 + 0.3 * Math.sin(c.t * 3);
        post.push(() => {
          g.save(); g.setTransform(m);
          g.globalCompositeOperation = 'lighter'; g.globalAlpha = ea;
          g.drawImage(glowSpr[mix > 0.5 ? 1 : 0], ex - er / 2, ey - er / 2, er, er);
          g.restore();
        });
        g.restore();
        break;
      }
      default: break;
    }
  }

  function drawKelp(g, k, t, mix) {
    const set = SPR.kelp, img = set[0][k.layer];
    const h = k.h, w = h * img.width / img.height;
    g.save();
    g.translate(k.x, H + 6 - h / 2);
    if (k.flip) g.scale(-1, 1);
    dual(g, set, k.layer, mix, k.layer ? 1 : 0.8, s => warp(g, s, 0, 0, w, h, { mode: 1, amp: w * 0.42, k: 2.4, ph: t * 0.85 + k.ph, pow: 1.9 }));
    g.restore();
  }

  function drawFar(g, t, mix) {
    batch(g, () => {
      if (opts.creatures) for (const c of life) if (c.type === 'squid') drawCreature(g, c, t, mix);
      if (opts.kelp) for (const k of kelps) if (k.layer === 0) drawKelp(g, k, t, mix);
      if (opts.creatures) for (const c of life) if (c.type !== 'squid' && c.z < 0.36) drawCreature(g, c, t, mix);
    });
  }

  function drawRays(g, t, mix, inten) {
    if (!opts.rays) return;
    const rays = [[0.33, 0.13, 0.0, -0.1], [0.42, 0.07, 1.3, -0.04], [0.5, 0.17, 2.1, 0.02], [0.58, 0.08, 3.3, 0.07], [0.65, 0.12, 4.4, 0.12], [0.26, 0.06, 5.2, -0.16], [0.74, 0.07, 0.7, 0.18]];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [px, wd, ph, ang] of rays) {
      const a = (0.1 + 0.07 * Math.sin(t * 0.33 + ph)) * inten;
      const x = W * (px + Math.sin(t * 0.13 + ph) * 0.015);
      const len = H * 1.05, w = W * wd * (0.85 + 0.15 * Math.sin(t * 0.21 + ph * 2));
      g.save();
      g.translate(x, -H * 0.04);
      g.rotate(ang + Math.sin(t * 0.1 + ph) * 0.02);
      if (mix < 0.98) { g.globalAlpha = a * (1 - mix); g.drawImage(rayTex[0], -w / 2, 0, w, len); }
      if (mix > 0.02) { g.globalAlpha = a * mix; g.drawImage(rayTex[1], -w / 2, 0, w, len); }
      g.restore();
    }
    g.restore();
  }

  function drawMid(g, t, mix) {
    // plankton specks (far + mid)
    g.globalCompositeOperation = 'lighter';
    for (const p of plankton) {
      if (p.z > 0.75) continue;
      const s = (1 + p.z * 3.2) * hs;
      g.globalAlpha = (0.12 + p.z * 0.35) * (0.6 + 0.4 * Math.sin(t * p.tw + p.ph)) * (1 - mix * 0.4);
      g.drawImage(dotSpr, p.x - s, p.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    // creatures sorted by depth
    const mids = opts.creatures ? life.filter(c => c.type !== 'squid' && c.z >= 0.36).sort((a, b) => a.z - b.z) : [];
    batch(g, () => { for (const c of mids) drawCreature(g, c, t, mix); });
    // bubbles
    for (const b of bubbles) {
      const wob = Math.sin(b.t * 9 + b.ph) * 0.09;
      const s = b.r * 2;
      g.globalAlpha = (0.35 + b.z * 0.6) * Math.min(1, b.t * 3);
      g.drawImage(b.z < 0.4 ? bubbleSoft : bubbleSpr, b.x - s * (1 + wob) / 2, b.y - s * (1 - wob) / 2, s * (1 + wob), s * (1 - wob));
    }
    g.globalAlpha = 1;
    // bioluminescent plankton (turns to embers in the bonus)
    g.globalCompositeOperation = 'lighter';
    for (const q of glows) {
      const pulse = 0.5 + 0.5 * Math.sin(t * q.sp + q.ph);
      const s = (6 + q.z * 12) * hs * (0.7 + pulse * 0.5);
      g.globalAlpha = (0.15 + pulse * 0.55) * q.z * (0.55 + mix * 0.45);
      g.drawImage(glowSpr[mix > 0.5 ? 1 : 0], q.x - s, q.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function drawNear(g, t, mix) {
    if (opts.kelp) batch(g, () => { for (const k of kelps) if (k.layer === 1) drawKelp(g, k, t, mix); });
    // near plankton bokeh
    g.globalCompositeOperation = 'lighter';
    for (const p of plankton) {
      if (p.z <= 0.75) continue;
      const s = (5 + p.z * 9) * hs;
      g.globalAlpha = 0.08 + 0.06 * Math.sin(t * p.tw + p.ph);
      g.drawImage(dotSpr, p.x - s, p.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  function drawFront(g) {
    for (const b of bokeh) {
      const s = b.r * 2, wob = Math.sin(b.t * 5 + b.ph) * 0.06;
      g.globalAlpha = b.a * Math.min(1, b.t * 2);
      g.drawImage(bubbleSoft, b.x - s * (1 + wob) / 2, b.y - s * (1 - wob) / 2, s * (1 + wob), s * (1 - wob));
    }
    g.globalAlpha = 1;
  }

  function burst(x, y, n) {
    for (let k = 0; k < n; k++) {
      const z = rnd(0.5, 1), r = rnd(3, 14) * hs;
      bubbles.push({ x: x + rnd(-40, 40) * hs, y: y + rnd(0, 120) * hs, r, z, vy: -rnd(150, 380) * hs, ph: rnd(0, TAU), wf: rnd(3, 7), wa: rnd(10, 30) * hs, t: 0 });
    }
  }

  // spawn hooks are also handy for previewing creatures from the console
  const spawn = { fish: spawnFish, school: spawnSchool, jelly: spawnJelly, turtle: spawnTurtle, manta: spawnManta, squid: spawnSquid };
  window.SeaLife = { init, resize, update, drawFar, drawRays, drawMid, drawNear, drawFront, burst, spawn, life, setScene, warp, batch };
})();

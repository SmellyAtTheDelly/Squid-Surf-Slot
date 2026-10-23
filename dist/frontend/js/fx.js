/* Squid Squad — VFX toolkit: sprites, particles, procedural sea life, light, ink. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const Ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
    outQuad: t => 1 - (1 - t) * (1 - t),
  };

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------- sprites ----------
  const SPR = {};
  function buildSprites() {
    let c = canvas(64, 64), g = c.getContext('2d');
    let gr = g.createRadialGradient(32, 32, 8, 32, 32, 31);
    gr.addColorStop(0, 'rgba(170,235,255,0.04)');
    gr.addColorStop(0.72, 'rgba(170,235,255,0.16)');
    gr.addColorStop(0.92, 'rgba(225,250,255,0.8)');
    gr.addColorStop(1, 'rgba(225,250,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 31, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(22, 20, 8, 4.5, -0.65, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(43, 44, 2.6, 0, TAU); g.fill();
    SPR.bubble = c;

    c = canvas(64, 64); g = c.getContext('2d');
    gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    SPR.glow = c;

    SPR.spark = tintedStar('255,236,170');
    SPR.sparkCyan = tintedStar('170,245,255');
    SPR.sparkPink = tintedStar('255,170,240');
    SPR.sparkRed = tintedStar('255,120,80');

    c = canvas(64, 64); g = c.getContext('2d');
    gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(40,6,60,0.95)'); gr.addColorStop(0.6, 'rgba(30,4,48,0.85)'); gr.addColorStop(1, 'rgba(20,2,32,0)');
    g.fillStyle = gr; g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU, r = 26 + Math.sin(i * 2.7) * 4 + Math.cos(i * 1.3) * 3;
      if (i === 0) g.moveTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); else g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = 'rgba(190,120,255,0.35)'; g.beginPath(); g.ellipse(24, 22, 7, 4, -0.6, 0, TAU); g.fill();
    SPR.ink = c;

    c = canvas(32, 32); g = c.getContext('2d');
    gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,220,160,1)'); gr.addColorStop(0.3, 'rgba(255,90,40,0.7)'); gr.addColorStop(1, 'rgba(255,30,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    SPR.ember = c;

    c = canvas(16, 16); g = c.getContext('2d');
    gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(220,240,255,0.9)'); gr.addColorStop(1, 'rgba(220,240,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
    SPR.snow = c;
  }

  function tintedStar(rgb) {
    const c = canvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(255,255,255,1)`); gr.addColorStop(0.2, `rgba(${rgb},0.8)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, r = i % 2 === 0 ? 32 : 6;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    g.globalCompositeOperation = 'lighter';
    const g2 = g.createRadialGradient(32, 32, 0, 32, 32, 14);
    g2.addColorStop(0, 'rgba(255,255,255,0.9)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = g2; g.fillRect(0, 0, 64, 64);
    return c;
  }

  // ---------- particles ----------
  class Particles {
    constructor(max) { this.list = []; this.max = max || 900; }
    add(o) {
      if (this.list.length >= this.max) this.list.shift();
      const p = Object.assign({
        x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 1, life: 0, max: 1, size: 10, grow: 0, rot: 0, vr: 0,
        alpha: 1, fadeIn: 0.05, fadeOut: 0.35, add: false, img: SPR.glow, type: 'sprite', wob: 0, wf: 3, ph: Math.random() * TAU,
        flip: 0, delay: 0,
      }, o);
      this.list.push(p);
      return p;
    }
    update(dt) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.life += dt;
        if (p.life >= p.max || (p.kill && p.kill(p))) { L.splice(i, 1); continue; }
        p.vx += p.ax * dt; p.vy += p.ay * dt;
        if (p.drag !== 1) { const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vy *= d; }
        p.x += p.vx * dt + (p.wob ? Math.cos(p.life * p.wf + p.ph) * p.wob * dt : 0);
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.size += p.grow * dt;
      }
    }
    draw(g) {
      const L = this.list;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        if (p.delay > 0 || p.size <= 0) continue;
        const k = p.life / p.max;
        let a = p.alpha;
        if (p.fadeIn && k < p.fadeIn) a *= k / p.fadeIn;
        if (p.fadeOut && k > 1 - p.fadeOut) a *= (1 - k) / p.fadeOut;
        if (a <= 0.003) continue;
        g.globalAlpha = a;
        g.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
        const s = p.size;
        if (p.type === 'ring') {
          g.strokeStyle = p.color || '#fff';
          g.lineWidth = Math.max(1, p.lw * (1 - k));
          g.beginPath(); g.arc(p.x, p.y, s, 0, TAU); g.stroke();
          continue;
        }
        if (p.type === 'text') {
          g.font = `${s}px "Lilita One", sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = s * 0.16; g.strokeStyle = '#1a0830'; g.strokeText(p.text, p.x, p.y);
          g.fillStyle = p.color || '#ffe27a'; g.fillText(p.text, p.x, p.y);
          continue;
        }
        let sx = 1;
        if (p.flip) { sx = Math.cos(p.life * p.flip + p.ph); if (Math.abs(sx) < 0.08) sx = sx < 0 ? -0.08 : 0.08; }
        if (p.rot || sx !== 1) {
          g.save(); g.translate(p.x, p.y); if (p.rot) g.rotate(p.rot); g.scale(sx, 1);
          g.drawImage(p.img, -s / 2, -s / 2, s, s);
          g.restore();
        } else g.drawImage(p.img, p.x - s / 2, p.y - s / 2, s, s);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    clear() { this.list.length = 0; }
  }

  // ---------- procedural squid ----------
  // Local frame: mantle tip points to -y; arms trail to +y. `ang` rotates that frame.
  function drawSquid(g, x, y, s, ang, t, st) {
    st = st || {};
    const sil = !!st.silhouette;
    const body = st.body || '#c656ff', dark = st.dark || '#6d1fae', light = st.light || '#f2b8ff';
    g.save();
    g.translate(x, y); g.rotate(ang);
    const pulse = 1 + Math.sin(t * (st.pulseRate || 5)) * 0.04;
    g.scale(1 / Math.sqrt(pulse), pulse);
    // arms
    const armCol = sil ? body : dark;
    for (let i = 0; i < 8; i++) {
      const ax = (-0.17 + i * (0.34 / 7)) * s;
      const len = (0.48 + 0.07 * Math.sin(i * 1.7)) * s;
      arm(g, ax, 0.2 * s, len, 0.07 * s, t * 5 + i * 0.8, 0.06 * s, sil ? body : (i % 2 ? body : armCol));
    }
    for (const side of [-1, 1]) arm(g, side * 0.07 * s, 0.22 * s, 0.85 * s, 0.045 * s, t * 4 + side, 0.1 * s, sil ? body : body, true);
    // fins
    g.fillStyle = sil ? body : dark;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, -0.98 * s);
      g.quadraticCurveTo(side * 0.5 * s, -0.78 * s, side * 0.42 * s, -0.56 * s);
      g.quadraticCurveTo(side * 0.2 * s, -0.5 * s, 0, -0.42 * s);
      g.fill();
    }
    // mantle
    g.beginPath();
    g.moveTo(0, -1.02 * s);
    g.bezierCurveTo(0.2 * s, -0.86 * s, 0.31 * s, -0.42 * s, 0.27 * s, 0.04 * s);
    g.quadraticCurveTo(0.24 * s, 0.17 * s, 0, 0.17 * s);
    g.quadraticCurveTo(-0.24 * s, 0.17 * s, -0.27 * s, 0.04 * s);
    g.bezierCurveTo(-0.31 * s, -0.42 * s, -0.2 * s, -0.86 * s, 0, -1.02 * s);
    if (sil) g.fillStyle = body;
    else {
      const gr = g.createLinearGradient(-0.3 * s, 0, 0.3 * s, 0);
      gr.addColorStop(0, light); gr.addColorStop(0.45, body); gr.addColorStop(1, dark);
      g.fillStyle = gr;
    }
    g.fill();
    if (!sil) {
      g.fillStyle = 'rgba(120,20,140,0.35)';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(((i * 37) % 23 - 11) / 11 * 0.16 * s, (-0.75 + (i * 0.083)) * s, 0.022 * s, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(-0.1 * s, -0.55 * s, 0.05 * s, 0.22 * s, 0.1, 0, TAU); g.fill();
    }
    // head
    g.fillStyle = sil ? body : body;
    g.beginPath(); g.ellipse(0, 0.2 * s, 0.25 * s, 0.14 * s, 0, 0, TAU); g.fill();
    // eyes
    if (sil) {
      if (st.eyeGlow) {
        g.globalCompositeOperation = 'lighter';
        for (const side of [-1, 1]) {
          const gr = g.createRadialGradient(side * 0.14 * s, 0.17 * s, 0, side * 0.14 * s, 0.17 * s, 0.12 * s);
          gr.addColorStop(0, st.eyeGlow); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(side * 0.14 * s, 0.17 * s, 0.12 * s, 0, TAU); g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      }
    } else {
      for (const side of [-1, 1]) {
        g.fillStyle = '#fff';
        g.beginPath(); g.ellipse(side * 0.12 * s, 0.17 * s, 0.085 * s, 0.095 * s, 0, 0, TAU); g.fill();
        g.fillStyle = '#140822';
        g.beginPath(); g.arc(side * 0.12 * s + 0.01 * s, 0.19 * s, 0.055 * s, 0, TAU); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(side * 0.12 * s - 0.012 * s, 0.165 * s, 0.02 * s, 0, TAU); g.fill();
      }
      if (st.bandana) {
        g.fillStyle = '#e8283c';
        g.beginPath(); g.ellipse(0, 0.06 * s, 0.27 * s, 0.05 * s, 0, 0, TAU); g.fill();
      }
    }
    g.restore();
  }

  function arm(g, x, y, len, w, ph, amp, col, club) {
    const n = 9;
    g.strokeStyle = col; g.lineCap = 'round';
    let px = x, py = y;
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const nx = x + Math.sin(ph - u * 3) * amp * u * 1.4 + (x * 0.6) * u;
      const ny = y + len * u;
      g.lineWidth = Math.max(0.6, w * (1 - u * 0.85));
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      px = nx; py = ny;
    }
    if (club) { g.fillStyle = col; g.beginPath(); g.ellipse(px, py, w * 0.9, w * 1.6, 0, 0, TAU); g.fill(); }
  }

  // ---------- kraken tentacle ----------
  // Grows from (x,y) in direction ang (-PI/2 = straight up). reach 0..1 extends it; the tip curls and the
  // whole arm ripples. Shaded body, a highlight down its back and pale suckers along the inner edge.
  function drawTentacle(g, x, y, len, w, ang, t, ph, reach, side, pal) {
    pal = pal || ['#3a0608', '#9a1a1c', '#e0533a'];
    side = side || 1;
    const n = 30, L = len * clamp(reach == null ? 1 : reach, 0, 1);
    if (L < 4) return;
    const pts = [];
    let px = x, py = y, dir = ang;
    const step = L / n;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      pts.push([px, py, dir, w * Math.max(0.06, 1 - Math.pow(u, 0.85) * 0.94)]);
      dir += side * (0.02 + 0.22 * u * u * u) + Math.sin(t * 2.6 + ph - u * 4.2) * 0.07 * u;
      px += Math.cos(dir) * step; py += Math.sin(dir) * step;
    }
    const left = [], right = [];
    for (const [qx, qy, d, ww] of pts) {
      const nx = Math.cos(d + Math.PI / 2), ny = Math.sin(d + Math.PI / 2);
      left.push([qx - nx * ww / 2, qy - ny * ww / 2]); right.push([qx + nx * ww / 2, qy + ny * ww / 2]);
    }
    const gr = g.createLinearGradient(x - w, y, x + w, y);
    gr.addColorStop(0, pal[1]); gr.addColorStop(0.5, pal[2]); gr.addColorStop(1, pal[0]);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left) g.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath(); g.fill();
    g.lineWidth = Math.max(1, w * 0.05); g.strokeStyle = 'rgba(20,0,0,0.55)'; g.stroke();
    // back highlight
    g.strokeStyle = 'rgba(255,190,160,0.35)'; g.lineWidth = Math.max(1, w * 0.07);
    g.beginPath();
    for (let i = 0; i < pts.length - 3; i++) {
      const [qx, qy, d, ww] = pts[i];
      const hx = qx - Math.cos(d + Math.PI / 2) * ww * 0.22 * side, hy = qy - Math.sin(d + Math.PI / 2) * ww * 0.22 * side;
      if (i === 0) g.moveTo(hx, hy); else g.lineTo(hx, hy);
    }
    g.stroke();
    // suckers on the inner edge
    for (let i = 2; i < pts.length - 2; i += 2) {
      const [qx, qy, d, ww] = pts[i];
      const sx = qx + Math.cos(d + Math.PI / 2) * ww * 0.36 * side, sy = qy + Math.sin(d + Math.PI / 2) * ww * 0.36 * side;
      const r = ww * 0.2;
      if (r < 0.8) continue;
      g.fillStyle = '#f2c6b8'; g.beginPath(); g.ellipse(sx, sy, r, r * 0.8, d, 0, TAU); g.fill();
      g.fillStyle = '#9a3a3a'; g.beginPath(); g.ellipse(sx, sy, r * 0.45, r * 0.36, d, 0, TAU); g.fill();
    }
  }

  // ---------- fish silhouette ----------
  function drawFish(g, x, y, s, dir, t, col) {
    g.save(); g.translate(x, y); g.scale(dir, 1);
    const wag = Math.sin(t * 12) * 0.25;
    g.fillStyle = col;
    g.beginPath(); g.ellipse(0, 0, s, s * 0.42, 0, 0, TAU); g.fill();
    g.beginPath();
    g.moveTo(-s * 0.85, 0);
    g.lineTo(-s * 1.6, -s * (0.5 + wag)); g.lineTo(-s * 1.45, 0); g.lineTo(-s * 1.6, s * (0.5 - wag));
    g.closePath(); g.fill();
    g.restore();
  }

  // ---------- kelp ----------
  function drawKelp(g, x, baseY, h, w, t, ph, c1, c2) {
    const n = 14, pts = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const sway = Math.sin(t * 0.9 + ph + u * 2.4) * h * 0.09 * Math.pow(u, 1.4) + Math.sin(t * 2.1 + ph * 2 + u * 5) * h * 0.012 * u;
      pts.push([x + sway, baseY - h * u, w * (1 - u * 0.75) * (0.8 + 0.2 * Math.sin(u * 9 + ph))]);
    }
    const gr = g.createLinearGradient(0, baseY, 0, baseY - h);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(pts[0][0] - pts[0][2], pts[0][1]);
    for (const p of pts) g.lineTo(p[0] - p[2], p[1]);
    for (let k = pts.length - 1; k >= 0; k--) g.lineTo(pts[k][0] + pts[k][2], pts[k][1]);
    g.closePath(); g.fill();
    // leaves
    for (let k = 3; k < n; k += 3) {
      const p = pts[k], side = k % 2 ? 1 : -1;
      g.beginPath();
      g.ellipse(p[0] + side * p[2] * 2.2, p[1], p[2] * 2.4, p[2] * 0.8, side * 0.6 + Math.sin(t + k) * 0.2, 0, TAU);
      g.fill();
    }
  }

  // ---------- god rays ----------
  function godRays(g, W, H, t, rgb, inten) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const rays = [[0.34, 0.11, 0.0], [0.42, 0.06, 1.3], [0.5, 0.14, 2.1], [0.57, 0.07, 3.3], [0.64, 0.1, 4.4], [0.28, 0.05, 5.2], [0.72, 0.05, 0.7]];
    for (const [px, wd, ph] of rays) {
      const a = (0.11 + 0.05 * Math.sin(t * 0.35 + ph)) * inten;
      const sway = Math.sin(t * 0.18 + ph) * 0.05;
      const x0 = W * (px + sway * 0.3), w0 = W * wd * 0.5, x1 = W * (px + 0.12 * (px - 0.5) * 2 + sway), w1 = W * wd * 1.4;
      const gr = g.createLinearGradient(0, 0, 0, H * 0.95);
      gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.55, `rgba(${rgb},${a * 0.35})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0 - w0 / 2, -10); g.lineTo(x0 + w0 / 2, -10); g.lineTo(x1 + w1 / 2, H * 0.95); g.lineTo(x1 - w1 / 2, H * 0.95);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  // ---------- caustics (tileable worley F2-F1) ----------
  function causticTile(size, nPts) {
    const c = canvas(size, size), g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const pts = [];
    for (let i = 0; i < nPts; i++) pts.push([Math.random() * size, Math.random() * size]);
    const all = [];
    for (const [px, py] of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) all.push([px + ox * size, py + oy * size]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (let i = 0; i < all.length; i++) {
        const dx = x - all[i][0], dy = y - all[i][1];
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.pow(clamp(1 - e / (size * 0.05), 0, 1), 3);
      const o = (y * size + x) * 4;
      img.data[o] = 200; img.data[o + 1] = 250; img.data[o + 2] = 255; img.data[o + 3] = v * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // ---------- sunburst ----------
  function sunburst(g, x, y, R, n, rot, rgb, alpha) {
    g.save();
    g.translate(x, y); g.rotate(rot);
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
    gr.addColorStop(0, `rgba(${rgb},${alpha})`); gr.addColorStop(0.6, `rgba(${rgb},${alpha * 0.4})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = a0 + (TAU / n) * 0.5;
      g.moveTo(0, 0); g.arc(0, 0, R, a0, a1); g.closePath();
    }
    g.fill();
    g.restore();
  }

  // ---------- ink wipe transition ----------
  class InkWipe {
    constructor() { this.k = 0; this.blobs = []; }
    seed(W, H, ox, oy) {
      this.blobs = [];
      const R = Math.hypot(W, H);
      this.blobs.push({ x: ox != null ? ox : W / 2, y: oy != null ? oy : H / 2, d: 0.0, R: R * 1.05, ph: Math.random() * TAU });
      for (let i = 0; i < 16; i++) {
        this.blobs.push({ x: Math.random() * W, y: Math.random() * H, d: Math.random() * 0.45, R: R * rnd(0.25, 0.5), ph: Math.random() * TAU });
      }
    }
    draw(g, k, t) {
      if (k <= 0) return;
      g.save();
      g.beginPath();
      for (const b of this.blobs) {
        const u = clamp((k - b.d) / (1 - b.d), 0, 1);
        if (u <= 0) continue;
        const r = b.R * Ease.inOutCubic(u);
        for (let i = 0; i <= 36; i++) {
          const a = (i / 36) * TAU;
          const rr = r * (1 + 0.07 * Math.sin(a * 5 + b.ph + t * 2) + 0.04 * Math.sin(a * 11 - b.ph - t * 3));
          const px = b.x + Math.cos(a) * rr, py = b.y + Math.sin(a) * rr;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
      }
      g.fillStyle = '#0d0418';
      g.fill('nonzero');
      g.restore();
    }
  }

  window.FX = { TAU, rnd, clamp, lerp, Ease, SPR, buildSprites, Particles, drawSquid, drawTentacle, drawFish, drawKelp, godRays, causticTile, sunburst, InkWipe, canvas };
})();

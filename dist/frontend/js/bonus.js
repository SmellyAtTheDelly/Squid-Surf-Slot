(function () {
  'use strict';
  window.Bonuses = function (G) {
    const { M, FX, SFX, IMG, st, L, g } = G;
    const { TAU, rnd, clamp, lerp, Ease, SPR } = FX;
    const now = () => G.clock();
    const ambient = () => G.ambientClock();
    const fmt = G.fmt;

    // ============================== CHOOSE YOUR DIVE ==============================
    const DIVES = [
      { kind: 'kraken', title: 't_kraken', bg: 'bg_kraken', icon: 'fx_eye', col: '255,96,60', vol: 5,
        lines: p => [`${M.TUNE.krakenSpins[Math.min(5, p)]} FREE SPINS`, 'Sticky multiplier wilds', 'Kraken Rage: +1 to every wild'] },
      { kind: 'reef', title: 't_reef', bg: 'bg_reef', icon: 'p_pearl', col: '90,230,255', vol: 4,
        lines: p => ['HOLD & WIN · 3 RESPINS', p >= 4 ? `Cash pearls worth x${M.TUNE.reefLevel[Math.min(5, p)]}` : 'Cash pearls lock in place', 'Golden pearls x2 · GRAND 1000x'] },
      { kind: 'vault', title: 't_vault', bg: 'bg_vault', icon: 'ui_chest', col: '255,200,80', vol: 2,
        lines: p => [`PICK CHESTS · ${Math.min(5, p) - 1} LIVES`, p >= 5 ? 'Vault starts at x3' : 'Coins, multipliers, extra lives', 'Beware the Kraken!'] },
      { kind: 'wheel', title: 't_wheel', bg: 'bg_helm', icon: 'ui_wheel', col: '120,255,210', vol: 4,
        lines: () => ['SPIN FOR A MYSTERY BONUS', 'Could land a SUPER bonus', '...or a cash prize'] },
    ];
    let sel = null;
    function cardRects() {
      if (L.portrait) {
        const w = 400, h = 500;
        return DIVES.map((_, i) => ({ x: (i % 2 ? 665 : 235) - w / 2, y: (i < 2 ? 372 : 912), w, h }));
      }
      const w = 330, h = 480, gap = 34, x0 = (1600 - (w * 4 + gap * 3)) / 2;
      return DIVES.map((_, i) => ({ x: x0 + i * (w + gap), y: 270, w, h }));
    }
    function select(pearls, auto) {
      return new Promise(res => {
        sel = { t0: now(), pearls, hover: -1, chosen: -1, ct: 0, res, auto, lastHover: -1 };
        SFX.startMusic('select');
        if (auto) {
          const pick = Math.max(0, DIVES.findIndex(d => d.kind === st.lastChoice));
          G.wait(3.4).then(() => { if (sel && sel.chosen < 0) choose(pick); });
        }
      });
    }
    function choose(i) {
      if (!sel || sel.chosen >= 0) return;
      sel.chosen = i; sel.ct = now();
      SFX.play('cardPick');
      G.wait(1.0).then(() => { const r = sel.res; const k = DIVES[i].kind; sel = null; r(k); });
    }
    function coverDraw(img, x, y, w, h, focusX) {
      const ar = w / h, iar = img.width / img.height;
      let sw, sh, sx, sy;
      if (iar > ar) { sh = img.height; sw = sh * ar; sx = (img.width - sw) * (focusX == null ? 0.5 : focusX); sy = 0; } else { sw = img.width; sh = sw / ar; sx = 0; sy = (img.height - sh) / 2; }
      g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }
    function drawIcon(d, cx, cy, s, t, hot) {
      const im = IMG[d.icon];
      if (!im || !im.width) return;
      g.save();
      g.translate(cx, cy);
      if (d.kind === 'kraken') {
        const open = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.9));
        g.globalCompositeOperation = 'lighter';
        G.glowAt(0, 0, s * 0.9, d.col, 0.35 + 0.25 * hot);
        g.scale(1, open);
        const w = s * 1.7, h = w * im.height / im.width;
        g.drawImage(im, -w / 2, -h / 2, w, h);
      } else if (d.kind === 'reef') {
        g.translate(0, Math.sin(t * 2) * s * 0.06);
        g.globalCompositeOperation = 'lighter';
        G.glowAt(0, 0, s * 0.9, d.col, 0.4 + 0.3 * hot);
        g.globalCompositeOperation = 'source-over';
        g.drawImage(im, -s / 2, -s / 2, s, s);
      } else if (d.kind === 'vault') {
        g.rotate(Math.sin(t * 3) * 0.05 * (1 + hot * 2));
        const w = s * 1.3, h = w * im.height / im.width;
        g.drawImage(im, -w / 2, -h / 2, w, h);
      } else {
        g.rotate(t * (0.4 + hot * 1.5));
        g.drawImage(im, -s * 0.65, -s * 0.65, s * 1.3, s * 1.3);
      }
      g.restore();
    }
    function drawSelect() {
      if (!sel) return;
      const t = now() - sel.t0;
      const fade = Math.min(1, t / 0.4) * (sel.chosen >= 0 ? 1 - clamp((now() - sel.ct - 0.55) / 0.4, 0, 1) : 1);
      G.setScreen();
      g.fillStyle = `rgba(2,8,18,${0.74 * fade})`; g.fillRect(0, 0, L.W, L.H);
      G.setWorld();
      const cx = L.DW / 2;
      g.save(); g.globalAlpha = fade;
      const ti = IMG.t_choose, tw = L.portrait ? 640 : 560, th = tw * ti.height / ti.width;
      g.drawImage(ti, cx - tw / 2, (L.portrait ? 200 : 132) - th / 2, tw, th);
      const rects = cardRects();
      DIVES.forEach((d, i) => {
        const r = rects[i];
        const u = clamp((t - 0.15 - i * 0.12) / 0.7, 0, 1);
        if (u <= 0) return;
        const hover = sel.hover === i && sel.chosen < 0;
        const chosen = sel.chosen === i;
        const other = sel.chosen >= 0 && !chosen;
        const ct = sel.chosen >= 0 ? clamp((now() - sel.ct) / 0.5, 0, 1) : 0;
        let sc = 0.6 + 0.4 * Ease.outBack(u);
        if (hover) sc *= 1.02;
        if (chosen) sc *= 1 + 0.06 * Ease.outBack(ct);
        const lift = (hover ? -10 : 0) + (1 - Ease.outCubic(u)) * 200 + (other ? ct * 120 : 0);
        const a = u * (other ? 1 - ct : 1);
        const ccx = r.x + r.w / 2, ccy = r.y + r.h / 2 + lift;
        g.save();
        g.globalAlpha = fade * a;
        g.translate(ccx, ccy); g.scale(sc, sc); g.translate(-r.w / 2, -r.h / 2);
        // card body
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = hover || chosen ? 34 : 24; g.shadowOffsetY = hover || chosen ? 16 : 10;
        G.rr(0, 0, r.w, r.h, 20); g.fillStyle = '#06121f'; g.fill();
        g.restore();
        g.save();
        G.rr(0, 0, r.w, r.h, 20); g.clip();
        coverDraw(IMG[d.bg], 0, 0, r.w, r.h, d.kind === 'vault' ? 0.45 : 0.5);
        const shade = g.createLinearGradient(0, 0, 0, r.h);
        shade.addColorStop(0, 'rgba(2,6,14,0.15)'); shade.addColorStop(0.42, 'rgba(2,6,14,0.35)'); shade.addColorStop(0.62, 'rgba(2,6,14,0.88)'); shade.addColorStop(1, 'rgba(2,6,14,0.97)');
        g.fillStyle = shade; g.fillRect(0, 0, r.w, r.h);
        g.restore();
        // a brass hairline; the dive's own colour when it is under the pointer or chosen
        g.lineWidth = hover || chosen ? 2.5 : 1.5;
        g.strokeStyle = hover || chosen ? `rgba(${d.col},0.95)` : G.LINE;
        G.rr(0, 0, r.w, r.h, 20); g.stroke();
        // icon, title, copy
        drawIcon(d, r.w / 2, r.h * 0.37, r.w * 0.36, now() + i, hover || chosen ? 1 : 0);
        const ti2 = IMG[d.title], tw2 = r.w * 0.92, th2 = tw2 * ti2.height / ti2.width;
        g.drawImage(ti2, (r.w - tw2) / 2, r.h * 0.04, tw2, th2);
        const lines = d.lines(sel.pearls);
        G.text(lines[0], r.w / 2, r.h * 0.62, L.portrait ? 28 : 25, { grad: G.GOLD, weight: 700 });
        G.text(lines[1], r.w / 2, r.h * 0.7, L.portrait ? 21 : 18, { color: G.CREAM, copy: true, weight: 700 });
        G.text(lines[2], r.w / 2, r.h * 0.765, L.portrait ? 21 : 18, { color: `rgb(${d.col})`, copy: true, weight: 700 });
        // volatility pips
        G.label('VOLATILITY', r.w / 2, r.h * 0.855, 13);
        for (let k = 0; k < 5; k++) {
          const px = r.w / 2 + (k - 2) * 26, py = r.h * 0.912, on = k < d.vol;
          g.fillStyle = on ? `rgb(${d.col})` : 'rgba(255,255,255,0.12)';
          g.beginPath(); g.arc(px, py, 7, 0, TAU); g.fill();
        }
        // keyboard hint
        g.lineWidth = 1.5; g.strokeStyle = G.LINE; g.beginPath(); g.arc(26, 26, 14, 0, TAU); g.stroke();
        G.text(String(i + 1), 26, 27, 16, { color: G.CREAM, shadow: false });
        g.restore();
      });
      const foot = sel.auto && sel.chosen < 0 ? `AUTO-PICK IN ${Math.max(0, Math.ceil(3.4 - t))}` : 'TAP A DIVE · SEE RULES FOR EACH RETURN ESTIMATE';
      G.label(foot, cx, L.portrait ? 1452 : 800, L.portrait ? 17 : 15, 'rgba(233,241,248,0.75)');
      g.restore();
    }
    function selectPointer(type, x, y) {
      if (!sel || sel.chosen >= 0) return !!sel;
      const rects = cardRects();
      let hit = -1;
      rects.forEach((r, i) => { if (x >= r.x && x <= r.x + r.w && y >= r.y - 20 && y <= r.y + r.h) hit = i; });
      if (type === 'move') {
        if (hit !== sel.hover && hit >= 0) SFX.play('cardHover');
        sel.hover = hit;
      } else if (type === 'down' && hit >= 0) choose(hit);
      return true;
    }
    function selectKey(code) {
      if (!sel) return false;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[code];
      if (n != null) { choose(n); return true; }
      return true;
    }

    // ============================== PEARL REEF ==============================
    let R = null;
    const JP = {
      mini: { label: 'MINI', col: '120,255,170', grad: ['#eafff2', '#8dffbe', '#2fbf6e', '#0d5a30'] },
      minor: { label: 'MINOR', col: '110,200,255', grad: ['#eaf6ff', '#9ad8ff', '#2f8fd8', '#0d3a6a'] },
      major: { label: 'MAJOR', col: '220,120,255', grad: ['#fbeaff', '#e2a0ff', '#a34ad8', '#46116a'] },
      grand: { label: 'GRAND', col: '255,200,80', grad: G.GOLD },
    };
    const cellXY = i => G.cellCenter(i % 5, Math.floor(i / 5));
    function reefLayout() {
      if (L.portrait) return { title: { x: 450, y: 110, w: 420 }, jp: { y: 330, w: 196, h: 92, gap: 14 }, left: L.hudL, right: L.hudR };
      return { title: { x: 178, y: 118, w: 300 }, jp: { y: 122, w: 200, h: 84, gap: 16 }, left: L.hudL, right: L.hudR };
    }
    async function runReef(pearls, sup, b, preWinX, positions) {
      await G.enterScene('reef', 'reef');
      const rs = M.reefStart(pearls, sup);
      await G.checkpoint();
      R = { rs, b, cells: new Array(15).fill(null), spin: new Map(), lamps: 3, lampT: -9, beams: [], total: 0, collecting: -1, grand: false, jpFlash: {}, sup };
      await G.introPanel('t_reef', [
        { t: sup ? `SUPER REEF · CASH x${rs.lvl}` : `${rs.cells.filter(Boolean).length} PEARLS LOCKED`, size: 70, grad: G.GOLD },
        { t: 'Every new pearl resets the respins to 3', size: 30, grad: G.CYAN },
        { t: 'Golden pearls double cash pearls', size: 30, grad: ['#fff8d0', '#ffd860', '#e09a20', '#8a5000'] },
        { t: 'Fill all 15 for the Grand Prize', size: 24, color: '#d6f0ff' },
      ]);
      // starting pearls drop in one by one
      let k = 0;
      for (let i = 0; i < 15; i++) {
        if (!rs.cells[i]) continue;
        R.cells[i] = Object.assign({}, rs.cells[i], { disp: rs.cells[i].v, pop: now() });
        splash(i, rs.cells[i].kind);
        SFX.play(rs.cells[i].kind === 'cash' ? 'pearlLand' : 'jackpotPearl', k++);
        await G.wait(G.turbo() ? 0.12 : 0.28);
      }
      await G.wait(0.5);
      while (rs.respins > 0) {
        G.setMsg(`RESPINS LEFT: ${rs.respins}`, G.CYAN);
        await reefRespinAnim();
        await G.checkpoint();
        await G.wait(G.turbo() ? 0.2 : 0.45);
      }
      if (rs.grand) {
        R.grand = true;
        st.banner = { text: 'GRAND PRIZE!', t0: now(), grad: G.GOLD, dur: 2.8 };
        SFX.play('jackpot', 2); st.shake = 20; st.flash = 1;
        for (let i = 0; i < 80; i++) G.spawnFountainCoin();
        await G.wait(3);
      }
      // collect every pearl into the total
      G.setMsg('COLLECTING THE REEF', G.GOLD);
      for (let i = 0; i < 15; i++) {
        const c = R.cells[i];
        if (!c) continue;
        R.collecting = i;
        R.total += c.v;
        const p = cellXY(i), d = reefLayout().right;
        for (let n = 0; n < 6; n++) G.pWorld.add({ x: p.x, y: p.y, vx: (d.x - p.x) * rnd(1.6, 2.2), vy: (d.y - p.y) * rnd(1.6, 2.2) - 200, ay: 300, drag: 0.94, max: 0.6, size: rnd(18, 30), img: SPR.spark, add: true });
        SFX.play('coin');
        c.collected = now();
        await G.wait(G.turbo() ? 0.08 : 0.18);
      }
      if (R.grand) R.total += M.PRIZES.GRAND;
      R.collecting = -1;
      await G.wait(0.6);
      const paid = await G.finishBonus(G.bonusUnits(), 't_reef', R.grand ? 'Including the Grand Prize' : `${R.cells.filter(Boolean).length} pearls collected`);
      R = null;
      return paid;
    }
    function splash(i, kind) {
      const p = cellXY(i), C = L.cell;
      const col = kind === 'gold' ? '255,210,90' : JP[kind] ? JP[kind].col : '160,240,255';
      G.pWorld.add({ type: 'ring', x: p.x, y: p.y, size: C * 0.2, grow: C * 1.8, max: 0.5, lw: 7, color: `rgba(${col},0.95)`, add: true });
      for (let n = 0; n < 12; n++) {
        const a = rnd(0, TAU), v = rnd(80, 300);
        G.pWorld.add({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.92, max: rnd(0.4, 0.9), size: rnd(14, 28), img: kind === 'gold' ? SPR.spark : SPR.sparkCyan, add: true });
      }
      for (let n = 0; n < 5; n++) G.pWorld.add({ x: p.x + rnd(-30, 30), y: p.y + rnd(-20, 20), vy: -rnd(60, 160), wob: 30, max: rnd(0.7, 1.2), size: rnd(8, 18), img: SPR.bubble });
      if (JP[kind]) { R.jpFlash[kind] = now(); st.shake = Math.max(st.shake, 8); }
    }
    async function reefRespinAnim() {
      const rs = R.rs;
      const empties = [];
      for (let i = 0; i < 15; i++) if (!rs.cells[i]) empties.push(i);
      const res = M.reefRespin(rs);
      const gmul = Math.pow(2, res.gold);
      const t0 = now();
      SFX.play('cellSpin');
      for (const i of empties) R.spin.set(i, { t0, stop: t0 + (G.turbo() ? 0.3 : 0.55) + (i % 5) * (G.turbo() ? 0.05 : 0.1) + Math.floor(i / 5) * 0.03 });
      // reveal each cell at its stop time
      const order = empties.slice().sort((a, b) => R.spin.get(a).stop - R.spin.get(b).stop);
      let landedN = 0;
      for (const i of order) {
        const wait = R.spin.get(i).stop - now();
        if (wait > 0) await G.wait(wait);
        R.spin.delete(i);
        const c = rs.cells[i];
        if (c && res.landed.includes(i)) {
          const disp = c.kind === 'cash' ? c.v / gmul : c.v;
          R.cells[i] = Object.assign({}, c, { disp, pop: now() });
          splash(i, c.kind);
          SFX.play(c.kind === 'cash' ? 'pearlLand' : c.kind === 'gold' ? 'goldPearl' : 'jackpotPearl', landedN++);
        }
      }
      if (res.landed.length) { R.lamps = 3; R.lampT = now(); SFX.play('respinReset'); }
      else { R.lamps = rs.respins; R.lampT = now(); SFX.play('respinLose'); }
      if (res.gold) {
        await G.wait(0.35);
        // golden pearls fire beams into every cash pearl and double it
        const golds = res.landed.filter(i => rs.cells[i].kind === 'gold');
        R.beams = [];
        for (const gi of golds) for (let i = 0; i < 15; i++) if (R.cells[i] && R.cells[i].kind === 'cash') R.beams.push({ from: gi, to: i, t0: now() });
        st.banner = { text: res.gold > 1 ? `x${gmul} BOARD!` : 'x2 BOARD!', t0: now(), grad: ['#fff8d0', '#ffd860', '#e09a20', '#8a5000'], dur: 1.6 };
        SFX.play('multUp'); st.shake = 10; st.flash = 0.5;
        await G.wait(0.5);
        for (let i = 0; i < 15; i++) {
          const c = R.cells[i];
          if (c && c.kind === 'cash') { c.from = c.disp; c.v = rs.cells[i].v; c.disp = c.v; c.dblT = now(); c.pop = now(); }
        }
        await G.wait(0.9);
        R.beams = [];
        st.banner = null;
      }
      if (res.full) await G.wait(0.3);
    }
    function drawPearlCell(i, c, t, b) {
      const p = cellXY(i), C = L.cell;
      let sc = 1;
      if (c.pop != null) { const u = (t - c.pop) / 0.7; if (u < 1) sc = 0.2 + 0.8 * Ease.outElastic(u); }
      const bob = Math.sin(t * 2 + i) * C * 0.02;
      const col = c.kind === 'gold' ? '255,210,90' : JP[c.kind] ? JP[c.kind].col : '150,235,255';
      g.save();
      g.globalCompositeOperation = 'lighter';
      G.glowAt(p.x, p.y, C * 0.55, col, R.collecting === i ? 0.7 : 0.22);
      g.restore();
      const im = c.kind === 'gold' ? IMG.p_gold : IMG.p_pearl, s = C * 0.82 * sc;
      g.drawImage(im, p.x - s / 2, p.y - s / 2 + bob, s, s);
      if (JP[c.kind]) {
        g.save(); g.lineWidth = 3; g.strokeStyle = `rgba(${col},0.95)`;
        g.beginPath(); g.arc(p.x, p.y + bob, s * 0.47, 0, TAU); g.stroke(); g.restore();
        G.text(JP[c.kind].label, p.x, p.y + bob - C * 0.05, C * 0.19 * sc, { grad: JP[c.kind].grad, weight: 700, outline: true });
        G.text(fmt(c.v * b), p.x, p.y + bob + C * 0.17, C * 0.13 * sc, { color: '#fff', weight: 700, outline: true });
      } else if (c.kind === 'gold') {
        G.text('x2', p.x, p.y + bob, C * 0.3 * sc, { grad: G.GOLD, weight: 700, outline: true, strokeColor: '#3a1a00' });
      } else {
        let v = c.v;
        if (c.dblT != null) { const u = clamp((t - c.dblT) / 0.6, 0, 1); v = lerp(c.from, c.v, u); }
        else if (c.disp != null) v = c.disp;
        const value = fmt(v * b, c.dblT != null && t - c.dblT < 0.6 ? 2 : undefined);
        G.text(value, p.x, p.y + bob + C * 0.02, C * (value.length > 7 ? 0.15 : 0.18) * sc, { grad: G.GOLD, weight: 700, outline: true });
      }
      if (c.collected != null && t - c.collected < 0.5) {
        g.save(); g.globalCompositeOperation = 'lighter'; G.glowAt(p.x, p.y, C * 0.8, '255,240,180', 0.8 * (1 - (t - c.collected) / 0.5)); g.restore();
      }
    }
    function drawReef() {
      if (!R) return;
      const t = now(), visual = ambient(), C = L.cell, b = R.b, lay = reefLayout();
      // title
      const ti = IMG.t_reef, tw = lay.title.w, th = tw * ti.height / ti.width;
      g.drawImage(ti, lay.title.x - tw / 2, lay.title.y - th / 2, tw, th);
      // jackpot plaques
      const order = ['mini', 'minor', 'major', 'grand'];
      const jw = lay.jp.w, jh = lay.jp.h, total = jw * 4 + lay.jp.gap * 3;
      order.forEach((k, n) => {
        const x = L.DW / 2 - total / 2 + n * (jw + lay.jp.gap), y = lay.jp.y - jh / 2;
        const flash = R.jpFlash[k] != null ? Math.max(0, 1 - (t - R.jpFlash[k]) / 1.2) : 0;
        G.card(x, y, jw, jh, 14, { line: `rgba(${JP[k].col},${0.55 + 0.45 * flash})` });
        G.label(JP[k].label, x + jw / 2, y + jh * 0.3, jh * 0.17, `rgb(${JP[k].col})`);
        G.text(fmt(M.PRIZES[k.toUpperCase()] * b), x + jw / 2, y + jh * 0.66, jh * 0.3 * (1 + 0.15 * flash), { color: G.CREAM, weight: 700 });
      });
      // side panels: respins and board total
      let board = 0;
      for (const c of R.cells) if (c) board += c.dblT != null ? lerp(c.from, c.v, clamp((t - c.dblT) / 0.6, 0, 1)) : (c.disp != null ? c.disp : c.v);
      const lw = L.portrait ? 380 : 270;
      G.hudPanel(lay.left.x, lay.left.y, lw, 150, 'RESPINS', '', G.CYAN);
      for (let k = 0; k < 3; k++) {
        const on = k < R.lamps, x = lay.left.x + (k - 1) * 62, y = lay.left.y + 22;
        const pulse = on ? 1 + 0.25 * Math.max(0, 1 - (t - R.lampT) / 0.4) : 1;
        g.save();
        g.globalAlpha = on ? 1 : 0.25;
        g.drawImage(IMG.p_pearl, x - 24 * pulse, y - 24 * pulse, 48 * pulse, 48 * pulse);
        g.restore();
      }
      const collected = R.collecting >= 0 || R.total, counting = !collected && R.cells.some(c => c && c.dblT != null && t - c.dblT < 0.6);
      G.hudPanel(lay.right.x, lay.right.y, lw, 150, collected ? 'TOTAL WIN' : 'BOARD TOTAL', fmt((collected ? R.total : board) * b, counting ? 2 : undefined), G.GOLD);
      // board frame
      const pad = 18;
      G.card(L.gx - pad, L.gy - pad, L.gw + pad * 2, L.gh + pad * 2, 24, { top: 'rgba(8,24,46,0.8)', bottom: 'rgba(4,14,30,0.86)', line: 'rgba(244,217,149,0.55)' });
      // cells
      for (let i = 0; i < 15; i++) {
        const p = cellXY(i);
        g.save();
        G.rr(p.x - C * 0.46, p.y - C * 0.46, C * 0.92, C * 0.92, 22);
        const cg = g.createRadialGradient(p.x, p.y - C * 0.15, C * 0.05, p.x, p.y, C * 0.6);
        cg.addColorStop(0, 'rgba(30,80,120,0.4)'); cg.addColorStop(1, 'rgba(6,20,44,0.7)');
        g.fillStyle = cg; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = R.spin.has(i) ? 'rgba(160,236,255,0.75)' : 'rgba(244,217,149,0.18)'; g.stroke();
        g.restore();
        const sp = R.spin.get(i);
        if (sp) {
          // the empty cell churns: ghost pearls streak through it
          g.save();
          G.rr(p.x - C * 0.46, p.y - C * 0.46, C * 0.92, C * 0.92, 22); g.clip();
          const off = ((t - sp.t0) * 6 + i * 0.37) % 1;
          for (let k = -1; k <= 1; k++) {
            g.globalAlpha = 0.25;
            const s = C * 0.7;
            g.drawImage(IMG.p_pearl, p.x - s / 2, p.y - s / 2 + (k + off) * C * 0.9, s, s * 1.4);
          }
          g.restore();
        }
      }
      // golden beams
      for (const bm of R.beams) {
        const a = cellXY(bm.from), z = cellXY(bm.to), u = clamp((t - bm.t0) / 0.4, 0, 1);
        g.save(); g.globalCompositeOperation = 'lighter';
        g.strokeStyle = 'rgba(255,220,120,0.85)'; g.lineWidth = 6 + 4 * Math.sin(t * 30);
        g.shadowColor = 'rgba(255,200,80,1)'; g.shadowBlur = 20;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(lerp(a.x, z.x, u), lerp(a.y, z.y, u)); g.stroke();
        g.restore();
      }
      for (let i = 0; i < 15; i++) if (R.cells[i]) drawPearlCell(i, R.cells[i], t, b);
    }

    // ============================== CAPTAIN'S VAULT ==============================
    let V = null;
    const chestXY = i => ({ x: L.gx + (i % 4 + 0.5) * (L.gw / 4), y: L.gy + (Math.floor(i / 4) + 0.5) * (L.gh / 3) });
    function vaultLayout() {
      if (L.portrait) return { title: { x: 450, y: 125, w: 440 }, lives: { y: 330 }, left: L.hudL, right: L.hudR };
      return { title: { x: 178, y: 118, w: 300 }, lives: { y: 132 }, left: L.hudL, right: L.hudR };
    }
    async function runVault(pearls, sup, b, preWinX) {
      await G.enterScene('vault', 'vault');
      const vs = M.vaultStart(pearls, sup);
      await G.checkpoint();
      V = { vs, b, chests: vs.chests.map(() => ({ shake: -1, open: -1, item: null, missed: false })), hover: -1, busy: false, picker: null, lives: vs.lives, lifeFx: [], coins: 0, mult: vs.mult, tentacle: null, ended: false, sup };
      await G.introPanel('t_vault', [
        { t: sup ? `SUPER VAULT · x${vs.mult} START` : `${vs.lives} LIVES · 12 CHESTS`, size: 66, grad: G.GOLD },
        { t: 'Coins add up · +x chests raise the multiplier', size: 28, grad: ['#fff8d0', '#ffd860', '#e09a20', '#8a5000'] },
        { t: 'A pearl gives an extra life', size: 28, grad: G.CYAN },
        { t: 'The Kraken takes one · coins x multiplier is paid', size: 24, color: '#ffd9c8' },
      ]);
      G.setMsg('PICK A CHEST', G.GOLD);
      while (!vs.over) {
        const i = await new Promise(res => {
          V.picker = res;
          if (st.auto > 0 || st.replayOnly || st.resuming) G.wait(1.1).then(() => { if (V && V.picker === res) res(V.chests.findIndex(c => c.open < 0)); });
        });
        V.picker = null;
        await openChest(i);
        await G.checkpoint();
      }
      V.ended = true;
      st.banner = { text: V.lives <= 0 ? 'THE KRAKEN STRIKES!' : 'VAULT CLEARED!', t0: now(), grad: V.lives <= 0 ? G.RED : G.GOLD, dur: 2 };
      if (V.lives <= 0) { SFX.play('roar'); st.shake = 16; } else SFX.play('winMed');
      await G.wait(1.8);
      // show what was left behind
      for (let i = 0; i < 12; i++) {
        if (V.chests[i].open >= 0) continue;
        V.chests[i].open = now(); V.chests[i].item = vs.chests[i]; V.chests[i].missed = true;
        await G.wait(0.07);
      }
      await G.wait(0.8);
      const total = G.bonusUnits();
      V.final = now();
      SFX.play('multUp');
      await G.wait(1.6);
      const paid = await G.finishBonus(total, 't_vault', `${fmt(vs.coins * b)} in coins x${vs.mult}`);
      V = null;
      return paid;
    }
    async function openChest(i) {
      V.busy = true;
      const c = V.chests[i];
      c.shake = now();
      SFX.play('chestShake');
      await G.wait(G.turbo() ? 0.25 : 0.45);
      const item = M.vaultPick(V.vs, i);
      c.open = now(); c.item = item;
      const p = chestXY(i), lay = vaultLayout();
      st.flash = Math.max(st.flash, 0.35);
      G.pWorld.add({ type: 'ring', x: p.x, y: p.y, size: 30, grow: 400, max: 0.45, lw: 8, color: item.kind === 'kraken' ? 'rgba(255,60,40,0.95)' : 'rgba(255,230,150,0.95)', add: true });
      if (item.kind === 'kraken') {
        SFX.play('roar'); SFX.play('lifeLose');
        st.shake = 18; st.flash = 0.9;
        V.tentacle = { x: p.x, y: p.y + 40, t0: now() };
        V.lives--;
        V.lifeFx.push({ idx: V.lives, t0: now(), lost: true });
        G.setMsg(V.lives > 0 ? `THE KRAKEN STOLE A LIFE! ${V.lives} LEFT` : 'THE KRAKEN TOOK YOUR LAST LIFE!', G.RED);
        await G.waitSkip(G.turbo() ? 0.9 : 1.4, G.RESULT_HOLD);
      } else {
        SFX.play('chestOpen');
        for (let n = 0; n < 16; n++) G.pWorld.add({ x: p.x, y: p.y - 10, vx: rnd(-240, 240), vy: rnd(-560, -280), ay: 1300, max: rnd(0.8, 1.2), size: rnd(26, 42), img: G.SYM[5].img, flip: rnd(8, 14), fadeOut: 0.25 });
        if (item.kind === 'coin') {
          SFX.play('coins', 14);
          V.coins += item.v;
          G.setMsg(`${fmt(item.v * V.b)} IN GOLD!`, G.GOLD);
          for (let n = 0; n < 8; n++) G.pWorld.add({ x: p.x, y: p.y, vx: (lay.left.x - p.x) * rnd(1.5, 2), vy: (lay.left.y - p.y) * rnd(1.5, 2) - 180, ay: 260, drag: 0.94, max: 0.6, size: rnd(18, 30), img: SPR.spark, add: true });
        } else if (item.kind === 'mult') {
          SFX.play('multUp');
          V.mult += item.v;
          G.setMsg(`VAULT MULTIPLIER x${V.mult}!`, G.PINK);
          V.multPop = now();
        } else if (item.kind === 'life') {
          SFX.play('lifeGain');
          V.lifeFx.push({ idx: V.lives, t0: now(), gained: true });
          V.lives++;
          G.setMsg('EXTRA LIFE!', G.CYAN);
        }
        await G.waitSkip(G.turbo() ? 0.6 : 1.0, G.RESULT_HOLD);
      }
      V.busy = false;
    }
    function drawItem(item, x, y, s, a, t) {
      g.save(); g.globalAlpha *= a;
      if (item.kind === 'coin') {
        g.drawImage(G.SYM[5].img, x - s * 0.45, y - s * 0.62, s * 0.9, s * 0.9);
        G.text(fmt(item.v * V.b), x, y + s * 0.32, s * 0.28, { grad: G.GOLD, weight: 700 });
      } else if (item.kind === 'mult') {
        G.text(`+${item.v}x`, x, y - s * 0.08, s * 0.5, { grad: G.PINK, weight: 700 });
        G.label('MULTIPLIER', x, y + s * 0.32, s * 0.13, '#ffc6ec');
      } else if (item.kind === 'life') {
        g.drawImage(IMG.p_pearl, x - s * 0.36, y - s * 0.5, s * 0.72, s * 0.72);
        G.label('+1 LIFE', x, y + s * 0.34, s * 0.15, '#9eeaff');
      } else {
        G.drawArms([[x + s * 0.04, y + s * 0.24, s * 0.8, 0.08, t, 1, 1, 1]]);
        G.label('KRAKEN', x, y + s * 0.36, s * 0.15, '#ffab88');
      }
      g.restore();
    }
    function drawVault() {
      if (!V) return;
      const t = now(), visual = ambient(), lay = vaultLayout(), cw = L.gw / 4, chH = L.gh / 3;
      const ti = IMG.t_vault, tw = lay.title.w, th = tw * ti.height / ti.width;
      g.drawImage(ti, lay.title.x - tw / 2, lay.title.y - th / 2, tw, th);
      // the chests sit on a board, like the reels do
      const pad = 16;
      G.card(L.gx - pad, L.gy - pad, L.gw + pad * 2, L.gh + pad * 2, 24, { top: 'rgba(30,18,8,0.72)', bottom: 'rgba(14,8,4,0.82)', line: 'rgba(244,217,149,0.55)' });
      g.save(); g.strokeStyle = 'rgba(244,217,149,0.12)'; g.lineWidth = 1;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(L.gx + k * cw, L.gy + 8); g.lineTo(L.gx + k * cw, L.gy + L.gh - 8); g.stroke(); }
      for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(L.gx + 8, L.gy + k * chH); g.lineTo(L.gx + L.gw - 8, L.gy + k * chH); g.stroke(); }
      g.restore();
      // lives row
      const maxL = Math.max(V.lives, 1) + V.lifeFx.filter(f => f.lost && t - f.t0 < 1).length;
      const n = Math.max(V.lives, maxL);
      const lw2 = n * 62 + 150;
      G.card(L.DW / 2 - lw2 / 2 - 40, lay.lives.y - 34, lw2, 68, 34, { top: 'rgba(10,26,48,0.86)', bottom: 'rgba(6,16,30,0.9)' });
      G.label('LIVES', L.DW / 2 - n * 31 - 70, lay.lives.y, 15, G.BRASS_HI);
      for (let k = 0; k < n; k++) {
        const x = L.DW / 2 + (k - (n - 1) / 2) * 62, y = lay.lives.y;
        const lost = V.lifeFx.find(f => f.lost && f.idx === k && t - f.t0 < 1);
        if (k >= V.lives && !lost) continue;
        let s = 46, a = 1;
        if (lost) { const u = (t - lost.t0) / 1; s *= 1 + u * 0.8; a = 1 - u; }
        const gained = V.lifeFx.find(f => f.gained && f.idx === k && t - f.t0 < 0.7);
        if (gained) s *= 0.4 + 0.6 * Ease.outElastic((t - gained.t0) / 0.7);
        g.save(); g.globalAlpha = a;
        if (lost) { g.globalCompositeOperation = 'lighter'; G.glowAt(x, y, 40, '255,60,40', 0.5 * a); g.globalCompositeOperation = 'source-over'; }
        g.drawImage(IMG.p_pearl, x - s / 2, y - s / 2, s, s);
        g.restore();
      }
      // coins and multiplier panels
      const pw = L.portrait ? 380 : 270;
      G.hudPanel(lay.left.x, lay.left.y, pw, 130, 'COINS', fmt(V.coins * V.b), G.GOLD);
      const mp = V.multPop != null ? 1 + 0.35 * Math.max(0, 1 - (t - V.multPop) / 0.5) : 1;
      G.hudPanel(lay.right.x, lay.right.y, pw, 130, 'VAULT MULTIPLIER', 'x' + V.mult, G.PINK, mp);
      // chests
      const im = IMG.ui_chest;
      for (let i = 0; i < 12; i++) {
        const c = V.chests[i], p = chestXY(i);
        const w = cw * 0.86, h = w * im.height / im.width;
        let dx = 0, rot = 0, sc = 1, a = 1;
        const hover = V.hover === i && c.open < 0 && !V.busy && V.picker;
        if (c.open < 0) {
          const bob = Math.sin(visual * 1.2 + i * 0.9) * 1.5;
          if (c.shake >= 0) { const u = t - c.shake; dx = Math.sin(u * 60) * 6 * Math.min(1, u * 4); rot = Math.sin(u * 50) * 0.06; sc = 1 + u * 0.15; }
          if (hover) { sc *= 1.06; g.save(); g.lineWidth = 2; g.strokeStyle = 'rgba(244,217,149,0.7)'; G.rr(p.x - cw / 2 + 8, p.y - chH / 2 + 8, cw - 16, chH - 16, 14); g.stroke(); g.restore(); }
          g.save();
          g.translate(p.x + dx, p.y + bob); g.rotate(rot); g.scale(sc, sc);
          g.drawImage(im, -w / 2, -h / 2, w, h);
          g.restore();
        } else {
          const u = clamp((t - c.open) / 0.5, 0, 1);
          a = c.missed ? 0.45 : 1;
          g.save(); g.globalAlpha = 0.35 * a;
          g.drawImage(im, p.x - w / 2, p.y - h / 2 + 10, w, h);
          g.restore();
          if (c.item) {
            const rise = (1 - Ease.outBack(u)) * 40;
            g.save(); g.globalAlpha = a;
            drawItem(c.item, p.x, p.y - rise, Math.min(cw, chH) * 0.8 * (0.4 + 0.6 * Ease.outBack(u)), 1, t + i);
            g.restore();
          }
        }
      }
      // the kraken's arm bursts out of a chest
      if (V.tentacle) {
        const u = (t - V.tentacle.t0) / 1.4;
        if (u >= 1) V.tentacle = null;
        else {
          const reach = u < 0.3 ? Ease.outBack(u / 0.3) : u > 0.68 ? 1 - Ease.inCubic((u - 0.68) / 0.32) : 1;
          const tx = V.tentacle.x, ty = V.tentacle.y;
          g.save();
          g.globalCompositeOperation = 'lighter'; G.glowAt(tx, ty - 40, chH * 0.9, '255,50,30', 0.6 * Math.min(1, reach)); g.globalCompositeOperation = 'source-over';
          // the arms come up out of the chest's mouth, so hide everything below it
          g.beginPath(); g.rect(-4000, -4000, 8000 + L.DW, ty - 30 + 4000); g.clip();
          G.drawArms([[tx - 18, ty, chH * 2.5, -0.1, t, 0, reach, 1], [tx + 30, ty + 8, chH * 1.8, 0.32, t, 2.3, Math.max(0, reach * 0.94), -1]]);
          g.restore();
        }
      }
      // final equation
      if (V.final != null) {
        const u = clamp((t - V.final) / 0.5, 0, 1);
        g.save(); g.globalAlpha = u;
        const cx = L.DW / 2, cy = L.gy + L.gh / 2;
        const bw = 720, bh = 130;
        G.card(cx - bw / 2, cy - bh / 2, bw, bh, bh / 2);
        G.text(`${fmt(V.vs.coins * V.b)}  x${V.vs.mult}  =  ${fmt(M.vaultTotal(V.vs) * V.b)}`, cx, cy + 2, 52 * (0.8 + 0.2 * Ease.outBack(u)), { grad: G.GOLD, weight: 700 });
        g.restore();
      }
    }
    function vaultPointer(type, x, y) {
      if (!V) return false;
      let hit = -1;
      for (let i = 0; i < 12; i++) {
        const p = chestXY(i);
        if (Math.abs(x - p.x) < L.gw / 8 && Math.abs(y - p.y) < L.gh / 6) hit = i;
      }
      if (type === 'move') { if (hit !== V.hover && hit >= 0 && V.chests[hit].open < 0 && V.picker) SFX.play('cardHover'); V.hover = hit; }
      else if (type === 'down' && hit >= 0 && V.picker && !V.busy && V.chests[hit].open < 0) V.picker(hit);
      return true;
    }

    // ============================== WHEEL OF THE DEEP ==============================
    let W = null;
    const SEG_STYLE = {
      kraken: { c0: '#ff6a3a', c1: '#7a0c10', label: ['KRAKEN', 'FREE SPINS'], icon: 'fx_eye' },
      reef: { c0: '#5ff0ff', c1: '#0a4a7a', label: ['PEARL', 'REEF'], icon: 'p_pearl' },
      vault: { c0: '#ffd56b', c1: '#7a4a0c', label: ['CAPTAIN\'S', 'VAULT'], icon: 'ui_chest' },
      cash: { c0: '#c58bff', c1: '#3a1270', label: ['CASH'], icon: null },
    };
    function wheelGeom() {
      return L.portrait ? { x: 450, y: 720, r: 400, title: { x: 450, y: 140, w: 560 } } : { x: 800, y: 492, r: 312, title: { x: 178, y: 118, w: 300 } };
    }
    const segs = (() => {
      let tw = 0;
      tw = M.WHEEL.length;
      let a = 0;
      return M.WHEEL.map(s => { const span = TAU / tw; const o = Object.assign({}, s, { a0: a, a1: a + span }); a += span; return o; });
    })();
    function segAt(rot) {
      const a = ((-rot % TAU) + TAU) % TAU;
      for (let i = 0; i < segs.length; i++) if (a >= segs[i].a0 && a < segs[i].a1) return i;
      return 0;
    }
    async function runWheel(pearls, b, preWinX) {
      await G.enterScene('wheel', 'wheel');
      W = { rot: Math.random() * TAU, state: 'idle', kick: 0, landed: -1, tapRes: null, b, lastSeg: -1, t0: now() };
      W.lastSeg = segAt(W.rot);
      G.setMsg('TAP THE HELM TO SPIN', G.CYAN);
      await new Promise(res => {
        W.tapRes = res;
        if (st.auto > 0 || st.replayOnly || st.resuming) G.wait(1.8).then(() => { if (W && W.tapRes === res) res(); });
      });
      W.tapRes = null;
      const idx = M.wheelSpin(), s = segs[idx];
      const target = s.a0 + (s.a1 - s.a0) * rnd(0.2, 0.8);
      let end = -target;
      while (end < W.rot + TAU * 5) end += TAU;
      W.state = 'spin'; W.from = W.rot; W.to = end; W.st = now(); W.dur = G.turbo() ? 3.6 : 5.8;
      SFX.play('wheelStart');
      G.setMsg('', G.CYAN);
      await G.wait(W.dur + 0.1);
      W.rot = W.to; W.state = 'done'; W.landed = idx; W.lt = now();
      await G.checkpoint();
      SFX.play('wheelStop'); st.shake = 10; st.flash = 0.5;
      const seg = segs[idx];
      if (seg.kind === 'cash') {
        st.banner = { text: `CASH PRIZE ${seg.v}x`, t0: now(), grad: G.PINK, dur: 2.2 };
        for (let i = 0; i < 40; i++) G.spawnFountainCoin();
        await G.wait(2.4);
        const paid = await G.finishBonus(G.bonusUnits(), 't_wheel', 'Cash prize from the deep');
        W = null;
        return { cash: paid };
      }
      const names = { kraken: 'KRAKEN\'S WRATH', reef: 'PEARL REEF', vault: 'CAPTAIN\'S VAULT' };
      st.banner = { text: (seg.sup ? 'SUPER ' : '') + names[seg.kind] + '!', t0: now(), grad: seg.sup ? G.GOLD : G.CYAN, dur: 2.4 };
      if (seg.sup) { SFX.play('jackpotPearl'); for (let i = 0; i < 24; i++) G.spawnFountainCoin(); }
      await G.wait(2.6);
      st.banner = null;
      W = null;
      return { kind: seg.kind, sup: !!seg.sup };
    }
    function updateWheel() {
      if (!W || W.state !== 'spin') return;
      const u = clamp((now() - W.st) / W.dur, 0, 1);
      const e = 1 - Math.pow(1 - u, 3.4);
      W.rot = lerp(W.from, W.to, e);
      const sgi = segAt(W.rot);
      if (sgi !== W.lastSeg) { W.lastSeg = sgi; W.kick = 1; SFX.play('wheelTick'); }
    }
    function drawWheel() {
      if (!W) return;
      const t = now(), visual = ambient(), wg = wheelGeom(), R0 = wg.r;
      const ti = IMG.t_wheel, tw = wg.title.w, th = tw * ti.height / ti.width;
      g.drawImage(ti, wg.title.x - tw / 2, wg.title.y - th / 2, tw, th);
      W.kick *= 0.86;
      g.save();
      g.translate(wg.x, wg.y);
      // halo
      g.save(); g.globalCompositeOperation = 'lighter';
      G.glowAt(0, 0, R0 * 1.3, '120,255,210', 0.12);
      g.restore();
      // outer gold ring
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 30;
      const ring = g.createRadialGradient(0, 0, R0 * 0.9, 0, 0, R0 * 1.08);
      ring.addColorStop(0, '#5c3308'); ring.addColorStop(0.4, '#f5c65a'); ring.addColorStop(0.75, '#9a5f18'); ring.addColorStop(1, '#fff0b0');
      g.fillStyle = ring; g.beginPath(); g.arc(0, 0, R0 * 1.08, 0, TAU); g.fill();
      g.restore();
      g.rotate(W.rot);
      // segments
      segs.forEach((s, i) => {
        const st0 = SEG_STYLE[s.kind];
        const a0 = s.a0 - Math.PI / 2, a1 = s.a1 - Math.PI / 2;
        const gr = g.createRadialGradient(0, 0, R0 * 0.2, 0, 0, R0);
        gr.addColorStop(0, st0.c1); gr.addColorStop(0.75, st0.c0); gr.addColorStop(1, st0.c1);
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R0 * 0.94, a0, a1); g.closePath(); g.fill();
        if (s.sup) {
          g.save(); g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(255,220,120,${0.25 + 0.15 * Math.sin(t * 6 + i)})`;
          g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R0 * 0.94, a0, a1); g.closePath(); g.fill();
          g.restore();
        }
        if (W.state === 'done' && W.landed !== i) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R0 * 0.94, a0, a1); g.closePath(); g.fill(); }
        if (W.state === 'done' && W.landed === i) {
          g.save(); g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(255,255,255,${0.25 + 0.2 * Math.sin(t * 10)})`;
          g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R0 * 0.94, a0, a1); g.closePath(); g.fill();
          g.restore();
        }
        // divider
        g.strokeStyle = '#ffe9a8'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(Math.cos(a0) * R0 * 0.3, Math.sin(a0) * R0 * 0.3); g.lineTo(Math.cos(a0) * R0 * 0.94, Math.sin(a0) * R0 * 0.94); g.stroke();
        // label, written along the radius
        const mid = (a0 + a1) / 2, span = s.a1 - s.a0;
        g.save();
        g.rotate(mid);
        const lines = s.kind === 'cash' ? [`${s.v}x`, 'CASH'] : s.sup ? ['SUPER', { kraken: 'KRAKEN', reef: 'REEF', vault: 'VAULT' }[s.kind]] : st0.label;
        const lh = Math.min(34, Math.max(16, span * R0 * 0.7 / (lines.length + 0.4)));
        const maxW = R0 * 0.44;
        lines.forEach((ln, k) => {
          let fs = lh * (k === 0 && (s.sup || s.kind === 'cash') ? 1.12 : 1);
          g.font = `600 ${fs}px "Fredoka", sans-serif`;
          const w0 = g.measureText(ln).width;
          if (w0 > maxW) fs *= maxW / w0;
          const yy = (k - (lines.length - 1) / 2) * lh * 1.05;
          G.text(ln, R0 * 0.71, yy, fs, { grad: s.sup ? G.GOLD : ['#ffffff', '#f2f6ff', '#d4e0ee'], weight: 700, outline: true, strokeColor: '#160616' });
        });
        g.restore();
        // peg on the rim
        g.fillStyle = '#fff6d0';
        g.beginPath(); g.arc(Math.cos(a0) * R0 * 0.99, Math.sin(a0) * R0 * 0.99, 8, 0, TAU); g.fill();
        g.strokeStyle = '#5c3308'; g.lineWidth = 2; g.stroke();
      });
      // the ship's helm as the hub
      const wi = IMG.ui_wheel, ws = R0 * 0.92;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 24;
      g.drawImage(wi, -ws / 2, -ws / 2, ws, ws);
      g.restore();
      g.restore();
      // rim lights
      for (let k = 0; k < 28; k++) {
        const a = k / 28 * TAU, on = W.state === 'spin' ? (Math.floor(t * 12) + k) % 2 === 0 : (Math.floor(t * 3) + k) % 3 === 0;
        const x = wg.x + Math.cos(a) * R0 * 1.035, y = wg.y + Math.sin(a) * R0 * 1.035;
        g.fillStyle = on ? '#fffbe0' : '#8a5a20'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
      }
      // pointer at the top
      g.save();
      g.translate(wg.x, wg.y - R0 * 1.06);
      g.rotate(-0.45 * W.kick);
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 12;
      const pg = g.createLinearGradient(-28, 0, 28, 0);
      pg.addColorStop(0, '#fff0b0'); pg.addColorStop(0.5, '#f5b335'); pg.addColorStop(1, '#8a4a0a');
      g.fillStyle = pg;
      g.beginPath(); g.moveTo(-30, -34); g.lineTo(30, -34); g.lineTo(0, 46); g.closePath(); g.fill();
      g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = '#3a1500'; g.stroke();
      g.drawImage(IMG.p_pearl, -20, -56, 40, 40);
      g.restore();
      // hub button
      if (W.state === 'idle') {
        const pulse = 1 + 0.025 * Math.sin(t * 3);
        g.save(); g.translate(wg.x, wg.y); g.scale(pulse, pulse);
        G.pill('SPIN', 0, 2, 34);
        g.restore();
      }
    }
    function wheelPointer(type, x, y) {
      if (!W) return false;
      const wg = wheelGeom();
      if (type === 'down' && W.state === 'idle' && W.tapRes && Math.hypot(x - wg.x, y - wg.y) < wg.r * 1.1) { SFX.play('click'); W.tapRes(); }
      return true;
    }

    // ============================== shared hooks ==============================
    return {
      select, runReef, runVault, runWheel,
      reset() { sel = null; R = null; V = null; W = null; },
      update() { updateWheel(); },
      draw() {
        if (st.scene === 'reef') drawReef();
        else if (st.scene === 'vault') drawVault();
        else if (st.scene === 'wheel') drawWheel();
      },
      drawOverlay() { drawSelect(); },
      active() { return !!sel; },
      pointer(type, x, y) {
        if (sel) return selectPointer(type, x, y);
        if (st.scene === 'vault') return vaultPointer(type, x, y);
        if (st.scene === 'wheel') return wheelPointer(type, x, y);
        return false;
      },
      key(code) { return selectKey(code); },
      tapToSpin() { if (W && W.tapRes && W.state === 'idle') { W.tapRes(); return true; } return false; },
      revealNext() {
        if (V && V.picker && !V.busy) {
          const index = V.chests.findIndex(c => c.open < 0);
          if (index >= 0) { V.picker(index); return true; }
        }
        return false;
      },
    };
  };
})();

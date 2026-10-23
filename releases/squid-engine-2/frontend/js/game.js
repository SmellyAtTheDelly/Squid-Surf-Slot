(function () {
  'use strict';
  const M = Object.assign({}, window.SlotConfig), FX = window.FX, SFX = window.SFX, Contract = window.SlotContract;
  let playback = null;
  for (const name of ['krakenStart', 'krakenStep', 'reefStart', 'reefRespin', 'vaultStart', 'vaultPick', 'vaultTotal', 'wheelSpin']) M[name] = (...args) => playback[name](...args);
  M.emptySticky = () => Array.from({ length: M.REELS }, () => new Array(M.ROWS).fill(0));
  const { S, REELS, ROWS } = M;
  const { TAU, rnd, clamp, lerp, Ease, SPR } = FX;
  const $ = id => document.getElementById(id);
  const cvs = $('game');
  const g = cvs.getContext('2d');

  // ---------- config ----------
  let BETS = [1];
  const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';
  const SYM_FILES = ['J', 'Q', 'K', 'A', 'silver', 'gold', 'anchor', 'wild', 'scatter'];
  const SYM_SCALE = [0.8, 0.8, 0.8, 0.8, 0.86, 0.86, 0.88, 0.96, 0.93];
  const SYM_TIER = [0, 0, 0, 0, 1, 1, 1, 2, 2];
  const SYM_DARK = ['#3a1400', '#05303a', '#26093f', '#3d0508', '#14243a', '#3a2200', '#3a2200', '#2a0838', '#16204a'];
  const STYLE_K = 1.25; // styled symbol canvases carry a 32px margin around the 256px art
  const SYM_GLOW = ['255,150,40', '60,230,210', '190,100,255', '255,70,70', '190,220,255', '255,200,60', '255,210,90', '235,90,255', '120,240,255'];
  const WIN_NAMES = ['J', 'Q', 'K', 'A', 'SILVER COIN', 'GOLD COIN', 'ANCHOR', 'SQUID WILD', 'PEARLS'];
  const TIPS = ['3 SQUIDS TRIGGER THE COIN BONUS', 'WILDS STICK & MULTIPLY IN FREE SPINS', 'THE SQUAD CAN ATTACK ON BASE SPINS!', '243 WAYS TO WIN · UP TO 5,000x', 'PRESS SPACE TO SPIN'];
  const BUY_MODES = Contract.MODES.filter(item => item.buy);
  const BUY_NAMES = { vault: 'Coin Bonus', reef: 'Super Bonus', kraken: 'Legendary Bonus', wheel: 'Mystery Bonus', wilds: 'Six Wilds' };
  const GOLD = ['#fffbe0', '#ffe07a', '#f5a623', '#b85f0a'];
  const PINK = ['#fff0fb', '#ffa3e8', '#e646c8', '#7a1590'];
  const CYAN = ['#f2ffff', '#a6f4ff', '#3cc7f0', '#0f6a9a'];
  const RED = ['#fff1e8', '#ffb38a', '#ff4a2a', '#8a0f0f'];
  const SQUAD_COLORS = [['#c656ff', '#6d1fae', '#f2b8ff'], ['#ff5fa8', '#a3195c', '#ffc0dc'], ['#34d6e8', '#126a8a', '#c9f8ff'], ['#ff9a3c', '#a84a0c', '#ffd7a8']];

  const fmt = (v, precision) => {
    const code = st.currency || 'USD';
    const social = { XGC: 'GC', XSC: 'SC', XEC: 'SC' }[code];
    const digits = precision == null ? v && Math.abs(v) < 0.01 ? 6 : 2 : precision;
    const maximum = precision == null ? 6 : precision;
    if (social) return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: maximum }) + ' ' + social;
    try { return Number(v).toLocaleString(st.language || 'en', { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: maximum }); }
    catch (error) { return Number(v).toFixed(digits) + ' ' + code; }
  };

  // ---------- state ----------
  const st = {
    balance: 0, balanceMicro: null, currency: 'USD', betIdx: 0, turbo: false, auto: 0, mode: 'base', busy: false, spinning: false, ready: false,
    selectedDive: 'vault', replayOnly: false, connected: false, jurisdiction: {}, shownUnits: 0, shownMicro: 0, round: null, engineError: null,
    bonusMix: 0, bonusTarget: 0, win: null, plaque: null, msg: { text: '', t0: 0, grad: GOLD }, tipIdx: 0, tipT: 0,
    fs: null, bw: null, panel: null, banner: null, ink: null, shake: 0, shakeX: 0, shakeY: 0, squads: [], lastWin: 0,
    scatCeleb: -1, triggerCells: [], flash: 0, antFrom: -1, slammed: false, scene: 'base', awaken: null, lastChoice: null, buyKind: 'vault', ante: false,
  };
  try {
    st.turbo = localStorage.getItem('ss_turbo') === '1';
    st.ante = localStorage.getItem('ss_ante') === '1';
  } catch (e) { /* storage unavailable */ }
  function save() {
    try {
      localStorage.setItem('ss_turbo', st.turbo ? '1' : '0');
      localStorage.setItem('ss_ante', st.ante ? '1' : '0');
    } catch (e) { /* ignore */ }
  }
  const bet = () => BETS[st.betIdx];
  let spaceHeld = false, spaceActive = false, spaceStarted = 0;
  const turbo = () => !st.jurisdiction.disabledTurbo && (st.turbo || spaceActive);
  function releaseSpace() {
    if (!spaceHeld && !spaceActive) return;
    spaceHeld = false; spaceActive = false;
    if (st.ready) ui();
  }
  function updateSpace() {
    if (!spaceHeld) return;
    if (!st.ready || !st.connected || openModal || !$('volumePanel').hidden || document.hidden || st.jurisdiction.disabledSpacebar) { releaseSpace(); return; }
    if (!spaceActive && performance.now() - spaceStarted >= 250) {
      spaceActive = true;
      if (turbo()) slam();
      ui();
    }
    if (spaceActive && !st.busy && !st.auto && !st.inBonus && !st.replayOnly && !st.jurisdiction.disabledAutoplay && st.mode === 'base' && session.state.phase === 'ready') doSpin();
  }
  const session = window.EngineSession.create({ location: window.location.href, fetch: window.fetch.bind(window), contract: Contract, onChange: syncSession });
  function syncSession(state) {
    st.balanceMicro = state.balance;
    st.balance = state.balance == null ? 0 : state.balance / 1000000;
    st.currency = state.currency || st.currency;
    st.replayOnly = state.replayOnly;
    st.demo = state.demo;
    st.engineError = state.error || null;
    st.connected = !['idle', 'authenticating', 'error', 'recovering'].includes(state.phase);
    st.jurisdiction = state.config && state.config.jurisdiction || {};
    if (st.jurisdiction.disabledTurbo) st.turbo = false;
    if (st.jurisdiction.disabledAutoplay) st.auto = 0;
    const status = $('engineStatus');
    status.hidden = !state.error;
    $('engineMessage').textContent = state.error ? state.error.message : '';
    if (st.ready) ui();
  }
  function acceptConfiguration(state) {
    const config = state.config || {};
    if (config.jurisdiction && config.jurisdiction.minimumRoundDuration > 0) throw new Error('This session requires a round timing setting that this game cannot yet support.');
    if (st.sessionStarted == null) {
      st.sessionStarted = performance.now();
      st.openingBalance = state.balance == null ? 0 : state.balance + (state.round && !state.replayOnly ? state.round.cost : 0);
    }
    if (state.replayOnly) BETS = [state.round.amount / 1000000];
    else BETS = (config.betLevels && config.betLevels.length ? config.betLevels : [config.defaultBetLevel]).filter(value => Number.isSafeInteger(value) && value >= config.minBet && value <= config.maxBet && value % config.stepBet === 0).map(value => value / 1000000);
    if (!BETS.length) throw new Error('The session did not provide valid bet levels');
    const defaultBet = config.defaultBetLevel / 1000000;
    st.betIdx = Math.max(0, BETS.indexOf(defaultBet));
    st.language = new URLSearchParams(window.location.search).get('lang') || 'en';
    if (state.round) st.ante = Contract.mode(state.round.mode).ante;
    else if (!modeAvailable(modeName(false))) {
      const available = Contract.MODES.find(item => !item.buy && modeAvailable(item.name));
      if (available) st.ante = available.ante;
    }
    if (!state.replayOnly) constrainBet(modeName(false));
    syncSession(state);
  }
  function modeAvailable(name) { return !!(session.state.config && session.state.config.gameModes && session.state.config.gameModes[name]); }
  function modeName(buy, kind) { return buy ? 'buy_' + (kind || st.buyKind) : st.ante ? 'ante_vault' : 'base_vault'; }
  function buyCost(kind) { return Contract.mode(modeName(true, kind)).cost; }
  function allowedBets(name) {
    const config = session.state.config, mode = config && config.gameModes[name];
    return mode ? BETS.map((value, index) => value * 1000000 <= mode.maxBet ? index : -1).filter(index => index >= 0) : [];
  }
  function constrainBet(name) {
    const indices = allowedBets(name);
    if (indices.length && !indices.includes(st.betIdx)) st.betIdx = indices.at(-1);
  }
  function selectDive(kind) {
    if (st.busy || st.replayOnly || !st.connected || kind !== 'vault' || !modeAvailable(modeName(false))) return false;
    constrainBet(modeName(false)); save(); ui();
    return true;
  }
  function sessionDetail() {
    const parts = [];
    if (st.replayOnly && st.round) parts.push(`REPLAY · BASE ${fmt(st.round.amount / 1000000)} · COST ${fmt(st.round.cost / 1000000)} · WIN ${fmt(st.round.payout / 1000000)}`);
    else if (st.demo) parts.push('LOCAL DEMO · PLAY MONEY');
    if (st.jurisdiction.displayRTP) parts.push(`RTP ${M.RTP.toFixed(2)}%`);
    if (st.jurisdiction.displayNetPosition && !st.replayOnly && st.balanceMicro != null) parts.push('NET ' + fmt((st.balanceMicro - st.openingBalance) / 1000000));
    if (st.jurisdiction.displaySessionTimer && st.sessionStarted != null) {
      const seconds = Math.floor((performance.now() - st.sessionStarted) / 1000);
      parts.push('SESSION ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
    }
    $('sessionDetail').textContent = parts.join(' · ');
  }
  function displayAward(units) {
    if (!Number.isSafeInteger(units) || units < 0) throw new Error('Invalid recorded award');
    const accepted = Math.min(units, st.round.payoutUnits - st.shownUnits);
    st.shownUnits += accepted;
    const total = Contract.payoutAmount(st.round.amount, st.shownUnits);
    const amount = total - st.shownMicro;
    st.shownMicro = total;
    return { units: accepted, amount, capped: playback.capped && st.shownUnits === st.round.payoutUnits };
  }
  async function checkpoint() {
    if (playback && playback.eventIndex > session.state.round.eventIndex) await session.checkpoint(playback.eventIndex);
  }

  // ---------- assets ----------
  const IMG = {}, SYM = [];
  const ASSETS = {
    bg: 'assets/bg.webp', bgBonus: 'assets/bg_bonus.webp', logo: 'assets/t_logo.webp', big: 'assets/t_bigwin.webp',
    mega: 'assets/t_megawin.webp', epic: 'assets/t_epicwin.webp', fs: 'assets/t_freespins.webp',
  };
  SYM_FILES.forEach((f, i) => { ASSETS['s' + i] = `assets/sym_${f}.webp`; });
  ['f_yellow', 'f_purple', 'f_sardine', 'f_manta', 'f_bigsquid', 'f_turtle', 'f_kelp', 'f_jelly', 'f_squad', 'ui_corner',
    'bg_kraken', 'bg_reef', 'bg_vault', 'bg_helm', 'ui_wheel', 'ui_chest', 'fx_eye', 'fx_tentacle', 'p_pearl', 'p_gold',
    't_kraken', 't_reef', 't_vault', 't_wheel', 't_choose'].forEach(k => { ASSETS[k] = `assets/${k}.webp`; });
  function loadAll(onProg) {
    const keys = Object.keys(ASSETS);
    let done = 0;
    return Promise.all(keys.map(k => new Promise(res => {
      const im = new Image();
      im.onload = im.onerror = () => { done++; onProg(done / keys.length); res(); };
      im.src = ASSETS[k];
      IMG[k] = im;
    })));
  }
  // Each symbol is pre-styled once: drop shadow, coloured glow, thick dark outline, punchier colour and a gloss.
  function stylize(img, i) {
    const N = 410, P = 51, D = N + P * 2; // 512: the art fills the middle 80%
    const sil = FX.canvas(D, D), sg = sil.getContext('2d');
    sg.drawImage(img, P, P, N, N);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = SYM_DARK[i]; sg.fillRect(0, 0, D, D);
    const art = FX.canvas(D, D), at = art.getContext('2d');
    if ('filter' in at) at.filter = 'saturate(1.3) contrast(1.1) brightness(1.05)';
    at.drawImage(img, P, P, N, N);
    if ('filter' in at) at.filter = 'none';
    at.globalCompositeOperation = 'source-atop';
    const gl = at.createLinearGradient(0, P, 0, P + N * 0.55);
    gl.addColorStop(0, 'rgba(255,255,255,0.24)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    at.fillStyle = gl; at.fillRect(0, 0, D, D);
    const c = FX.canvas(D, D), t = c.getContext('2d');
    t.save(); t.globalAlpha = 0.6; t.shadowColor = 'rgba(0,0,0,0.95)'; t.shadowBlur = 22; t.shadowOffsetY = 16; t.drawImage(sil, 0, 0); t.restore();
    t.save(); t.shadowColor = 'rgba(' + SYM_GLOW[i] + ',' + (SYM_TIER[i] ? 1 : 0.75) + ')'; t.shadowBlur = SYM_TIER[i] ? 38 : 24;
    t.drawImage(sil, 0, 0); t.drawImage(sil, 0, 0);
    t.restore();
    const ow = SYM_TIER[i] === 2 ? 9.5 : 8;
    for (let a = 0; a < 20; a++) t.drawImage(sil, Math.cos(a / 20 * TAU) * ow, Math.sin(a / 20 * TAU) * ow);
    t.drawImage(art, 0, 0);
    return { img: c, mask: art };
  }
  function buildSymbols() {
    for (let i = 0; i < 9; i++) {
      const { img, mask } = stylize(IMG['s' + i], i);
      // vertical motion-blur version: 16 offset copies averaged, on a taller canvas so trails are not clipped
      const D = img.width, BH = Math.round(D * 1.6), bl = FX.canvas(D, BH), bt = bl.getContext('2d');
      const off = (BH - D) / 2;
      for (let k = 0; k < 16; k++) { bt.globalAlpha = 1 / (k + 1); bt.drawImage(img, 0, off + (k / 15 - 0.5) * D * 0.46); }
      SYM[i] = { img, mask, blur: bl };
    }
  }
  // Squad squids: one painted squid, hue-shifted into a team, split so the tentacles can wave under the body.
  const SQUAD = [];
  function hueShift(src, deg) {
    const c = FX.canvas(src.width, src.height), t = c.getContext('2d');
    t.drawImage(src, 0, 0);
    if (!deg) return c;
    const d = t.getImageData(0, 0, c.width, c.height), p = d.data;
    const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const m = [0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.14, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072];
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1], b = p[i + 2];
      p[i] = m[0] * r + m[1] * gg + m[2] * b; p[i + 1] = m[3] * r + m[4] * gg + m[5] * b; p[i + 2] = m[6] * r + m[7] * gg + m[8] * b;
    }
    t.putImageData(d, 0, 0);
    return c;
  }
  function buildSquad() {
    const src = IMG.f_squad;
    if (!src || !src.width) return;
    for (const deg of [0, 45, -55, 115]) {
      const full = hueShift(src, deg);
      const w = full.width, h = full.height;
      const tent = FX.canvas(w, h), body = FX.canvas(w, h);
      const tt = tent.getContext('2d'), bt = body.getContext('2d');
      tt.drawImage(full, 0, 0); bt.drawImage(full, 0, 0);
      // tentacles: everything below the mantle and left of the head, softly feathered into the body
      const mask = FX.canvas(w, h), mt = mask.getContext('2d');
      mt.fillStyle = '#000';
      mt.fillRect(0, h * 0.3, w * 0.3, h);
      const gr = mt.createLinearGradient(0, h * 0.42, 0, h * 0.5);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000');
      mt.fillStyle = gr; mt.fillRect(w * 0.3, 0, w * 0.5, h);
      const hz = mt.createLinearGradient(w * 0.72, 0, w * 0.82, 0);
      hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, '#000');
      mt.globalCompositeOperation = 'destination-out'; mt.fillStyle = hz; mt.fillRect(w * 0.72, 0, w * 0.28, h);
      const mk = (ctx, keepTent) => { ctx.globalCompositeOperation = keepTent ? 'destination-in' : 'destination-out'; ctx.drawImage(mask, 0, 0); };
      mk(tt, true); mk(bt, false);
      SQUAD.push({ tent, body });
    }
  }
  let causticPat = null, causticTile = null;

  // ---------- layout ----------
  const L = { W: 1, H: 1, dpr: 1, s: 1, ox: 0, oy: 0, DW: 1600, DH: 900, portrait: false, cell: 172, gx: 0, gy: 0, gw: 0, gh: 0 };
  const bar = $('bar'), buyBtn = $('btnBuy'), anteBtn = $('btnAnte');
  function layout() {
    L.dpr = Math.min(2, window.devicePixelRatio || 1);
    L.W = window.innerWidth; L.H = window.innerHeight;
    cvs.width = Math.round(L.W * L.dpr); cvs.height = Math.round(L.H * L.dpr);
    const barH = bar.offsetHeight || 100;
    const availH = Math.max(200, L.H - barH);
    L.portrait = L.W / availH < 0.9;
    if (L.portrait) {
      Object.assign(L, { DW: 900, DH: 1480, cell: 168 });
      L.gx = 30; L.gy = 440;
      L.logo = { x: 450, y: 225, w: 620 };
      L.msgY = 1004; L.buy = { x: 292, y: 1210, k: 1.45 }; L.ante = { x: 608, y: 1210, k: 1.45 };
      L.hudL = { x: 230, y: 1150 }; L.hudR = { x: 670, y: 1150 }; L.side = null;
      L.center = { x: 450, y: 690 };
    } else {
      Object.assign(L, { DW: 1600, DH: 900, cell: 172 });
      L.gx = 370; L.gy = 222;
      L.logo = { x: 800, y: 116, w: 400 };
      L.msgY = 792; L.buy = { x: 178, y: 478, k: 1 }; L.ante = { x: 1422, y: 478, k: 1 };
      L.hudL = { x: 178, y: 478 }; L.hudR = { x: 1422, y: 478 }; L.side = { x: 1422, y: 478 };
      L.center = { x: 800, y: 480 };
    }
    L.gw = L.cell * REELS; L.gh = L.cell * ROWS;
    L.glRect = { x: L.gx - L.cell * 0.7, y: L.gy - L.cell * 0.7, w: L.gw + L.cell * 1.4, h: L.gh + L.cell * 1.4 };
    L.s = Math.min(L.W / L.DW, availH / L.DH);
    L.ox = (L.W - L.DW * L.s) / 2; L.oy = (availH - L.DH * L.s) / 2;
    // DOM bonus-buy and ante buttons follow their design-space positions
    for (const [elm, p] of [[buyBtn, L.buy], [anteBtn, L.ante]]) {
      elm.style.left = (L.ox + p.x * L.s) + 'px'; elm.style.top = (L.oy + p.y * L.s) + 'px';
      elm.style.transform = `translate(-50%,-50%) scale(${(L.s * p.k).toFixed(3)})`;
    }
    if (window.SeaLife) SeaLife.resize(L.W, L.H);
  }

  // ---------- time / async helpers ----------
  let clock = 0, ambientClock = 0, fastForwardUntil = 0;
  const RESULT_HOLD = 0.15;
  const waits = [], tweens = [];
  function wait(sec, skippable, minimum = 0) { return new Promise(res => waits.push({ t: clock + sec, minUntil: performance.now() + minimum * 1000, res, skippable })); }
  const waitSkip = (sec, minimum = 0) => wait(sec, true, minimum);
  function tween(dur, fn, skippable = false) { return new Promise(res => tweens.push({ t0: clock, dur, fn, res, skippable })); }
  function resetInput() { fastForwardUntil = 0; releaseSpace(); }
  function skipNow() {
    if (!st.ready || !st.connected || !st.busy || openModal) return;
    if (st.panel && st.panel.resolve) st.panel.resolve();
    if (st.jurisdiction.disabledSlamstop) return;
    if (!st.jurisdiction.disabledTurbo) fastForwardUntil = performance.now() + 700;
    for (const item of waits) if (item.skippable) item.t = clock;
    for (const item of tweens) if (item.skippable) item.t0 = clock - item.dur;
    if (st.plaque) {
      st.plaque.dismiss = true;
      if (st.plaque.dur === 0 && !waits.some(item => item.minUntil > performance.now())) st.plaque = null;
    }
    if (st.spinning) slam();
    if (st.bw) st.bw.skip = true;
  }

  // ---------- reels ----------
  // Each reel is an endless strip: symbol k is drawn at row (k + pos). Spins ease in, stop with a deceleration
  // that starts at the reel's exact speed (no jumps), then settle with a soft overshoot.
  const cellFx = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => ({ pop: -1 })));
  const reels = [];
  let reelsDone = null;
  const VMAX = 25, VANT = 13;
  function initReels() {
    const grid = Array.from({ length: REELS }, (_, r) => Array.from({ length: ROWS }, (_, y) => (r + y * 2) % 7));
    for (let r = 0; r < REELS; r++) reels[r] = { strip: grid[r].slice(), final: grid[r].slice(), syms: new Map(), pos: 0, vi: 0, phase: 'idle', v: 0, t0: 0, stopAt: 0, ant: false, flash: -9 };
  }
  function fillerSym(r) {
    return Math.floor(Math.random() * (r ? 8 : 7));
  }
  function visibleGrid() { return reels.map(R => R.strip.slice(0, 3)); }
  function symAt(R, k, r) {
    let s = R.syms.get(k);
    if (s === undefined) { s = fillerSym(r); R.syms.set(k, s); }
    return s;
  }

  function spinTo(final) {
    const fast = turbo();
    const base = fast ? 0.32 : 0.62, gap = fast ? 0.08 : 0.19, antGap = fast ? 0.85 : 1.25;
    let cnt = 0, t = clock + base;
    st.antFrom = -1; st.slammed = false;
    const stopAt = [];
    for (let r = 0; r < REELS; r++) {
      stopAt[r] = t;
      cnt += final[r].filter(sym => sym === (st.fs ? S.SCATTER : S.WILD)).length;
      if (st.antFrom < 0 && cnt >= 2 && r < REELS - 1 && (!st.round || st.round.kind !== 'wilds')) st.antFrom = r;
      t += st.antFrom >= 0 && r >= st.antFrom ? antGap : gap;
    }
    st.spinning = true;
    return new Promise(res => {
      reelsDone = res;
      for (let r = 0; r < REELS; r++) {
        const R = reels[r];
        R.syms = new Map();
        R.strip.forEach((sym, y) => R.syms.set(y, sym));
        R.final = final[r].slice();
        R.pos = 0; R.v = 0; R.vi = 0; R.ant = false;
        R.phase = 'windup'; R.t0 = clock + r * (fast ? 0.025 : 0.06); R.stopAt = stopAt[r];
        for (let y = 0; y < ROWS; y++) cellFx[r][y].pop = -1;
      }
    });
  }
  function slam() {
    if (!st.spinning || st.jurisdiction.disabledSlamstop) return;
    let i = 0;
    st.slammed = true;
    SFX.anticipationStop();
    for (const R of reels) {
      if (R.phase === 'windup' || R.phase === 'spin') { R.stopAt = Math.min(R.stopAt, clock + 0.02 + i * 0.045); R.ant = false; i++; }
    }
  }
  function beginStop(R) {
    const T = turbo() ? 0.26 : 0.4, over = 0.17;
    const d = Math.max(3.6, R.v * T / 2);
    const P = Math.ceil(R.pos + d);
    for (let y = 0; y < ROWS; y++) R.syms.set(y - P, R.final[y]);
    R.P = P; R.p0 = R.pos; R.over = over; R.dist = P + over - R.pos;
    R.Tdec = 2 * R.dist / Math.max(4, R.v);
    R.landT = clock; R.phase = 'land';
  }
  function updateReels(dt) {
    if (!st.spinning) return;
    let all = true;
    for (let r = 0; r < REELS; r++) {
      const R = reels[r];
      const prev = R.pos;
      switch (R.phase) {
        case 'windup': {
          all = false;
          const u = (clock - R.t0) / 0.15;
          if (u < 0) break;
          if (u < 1) R.pos = -0.24 * Math.sin(u * Math.PI / 2);
          else { R.phase = 'spin'; R.spinT = clock; R.v = 0; }
          break;
        }
        case 'spin': {
          all = false;
          const ramp = Math.min(1, (clock - R.spinT) / 0.3);
          const target = R.ant ? VANT : VMAX;
          R.v += (target - R.v) * Math.min(1, dt * (2.5 + 10 * ramp * ramp));
          R.pos += R.v * dt;
          if (clock >= R.stopAt && R.v > 8) beginStop(R);
          break;
        }
        case 'land': {
          all = false;
          const u = (clock - R.landT) / R.Tdec;
          if (u >= 1) { R.pos = R.P + R.over; R.phase = 'settle'; R.setT = clock; onReelLanded(r); }
          else R.pos = R.p0 + R.dist * (1 - (1 - u) * (1 - u));
          break;
        }
        case 'settle': {
          const u = (clock - R.setT) / 0.28;
          if (u >= 1) { R.pos = R.P; R.phase = 'idle'; R.strip = R.final.slice(); R.syms.clear(); }
          else { R.pos = R.P + R.over * (0.5 + 0.5 * Math.cos(Math.PI * u)); all = false; }
          break;
        }
        default: break;
      }
      R.vi = dt > 0 ? Math.abs(R.pos - prev) / dt : 0;
    }
    if (all && reelsDone) { st.spinning = false; const f = reelsDone; reelsDone = null; f(); }
  }
  function onReelLanded(r) {
    const R = reels[r];
    SFX.play('reelStop', r);
    R.flash = clock;
    let scatSoFar = 0;
    for (let q = 0; q <= r; q++) for (let y = 0; y < ROWS; y++) if (reels[q].final[y] === S.SCATTER) scatSoFar++;
    for (let y = 0; y < ROWS; y++) {
      const sym = R.final[y];
      const sticky = st.fs && st.fs.show[r][y] > 0;
      const c = cellCenter(r, y);
      cellFx[r][y].pop = clock;
      if (sym === S.WILD && !sticky) {
        SFX.play('wildLand');
        burst(c.x, c.y, 'wild');
      } else if (sym === S.SCATTER) {
        SFX.play('scatterLand', scatSoFar - 1);
        burst(c.x, c.y, 'scatter');
        st.shake = Math.max(st.shake, 5);
      }
    }
    // a few bubbles puff up from the bottom of the stopped reel
    for (let i = 0; i < 5; i++) pWorld.add({ x: L.gx + (r + rnd(0.15, 0.85)) * L.cell, y: L.gy + L.gh - 10, vy: -rnd(90, 220), wob: 40, max: rnd(0.5, 0.9), size: rnd(8, 18), img: SPR.bubble, alpha: 0.8 });
    if (R.ant) { R.ant = false; }
    if (!st.slammed && st.antFrom >= 0 && r >= st.antFrom && r < REELS - 1) {
      const next = reels[r + 1];
      if (next.phase === 'spin' || next.phase === 'windup') {
        next.ant = true;
        if (r === st.antFrom) SFX.anticipationStart();
      }
    }
    if (r === REELS - 1 || (st.antFrom >= 0 && r > st.antFrom && !reels.some(x => x.ant))) SFX.anticipationStop();
  }
  const cellCenter = (r, y) => ({ x: L.gx + (r + 0.5) * L.cell, y: L.gy + (y + 0.5) * L.cell });

  // ---------- particles ----------
  const pWorld = new FX.Particles(700);   // design space, over reels
  const pTop = new FX.Particles(500);     // screen space, over everything (coins)
  function burst(x, y, kind) {
    const C = L.cell;
    if (kind === 'wild') {
      for (let i = 0; i < 14; i++) {
        const a = rnd(0, TAU), v = rnd(120, 420);
        pWorld.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.92, max: rnd(0.5, 0.9), size: rnd(14, 34), img: SPR.ink, rot: rnd(0, TAU), grow: -10 });
      }
      for (let i = 0; i < 8; i++) pWorld.add({ x: x + rnd(-40, 40), y: y + rnd(-30, 30), vy: rnd(-160, -60), wob: 50, max: rnd(0.8, 1.4), size: rnd(10, 24), img: SPR.bubble });
      pWorld.add({ type: 'ring', x, y, size: C * 0.3, grow: C * 1.6, max: 0.45, lw: 8, color: 'rgba(230,110,255,0.9)', add: true });
    } else if (kind === 'scatter') {
      for (let i = 0; i < 16; i++) {
        const a = rnd(0, TAU), v = rnd(80, 340);
        pWorld.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.93, max: rnd(0.5, 1.0), size: rnd(18, 40), img: i % 2 ? SPR.sparkCyan : SPR.sparkPink, add: true, vr: rnd(-4, 4) });
      }
      pWorld.add({ type: 'ring', x, y, size: C * 0.25, grow: C * 1.8, max: 0.5, lw: 6, color: 'rgba(150,240,255,0.9)', add: true });
      pWorld.add({ x, y, size: C * 2.2, max: 0.5, img: SPR.glow, add: true, alpha: 0.7, grow: -C });
    } else if (kind === 'win') {
      for (let i = 0; i < 6; i++) {
        pWorld.add({ x: x + rnd(-C * 0.4, C * 0.4), y: y + rnd(-C * 0.4, C * 0.4), vy: rnd(-90, -30), max: rnd(0.5, 1.1), size: rnd(16, 34), img: SPR.spark, add: true, vr: rnd(-3, 3) });
      }
      for (let i = 0; i < 2; i++) pWorld.add({ x: x + rnd(-40, 40), y: y + rnd(-20, 30), vy: rnd(-140, -70), wob: 40, max: rnd(0.9, 1.5), size: rnd(10, 20), img: SPR.bubble });
    } else if (kind === 'coins') {
      for (let i = 0; i < 3; i++) {
        pWorld.add({ x, y, vx: rnd(-220, 220), vy: rnd(-620, -360), ay: 1500, max: rnd(0.9, 1.3), size: rnd(36, 54), img: i % 3 ? SYM[S.GOLD].img : SYM[S.SILVER].img, flip: rnd(8, 14), fadeOut: 0.25 });
      }
    } else if (kind === 'sticky') {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        pWorld.add({ x: x + Math.cos(a) * C * 0.42, y: y + Math.sin(a) * C * 0.42, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, drag: 0.9, max: 0.7, size: rnd(18, 30), img: SPR.sparkPink, add: true });
      }
      pWorld.add({ type: 'ring', x, y, size: C * 0.55, grow: -C * 0.5, max: 0.4, lw: 10, color: 'rgba(255,120,240,0.95)', add: true });
    }
  }

  // ---------- ambient world ----------
  function updateAmbient(dt) {
    ambientClock += dt;
    SeaLife.update(dt, ambientClock, st.bonusMix);
    pWorld.update(dt);
    pTop.update(dt);
    st.bonusMix += (st.bonusTarget - st.bonusMix) * Math.min(1, dt * 3);
    st.shake *= Math.pow(0.0015, dt);
    st.flash *= Math.pow(0.02, dt);
    if (st.detailSecond !== Math.floor(ambientClock)) { st.detailSecond = Math.floor(ambientClock); sessionDetail(); }
    if (!st.spinning && st.ready && ambientClock > (st.shineT || 0)) {
      st.shineT = ambientClock + rnd(0.9, 2.2);
      const r = (Math.random() * REELS) | 0, y = (Math.random() * ROWS) | 0;
      if (reels[r] && reels[r].phase === 'idle') st.idleShine = { r, y, t0: ambientClock };
    }
    if (!st.spinning && st.ready && Math.random() < dt * 4) {
      const r = (Math.random() * REELS) | 0, y = (Math.random() * ROWS) | 0;
      if (reels[r] && reels[r].phase === 'idle' && SYM_TIER[reels[r].strip[y]] > 0) {
        const c = cellCenter(r, y);
        pWorld.add({ x: c.x + rnd(-0.32, 0.32) * L.cell, y: c.y + rnd(-0.32, 0.32) * L.cell, max: rnd(0.4, 0.8), size: rnd(14, 26), img: SPR.spark, add: true, vr: rnd(-3, 3), fadeIn: 0.3 });
      }
    }
  }

  function mixColor(a, b, k) {
    return `rgba(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))},${lerp(a[3], b[3], k).toFixed(3)})`;
  }

  function drawBackground() {
    const W = L.W, H = L.H, k = st.bonusMix, t = ambientClock;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.fillStyle = '#020b14'; g.fillRect(0, 0, W, H);
    const im = IMG[SCENES[st.scene].bg] || IMG.bg;
    const zoom = 1.05 + Math.sin(t * 0.05) * 0.015;
    const sc = Math.max(W / im.width, H / im.height) * zoom;
    const iw = im.width * sc, ih = im.height * sc;
    const ix = (W - iw) / 2 + Math.sin(t * 0.037) * W * 0.008, iy = (H - ih) / 2 + Math.cos(t * 0.031) * H * 0.006;
    // backdrop drawn in strips that sway slightly: a soft underwater shimmer
    const strips = 18, sh = ih / strips, srcH = im.height / strips, amp = 1.7 * (H / 900);
    const plate = (img, a) => {
      g.globalAlpha = a;
      for (let i = 0; i < strips; i++) {
        const off = Math.sin(t * 0.9 + i * 0.55) * amp;
        const sy = i * srcH, shh = Math.min(srcH + 1, img.height - sy);
        g.drawImage(img, 0, sy, img.width, shh, ix + off, iy + i * sh, iw, sh * shh / srcH + 0.5);
      }
      g.globalAlpha = 1;
    };
    if (st.scene !== 'base') plate(im, 1);
    else { if (k < 0.999) plate(im, 1); if (k > 0.001) plate(IMG.bgBonus, k); }
    SeaLife.drawFar(g, t, k);
    // caustic shimmer
    if (causticPat) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const cs = H / 500;
      for (let i = 0; i < 2; i++) {
        const m = new DOMMatrix().translate(t * (i ? -14 : 9) * cs, t * (i ? 6 : 11) * cs).scale(cs * (i ? 1.4 : 1.1));
        causticPat.setTransform(m);
        g.globalAlpha = (i ? 0.05 : 0.07) * (1 - 0.6 * k);
        g.fillStyle = causticPat;
        g.fillRect(0, 0, W, H * 0.8);
      }
      g.restore();
    }
    SeaLife.drawRays(g, t, k, 1 - 0.3 * k);
    SeaLife.drawMid(g, t, k);
    SeaLife.drawNear(g, t, k);
    drawSceneFx(t, ix, iy, iw, ih);
    // vignette + bonus tint
    const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(' + Math.round(10 * k) + ',0,' + Math.round(8 * (1 - k)) + ',' + (0.6 + 0.15 * k) + ')');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  // lantern flicker in the vault, and the Kraken itself during an awakening
  function drawSceneFx(t, ix, iy, iw, ih) {
    const W = L.W, H = L.H;
    if (st.scene === 'vault') {
      g.save(); g.globalCompositeOperation = 'lighter';
      [[0.135, 0.29], [0.21, 0.37], [0.545, 0.39], [0.748, 0.29]].forEach(([fx, fy], i) => {
        const a = 0.32 + 0.12 * Math.sin(t * 13 + i * 2.1) + 0.08 * Math.sin(t * 31 + i);
        glowAt(ix + fx * iw, iy + fy * ih, ih * 0.13, '255,186,90', a);
      });
      g.restore();
    }
    const aw = st.awaken;
    if (aw) {
      const a = clock - aw.t0;
      if (a > 3.6) { st.awaken = null; return; }
      const open = a < 0.6 ? Ease.outCubic(a / 0.6) : a > 2.9 ? 1 - Ease.inCubic(Math.min(1, (a - 2.9) / 0.6)) : 1;
      g.fillStyle = `rgba(30,0,0,${0.45 * open})`; g.fillRect(0, 0, W, H);
      const sz = Math.min(H, W * 1.5);
      drawArms([[0.04, -1, 1.0], [0.2, -1, 0.76], [0.8, 1, 0.8], [0.96, 1, 0.98]].map(([fx, side, k], i) => {
        const d = a - [0, 0.18, 0.09, 0.27][i];
        const reach = d < 0 ? 0 : d < 0.75 ? Ease.outBack(d / 0.75) : a > 2.75 ? 1 - Ease.inCubic(Math.min(1, (a - 2.75) / 0.75)) : 1;
        return [W * fx, H + sz * 0.05, sz * k, -side * (0.16 + 0.08 * (i % 2)), t, i * 1.9, reach, side < 0 ? 1 : -1];
      }));
    }
  }

  // the Kraken's eye opens over the whole scene during an awakening
  function drawAwakenEye() {
    const aw = st.awaken;
    if (!aw) return;
    const a = clock - aw.t0, W = L.W, H = L.H;
    const open = a < 0.6 ? Ease.outCubic(a / 0.6) : a > 2.9 ? 1 - Ease.inCubic(Math.min(1, (a - 2.9) / 0.6)) : 1;
    if (open <= 0.01) return;
    const eye = IMG.fx_eye, ew = Math.min(W * 0.78, H * 1.25), eh = ew * eye.height / eye.width;
    setScreen();
    g.save();
    g.globalCompositeOperation = 'lighter';
    glowAt(W / 2, H * 0.42, ew * 0.6, '255,110,40', 0.45 * open);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.72 * Math.min(1, open * 1.2);
    g.translate(W / 2, H * 0.42); g.scale(1 + 0.03 * Math.sin(clock * 8), Math.max(0.02, open));
    g.drawImage(eye, -ew / 2, -eh / 2, ew, eh);
    g.restore();
    setWorld();
  }

  // ---------- drawing helpers ----------
  function setWorld() { g.setTransform(L.dpr * L.s, 0, 0, L.dpr * L.s, L.dpr * (L.ox + st.shakeX), L.dpr * (L.oy + st.shakeY)); }
  function setScreen() { g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0); }
  function rr(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function text(str, x, y, size, o) {
    o = o || {};
    g.font = `${size}px "Lilita One", "Trebuchet MS", sans-serif`;
    g.textAlign = o.align || 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = size * 0.5; }
    if (o.stroke !== false) { g.lineWidth = size * (o.sw || 0.2); g.strokeStyle = o.strokeColor || '#1b0a2e'; g.strokeText(str, x, y); }
    g.shadowBlur = 0;
    if (o.grad) {
      const gr = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
      o.grad.forEach((c, i) => gr.addColorStop(i / (o.grad.length - 1), c));
      g.fillStyle = gr;
    } else g.fillStyle = o.color || '#fff';
    g.fillText(str, x, y);
  }
  const shineBufs = new Map();
  function shineOverlay(mask, x, y, w, h, u, strength) {
    const dw = mask.width, dh = mask.height, key = dw + 'x' + dh;
    let c = shineBufs.get(key);
    if (!c) { c = FX.canvas(dw, dh); shineBufs.set(key, c); }
    const t = c.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, dw, dh);
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = 'source-in';
    const bx = lerp(-0.5, 1.5, u) * dw;
    const gr = t.createLinearGradient(bx - dw * 0.22, 0, bx + dw * 0.22, dh * 0.4);
    gr.addColorStop(0, 'rgba(255,250,230,0)'); gr.addColorStop(0.5, 'rgba(255,250,230,' + (strength || 0.55) + ')'); gr.addColorStop(1, 'rgba(255,250,230,0)');
    t.fillStyle = gr; t.fillRect(0, 0, dw, dh);
    g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(c, x, y, w, h); g.restore();
  }
  function drawShiny(img, x, y, w, h, u) {
    g.drawImage(img, x, y, w, h);
    if (u >= 0 && u <= 1) shineOverlay(img, x, y, w, h, u, 0.5);
  }
  // Painted kraken arms. Each is [x, y, height, lean, t, phase, reach, flip] with its base at (x, y); the arm sways and
  // curls on the GPU mesh and reach (0..1) slides it up out of whatever is below it.
  function drawArms(list) {
    const img = IMG.fx_tentacle;
    SeaLife.batch(g, () => {
      for (const [x, y, h, lean, t, ph, reach, flip] of list) {
        if (reach <= 0.001) continue;
        const w = h * img.width / img.height;
        g.save();
        g.translate(x, y);
        g.rotate(lean + Math.sin(t * 1.25 + ph) * 0.06);
        g.scale(flip, 1);
        g.translate(0, (1 - reach) * h * 1.02);
        const coil = 1 + 0.035 * Math.sin(t * 2.1 + ph * 1.7);
        g.scale(1 / Math.sqrt(coil), coil);
        SeaLife.warp(g, img, 0, -h / 2, w, h, { mode: 1, amp: w * 0.15, k: 2.8, ph: t * 2.3 + ph, pow: 1.5 });
        g.restore();
      }
    });
  }
  function glowAt(x, y, R, rgb, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.5, `rgba(${rgb},${a * 0.35})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
  }

  // ---------- reel frame ----------
  function drawFrame() {
    const { gx, gy, gw, gh } = L, k = st.bonusMix, t = ambientClock;
    const pad = 22, ox = gx - pad, oy = gy - pad, ow = gw + pad * 2, oh = gh + pad * 2;
    // outer glow
    g.save();
    g.shadowColor = k > 0.5 ? 'rgba(255,40,40,0.55)' : 'rgba(80,220,255,0.35)';
    g.shadowBlur = 50;
    rr(ox, oy, ow, oh, 30); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fill();
    g.restore();
    // glass panel
    rr(gx - 6, gy - 6, gw + 12, gh + 12, 16);
    const gp = g.createLinearGradient(0, gy, 0, gy + gh);
    gp.addColorStop(0, mixColor([12, 52, 80, 0.86], [70, 8, 20, 0.88], k));
    gp.addColorStop(0.5, mixColor([4, 22, 40, 0.9], [28, 3, 10, 0.92], k));
    gp.addColorStop(1, mixColor([6, 30, 52, 0.9], [44, 4, 12, 0.92], k));
    g.fillStyle = gp; g.fill();
    // brass rim (even-odd ring)
    g.beginPath();
    rrPath(ox, oy, ow, oh, 30); rrPath(gx - 6, gy - 6, gw + 12, gh + 12, 16);
    const bg = g.createLinearGradient(0, oy, 0, oy + oh);
    bg.addColorStop(0, '#fff0b0'); bg.addColorStop(0.12, '#e8b54a'); bg.addColorStop(0.5, '#9a5f18'); bg.addColorStop(0.85, '#e0a540'); bg.addColorStop(1, '#5c3308');
    g.fillStyle = bg; g.fill('evenodd');
    g.lineWidth = 3; g.strokeStyle = '#3a1d04';
    rr(ox, oy, ow, oh, 30); g.stroke();
    rr(gx - 6, gy - 6, gw + 12, gh + 12, 16); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,240,190,0.55)';
    rr(ox + 5, oy + 5, ow - 10, oh - 10, 25); g.stroke();
    // rivets
    const rivet = (x, y) => {
      const rg = g.createRadialGradient(x - 2, y - 2, 0, x, y, 7);
      rg.addColorStop(0, '#fff6d0'); rg.addColorStop(0.5, '#c88a2c'); rg.addColorStop(1, '#3a1d04');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
    };
    for (let x = ox + 46; x < ox + ow - 30; x += 64) { rivet(x, oy + pad / 2 + 1); rivet(x, oy + oh - pad / 2 - 1); }
    for (let y = oy + 60; y < oy + oh - 40; y += 64) { rivet(ox + pad / 2 + 1, y); rivet(ox + ow - pad / 2 - 1, y); }
    // reel separators
    for (let r = 1; r < REELS; r++) {
      const x = gx + r * L.cell;
      const sg = g.createLinearGradient(0, gy, 0, gy + gh);
      sg.addColorStop(0, 'rgba(255,215,120,0)'); sg.addColorStop(0.5, 'rgba(255,215,120,0.35)'); sg.addColorStop(1, 'rgba(255,215,120,0)');
      g.fillStyle = sg; g.fillRect(x - 1, gy, 2, gh);
    }
    // travelling glint along the rim
    const per = 2 * (ow + oh), d = ((t * 260) % per);
    let px, py;
    if (d < ow) { px = ox + d; py = oy; } else if (d < ow + oh) { px = ox + ow; py = oy + d - ow; } else if (d < 2 * ow + oh) { px = ox + ow - (d - ow - oh); py = oy + oh; } else { px = ox; py = oy + oh - (d - 2 * ow - oh); }
    g.save(); g.globalCompositeOperation = 'lighter';
    glowAt(px, py, 46, '255,240,190', 0.75);
    g.drawImage(SPR.spark, px - 22, py - 22, 44, 44);
    g.restore();
  }
  function drawFrameTop() {
    const cimg = IMG.ui_corner;
    if (!cimg || !cimg.width) return;
    const pad = 22, ox = L.gx - pad, oy = L.gy - pad, ow = L.gw + pad * 2, oh = L.gh + pad * 2;
    const cw = 196, ch = cw * cimg.height / cimg.width, o = 24;
    for (const [x, y, fx, fy] of [[ox - o, oy - o, 1, 1], [ox + ow + o, oy - o, -1, 1], [ox - o, oy + oh + o, 1, -1], [ox + ow + o, oy + oh + o, -1, -1]]) {
      g.save(); g.translate(x, y); g.scale(fx, fy);
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 10; g.shadowOffsetY = 4 * fy;
      g.drawImage(cimg, 0, 0, cw, ch);
      g.restore();
    }
  }
  function rrPath(x, y, w, h, r) {
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  // ---------- symbols ----------
  function inWin(r, y) {
    const w = st.win;
    if (!w) return 0;
    const set = w.focus || w.cells;
    return set.has(r * 3 + y) ? 1 : (w.cells.has(r * 3 + y) ? 0 : -1);
  }
  let GLOK = false;
  const seedOf = (r, row) => r * 1.7 + (row < 0 ? 0 : row) * 2.3;
  function animState(sym, r, row, alphaMul) {
    const C = L.cell, t = clock, tier = SYM_TIER[sym];
    const s = {
      sym, sc: 1, sx: 1, sy: 1, rot: 0, pivot: 0, dx: 0, dy: 0, alpha: alphaMul == null ? 1 : alphaMul,
      glow: [0.12, 0.24, 0.42][tier] * (0.75 + 0.25 * Math.sin(ambientClock * 2.4 + r * 1.7 + row)), rays: tier === 2 ? 0.16 : 0,
      shine: -1, k: 0.32, t: ambientClock + seedOf(r, row), blink: 0, theta: 0, spark: tier === 1 ? 0.6 : sym <= S.A ? 0.45 : 0.3,
    };
    const fxc = row >= 0 && row < 3 ? cellFx[r][row] : null;
    const win = row >= 0 && row < 3 ? inWin(r, row) : 0;
    // idle motion of the art itself
    if (sym === S.GOLD || sym === S.SILVER) s.theta = 0.42 * Math.sin(s.t * 1.1);
    else if (sym === S.ANCHOR) { s.rot = 0.07 * Math.sin(s.t * 1.6); s.pivot = -0.45; }
    else if (sym <= S.A) s.dy = Math.sin(s.t * 1.8) * C * 0.012;
    if (sym === S.WILD) { const b = ((s.t + 10) % 3.6) / 0.24; if (b < 1) s.blink = Math.sin(b * Math.PI); }
    if (st.idleShine && st.idleShine.r === r && st.idleShine.y === row) s.shine = (ambientClock - st.idleShine.t0) / 0.9;
    // landing: squash and stretch, base stays planted
    if (fxc && fxc.pop >= 0) {
      const u = (t - fxc.pop) / 0.65;
      if (u < 1) {
        const amp = [0.1, 0.14, 0.22][tier];
        const e = Math.sin(u * Math.PI * 2.4) * (1 - u) * (1 - u);
        s.sy *= 1 - amp * e; s.sx *= 1 + amp * 0.75 * e;
        s.dy += C * SYM_SCALE[sym] * 0.5 * amp * e;
        if (tier === 2) s.sc *= 1 + 0.22 * Math.pow(1 - u, 3);
      }
    }
    const w = st.win;
    if (win === 1 && w) {
      const tw = t - w.t0, ramp = Math.min(1, tw / 0.3);
      s.k = lerp(0.32, 1, ramp); s.glow = 1; s.rays = tier === 2 ? 0.35 : 0.18; s.spark = 1;
      s.shine = (tw * 0.8) % 1.6;
      const beat = Math.abs(Math.sin(tw * 4.2)) * ramp;
      if (sym <= S.A) { s.sc *= 1 + 0.08 * beat; s.dy -= beat * C * 0.04; }
      else if (sym === S.SILVER || sym === S.GOLD) { s.theta += tw * 6.5 * ramp; s.sc *= 1 + 0.06 * ramp; }
      else if (sym === S.ANCHOR) { s.rot = lerp(s.rot, 0.24 * Math.sin(tw * 4), ramp); s.sc *= 1 + 0.05 * ramp; }
      else if (sym === S.WILD) { const s7 = Math.sin(tw * 7) * ramp; s.sy *= 1 + 0.06 * s7; s.sx *= 1 - 0.045 * s7; s.dy -= Math.abs(Math.sin(tw * 3.5)) * C * 0.05 * ramp; }
      else if (sym === S.SCATTER) s.sc *= 1 + 0.06 * Math.sin(tw * 5) * ramp;
    } else if (win === -1 && w) {
      const dim = Math.min(1, (t - (w.start || w.t0)) / 0.25);
      s.alpha *= lerp(1, 0.3, dim); s.glow *= 1 - dim; s.rays *= 1 - dim; s.k = lerp(0.32, 0.12, dim); s.spark *= 1 - dim;
    }
    return s;
  }
  function plainState(sym, alpha) {
    return { sym, sc: 1, sx: 1, sy: 1, rot: 0, pivot: 0, dx: 0, dy: 0, alpha, glow: 0, rays: 0, shine: -1, k: 0, t: ambientClock, blink: 0, theta: 0, spark: 0 };
  }
  function drawSymFx(s, cx, cy) {
    if (s.glow <= 0.005 && s.rays <= 0.005) return;
    const C = L.cell;
    g.save(); g.globalCompositeOperation = 'lighter';
    if (s.rays > 0.005) FX.sunburst(g, cx, cy, C * 0.82, 12, ambientClock * (s.sym === S.WILD ? -0.5 : 0.6), SYM_GLOW[s.sym], s.rays * s.alpha);
    if (s.glow > 0.005) glowAt(cx, cy, C * 0.6, SYM_GLOW[s.sym], 0.5 * s.glow * s.alpha);
    g.restore();
  }
  // affine (canvas order a,b,c,d,e,f) for: translate(center) · pivot rotate · scale
  function symMatrix(s, cx, cy, size) {
    const py = s.pivot * size, cs = Math.cos(s.rot), sn = Math.sin(s.rot);
    const sx = s.sx * s.sc, sy = s.sy * s.sc;
    return [cs * sx, sn * sx, -sn * sy, cs * sy, cx + s.dx + sn * py, cy + s.dy + py - cs * py];
  }
  function glPush(list, s, cx, cy, clip) {
    const sym = s.sym, size = L.cell * SYM_SCALE[sym], full = size * STYLE_K;
    const base = { sym, t: s.t, k: s.k, shine: s.shine >= 0 && s.shine <= 1 ? s.shine : -1, blink: s.blink, spark: s.spark, alpha: s.alpha, clip, w: full, h: full };
    if (sym === S.GOLD || sym === S.SILVER) {
      // a coin turning in 3D: darkened rim layers behind the face, keystone perspective, mirrored back face
      const cs = Math.cos(s.theta), sn = Math.sin(s.theta);
      const face = Math.abs(cs) < 0.05 ? (cs < 0 ? -0.05 : 0.05) : cs;
      const thick = size * 0.06, n = 7;
      for (let i = n; i >= 1; i--) {
        const rs = Object.assign({}, s, { sx: s.sx * face, dx: s.dx + sn * thick * i / n });
        list.push(Object.assign({}, base, { art: true, m: symMatrix(rs, cx, cy, size), bright: 0.36 + 0.12 * (1 - i / n), shine: -1, spark: 0, persp: 0.22 * sn }));
      }
      list.push(Object.assign({}, base, { m: symMatrix(Object.assign({}, s, { sx: s.sx * face }), cx, cy, size), bright: cs < 0 ? 0.82 : 1, persp: 0.22 * sn }));
      return;
    }
    list.push(Object.assign(base, { m: symMatrix(s, cx, cy, size) }));
  }
  function renderGL(list) {
    if (!list.length) return;
    const R = L.glRect, K = L.s * L.dpr;
    SymGL.begin(R.w * K, R.h * K);
    const clipR = { x: (L.gx - R.x) * K, y: (L.gy - R.y) * K, w: L.gw * K, h: L.gh * K };
    let clipped = null;
    for (const it of list) {
      const want = !!it.clip;
      if (want !== clipped) { SymGL.clip(want ? clipR : null); clipped = want; }
      const m = it.m;
      it.m = [m[0] * K, m[1] * K, m[2] * K, m[3] * K, (m[4] - R.x) * K, (m[5] - R.y) * K];
      SymGL.draw(it);
    }
    g.drawImage(SymGL.canvas, R.x, R.y, R.w, R.h);
  }
  // 2D fallback (no WebGL): same animation state, simpler deformation
  function drawSymbol(sym, cx, cy, r, row, blur, alphaMul) {
    const size = L.cell * SYM_SCALE[sym], full = size * STYLE_K;
    const bk = typeof blur === 'number' ? blur : blur ? 1 : 0;
    const alpha0 = alphaMul == null ? 1 : alphaMul;
    if (bk > 0.02) {
      const bh = full * SYM[sym].blur.height / SYM[sym].blur.width;
      if (bk < 0.98) { g.globalAlpha = alpha0 * (1 - bk); g.drawImage(SYM[sym].img, cx - full / 2, cy - full / 2, full, full); }
      g.globalAlpha = alpha0 * bk;
      g.drawImage(SYM[sym].blur, cx - full / 2, cy - bh / 2, full, bh);
      g.globalAlpha = 1;
      return;
    }
    const s = animState(sym, r, row, alphaMul);
    drawSymFx(s, cx, cy);
    let sx = s.sx;
    if (sym === S.GOLD || sym === S.SILVER) { const cs = Math.cos(s.theta); sx *= Math.abs(cs) < 0.05 ? (cs < 0 ? -0.05 : 0.05) : cs; }
    const m = symMatrix(Object.assign({}, s, { sx }), cx, cy, size);
    g.save();
    g.globalAlpha = s.alpha;
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    g.drawImage(SYM[sym].img, -full / 2, -full / 2, full, full);
    if (s.shine >= 0 && s.shine <= 1) shineOverlay(SYM[sym].mask, -full / 2, -full / 2, full, full, s.shine, 0.55);
    g.restore();
  }

  function drawReels() {
    const C = L.cell, t = clock;
    // anticipation columns
    for (let r = 0; r < REELS; r++) {
      const R = reels[r];
      if (!R.ant) continue;
      const x = L.gx + r * C;
      g.save(); g.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + 0.45 * Math.sin(t * 14);
      const cg = g.createLinearGradient(x, 0, x + C, 0);
      cg.addColorStop(0, 'rgba(120,230,255,0)'); cg.addColorStop(0.5, `rgba(120,230,255,${0.22 * pulse})`); cg.addColorStop(1, 'rgba(120,230,255,0)');
      g.fillStyle = cg; g.fillRect(x, L.gy - 10, C, L.gh + 20);
      g.lineWidth = 5; g.strokeStyle = `rgba(255,${200 + 55 * pulse | 0},120,${0.7 + 0.3 * pulse})`;
      g.shadowColor = '#ffd36b'; g.shadowBlur = 24;
      rr(x + 3, L.gy - 4, C - 6, L.gh + 8, 14); g.stroke();
      g.restore();
      if (Math.random() < 0.6) pWorld.add({ x: x + rnd(0, C), y: L.gy + L.gh, vy: -rnd(200, 420), max: rnd(0.6, 1.1), size: rnd(14, 28), img: SPR.sparkCyan, add: true });
    }
    if (GLOK) {
      const list = [];
      for (let r = 0; r < REELS; r++) {
        const R = reels[r];
        if (R.phase === 'idle') continue;
        const x = L.gx + r * C + C / 2;
        const bk = clamp((R.vi - 5) / 13, 0, 1);
        const k0 = Math.floor(-R.pos) - 1;
        for (let k = k0; k <= k0 + 4; k++) {
          const y = L.gy + (k + R.pos) * C + C / 2;
          if (y < L.gy - C || y > L.gy + L.gh + C) continue;
          const row = R.phase === 'settle' ? k + R.P : -1;
          const sym = symAt(R, k, r);
          if (row >= 0 && row < 3) {
            if (st.fs && st.fs.show[r][row] > 0) continue;
            const s = animState(sym, r, row);
            drawSymFx(s, x, y);
            glPush(list, s, x, y, false);
            continue;
          }
          if (bk > 0.02) {
            const full = C * SYM_SCALE[sym] * STYLE_K;
            list.push({ sym, blur: true, m: [1, 0, 0, 1, x, y], w: full, h: full * SYM[sym].blur.height / SYM[sym].blur.width, alpha: bk, clip: true });
          }
          if (bk < 0.98) glPush(list, plainState(sym, 1 - bk), x, y, true);
        }
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let r = 0; r < REELS; r++) {
          const R = reels[r];
          if (R.phase !== 'idle') continue;
          for (let y = 0; y < ROWS; y++) {
            if (st.fs && st.fs.show[r][y] > 0) continue;
            const w = inWin(r, y) === 1;
            if ((pass === 1) !== w) continue;
            const c = cellCenter(r, y);
            const s = animState(R.strip[y], r, y);
            drawSymFx(s, c.x, c.y);
            glPush(list, s, c.x, c.y, false);
          }
        }
      }
      renderGL(list);
    } else {
    // moving reels (clipped)
    g.save();
    g.beginPath(); g.rect(L.gx - 8, L.gy, L.gw + 16, L.gh); g.clip();
    for (let r = 0; r < REELS; r++) {
      const R = reels[r];
      if (R.phase === 'idle') continue;
      const x = L.gx + r * C + C / 2;
      const bk = clamp((R.vi - 5) / 13, 0, 1);
      const k0 = Math.floor(-R.pos) - 1;
      for (let k = k0; k <= k0 + 4; k++) {
        const y = L.gy + (k + R.pos) * C + C / 2;
        if (y < L.gy - C || y > L.gy + L.gh + C) continue;
        const row = R.phase === 'settle' ? k + R.P : -1;
        if (row >= 0 && row < 3 && st.fs && st.fs.show[r][row] > 0) continue;
        drawSymbol(symAt(R, k, r), x, y, r, row >= 0 && row < 3 ? row : -1, bk);
      }
    }
    g.restore();
    // idle reels: non-winning first, winners on top
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < REELS; r++) {
        const R = reels[r];
        if (R.phase !== 'idle') continue;
        for (let y = 0; y < ROWS; y++) {
          if (st.fs && st.fs.show[r][y] > 0) continue;
          const w = inWin(r, y) === 1;
          if ((pass === 1) !== w) continue;
          const c = cellCenter(r, y);
          drawSymbol(R.strip[y], c.x, c.y, r, y, false);
        }
      }
    }
    }
    // drum shading top and bottom, a glass sheen, and a light flash on each reel as it stops
    g.save();
    let sg = g.createLinearGradient(0, L.gy, 0, L.gy + C * 0.42);
    sg.addColorStop(0, 'rgba(2,8,20,0.6)'); sg.addColorStop(1, 'rgba(2,8,20,0)');
    g.fillStyle = sg; g.fillRect(L.gx - 4, L.gy, L.gw + 8, C * 0.42);
    sg = g.createLinearGradient(0, L.gy + L.gh, 0, L.gy + L.gh - C * 0.42);
    sg.addColorStop(0, 'rgba(2,8,20,0.6)'); sg.addColorStop(1, 'rgba(2,8,20,0)');
    g.fillStyle = sg; g.fillRect(L.gx - 4, L.gy + L.gh - C * 0.42, L.gw + 8, C * 0.42);
    g.globalCompositeOperation = 'lighter';
    sg = g.createLinearGradient(L.gx, L.gy, L.gx + L.gw * 0.6, L.gy + L.gh);
    sg.addColorStop(0, 'rgba(200,240,255,0.07)'); sg.addColorStop(0.35, 'rgba(200,240,255,0.02)'); sg.addColorStop(0.36, 'rgba(200,240,255,0)');
    g.fillStyle = sg; g.fillRect(L.gx, L.gy, L.gw, L.gh);
    for (let r = 0; r < REELS; r++) {
      const a = 1 - (t - reels[r].flash) / 0.35;
      if (a <= 0) continue;
      const x = L.gx + r * C;
      const fg = g.createLinearGradient(0, L.gy + L.gh, 0, L.gy);
      fg.addColorStop(0, 'rgba(150,230,255,' + (0.32 * a) + ')'); fg.addColorStop(1, 'rgba(150,230,255,0)');
      g.fillStyle = fg; g.fillRect(x + 2, L.gy, C - 4, L.gh);
    }
    g.restore();
  }

  function drawSticky() {
    if (!st.fs) return;
    const C = L.cell, t = clock;
    const cells = [];
    for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) if (st.fs.show[r][y]) cells.push([r, y, st.fs.show[r][y]]);
    if (!cells.length) return;
    for (const [r, y] of cells) {
      const x = L.gx + r * C, yy = L.gy + y * C, c = cellCenter(r, y);
      g.save();
      rr(x + 5, yy + 5, C - 10, C - 10, 18);
      const bgr = g.createRadialGradient(c.x, c.y - C * 0.1, C * 0.1, c.x, c.y, C * 0.7);
      bgr.addColorStop(0, '#5a1a7a'); bgr.addColorStop(1, '#1a0526');
      g.fillStyle = bgr; g.fill();
      g.lineWidth = 4; g.strokeStyle = `rgba(255,${120 + 60 * Math.sin(t * 4 + r + y) | 0},240,0.95)`;
      g.shadowColor = 'rgba(255,90,230,0.9)'; g.shadowBlur = 18; g.stroke();
      g.restore();
    }
    if (GLOK) {
      const list = [];
      for (const [r, y] of cells) {
        const c = cellCenter(r, y);
        const s = animState(S.WILD, r, y);
        s.dy -= C * 0.04;
        drawSymFx(s, c.x, c.y);
        glPush(list, s, c.x, c.y, false);
      }
      renderGL(list);
    } else {
      for (const [r, y] of cells) { const c = cellCenter(r, y); drawSymbol(S.WILD, c.x, c.y - C * 0.04, r, y, false); }
    }
    for (const [r, y, m] of cells) {
      const c = cellCenter(r, y);
      const bx = c.x + C * 0.3, by = c.y + C * 0.3, br = C * 0.17 * (1 + 0.06 * Math.sin(t * 5 + r));
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8;
      const bgg = g.createRadialGradient(bx - br * 0.3, by - br * 0.4, 1, bx, by, br);
      bgg.addColorStop(0, '#fff7c2'); bgg.addColorStop(0.5, '#f5b335'); bgg.addColorStop(1, '#8a4a0a');
      g.fillStyle = bgg; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
      g.restore();
      g.lineWidth = 3; g.strokeStyle = '#3a1500'; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.stroke();
      text('x' + m, bx, by + 1, C * 0.17, { color: '#fff', strokeColor: '#5a1a00', sw: 0.24 });
    }
  }

  function drawWinFrames() {
    const w = st.win;
    if (!w) return;
    const C = L.cell, t = clock - w.t0;
    const set = w.focus || w.cells;
    g.save();
    for (const key of set) {
      const r = (key / 3) | 0, y = key % 3;
      const x = L.gx + r * C, yy = L.gy + y * C;
      g.lineWidth = 5;
      const fg = g.createLinearGradient(x, yy, x + C, yy + C);
      fg.addColorStop(0, '#fff6c0'); fg.addColorStop(0.5, '#ffc93c'); fg.addColorStop(1, '#ff8a1c');
      g.strokeStyle = fg;
      g.shadowColor = 'rgba(255,200,80,0.9)'; g.shadowBlur = 16;
      g.setLineDash([22, 12]); g.lineDashOffset = -t * 70;
      rr(x + 6, yy + 6, C - 12, C - 12, 18); g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }

  // ---------- squad attack ----------
  function updateSquads(dt) {
    for (let i = st.squads.length - 1; i >= 0; i--) {
      const q = st.squads[i];
      const t = clock - q.t0;
      if (t < 0) continue;
      let x, y;
      if (t < q.dur) {
        const u = Ease.inOutCubic(t / q.dur), a = 1 - u;
        x = a * a * q.from.x + 2 * a * u * q.ctrl.x + u * u * q.to.x;
        y = a * a * q.from.y + 2 * a * u * q.ctrl.y + u * u * q.to.y;
      } else {
        if (!q.hit) { q.hit = true; q.onHit(); }
        const u = Ease.inCubic(clamp((t - q.dur - 0.12) / 0.55, 0, 1));
        if (t - q.dur > 0.67) { st.squads.splice(i, 1); continue; }
        x = lerp(q.to.x, q.exit.x, u); y = lerp(q.to.y, q.exit.y, u);
      }
      if (q.x != null) {
        const vx = x - q.x, vy = y - q.y;
        if (vx * vx + vy * vy > 0.5) {
          let d = Math.atan2(vy, vx) - q.ang;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          q.ang += d * Math.min(1, dt * 10);
        }
        if (Math.random() < 0.5) pWorld.add({ x: q.x, y: q.y, vy: -40, wob: 30, max: 0.8, size: rnd(8, 16), img: SPR.bubble });
      }
      q.x = x; q.y = y;
    }
  }
  function sliceX(img, w, h, n, amp, k, ph, fn) {
    const sw = img.width / n, dw = w / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const off = amp * fn(u) * Math.sin(ph + u * k);
      const sx = i * sw, sww = Math.min(sw + 1, img.width - sx);
      g.drawImage(img, sx, 0, sww, img.height, -w / 2 + i * dw, -h / 2 + off, dw * sww / sw + 0.5, h);
    }
  }
  function drawSquads() {
    for (const q of st.squads) {
      if (q.x == null || !SQUAD.length) continue;
      const v = SQUAD[q.v % SQUAD.length];
      const w = L.cell * 1.75, h = w * v.body.height / v.body.width;
      const ph = clock * 10 + q.ph;
      g.save();
      g.translate(q.x, q.y); g.rotate(q.ang);
      if (Math.cos(q.ang) < 0) g.scale(1, -1);
      sliceX(v.tent, w, h, 18, h * 0.13, 4.2, ph, u => Math.pow(Math.max(0, 0.82 - u) / 0.82, 1.3));
      const pulse = 1 + 0.045 * Math.sin(ph * 0.45);
      g.scale(pulse, 1 / pulse);
      g.drawImage(v.body, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }
  async function squadAttack(cells) {
    st.banner = { text: 'SQUAD ATTACK!', t0: clock, grad: PINK, dur: turbo() ? 0.9 : 1.35 };
    SFX.play('squadAlarm');
    st.shake = 12;
    await wait(turbo() ? 0.7 : 1.15);
    const C = L.cell;
    let lastHit = 0;
    cells.forEach(([r, y], i) => {
      const to = cellCenter(r, y);
      const fromLeft = i % 2 === 0;
      const from = { x: fromLeft ? -C * 1.5 : L.DW + C * 1.5, y: to.y + rnd(-C, C) };
      const delay = i * (turbo() ? 0.18 : 0.32);
      lastHit = Math.max(lastHit, delay + 0.62);
      st.squads.push({
        t0: clock + delay, dur: 0.62, from, to, ctrl: { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - C * 1.4 },
        exit: { x: fromLeft ? L.DW + C * 2 : -C * 2, y: to.y - C * 3 }, size: C * 0.6, ang: fromLeft ? 0 : Math.PI, v: i,
        col: SQUAD_COLORS[i % SQUAD_COLORS.length], bandana: i % 3 === 0, ph: rnd(0, 9), hit: false,
        onHit() {
          reels[r].strip[y] = S.WILD;
          cellFx[r][y].pop = clock;
          SFX.play('ink'); SFX.play('wildLand');
          burst(to.x, to.y, 'wild');
          for (let k = 0; k < 10; k++) pWorld.add({ x: to.x, y: to.y, vx: rnd(-300, 300), vy: rnd(-300, 300), drag: 0.9, max: rnd(0.6, 1.2), size: rnd(30, 60), img: SPR.ink, rot: rnd(0, TAU), alpha: 0.85 });
          st.shake = Math.max(st.shake, 7);
        },
      });
      wait(delay).then(() => SFX.play('whoosh'));
    });
    await wait(lastHit + 0.5);
    st.banner = null;
  }

  // ---------- win presentation ----------
  function clearWin() { st.win = null; st.plaque = null; st.scatCeleb = -1; st.triggerCells = []; }
  function setMsg(textStr, grad) { if (st.msg.text !== textStr) st.msg = { text: textStr, t0: clock, grad: grad || GOLD }; }

  async function presentWin(ev, b, opts) {
    opts = opts || {};
    if (ev.total <= 0) return 0;
    const award = opts.fs ? null : displayAward(playback.baseUnits);
    const amount = opts.fs ? opts.amount : award.amount / 1000000;
    const cells = new Set();
    const list = [];
    for (const w of ev.wins) { for (const [r, y] of w.cells) cells.add(r * 3 + y); list.push(w); }
    if (ev.scatterPay > 0) {
      const sc = new Set(ev.scatterCells.map(([r, y]) => r * 3 + y));
      sc.forEach(k => cells.add(k));
      list.push({ sym: S.SCATTER, len: ev.scatterCount, ways: 1, mult: 1, amount: ev.scatterPay, cellSet: sc });
    }
    st.win = { cells, list, t0: clock, start: clock, idx: -1, nextT: clock + (turbo() ? 1.1 : 2.0), focus: null, b };
    for (const key of cells) {
      const c = cellCenter((key / 3) | 0, key % 3);
      burst(c.x, c.y, 'win');
      if (ev.total >= 2) burst(c.x, c.y, 'coins');
    }
    const x = ev.total;
    if (x >= M.BIG_WIN) {
      st.plaque = null;
      await bigWin(amount, x);
    } else {
      SFX.play(x >= 2 ? 'winMed' : 'winSmall');
      const dur = turbo() ? Math.min(0.2, 0.1 + x * 0.015) : Math.min(0.65, 0.2 + x * 0.04);
      st.plaque = { value: 0, target: amount, t0: clock, dur, alpha: 1 };
      if (dur > 0.55) SFX.countStart(65);
      await waitSkip(dur);
      SFX.countStop();
      st.plaque.value = amount; st.plaque.dur = 0;
      setMsg('WIN ' + fmt(amount));
    }
    if (!opts.fs) { st.lastWin = st.shownMicro / 1000000; ui(); }
    if (x < M.BIG_WIN) {
      await waitSkip(RESULT_HOLD, RESULT_HOLD);
      if (st.plaque && st.plaque.dismiss) st.plaque = null;
    }
    return amount;
  }
  function updateWinCycle() {
    if (waits.some(item => item.minUntil > performance.now())) return;
    const w = st.win;
    if (!w || st.bw || clock < w.nextT || w.list.length < 2 || st.busy && !st.fs) {
      if (w && w.list.length === 1 && clock >= w.nextT && w.idx < 0 && !st.bw) { w.idx = 0; w.cycleStart = clock; describeWin(w.list[0], w.b); }
      return;
    }
    w.idx = (w.idx + 1) % w.list.length;
    if (w.cycleStart == null) w.cycleStart = clock;
    w.nextT = clock + (turbo() ? 0.9 : 1.5);
    const item = w.list[w.idx];
    w.focus = item.cellSet || new Set(item.cells.map(([r, y]) => r * 3 + y));
    w.t0 = clock;
    describeWin(item, w.b);
  }
  function describeWin(item, b) {
    if (item.sym === S.SCATTER) setMsg(`${item.len} PEARLS PAY ${fmt(item.amount * b)}`, CYAN);
    else setMsg(`${WIN_NAMES[item.sym]} x${item.len} · ${item.ways} WAY${item.ways > 1 ? 'S' : ''}${item.mult > 1 ? ' · WILD MULTIPLIERS' : ''} · ${fmt(item.amount * b)}`, item.mult > 1 ? PINK : GOLD);
  }

  // ---------- big win ----------
  async function bigWin(amount, x) {
    const b = amount / x;
    const th = [M.BIG_WIN * b, M.MEGA_WIN * b, M.EPIC_WIN * b];
    const maxTier = x >= M.EPIC_WIN ? 2 : x >= M.MEGA_WIN ? 1 : 0;
    const dur = turbo() ? 0.35 : [1.2, 1.6, 2][maxTier];
    SFX.duck(true);
    SFX.play('bigWin', 0);
    st.bw = { amount, shown: 0, t0: clock, dur, tier: 0, tierT: clock, maxTier, skip: false, done: false, alpha: 0, th };
    st.shake = 14; st.flash = 0.8;
    SFX.countStart(55);
    await new Promise(res => {
      const step = () => {
        const bw = st.bw;
        const u = bw.skip ? 1 : clamp((clock - bw.t0) / bw.dur, 0, 1);
        bw.shown = amount * (1 - Math.pow(1 - u, 1.35));
        if (u >= 1) bw.shown = amount;
        const tier = bw.shown >= th[2] ? 2 : bw.shown >= th[1] ? 1 : 0;
        if (tier > bw.tier) {
          bw.tier = tier; bw.tierT = clock; st.shake = 18; st.flash = 1;
          SFX.play('tierUp'); SFX.play('bigWin', tier);
        }
        if (u >= 1) { res(); return; }
        requestAnimationFrame(step);
      };
      step();
    });
    SFX.countStop();
    st.bw.done = true; st.bw.doneT = clock;
    SFX.play('winMed');
    await waitSkip(turbo() ? RESULT_HOLD : 0.3, RESULT_HOLD);
    await tween(0.12, u => { if (st.bw) st.bw.out = u; }, true);
    st.bw = null;
    SFX.duck(false);
    setMsg('WIN ' + fmt(amount));
  }
  function drawBigWin() {
    const bw = st.bw;
    if (!bw) return;
    const t = clock - bw.t0, out = bw.out || 0;
    const fade = Math.min(1, t / 0.3) * (1 - out);
    setScreen();
    g.fillStyle = `rgba(2,6,16,${0.72 * fade})`; g.fillRect(0, 0, L.W, L.H);
    setWorld();
    const cx = L.center.x, cy = L.center.y - (L.portrait ? 60 : 30);
    const tierCols = ['255,210,90', '255,110,230', '255,90,50'];
    g.save(); g.globalAlpha = fade;
    FX.sunburst(g, cx, cy, 760, 18, ambientClock * 0.25, tierCols[bw.tier], 0.32);
    FX.sunburst(g, cx, cy, 560, 12, -ambientClock * 0.4, '255,255,255', 0.12);
    g.globalCompositeOperation = 'lighter';
    glowAt(cx, cy, 420, tierCols[bw.tier], 0.5);
    g.restore();
    setScreen(); pTop.draw(g); setWorld();
    const img = [IMG.big, IMG.mega, IMG.epic][bw.tier];
    const pu = clamp((clock - bw.tierT) / 0.7, 0, 1);
    const sc = (0.2 + 0.8 * Ease.outElastic(pu)) * (1 + 0.03 * Math.sin(ambientClock * 4)) * (1 - out * 0.3);
    const w = (L.portrait ? 760 : 720) * sc, h = w * img.height / img.width;
    g.save(); g.globalAlpha = fade;
    drawShiny(img, cx - w / 2, cy - h / 2 - 40, w, h, (ambientClock * 0.5) % 1.4);
    const n = fmt(bw.shown, bw.shown < bw.amount ? 2 : undefined);
    const ts = (L.portrait ? 110 : 104) * (bw.done ? 1 + 0.06 * Math.sin((clock - bw.doneT) * 8) * Math.exp(-(clock - bw.doneT) * 2) : 1);
    text(n, cx, cy + h / 2 + 30, ts, { grad: GOLD, sw: 0.16, strokeColor: '#2a0e00', glow: 'rgba(255,190,60,0.8)' });
    if (!bw.done) text('TAP TO SKIP', cx, cy + h / 2 + 120, 26, { color: 'rgba(255,255,255,0.6)', sw: 0.15 });
    g.restore();
    // coin fountain (screen space particles)
    const rate = [24, 44, 70][bw.tier] * (bw.done ? 0.35 : 1) * (1 - out);
    if (Math.random() < rate / 60) spawnFountainCoin();
    if (Math.random() < rate / 60) spawnFountainCoin();
  }
  function spawnFountainCoin() {
    const hs = L.H / 900;
    const silver = Math.random() < 0.25;
    pTop.add({
      x: L.W / 2 + rnd(-0.32, 0.32) * L.W, y: L.H + 30, vx: rnd(-380, 380) * hs, vy: -rnd(900, 1500) * hs, ay: 1500 * hs,
      max: 2.6, size: rnd(34, 68) * hs, img: silver ? SYM[S.SILVER].img : SYM[S.GOLD].img, flip: rnd(6, 14), vr: rnd(-1, 1), fadeOut: 0.1, fadeIn: 0,
      kill: p => p.y > L.H + 80 && p.vy > 0,
    });
  }

  // ---------- scenes and bonuses ----------
  const SCENES = {
    base: { bg: 'bg', mix: 0, life: { creatures: true, kelp: true, rays: true }, dim: '2,8,20', ray: '120,220,255' },
    kraken: { bg: 'bg_kraken', mix: 1, life: { creatures: true, kelp: true, rays: true }, dim: '20,2,6', ray: '255,90,60' },
    reef: { bg: 'bg_reef', mix: 0, life: { creatures: true, kelp: false, rays: true }, dim: '2,8,30', ray: '120,230,255' },
    vault: { bg: 'bg_vault', mix: 0, life: { creatures: false, kelp: false, rays: false }, dim: '16,8,2', ray: '255,200,100' },
    wheel: { bg: 'bg_helm', mix: 0, life: { creatures: true, kelp: false, rays: true }, dim: '2,14,16', ray: '120,255,210' },
  };
  async function inkTransition(mid, skippable = false) {
    const wipe = new FX.InkWipe();
    wipe.seed(L.W, L.H);
    st.ink = { wipe, k: 0 };
    SFX.play('transition'); SFX.play('ink');
    await tween(0.75, u => { st.ink.k = Ease.inOutCubic(u); }, skippable);
    mid();
    await wait(0.3, skippable);
    wipe.seed(L.W, L.H);
    await tween(0.85, u => { st.ink.k = 1 - Ease.inOutCubic(u); }, skippable);
    st.ink = null;
  }
  function waitPanelClick(timeout, minimum = 0) {
    return new Promise(res => {
      const p = st.panel;
      const item = { t: clock + timeout, minUntil: performance.now() + minimum * 1000, res: () => { p.resolve = null; res(); }, skippable: false };
      p.resolve = () => {
        item.t = clock;
        if (performance.now() < item.minUntil) return;
        const index = waits.indexOf(item);
        if (index >= 0) { waits.splice(index, 1); item.res(); }
      };
      waits.push(item);
    });
  }
  async function enterScene(name, music, mid) {
    await inkTransition(() => {
      st.scene = name; st.mode = 'fs';
      st.bonusMix = st.bonusTarget = SCENES[name].mix;
      SeaLife.setScene(SCENES[name].life);
      clearWin(); st.scatCeleb = -1;
      if (mid) mid();
      if (music) SFX.startMusic(music);
      ui();
    });
  }
  async function exitScene(mid, skippable = false) {
    await inkTransition(() => {
      if (mid) mid();
      st.scene = 'base'; st.mode = 'base'; st.fs = null; st.awaken = null;
      st.bonusMix = st.bonusTarget = 0;
      SeaLife.setScene(SCENES.base.life);
      SFX.startMusic('base');
      ui();
    }, skippable);
  }
  async function introPanel(titleKey, lines) {
    st.panel = { kind: 'intro', t0: clock, title: titleKey, lines };
    SFX.play('fsStart');
    await waitPanelClick(st.auto > 0 ? 2.6 : 14);
    await tween(0.3, u => { if (st.panel) st.panel.out = u; });
    st.panel = null;
  }
  async function finishBonus(units, titleKey, sub) {
    const b = st.round.amount / 1000000;
    const award = displayAward(playback.bonusUnits);
    const amount = award.amount / 1000000;
    if (award.capped) sub = 'MAX WIN REACHED!';
    clearWin();
    st.panel = { kind: 'outro', t0: clock, title: titleKey, total: amount, shown: 0, sub };
    SFX.duck(true);
    SFX.play('bigWin', amount / b >= M.MEGA_WIN ? 2 : 1);
    if (amount > 0) SFX.countStart(55);
    await tween(turbo() ? 0.25 : 0.7, u => { if (st.panel) st.panel.shown = amount * Ease.outCubic(u); }, true);
    SFX.countStop();
    if (st.panel) st.panel.shown = amount;
    await waitPanelClick(st.auto > 0 ? 0.3 : 10, RESULT_HOLD);
    SFX.duck(false);
    st.lastWin = st.shownMicro / 1000000;
    await exitScene(() => { st.panel = null; setMsg('BONUS WIN ' + fmt(amount)); }, true);
    return amount;
  }

  async function runBonus(triggerCount, b, preWinX, triggerCells) {
    releaseSpace();
    st.inBonus = true; ui();
    try { return await runBonusInner(triggerCount, b, preWinX, triggerCells); } finally { releaseSpace(); st.inBonus = false; ui(); }
  }
  async function runBonusInner(triggerCount, b, preWinX, triggerCells) {
    const level = Math.min(5, triggerCount);
    SFX.play('bonusTrigger');
    st.scatCeleb = clock;
    st.triggerCells = triggerCells;
    st.shake = 16; st.flash = 0.7;
    setMsg(`${triggerCount} SQUIDS! ${BUY_NAMES[st.round.kind].toUpperCase()}`, PINK);
    await wait(turbo() ? 1.2 : 2.0);
    clearWin(); setMsg('', CYAN);
    let kind = st.round.kind;
    let sup = false;
    if (kind === 'wheel') {
      const w = await BON.runWheel(level, b, preWinX);
      if (w.cash != null) return w.cash;
      kind = w.kind; sup = w.sup;
    }
    const positions = triggerCells.slice(0, level).map(([r, y]) => y * REELS + r);
    if (kind === 'kraken') return krakenBonus(level, sup, b, preWinX);
    if (kind === 'reef') return BON.runReef(level, sup, b, preWinX, sup ? [] : positions);
    return BON.runVault(level, sup, b, preWinX);
  }

  // Kraken's Wrath: sticky multiplier wilds, and every RAGE_MAX wilds the Kraken awakens
  async function krakenBonus(pearls, sup, b, preWinX) {
    const ks = M.krakenStart(pearls, sup);
    await checkpoint();
    await enterScene('kraken', 'bonus', () => {
      st.fs = { left: ks.left, total: 0, totalUnits: 0, played: 0, awarded: ks.left, show: M.emptySticky(), retrigT: -9, rage: 0, rageT: -9 };
    });
    await introPanel('t_kraken', [
      { t: `${ks.left} FREE SPINS`, size: 84, grad: GOLD },
      { t: sup ? 'SUPER: A x2 STICKY WILD IS ALREADY WAITING' : 'EVERY SQUID WILD BECOMES STICKY', size: 30, grad: CYAN },
      { t: 'WITH A x2, x3 OR x5 MULTIPLIER', size: 30, grad: PINK },
      { t: `EVERY ${M.TUNE.rageMax} WILDS THE KRAKEN AWAKENS: ALL WILDS +1 AND +${M.TUNE.rageSpins} SPINS`, size: 22, color: '#ffd9e4' },
    ]);
    const fs = st.fs;
    if (ks.preset) await lockWilds([ks.preset], true);
    let capped = false;
    while (ks.left > 0 && fs.played < M.FS_MAX_SPINS) {
      const beforeUnits = st.shownUnits + fs.totalUnits;
      const r = M.krakenStep(ks);
      if (!r) break;
      fs.played = ks.played; fs.left = ks.left;
      ui();
      clearWin();
      setMsg(`FREE SPIN ${fs.played} OF ${fs.played + ks.left}`, PINK);
      SFX.play('spin');
      await spinTo(r.landed);
      if (r.newWilds.length) await lockWilds(r.newWilds);
      if (r.awaken) await awaken(r.awaken, r.extraAdded, ks);
      if (r.ev.total > 0) {
        capped = r.capped;
        const ev = Object.assign({}, r.ev, { totalUnits: r.paidUnits, total: r.paidUnits / M.UNIT_SCALE });
        const amount = (Contract.payoutAmount(st.round.amount, beforeUnits + r.paidUnits) - Contract.payoutAmount(st.round.amount, beforeUnits)) / 1000000;
        await presentWin(ev, b, { fs: true, amount });
        fs.totalUnits = ks.totalUnits;
        fs.total = (Contract.payoutAmount(st.round.amount, st.shownUnits + fs.totalUnits) - st.shownMicro) / 1000000;
        ui();
      }
      await checkpoint();
      if (capped) { setMsg('MAX WIN REACHED!', RED); await wait(1.5); break; }
      if (r.retriggerAdded) {
        const add = r.retriggerAdded;
        if (add > 0) {
          fs.left = ks.left; fs.retrigT = clock;
          st.banner = { text: `+${add} FREE SPINS`, t0: clock, grad: CYAN, dur: 2 };
          SFX.play('retrigger'); st.shake = 10;
          ui();
          await wait(1.6);
          st.banner = null;
        }
      }
      await wait(turbo() ? 0.25 : 0.55);
    }
    clearWin();
    return finishBonus(fs.totalUnits, 't_kraken', `IN ${fs.played} FREE SPINS`);
  }
  async function awaken(times, extra, ks) {
    st.awaken = { t0: clock };
    SFX.play('awaken'); st.shake = 24; st.flash = 0.6;
    st.banner = { text: 'THE KRAKEN AWAKENS!', t0: clock, grad: RED, dur: 2.2 };
    await wait(1.5);
    st.banner = null;
    for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) {
      if (!st.fs.show[r][y]) continue;
      st.fs.show[r][y] = ks.sticky[r][y];
      cellFx[r][y].pop = clock;
      const c = cellCenter(r, y);
      burst(c.x, c.y, 'sticky');
      pWorld.add({ type: 'text', text: '+' + times, x: c.x, y: c.y - L.cell * 0.25, vy: -80, max: 1.1, size: 58, color: '#ff8a5a', fadeIn: 0.05 });
      SFX.play('multUp');
      await wait(turbo() ? 0.06 : 0.14);
    }
    st.fs.rage = ks.rage; st.fs.rageT = clock;
    const add = extra;
    if (add > 0) {
      st.fs.left = ks.left; st.fs.retrigT = clock;
      st.banner = { text: `+${add} SPINS`, t0: clock, grad: CYAN, dur: 1.4 };
      SFX.play('retrigger');
      ui();
      await wait(1.3);
      st.banner = null;
    }
    await wait(0.4);
  }
  async function lockWilds(list, preset) {
    for (const [r, y, m] of list) {
      st.fs.show[r][y] = m;
      cellFx[r][y].pop = clock;
      const c = cellCenter(r, y);
      burst(c.x, c.y, 'sticky');
      pWorld.add({ type: 'text', text: 'x' + m, x: c.x, y: c.y - L.cell * 0.2, vy: -70, max: 1.1, size: 54, color: '#ffe27a', fadeIn: 0.05 });
      SFX.play('sticky'); SFX.play('mult');
      st.shake = Math.max(st.shake, 6);
      if (!preset && st.fs.rage < M.TUNE.rageMax) { st.fs.rage++; st.fs.rageT = clock; SFX.play('rage'); }
      await wait(turbo() ? 0.15 : 0.32);
    }
    await wait(turbo() ? 0.1 : 0.25);
  }

  function drawPanel() {
    const p = st.panel;
    if (!p) return;
    const t = clock - p.t0, out = p.out || 0;
    const fade = Math.min(1, t / 0.35) * (1 - out);
    const sc = SCENES[st.scene] || SCENES.base;
    setScreen();
    g.fillStyle = `rgba(${sc.dim},${0.74 * fade})`; g.fillRect(0, 0, L.W, L.H);
    setWorld();
    const cx = L.center.x, cy = L.center.y - 20;
    g.save(); g.globalAlpha = fade;
    FX.sunburst(g, cx, cy - 120, 700, 16, ambientClock * 0.2, sc.ray, 0.25);
    const img = IMG[p.title] || IMG.fs, pu = clamp(t / 0.8, 0, 1);
    const w = (L.portrait ? 720 : 620) * (0.3 + 0.7 * Ease.outElastic(pu)), h = w * img.height / img.width;
    drawShiny(img, cx - w / 2, cy - 150 - h / 2, w, h, (ambientClock * 0.45) % 1.4);
    g.restore();
    setScreen(); pTop.draw(g); setWorld();
    g.save(); g.globalAlpha = fade;
    const blink = 0.55 + 0.45 * Math.sin(ambientClock * 5);
    if (p.kind === 'intro') {
      let y = cy + 40;
      (p.lines || []).forEach((ln, i) => {
        const u = clamp((t - 0.3 - i * 0.12) / 0.4, 0, 1);
        g.save(); g.globalAlpha = fade * u;
        text(ln.t, cx, y + (1 - u) * 20, ln.size, ln.grad ? { grad: ln.grad, sw: 0.17, strokeColor: '#1a0612' } : { color: ln.color || '#fff', sw: 0.2 });
        g.restore();
        y += ln.size * 1.15 + 8;
      });
      g.globalAlpha = fade * blink;
      text('TAP TO START', cx, Math.max(y + 34, cy + 290), 36, { color: '#fff', sw: 0.18 });
    } else {
      text('BONUS COMPLETE', cx, cy + 20, 46, { grad: CYAN, sw: 0.18 });
      text(fmt(p.shown, p.shown < p.total ? 2 : undefined), cx, cy + 110, 110, { grad: GOLD, sw: 0.15, strokeColor: '#2a0600', glow: 'rgba(255,190,60,0.8)' });
      if (p.sub) text(p.sub, cx, cy + 190, 32, { color: '#ffe9d9', sw: 0.18 });
      g.globalAlpha = fade * blink;
      text('TAP TO CONTINUE', cx, cy + 270, 34, { color: '#fff', sw: 0.18 });
      if (p.shown < p.total && Math.random() < 0.5) spawnFountainCoin();
    }
    g.restore();
  }

  // ---------- HUD ----------
  function hudPanel(x, y, w, h, label, value, grad, pulse) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 20;
    rr(x - w / 2, y - h / 2, w, h, 22);
    const pg = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    pg.addColorStop(0, mixColor([16, 56, 88, 0.92], [96, 14, 34, 0.92], st.bonusMix)); pg.addColorStop(1, mixColor([4, 18, 34, 0.94], [32, 4, 12, 0.94], st.bonusMix));
    g.fillStyle = pg; g.fill();
    g.restore();
    g.lineWidth = 4; g.strokeStyle = '#e7b453'; rr(x - w / 2, y - h / 2, w, h, 22); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,240,190,0.4)'; rr(x - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12, 17); g.stroke();
    text(label, x, y - h * 0.24, 22, { color: '#ffd9a8', sw: 0.2 });
    text(value, x, y + h * 0.14, 46 * (pulse || 1), { grad: grad || GOLD, sw: 0.18 });
  }
  function drawHud() {
    if (st.fs) {
      const fs = st.fs;
      const pulse = 1 + 0.25 * Math.max(0, 1 - (clock - fs.retrigT) / 0.6);
      const w = L.portrait ? 380 : 270;
      hudPanel(L.hudL.x, L.hudL.y, w, 130, 'FREE SPINS LEFT', String(fs.left), PINK, pulse);
      hudPanel(L.hudR.x, L.hudR.y, w, 130, 'BONUS WIN', fmt(fs.total), GOLD);
      // count of sticky wilds
      let n = 0, sum = 0;
      for (const c of fs.show) for (const m of c) if (m) { n++; sum += m; }
      if (n && !L.portrait) text(`${n} STICKY WILD${n > 1 ? 'S' : ''} · x${sum} TOTAL`, L.hudR.x, L.hudR.y + 100, 20, { grad: PINK, sw: 0.2 });
      // Kraken rage meter
      const rx = L.hudL.x, ry = L.hudL.y + (L.portrait ? 112 : 118), max = M.TUNE.rageMax;
      text('KRAKEN RAGE', rx, ry - 30, 20, { grad: RED, sw: 0.22 });
      for (let k = 0; k < max; k++) {
        const on = k < (fs.rage || 0), x = rx + (k - (max - 1) / 2) * 56;
        const pop = on && k === fs.rage - 1 ? 1 + 0.5 * Math.max(0, 1 - (clock - fs.rageT) / 0.4) : 1;
        g.save();
        if (on) { g.globalCompositeOperation = 'lighter'; glowAt(x, ry, 34 * pop, '255,80,40', 0.7 + 0.2 * Math.sin(clock * 8 + k)); g.globalCompositeOperation = 'source-over'; }
        g.fillStyle = on ? '#ff6a3a' : 'rgba(255,255,255,0.12)';
        g.beginPath(); g.arc(x, ry, 15 * pop, 0, TAU); g.fill();
        g.lineWidth = 3; g.strokeStyle = on ? '#ffd9b0' : 'rgba(255,200,180,0.35)'; g.stroke();
        g.restore();
      }
    }
  }

  function drawLogo() {
    const lg = L.logo, img = st.scene === 'kraken' && IMG.t_kraken.width ? IMG.t_kraken : IMG.logo;
    if (!img.width) return;
    const shrink = st.fs ? 0.86 : 1;
    const w = lg.w * shrink, h = w * img.height / img.width;
    const y = lg.y + Math.sin(ambientClock * 1.2) * 5 - (st.fs ? 6 : 0);
    const sh = (ambientClock % 7) / 1.4;
    drawShiny(img, lg.x - w / 2, y - h / 2, w, h, sh);
  }

  function drawMessage() {
    const m = st.msg;
    if (!m.text) return;
    const a = Math.min(1, (clock - m.t0) / 0.25);
    g.save(); g.globalAlpha = a;
    const size = L.portrait ? 34 : 32;
    g.font = `${size}px "Lilita One", sans-serif`;
    const tw = g.measureText(m.text).width + 70;
    const y = L.msgY + (1 - a) * 8;
    const bgr = g.createLinearGradient(L.DW / 2 - tw / 2, 0, L.DW / 2 + tw / 2, 0);
    bgr.addColorStop(0, 'rgba(0,0,0,0)'); bgr.addColorStop(0.15, 'rgba(2,10,22,0.7)'); bgr.addColorStop(0.85, 'rgba(2,10,22,0.7)'); bgr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bgr; g.fillRect(L.DW / 2 - tw / 2, y - size * 0.8, tw, size * 1.6);
    text(m.text, L.DW / 2, y, size, { grad: m.grad, sw: 0.2 });
    g.restore();
  }

  function drawPlaque() {
    const p = st.plaque;
    if (!p) return;
    const age = clock - p.t0;
    const val = p.dur > 0 ? p.target * Math.min(1, age / p.dur) : p.target;
    const fadeOut = st.win && st.win.cycleStart != null ? Math.max(0, 1 - (clock - st.win.cycleStart) / 0.4) : 1;
    if (fadeOut <= 0) { st.plaque = null; return; }
    const a = Math.min(1, age / 0.15) * fadeOut;
    const cx = L.gx + L.gw / 2, cy = L.gy + L.gh / 2;
    const pop = 1 + 0.25 * Math.max(0, 1 - age / 0.25);
    g.save(); g.globalAlpha = a;
    const bw = 520, bh = 120;
    const gr = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    gr.addColorStop(0, 'rgba(10,2,24,0)'); gr.addColorStop(0.2, 'rgba(10,2,24,0.78)'); gr.addColorStop(0.8, 'rgba(10,2,24,0.78)'); gr.addColorStop(1, 'rgba(10,2,24,0)');
    g.fillStyle = gr; g.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
    g.fillStyle = 'rgba(255,210,100,0.8)';
    g.fillRect(cx - bw * 0.35, cy - bh / 2, bw * 0.7, 2); g.fillRect(cx - bw * 0.35, cy + bh / 2 - 2, bw * 0.7, 2);
    text(fmt(val, val < p.target ? 2 : undefined), cx, cy + 4, 80 * pop, { grad: GOLD, sw: 0.16, strokeColor: '#2a0e00', glow: 'rgba(255,190,60,0.7)' });
    g.restore();
  }

  function drawBanner() {
    const b = st.banner;
    if (!b) return;
    const t = clock - b.t0;
    const u = clamp(t / 0.5, 0, 1);
    const out = clamp((t - (b.dur - 0.3)) / 0.3, 0, 1);
    const sc = (0.3 + 0.7 * Ease.outBack(u)) * (1 - out * 0.4);
    g.save(); g.globalAlpha = 1 - out;
    const cx = L.gx + L.gw / 2, cy = L.gy + L.gh / 2;
    g.translate(cx, cy); g.rotate(Math.sin(t * 9) * 0.03 * (1 - u)); g.scale(sc, sc);
    g.globalCompositeOperation = 'lighter';
    glowAt(0, 0, 420, b.grad === PINK ? '255,80,220' : '100,220,255', 0.45);
    g.globalCompositeOperation = 'source-over';
    text(b.text, 0, 0, 104, { grad: b.grad, sw: 0.16, strokeColor: '#1b0430', glow: 'rgba(255,255,255,0.5)' });
    g.restore();
  }

  // ---------- main render ----------
  function render() {
    // shake
    if (st.shake > 0.2) { st.shakeX = rnd(-1, 1) * st.shake * L.s; st.shakeY = rnd(-1, 1) * st.shake * L.s; } else { st.shakeX = st.shakeY = 0; }
    drawBackground();
    setWorld();
    const board = st.scene === 'reef' || st.scene === 'vault' || st.scene === 'wheel';
    if (board) BON.draw();
    else {
    drawHud();
    drawFrame();
    if (st.scatCeleb >= 0) {
      for (const [r, y] of st.triggerCells) {
        const c = cellCenter(r, y);
        FX.sunburst(g, c.x, c.y, L.cell * 1.6, 14, clock * 1.2, '160,240,255', 0.45);
      }
    }
    drawReels();
    drawSticky();
    drawWinFrames();
    drawFrameTop();
    drawLogo();
    }
    drawMessage();
    drawAwakenEye();
    pWorld.draw(g);
    drawSquads();
    setScreen(); SeaLife.drawFront(g); setWorld();
    drawPlaque();
    drawBanner();
    drawBigWin();
    BON.drawOverlay();
    drawPanel();
    setScreen();
    if (!st.bw && !st.panel) pTop.draw(g);
    if (st.flash > 0.01) {
      g.fillStyle = `rgba(255,245,220,${st.flash * 0.5})`; g.fillRect(0, 0, L.W, L.H);
    }
    if (st.ink) st.ink.wipe.draw(g, st.ink.k, ambientClock);
  }

  // ---------- update ----------
  function update(dt) {
    updateSpace();
    const now = performance.now();
    for (let i = waits.length - 1; i >= 0; i--) if (clock >= waits[i].t && now >= waits[i].minUntil) { const w = waits[i]; waits.splice(i, 1); w.res(); }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      const u = clamp((clock - tw.t0) / tw.dur, 0, 1);
      tw.fn(u);
      if (u >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    updateReels(dt);
    updateSquads(dt);
    updateWinCycle();
    BON.update();
    if (!st.busy && !st.win && st.mode === 'base' && clock > st.tipT) {
      st.tipT = clock + 4.5;
      setMsg(TIPS[st.tipIdx++ % TIPS.length], st.tipIdx % 2 ? CYAN : GOLD);
    }
  }

  let last = performance.now();
  function frame(now) {
    const speed = st.busy && !openModal && !document.hidden && !st.jurisdiction.disabledTurbo && !st.jurisdiction.disabledSlamstop && performance.now() < fastForwardUntil ? 8 : 1;
    const realElapsed = Math.min(0.05, Math.max(0, (now - last) / 1000));
    const elapsed = realElapsed * speed;
    const steps = Math.max(1, Math.ceil(elapsed / 0.05)), dt = elapsed / steps;
    last = now;
    for (let i = 0; i < steps; i++) { clock += dt; update(dt); }
    updateAmbient(realElapsed);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- round flow ----------
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function showEngineError(error) {
    resetInput();
    stopAuto();
    st.busy = false; st.connected = false; st.engineError = error;
    st.panel = null; st.bw = null; st.fs = null; st.spinning = false;
    st.mode = 'base'; st.scene = 'base'; st.bonusTarget = 0;
    BON.reset();
    SFX.countStop(); SFX.anticipationStop();
    $('engineStatus').hidden = false;
    $('engineMessage').textContent = error.message || 'Unable to continue. Reconnect to restore your round.';
    ui();
  }
  async function presentRound(round) {
    st.round = round;
    playback = window.SlotPlayback.create(round.events);
    const b = round.amount / 1000000, mode = Contract.mode(round.mode), res = playback.baseSpin();
    st.shownUnits = 0; st.shownMicro = 0; st.lastWin = 0; st.lastChoice = round.kind;
    clearWin(); ui();
    if (mode.kind === 'wilds') setMsg('SIX SQUID WILDS · ONE SPIN', PINK);
    else if (mode.buy) { st.bonusTarget = 1; setMsg('THE DEEP AWAKENS...', RED); }
    else setMsg(st.replayOnly ? 'ROUND REPLAY' : 'GOOD LUCK!', CYAN);
    SFX.play('spin');
    await spinTo(res.landed);
    if (res.attack) await squadAttack(res.attack);
    await presentWin(res.ev, b);
    await checkpoint();
    if (res.fsAward && playback.baseUnits < mode.maxWinUnits) await runBonus(res.triggerCount, b, res.ev.total, res.triggerCells);
    else if (mode.buy) st.bonusTarget = 0;
    const final = playback.finish();
    if (final.payoutUnits !== round.payoutUnits || st.shownUnits !== round.payoutUnits) throw new Error('Recorded payout presentation does not match the server result');
    await checkpoint();
    await session.finish();
    st.lastWin = round.payout / 1000000;
    st.lastRound = Object.freeze({ id: round.id, mode: round.mode, amount: round.amount, cost: round.cost, payout: round.payout, payoutUnits: round.payoutUnits });
    fastForwardUntil = 0;
    st.busy = false; st.tipT = clock + 3;
    ui();
  }
  async function doSpin(opts) {
    opts = opts || {};
    if (st.busy || !st.ready || !st.connected || st.mode !== 'base') return;
    if (opts.buy && (st.replayOnly || st.jurisdiction.disabledBuyFeature)) return;
    st.busy = true; ui();
    try {
      let round;
      if (st.replayOnly) round = await session.replay();
      else {
        const name = modeName(opts.buy, opts.buyKind);
        round = await session.start(name, Math.round(bet() * 1000000));
        if (st.auto > 0 && !opts.buy) st.auto--;
      }
      await presentRound(round);
      if (st.auto > 0 && !st.replayOnly) {
        await wait(turbo() ? 0.15 : 0.35);
        if (st.auto > 0 && !st.busy && !openModal) doSpin();
      }
    } catch (error) {
      resetInput();
      if (session.state.phase === 'ready' && !error.ambiguous) { st.busy = false; toast(error.message); ui(); }
      else showEngineError(error);
    }
  }
  async function recoverSession() {
    if (st.busy) return;
    st.busy = true; ui();
    try {
      const state = await session.recover();
      acceptConfiguration(state);
      st.round = state.round;
      st.ready = true; $('loader').classList.add('gone');
      if (state.round && !state.replayOnly) { st.resuming = true; await presentRound(state.round); st.resuming = false; }
      else { st.busy = false; ui(); }
    } catch (error) { showEngineError(error); }
  }
  function startAuto(n) {
    if (st.replayOnly || st.jurisdiction.disabledAutoplay || !st.connected) return;
    releaseSpace();
    st.auto = n;
    ui();
    if (!st.busy) doSpin();
  }
  function stopAuto() { st.auto = 0; ui(); }

  function onSpinPress() {
    SFX.init(); SFX.resume();
    if (!$('volumePanel').hidden) { setVolumeOpen(false); return; }
    if (!st.ready || openModal) return;
    if (st.auto > 0) { stopAuto(); return; }
    if (st.panel) { skipNow(); return; }
    if (BON.active()) return;
    if (BON.tapToSpin() || BON.revealNext()) { skipNow(); return; }
    if (st.busy) { skipNow(); return; }
    SFX.play('click');
    return doSpin();
  }

  // ---------- UI ----------
  const el = {
    bal: $('balance'), win: $('lastWin'), bet: $('bet'), spin: $('btnSpin'), auto: $('btnAuto'), turbo: $('btnTurbo'),
    autoCount: $('autoCount'), up: $('betUp'), down: $('betDown'), sound: $('btnSound'), music: $('btnMusic'), buyPrice: $('buyPrice'), buyCost: $('buyCost'), divePrice: $('divePrice'),
    ante: anteBtn, antePrice: $('antePrice'), anteState: $('anteState'), betLabel: $('betLabel'), buyT2: $('buyT2'),
  };
  function ui() {
    el.bal.textContent = st.replayOnly ? 'REPLAY' : st.balanceMicro == null ? '...' : fmt(st.balance);
    el.win.textContent = fmt(st.lastWin);
    el.bet.textContent = fmt(bet() * (st.ante ? M.ANTE_COST : 1));
    el.betLabel.textContent = st.ante ? 'Total bet' : 'Base bet';
    el.antePrice.textContent = fmt(bet() * M.ANTE_COST);
    el.anteState.textContent = st.ante ? 'ON' : 'OFF';
    el.ante.classList.toggle('on', st.ante); el.ante.setAttribute('aria-checked', st.ante);
    buyBtn.classList.toggle('locked', st.ante);
    el.buyT2.textContent = st.ante ? 'ENHANCED CHANCE IS ON' : 'CHOOSE YOUR DEPTH';
    const availableBuys = BUY_MODES.filter(item => modeAvailable(item.name));
    el.buyPrice.textContent = 'FROM ' + fmt(bet() * Math.min(...(availableBuys.length ? availableBuys : BUY_MODES).map(item => item.cost)));
    el.buyCost.textContent = el.divePrice.textContent = fmt(bet() * buyCost(st.buyKind));
    document.querySelectorAll('#buyGrid .buyOpt').forEach(o => {
      const on = o.dataset.kind === st.buyKind, cost = buyCost(o.dataset.kind);
      o.classList.toggle('sel', on); o.setAttribute('aria-checked', on); o.disabled = !modeAvailable(modeName(true, o.dataset.kind));
      o.querySelector('.cost').textContent = cost + 'x · ' + fmt(bet() * cost);
      o.setAttribute('aria-label', `${BUY_NAMES[o.dataset.kind]}: ${cost} times the base bet, ${fmt(bet() * cost)}. ${o.dataset.description}`);
    });
    const locked = st.busy || st.mode !== 'base' || !st.ready || !st.connected || st.replayOnly;
    const indices = allowedBets(modeName(false));
    el.up.disabled = locked || !indices.some(index => index > st.betIdx);
    el.down.disabled = locked || !indices.some(index => index < st.betIdx);
    el.spin.classList.toggle('spinning', st.busy);
    el.spin.classList.toggle('auto', st.auto > 0);
    el.autoCount.textContent = st.replayOnly ? 'PLAY' : st.auto > 0 ? String(st.auto) : '';
    el.spin.setAttribute('aria-label', st.replayOnly ? 'Play replay' : 'Spin');
    el.spin.disabled = !st.ready || !st.connected || (!st.replayOnly && !modeAvailable(modeName(false))) || (st.busy && st.jurisdiction.disabledSlamstop);
    el.auto.classList.toggle('on', st.auto > 0);
    el.auto.textContent = st.auto > 0 ? 'STOP' : 'AUTO';
    el.turbo.classList.toggle('on', turbo());
    el.turbo.setAttribute('aria-pressed', String(turbo()));
    el.turbo.disabled = locked || st.jurisdiction.disabledTurbo;
    el.auto.disabled = st.replayOnly || st.jurisdiction.disabledAutoplay || !st.ready || !st.connected || (st.busy && !st.auto);
    $('btnRecover').disabled = st.busy;
    sessionDetail();
    syncAudioControls();
    buyBtn.classList.toggle('hide', !st.ready || st.replayOnly || st.jurisdiction.disabledBuyFeature || st.mode !== 'base' || st.inBonus || (st.busy && st.bonusTarget > 0.5));
    buyBtn.disabled = locked || !availableBuys.length;
    el.ante.classList.toggle('hide', !st.ready || st.replayOnly || st.mode !== 'base' || st.inBonus || (st.busy && st.bonusTarget > 0.5));
    el.ante.disabled = locked || !modeAvailable(st.ante ? 'base_vault' : 'ante_vault');
  }

  let openModal = null, plunging = false;
  function syncAudioControls() {
    const muted = SFX.isMuted(), musicMuted = SFX.isMusicMuted();
    el.sound.classList.toggle('off', muted);
    el.music.classList.toggle('off', musicMuted);
    el.sound.setAttribute('aria-pressed', String(muted));
    el.sound.setAttribute('aria-label', muted ? 'Unmute all audio' : 'Mute all audio');
    el.music.setAttribute('aria-pressed', String(musicMuted));
    el.music.setAttribute('aria-label', musicMuted ? 'Unmute music' : 'Mute music');
    for (const [id, value] of [['effectsVolume', SFX.getEffectsVolume()], ['musicVolume', SFX.getMusicVolume()]]) {
      const percent = Math.round(value * 100), input = $(id);
      input.value = String(percent);
      input.setAttribute('aria-valuetext', percent + ' percent');
      $(id + 'Value').textContent = percent + '%';
    }
    $('volumeStatus').textContent = muted ? 'All audio is muted. Your volume settings are saved.' : musicMuted ? 'Music is muted. Your volume settings are saved.' : 'Mute buttons keep your volume settings.';
  }
  function setVolumeOpen(open, focus = false) {
    $('volumePanel').hidden = !open;
    $('btnVolume').setAttribute('aria-expanded', String(open));
    if (open) { resetInput(); syncAudioControls(); if (focus) $('effectsVolume').focus(); }
  }
  function showModal(id) {
    resetInput();
    setVolumeOpen(false);
    closeModal();
    openModal = $(id); openModal.hidden = false;
    const f = openModal.querySelector('.btn.gold, .chips .btn, .x');
    if (f) f.focus();
  }
  function closeModal() {
    if (!openModal || plunging) return;
    if (openModal.id === 'mBuy' && !st.busy) st.bonusTarget = 0;
    openModal.hidden = true; openModal = null;
  }
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) { SFX.play('click'); closeModal(); } });
  });

  function buildInfo() {
    const b = bet();
    const returns = `<p>Theoretical return is <b>${M.RTP.toFixed(2)}% of the full wager in all ${Contract.MODES.length} modes</b>: Normal, Enhanced Chance, Coin, Super, Legendary, Mystery and Six Wilds. RTP describes the return across a very large number of plays. It does not predict the return from an individual play or session.</p>`;
    const purchases = BUY_MODES.map(item => `<li><b>${BUY_NAMES[item.kind]}</b>: ${item.cost}x the base bet (${fmt(b * item.cost)}). Maximum payout: ${item.maxWinUnits / M.UNIT_SCALE}x the base bet.</li>`).join('');
    const reefValues = M.REEF_CASH_VALUES.map(value => value + 'x').join(', ');
    const vaultValues = M.VAULT_COIN_VALUES.map(value => value + 'x').join(', ');
    const order = [S.ANCHOR, S.GOLD, S.SILVER, S.A, S.K, S.Q, S.J];
    const pays = order.map(s => `<div class="pay"><img src="assets/sym_${SYM_FILES[s]}.webp" alt="${M.LABELS[s]}"><ul>${[2, 1, 0].map(i => `<li><span>${i + 3}</span>${fmt(M.PAYS[s][i] * b)}</li>`).join('')}</ul></div>`).join('');
    $('infoBody').innerHTML = `
      <p class="fine" style="text-align:center">Wins shown per way at your current bet of <b>${fmt(b)}</b>.</p>
      <div class="pays">${pays}</div>
      <h3>Squid Wild</h3>
      <div class="feat"><img src="assets/sym_wild.webp" alt=""><p>The purple <b>Squid Wild</b> lands on reels 2 to 5 and stands in for every symbol except the Pearl. On Normal and Enhanced Chance spins, <b>3 or more Squid Wilds trigger the Coin Bonus (Captain's Vault)</b>, the lowest-volatility bonus. Squad Attack wilds count toward the trigger. Feature strength uses 3, 4 or 5 squid levels; 5 or more squids use level 5.</p></div>
      <h3>Pearl Scatter</h3>
      <div class="feat"><img src="assets/sym_scatter.webp" alt=""><p><b>3, 4 or 5 Pearls</b> anywhere pay <b>${fmt(2 * b)}, ${fmt(10 * b)} or ${fmt(50 * b)}</b>. Pearls do not start a bonus. During Kraken free spins, 3 or more Pearls add 5 free spins.</p></div>
      <h3>Squad Attack</h3>
      <p>On a normal or Enhanced Chance spin the Squid Squad can swim in and ink <b>2 to 5 symbols into Wilds</b>. The recorded outcome includes the affected positions; a win is not guaranteed.</p>
      <h3>Legendary Bonus · Kraken's Wrath</h3>
      <div class="feat"><img src="assets/t_kraken.webp" alt=""><p><b>8, 10 or 13 free spins.</b> Every Wild <b>sticks</b> with a <b>x2, x3 or x5</b> multiplier. Multiplier Wilds on each individual winning way add together; a way without one pays at x1. Every <b>${M.TUNE.rageMax} new Wilds</b> fill the Rage meter and the <b>Kraken awakens</b>: every sticky multiplier <b>+1</b> and <b>+${M.TUNE.rageSpins} spins</b>. 3 or more Pearls add +5 spins. Maximum ${M.FS_MAX_SPINS} free spins per bonus.</p></div>
      <h3>Super Bonus · Pearl Reef</h3>
      <div class="feat"><img src="assets/t_reef.webp" alt=""><p>Your trigger Squids become starting Pearls on a 15-cell board. Cash Pearls have starting values of <b>${reefValues}</b> the base bet, before modifiers. You get <b>3 respins</b>, and every new Pearl resets them to 3. With 3, 4 or 5 trigger Squids, cash values are multiplied by <b>x1, x3 or x7.5</b>, respectively. A <b>Wheel-awarded Super Reef upgrade</b> adds 2 starting Pearls and multiplies cash values by another x3, making the combined level x3, x9 or x22.5. The 250x Super Bonus purchase enters standard Pearl Reef; the Wheel upgrade is a separate feature.</p></div>
      <p>Each <b>Golden Pearl doubles all cash Pearls currently on the board</b>, including cash landing on that respin. Multiple Golden Pearls each double those values again. A Golden Pearl has no cash value of its own and occupies a board position. Level, Super and Golden Pearl multipliers do not change the fixed prizes: <b>Mini 20x, Minor 50x, Major 150x</b> the base bet. Fill all 15 cells for an additional <b>Grand 1,000x</b> the base bet.</p>
      <h3>Coin Bonus · Captain's Vault</h3>
      <div class="feat"><img src="assets/t_vault.webp" alt=""><p>12 chests contain 7 coin rewards, one multiplier reward, one extra life and 3 Krakens. Each coin reward can be <b>${vaultValues}</b> the base bet, before the vault multiplier. With 3, 4 or 5 or more trigger Squids, you start with <b>2, 3 or 4 lives</b> and an <b>x1, x1 or x3</b> multiplier, respectively. The multiplier chest adds +1. <b>Super Vault</b> doubles the starting multiplier to x2, x2 or x6, and its multiplier chest adds +2.</p></div>
      <p>Each Kraken takes a life; the extra-life chest adds one. When your lives run out or all non-Kraken rewards are revealed, the vault pays <b>collected coins x final multiplier</b>. Each click reveals the next result in the accepted round. Choosing a different chest changes the reveal position and does not change the payout.</p>
      <h3>Mystery Bonus · Wheel of the Deep</h3>
      <div class="feat"><img src="assets/t_wheel.webp" alt=""><p>Spin the great helm. It reveals one of the three bonuses, a <b>SUPER</b> version (Super Kraken starts with a x2 sticky wild, Super Reef triples cash values with 2 extra pearls, Super Vault doubles its starting multiplier and has a +2x multiplier chest) or a <b>25x / 40x cash prize</b>. Slice sizes are decorative and do not represent outcome probabilities.</p></div>
      <h3>Enhanced Chance</h3>
      <p>Switch on <b>Enhanced Chance</b> to pay <b>${M.ANTE_COST}x your bet (${fmt(b * M.ANTE_COST)})</b> per spin using a separate outcome table with enhanced bonus frequency. Wins are paid on your base bet. Bonus Buy is off while Enhanced Chance is on.</p>
      <h3>Bonus Buy</h3>
      <ul>${purchases}</ul>
      <p>Coin, Super, Legendary and Mystery purchases guarantee 3 to 5 Squid Wilds and their selected feature. Trigger-spin wins and the feature are included in the payout. <b>Six Wilds</b> guarantees exactly six purple Squid Wilds on one spin. It never triggers a bonus, including Captain's Vault. Its maximum payout of <b>1,579.5x the base bet</b> equals <b>31.59x its 50x purchase price</b>.</p>
      <h3>Rules</h3>
      <p>243 ways: 3 or more matching symbols on adjacent reels from the leftmost reel pay, any position. Only the longest match per symbol is paid, for every qualifying way. Wins on different symbols and scatter wins are added. All amounts use the base bet accepted at the start of the round. Normal, Enhanced Chance and the four bonus purchases share a combined spin and feature maximum of <b>5,000x the base bet</b>. This equals <b>5,000x the Normal wager or 2,500x the total Enhanced Chance wager</b>. Each purchase price is a multiple of the base bet; payout multipliers are applied to the base bet, not the purchase price. Six Wilds has the separate maximum shown above.</p>
      <h3>Return to player</h3>
      ${returns}
      <h3>Controls</h3>
      <ul>
        <li><b>Info</b> opens this paytable and the game rules.</li>
        <li><b>+ / -</b> changes the base bet within the available limits. The bet display shows the full wager when Enhanced Chance is on.</li>
        <li><b>3 Squids: Coin</b> identifies the fixed bonus triggered by Normal and Enhanced Chance spins.</li>
        <li><b>Enhanced Chance</b> switches the enhanced mode on or off and changes the full spin cost to 2x the base bet when on.</li>
        <li><b>Buy Bonus</b> opens the five purchase choices. Select one, review its displayed price, then press the highlighted purchase button to confirm and place that wager.</li>
        <li><b>Auto</b> opens the spin-count choices. Choose a count to confirm and start autoplay. Press <b>STOP</b> or <b>Spin</b> to stop future spins; an accepted round still finishes.</li>
        <li><b>Turbo</b> changes animation speed. Keep pressing Spin or tapping the game to speed through animations. Win totals remain visible briefly; the next wager can start after the current round settles. During the Vault, Spin reveals the next unopened chest. Animation speed does not change the result or payout.</li>
        <li><b>Sound</b> mutes all audio. <b>Music</b> mutes music only. Open <b>Volume settings</b> to adjust sound effects and music separately. Mute keeps your saved volume levels.</li>
        <li><b>Spin</b> places the displayed wager when the game is ready. During play it stops or skips eligible animations. In replay, <b>PLAY</b> starts the recorded round and can repeat it without placing a wager.</li>
      </ul>
      <p>Controls may be unavailable while a round is active or because of your session restrictions.</p>
      <p>Keys: <span class="kbd">Space</span> spin / stop / skip. Hold Space for turbo and repeat spins; release to stop repeating and restore your Turbo setting. A bonus pauses repeat spins. In the purchase dialog, <span class="kbd">1</span> to <span class="kbd">5</span> select a purchase; selection alone places no wager.</p>
      <h3>Game operation</h3>
      <p>A malfunction invalidates affected plays and wins. Use a stable internet connection. If play is interrupted, reload the game or use <b>Reconnect</b> to restore an unfinished accepted round before placing another wager. The game service (RGS) records the result and settles the wallet; the browser presentation does not determine settlement. Reels, wheels, chests and other animations illustrate the recorded result and do not simulate physical devices. Animation timing and reveal positions do not change the accepted payout.</p>
      <p class="fine">${st.demo ? 'This local demo uses play-money credits only.' : st.replayOnly ? 'Replay displays an existing result and places no wager.' : 'Your session currency, available modes and restrictions are provided by the game service.'}</p>`;
  }

  function bindUI() {
    el.spin.addEventListener('click', onSpinPress);
    $('btnRecover').onclick = recoverSession;
    const toDesign = e => ({ x: (e.clientX - L.ox - st.shakeX) / L.s, y: (e.clientY - L.oy - st.shakeY) / L.s });
    cvs.addEventListener('pointermove', e => { if (st.ready) { const p = toDesign(e); BON.pointer('move', p.x, p.y); } });
    cvs.addEventListener('pointerdown', e => {
      SFX.init(); SFX.resume();
      if (!st.ready || openModal) return;
      if (st.panel) { skipNow(); return; }
      const p = toDesign(e);
      BON.pointer('down', p.x, p.y);
      if (st.busy) skipNow();
    });
    window.addEventListener('keydown', e => {
      if (!$('volumePanel').hidden) {
        if (e.code === 'Escape') { e.preventDefault(); setVolumeOpen(false); $('btnVolume').focus(); }
        return;
      }
      if (openModal && openModal.id === 'mBuy') {
        const i = BUYS.findIndex(o => o.kind === st.buyKind), d = /^Digit([1-5])$/.exec(e.code);
        if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { e.preventDefault(); pickDive(BUYS[Math.min(BUYS.length - 1, i + 1)].kind, true); return; }
        if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { e.preventDefault(); pickDive(BUYS[Math.max(0, i - 1)].kind, true); return; }
        if (d) { pickDive(BUYS[d[1] - 1].kind, true); return; }
        if (e.code === 'Enter' && e.target && e.target.classList && e.target.classList.contains('buyOpt')) { e.preventDefault(); $('buyConfirm').click(); return; }
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        if (e.code === 'Space' && st.jurisdiction.disabledSpacebar) { e.preventDefault(); return; }
        if (e.ctrlKey || e.altKey || e.metaKey || e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
        if (e.target && e.target.tagName === 'BUTTON' && (e.code !== 'Space' || e.target !== el.spin)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (openModal) return;
        if (e.code === 'Space' && st.ready && st.connected && !st.auto) { spaceHeld = true; spaceActive = false; spaceStarted = performance.now(); }
        onSpinPress();
      } else if (e.code === 'Escape') { resetInput(); closeModal(); }
      else if (BON.active() && !openModal) { BON.key(e.code); }
    });
    window.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      if (spaceHeld || e.target === el.spin) e.preventDefault();
      releaseSpace();
    });
    window.addEventListener('blur', resetInput);
    window.addEventListener('pagehide', resetInput);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
    el.up.onclick = () => { if (!el.up.disabled) { st.betIdx = allowedBets(modeName(false)).find(index => index > st.betIdx); SFX.play('bet', true); save(); ui(); } };
    el.down.onclick = () => { if (!el.down.disabled) { st.betIdx = allowedBets(modeName(false)).findLast(index => index < st.betIdx); SFX.play('bet', false); save(); ui(); } };
    el.turbo.onclick = () => { if (el.turbo.disabled) return; st.turbo = !st.turbo; SFX.play('click'); save(); ui(); };
    el.sound.onclick = () => { SFX.init(); SFX.setMuted(!SFX.isMuted()); SFX.play('click'); ui(); };
    el.music.onclick = () => { SFX.init(); SFX.setMusicMuted(!SFX.isMusicMuted()); SFX.play('click'); ui(); };
    $('btnVolume').onclick = () => { SFX.init(); SFX.resume(); setVolumeOpen($('volumePanel').hidden, true); };
    $('volumeClose').onclick = () => { setVolumeOpen(false); $('btnVolume').focus(); };
    $('effectsVolume').oninput = e => { SFX.init(); SFX.resume(); SFX.setEffectsVolume(Number(e.target.value) / 100); syncAudioControls(); };
    $('musicVolume').oninput = e => { SFX.init(); SFX.resume(); SFX.setMusicVolume(Number(e.target.value) / 100); syncAudioControls(); };
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#volumePanel, #btnVolume')) setVolumeOpen(false); });
    $('btnInfo').onclick = () => { SFX.play('click'); buildInfo(); showModal('mInfo'); };
    el.auto.onclick = () => {
      if (el.auto.disabled) return;
      SFX.play('click');
      if (st.auto > 0) { stopAuto(); return; }
      if (st.mode !== 'base') return;
      showModal('mAuto');
    };
    const chips = $('autoChips');
    [10, 25, 50, 100, 250].forEach(n => {
      const bt = document.createElement('button');
      bt.className = 'btn gold'; bt.textContent = n;
      bt.onclick = () => { SFX.play('click'); closeModal(); startAuto(n); };
      chips.appendChild(bt);
    });
    const grid = $('buyGrid'), bellEl = $('diveBell'), cableEl = $('diveCable');
    const BUYS = [
      { kind: 'vault', title: 't_vault', bg: 'bg_vault', pos: '22% 78%', tint: '255,184,84', depth: 200, vol: 2, volTxt: 'Low', desc: 'Captain\'s Vault: coins, multipliers and extra lives' },
      { kind: 'wheel', title: 't_wheel', bg: 'bg_helm', pos: '48% 62%', tint: '84,226,214', depth: 900, vol: 4, volTxt: 'High', desc: 'Wheel of the Deep: a bonus, upgraded bonus or cash' },
      { kind: 'reef', title: 't_reef', bg: 'bg_reef', pos: '58% 60%', tint: '160,128,255', depth: 2400, vol: 4, volTxt: 'High', desc: 'Pearl Reef: Hold &amp; Win with fixed prizes up to 1,000x' },
      { kind: 'kraken', title: 't_kraken', bg: 'bg_kraken', pos: '76% 30%', tint: '255,72,58', depth: 4000, vol: 5, volTxt: 'Extreme', desc: 'Kraken\'s Wrath: sticky multiplier wilds and Kraken Rage' },
      { kind: 'wilds', title: 'sym_wild', bg: 'bg_bonus', pos: '50% 50%', tint: '220,130,255', depth: 4500, vol: 3, volTxt: '1 spin', desc: 'Exactly 6 squid wilds. Standalone spin with no bonus trigger.' },
    ];
    const metres = n => n.toLocaleString('en-US');
    let bellY = 0;
    st.buyKind = st.buyKind || 'vault';
    BUYS.forEach((o, i) => {
      const bt = document.createElement('button');
      bt.className = 'buyOpt'; bt.dataset.kind = o.kind; bt.dataset.description = o.desc.replace('&amp;', 'and');
      bt.setAttribute('role', 'radio');
      bt.style.setProperty('--i', i); bt.style.setProperty('--tint', o.tint);
      bt.innerHTML = `<span class="depth"><b>${metres(o.depth)}</b><small>METRES</small></span>
        <span class="card">
          <span class="port"><span class="scene" style="background-image:url(assets/${o.bg}.webp);--pos:${o.pos}"></span><img src="assets/ui_port.webp" alt=""></span>
          <span class="info"><span class="zone">${BUY_NAMES[o.kind]}</span><img class="ttl" src="assets/${o.title}.webp" alt=""><span class="cost"></span><span class="d">${o.desc}</span></span>
          <span class="gauge" style="--a:${-90 + (o.vol - 1) / 4 * 180}deg"><svg viewBox="0 0 64 40"><path class="face" d="M2 37A30 30 0 0 1 62 37Z"/><path class="arc" d="M7 35A25 25 0 0 1 57 35"/><path class="tk" d="M7 35A25 25 0 0 1 57 35"/><line class="needle" x1="32" y1="35" x2="32" y2="12"/><circle class="hub" cx="32" cy="35" r="4.5"/></svg><span class="gl">${o.kind === 'wilds' ? 'Feature' : 'Volatility'}</span><span class="gv">${o.volTxt}</span></span>
        </span>`;
      bt.onclick = () => pickDive(o.kind);
      bt.ondblclick = () => $('buyConfirm').click();
      grid.appendChild(bt);
    });
    // hang the bathysphere beside the chosen station; 'drop' lowers it from the surface, 'instant' snaps it there
    function diveSync(mode) {
      const sel = grid.querySelector('.buyOpt.sel');
      const o = BUYS.find(b => b.kind === st.buyKind);
      if (o) $('diveDepth').textContent = BUY_NAMES[o.kind];
      if (!sel || $('mBuy').hidden) return;
      const body = grid.parentElement;
      if (body.scrollHeight > body.clientHeight + 1 && mode !== 'instant') sel.scrollIntoView({ block: 'nearest', behavior: mode === 'drop' ? 'auto' : 'smooth' });
      const bh = bellEl.offsetHeight || 110;
      const y = sel.offsetTop + sel.offsetHeight / 2 - bh * 0.64;
      const put = yy => { bellY = yy; bellEl.style.transform = `translateY(${yy + 14}px)`; cableEl.style.height = Math.max(0, yy + 20) + 'px'; };
      bellEl.style.transitionDuration = cableEl.style.transitionDuration = mode === 'drop' ? '1.25s' : '';
      if (mode === 'instant' || mode === 'drop') {
        bellEl.style.transition = cableEl.style.transition = 'none';
        put(mode === 'drop' ? -bh - 70 : y);
        void bellEl.offsetWidth;
        bellEl.style.transition = cableEl.style.transition = '';
        if (mode === 'drop') bellEl.style.transitionDuration = cableEl.style.transitionDuration = '1.25s';
        if (mode === 'instant') return;
      }
      put(y);
    }
    function bubbleTrail(n) {
      const host = grid.closest('.divePanel'), r = bellEl.getBoundingClientRect(), p = host.getBoundingClientRect();
      for (let i = 0; i < (n || 10); i++) {
        const b = document.createElement('i'), s = 4 + Math.random() * 9;
        b.className = 'bub';
        b.style.cssText = `left:${r.left - p.left + r.width * (0.15 + Math.random() * 0.7)}px;top:${r.top - p.top + r.height * (0.35 + Math.random() * 0.55)}px;width:${s}px;height:${s}px;--dx:${(Math.random() - 0.5) * 46}px;animation-delay:${Math.random() * 0.45}s;animation-duration:${1 + Math.random() * 0.9}s`;
        host.appendChild(b);
        setTimeout(() => b.remove(), 2600);
      }
    }
    function pickDive(kind, focus) {
      if (!modeAvailable(modeName(true, kind))) return;
      const idx = BUYS.findIndex(b => b.kind === kind);
      if (focus) grid.querySelector(`[data-kind="${kind}"]`).focus();
      if (kind === st.buyKind || plunging) return;
      bubbleTrail(8);
      st.buyKind = kind;
      ui(); diveSync();
      SFX.play('winch'); SFX.play('sonar', idx);
    }
    window.addEventListener('resize', () => diveSync('instant'));
    el.ante.onclick = () => {
      if (el.ante.disabled || st.busy || st.mode !== 'base' || st.inBonus) return;
      SFX.init(); SFX.resume();
      st.ante = !st.ante;
      constrainBet(modeName(false));
      SFX.play(st.ante ? 'anteOn' : 'anteOff');
      if (st.ante) toast('Enhanced Chance on: separate bonus outcome table');
      save(); ui();
    };
    function openDive() {
      if (st.busy || st.mode !== 'base' || !st.connected || st.replayOnly) return;
      if (st.jurisdiction.disabledBuyFeature) return;
      if (st.ante) { SFX.init(); SFX.resume(); SFX.play('denied'); toast('Turn off Enhanced Chance to buy a bonus'); return; }
      if (!modeAvailable(modeName(true, st.buyKind))) {
        const available = BUY_MODES.find(item => modeAvailable(item.name));
        if (!available) return;
        st.buyKind = available.kind;
      }
      SFX.init(); SFX.resume(); SFX.play('click'); SFX.play('swoosh');
      st.bonusTarget = 0.7;
      ui();
      showModal('mBuy');
      diveSync('drop');
      setTimeout(() => { if (openModal && openModal.id === 'mBuy') SFX.play('sonar', BUYS.findIndex(b => b.kind === st.buyKind)); }, 900);
    }
    buyBtn.onclick = openDive;
    $('buyConfirm').onclick = () => {
      if (st.busy || plunging) return;
      if (!modeAvailable('buy_' + st.buyKind) || st.jurisdiction.disabledBuyFeature) return;
      if (!allowedBets('buy_' + st.buyKind).includes(st.betIdx)) { toast('Lower the base bet to meet this bonus limit'); SFX.play('denied'); return; }
      if (st.balanceMicro < Math.round(bet() * 1000000) * buyCost(st.buyKind)) { toast('Not enough balance for this purchase'); SFX.play('denied'); return; }
      SFX.play('click'); SFX.play('plunge');
      const m = $('mBuy'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      plunging = true;
      bubbleTrail(16);
      m.classList.add('plunge');
      bellEl.style.transform = `translateY(${bellY + innerHeight + 200}px)`;
      cableEl.style.height = (innerHeight * 2) + 'px';
      setTimeout(() => {
        plunging = false;
        stopAuto();
        doSpin({ buy: true, buyKind: st.buyKind });
        closeModal();
        m.classList.remove('plunge');
      }, still ? 0 : 740);
    };
    document.addEventListener('pointerup', e => { const b = e.target.closest && e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 200));
  }

  // ---------- intro / loading screen ----------
  function introSlides() {
    const slides = [...document.querySelectorAll('#loader .slide')], dots = [...document.querySelectorAll('#introDots button')], cap = $('introCap');
    const CAPS = ['WIN UP TO 5,000X BET', 'STICKY WILDS UP TO X5', '3 SQUIDS · COIN BONUS', 'SQUAD ATTACK ON BASE SPINS'];
    let i = 0, timer = 0;
    const show = k => {
      i = (k + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle('on', j === i));
      dots.forEach((d, j) => { d.classList.toggle('on', j === i); d.setAttribute('aria-current', j === i ? 'true' : 'false'); });
      cap.textContent = CAPS[i];
      cap.classList.remove('pop'); void cap.offsetWidth; cap.classList.add('pop');
    };
    const run = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 3800); };
    dots.forEach((d, j) => { d.onclick = () => { show(j); run(); }; });
    show(0); run();
    return () => clearInterval(timer);
  }

  // ---------- boot ----------
  async function boot() {
    bindUI();
    layout();
    ui();
    const loader = $('loader'), start = $('btnStart'), ring = loader.querySelector('.ring .fg'), pct = $('introPct'), skipBox = $('introSkip');
    let skipIntro = false;
    try { skipIntro = localStorage.getItem('ss_skipIntro') === '1'; } catch (e) { /* storage unavailable */ }
    skipBox.checked = skipIntro;
    skipBox.onchange = () => { try { localStorage.setItem('ss_skipIntro', skipBox.checked ? '1' : '0'); } catch (e) { /* ignore */ } };
    if (skipIntro) loader.classList.add('quick');
    const stopSlides = introSlides();
    const progress = p => { ring.style.strokeDashoffset = (289.03 * (1 - p)).toFixed(1); pct.textContent = Math.round(p * 100) + '%'; };
    progress(0);
    await loadAll(p => progress(p * 0.9));
    try { await document.fonts.load('40px "Lilita One"'); } catch (e) { /* font optional */ }
    FX.buildSprites();
    buildSymbols();
    buildSquad();
    GLOK = !!(window.SymGL && SymGL.init(SYM));
    SeaLife.init(IMG);
    SeaLife.resize(L.W, L.H);
    causticTile = FX.causticTile(200, 14);
    causticPat = g.createPattern(causticTile, 'repeat');
    initReels();
    progress(1);
    layout();
    requestAnimationFrame(t => { last = t; frame(t); });
    let state;
    try {
      state = await session.init();
      acceptConfiguration(state);
      st.round = state.round;
      $('launchHint').textContent = state.replayOnly ? 'Recorded round replay · no wager is placed' : state.demo ? 'Local demo · play-money credits only' : 'Connected to your game session';
    } catch (error) { stopSlides(); showEngineError(error); return; }
    const enter = withSound => {
      if (st.ready) return;
      stopSlides();
      if (withSound) { SFX.init(); SFX.resume(); SFX.startMusic('base'); SFX.play('fsStart'); }
      loader.classList.add('gone');
      st.ready = true;
      ui();
      SeaLife.burst(L.W * 0.5, L.H, 60);
      if (state.round && !state.replayOnly) {
        st.busy = true; st.resuming = true; ui();
        presentRound(state.round).then(() => { st.resuming = false; }).catch(showEngineError);
      }
    };
    if (skipIntro) {
      // straight into the game; browsers only allow sound after a gesture, so the music starts on the first tap or key
      const firstTouch = () => {
        window.removeEventListener('pointerdown', firstTouch, true); window.removeEventListener('keydown', firstTouch, true);
        SFX.init(); SFX.resume();
        if (st.scene === 'base' && !st.inBonus) SFX.startMusic('base');
      };
      window.addEventListener('pointerdown', firstTouch, true); window.addEventListener('keydown', firstTouch, true);
      setTimeout(() => enter(false), 350);
    } else {
      loader.classList.add('ready');
      start.disabled = false;
      start.focus();
      start.onclick = () => enter(true);
    }
  }

  const BON = window.Bonuses({
    M, FX, SFX, IMG, SYM, st, L, g, clock: () => clock, ambientClock: () => ambientClock, wait, waitSkip, tween, setMsg, text, rr, glowAt, drawShiny, drawArms, pWorld, pTop,
    setScreen, setWorld, fmt, turbo, cellCenter, spawnFountainCoin, enterScene, exitScene, introPanel, finishBonus, hudPanel, checkpoint, bonusUnits: () => playback.bonusUnits,
    GOLD, PINK, CYAN, RED, RESULT_HOLD,
  });

  if (DEBUG) window.__ss = { st, reels, get session() { return session; }, get gl() { return GLOK; }, set gl(v) { GLOK = v && window.SymGL && SymGL.ok; }, get clock() { return clock; }, bench(n) { const t0 = performance.now(); for (let i = 0; i < n; i++) { clock += 1 / 60; update(1 / 60); render(); } g.getImageData(0, 0, 1, 1); return (performance.now() - t0) / n; }, step(n) { for (let i = 0; i < n; i++) { clock += 1 / 60; update(1 / 60); render(); } }, spin: () => onSpinPress(), buy: kind => doSpin({ buy: true, buyKind: kind }), select: selectDive, recover: recoverSession, bon: () => BON };
  boot().catch(showEngineError);
})();

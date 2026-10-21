/* Squid Squad — game math (shared by the browser game and the Node RTP simulator) */
(function (root) {
  'use strict';

  const REELS = 5, ROWS = 3;
  const S = { J: 0, Q: 1, K: 2, A: 3, SILVER: 4, GOLD: 5, ANCHOR: 6, WILD: 7, SCATTER: 8 };
  const NAMES = ['J', 'Q', 'K', 'A', 'SILVER', 'GOLD', 'ANCHOR', 'WILD', 'SCATTER'];
  const LABELS = ['J', 'Q', 'K', 'A', 'Silver Coin', 'Gold Coin', 'Anchor', 'Squid Chest', 'Pearl'];

  // pay per way, in multiples of the TOTAL bet, for 3 / 4 / 5 of a kind
  const PAYS = [
    [0.06, 0.20, 0.60], // J
    [0.07, 0.25, 0.80], // Q
    [0.12, 0.35, 1.00], // K
    [0.14, 0.40, 1.30], // A
    [0.25, 0.80, 2.60], // Silver coin
    [0.40, 1.30, 4.00], // Gold coin
    [0.65, 2.00, 6.50], // Anchor
  ];

  //            J   Q   K   A  SIL GLD ANC WILD SCAT
  const BASE_WEIGHTS = [
    [30, 28, 26, 24, 13, 11, 9, 0, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
  ];
  // Triple Chance reels (the spin costs ANTE_COST x the bet): Pearls land often enough to triple the chance of a
  // bonus (1 in 77 instead of 1 in 231). Wilds are more common and the Squad attacks 1 in 50, which keeps a
  // Triple Chance spin's RTP equal to a normal spin's (tools/rtp-exact.js ... ante).
  const ANTE_COST = 2;
  const ANTE_WEIGHTS = [
    [30, 28, 26, 24, 13, 11, 9, 0, 6.11],
    [30, 28, 26, 24, 13, 11, 9, 5.8, 6.11],
    [30, 28, 26, 24, 13, 11, 9, 5.8, 6.11],
    [30, 28, 26, 24, 13, 11, 9, 5.8, 6.11],
    [30, 28, 26, 24, 13, 11, 9, 5.8, 6.11],
  ];
  const FS_WEIGHTS = [
    [28, 26, 24, 22, 14, 12, 10, 0, 2.4],
    [28, 26, 24, 22, 14, 12, 10, 2.63, 2.4],
    [28, 26, 24, 22, 14, 12, 10, 2.63, 2.4],
    [28, 26, 24, 22, 14, 12, 10, 2.63, 2.4],
    [28, 26, 24, 22, 14, 12, 10, 2.63, 2.4],
  ];

  const SCATTER_PAY = { 3: 2, 4: 10, 5: 50 };
  const FS_AWARD = { 3: 8, 4: 12, 5: 15 };
  const FS_RETRIGGER = 5;
  const FS_MAX_SPINS = 60;
  const WILD_MULTS = [[2, 62], [3, 28], [5, 10]];
  const ATTACK_CHANCE = 1 / 84;
  const ATTACK_COUNTS = [[2, 40], [3, 34], [4, 18], [5, 8]];
  const BUY_COST = 100;
  const BUY_SCATTERS = [[3, 94.5], [4, 5.2], [5, 0.3]];
  const MAX_WIN = 5000;
  const BIG_WIN = 15, MEGA_WIN = 40, EPIC_WIN = 100;

  function pickWeighted(pairs, rand) {
    let t = 0;
    for (const p of pairs) t += p[1];
    let r = rand() * t;
    for (const p of pairs) { if ((r -= p[1]) < 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }

  function pickSymbol(weights, rand, exclude) {
    let t = 0;
    for (let i = 0; i < weights.length; i++) if (i !== exclude) t += weights[i];
    let r = rand() * t;
    for (let i = 0; i < weights.length; i++) {
      if (i === exclude) continue;
      if ((r -= weights[i]) < 0) return i;
    }
    return 0;
  }

  // grid[reel][row]; at most one scatter per reel
  function spinGrid(weightSet, rand, noScatter) {
    const g = [];
    for (let r = 0; r < REELS; r++) {
      const col = [];
      let hasScat = !!(noScatter && noScatter[r]);
      for (let y = 0; y < ROWS; y++) {
        const s = pickSymbol(weightSet[r], rand, hasScat ? S.SCATTER : -1);
        if (s === S.SCATTER) hasScat = true;
        col.push(s);
      }
      g.push(col);
    }
    return g;
  }

  function cloneGrid(g) { return g.map(c => c.slice()); }

  function countScatters(g) {
    const cells = [];
    for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) if (g[r][y] === S.SCATTER) cells.push([r, y]);
    return cells;
  }

  /**
   * 243-ways evaluation. mults[r][y] = wild multiplier (0 = none).
   * A way's multiplier is the SUM of wild multipliers on it (or x1 if it has none).
   */
  function evaluate(g, mults) {
    const wins = [];
    let total = 0;
    for (let s = 0; s <= S.ANCHOR; s++) {
      const c = [], z = [], V = [], cells = [];
      let L = 0;
      for (let r = 0; r < REELS; r++) {
        let cnt = 0, zero = 0, vsum = 0;
        const rc = [];
        for (let y = 0; y < ROWS; y++) {
          const sym = g[r][y];
          if (sym === s || sym === S.WILD) {
            cnt++;
            const m = sym === S.WILD && mults ? (mults[r][y] || 0) : 0;
            if (m > 0) vsum += m; else zero++;
            rc.push([r, y]);
          }
        }
        if (cnt === 0) break;
        c.push(cnt); z.push(zero); V.push(vsum); cells.push(...rc);
        L++;
      }
      if (L < 3) continue;
      let ways = 1, zeroWays = 1;
      for (let r = 0; r < L; r++) { ways *= c[r]; zeroWays *= z[r]; }
      let multSum = 0;
      for (let r = 0; r < L; r++) {
        if (!V[r]) continue;
        let p = V[r];
        for (let q = 0; q < L; q++) if (q !== r) p *= c[q];
        multSum += p;
      }
      const effWays = multSum + zeroWays; // sum over ways of the way multiplier
      const amount = PAYS[s][L - 3] * effWays;
      total += amount;
      wins.push({ sym: s, len: L, ways, mult: effWays / ways, amount, cells });
    }
    const scat = countScatters(g);
    const scatterPay = scat.length >= 3 ? SCATTER_PAY[Math.min(5, scat.length)] : 0;
    total += scatterPay;
    wins.sort((a, b) => b.amount - a.amount);
    return { wins, total, scatterCells: scat, scatterCount: scat.length, scatterPay };
  }

  function forceScatters(g, n, rand) {
    const reels = [0, 1, 2, 3, 4];
    for (let i = reels.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [reels[i], reels[j]] = [reels[j], reels[i]]; }
    const chosen = new Set(reels.slice(0, n));
    for (let r = 0; r < REELS; r++) {
      for (let y = 0; y < ROWS; y++) if (g[r][y] === S.SCATTER) g[r][y] = pickSymbol(BASE_WEIGHTS[r], rand, S.SCATTER);
      if (chosen.has(r)) {
        const y = Math.floor(rand() * ROWS);
        g[r][y] = S.SCATTER;
      }
    }
    return g;
  }

  /** One base-game round. Returns everything the presentation layer needs. */
  function baseSpin(rand, opts) {
    opts = opts || {};
    let grid = spinGrid(opts.ante ? ANTE_WEIGHTS : BASE_WEIGHTS, rand);
    if (opts.buy) forceScatters(grid, pickWeighted(BUY_SCATTERS, rand), rand);
    const landed = cloneGrid(grid);
    let attack = null;
    if (!opts.buy && rand() < (opts.ante ? TUNE.anteAttack : ATTACK_CHANCE)) {
      const free = [];
      for (let r = 1; r < REELS; r++) for (let y = 0; y < ROWS; y++) {
        if (grid[r][y] !== S.SCATTER && grid[r][y] !== S.WILD) free.push([r, y]);
      }
      const n = Math.min(free.length, pickWeighted(ATTACK_COUNTS, rand));
      // the Squad always delivers: re-aim (up to 30 times) until the inked wilds form a win
      for (let tries = 0; tries < 30; tries++) {
        for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
        const test = cloneGrid(landed);
        for (const [r, y] of free.slice(0, n)) test[r][y] = S.WILD;
        attack = free.slice(0, n);
        if (evaluate(test, null).total > 0) break;
      }
      for (const [r, y] of attack) grid[r][y] = S.WILD;
    }
    const ev = evaluate(grid, null);
    const fsAward = ev.scatterCount >= 3 ? FS_AWARD[Math.min(5, ev.scatterCount)] : 0;
    return { landed, grid, attack, ev, fsAward };
  }

  /**
   * One Kraken's Wrath free spin. sticky = wild multipliers (mutated). ks = { rage } (mutated):
   * every RAGE_MAX wilds that land, the Kraken awakens: every sticky multiplier +1 and +RAGE_SPINS spins.
   * The awakening happens before the spin is paid, so it boosts this spin's win.
   */
  function freeSpin(rand, sticky, ks) {
    const grid = spinGrid(FS_WEIGHTS, rand);
    const landed = cloneGrid(grid);
    const newWilds = [];
    for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) {
      if (sticky[r][y] > 0) { grid[r][y] = S.WILD; landed[r][y] = S.WILD; }
      else if (grid[r][y] === S.WILD) {
        const m = pickWeighted(WILD_MULTS, rand);
        sticky[r][y] = m;
        newWilds.push([r, y, m]);
      }
    }
    let awaken = 0;
    if (ks) {
      ks.rage += newWilds.length;
      while (ks.rage >= TUNE.rageMax) { ks.rage -= TUNE.rageMax; awaken++; }
      if (awaken) for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) if (sticky[r][y] > 0) sticky[r][y] += awaken;
    }
    const mults = sticky.map(c => c.slice());
    const ev = evaluate(grid, mults);
    const retrigger = ev.scatterCount >= 3 ? FS_RETRIGGER : 0;
    return { landed, grid, mults, newWilds, ev, retrigger, awaken, extra: awaken * TUNE.rageSpins };
  }

  function emptySticky() { return Array.from({ length: REELS }, () => [0, 0, 0]); }

  // ============================== BONUS GAMES ==============================
  // Every bonus is balanced to the same average value, so the player's choice changes the ride, not the odds.
  const TUNE = { rageMax: 3, rageSpins: 2, reefLand: 0.0965, reefLevel: { 3: 1, 4: 3, 5: 7.5 }, reefSuper: 3, krakenSpins: { 3: 8, 4: 10, 5: 13 }, superSpins: 0, superPreset: 2, vaultCoin: 1, anteAttack: 1 / 50 };
  const RAGE_MAX = TUNE.rageMax, RAGE_SPINS = TUNE.rageSpins;
  const BONUS_KINDS = ['kraken', 'reef', 'vault', 'wheel'];

  function krakenStart(pearls, sup, rand) {
    const ks = { sticky: emptySticky(), rage: 0, left: TUNE.krakenSpins[Math.min(5, pearls)] + (sup ? TUNE.superSpins : 0) };
    if (sup && TUNE.superPreset) {
      // Super Kraken: starts with a sticky multiplier wild already on the reels
      const r = 1 + Math.floor(rand() * 4), y = Math.floor(rand() * 3);
      ks.sticky[r][y] = TUNE.superPreset;
      ks.preset = [r, y, TUNE.superPreset];
    }
    return ks;
  }
  function playKraken(rand, pearls, sup) {
    const ks = krakenStart(pearls, sup, rand);
    let played = 0, total = 0;
    while (ks.left > 0 && played < FS_MAX_SPINS) {
      ks.left--; played++;
      const r = freeSpin(rand, ks.sticky, ks);
      total += r.ev.total;
      ks.left = Math.min(ks.left + r.retrigger + r.extra, FS_MAX_SPINS - played);
    }
    return total;
  }

  // ---- Pearl Reef: hold & win. Pearls lock with cash values; any new pearl resets the respins to 3.
  const REEF_LAND = 0.072;
  const JACKPOT = { MINI: 20, MINOR: 50, MAJOR: 150, GRAND: 1000 };
  const REEF_VALUES = [[1, 230], [2, 220], [3, 160], [4, 110], [5, 95], [8, 60], [10, 42], [15, 24], ['MINI', 15], ['MINOR', 5], ['MAJOR', 1.5], ['GOLD', 13]];
  function reefPearl(rand, noGold, lvl) {
    let v = pickWeighted(REEF_VALUES, rand);
    while (noGold && v === 'GOLD') v = pickWeighted(REEF_VALUES, rand);
    if (v === 'GOLD') return { kind: 'gold', v: 0 };
    if (typeof v === 'string') return { kind: v.toLowerCase(), v: JACKPOT[v] };
    return { kind: 'cash', v: v * (lvl || 1) };
  }
  function reefStart(pearls, sup, rand, positions) {
    const cells = new Array(REELS * ROWS).fill(null);
    const order = Array.from({ length: cells.length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const pos = (positions && positions.length ? positions.slice() : []);
    for (const i of order) { if (pos.length >= pearls) break; if (!pos.includes(i)) pos.push(i); }
    if (sup) for (const i of order) { if (pos.length >= pearls + 2) break; if (!pos.includes(i)) pos.push(i); }
    // more trigger pearls (or a Super reef) raise every cash pearl's value for the whole round
    const lvl = TUNE.reefLevel[Math.min(5, pearls)] * (sup ? TUNE.reefSuper : 1);
    for (const i of pos) cells[i] = reefPearl(rand, true, lvl);
    return { cells, respins: 3, grand: false, lvl };
  }
  function reefRespin(rs, rand) {
    const landed = [];
    for (let i = 0; i < rs.cells.length; i++) if (!rs.cells[i] && rand() < TUNE.reefLand) { rs.cells[i] = reefPearl(rand, false, rs.lvl); landed.push(i); }
    let gold = 0;
    for (const i of landed) if (rs.cells[i].kind === 'gold') gold++;
    if (gold) for (const c of rs.cells) if (c && c.kind === 'cash') c.v *= Math.pow(2, gold);
    rs.respins = landed.length ? 3 : rs.respins - 1;
    const full = rs.cells.every(Boolean);
    if (full) { rs.grand = true; rs.respins = 0; }
    return { landed, gold, full };
  }
  function reefTotal(rs) {
    let t = rs.grand ? JACKPOT.GRAND : 0;
    for (const c of rs.cells) if (c) t += c.v;
    return t;
  }
  function playReef(rand, pearls, sup) {
    const rs = reefStart(pearls, sup, rand);
    while (rs.respins > 0) reefRespin(rs, rand);
    return reefTotal(rs);
  }

  // ---- Captain's Vault: pick chests. Coins add up, "+1x" chests raise the vault multiplier applied at the end,
  //      a pearl adds a life, the Kraken takes one. Out of lives (or chests) and the vault pays coins x multiplier.
  const VAULT_COIN = [[3, 15], [5, 18], [8, 17], [10, 14], [15, 11], [20, 8], [30, 5], [50, 2.4], [100, 0.8], [250, 0.12]];
  const VAULT_KRAKENS = 3;
  function vaultStart(pearls, sup, rand) {
    const pool = [];
    for (let i = 0; i < 7; i++) pool.push({ kind: 'coin', v: Math.round(pickWeighted(VAULT_COIN, rand) * TUNE.vaultCoin) });
    pool.push({ kind: 'mult', v: sup ? 2 : 1 });
    pool.push({ kind: 'life' });
    for (let i = 0; i < VAULT_KRAKENS; i++) pool.push({ kind: 'kraken' });
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const lives = Math.min(5, pearls) - 1;
    const mult = (pearls >= 5 ? 3 : 1) * (sup ? 2 : 1);
    return { chests: pool, open: pool.map(() => false), lives, coins: 0, mult, over: false, picks: 0 };
  }
  function vaultPick(vs, i) {
    if (vs.over || vs.open[i]) return null;
    vs.open[i] = true; vs.picks++;
    const c = vs.chests[i];
    if (c.kind === 'coin') vs.coins += c.v;
    else if (c.kind === 'mult') vs.mult += c.v;
    else if (c.kind === 'life') vs.lives++;
    else if (c.kind === 'kraken') vs.lives--;
    const left = vs.chests.some((x, j) => !vs.open[j] && x.kind !== 'kraken');
    if (vs.lives <= 0 || !left) vs.over = true;
    return c;
  }
  const vaultTotal = vs => vs.coins * vs.mult;
  function playVault(rand, pearls, sup) {
    const vs = vaultStart(pearls, sup, rand);
    for (let i = 0; i < vs.chests.length && !vs.over; i++) vaultPick(vs, i);
    return vaultTotal(vs);
  }

  // ---- Wheel of the Deep: slice size = chance. Lands on a bonus, a SUPER bonus, or a cash prize.
  const WHEEL = [
    { kind: 'kraken', w: 20 }, { kind: 'cash', v: 25, w: 9 }, { kind: 'reef', sup: true, w: 4 }, { kind: 'vault', w: 20 },
    { kind: 'kraken', sup: true, w: 4 }, { kind: 'reef', w: 20 }, { kind: 'cash', v: 40, w: 9 }, { kind: 'vault', sup: true, w: 4 },
  ];
  function wheelSpin(rand) {
    let t = 0;
    for (const s of WHEEL) t += s.w;
    let r = rand() * t;
    for (let i = 0; i < WHEEL.length; i++) { if ((r -= WHEEL[i].w) < 0) return i; }
    return 0;
  }
  function playBonus(rand, kind, pearls, sup) {
    if (kind === 'kraken') return playKraken(rand, pearls, sup);
    if (kind === 'reef') return playReef(rand, pearls, sup);
    if (kind === 'vault') return playVault(rand, pearls, sup);
    const seg = WHEEL[wheelSpin(rand)];
    if (seg.kind === 'cash') return seg.v;
    return playBonus(rand, seg.kind, pearls, seg.sup);
  }

  // seeded RNG for simulation / reproducibility
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function cryptoRand() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] / 4294967296;
    }
    return Math.random();
  }

  const api = {
    REELS, ROWS, S, NAMES, LABELS, PAYS, BASE_WEIGHTS, FS_WEIGHTS, SCATTER_PAY, FS_AWARD, FS_RETRIGGER, FS_MAX_SPINS,
    WILD_MULTS, ATTACK_CHANCE, ANTE_COST, ANTE_WEIGHTS, BUY_COST, MAX_WIN, BIG_WIN, MEGA_WIN, EPIC_WIN,
    spinGrid, evaluate, baseSpin, freeSpin, emptySticky, pickWeighted, mulberry32, cryptoRand, cloneGrid,
    RAGE_MAX, RAGE_SPINS, TUNE, BONUS_KINDS, JACKPOT, WHEEL, REEF_LAND,
    krakenStart, playKraken, reefStart, reefRespin, reefTotal, playReef, vaultStart, vaultPick, vaultTotal, playVault, wheelSpin, playBonus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlotMath = api;
})(typeof window !== 'undefined' ? window : globalThis);

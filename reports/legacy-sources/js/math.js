(function (root) {
  'use strict';

  const REELS = 5, ROWS = 3;
  const S = { J: 0, Q: 1, K: 2, A: 3, SILVER: 4, GOLD: 5, ANCHOR: 6, WILD: 7, SCATTER: 8 };
  const NAMES = ['J', 'Q', 'K', 'A', 'SILVER', 'GOLD', 'ANCHOR', 'WILD', 'SCATTER'];
  const LABELS = ['J', 'Q', 'K', 'A', 'Silver Coin', 'Gold Coin', 'Anchor', 'Squid Chest', 'Pearl'];

  const PAYS = [
    [0.06, 0.20, 0.60], 
    [0.07, 0.25, 0.80], 
    [0.12, 0.35, 1.00], 
    [0.14, 0.40, 1.30], 
    [0.25, 0.80, 2.60], 
    [0.40, 1.30, 4.00], 
    [0.65, 2.00, 6.50], 
  ];

  const BASE_WEIGHTS = [
    [30, 28, 26, 24, 13, 11, 9, 0, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
    [30, 28, 26, 24, 13, 11, 9, 4, 4.0],
  ];

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
  const FS_AWARD = { 3: 8, 4: 10, 5: 13 };
  const FS_RETRIGGER = 5;
  const FS_MAX_SPINS = 60;
  const WILD_MULTS = [[2, 62], [3, 28], [5, 10]];
  const ATTACK_CHANCE = 1 / 84;
  const ATTACK_COUNTS = [[2, 40], [3, 34], [4, 18], [5, 8]];
  const BUY_COST = 100;
  const UNIT_SCALE = 100;
  const PROFILE_VERSION = 'squid-ways-2';
  const PAY_UNITS = PAYS.map(row => row.map(value => Math.round(value * UNIT_SCALE)));
  const BUY_SCATTERS = [[3, 94.5], [4, 5.2], [5, 0.3]];
  const MAX_WIN = 5000;
  const BIG_WIN = 15, MEGA_WIN = 40, EPIC_WIN = 100;

  function integer(value, name, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(name + ' is out of range');
    return value;
  }

  function toUnits(value) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid payout');
    const units = Math.round(value * UNIT_SCALE);
    if (!Number.isSafeInteger(units) || Math.abs(value * UNIT_SCALE - units) > 0.000001) throw new RangeError('Payout requires hundredth-bet precision');
    return units;
  }

  function randomIndex(size, rand) {
    integer(size, 'Random range', 1, 0x100000000);
    if (rand === cryptoRand) {
      const limit = Math.floor(0x100000000 / size) * size;
      let value;
      do { value = cryptoUint(); } while (value >= limit);
      return value % size;
    }
    if (typeof rand !== 'function') throw new TypeError('A random source is required');
    const value = rand();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Random source must return [0, 1)');
    return Math.floor(value * size);
  }

  const weightedCache = new WeakMap();
  function weightedTable(pairs) {
    if (!Array.isArray(pairs) || !pairs.length) throw new RangeError('Empty weight table');
    let table = weightedCache.get(pairs);
    if (table) return table;
    let total = 0;
    const entries = pairs.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isFinite(pair[1]) || pair[1] < 0) throw new RangeError('Invalid weight');
      const weight = Math.round(pair[1] * 10000);
      if (Math.abs(pair[1] * 10000 - weight) > 0.000001) throw new RangeError('Weight precision exceeded');
      total += weight;
      return [pair[0], total];
    });
    integer(total, 'Total weight', 1, 0x100000000);
    table = { entries, total };
    if (Object.isFrozen(pairs) && pairs.every(Object.isFrozen)) weightedCache.set(pairs, table);
    return table;
  }

  function pickWeighted(pairs, rand) {
    const table = weightedTable(pairs), value = randomIndex(table.total, rand);
    for (const [item, end] of table.entries) if (value < end) return item;
    throw new Error('Weight selection failed');
  }

  const symbolCache = new WeakMap();
  function pickSymbol(weights, rand, exclude) {
    let tables = symbolCache.get(weights);
    if (!tables) { tables = new Map(); if (Object.isFrozen(weights)) symbolCache.set(weights, tables); }
    if (!tables.has(exclude)) tables.set(exclude, deepFreeze(weights.map((weight, symbol) => [symbol, symbol === exclude ? 0 : weight])));
    return pickWeighted(tables.get(exclude), rand);
  }

  function validateGrid(grid, mults) {
    if (!Array.isArray(grid) || grid.length !== REELS) throw new RangeError('Expected five reels');
    if (mults != null && (!Array.isArray(mults) || mults.length !== REELS)) throw new RangeError('Invalid multiplier grid');
    for (let r = 0; r < REELS; r++) {
      if (!Array.isArray(grid[r]) || grid[r].length !== ROWS) throw new RangeError('Expected three rows');
      if (mults && (!Array.isArray(mults[r]) || mults[r].length !== ROWS)) throw new RangeError('Invalid multiplier rows');
      let scatters = 0;
      for (let y = 0; y < ROWS; y++) {
        const symbol = integer(grid[r][y], 'Symbol', 0, S.SCATTER);
        if (!r && symbol === S.WILD) throw new RangeError('Wilds cannot land on reel one');
        if (symbol === S.SCATTER) scatters++;
        if (mults) {
          const mult = integer(mults[r][y], 'Wild multiplier', 0, FS_MAX_SPINS);
          if (mult && symbol !== S.WILD) throw new RangeError('Only wilds carry multipliers');
        }
      }
      if (scatters > 1) throw new RangeError('Only one scatter per reel');
    }
  }

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

  function evaluate(g, mults) {
    validateGrid(g, mults);
    const wins = [];
    let totalUnits = 0;
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
      const effWays = multSum + zeroWays; 
      const units = PAY_UNITS[s][L - 3] * effWays;
      totalUnits += units;
      wins.push({ sym: s, len: L, ways, mult: effWays / ways, units, amount: units / UNIT_SCALE, cells });
    }
    const scat = countScatters(g);
    const scatterPay = scat.length >= 3 ? SCATTER_PAY[Math.min(5, scat.length)] : 0;
    const scatterUnits = toUnits(scatterPay);
    totalUnits += scatterUnits;
    wins.sort((a, b) => b.units - a.units);
    return { wins, total: totalUnits / UNIT_SCALE, totalUnits, scatterCells: scat, scatterCount: scat.length, scatterPay, scatterUnits };
  }

  function forceScatters(g, n, rand) {
    const reels = [0, 1, 2, 3, 4];
    for (let i = reels.length - 1; i > 0; i--) { const j = randomIndex(i + 1, rand); [reels[i], reels[j]] = [reels[j], reels[i]]; }
    const chosen = new Set(reels.slice(0, n));
    for (let r = 0; r < REELS; r++) {
      for (let y = 0; y < ROWS; y++) if (g[r][y] === S.SCATTER) g[r][y] = pickSymbol(BASE_WEIGHTS[r], rand, S.SCATTER);
      if (chosen.has(r)) {
        const y = randomIndex(ROWS, rand);
        g[r][y] = S.SCATTER;
      }
    }
    return g;
  }

  function baseSpin(rand, opts) {
    opts = opts || {};
    if (opts.buy && opts.ante) throw new RangeError('Bonus buy and Triple Chance are separate modes');
    const grid = spinGrid(opts.ante ? ANTE_WEIGHTS : BASE_WEIGHTS, rand);
    if (opts.buy) forceScatters(grid, pickWeighted(BUY_SCATTERS, rand), rand);
    const landed = cloneGrid(grid);
    let attack = null;
    if (!opts.buy && chance(opts.ante ? TUNE.anteAttack : ATTACK_CHANCE, rand)) {
      const free = [];
      for (let r = 1; r < REELS; r++) for (let y = 0; y < ROWS; y++) {
        if (grid[r][y] !== S.SCATTER && grid[r][y] !== S.WILD) free.push([r, y]);
      }
      const n = Math.min(free.length, pickWeighted(ATTACK_COUNTS, rand));
      
      for (let i = free.length - 1; i > 0; i--) { const j = randomIndex(i + 1, rand); [free[i], free[j]] = [free[j], free[i]]; }
      attack = free.slice(0, n);
      for (const [r, y] of attack) grid[r][y] = S.WILD;
    }
    const ev = evaluate(grid, null);
    const fsAward = ev.scatterCount >= 3 ? FS_AWARD[Math.min(5, ev.scatterCount)] : 0;
    return { landed, grid, attack, ev, fsAward };
  }

  function freeSpin(rand, sticky, ks) {
    if (!Array.isArray(sticky)) throw new RangeError('Invalid sticky wilds');
    validateGrid(sticky.map(col => Array.isArray(col) ? col.map(mult => mult ? S.WILD : S.J) : col), sticky);
    if (ks) integer(ks.rage, 'Kraken rage', 0, TUNE.rageMax - 1);
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

  const TUNE = { rageMax: 3, rageSpins: 2, reefLand: 0.0965, reefLevel: { 3: 1, 4: 3, 5: 7.5 }, reefSuper: 3, krakenSpins: { 3: 8, 4: 10, 5: 13 }, superSpins: 0, superPreset: 2, vaultCoin: 1, anteAttack: 1 / 50 };
  const RAGE_MAX = TUNE.rageMax, RAGE_SPINS = TUNE.rageSpins;
  const BONUS_KINDS = ['kraken', 'reef', 'vault', 'wheel'];

  function validPearls(pearls) { return integer(pearls, 'Trigger pearls', 3, 5); }

  function krakenStart(pearls, sup, rand) {
    validPearls(pearls);
    const ks = { sticky: emptySticky(), rage: 0, left: TUNE.krakenSpins[Math.min(5, pearls)] + (sup ? TUNE.superSpins : 0), played: 0, totalUnits: 0 };
    if (sup && TUNE.superPreset) {
      
      const r = 1 + randomIndex(4, rand), y = randomIndex(3, rand);
      ks.sticky[r][y] = TUNE.superPreset;
      ks.preset = [r, y, TUNE.superPreset];
    }
    return ks;
  }
  function krakenStep(ks, rand, remainingUnits) {
    if (!ks || !Array.isArray(ks.sticky)) throw new RangeError('Invalid Kraken state');
    integer(ks.played, 'Played free spins', 0, FS_MAX_SPINS);
    integer(ks.left, 'Remaining free spins', 0, FS_MAX_SPINS - ks.played);
    integer(ks.totalUnits, 'Kraken payout units', 0, MAX_WIN * UNIT_SCALE);
    integer(ks.rage, 'Kraken rage', 0, TUNE.rageMax - 1);
    const limit = MAX_WIN * UNIT_SCALE - ks.totalUnits;
    const remaining = remainingUnits === undefined ? limit : Math.min(integer(remainingUnits, 'Remaining award units', 0, MAX_WIN * UNIT_SCALE), limit);
    if (!ks.left || ks.played >= FS_MAX_SPINS || !remaining) { ks.left = 0; return null; }
    if (typeof rand !== 'function') throw new TypeError('A random source is required');
    validateGrid(ks.sticky.map(col => Array.isArray(col) ? col.map(mult => mult ? S.WILD : S.J) : col), ks.sticky);
    ks.left--; ks.played++;
    const result = freeSpin(rand, ks.sticky, ks);
    const paidUnits = Math.min(result.ev.totalUnits, remaining);
    ks.totalUnits += paidUnits;
    const extraAdded = Math.min(result.extra, FS_MAX_SPINS - ks.played - ks.left);
    ks.left += extraAdded;
    const retriggerAdded = Math.min(result.retrigger, FS_MAX_SPINS - ks.played - ks.left);
    ks.left += retriggerAdded;
    const capped = paidUnits === remaining;
    if (capped) ks.left = 0;
    return Object.assign(result, { paidUnits, capped, extraAdded, retriggerAdded });
  }
  function playKraken(rand, pearls, sup) {
    const ks = krakenStart(pearls, sup, rand);
    while (krakenStep(ks, rand)) {}
    return ks.totalUnits / UNIT_SCALE;
  }

  const REEF_LAND = TUNE.reefLand;
  const JACKPOT = { MINI: 20, MINOR: 50, MAJOR: 150, GRAND: 1000 };
  const REEF_VALUES = [[1, 230], [2, 220], [3, 160], [4, 110], [5, 95], [8, 60], [10, 42], [15, 24], ['MINI', 15], ['MINOR', 5], ['MAJOR', 1.5], ['GOLD', 13]];
  const REEF_START_VALUES = REEF_VALUES.filter(pair => pair[0] !== 'GOLD');
  function reefPearl(rand, noGold, lvl) {
    const v = pickWeighted(noGold ? REEF_START_VALUES : REEF_VALUES, rand);
    if (v === 'GOLD') return { kind: 'gold', v: 0 };
    if (typeof v === 'string') return { kind: v.toLowerCase(), v: JACKPOT[v] };
    return { kind: 'cash', v: v * (lvl || 1) };
  }
  function reefStart(pearls, sup, rand, positions) {
    validPearls(pearls);
    if (positions && (!Array.isArray(positions) || positions.length > pearls || new Set(positions).size !== positions.length || Array.from(positions).some(i => !Number.isInteger(i) || i < 0 || i >= REELS * ROWS))) throw new RangeError('Invalid starting pearl positions');
    const cells = new Array(REELS * ROWS).fill(null);
    const order = Array.from({ length: cells.length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = randomIndex(i + 1, rand); [order[i], order[j]] = [order[j], order[i]]; }
    const pos = (positions && positions.length ? positions.slice() : []);
    for (const i of order) { if (pos.length >= pearls) break; if (!pos.includes(i)) pos.push(i); }
    if (sup) for (const i of order) { if (pos.length >= pearls + 2) break; if (!pos.includes(i)) pos.push(i); }
    
    const lvl = TUNE.reefLevel[Math.min(5, pearls)] * (sup ? TUNE.reefSuper : 1);
    for (const i of pos) cells[i] = reefPearl(rand, true, lvl);
    return { cells, respins: 3, grand: false, lvl };
  }
  function reefRespin(rs, rand) {
    if (rs.respins <= 0) return { landed: [], gold: 0, full: rs.grand };
    const landed = [];
    for (let i = 0; i < rs.cells.length; i++) if (!rs.cells[i] && chance(TUNE.reefLand, rand)) { rs.cells[i] = reefPearl(rand, false, rs.lvl); landed.push(i); }
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

  const VAULT_COIN = [[3, 15], [5, 18], [8, 17], [10, 14], [15, 11], [20, 8], [30, 5], [50, 2.4], [100, 0.8], [250, 0.12]];
  const VAULT_KRAKENS = 3;
  function vaultStart(pearls, sup, rand) {
    validPearls(pearls);
    const pool = [];
    for (let i = 0; i < 7; i++) pool.push({ kind: 'coin', v: Math.round(pickWeighted(VAULT_COIN, rand) * TUNE.vaultCoin) });
    pool.push({ kind: 'mult', v: sup ? 2 : 1 });
    pool.push({ kind: 'life' });
    for (let i = 0; i < VAULT_KRAKENS; i++) pool.push({ kind: 'kraken' });
    for (let i = pool.length - 1; i > 0; i--) { const j = randomIndex(i + 1, rand); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const lives = Math.min(5, pearls) - 1;
    const mult = (pearls >= 5 ? 3 : 1) * (sup ? 2 : 1);
    return { chests: pool, open: pool.map(() => false), lives, coins: 0, mult, over: false, picks: 0 };
  }
  function vaultPick(vs, i) {
    integer(i, 'Chest index', 0, vs.chests.length - 1);
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

  const WHEEL = [
    { kind: 'kraken', w: 20 }, { kind: 'cash', v: 25, w: 9 }, { kind: 'reef', sup: true, w: 4 }, { kind: 'vault', w: 20 },
    { kind: 'kraken', sup: true, w: 4 }, { kind: 'reef', w: 20 }, { kind: 'cash', v: 40, w: 9 }, { kind: 'vault', sup: true, w: 4 },
  ];
  const WHEEL_WEIGHTS = WHEEL.map((segment, index) => [index, segment.w]);
  function wheelSpin(rand) { return pickWeighted(WHEEL_WEIGHTS, rand); }
  function playBonus(rand, kind, pearls, sup) {
    validPearls(pearls);
    if (!BONUS_KINDS.includes(kind)) throw new RangeError('Unknown bonus');
    if (kind === 'kraken') return playKraken(rand, pearls, sup);
    if (kind === 'reef') return playReef(rand, pearls, sup);
    if (kind === 'vault') return playVault(rand, pearls, sup);
    const seg = WHEEL[wheelSpin(rand)];
    if (seg.kind === 'cash') return seg.v;
    return playBonus(rand, seg.kind, pearls, seg.sup);
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function cryptoUint() {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable');
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
  }

  function cryptoRand() { return cryptoUint() / 0x100000000; }

  function chance(probability, rand) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new RangeError('Invalid probability');
    if (probability === ATTACK_CHANCE) return randomIndex(84, rand) === 0;
    if (probability === TUNE.anteAttack) return randomIndex(50, rand) === 0;
    return randomIndex(1000000, rand) < Math.round(probability * 1000000);
  }

  function payoutCents(units, betCents) {
    integer(units, 'Payout units', 0, MAX_WIN * UNIT_SCALE);
    integer(betCents, 'Base bet cents', 1, 1000000);
    return Math.floor((units * betCents + UNIT_SCALE / 2) / UNIT_SCALE);
  }

  const rounds = new WeakMap();
  function createRound(betCents, opts) {
    opts = opts || {};
    integer(betCents, 'Base bet cents', 1, 1000000);
    if (opts.buy && opts.ante) throw new RangeError('Bonus buy and Triple Chance are separate modes');
    const mode = opts.buy ? 'buy' : opts.ante ? 'ante' : 'base';
    const cost = opts.buy ? BUY_COST : opts.ante ? ANTE_COST : 1;
    const state = { winUnits: 0, paidCents: 0, closed: false };
    const round = {};
    Object.defineProperties(round, {
      winUnits: { get: () => state.winUnits, enumerable: true },
      paidCents: { get: () => state.paidCents, enumerable: true },
      closed: { get: () => state.closed, enumerable: true },
      betCents: { value: betCents, enumerable: true },
      costCents: { value: betCents * cost, enumerable: true },
      mode: { value: mode, enumerable: true },
      capUnits: { value: MAX_WIN * UNIT_SCALE, enumerable: true },
      profile: { value: PROFILE_VERSION, enumerable: true },
    });
    rounds.set(round, state);
    return Object.freeze(round);
  }

  function awardRound(round, units) {
    const state = rounds.get(round);
    if (!state || state.closed) throw new Error('Round is invalid or closed');
    integer(units, 'Award units', 0, Number.MAX_SAFE_INTEGER);
    const accepted = Math.min(units, round.capUnits - round.winUnits);
    state.winUnits += accepted;
    const totalCents = payoutCents(round.winUnits, round.betCents);
    const paidCents = totalCents - round.paidCents;
    state.paidCents = totalCents;
    return { units: accepted, paidCents, totalCents, totalUnits: round.winUnits, capped: round.winUnits === round.capUnits };
  }

  function closeRound(round) {
    const state = rounds.get(round);
    if (!state || state.closed) throw new Error('Round is invalid or closed');
    state.closed = true;
    return Object.freeze({ profile: round.profile, mode: round.mode, betCents: round.betCents, costCents: round.costCents, winUnits: round.winUnits, paidCents: round.paidCents, netCents: round.paidCents - round.costCents });
  }

  function playRound(rand, opts) {
    opts = opts || {};
    const kind = opts.kind || 'kraken';
    if (!BONUS_KINDS.includes(kind)) throw new RangeError('Unknown bonus');
    const round = createRound(opts.betCents == null ? 100 : opts.betCents, opts);
    const base = baseSpin(rand, opts);
    const baseAward = awardRound(round, base.ev.totalUnits);
    const bonusUnits = base.fsAward ? toUnits(playBonus(rand, kind, base.ev.scatterCount, false)) : 0;
    const bonusAward = awardRound(round, bonusUnits);
    return { base, baseAward, bonusAward, settlement: closeRound(round) };
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  [S, NAMES, LABELS, PAYS, PAY_UNITS, BASE_WEIGHTS, ANTE_WEIGHTS, FS_WEIGHTS, SCATTER_PAY, FS_AWARD, WILD_MULTS, ATTACK_COUNTS, BUY_SCATTERS, TUNE, BONUS_KINDS, JACKPOT, REEF_VALUES, REEF_START_VALUES, VAULT_COIN, WHEEL, WHEEL_WEIGHTS].forEach(deepFreeze);

  const api = {
    UNIT_SCALE, PROFILE_VERSION, PAY_UNITS, BUY_SCATTERS, ATTACK_COUNTS, REEF_VALUES, VAULT_COIN,
    toUnits, payoutCents, createRound, awardRound, closeRound, playRound, randomIndex,
    REELS, ROWS, S, NAMES, LABELS, PAYS, BASE_WEIGHTS, FS_WEIGHTS, SCATTER_PAY, FS_AWARD, FS_RETRIGGER, FS_MAX_SPINS,
    WILD_MULTS, ATTACK_CHANCE, ANTE_COST, ANTE_WEIGHTS, BUY_COST, MAX_WIN, BIG_WIN, MEGA_WIN, EPIC_WIN,
    spinGrid, evaluate, baseSpin, freeSpin, emptySticky, pickWeighted, mulberry32, cryptoRand, cloneGrid,
    RAGE_MAX, RAGE_SPINS, TUNE, BONUS_KINDS, JACKPOT, WHEEL, REEF_LAND,
    krakenStart, krakenStep, playKraken, reefStart, reefRespin, reefTotal, playReef, vaultStart, vaultPick, vaultTotal, playVault, wheelSpin, playBonus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.freeze(api);
  else root.SlotMath = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);

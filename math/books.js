'use strict';

const { isDeepStrictEqual } = require('node:util');
const M = require('./model');
const { MODES } = require('../shared/modes');

const SCHEMA = 2;
const CAP_UNITS = M.MAX_WIN * M.UNIT_SCALE;
const MAX_BOOK_BYTES = 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));

function mode(name) {
  const found = MODES.find(item => item.name === name);
  if (!found) throw new RangeError('Unknown Engine mode');
  return found;
}

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + name);
  return value;
}

function expect(condition, name) {
  if (!condition) throw new RangeError('Invalid ' + name);
}

function equal(actual, expected, name) {
  expect(isDeepStrictEqual(actual, expected), name);
}

function generateBook(rand, options) {
  const opts = options || {};
  const config = mode(opts.mode);
  const id = integer(opts.id == null ? 0 : opts.id, 0, Number.MAX_SAFE_INTEGER, 'book id');
  const events = [];
  const add = (type, data) => events.push(Object.assign({ index: events.length, type }, clone(data)));
  const base = M.baseSpin(rand, config);
  const baseUnits = Math.min(config.maxWinUnits, base.ev.totalUnits);
  let totalUnits = baseUnits;
  add('round', { schema: SCHEMA, mode: config.name, kind: config.kind, base });
  if (base.fsAward && totalUnits < CAP_UNITS) {
    const pearls = Math.min(5, base.triggerCount);
    let kind = config.kind, sup = false;
    if (kind === 'wheel') {
      const segment = M.wheelSpin(rand), result = M.WHEEL[segment];
      add('wheel', { segment, result });
      kind = result.kind; sup = !!result.sup;
      if (kind === 'cash') totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(result.v));
    }
    if (kind === 'kraken') {
      const state = M.krakenStart(pearls, sup, rand);
      add('krakenStart', { pearls, sup, state });
      while (state.left && totalUnits < CAP_UNITS) {
        const result = M.krakenStep(state, rand, CAP_UNITS - totalUnits);
        if (!result) break;
        totalUnits += result.paidUnits;
        add('krakenStep', { state, result });
      }
    } else if (kind === 'reef') {
      const positions = sup ? [] : base.triggerCells.slice(0, pearls).map(([r, y]) => y * M.REELS + r);
      const state = M.reefStart(pearls, sup, rand, positions);
      add('reefStart', { pearls, sup, state });
      while (state.respins > 0) {
        const result = M.reefRespin(state, rand);
        add('reefRespin', { state, result });
      }
      totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(M.reefTotal(state)));
    } else if (kind === 'vault') {
      const state = M.vaultStart(pearls, sup, rand);
      add('vaultStart', { pearls, sup, state });
      for (let choice = 0; choice < state.chests.length && !state.over; choice++) {
        const result = M.vaultPick(state, choice);
        add('vaultPick', { choice, result, state });
      }
      totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(M.vaultTotal(state)));
    }
  }
  add('final', { payoutUnits: totalUnits, baseUnits, bonusUnits: totalUnits - baseUnits, capped: totalUnits === config.maxWinUnits });
  return { id, events, payoutMultiplier: totalUnits };
}

function validateBase(base, config) {
  expect(base && typeof base === 'object', 'base outcome');
  M.evaluate(base.landed, null);
  equal(base.ev, M.evaluate(base.grid, null), 'base evaluation');
  const triggerCells = [];
  for (let r = 1; r < M.REELS; r++) for (let y = 0; y < M.ROWS; y++) if (base.grid[r][y] === M.S.WILD) triggerCells.push([r, y]);
  equal(base.triggerCells, triggerCells, 'base trigger cells'); equal(base.triggerCount, triggerCells.length, 'base trigger count');
  equal(base.fsAward, config.kind !== 'wilds' && triggerCells.length >= 3 ? M.FS_AWARD[Math.min(5, triggerCells.length)] : 0, 'base free spin award');
  const expected = clone(base.landed);
  if (base.attack !== null) {
    expect(!config.buy && Array.isArray(base.attack), 'attack mode');
    const eligible = base.landed.slice(1).flat().filter(symbol => symbol !== M.S.WILD && symbol !== M.S.SCATTER).length;
    integer(base.attack.length, Math.min(2, eligible), Math.min(5, eligible), 'attack size');
    const seen = new Set();
    for (const cell of base.attack) {
      expect(Array.isArray(cell) && cell.length === 2, 'attack cell');
      const r = integer(cell[0], 1, 4, 'attack reel'), y = integer(cell[1], 0, 2, 'attack row');
      expect(!seen.has(r * 3 + y) && expected[r][y] !== M.S.WILD && expected[r][y] !== M.S.SCATTER, 'attack target');
      seen.add(r * 3 + y); expected[r][y] = M.S.WILD;
    }
  }
  equal(base.grid, expected, 'attack result');
  if (config.buy) integer(base.triggerCount, config.kind === 'wilds' ? 6 : 3, config.kind === 'wilds' ? 6 : 5, 'purchased wild count');
}

function validateKrakenStart(event, pearls, sup) {
  const state = event.state;
  const expected = M.krakenStart(pearls, false, () => 0);
  if (sup) {
    const preset = state.preset;
    expect(Array.isArray(preset) && preset.length === 3, 'super preset');
    integer(preset[0], 1, 4, 'preset reel'); integer(preset[1], 0, 2, 'preset row');
    equal(preset[2], M.TUNE.superPreset, 'preset multiplier');
    expected.sticky[preset[0]][preset[1]] = preset[2]; expected.preset = preset;
    expected.left += M.TUNE.superSpins;
  }
  equal(state, expected, 'Kraken initial state');
}

function validateKrakenStep(event, previous, totalUnits) {
  const result = event.result, state = event.state, expected = clone(previous);
  expect(previous.left > 0 && totalUnits < CAP_UNITS, 'Kraken continuation');
  expect(result && Array.isArray(result.newWilds), 'Kraken result');
  M.evaluate(result.grid, null);
  equal(result.landed, result.grid, 'free spin landed board');
  const seen = new Set();
  for (const item of result.newWilds) {
    expect(Array.isArray(item) && item.length === 3, 'new wild');
    const r = integer(item[0], 1, 4, 'wild reel'), y = integer(item[1], 0, 2, 'wild row');
    expect(M.WILD_MULTS.some(pair => pair[0] === item[2]), 'new multiplier');
    expect(!seen.has(r * 3 + y) && !previous.sticky[r][y] && result.grid[r][y] === M.S.WILD, 'new wild position');
    seen.add(r * 3 + y); expected.sticky[r][y] = item[2];
  }
  for (let r = 0; r < M.REELS; r++) for (let y = 0; y < M.ROWS; y++) {
    expect((result.grid[r][y] === M.S.WILD) === !!expected.sticky[r][y], 'sticky position');
  }
  const rage = previous.rage + result.newWilds.length, awaken = Math.floor(rage / M.RAGE_MAX);
  expected.rage = rage % M.RAGE_MAX;
  for (const col of expected.sticky) for (let y = 0; y < col.length; y++) if (col[y]) col[y] += awaken;
  equal(result.awaken, awaken, 'rage awakening');
  equal(result.extra, awaken * M.RAGE_SPINS, 'rage spin award');
  equal(result.mults, expected.sticky, 'sticky multipliers');
  equal(result.ev, M.evaluate(result.grid, expected.sticky), 'free spin evaluation');
  equal(result.retrigger, result.ev.scatterCount >= 3 ? M.FS_RETRIGGER : 0, 'scatter retrigger');
  expected.played++; expected.left--;
  const remaining = CAP_UNITS - totalUnits, paidUnits = Math.min(result.ev.totalUnits, remaining);
  expected.totalUnits += paidUnits;
  const extraAdded = Math.min(result.extra, M.FS_MAX_SPINS - expected.played - expected.left);
  expected.left += extraAdded;
  const retriggerAdded = Math.min(result.retrigger, M.FS_MAX_SPINS - expected.played - expected.left);
  expected.left += retriggerAdded;
  const capped = paidUnits === remaining;
  if (capped) expected.left = 0;
  equal(result.paidUnits, paidUnits, 'free spin paid units'); equal(result.capped, capped, 'Kraken cap');
  equal(result.extraAdded, extraAdded, 'rage added spins'); equal(result.retriggerAdded, retriggerAdded, 'scatter added spins');
  equal(state, expected, 'Kraken next state');
  return totalUnits + paidUnits;
}

function validPearl(cell, level, allowGold) {
  expect(cell && typeof cell === 'object', 'Reef pearl');
  if (cell.kind === 'gold') equal(cell, { kind: 'gold', v: 0 }, 'gold pearl');
  else if (cell.kind === 'cash') expect(M.REEF_VALUES.some(pair => typeof pair[0] === 'number' && pair[0] * level === cell.v), 'cash pearl value');
  else expect(['mini', 'minor', 'major'].includes(cell.kind) && cell.v === M.JACKPOT[cell.kind.toUpperCase()], 'fixed pearl prize');
  expect(allowGold || cell.kind !== 'gold', 'initial gold pearl');
}

function validateReefStart(event, pearls, sup, base) {
  const state = event.state, level = M.TUNE.reefLevel[pearls] * (sup ? M.TUNE.reefSuper : 1);
  expect(state && Array.isArray(state.cells) && state.cells.length === 15, 'Reef initial cells');
  equal(state.lvl, level, 'Reef level'); equal(state.respins, 3, 'initial respins'); equal(state.grand, false, 'initial full board');
  equal(state.cells.filter(Boolean).length, pearls + (sup ? 2 : 0), 'initial pearl count');
  for (const cell of state.cells) if (cell) validPearl(cell, level, false);
  if (!sup) for (const [r, y] of base.triggerCells.slice(0, pearls)) expect(!!state.cells[y * 5 + r], 'carried trigger');
}

function validateReefStep(event, previous) {
  const state = event.state, result = event.result;
  expect(previous.respins > 0 && Array.isArray(state.cells) && state.cells.length === 15, 'Reef continuation');
  expect(result && Array.isArray(result.landed), 'Reef result');
  const landed = [];
  for (let i = 0; i < 15; i++) if (!previous.cells[i] && state.cells[i]) landed.push(i);
  equal(result.landed, landed, 'new pearl positions');
  const gold = landed.filter(i => state.cells[i].kind === 'gold').length;
  equal(result.gold, gold, 'gold count');
  const factor = Math.pow(2, gold);
  for (let i = 0; i < 15; i++) {
    const before = previous.cells[i], after = state.cells[i];
    if (before) equal(after, before.kind === 'cash' ? { kind: 'cash', v: before.v * factor } : before, 'held pearl');
    else if (after) validPearl(after.kind === 'cash' ? { kind: 'cash', v: after.v / factor } : after, state.lvl, true);
  }
  const full = state.cells.every(Boolean);
  equal(result.full, full, 'full Reef result'); equal(state.grand, full, 'full Reef state');
  equal(state.respins, full ? 0 : landed.length ? 3 : previous.respins - 1, 'remaining respins');
  equal(state.lvl, previous.lvl, 'held Reef level');
}

function validateVaultStart(event, pearls, sup) {
  const state = event.state;
  expect(state && Array.isArray(state.chests) && state.chests.length === 12, 'Vault chests');
  equal(state.open, new Array(12).fill(false), 'initial open chests');
  equal(state.lives, pearls - 1, 'initial lives'); equal(state.coins, 0, 'initial coins');
  equal(state.mult, (pearls === 5 ? 3 : 1) * (sup ? 2 : 1), 'initial multiplier');
  equal(state.over, false, 'initial Vault end'); equal(state.picks, 0, 'initial picks');
  const counts = { coin: 0, mult: 0, life: 0, kraken: 0 };
  for (const chest of state.chests) {
    expect(chest && Object.hasOwn(counts, chest.kind), 'chest kind'); counts[chest.kind]++;
    if (chest.kind === 'coin') expect(M.VAULT_COIN.some(pair => Math.round(pair[0] * M.TUNE.vaultCoin) === chest.v), 'chest value');
    else if (chest.kind === 'mult') equal(chest.v, sup ? 2 : 1, 'chest multiplier');
  }
  equal(counts, { coin: 7, mult: 1, life: 1, kraken: 3 }, 'chest composition');
}

function validateBook(book, options) {
  expect(book && typeof book === 'object', 'book');
  integer(book.id, 0, Number.MAX_SAFE_INTEGER, 'book id');
  integer(book.payoutMultiplier, 0, CAP_UNITS, 'book payout');
  expect(Array.isArray(book.events) && book.events.length >= 2 && book.events.length <= 256, 'book events');
  expect(Buffer.byteLength(JSON.stringify(book)) < MAX_BOOK_BYTES, 'book byte size');
  for (let i = 0; i < book.events.length; i++) equal(book.events[i].index, i, 'event index');
  const first = book.events[0], last = book.events[book.events.length - 1];
  equal(first.type, 'round', 'first event'); equal(first.schema, SCHEMA, 'schema');
  const config = mode(first.mode);
  integer(book.payoutMultiplier, 0, config.maxWinUnits, 'mode payout');
  if (options && options.mode) equal(first.mode, typeof options.mode === 'string' ? options.mode : options.mode.name, 'expected mode');
  equal(first.kind, config.kind, 'bonus mode');
  validateBase(first.base, config);
  const base = first.base, pearls = Math.min(5, base.triggerCount), baseUnits = Math.min(config.maxWinUnits, base.ev.totalUnits);
  let totalUnits = baseUnits, cursor = 1, kind = config.kind, sup = false;
  const next = type => {
    const event = book.events[cursor++];
    expect(event && event.type === type, type + ' event sequence');
    return event;
  };
  if (base.fsAward && totalUnits < CAP_UNITS) {
    if (kind === 'wheel') {
      const event = next('wheel'), segment = integer(event.segment, 0, M.WHEEL.length - 1, 'wheel segment');
      equal(event.result, M.WHEEL[segment], 'wheel result');
      kind = event.result.kind; sup = !!event.result.sup;
      if (kind === 'cash') totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(event.result.v));
    }
    if (kind !== 'cash') {
      const start = next(kind + 'Start');
      equal(start.pearls, pearls, 'feature pearls'); equal(start.sup, sup, 'super feature');
      let state = start.state;
      if (kind === 'kraken') {
        validateKrakenStart(start, pearls, sup);
        while (state.left && totalUnits < CAP_UNITS) {
          const event = next('krakenStep'); totalUnits = validateKrakenStep(event, state, totalUnits); state = event.state;
        }
      } else if (kind === 'reef') {
        validateReefStart(start, pearls, sup, base);
        while (state.respins > 0) {
          const event = next('reefRespin'); validateReefStep(event, state); state = event.state;
        }
        totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(M.reefTotal(state)));
      } else if (kind === 'vault') {
        validateVaultStart(start, pearls, sup);
        while (!state.over) {
          const event = next('vaultPick'), expected = clone(state);
          equal(event.choice, state.picks, 'canonical chest choice');
          const result = M.vaultPick(expected, event.choice);
          equal(event.result, result, 'chest reveal'); equal(event.state, expected, 'Vault next state'); state = event.state;
        }
        totalUnits = Math.min(CAP_UNITS, totalUnits + M.toUnits(M.vaultTotal(state)));
      }
    }
  }
  equal(cursor, book.events.length - 1, 'complete event sequence');
  equal(last.type, 'final', 'final event'); equal(last.payoutUnits, totalUnits, 'final payout');
  equal(last.baseUnits, baseUnits, 'final base payout'); equal(last.bonusUnits, totalUnits - baseUnits, 'final bonus payout');
  equal(last.capped, totalUnits === config.maxWinUnits, 'final cap'); equal(book.payoutMultiplier, totalUnits, 'book final payout');
  return book;
}

function maxWinBook(name, id) {
  const config = mode(name), tape = [];
  const weighted = pairs => value => {
    const total = pairs.reduce((sum, pair) => sum + Math.round(pair[1] * 10000), 0);
    let start = 0;
    for (const [item, weight] of pairs) {
      const width = Math.round(weight * 10000);
      if (item === value && width) { tape.push((start + width / 2) / total); return; }
      start += width;
    }
    throw new RangeError('Unreachable witness value');
  };
  const grid = (board, weights) => {
    for (let r = 0; r < 5; r++) {
      let scatter = false;
      for (const symbol of board[r]) {
        weighted(weights[r].map((weight, value) => [value, scatter && value === M.S.SCATTER ? 0 : weight]))(symbol);
        if (symbol === M.S.SCATTER) scatter = true;
      }
    }
  };
  const shuffle = size => { for (let i = size - 1; i > 0; i--) tape.push((i + 0.5) / (i + 1)); };
  grid(config.buy ? Array.from({ length: 5 }, () => [6, 6, 6]) : [[6, 6, 6], [7, 7, 6], [7, 7, 7], [6, 6, 6], [6, 6, 6]], config.buy ? M.BUY_WEIGHTS : config.ante ? M.ANTE_WEIGHTS : M.BASE_WEIGHTS);
  if (config.buy) {
    if (config.kind !== 'wilds') weighted(M.BUY_SCATTERS)(5);
    shuffle(12);
  } else tape.push(0.5);
  let kind = config.kind;
  if (kind === 'wheel') { weighted(M.WHEEL.map((item, index) => [index, item.w]))(0); kind = 'kraken'; }
  if (kind === 'kraken') {
    grid([[8, 6, 6], [8, 7, 7], [8, 7, 7], [8, 7, 7], [8, 7, 7]], M.FS_WEIGHTS);
    for (let i = 0; i < 8; i++) weighted(M.WILD_MULTS)(5);
  } else if (kind === 'reef') {
    shuffle(15);
    for (let i = 0; i < 5; i++) weighted(M.REEF_VALUES.filter(pair => pair[0] !== 'GOLD'))(15);
    for (let i = 0; i < 10; i++) { tape.push(0); weighted(M.REEF_VALUES)(i < 5 ? 'GOLD' : 15); }
  } else if (kind === 'vault') {
    for (let i = 0; i < 7; i++) weighted(M.VAULT_COIN)(250);
    shuffle(12);
  }
  let cursor = 0;
  const book = generateBook(() => {
    if (cursor >= tape.length) throw new Error('Witness random tape exhausted');
    return tape[cursor++];
  }, { mode: name, id });
  equal(cursor, tape.length, 'witness random consumption');
  equal(book.payoutMultiplier, config.maxWinUnits, 'witness maximum payout');
  validateBook(book, { mode: name });
  return book;
}

module.exports = Object.freeze({ SCHEMA, CAP_UNITS, MAX_BOOK_BYTES, MODES, mode, generateBook, validateBook, maxWinBook });

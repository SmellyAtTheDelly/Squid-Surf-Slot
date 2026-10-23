const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../math/model.js');

const PAY_UNITS = [[6, 20, 60], [7, 25, 80], [12, 35, 100], [14, 40, 130], [25, 80, 260], [40, 130, 400], [65, 200, 650]];
const SCATTER_UNITS = [0, 0, 0, 200, 1000, 5000];

function singleWayGrid(sym, len) {
  return Array.from({ length: 5 }, (_, r) => {
    const filler = (sym + r + 1) % 7;
    return [r < len ? sym : filler, filler, filler];
  });
}

function assertGrid(grid) {
  assert.equal(grid.length, 5);
  for (const col of grid) {
    assert.equal(col.length, 3);
    assert.ok(col.every(s => Number.isInteger(s) && s >= 0 && s <= 8));
    assert.ok(col.filter(s => s === M.S.SCATTER).length <= 1);
  }
  assert.ok(!grid[0].includes(M.S.WILD));
}

function oracle(grid, mults) {
  const wins = [];
  for (let sym = 0; sym < 7; sym++) {
    const paths = [];
    for (let way = 0; way < 243; way++) {
      let code = way;
      const rows = [];
      for (let r = 0; r < 5; r++) {
        rows.push(code % 3);
        code = Math.floor(code / 3);
      }
      let len = 0;
      while (len < 5 && (grid[len][rows[len]] === sym || grid[len][rows[len]] === M.S.WILD)) len++;
      if (len >= 3) paths.push(rows.slice(0, len));
    }
    if (!paths.length) continue;
    const len = Math.max(...paths.map(rows => rows.length));
    const distinct = new Map(paths.filter(rows => rows.length === len).map(rows => [rows.join(','), rows]));
    let units = 0, multSum = 0;
    const cells = new Set();
    for (const rows of distinct.values()) {
      let mult = 0;
      for (let r = 0; r < rows.length; r++) {
        if (grid[r][rows[r]] === M.S.WILD && mults) mult += mults[r][rows[r]];
        cells.add(r + ',' + rows[r]);
      }
      mult = Math.max(1, mult);
      units += PAY_UNITS[sym][len - 3] * mult;
      multSum += mult;
    }
    wins.push({ sym, len, ways: distinct.size, mult: multSum / distinct.size, units, cells: Array.from(cells).sort() });
  }
  const scatterCells = [];
  grid.forEach((col, r) => col.forEach((sym, y) => { if (sym === M.S.SCATTER) scatterCells.push([r, y]); }));
  const scatterUnits = SCATTER_UNITS[scatterCells.length];
  return { wins, scatterCells, scatterUnits, totalUnits: wins.reduce((sum, win) => sum + win.units, scatterUnits) };
}

function assertEvaluation(grid, mults) {
  const expected = oracle(grid, mults);
  const actual = M.evaluate(grid, mults);
  assert.equal(actual.totalUnits, expected.totalUnits);
  assert.equal(actual.total, expected.totalUnits / 100);
  assert.equal(actual.scatterUnits, expected.scatterUnits);
  assert.equal(actual.scatterPay, expected.scatterUnits / 100);
  assert.equal(actual.scatterCount, expected.scatterCells.length);
  assert.deepEqual(actual.scatterCells, expected.scatterCells);
  assert.equal(actual.wins.length, expected.wins.length);
  for (const win of expected.wins) {
    const found = actual.wins.find(entry => entry.sym === win.sym);
    assert.ok(found);
    assert.equal(found.len, win.len);
    assert.equal(found.ways, win.ways);
    assert.equal(found.mult, win.mult);
    assert.equal(found.units, win.units);
    assert.equal(found.amount, win.units / 100);
    assert.deepEqual(found.cells.map(cell => cell.join(',')).sort(), win.cells);
  }
  for (let i = 1; i < actual.wins.length; i++) assert.ok(actual.wins[i - 1].units >= actual.wins[i].units);
  return actual;
}

test('public paytable matches the specified seven symbol payouts', () => {
  assert.deepEqual(M.PAY_UNITS, PAY_UNITS);
  assert.deepEqual(M.PAYS, PAY_UNITS.map(pays => pays.map(units => units / 100)));
  assert.equal(M.REELS, 5);
  assert.equal(M.ROWS, 3);
  assert.equal(new Set(Object.values(M.S)).size, 9);
});

for (let sym = 0; sym < 7; sym++) {
  for (let len = 3; len <= 5; len++) {
    test(M.NAMES[sym] + ' pays the stated single-way amount for ' + len + ' reels', () => {
      const ev = assertEvaluation(singleWayGrid(sym, len));
      assert.equal(ev.wins.length, 1);
      assert.equal(ev.wins[0].ways, 1);
      assert.equal(ev.totalUnits, PAY_UNITS[sym][len - 3]);
    });
  }
}

for (const len of [0, 1, 2]) {
  test('matching fewer than three reels pays nothing at length ' + len, () => {
    assert.equal(assertEvaluation(singleWayGrid(M.S.J, len)).totalUnits, 0);
  });
}

for (const len of [3, 4, 5]) {
  test('all matching positions count independently across ' + len + ' reels', () => {
    const grid = Array.from({ length: 5 }, (_, r) => new Array(3).fill(r < len ? M.S.ANCHOR : r - len));
    const ev = assertEvaluation(grid);
    assert.equal(ev.wins[0].ways, 3 ** len);
    assert.equal(ev.totalUnits, PAY_UNITS[M.S.ANCHOR][len - 3] * 3 ** len);
  });
}

test('multiple symbols pay together and only their longest available matches pay', () => {
  const ev = assertEvaluation(Array.from({ length: 5 }, () => [M.S.J, M.S.Q, M.S.K]));
  assert.equal(ev.totalUnits, 240);
  assert.deepEqual(ev.wins.map(win => win.len), [5, 5, 5]);
  assert.deepEqual(ev.wins.map(win => win.sym), [M.S.K, M.S.Q, M.S.J]);
});

test('wins cannot start on a later reel or cross a missing reel', () => {
  assert.equal(assertEvaluation([[0, 0, 0], [1, 1, 1], [2, 2, 2], [2, 2, 2], [2, 2, 2]]).totalUnits, 0);
  assert.equal(assertEvaluation([[0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [0, 0, 0]]).totalUnits, 0);
});

test('different row counts multiply the number of ways', () => {
  const ev = assertEvaluation([[0, 0, 1], [0, 2, 2], [0, 0, 0], [3, 3, 3], [4, 4, 4]]);
  assert.equal(ev.wins[0].ways, 6);
  assert.equal(ev.totalUnits, 36);
});

test('ordinary wilds substitute without creating a separate wild payout', () => {
  const ev = assertEvaluation([[0, 1, 2], [7, 3, 3], [7, 4, 4], [5, 5, 5], [6, 6, 6]]);
  assert.equal(ev.totalUnits, 25);
  assert.equal(ev.wins.length, 3);
  assert.ok(ev.wins.every(win => win.sym < M.S.WILD));
});

test('wild multipliers add per way and ways without multiplied wilds retain x1', () => {
  const grid = [[0, 1, 2], [0, 7, 1], [0, 7, 2], [3, 3, 3], [5, 5, 5]];
  const mults = M.emptySticky();
  mults[1][1] = 2;
  mults[2][1] = 3;
  const ev = assertEvaluation(grid, mults);
  assert.equal(ev.wins.find(win => win.sym === M.S.J).units, 66);
  assert.equal(ev.wins.find(win => win.sym === M.S.Q).units, 56);
  assert.equal(ev.wins.find(win => win.sym === M.S.K).units, 84);
  assert.equal(ev.totalUnits, 206);
});

test('a zero multiplier wild remains a normal substitute beside multiplied wilds', () => {
  const grid = [[0, 1, 2], [7, 3, 3], [7, 4, 4], [5, 5, 5], [6, 6, 6]];
  const mults = M.emptySticky();
  mults[2][0] = 5;
  assert.equal(assertEvaluation(grid, mults).totalUnits, 125);
});

test('the evaluator preserves raw wins above the round cap for settlement', () => {
  const grid = [[6, 6, 6], [7, 7, 7], [7, 7, 7], [7, 7, 7], [7, 7, 7]];
  const mults = [[0, 0, 0], [5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]];
  assert.equal(assertEvaluation(grid, mults).totalUnits, 3159000);
});

for (let count = 0; count <= 5; count++) {
  test('scatter-only payout for ' + count + ' pearls', () => {
    const grid = Array.from({ length: 5 }, (_, r) => [r < count ? M.S.SCATTER : r, r, r]);
    const ev = assertEvaluation(grid);
    assert.equal(ev.totalUnits, SCATTER_UNITS[count]);
    assert.equal(ev.wins.length, 0);
  });
}

test('scatters add to ways but cannot substitute for a regular symbol', () => {
  const grid = [[0, 8, 1], [0, 8, 2], [0, 8, 3], [4, 4, 4], [5, 5, 5]];
  assert.equal(assertEvaluation(grid).totalUnits, 206);
});

test('evaluation leaves its inputs untouched and returns independent cell coordinates', () => {
  const grid = [[0, 1, 2], [7, 3, 3], [7, 4, 4], [5, 5, 5], [6, 6, 6]];
  const mults = M.emptySticky();
  mults[1][0] = 2;
  const original = structuredClone({ grid, mults });
  const ev = assertEvaluation(grid, mults);
  assert.deepEqual({ grid, mults }, original);
  ev.wins[0].cells[0][0] = 99;
  assert.deepEqual({ grid, mults }, original);
});

test('cloneGrid and emptySticky allocate independent columns and instances', () => {
  const first = M.emptySticky(), second = M.emptySticky(), clone = M.cloneGrid(first);
  first[0][0] = 4;
  assert.equal(first[1][0], 0);
  assert.equal(second[0][0], 0);
  assert.equal(clone[0][0], 0);
  assert.notEqual(clone[1], first[1]);
});

test('seeded random streams are reproducible and stay in the half-open unit interval', () => {
  const a = M.mulberry32(9876), b = M.mulberry32(9876), c = M.mulberry32(9877);
  let different = false;
  for (let i = 0; i < 10000; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
    if (value !== c()) different = true;
  }
  assert.ok(different);
});

test('weighted selection respects exact boundaries and ignores zero weights', () => {
  const pairs = [['unused', 0], ['left', 2], ['right', 2], ['unused-end', 0]];
  assert.equal(M.pickWeighted(pairs, () => 0), 'left');
  assert.equal(M.pickWeighted(pairs, () => 0.5 - Number.EPSILON), 'left');
  assert.equal(M.pickWeighted(pairs, () => 0.5), 'right');
  assert.equal(M.pickWeighted(pairs, () => 1 - Number.EPSILON), 'right');
});

for (const name of ['BASE_WEIGHTS', 'ANTE_WEIGHTS', 'FS_WEIGHTS']) {
  test(name + ' generates legal grids at RNG boundaries and for seeded samples', () => {
    for (const value of [0, 1 - Number.EPSILON]) assertGrid(M.spinGrid(M[name], () => value));
    const rand = M.mulberry32(177);
    for (let i = 0; i < 500; i++) {
      const grid = M.spinGrid(M[name], rand);
      assertGrid(grid);
      assertEvaluation(grid);
    }
  });
}

test('scatter exclusion prevents pearls on the requested reels only', () => {
  const excluded = [true, false, true, false, true];
  const grid = M.spinGrid(M.BASE_WEIGHTS, () => 1 - Number.EPSILON, excluded);
  assertGrid(grid);
  grid.forEach((col, r) => assert.equal(col.includes(M.S.SCATTER), !excluded[r]));
});

for (const opts of [{}, { ante: true }, { buy: true, kind: 'vault' }, { buy: true, kind: 'wilds' }]) {
  test('baseSpin preserves presentation and payout invariants for ' + JSON.stringify(opts), () => {
    const rand = M.mulberry32(444), replay = M.mulberry32(444);
    let attacks = 0, bonuses = 0;
    for (let i = 0; i < 1000; i++) {
      const spin = M.baseSpin(rand, opts);
      assert.deepEqual(spin, M.baseSpin(replay, opts));
      assertGrid(spin.grid);
      assertGrid(spin.landed);
      assert.notEqual(spin.grid, spin.landed);
      const ev = assertEvaluation(spin.grid);
      assert.deepEqual(spin.ev, ev);
      assert.equal(spin.triggerCount, spin.grid.flat().filter(symbol => symbol === M.S.WILD).length);
      assert.equal(spin.triggerCells.length, spin.triggerCount);
      assert.equal(spin.fsAward, opts.kind === 'wilds' ? 0 : M.FS_AWARD[Math.min(5, spin.triggerCount)] || 0);
      if (spin.fsAward) bonuses++;
      const changed = new Set((spin.attack || []).map(cell => cell.join(',')));
      assert.equal(changed.size, (spin.attack || []).length);
      for (let r = 0; r < 5; r++) {
        assert.notEqual(spin.grid[r], spin.landed[r]);
        for (let y = 0; y < 3; y++) {
          if (changed.has(r + ',' + y)) {
            assert.ok(r > 0);
            assert.ok(spin.landed[r][y] !== M.S.SCATTER && spin.landed[r][y] !== M.S.WILD);
            assert.equal(spin.grid[r][y], M.S.WILD);
          } else assert.equal(spin.grid[r][y], spin.landed[r][y]);
        }
      }
      if (spin.attack) {
        attacks++;
        assert.ok(spin.attack.length <= 5);
      }
      if (opts.buy) {
        assert.equal(spin.attack, null);
        assert.ok(spin.triggerCount >= 3);
        if (opts.kind === 'wilds') assert.equal(spin.triggerCount, 6);
      }
    }
    if (opts.buy) assert.equal(bonuses, opts.kind === 'wilds' ? 0 : 1000);
    else assert.ok(attacks > 0);
  });
}

test('the independent 243-way oracle agrees across seeded multiplier grids', () => {
  const rand = M.mulberry32(2501);
  for (let i = 0; i < 1000; i++) {
    const grid = M.spinGrid(M.FS_WEIGHTS, rand);
    const mults = grid.map(col => col.map(sym => sym === M.S.WILD ? Math.floor(rand() * 61) : 0));
    assertEvaluation(grid, mults);
  }
});

test('the evaluator rejects malformed grids and illegal symbol placement', () => {
  const valid = singleWayGrid(M.S.J, 3);
  const invalid = [null, [], valid.slice(0, 4), [...valid, [0, 0, 0]], valid.map(col => col.slice(0, 2))];
  for (const value of [-1, 9, 0.5, NaN, Infinity, '0']) {
    const grid = M.cloneGrid(valid);
    grid[2][1] = value;
    invalid.push(grid);
  }
  const firstWild = M.cloneGrid(valid);
  firstWild[0][0] = M.S.WILD;
  invalid.push(firstWild);
  const doubleScatter = M.cloneGrid(valid);
  doubleScatter[2][0] = doubleScatter[2][1] = M.S.SCATTER;
  invalid.push(doubleScatter);
  for (const grid of invalid) assert.throws(() => M.evaluate(grid));
});

test('the evaluator rejects malformed, fractional, misplaced, and oversized multipliers', () => {
  const grid = singleWayGrid(M.S.J, 3);
  grid[1][0] = M.S.WILD;
  const invalid = [[], [[0]], M.emptySticky().slice(0, 4)];
  for (const value of [-1, 0.5, 61, NaN, Infinity, '2']) {
    const mults = M.emptySticky();
    mults[1][0] = value;
    invalid.push(mults);
  }
  const misplaced = M.emptySticky();
  misplaced[0][0] = 2;
  invalid.push(misplaced);
  for (const mults of invalid) assert.throws(() => M.evaluate(grid, mults));
  const max = M.emptySticky();
  max[1][0] = 60;
  assert.equal(assertEvaluation(grid, max).totalUnits, 360);
});

test('browser export works without CommonJS and crypto values use all 32 random bits', () => {
  const source = fs.readFileSync(path.join(__dirname, '../math/model.js'), 'utf8');
  for (const value of [0, 1, 2147483648, 4294967295]) {
    const context = { window: {}, crypto: { getRandomValues(array) { array[0] = value; return array; } } };
    vm.runInNewContext(source, context);
    assert.equal(context.window.SlotMath.cryptoRand(), value / 4294967296);
  }
});

test('production random generation fails closed without crypto support', () => {
  const source = fs.readFileSync(path.join(__dirname, '../math/model.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.throws(() => context.window.SlotMath.cryptoRand());
});

test('secure integer selection rejects the incomplete remainder bucket', () => {
  const source = fs.readFileSync(path.join(__dirname, '../math/model.js'), 'utf8');
  const words = [4294967292, 4294967295, 83];
  let calls = 0;
  const context = { window: {}, crypto: { getRandomValues(array) { assert.ok(calls < words.length); array[0] = words[calls++]; return array; } } };
  vm.runInNewContext(source, context);
  const api = context.window.SlotMath;
  assert.equal(api.randomIndex(84, api.cryptoRand), 83);
  assert.equal(calls, 3);
});

test('secure integer selection handles a full 32-bit range and power-of-two ranges', () => {
  const source = fs.readFileSync(path.join(__dirname, '../math/model.js'), 'utf8');
  let calls = 0;
  const context = { window: {}, crypto: { getRandomValues(array) { calls++; array[0] = 4294967295; return array; } } };
  vm.runInNewContext(source, context);
  const api = context.window.SlotMath;
  for (const size of [1, 2, 4, 256, 65536, 4294967296]) assert.equal(api.randomIndex(size, api.cryptoRand), size - 1);
  assert.equal(calls, 6);
});

test('secure random failures propagate without falling back to another source', () => {
  const source = fs.readFileSync(path.join(__dirname, '../math/model.js'), 'utf8');
  const failure = new Error('entropy unavailable');
  const context = { window: {}, crypto: { getRandomValues() { throw failure; } } };
  vm.runInNewContext(source, context);
  const api = context.window.SlotMath;
  assert.throws(() => api.cryptoRand(), error => error === failure);
  assert.throws(() => api.randomIndex(3, api.cryptoRand), error => error === failure);
  assert.throws(() => api.baseSpin(api.cryptoRand), error => error === failure);
});

test('integer selection rejects invalid ranges and random source values', () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, '3', 4294967297]) assert.throws(() => M.randomIndex(size, () => 0));
  for (const value of [-1, 1, Infinity, NaN, '0', undefined]) assert.throws(() => M.randomIndex(5, () => value));
  assert.throws(() => M.randomIndex(5, null));
  for (const size of [1, 3, 84, 1000000, 4294967296]) {
    assert.equal(M.randomIndex(size, () => 0), 0);
    assert.equal(M.randomIndex(size, () => 1 - Number.EPSILON), size - 1);
  }
});

test('public configuration is recursively frozen and cannot drift after cached selections', () => {
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(visit);
  };
  visit(M);
  assert.equal(Reflect.set(M.PAYS[0], 0, 999), false);
  assert.equal(Reflect.set(M.TUNE.reefLevel, 3, 999), false);
  assert.equal(Reflect.set(M.BASE_WEIGHTS[0], 0, 999), false);
  assert.equal(Reflect.set(M, 'MAX_WIN', 999), false);
  assert.equal(M.PAYS[0][0], 0.06);
  assert.equal(M.TUNE.reefLevel[3], 1);
  assert.equal(M.BASE_WEIGHTS[0][0], 30);
  assert.equal(M.MAX_WIN, 5000);
});

test('mutable external weight tables are not hidden behind stale cached probabilities', () => {
  for (const freezeOuter of [false, true]) {
    const pairs = [['left', 1], ['right', 1]];
    if (freezeOuter) Object.freeze(pairs);
    assert.equal(M.pickWeighted(pairs, () => 0.25), 'left');
    pairs[0][1] = 0;
    assert.equal(M.pickWeighted(pairs, () => 0.25), 'right');
  }
});

test('weighted selection rejects empty, malformed, negative, and nonrepresentable tables', () => {
  const tables = [[], [['a', 0]], [['a', -1]], [['a', NaN]], [['a', Infinity]], [['a', '1']], [['a']], [['a', 1, 2]], [['a', 0.00001]], [['a', 500000]]];
  for (const pairs of tables) assert.throws(() => M.pickWeighted(pairs, () => 0));
});

test('Squad Attack applies one random placement even when that placement creates no win', () => {
  const rolls = [];
  for (let r = 0; r < 5; r++) {
    const weights = M.BASE_WEIGHTS[r];
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const lower = weights.slice(0, r).reduce((sum, weight) => sum + weight, 0);
    for (let y = 0; y < 3; y++) rolls.push((lower + weights[r] / 2) / total);
  }
  rolls.push(0, 0, ...new Array(11).fill(1 - Number.EPSILON));
  let calls = 0;
  const rand = () => {
    assert.ok(calls < rolls.length, 'attack retried a rejected payout');
    return rolls[calls++];
  };
  const spin = M.baseSpin(rand);
  assert.deepEqual(spin.attack, [[1, 0], [1, 1]]);
  assert.equal(spin.ev.totalUnits, 0);
  assert.equal(calls, rolls.length);
});

test('baseSpin rejects simultaneous ante and buy before consuming randomness', () => {
  let calls = 0;
  assert.throws(() => M.baseSpin(() => { calls++; return 0; }, { ante: true, buy: true }));
  assert.equal(calls, 0);
});

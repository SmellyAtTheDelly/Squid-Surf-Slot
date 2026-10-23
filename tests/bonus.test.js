const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math/model.js');

function sequence(values, fallback) {
  let i = 0;
  const rand = () => {
    if (i < values.length) return values[i++];
    assert.notEqual(fallback, undefined, 'random sequence exhausted');
    i++;
    return fallback;
  };
  rand.calls = () => i;
  return rand;
}

function freeSpinRolls(grid) {
  const rolls = [];
  for (let r = 0; r < 5; r++) {
    let exclude = -1;
    for (const sym of grid[r]) {
      const weights = M.FS_WEIGHTS[r];
      const total = weights.reduce((sum, weight, i) => sum + (i === exclude ? 0 : weight), 0);
      const lower = weights.slice(0, sym).reduce((sum, weight, i) => sum + (i === exclude ? 0 : weight), 0);
      rolls.push((lower + weights[sym] / 2) / total);
      if (sym === M.S.SCATTER) exclude = M.S.SCATTER;
    }
  }
  return rolls;
}

function blankReef(cells) {
  return { cells: [...cells, ...new Array(15 - cells.length).fill(null)], respins: 3, grand: false, lvl: 1 };
}

function vaultState(chests, lives, mult) {
  return { chests, open: chests.map(() => false), lives, coins: 0, mult, over: false, picks: 0 };
}

for (const pearls of [3, 4, 5]) {
  for (const sup of [false, true]) {
    test('Kraken starts correctly for ' + pearls + ' pearls and super=' + sup, () => {
      const a = M.krakenStart(pearls, sup, M.mulberry32(17));
      const b = M.krakenStart(pearls, sup, M.mulberry32(17));
      assert.deepEqual(a, b);
      assert.equal(a.left, { 3: 8, 4: 10, 5: 13 }[pearls] + (sup ? M.TUNE.superSpins : 0));
      assert.equal(a.rage, 0);
      assert.deepEqual(a.sticky[0], [0, 0, 0]);
      const active = a.sticky.flat().filter(Boolean);
      assert.equal(active.length, sup ? 1 : 0);
      if (sup) {
        assert.equal(active[0], M.TUNE.superPreset);
        const [r, y, mult] = a.preset;
        assert.ok(r >= 1 && r < 5 && y >= 0 && y < 3);
        assert.equal(a.sticky[r][y], mult);
      }
      assert.notEqual(a.sticky, b.sticky);
    });
  }
}

test('the published starting-spin and reef constants match the active model', () => {
  assert.deepEqual(M.FS_AWARD, M.TUNE.krakenSpins);
  assert.equal(M.REEF_LAND, M.TUNE.reefLand);
  assert.equal(M.RAGE_MAX, M.TUNE.rageMax);
  assert.equal(M.RAGE_SPINS, M.TUNE.rageSpins);
});

test('existing sticky wilds persist without counting as newly landed wilds', () => {
  const sticky = M.emptySticky();
  sticky[1][1] = 3;
  const ks = { rage: 2 };
  const spin = M.freeSpin(() => 0, sticky, ks);
  assert.equal(spin.grid[1][1], M.S.WILD);
  assert.equal(spin.landed[1][1], M.S.WILD);
  assert.equal(sticky[1][1], 3);
  assert.equal(spin.mults[1][1], 3);
  assert.equal(spin.newWilds.length, 0);
  assert.equal(spin.awaken, 0);
  assert.equal(spin.extra, 0);
  assert.equal(ks.rage, 2);
  spin.mults[1][1] = 99;
  assert.equal(sticky[1][1], 3);
});

test('new wilds lock their multipliers before rage boosts and payout evaluation', () => {
  const grid = [[0, 1, 2], [7, 0, 1], [7, 2, 3], [7, 4, 5], [7, 6, 0]];
  const rand = sequence([...freeSpinRolls(grid), 0, 0.7, 0.95, 0]);
  const sticky = M.emptySticky();
  sticky[1][2] = 3;
  const ks = { rage: 2 };
  const spin = M.freeSpin(rand, sticky, ks);
  assert.deepEqual(spin.newWilds, [[1, 0, 2], [2, 0, 3], [3, 0, 5], [4, 0, 2]]);
  assert.equal(spin.awaken, 2);
  assert.equal(spin.extra, 4);
  assert.equal(ks.rage, 0);
  assert.equal(sticky[1][2], 5);
  assert.deepEqual([sticky[1][0], sticky[2][0], sticky[3][0], sticky[4][0]], [4, 5, 7, 4]);
  assert.deepEqual(spin.ev, M.evaluate(spin.grid, sticky));
  assert.equal(spin.ev.wins.find(win => win.sym === M.S.J).units, 6120);
});

test('free spins without a rage state still lock multipliers', () => {
  const grid = [[0, 1, 2], [7, 0, 1], [2, 2, 3], [3, 4, 5], [4, 6, 0]];
  const sticky = M.emptySticky();
  const spin = M.freeSpin(sequence([...freeSpinRolls(grid), 0.95]), sticky);
  assert.equal(sticky[1][0], 5);
  assert.equal(spin.awaken, 0);
  assert.equal(spin.extra, 0);
});

for (const count of [2, 3, 4, 5]) {
  test('free-spin retrigger for ' + count + ' scatters', () => {
    const grid = Array.from({ length: 5 }, (_, r) => [r < count ? 8 : r, r, r]);
    const spin = M.freeSpin(sequence(freeSpinRolls(grid)), M.emptySticky(), { rage: 0 });
    assert.equal(spin.ev.scatterCount, count);
    assert.equal(spin.retrigger, count >= 3 ? 5 : 0);
  });
}

test('a sticky wild covering a generated pearl removes that pearl from retrigger counting', () => {
  const grid = [[8, 0, 0], [8, 1, 1], [8, 2, 2], [3, 3, 3], [4, 4, 4]];
  const sticky = M.emptySticky();
  sticky[1][0] = 2;
  const spin = M.freeSpin(sequence(freeSpinRolls(grid)), sticky, { rage: 0 });
  assert.equal(spin.ev.scatterCount, 2);
  assert.equal(spin.retrigger, 0);
  assert.equal(spin.landed[1][0], M.S.WILD);
});

test('Kraken completes its initial spins when no wilds or scatters land', () => {
  for (const pearls of [3, 4, 5]) {
    const expected = { 3: 8, 4: 10, 5: 13 }[pearls] * 14580;
    assert.equal(Math.round(M.playKraken(() => 0, pearls, false) * 100), expected);
  }
});

test('Kraken retriggers cannot exceed the sixty-spin round limit', () => {
  const grid = Array.from({ length: 5 }, () => [8, 0, 0]);
  const rolls = freeSpinRolls(grid);
  let calls = 0;
  const rand = () => rolls[calls++ % rolls.length];
  assert.equal(Math.round(M.playKraken(rand, 3, false) * 100), 415200);
  assert.equal(calls, 60 * 15);
});

test('seeded free spins preserve sticky state, legal grids, and rage accounting', () => {
  const rand = M.mulberry32(8181);
  for (let run = 0; run < 50; run++) {
    const ks = M.krakenStart(3 + run % 3, run % 2 === 0, rand);
    for (let i = 0; i < 20; i++) {
      const before = M.cloneGrid(ks.sticky), rage = ks.rage;
      const spin = M.freeSpin(rand, ks.sticky, ks);
      assert.equal(spin.awaken, Math.floor((rage + spin.newWilds.length) / M.TUNE.rageMax));
      assert.equal(ks.rage, (rage + spin.newWilds.length) % M.TUNE.rageMax);
      const fresh = new Map(spin.newWilds.map(([r, y, mult]) => [r + ',' + y, mult]));
      for (let r = 0; r < 5; r++) {
        assert.ok(spin.grid[r].filter(sym => sym === 8).length <= 1);
        for (let y = 0; y < 3; y++) {
          const initial = before[r][y] || fresh.get(r + ',' + y) || 0;
          assert.equal(ks.sticky[r][y], initial ? initial + spin.awaken : 0);
          if (ks.sticky[r][y]) assert.equal(spin.grid[r][y], M.S.WILD);
        }
      }
      assert.deepEqual(spin.mults, ks.sticky);
      assert.deepEqual(spin.grid[0].map(sym => sym === M.S.WILD), [false, false, false]);
    }
  }
});

for (const pearls of [3, 4, 5]) {
  for (const sup of [false, true]) {
    test('Reef starts correctly for ' + pearls + ' pearls and super=' + sup, () => {
      const positions = [0, 7, 14];
      const rs = M.reefStart(pearls, sup, () => 0, positions);
      assert.equal(rs.cells.length, 15);
      assert.equal(rs.cells.filter(Boolean).length, pearls + (sup ? 2 : 0));
      assert.equal(rs.respins, 3);
      assert.equal(rs.grand, false);
      assert.equal(rs.lvl, { 3: 1, 4: 3, 5: 7.5 }[pearls] * (sup ? 3 : 1));
      assert.ok(rs.cells.filter(Boolean).every(cell => cell.kind === 'cash' && cell.v === rs.lvl));
      positions.forEach(i => assert.ok(rs.cells[i]));
      assert.deepEqual(positions, [0, 7, 14]);
    });
  }
}

test('starting Reef pearls cannot be gold', () => {
  const rand = M.mulberry32(799);
  for (let i = 0; i < 1000; i++) {
    const rs = M.reefStart(3 + i % 3, i % 2 === 0, rand);
    assert.ok(rs.cells.every(cell => !cell || cell.kind !== 'gold'));
  }
});

test('empty Reef respins decrease from three to zero without changing locked pearls', () => {
  const rs = blankReef([{ kind: 'cash', v: 7 }, { kind: 'mini', v: 20 }]);
  const before = structuredClone(rs.cells);
  for (const left of [2, 1, 0]) {
    const result = M.reefRespin(rs, () => 0.99);
    assert.deepEqual(result, { landed: [], gold: 0, full: false });
    assert.equal(rs.respins, left);
    assert.deepEqual(rs.cells, before);
  }
  assert.equal(M.reefTotal(rs), 27);
});

test('any new Reef pearl restores three respins', () => {
  const rs = blankReef([{ kind: 'cash', v: 3 }]);
  rs.respins = 1;
  const result = M.reefRespin(rs, sequence([0, 0], 0.99));
  assert.deepEqual(result.landed, [1]);
  assert.equal(rs.respins, 3);
  assert.deepEqual(rs.cells[1], { kind: 'cash', v: 1 });
});

test('multiple gold pearls double all cash including new cash, but never jackpot pearls', () => {
  const rs = blankReef([{ kind: 'cash', v: 3 }, { kind: 'mini', v: 20 }, { kind: 'minor', v: 50 }, { kind: 'major', v: 150 }]);
  const result = M.reefRespin(rs, sequence([0, 0.999, 0, 0, 0, 0.999], 0.99));
  assert.deepEqual(result.landed, [4, 5, 6]);
  assert.equal(result.gold, 2);
  assert.equal(rs.cells[0].v, 12);
  assert.equal(rs.cells[5].v, 4);
  assert.equal(rs.cells[4].v, 0);
  assert.equal(rs.cells[6].v, 0);
  assert.deepEqual(rs.cells.slice(1, 4).map(cell => cell.v), [20, 50, 150]);
  assert.equal(M.reefTotal(rs), 236);
});

test('filling the Reef awards one Grand and ends respins immediately', () => {
  const rs = blankReef(Array.from({ length: 14 }, () => ({ kind: 'cash', v: 1 })));
  const result = M.reefRespin(rs, () => 0);
  assert.deepEqual(result, { landed: [14], gold: 0, full: true });
  assert.equal(rs.respins, 0);
  assert.equal(rs.grand, true);
  assert.equal(M.reefTotal(rs), 1015);
  assert.equal(M.reefTotal(rs), 1015);
});

test('playReef includes initial pearls, new pearls, and the Grand', () => {
  assert.equal(M.playReef(() => 0, 3, false), 1015);
  assert.equal(M.playReef(() => 0, 4, false), 1045);
  assert.equal(M.playReef(() => 0, 5, true), 1337.5);
});

for (const pearls of [3, 4, 5]) {
  for (const sup of [false, true]) {
    test('Vault starts correctly for ' + pearls + ' pearls and super=' + sup, () => {
      const a = M.vaultStart(pearls, sup, M.mulberry32(77));
      const b = M.vaultStart(pearls, sup, M.mulberry32(77));
      assert.deepEqual(a, b);
      assert.equal(a.chests.length, 12);
      assert.equal(a.chests.filter(chest => chest.kind === 'coin').length, 7);
      assert.equal(a.chests.filter(chest => chest.kind === 'kraken').length, 3);
      assert.equal(a.chests.filter(chest => chest.kind === 'life').length, 1);
      assert.equal(a.chests.filter(chest => chest.kind === 'mult').length, 1);
      assert.equal(a.chests.find(chest => chest.kind === 'mult').v, sup ? 2 : 1);
      assert.equal(a.lives, pearls - 1);
      assert.equal(a.mult, (pearls === 5 ? 3 : 1) * (sup ? 2 : 1));
      assert.equal(a.coins, 0);
      assert.equal(a.picks, 0);
      assert.equal(a.over, false);
      assert.ok(a.open.every(open => !open));
    });
  }
}

test('Vault coin, multiplier, extra life, and Kraken picks apply exactly once', () => {
  const chests = [{ kind: 'coin', v: 20 }, { kind: 'mult', v: 1 }, { kind: 'life' }, { kind: 'kraken' }, { kind: 'coin', v: 5 }, { kind: 'kraken' }];
  const vs = vaultState(chests, 2, 1);
  assert.equal(M.vaultPick(vs, 0).kind, 'coin');
  assert.equal(vs.coins, 20);
  const once = structuredClone(vs);
  assert.equal(M.vaultPick(vs, 0), null);
  assert.deepEqual(vs, once);
  M.vaultPick(vs, 1);
  assert.equal(vs.mult, 2);
  M.vaultPick(vs, 2);
  assert.equal(vs.lives, 3);
  M.vaultPick(vs, 3);
  assert.equal(vs.lives, 2);
  assert.equal(vs.over, false);
  M.vaultPick(vs, 4);
  assert.equal(vs.over, true);
  assert.equal(vs.picks, 5);
  assert.equal(M.vaultTotal(vs), 50);
  const ended = structuredClone(vs);
  assert.equal(M.vaultPick(vs, 5), null);
  assert.deepEqual(vs, ended);
});

test('Vault ends at zero lives even with coins remaining', () => {
  const vs = vaultState([{ kind: 'kraken' }, { kind: 'coin', v: 250 }], 1, 3);
  M.vaultPick(vs, 0);
  assert.equal(vs.lives, 0);
  assert.equal(vs.over, true);
  assert.equal(M.vaultTotal(vs), 0);
  assert.equal(M.vaultPick(vs, 1), null);
});

test('Vault pays every collected coin at the final multiplier independent of collection order', () => {
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
    const vs = vaultState([{ kind: 'coin', v: 20 }, { kind: 'coin', v: 5 }, { kind: 'mult', v: 2 }], 2, 2);
    order.forEach(i => M.vaultPick(vs, i));
    assert.equal(M.vaultTotal(vs), 100);
    assert.equal(vs.over, true);
  }
});

test('playVault matches stepwise resolution with the same seeded shuffled contents', () => {
  for (let seed = 0; seed < 100; seed++) {
    const pearls = 3 + seed % 3, sup = seed % 2 === 0;
    const vs = M.vaultStart(pearls, sup, M.mulberry32(seed));
    for (let i = 0; i < vs.chests.length && !vs.over; i++) M.vaultPick(vs, i);
    assert.equal(M.playVault(M.mulberry32(seed), pearls, sup), M.vaultTotal(vs));
  }
});

test('Wheel probabilities cover every weighted slice without gaps', () => {
  const total = M.WHEEL.reduce((sum, segment) => sum + segment.w, 0);
  let start = 0;
  M.WHEEL.forEach((segment, i) => {
    assert.ok(segment.w > 0);
    assert.equal(M.wheelSpin(() => (start + segment.w / 2) / total), i);
    assert.equal(M.wheelSpin(() => (start + 1e-8) / total), i);
    assert.equal(M.wheelSpin(() => (start + segment.w - 1e-8) / total), i);
    start += segment.w;
  });
  assert.equal(M.wheelSpin(() => 0), 0);
  assert.equal(M.wheelSpin(() => 1 - Number.EPSILON), M.WHEEL.length - 1);
});

test('Wheel cash slices pay their prizes without starting another bonus', () => {
  const total = M.WHEEL.reduce((sum, segment) => sum + segment.w, 0);
  let start = 0;
  for (const segment of M.WHEEL) {
    if (segment.kind === 'cash') {
      const rand = sequence([(start + segment.w / 2) / total]);
      assert.equal(M.playBonus(rand, 'wheel', 3, false), segment.v);
      assert.equal(rand.calls(), 1);
    }
    start += segment.w;
  }
});

test('Wheel bonus slices dispatch the selected bonus and Super flag using the remaining RNG stream', () => {
  const total = M.WHEEL.reduce((sum, segment) => sum + segment.w, 0);
  let start = 0;
  for (const segment of M.WHEEL) {
    if (segment.kind !== 'cash') {
      const rand = M.mulberry32(1900), expectedRand = M.mulberry32(1900);
      let selected = false;
      const wheelRand = () => {
        if (selected) return rand();
        selected = true;
        return (start + segment.w / 2) / total;
      };
      const expected = M.playBonus(expectedRand, segment.kind, 4, segment.sup);
      assert.equal(M.playBonus(wheelRand, 'wheel', 4, false), expected);
    }
    start += segment.w;
  }
});

for (const kind of ['kraken', 'reef', 'vault', 'wheel']) {
  test(kind + ' bonus is deterministic, finite, nonnegative, and expressible in hundredth-bet units', () => {
    const a = M.mulberry32(55), b = M.mulberry32(55);
    for (let i = 0; i < 300; i++) {
      const pearls = 3 + i % 3, sup = i % 2 === 0;
      const result = M.playBonus(a, kind, pearls, sup);
      assert.equal(result, M.playBonus(b, kind, pearls, sup));
      assert.ok(Number.isFinite(result) && result >= 0);
      assert.ok(Math.abs(result * 100 - Math.round(result * 100)) < 1e-6);
    }
  });
}

test('bonus entry points reject invalid pearl counts and unknown bonus names', () => {
  for (const pearls of [0, 2, 6, 3.5, NaN, Infinity, '3']) {
    for (const start of [M.krakenStart, M.reefStart, M.vaultStart]) assert.throws(() => start(pearls, false, M.mulberry32(1)));
    for (const kind of M.BONUS_KINDS) assert.throws(() => M.playBonus(M.mulberry32(1), kind, pearls, false));
  }
  for (const kind of ['', 'unknown', null, undefined]) assert.throws(() => M.playBonus(M.mulberry32(1), kind, 3, false));
});

test('Vault rejects invalid chest indices without partially mutating its state', () => {
  const vs = M.vaultStart(3, false, M.mulberry32(1));
  for (const index of [-1, 12, 1.5, NaN, Infinity, '0', undefined]) {
    const before = structuredClone(vs);
    assert.throws(() => M.vaultPick(vs, index));
    assert.deepEqual(vs, before);
  }
});

test('Reef starting selection terminates at the upper RNG boundary without rejecting gold repeatedly', () => {
  let calls = 0;
  const rand = () => { assert.ok(calls++ < 30); return 1 - Number.EPSILON; };
  const rs = M.reefStart(5, true, rand);
  assert.equal(rs.cells.filter(Boolean).length, 7);
  assert.ok(rs.cells.filter(Boolean).every(cell => cell.kind === 'major' && cell.v === 150));
});

test('Reef rejects duplicate, out-of-range, fractional, or excessive starting positions', () => {
  for (const positions of [[0, 0], [-1], [15], [1.5], [NaN], [Infinity], ['0'], [0, 1, 2, 3], new Array(1), '0']) {
    assert.throws(() => M.reefStart(3, false, () => 0, positions));
  }
});

test('finished Reef respins are idempotent and consume no randomness', () => {
  for (const grand of [false, true]) {
    const rs = blankReef([{ kind: 'cash', v: 10 }]);
    rs.respins = 0;
    rs.grand = grand;
    const before = structuredClone(rs);
    const result = M.reefRespin(rs, () => { assert.fail('completed Reef consumed randomness'); });
    assert.deepEqual(result, { landed: [], gold: 0, full: grand });
    assert.deepEqual(rs, before);
  }
});

test('Kraken step pays integer units and owns the shared remaining-spin counters', () => {
  const ks = M.krakenStart(3, false, () => 0);
  assert.equal(ks.played, 0);
  assert.equal(ks.totalUnits, 0);
  const result = M.krakenStep(ks, () => 0);
  assert.equal(result.paidUnits, 14580);
  assert.equal(result.ev.totalUnits, 14580);
  assert.equal(result.capped, false);
  assert.equal(result.extraAdded, 0);
  assert.equal(result.retriggerAdded, 0);
  assert.equal(ks.totalUnits, 14580);
  assert.equal(ks.played, 1);
  assert.equal(ks.left, 7);
});

test('Kraken step respects the remaining round cap without changing the raw evaluated win', () => {
  const ks = M.krakenStart(3, false, () => 0);
  const result = M.krakenStep(ks, () => 0, 17);
  assert.equal(result.paidUnits, 17);
  assert.equal(result.ev.totalUnits, 14580);
  assert.equal(result.capped, true);
  assert.equal(ks.totalUnits, 17);
  assert.equal(ks.left, 0);
  assert.equal(ks.played, 1);
  const before = structuredClone(ks);
  assert.equal(M.krakenStep(ks, () => { assert.fail('capped bonus consumed randomness'); }), null);
  assert.deepEqual(ks, before);
});

test('Kraken step also enforces its cumulative cap when a caller supplies a larger remaining amount', () => {
  const ks = M.krakenStart(3, false, () => 0);
  ks.totalUnits = 499999;
  const result = M.krakenStep(ks, () => 0, 500000);
  assert.equal(result.paidUnits, 1);
  assert.equal(result.capped, true);
  assert.equal(ks.totalUnits, 500000);
  assert.equal(ks.left, 0);
});

test('Kraken adds awakening spins before scatter retriggers within the sixty-spin allowance', () => {
  const ks = M.krakenStart(3, false, () => 0);
  ks.played = 55;
  ks.left = 1;
  ks.rage = 2;
  const grid = [[8, 0, 0], [8, 7, 1], [8, 2, 2], [3, 3, 3], [4, 4, 4]];
  const result = M.krakenStep(ks, sequence([...freeSpinRolls(grid), 0]));
  assert.equal(result.awaken, 1);
  assert.equal(result.extra, 2);
  assert.equal(result.retrigger, 5);
  assert.equal(result.extraAdded, 2);
  assert.equal(result.retriggerAdded, 2);
  assert.equal(ks.played, 56);
  assert.equal(ks.left, 4);
  assert.equal(ks.played + ks.left, 60);
});

test('the final allowed Kraken spin cannot grant any further spins', () => {
  const ks = M.krakenStart(3, false, () => 0);
  ks.played = 59;
  ks.left = 1;
  ks.rage = 2;
  const grid = [[8, 0, 0], [8, 7, 1], [8, 2, 2], [3, 3, 3], [4, 4, 4]];
  const result = M.krakenStep(ks, sequence([...freeSpinRolls(grid), 0]));
  assert.equal(result.extraAdded, 0);
  assert.equal(result.retriggerAdded, 0);
  assert.equal(ks.left, 0);
  assert.equal(ks.played, 60);
  assert.equal(M.krakenStep(ks, () => { assert.fail('exhausted bonus consumed randomness'); }), null);
});

test('zero remaining payout ends Kraken without a spin or random draw', () => {
  const ks = M.krakenStart(3, false, () => 0);
  assert.equal(M.krakenStep(ks, () => { assert.fail('zero-cap bonus consumed randomness'); }, 0), null);
  assert.equal(ks.left, 0);
  assert.equal(ks.played, 0);
  assert.equal(ks.totalUnits, 0);
});

test('Kraken simulation and stepwise browser control settle the same seeded bonus', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const pearls = 3 + seed % 3, sup = seed % 2 === 0;
    const rand = M.mulberry32(seed);
    const ks = M.krakenStart(pearls, sup, rand);
    let paid = 0, steps = 0, result;
    while ((result = M.krakenStep(ks, rand, 500000 - paid))) {
      paid += result.paidUnits;
      steps++;
      assert.equal(ks.played, steps);
      assert.equal(ks.totalUnits, paid);
      assert.ok(ks.left + ks.played <= 60);
      assert.ok(paid <= 500000);
    }
    assert.equal(M.playKraken(M.mulberry32(seed), pearls, sup), paid / 100);
  }
});

test('Kraken step rejects invalid state and remaining limits before any random draw', () => {
  for (const remaining of [-1, 500001, 0.5, NaN, Infinity, '1']) {
    const ks = M.krakenStart(3, false, () => 0);
    const before = structuredClone(ks);
    assert.throws(() => M.krakenStep(ks, () => { assert.fail('invalid cap consumed randomness'); }, remaining));
    assert.deepEqual(ks, before);
  }
  for (const patch of [{ played: -1 }, { played: 60 }, { left: 61 }, { left: 0.5 }, { rage: Infinity }, { rage: 3 }, { totalUnits: -1 }, { totalUnits: 500001 }]) {
    const ks = Object.assign(M.krakenStart(3, false, () => 0), patch);
    const before = structuredClone(ks);
    assert.throws(() => M.krakenStep(ks, () => { assert.fail('invalid state consumed randomness'); }));
    assert.deepEqual(ks, before);
  }
});

test('Kraken remaining-round settlement equals a single cap applied to the complete bonus', () => {
  for (const remaining of [1, 17, 9999, 125000, 499999, 500000]) {
    for (let seed = 1; seed <= 50; seed++) {
      const pearls = 3 + seed % 3, sup = seed % 2 === 0;
      const expected = Math.min(remaining, M.toUnits(M.playKraken(M.mulberry32(seed), pearls, sup)));
      const rand = M.mulberry32(seed);
      const ks = M.krakenStart(pearls, sup, rand);
      let result, total = 0;
      while ((result = M.krakenStep(ks, rand, remaining - total))) total += result.paidUnits;
      assert.equal(total, expected);
      assert.equal(ks.totalUnits, expected);
    }
  }
});

test('invalid Kraken sticky state cannot advance counters or draw randomness', () => {
  const invalid = [null, [], [[0]], new Array(5).fill(null)];
  for (const value of [-1, 0.5, 61, NaN, Infinity, '2']) {
    const sticky = M.emptySticky();
    sticky[1][0] = value;
    invalid.push(sticky);
  }
  const firstReel = M.emptySticky();
  firstReel[0][0] = 2;
  invalid.push(firstReel);
  for (const sticky of invalid) {
    const ks = M.krakenStart(3, false, () => 0);
    ks.sticky = sticky;
    const before = structuredClone(ks);
    assert.throws(() => M.krakenStep(ks, () => { assert.fail('invalid sticky grid consumed randomness'); }));
    assert.deepEqual(ks, before);
  }
});

test('freeSpin rejects invalid rage before drawing randomness or changing sticky wilds', () => {
  for (const rage of [-1, 3, 0.5, NaN, Infinity, -Infinity, '0', undefined]) {
    const sticky = M.emptySticky();
    sticky[1][0] = 2;
    const ks = { rage };
    const before = structuredClone({ sticky, ks });
    assert.throws(() => M.freeSpin(() => { assert.fail('invalid rage consumed randomness'); }, sticky, ks));
    assert.deepEqual({ sticky, ks }, before);
  }
});

test('freeSpin rejects malformed sticky state before drawing randomness or changing rage', () => {
  const invalid = [null, [], [[0]], new Array(5).fill(null), new Array(5)];
  for (const value of [-1, 0.5, 61, NaN, Infinity, '2']) {
    const sticky = M.emptySticky();
    sticky[1][0] = value;
    invalid.push(sticky);
  }
  const firstReel = M.emptySticky();
  firstReel[0][0] = 2;
  invalid.push(firstReel);
  for (const sticky of invalid) {
    const ks = { rage: 2 };
    const before = structuredClone({ sticky, ks });
    assert.throws(() => M.freeSpin(() => { assert.fail('invalid sticky state consumed randomness'); }, sticky, ks));
    assert.deepEqual({ sticky, ks }, before);
  }
});

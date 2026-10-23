const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math/model');
const B = require('../math/books');
const C = require('../shared/contract');
const W = require('../math/weights');
const clone = value => JSON.parse(JSON.stringify(value));

function rollsFor(board, weights) {
  const rolls = [];
  board.forEach((reel, r) => {
    let excluded = -1;
    reel.forEach(symbol => {
      const total = weights[r].reduce((sum, weight, index) => sum + (index === excluded ? 0 : weight), 0);
      const lower = weights[r].slice(0, symbol).reduce((sum, weight, index) => sum + (index === excluded ? 0 : weight), 0);
      rolls.push((lower + weights[r][symbol] / 2) / total);
      if (symbol === M.S.SCATTER) excluded = symbol;
    });
  });
  return () => rolls.length ? rolls.shift() : 1 - Number.EPSILON;
}

for (let count = 0; count <= 12; count++) {
  test(count + ' purple squids use the capped trigger level without counting pearls', () => {
    const board = Array.from({ length: 5 }, (_, r) => [r, r, r]);
    for (let i = 0; i < count; i++) board[1 + Math.floor(i / 3)][i % 3] = M.S.WILD;
    const spin = M.baseSpin(rollsFor(board, M.BASE_WEIGHTS));
    assert.deepEqual(spin.grid, board);
    assert.equal(spin.triggerCount, count);
    assert.equal(spin.triggerCells.length, count);
    assert.equal(spin.fsAward, M.FS_AWARD[Math.min(5, count)] || 0);
    assert.equal(spin.ev.scatterCount, 0);
  });
}

for (const count of [3, 4, 5]) {
  test(count + ' pearls pay their scatter award without triggering a base bonus', () => {
    const board = Array.from({ length: 5 }, (_, r) => [r < count ? M.S.SCATTER : r, r, r]);
    const spin = M.baseSpin(rollsFor(board, M.BASE_WEIGHTS));
    assert.equal(spin.ev.scatterCount, count);
    assert.equal(spin.ev.scatterUnits, M.SCATTER_PAY[count] * 100);
    assert.equal(spin.triggerCount, 0);
    assert.equal(spin.fsAward, 0);
  });
}

test('every naturally triggered round resolves Coin Vault independently of former route choices', () => {
  let triggered = 0, attackTrigger = 0;
  for (const kind of M.BONUS_KINDS) for (const ante of [false, true]) for (let seed = 0; seed < 1000; seed++) {
    const result = M.playRound(M.mulberry32(seed), { kind, ante, betCents: 100 });
    if (!result.base.fsAward) continue;
    triggered++;
    const recorded = B.generateBook(M.mulberry32(seed), { mode: ante ? 'ante_vault' : 'base_vault' });
    assert.ok(recorded.events.some(event => event.type === 'vaultStart'));
    assert.equal(recorded.events.some(event => ['wheel', 'reefStart', 'krakenStart'].includes(event.type)), false);
    assert.equal(result.settlement.winUnits, recorded.payoutMultiplier);
    if (result.base.attack) attackTrigger++;
  }
  assert.ok(triggered > 0);
  assert.ok(attackTrigger > 0);
});

test('six-wild buys always contain exactly six squids and never trigger an attack or bonus', () => {
  let losses = 0, wins = 0;
  for (let seed = 0; seed < 3000; seed++) {
    const book = B.generateBook(M.mulberry32(seed), { mode: 'buy_wilds' });
    const base = book.events[0].base;
    assert.equal(base.grid.flat().filter(symbol => symbol === M.S.WILD).length, 6);
    assert.equal(base.triggerCount, 6);
    assert.equal(base.attack, null);
    assert.equal(base.fsAward, 0);
    assert.deepEqual(base.grid, base.landed);
    assert.equal(book.events.length, 2);
    assert.equal(book.events[1].bonusUnits, 0);
    assert.ok(book.payoutMultiplier <= 157950);
    if (book.payoutMultiplier) wins++;
    else losses++;
    B.validateBook(book);
    C.validateBook(book);
  }
  assert.ok(losses > 0);
  assert.ok(wins > 0);
});

test('all purchased bonuses start from three to five purple squids', () => {
  for (const mode of C.MODES.filter(mode => mode.buy && mode.kind !== 'wilds')) {
    const counts = new Set();
    for (let seed = 0; seed < 3000; seed++) {
      const book = B.generateBook(M.mulberry32(seed), { mode: mode.name });
      const base = book.events[0].base;
      counts.add(base.triggerCount);
      assert.ok(base.triggerCount >= 3 && base.triggerCount <= 5);
      assert.equal(base.fsAward, M.FS_AWARD[base.triggerCount]);
      assert.equal(base.attack, null);
      for (const event of book.events.filter(event => event.type.endsWith('Start'))) assert.equal(event.pearls, base.triggerCount);
    }
    assert.deepEqual(counts, new Set([3, 4, 5]));
  }
});

test('Reef seeds use squid trigger positions rather than pearl scatter positions', () => {
  for (let seed = 0; seed < 100; seed++) {
    const book = B.generateBook(M.mulberry32(seed), { mode: 'buy_reef' });
    const base = book.events[0].base, start = book.events[1];
    const positions = new Set(base.triggerCells.slice(0, start.pearls).map(([r, y]) => y * 5 + r));
    start.state.cells.forEach((cell, index) => assert.equal(!!cell, positions.has(index)));
  }
});

test('both validators reject corrupted squid triggers and purchased-spin caps', () => {
  const cases = [
    ['base_vault', book => { book.events[0].base.triggerCount--; }],
    ['base_vault', book => { book.events[0].base.triggerCells.pop(); }],
    ['base_vault', book => { book.events[0].base.triggerCells.reverse(); }],
    ['base_vault', book => { book.events[0].base.fsAward = 0; }],
    ['base_vault', book => { book.events[1].pearls = 3; }],
    ['buy_wilds', book => { book.events[0].base.fsAward = 13; }],
    ['buy_wilds', book => { book.events[0].base.attack = [[4, 2]]; }],
    ['buy_wilds', book => { book.events[0].base.landed[4][2] = M.S.J; }],
    ['buy_wilds', book => { book.events.at(-1).payoutUnits = 157951; book.payoutMultiplier = 157951; }],
    ['buy_wilds', book => { book.events.at(-1).capped = false; }],
    ['buy_reef', book => { book.events[1].state.cells[0] = book.events[1].state.cells[1]; book.events[1].state.cells[1] = null; }],
  ];
  for (const [mode, corrupt] of cases) {
    const book = clone(B.maxWinBook(mode));
    corrupt(book);
    assert.throws(() => B.validateBook(book), mode);
    assert.throws(() => C.validateBook(book), mode);
  }
});

test('wild-spin weights reconcile exactly to 96.3 percent of the 50x price and its reachable cap', () => {
  const payouts = [0, 6, 600, 1000, 10000, 157950];
  const result = W.balance(payouts, 50, { maxPayoutUnits: 157950 });
  const total = result.weights.reduce((sum, weight) => sum + weight, 0n);
  const paid = result.weights.reduce((sum, weight, index) => sum + weight * BigInt(payouts[index]), 0n);
  assert.equal(paid * 1000n, total * 50n * 100n * 963n);
  assert.equal(result.statistics.maximumUnits, 157950);
  assert.equal(result.statistics.capWeight, result.weights.at(-1));
});

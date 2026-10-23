'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/contract');
const M = require('../math/model');
const B = require('../math/books');
const { publicConfig } = require('../tools/build');
const clone = value => JSON.parse(JSON.stringify(value));

test('the seven mode costs are consistent across math, contract, and display configuration', () => {
  assert.deepEqual(C.MODES, B.MODES);
  assert.deepEqual(publicConfig().MODES, C.MODES);
  assert.equal(new Set(C.MODES.map(mode => mode.name)).size, 7);
  assert.equal(publicConfig().RTP, 96.3);
  for (const field of ['BASE_WEIGHTS', 'FS_WEIGHTS', 'cryptoRand', 'createRound', 'playRound']) assert.equal(publicConfig()[field], undefined);
});

for (const mode of C.MODES) {
  test(mode.name + ' generated events satisfy the frontend contract', () => {
    const rand = M.mulberry32(384903);
    for (let id = 0; id < 100; id++) C.validateBook(B.generateBook(rand, { mode: mode.name, id }), { mode: mode.name });
    C.validateBook(B.maxWinBook(mode.name, 101), { mode: mode.name });
  });
}

test('micro-unit settlement preserves subcent prizes and protects safe-number limits', () => {
  assert.equal(C.payoutAmount(10000, 6), 600);
  assert.equal(C.payoutAmount(200000, 3), 6000);
  assert.equal(C.payoutAmount(1000000, 500000), 5000000000);
  assert.throws(() => C.payoutAmount(Number.MAX_SAFE_INTEGER, 500000));
  for (const amount of [-1, NaN, 0.1, Infinity]) assert.throws(() => C.payoutAmount(amount, 100));
  for (const units of [-1, NaN, 0.1, 500001]) assert.throws(() => C.payoutAmount(1000000, units));
});

test('book identity, mode, event order and payout inconsistencies are rejected', () => {
  const source = B.generateBook(M.mulberry32(10), { mode: 'buy_kraken', id: 1 });
  const changes = [
    book => { book.id = -1; },
    book => { book.payoutMultiplier++; },
    book => { book.events[0].schema = 1; },
    book => { book.events[0].kind = 'reef'; },
    book => { book.events[1].index = 20; },
    book => { book.events[1].type = 'unknown'; },
    book => { book.events[0].base.landed[0][0] = 99; },
    book => { book.events.at(-1).payoutUnits++; },
    book => { book.events.at(-1).baseUnits++; },
    book => { book.events.at(-1).bonusUnits++; },
    book => { book.events.at(-1).capped = !book.events.at(-1).capped; },
    book => { book.events[0].base.ev.totalUnits++; },
  ];
  for (const change of changes) { const book = clone(source); change(book); assert.throws(() => C.validateBook(book)); }
  assert.throws(() => C.validateBook(source, { mode: 'buy_reef' }));
  assert.throws(() => C.mode('BASE_KRAKEN'));
});

test('a final award cannot close an unfinished recorded feature', () => {
  for (const kind of ['kraken', 'reef', 'vault']) {
    const book = B.maxWinBook('buy_' + kind, 0);
    const start = book.events[1], final = book.events.at(-1);
    const featureUnits = kind === 'reef' ? start.state.cells.reduce((sum, cell) => sum + (cell ? cell.v * 100 : 0), 0) : 0;
    book.events = [book.events[0], start, final];
    book.events.forEach((event, index) => { event.index = index; });
    book.payoutMultiplier = Math.min(500000, final.baseUnits + featureUnits);
    Object.assign(final, { payoutUnits: book.payoutMultiplier, bonusUnits: book.payoutMultiplier - final.baseUnits, capped: book.payoutMultiplier === 500000 });
    assert.throws(() => C.validateBook(book), /Unfinished recorded feature/);
  }
});

test('renderer-required feature fields fail validation before presentation', () => {
  const changes = [
    ['kraken', book => { delete book.events[1].state.sticky; }],
    ['kraken', book => { delete book.events[1].state.left; }],
    ['kraken', book => { book.events[1].state.rage = Infinity; }],
    ['kraken', book => { delete book.events[2].result.newWilds; }],
    ['kraken', book => { delete book.events[2].result.awaken; }],
    ['kraken', book => { delete book.events[2].result.extraAdded; }],
    ['kraken', book => { book.events[2].state.played = 0; }],
    ['reef', book => { delete book.events[1].state.cells; }],
    ['reef', book => { delete book.events[1].state.respins; }],
    ['reef', book => { delete book.events[1].state.lvl; }],
    ['reef', book => { delete book.events[2].result.landed; }],
    ['reef', book => { book.events[2].state.cells[0].v = 0.001; }],
    ['reef', book => { book.events[2].state.grand = 'true'; }],
    ['vault', book => { delete book.events[1].state.chests; }],
    ['vault', book => { delete book.events[1].state.open; }],
    ['vault', book => { book.events[1].state.lives = -1; }],
    ['vault', book => { book.events[2].result = { kind: 'unknown' }; }],
    ['vault', book => { book.events[2].state.open[0] = false; }],
    ['vault', book => { book.events[2].state.coins++; }],
  ];
  for (const [kind, change] of changes) {
    const book = B.maxWinBook('buy_' + kind, 0);
    change(book);
    assert.throws(() => C.validateBook(book), kind);
  }
});

test('accepted free spin units must equal the evaluated award limited by the remaining cap', () => {
  const book = B.maxWinBook('buy_kraken', 0);
  book.events[2].result.paidUnits++;
  book.events[2].state.totalUnits++;
  assert.throws(() => C.validateBook(book), /accepted free spin payout/);
});

test('book evaluation requires display amounts and cells consistent with the recorded board', () => {
  const changes = [
    book => { book.events[0].base.ev.wins[0].amount = Infinity; },
    book => { book.events[0].base.ev.wins[0].cells[0] = [0, 1]; },
    book => { book.events[0].base.ev.scatterCells[0] = [0, 1]; },
    book => { book.events[0].base.attack = [[0, 0]]; },
    book => { book.events[0].base.fsAward = 0; },
    book => { book.events[0].base.grid[0][1] = 7; },
    book => { book.events[1].sup = true; },
  ];
  for (const change of changes) {
    const book = B.maxWinBook('buy_vault', 0);
    change(book);
    assert.throws(() => C.validateBook(book));
  }
});

test('feature steps after terminal state are rejected even if the total award remains capped', () => {
  const book = B.maxWinBook('buy_vault', 0);
  book.events.splice(book.events.length - 1, 0, clone(book.events.at(-2)));
  book.events.forEach((event, index) => { event.index = index; });
  assert.throws(() => C.validateBook(book), /chest sequence/);
});

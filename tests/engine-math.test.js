'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math/model');
const B = require('../math/books');
const C = require('../shared/contract');

const copy = value => JSON.parse(JSON.stringify(value));

test('Engine modes cover every wager and bonus combination with immutable costs', () => {
  assert.equal(B.MODES.length, 7);
  assert.equal(new Set(B.MODES.map(mode => mode.name)).size, 7);
  for (const mode of B.MODES) {
    assert.equal(mode.name, (mode.buy ? 'buy' : mode.ante ? 'ante' : 'base') + '_' + mode.kind);
    assert.equal(mode.cost, { base_vault: 1, ante_vault: 2, buy_vault: 100, buy_reef: 250, buy_kraken: 500, buy_wheel: 185, buy_wilds: 50 }[mode.name]);
    assert.ok(Object.isFrozen(mode));
    assert.equal(B.mode(mode.name), mode);
  }
  assert.ok(Object.isFrozen(B.MODES));
  assert.throws(() => B.mode('unknown'));
});

for (const mode of B.MODES) {
  test(mode.name + ' recorded rounds reproduce the procedural model', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const book = B.generateBook(M.mulberry32(seed), { mode: mode.name, id: seed });
      const reference = M.playRound(M.mulberry32(seed), Object.assign({ betCents: 100 }, mode));
      assert.equal(book.payoutMultiplier, reference.settlement.winUnits);
      assert.deepEqual(book.events[0].base, reference.base);
      assert.equal(B.validateBook(book, { mode: mode.name }), book);
      C.validateBook(book, { mode: mode.name });
    }
  });

  test(mode.name + ' has a reachable maximum witness with a complete valid event history', () => {
    const book = B.maxWinBook(mode.name, 42);
    assert.equal(book.payoutMultiplier, mode.maxWinUnits);
    assert.equal(book.id, 42);
    assert.equal(book.events[0].base.triggerCount, mode.kind === 'wilds' ? 6 : 5);
    assert.equal(book.events.at(-1).capped, true);
    assert.equal(book.events.at(-1).baseUnits + book.events.at(-1).bonusUnits, mode.maxWinUnits);
    B.validateBook(book); C.validateBook(book);
    assert.deepEqual(book, B.maxWinBook(mode.name, 42));
    assert.ok(Buffer.byteLength(JSON.stringify(book)) < B.MAX_BOOK_BYTES);
  });
}

test('Wheel books include every cash and normal or super feature branch', () => {
  const segments = new Set(), features = new Set();
  for (let seed = 0; seed < 1000 && segments.size < 8; seed++) {
    const book = B.generateBook(M.mulberry32(seed), { mode: 'buy_wheel', id: seed });
    B.validateBook(book);
    const wheel = book.events.find(event => event.type === 'wheel');
    segments.add(wheel.segment);
    features.add(wheel.result.kind + ':' + !!wheel.result.sup);
    if (wheel.result.kind === 'cash') assert.equal(book.events.length, 3);
  }
  assert.equal(segments.size, 8);
  assert.deepEqual(features, new Set(['cash:false', 'kraken:false', 'kraken:true', 'reef:false', 'reef:true', 'vault:false', 'vault:true']));
});

test('book snapshots are independent through every mutable bonus state', () => {
  for (const kind of ['kraken', 'reef', 'vault']) {
    const book = B.maxWinBook('buy_' + kind, 0);
    const start = book.events.find(event => event.type === kind + 'Start');
    const after = book.events.find(event => event.type === (kind === 'reef' ? 'reefRespin' : kind === 'vault' ? 'vaultPick' : 'krakenStep'));
    const original = copy(after);
    if (kind === 'kraken') start.state.sticky[1][0] = 59;
    else if (kind === 'reef') start.state.cells.find(Boolean).v = 987654;
    else start.state.chests[0].v = 987654;
    assert.deepEqual(after, original);
  }
});

test('Kraken maximum records accepted cumulative units and stops immediately at the combined cap', () => {
  const book = B.maxWinBook('buy_kraken', 0);
  const first = book.events[0], step = book.events.find(event => event.type === 'krakenStep');
  assert.ok(step.result.ev.totalUnits > 500000);
  assert.equal(step.result.paidUnits, 500000 - first.base.ev.totalUnits);
  assert.equal(step.state.totalUnits, step.result.paidUnits);
  assert.equal(step.state.left, 0);
  assert.equal(step.state.played, 1);
  assert.equal(step.result.retrigger, 5);
  assert.ok(step.result.awaken > 0);
  assert.equal(book.events.filter(event => event.type === 'krakenStep').length, 1);
});

test('Vault records canonical reveals and all remaining contents without new outcome RNG', () => {
  const book = B.maxWinBook('buy_vault', 0);
  const events = book.events.filter(event => event.type === 'vaultPick');
  const start = book.events.find(event => event.type === 'vaultStart').state;
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].choice, i);
    assert.deepEqual(events[i].result, start.chests[i]);
    assert.equal(events[i].state.open.filter(Boolean).length, i + 1);
  }
  assert.equal(events.at(-1).state.over, true);
  assert.equal(events.at(-1).state.chests.length, 12);
  assert.equal(events.at(-1).state.coins * events.at(-1).state.mult, 7000);
});

test('independent validation rejects corrupted payouts, board transitions, feature state and replay order', () => {
  const variants = [
    ['buy_kraken', book => { book.payoutMultiplier--; }],
    ['buy_kraken', book => { book.events[0].base.ev.totalUnits++; }],
    ['buy_kraken', book => { book.events[0].base.grid[0][0] = M.S.WILD; }],
    ['buy_kraken', book => { book.events[2].result.paidUnits++; }],
    ['buy_kraken', book => { book.events[2].state.sticky[1][0]++; }],
    ['buy_kraken', book => { book.events[2].result.extraAdded++; }],
    ['buy_reef', book => { book.events[2].state.cells[0].v++; }],
    ['buy_reef', book => { book.events[2].result.gold++; }],
    ['buy_vault', book => { book.events[2].choice = 1; }],
    ['buy_vault', book => { book.events[2].result.v++; }],
    ['buy_vault', book => { book.events[2].state.lives++; }],
    ['buy_wheel', book => { book.events[1].segment = 1; }],
    ['buy_reef', book => { book.events.splice(2, 1); book.events.forEach((event, index) => { event.index = index; }); }],
    ['base_vault', book => { book.events.at(-1).bonusUnits--; }],
    ['base_vault', book => { book.events[1].index = 0; }],
  ];
  for (const [mode, corrupt] of variants) {
    const book = B.maxWinBook(mode, 0);
    corrupt(book);
    assert.throws(() => B.validateBook(book), mode);
  }
});

test('round generation rejects invalid identity, mode and RNG inputs', () => {
  assert.throws(() => B.generateBook(M.mulberry32(0), { mode: 'buy_kraken', id: -1 }));
  assert.throws(() => B.generateBook(M.mulberry32(0), { mode: 'missing', id: 0 }));
  assert.throws(() => B.generateBook(() => 1, { mode: 'buy_kraken' }));
  assert.throws(() => B.validateBook(B.maxWinBook('buy_kraken', 0), { mode: 'base_vault' }));
});

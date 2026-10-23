const test = require('node:test');
const assert = require('node:assert/strict');
const Playback = require('../frontend/js/playback');
const Books = require('../math/books');
const M = require('../math/model');

const copy = value => JSON.parse(JSON.stringify(value));

function consume(book, reverse) {
  const player = Playback.create(book.events), states = {}, results = [];
  assert.deepEqual(player.baseSpin(), book.events[0].base);
  for (const event of book.events.slice(1, -1)) {
    if (event.type.endsWith('Start')) {
      const kind = event.type.slice(0, -5);
      states[kind] = player[event.type](event.pearls, event.sup);
      assert.deepEqual(states[kind], event.state);
    } else if (event.type === 'wheel') assert.equal(player.wheelSpin(), event.segment);
    else if (event.type === 'vaultPick') {
      const state = states.vault, choices = state.open.map((open, i) => open ? -1 : i).filter(i => i >= 0);
      const choice = reverse ? choices.at(-1) : choices[0];
      const item = player.vaultPick(state, choice);
      assert.deepEqual(item, event.result);
      assert.equal(state.coins, event.state.coins);
      assert.equal(state.mult, event.state.mult);
      assert.equal(state.lives, event.state.lives);
      assert.equal(state.over, event.state.over);
      results.push(item);
    } else {
      const state = states[event.type === 'krakenStep' ? 'kraken' : 'reef'];
      assert.deepEqual(player[event.type](state), event.result);
      assert.deepEqual(state, event.state);
    }
    assert.equal(player.eventIndex, event.index);
  }
  assert.deepEqual(player.finish(), book.events.at(-1));
  assert.equal(player.eventIndex, book.events.length - 1);
  return { player, states, results };
}

for (const mode of Books.MODES) {
  test(mode.name + ' consumes server records in order without evaluating payouts', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const book = Books.generateBook(M.mulberry32(seed), { mode: mode.name, id: seed });
      const before = copy(book);
      const { player } = consume(book);
      assert.equal(player.payoutUnits, book.payoutMultiplier);
      assert.equal(player.baseUnits + player.bonusUnits, book.payoutMultiplier);
      assert.deepEqual(book, before);
    }
  });
}

test('Vault reveal positions do not change recorded rewards or the final award', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const book = Books.generateBook(M.mulberry32(seed), { mode: 'buy_vault', id: seed });
    const first = consume(book, false), last = consume(book, true);
    assert.deepEqual(first.results, last.results);
    assert.equal(first.player.payoutUnits, last.player.payoutUnits);
    assert.equal(first.states.vault.coins, last.states.vault.coins);
    assert.deepEqual(first.states.vault.chests.map(item => JSON.stringify(item)).sort(), last.states.vault.chests.map(item => JSON.stringify(item)).sort());
  }
});

test('every maximum-win witness finishes at the single recorded cap', () => {
  for (const mode of Books.MODES) {
    const { player } = consume(Books.maxWinBook(mode.name));
    assert.equal(player.payoutUnits, mode.maxWinUnits);
    assert.equal(player.capped, true);
  }
});

test('out-of-order consumption and duplicate base results fail explicitly', () => {
  const book = Books.generateBook(M.mulberry32(1), { mode: 'buy_reef' });
  assert.throws(() => Playback.create(book.events).reefStart(3, false), /order mismatch/);
  const player = Playback.create(book.events);
  player.baseSpin();
  assert.throws(() => player.baseSpin(), /already consumed/);
  assert.throws(() => player.finish(), /order mismatch/);
});

test('input mutation and returned state mutation do not rewrite future recorded events', () => {
  const book = Books.generateBook(M.mulberry32(1), { mode: 'buy_reef' }), saved = copy(book);
  const player = Playback.create(book.events);
  book.events[0].base.ev.totalUnits = 123456;
  assert.deepEqual(player.baseSpin(), saved.events[0].base);
  const start = saved.events[1], next = saved.events[2];
  const state = player.reefStart(start.pearls, start.sup);
  state.cells.fill(null); state.respins = 99;
  assert.deepEqual(player.reefRespin(state), next.result);
  assert.deepEqual(state, next.state);
});

test('a second click on an opened chest cannot consume a second recorded reward', () => {
  const book = Books.generateBook(M.mulberry32(1), { mode: 'buy_vault' });
  const player = Playback.create(book.events), base = player.baseSpin();
  const state = player.vaultStart(Math.min(5, base.triggerCount), false);
  player.vaultPick(state, 7);
  const index = player.eventIndex;
  assert.throws(() => player.vaultPick(state, 7), /Invalid recorded chest selection/);
  assert.equal(player.eventIndex, index);
});

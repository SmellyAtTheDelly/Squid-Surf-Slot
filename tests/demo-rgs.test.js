'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DemoRgs, randomBelow } = require('../tools/demo-rgs');
const { generateBook } = require('../math/books');
const M = require('../math/model');
const C = require('../shared/contract');

function fixture(name = 'buy_reef') { return generateBook(M.mulberry32(45), { mode: name, id: 12 }); }
const authenticate = (rgs, id = 'test') => rgs.call('/wallet/authenticate', { sessionID: id });

test('local RGS authenticates and uses base stake for debit and payout', async () => {
  const book = fixture(), rgs = new DemoRgs({ select: async () => book });
  const auth = await authenticate(rgs);
  assert.deepEqual(auth.config.gameModes, C.MODES.map(mode => ({ mode: mode.name, costMultiplier: mode.cost, maxBet: 100000000 })));
  assert.equal(Object.hasOwn(auth.config, 'betModes'), false);
  const play = await rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 10000 });
  assert.equal(play.balance.amount, auth.balance.amount - 2500000);
  assert.equal(play.round.payout, book.payoutMultiplier * 100);
  assert.equal(play.round.amount, 10000);
  assert.equal(play.round.payoutMultiplier, book.payoutMultiplier / 100);
  const end = await rgs.call('/wallet/end-round', { sessionID: 'test' });
  assert.equal(end.balance.amount, play.balance.amount + play.round.payout);
  assert.deepEqual(await rgs.call('/wallet/end-round', { sessionID: 'test' }), end);
});

test('unfinished purchased rounds resume without another debit or generation', async () => {
  let calls = 0;
  const rgs = new DemoRgs({ select: async () => { calls++; return fixture(); } });
  await authenticate(rgs);
  const response = await rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 1000000 });
  await rgs.call('/bet/event', { sessionID: 'test', event: 'step-3' });
  const resumed = await authenticate(rgs);
  assert.equal(resumed.round.id, response.round.id);
  assert.equal(resumed.round.event, 'step-3');
  assert.equal(resumed.balance.amount, response.balance.amount);
  await assert.rejects(rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 1000000 }));
  assert.equal(calls, 1);
});

test('concurrent play and auth recovery cannot create duplicate debits', async () => {
  let release;
  const rgs = new DemoRgs({ select: () => new Promise(resolve => { release = resolve; }) });
  await authenticate(rgs);
  const first = rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 1000000 });
  await assert.rejects(rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 1000000 }));
  const recovered = authenticate(rgs);
  release(fixture());
  const [play, auth] = await Promise.all([first, recovered]);
  assert.equal(auth.balance.amount, 750000000);
  assert.equal(auth.round.id, play.round.id);
});

test('invalid stakes and failed outcome retrieval preserve the demo wallet', async () => {
  let calls = 0;
  const rgs = new DemoRgs({ select: async () => { calls++; throw new Error('Unavailable'); } });
  await assert.rejects(rgs.call('/wallet/play', { sessionID: 'missing', mode: 'base_vault', amount: 10000 }));
  const before = await authenticate(rgs);
  for (const amount of [0, -1, 1, 10001, Infinity, 100000001]) await assert.rejects(rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount }));
  await assert.rejects(rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 100000000 }));
  assert.equal(calls, 0);
  await assert.rejects(rgs.call('/wallet/play', { sessionID: 'test', mode: 'buy_reef', amount: 10000 }));
  assert.equal((await authenticate(rgs)).balance.amount, before.balance.amount);
  assert.equal(calls, 1);
});

test('weighted selection rejects modulo bias and handles uint64 totals', () => {
  const sequence = [0xffffffffffffffffn, 17n];
  const source = () => { const value = Buffer.alloc(8); value.writeBigUInt64LE(sequence.shift()); return value; };
  assert.equal(randomBelow(10n, source), 7n);
  assert.equal(sequence.length, 0);
  for (const total of [0n, -1n, 1n << 64n]) assert.throws(() => randomBelow(total));
  assert.equal(randomBelow(1n), 0n);
});

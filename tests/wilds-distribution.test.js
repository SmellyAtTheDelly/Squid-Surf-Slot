'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const M = require('../math/model');
const B = require('../math/books');
const W = require('../math/weights');
const D = require('../math/distribution');
const E = require('../math/export');
const V = require('../math/verify');
const C = require('../shared/contract');

const wilds = B.mode('buy_wilds');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squid-wilds-test-'));
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('squid-wilds-test-')) throw new Error('Unexpected test directory');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('premium candidates retain exactly six ordinary wilds and the unchanged ways paytable', () => {
  const rand = M.mulberry32(20261023), layouts = new Set(), payouts = new Set();
  for (let i = 0; i < 1000; i++) {
    const book = D.sampleBook(rand, wilds, i * D.WILDS_PROFILE.candidateInterval), base = book.events[0].base;
    B.validateBook(book, { mode: wilds.name }); C.validateBook(book, { mode: wilds.name });
    assert.equal(book.events.length, 2);
    assert.equal(base.triggerCount, 6);
    assert.equal(base.grid.flat().filter(symbol => symbol === M.S.WILD).length, 6);
    assert.equal(base.grid[0].includes(M.S.WILD), false);
    assert.equal(base.fsAward, 0);
    assert.equal(base.attack, null);
    assert.deepEqual(base.landed, base.grid);
    assert.deepEqual(M.evaluate(base.grid), base.ev);
    assert.equal(book.payoutMultiplier, base.ev.totalUnits);
    assert.ok(book.payoutMultiplier <= wilds.maxWinUnits);
    layouts.add(JSON.stringify(base.grid)); payouts.add(book.payoutMultiplier);
  }
  assert.ok(layouts.size > 800);
  assert.ok(payouts.size > 50);
});

test('candidate selection leaves the other six mode distributions unchanged', () => {
  for (const config of B.MODES.filter(mode => mode.kind !== 'wilds')) {
    const a = M.mulberry32(731), b = M.mulberry32(731);
    for (let id = 0; id < 50; id++) assert.deepEqual(D.sampleBook(a, config, id), B.generateBook(b, { mode: config.name, id }));
    assert.deepEqual(E.sourceWeights([0, 1000, config.maxWinUnits], config), [E.SOURCE_WEIGHT, E.SOURCE_WEIGHT, E.WITNESS_WEIGHT]);
  }
});

test('six-wild source weights preserve every outcome and apply exact payout boundaries', () => {
  const payouts = [0, 1, 74999, 75000, wilds.maxWinUnits - 1, wilds.maxWinUnits, wilds.maxWinUnits];
  assert.deepEqual(E.sourceWeights(payouts, wilds), [1000n, 1n, 1n, 1000n, 1000n, 50n, E.WITNESS_WEIGHT]);
  assert.equal(wilds.cost, 50);
  assert.equal(wilds.maxWinUnits, 157950);
});

test('the production-sized six-wild pool has exact RTP and rare large payouts without a dominant witness', () => {
  const count = E.MIN_ROUNDS, payouts = new Uint32Array(count + 1);
  const rand = M.mulberry32(E.modeSeed(20261023, wilds.name)), largeLayouts = new Set();
  for (let id = 0; id < count; id++) {
    const book = D.sampleBook(rand, wilds, id);
    payouts[id] = book.payoutMultiplier;
    if (book.payoutMultiplier >= D.WILDS_PROFILE.highPayoutUnits) largeLayouts.add(JSON.stringify(book.events[0].base.grid));
  }
  payouts[count] = B.maxWinBook(wilds.name, count).payoutMultiplier;
  const result = W.balance(payouts, wilds.cost, { sourceWeights: E.sourceWeights(payouts, wilds), maxPayoutUnits: wilds.maxWinUnits });
  const stats = result.statistics;
  assert.equal(stats.payoutSum * 1000n, stats.totalWeight * 5000n * 963n);
  assert.equal(stats.rtpNumerator, 963n);
  assert.equal(stats.rtpDenominator, 1000n);
  assert.ok(stats.standardDeviation > 4.3 && stats.standardDeviation < 4.6);
  assert.ok(stats.hitWeight * 100n < stats.totalWeight * 7n);
  assert.ok(stats.profitWeight * 100n < stats.totalWeight * 5n);
  assert.ok(stats.capWeight * 100n < stats.profitWeight * 5n);
  assert.ok(result.weights.at(-1) * 100000n < stats.totalWeight);
  assert.ok(largeLayouts.size > 2000);
  assert.ok(stats.totalWeight <= W.UINT64_MAX);
  assert.ok(result.weights.every(weight => weight > 0n && weight <= W.UINT64_MAX));
  E.requireProductionStatistics(stats, wilds);
});

test('production validation rejects insufficient six-wild volatility and excessive hit or profit rates', () => {
  const stats = { standardDeviation: 4, totalWeight: 10000000n, capWeight: 2n, hitWeight: 1000000n, profitWeight: 800000n };
  E.requireProductionStatistics(stats, wilds);
  assert.throws(() => E.requireProductionStatistics({ ...stats, standardDeviation: 3.999 }, wilds), /volatility/);
  assert.throws(() => E.requireProductionStatistics({ ...stats, standardDeviation: NaN }, wilds), /volatility/);
  assert.throws(() => E.requireProductionStatistics({ ...stats, hitWeight: 1000001n }, wilds), /hit frequency/);
  assert.throws(() => E.requireProductionStatistics({ ...stats, profitWeight: 800001n }, wilds), /profit frequency/);
});

test('six-wild export carries its reproducible distribution profile and verifies all weighted payouts', async t => {
  const root = await temporary(t), first = path.join(root, 'first'), second = path.join(root, 'second');
  const options = { rounds: 400, seed: 20261023, production: false, modes: [wilds.name] };
  const a = await E.exportBooks(first, options), b = await E.exportBooks(second, options);
  assert.equal(a.version, 'squid-engine-3');
  assert.deepEqual(a.modes[0].distribution, D.WILDS_PROFILE);
  assert.deepEqual(a.modes[0], b.modes[0]);
  assert.ok(a.sourceHashes['math/distribution.js']);
  const verified = await V.verifyExport(first);
  assert.equal(verified.modes[0].statistics.rtpNumerator, '963');
  assert.equal(verified.modes[0].statistics.rtpDenominator, '1000');
  const file = path.join(first, 'manifest.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.modes[0].distribution.minimumStandardDeviation = 0;
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(V.verifyExport(first), /distribution profile/);
});

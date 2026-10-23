'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const B = require('../math/books');
const W = require('../math/weights');
const E = require('../math/export');
const V = require('../math/verify');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squid-engine-test-'));
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('squid-engine-test-')) throw new Error('Unexpected test directory');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function rewriteManifest(directory, mutate) {
  const file = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  await mutate(manifest);
  await fs.writeFile(file, JSON.stringify(manifest));
}

test('integer weighting reaches precisely 963/1000 for every mode cost', () => {
  for (const cost of [1, 2, 50, 100, 185, 250, 500]) {
    const payouts = [0, 6, 60, 100, 200, 10000, 500000];
    const sourceWeights = [1000n, 1000n, 1000n, 1000n, 1000n, 1000n, 1n];
    const result = W.balance(payouts, cost, { sourceWeights });
    const total = result.weights.reduce((sum, value) => sum + value, 0n);
    const payout = result.weights.reduce((sum, value, index) => sum + value * BigInt(payouts[index]), 0n);
    assert.equal(payout * 1000n, total * BigInt(cost) * 100n * 963n);
    assert.equal(result.statistics.rtpNumerator, 963n);
    assert.equal(result.statistics.rtpDenominator, 1000n);
    assert.ok(total <= W.UINT64_MAX);
    assert.ok(result.weights.every(value => value > 0n && value <= W.UINT64_MAX));
    assert.equal(result.weights[0], result.weights[1]);
    assert.equal(result.weights[1], result.weights[2]);
  }
});

test('equal-payout witnesses receive precisely their reduced source mass within a payout group', () => {
  const result = W.balance([0, 500000, 500000], 1, { sourceWeights: [1000n, 1000n, 1n] });
  assert.equal(result.weights[1], result.weights[2] * 1000n);
  assert.equal(result.statistics.maximumUnits, 500000);
  assert.equal(result.statistics.minimumUnits, 0);
});

test('weight validation rejects invalid outcomes, unreachable means and unsigned overflow', () => {
  assert.throws(() => W.balance([100, 200], 1), /bracket/);
  assert.throws(() => W.balance([0, 6], 1), /bracket/);
  assert.throws(() => W.balance([0, 500001], 1));
  assert.throws(() => W.balance([0, 1.5], 1));
  assert.throws(() => W.balance([0, 100], 1, { sourceWeights: [1n] }));
  assert.throws(() => W.balance([0, 100], 1, { sourceWeights: [0n, 1n] }));
  assert.throws(() => W.summarize([0, 100], [W.UINT64_MAX, 1n], 1), /Total weight/);
  assert.throws(() => W.summarize([0, 100], [1n, 1n], 0));
  assert.throws(() => W.uint64(W.UINT64_MAX + 1n, 'Weight', true));
  assert.throws(() => W.uint64(-1n, 'Weight', true));
  assert.throws(() => W.uint64(1, 'Weight', true));
});

test('Zstandard exports every mode with positional CSV and independently verified exact statistics', async t => {
  const directory = await temporary(t);
  const manifest = await E.exportBooks(directory, { rounds: 400, production: false, seed: 20261023 });
  assert.equal(manifest.production, false);
  assert.equal(manifest.modes.length, 7);
  for (const mode of manifest.modes) {
    assert.equal(mode.rounds, 401);
    assert.equal(mode.statistics.rtpNumerator, 963n);
    assert.equal(mode.statistics.rtpDenominator, 1000n);
    const raw = zlib.zstdDecompressSync(await fs.readFile(path.join(directory, mode.events))).toString('utf8');
    const books = raw.trimEnd().split('\n').map(line => JSON.parse(line));
    const rows = (await fs.readFile(path.join(directory, mode.weights), 'utf8')).trimEnd().split('\n');
    assert.equal(books.length, rows.length);
    for (let i = 0; i < books.length; i++) {
      const cells = rows[i].split(',');
      assert.equal(cells[0], String(i));
      assert.equal(cells[2], String(books[i].payoutMultiplier));
      B.validateBook(books[i]);
    }
    assert.equal(books.at(-1).payoutMultiplier, B.mode(mode.name).maxWinUnits);
    assert.ok(mode.witness.frequency > 0 && mode.witness.frequency < 1);
  }
  const verified = await V.verifyExport(directory);
  assert.equal(verified.modes.length, 7);
  assert.equal(verified.sourceHashesVerified, true);
  await assert.rejects(V.verifyExport(directory, { requireProduction: true }), /not a production/);
});

test('uncompressed exports and seeded output are reproducible', async t => {
  const root = await temporary(t), first = path.join(root, 'first'), second = path.join(root, 'second');
  const options = { rounds: 100, production: false, compress: false, modes: ['base_vault', 'buy_vault'], seed: 17 };
  const a = await E.exportBooks(first, options), b = await E.exportBooks(second, options);
  for (let i = 0; i < a.modes.length; i++) {
    assert.deepEqual(a.modes[i], b.modes[i]);
    assert.deepEqual(await fs.readFile(path.join(first, a.modes[i].events)), await fs.readFile(path.join(second, b.modes[i].events)));
  }
  await V.verifyExport(first);
  await assert.rejects(E.exportBooks(first, options), /empty/);
});

test('publication limits reject invalid requests before generating outcomes', async t => {
  const root = await temporary(t);
  await assert.rejects(E.exportBooks(path.join(root, 'short'), { rounds: 99999 }), /round count/);
  await assert.rejects(E.exportBooks(path.join(root, 'large'), { rounds: 10000000 }), /round count/);
  await assert.rejects(E.exportBooks(path.join(root, 'seed'), { seed: -1 }), /Seed/);
  await assert.rejects(E.exportBooks(path.join(root, 'duplicate'), { modes: ['base_vault', 'base_vault'] }), /mode list/);
  await assert.rejects(E.exportBooks(path.join(root, 'expensive'), { modes: ['buy_reef'] }), /7 modes/);
  await assert.rejects(E.exportBooks(path.join(root, 'incomplete'), { modes: ['base_vault', 'buy_reef'] }), /7 modes/);
  assert.equal((await fs.readdir(root)).length, 0);
});

test('production maximum frequency threshold uses exact integer probability', () => {
  const config = { cost: 1 }, statistics = { capWeight: 1n, totalWeight: 10000000n, standardDeviation: 1 };
  assert.throws(() => E.requireProductionStatistics(statistics, config), /ten million/);
  E.requireProductionStatistics(Object.assign({}, statistics, { totalWeight: 9999999n }), config);
  assert.throws(() => E.requireProductionStatistics(Object.assign({}, statistics, { capWeight: 2n, standardDeviation: 0.5 }), config), /volatility/);
});

test('verification detects a positional payout mismatch even with matching file hashes', async t => {
  const directory = await temporary(t);
  const manifest = await E.exportBooks(directory, { rounds: 30, production: false, compress: false, modes: ['base_vault'] });
  const file = path.join(directory, manifest.modes[0].weights);
  const lines = (await fs.readFile(file, 'utf8')).trimEnd().split('\n');
  const row = lines[0].split(','); row[2] = String(Number(row[2]) + 1); lines[0] = row.join(',');
  await fs.writeFile(file, lines.join('\n') + '\n');
  await rewriteManifest(directory, async data => { data.modes[0].files.weights = await V.hashFile(file); });
  await assert.rejects(V.verifyExport(directory), /Positional CSV payout/);
});

test('verification detects corrupt event state even after updating the file hash', async t => {
  const directory = await temporary(t);
  const manifest = await E.exportBooks(directory, { rounds: 30, production: false, compress: false, modes: ['buy_vault'] });
  const file = path.join(directory, manifest.modes[0].events);
  const lines = (await fs.readFile(file, 'utf8')).trimEnd().split('\n');
  const book = JSON.parse(lines[0]); book.events[2].state.coins++; lines[0] = JSON.stringify(book);
  await fs.writeFile(file, lines.join('\n') + '\n');
  await rewriteManifest(directory, async data => { data.modes[0].files.events = await V.hashFile(file); });
  await assert.rejects(V.verifyExport(directory), /Vault next state/);
});

test('verification rejects CSV weight overflow and source provenance tampering', async t => {
  const directory = await temporary(t);
  const manifest = await E.exportBooks(directory, { rounds: 30, production: false, compress: false, modes: ['base_vault'] });
  const file = path.join(directory, manifest.modes[0].weights);
  const original = await fs.readFile(file, 'utf8');
  const lines = original.trimEnd().split('\n'), row = lines[0].split(',');
  row[1] = (W.UINT64_MAX + 1n).toString(); lines[0] = row.join(',');
  await fs.writeFile(file, lines.join('\n') + '\n');
  await rewriteManifest(directory, async data => { data.modes[0].files.weights = await V.hashFile(file); });
  await assert.rejects(V.verifyExport(directory), /64-bit/);
  await fs.writeFile(file, original);
  await rewriteManifest(directory, async data => { data.modes[0].files.weights = await V.hashFile(file); data.sourceHashes['math/model.js'] = '0'.repeat(64); });
  await assert.rejects(V.verifyExport(directory), /source hashes/);
});

test('bounded line reader rejects oversized, empty and truncated publication lines', async t => {
  const directory = await temporary(t), file = path.join(directory, 'lines.txt');
  const read = async maximum => { for await (const line of V.readLines(file, false, maximum)) assert.ok(line); };
  await fs.writeFile(file, 'x'.repeat(128) + '\n');
  await assert.rejects(read(128), /size limit/);
  await fs.writeFile(file, '\n');
  await assert.rejects(read(128), /Empty/);
  await fs.writeFile(file, 'unfinished');
  await assert.rejects(read(128), /final newline/);
});

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { isDeepStrictEqual, parseArgs } = require('node:util');
const B = require('./books');
const W = require('./weights');
const E = require('./export');
const D = require('./distribution');
const Contract = require('../shared/contract');
const M = require('./model');

const normalize = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));

function equal(actual, expected, name) {
  if (!isDeepStrictEqual(normalize(actual), normalize(expected))) throw new Error('Verification failed: ' + name);
}

function localFile(directory, name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || name.includes('\\') || name.includes('/')) throw new RangeError('Invalid publication filename');
  return path.join(directory, name);
}

async function* readLines(filename, compressed, maximum) {
  const source = fs.createReadStream(filename);
  const stream = compressed ? source.pipe(zlib.createZstdDecompress()) : source;
  if (compressed) source.once('error', error => stream.destroy(error));
  let parts = [], length = 0;
  try {
    for await (const chunk of stream) {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
        const part = chunk.subarray(start, stop);
        length += part.length;
        if (length >= maximum) throw new RangeError('Publication line exceeds size limit');
        parts.push(part);
        if (end < 0) break;
        if (!length) throw new Error('Empty publication line');
        yield Buffer.concat(parts, length).toString('utf8');
        parts = []; length = 0; start = end + 1;
      }
    }
    if (length) throw new Error('Publication file lacks a final newline');
  } finally { stream.destroy(); source.destroy(); }
}

async function hashFile(filename) {
  const stat = await fsp.stat(filename);
  if (!stat.isFile() || stat.size >= E.MAX_FILE_BYTES) throw new RangeError('Publication file must be smaller than 4 GiB');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}

async function verifyMode(directory, definition, expected, production) {
  const config = B.mode(definition.name);
  equal(definition.cost, config.cost, 'mode cost');
  equal(definition, { name: expected.name, cost: expected.cost, events: expected.events, weights: expected.weights }, 'manifest mode');
  if (!/\.jsonl(?:\.zst)?$/.test(definition.events) || !/\.csv$/.test(definition.weights)) throw new Error('Invalid publication file type');
  const eventFile = localFile(directory, definition.events), weightFile = localFile(directory, definition.weights);
  const files = { events: await hashFile(eventFile), weights: await hashFile(weightFile) };
  equal(files, expected.files, 'file hashes and sizes');
  const rows = readLines(weightFile, false, 128)[Symbol.asyncIterator]();
  const payouts = [], weights = [], masks = [];
  let eventCount = 0, maxBookBytes = 0, witness;
  try {
    for await (const line of readLines(eventFile, definition.events.endsWith('.zst'), B.MAX_BOOK_BYTES)) {
      if (payouts.length >= E.MAX_ROUNDS) throw new RangeError('Too many published rounds');
      const row = await rows.next();
      if (row.done) throw new Error('Missing positional CSV row');
      const match = /^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(row.value);
      if (!match) throw new Error('Invalid unsigned integer CSV row');
      const position = payouts.length, book = JSON.parse(line);
      const csvId = W.uint64(BigInt(match[1]), 'Simulation number', false);
      const weight = W.uint64(BigInt(match[2]), 'Weight', true);
      const payout = W.uint64(BigInt(match[3]), 'Payout', false);
      if (csvId !== BigInt(position)) throw new Error('CSV simulation number does not match position');
      equal(book.id, position, 'book position');
      if (payout !== BigInt(book.payoutMultiplier)) throw new Error('Positional CSV payout does not match book');
      B.validateBook(book, { mode: config.name }); Contract.validateBook(book, { mode: config.name });
      payouts.push(book.payoutMultiplier); weights.push(weight); masks.push(E.featureMask(book));
      eventCount += book.events.length; maxBookBytes = Math.max(maxBookBytes, Buffer.byteLength(line));
      if (position === expected.witness.row) witness = book;
    }
    if (!(await rows.next()).done) throw new Error('Extra CSV row');
  } finally { await rows.return(); }
  if (production && payouts.length < E.MIN_ROUNDS + 1) throw new Error('Production publication lacks 100000 sampled rounds');
  equal(payouts.length, expected.rounds, 'round count'); equal(expected.sampledRounds, payouts.length - 1, 'sampled round count');
  equal(expected.witness.row, payouts.length - 1, 'witness row'); equal(expected.witness.id, payouts.length - 1, 'witness id');
  equal(witness, B.maxWinBook(config.name, payouts.length - 1), 'reachable maximum witness');
  const statistics = W.summarize(payouts, weights, config.cost, config.maxWinUnits);
  if (statistics.rtpNumerator !== W.TARGET_NUMERATOR || statistics.rtpDenominator !== W.TARGET_DENOMINATOR) throw new Error('RTP is not exactly 96.3 percent');
  if (config.cost === 1 && statistics.standardDeviation < 0.6) throw new Error('Minimum mode volatility is below the required threshold');
  if (production) E.requireProductionStatistics(statistics, config);
  equal(expected.distribution, D.profile(config), 'mode distribution profile');
  const sourceWeights = E.sourceWeights(payouts, config);
  const balanced = W.balance(payouts, config.cost, { sourceWeights, maxPayoutUnits: config.maxWinUnits });
  equal(weights, balanced.weights, 'published balancing weights');
  equal(statistics, expected.statistics, 'weighted statistics');
  equal(balanced.sourceStatistics, expected.sourceStatistics, 'source statistics');
  equal(balanced.factors, expected.balancing, 'balancing factors');
  equal(balanced.target, expected.target, 'target fraction');
  const sampled = W.summarize(payouts.slice(0, -1), payouts.slice(0, -1).map(() => 1n), config.cost, config.maxWinUnits);
  equal(sampled, expected.sampledStatistics, 'sampled statistics');
  const features = E.featureStatistics(masks, weights);
  if (production) E.requireDiversity(features, config);
  equal(features, expected.features, 'feature statistics');
  equal(eventCount, expected.eventCount, 'event count'); equal(maxBookBytes, expected.maxBookBytes, 'maximum book bytes');
  equal(expected.witness.payoutUnits, config.maxWinUnits, 'witness payout'); equal(expected.witness.sourceWeight, E.WITNESS_WEIGHT, 'witness source mass');
  equal(expected.witness.finalWeight, weights[weights.length - 1], 'witness published mass');
  equal(expected.witness.frequency, Number(weights[weights.length - 1]) / Number(statistics.totalWeight), 'witness frequency');
  if (production && config.kind === 'wheel') for (let i = 0; i < 8; i++) if (!features['wheel' + i].count) throw new Error('Missing Wheel segment');
  return { name: config.name, rounds: payouts.length, statistics: normalize(statistics), files, maxBookBytes };
}

async function verifyExport(directory, options) {
  const opts = options || {}, destination = path.resolve(directory);
  const index = JSON.parse(await fsp.readFile(path.join(destination, 'index.json'), 'utf8'));
  const manifest = JSON.parse(await fsp.readFile(path.join(destination, 'manifest.json'), 'utf8'));
  equal(manifest.version, E.VERSION, 'publication version'); equal(manifest.schema, B.SCHEMA, 'book schema');
  equal(manifest.modelProfile, M.PROFILE_VERSION, 'model profile');
  equal(manifest.targetRtp, { numerator: '963', denominator: '1000', percent: 96.3 }, 'declared RTP');
  equal(manifest.maxPayoutUnits, B.CAP_UNITS, 'declared maximum');
  if (typeof manifest.production !== 'boolean' || (opts.requireProduction && !manifest.production)) throw new Error('Publication is not a production export');
  if (!Array.isArray(index.modes) || !index.modes.length || index.modes.length > 20 || new Set(index.modes.map(item => item.name)).size !== index.modes.length) throw new Error('Invalid mode list');
  if (manifest.production && (index.modes.length !== B.MODES.length || B.MODES.some(item => !index.modes.some(config => config.name === item.name)))) throw new Error('Production publication requires all ' + B.MODES.length + ' modes');
  if (!Number.isSafeInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > 0xffffffff) throw new Error('Invalid source seed');
  equal(manifest.generation.sampledSourceWeight, E.SOURCE_WEIGHT, 'sampled source weight');
  equal(manifest.generation.witnessSourceWeight, E.WITNESS_WEIGHT, 'witness source weight');
  equal(manifest.sourceHashes, await E.sourceHashes(), 'current math source hashes');
  equal(manifest.modes.length, index.modes.length, 'manifest mode count');
  const files = index.modes.flatMap(item => [item.events, item.weights]);
  if (new Set(files).size !== files.length) throw new Error('Publication modes reuse files');
  const modes = [];
  for (let i = 0; i < index.modes.length; i++) {
    equal(manifest.modes[i].kind, B.mode(index.modes[i].name).kind, 'declared feature');
    equal(manifest.modes[i].maxWinUnits, B.mode(index.modes[i].name).maxWinUnits, 'declared mode maximum');
    equal(manifest.modes[i].seed, E.modeSeed(manifest.seed, index.modes[i].name), 'derived mode seed');
    modes.push(await verifyMode(destination, index.modes[i], manifest.modes[i], manifest.production));
  }
  return { version: manifest.version, production: manifest.production, sourceHashesVerified: true, modes };
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, production: { type: 'boolean' } } });
  if (!values.dir) throw new Error('Specify --dir with a publication directory');
  const result = await verifyExport(values.dir, { requireProduction: !!values.production });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

module.exports = Object.freeze({ readLines, hashFile, verifyMode, verifyExport });

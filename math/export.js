'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parseArgs } = require('node:util');
const M = require('./model');
const B = require('./books');
const W = require('./weights');
const D = require('./distribution');
const Contract = require('../shared/contract');

const VERSION = 'squid-engine-3';
const MIN_ROUNDS = 100000;
const MAX_ROUNDS = 10000000;
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
const SOURCE_WEIGHT = 1000n;
const WITNESS_WEIGHT = 50n;
const MAX_WIN_FREQUENCY_DENOMINATOR = 10000000n;
const FEATURE_NAMES = ['trigger', 'attack', 'kraken', 'reef', 'vault', 'cash', 'super', 'rage', 'wheel0', 'wheel1', 'wheel2', 'wheel3', 'wheel4', 'wheel5', 'wheel6', 'wheel7', 'wilds3', 'wilds4', 'wilds5', 'wilds6', 'retrigger', 'gold'];
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';

class FileMeter extends Transform {
  constructor() { super(); this.bytes = 0; this.hash = crypto.createHash('sha256'); }
  _transform(chunk, encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes >= MAX_FILE_BYTES) { callback(new RangeError('Publication file must be smaller than 4 GiB')); return; }
    this.hash.update(chunk); callback(null, chunk);
  }
  result() { return { bytes: this.bytes, sha256: this.hash.digest('hex') }; }
}

function featureMask(book) {
  let mask = 0;
  const add = name => { mask |= 1 << FEATURE_NAMES.indexOf(name); };
  const base = book.events[0].base;
  if (base.fsAward) { add('trigger'); add('wilds' + Math.min(5, base.triggerCount)); }
  if (book.events[0].kind === 'wilds' && base.triggerCount === 6) add('wilds6');
  if (base.attack && base.attack.length) add('attack');
  for (const event of book.events) {
    if (event.type.endsWith('Start')) { add(event.type.slice(0, -5)); if (event.sup) add('super'); }
    if (event.type === 'wheel') { add('wheel' + event.segment); if (event.result.kind === 'cash') add('cash'); }
    if (event.type === 'krakenStep') { if (event.result.awaken) add('rage'); if (event.result.retrigger) add('retrigger'); }
    if (event.type === 'reefRespin' && event.result.gold) add('gold');
  }
  return mask;
}

function featureStatistics(masks, weights) {
  const result = {};
  const total = weights.reduce((sum, value) => sum + value, 0n);
  for (let bit = 0; bit < FEATURE_NAMES.length; bit++) {
    let count = 0, weight = 0n;
    for (let i = 0; i < masks.length; i++) if (masks[i] & (1 << bit)) { count++; weight += weights[i]; }
    result[FEATURE_NAMES[bit]] = { count, weight, frequency: Number(weight) / Number(total) };
  }
  return result;
}

function modeSeed(seed, name) {
  const digest = crypto.createHash('sha256').update(seed + ':' + name).digest();
  return digest.readUInt32LE(0);
}

async function sourceHashes() {
  const result = {};
  for (const name of ['model.js', 'books.js', 'weights.js', 'distribution.js', 'export.js']) {
    result['math/' + name] = crypto.createHash('sha256').update(await fsp.readFile(path.join(__dirname, name))).digest('hex');
  }
  result['shared/modes.js'] = crypto.createHash('sha256').update(await fsp.readFile(path.join(__dirname, '../shared/modes.js'))).digest('hex');
  return result;
}

async function writeStream(file, chunks, compress) {
  const meter = new FileMeter(), streams = [Readable.from(chunks)];
  if (compress) {
    if (typeof zlib.createZstdCompress !== 'function') throw new Error('Node.js with Zstandard support is required');
    streams.push(zlib.createZstdCompress());
  }
  streams.push(meter, fs.createWriteStream(file, { flags: 'wx' }));
  await pipeline(...streams);
  return meter.result();
}

function requireDiversity(features, config) {
  if (config.kind === 'wilds') {
    if (!features.wilds6.count || features.trigger.count || features.attack.count) throw new Error('Invalid six-wild outcome diversity');
    return;
  }
  if (!features.trigger.count || !features.wilds3.count || !features.wilds4.count || !features.wilds5.count) throw new Error('Missing required trigger outcomes');
  if (config.kind === 'wheel') {
    for (let i = 0; i < M.WHEEL.length; i++) if (!features['wheel' + i].count) throw new Error('Missing Wheel segment ' + i);
  } else if (!features[config.kind].count) throw new Error('Missing mode feature');
}

function requireProductionStatistics(statistics, config) {
  if (statistics.capWeight * MAX_WIN_FREQUENCY_DENOMINATOR <= statistics.totalWeight) throw new Error('Maximum win frequency must exceed one in ten million');
  if (config.cost === 1 && statistics.standardDeviation < 0.6) throw new Error('Minimum mode volatility is below the required threshold');
  D.requireStatistics(statistics, config);
}

function sourceWeights(payouts, config) {
  return Array.from(payouts, (payout, i) => i === payouts.length - 1 ? WITNESS_WEIGHT : D.sourceWeight(payout, config, SOURCE_WEIGHT));
}

async function exportMode(directory, config, options) {
  const { rounds, seed, compress, production } = options;
  const count = rounds + 1, payouts = new Uint32Array(count), masks = new Uint32Array(count);
  const derivedSeed = modeSeed(seed, config.name), rand = M.mulberry32(derivedSeed);
  const eventsName = 'events_' + config.name + '.jsonl' + (compress ? '.zst' : '');
  const weightsName = 'lookup_' + config.name + '.csv';
  let maxBookBytes = 0, eventCount = 0;
  async function* books() {
    for (let id = 0; id < count; id++) {
      const book = id === rounds ? B.maxWinBook(config.name, id) : D.sampleBook(rand, config, id);
      B.validateBook(book, { mode: config.name }); Contract.validateBook(book, { mode: config.name });
      const line = JSON.stringify(book), bytes = Buffer.byteLength(line);
      if (bytes >= B.MAX_BOOK_BYTES) throw new RangeError('Book is too large');
      maxBookBytes = Math.max(maxBookBytes, bytes); eventCount += book.events.length;
      payouts[id] = book.payoutMultiplier; masks[id] = featureMask(book);
      yield line + '\n';
    }
  }
  const eventsFile = await writeStream(path.join(directory, eventsName), books(), compress);
  const balanced = W.balance(payouts, config.cost, { sourceWeights: sourceWeights(payouts, config), maxPayoutUnits: config.maxWinUnits });
  const features = featureStatistics(masks, balanced.weights);
  if (production) { requireDiversity(features, config); requireProductionStatistics(balanced.statistics, config); }
  function* rows() {
    for (let i = 0; i < count; i++) yield i + ',' + balanced.weights[i] + ',' + payouts[i] + '\n';
  }
  const weightsFile = await writeStream(path.join(directory, weightsName), rows(), false);
  const sampled = W.summarize(payouts.subarray(0, rounds), Array.from({ length: rounds }, () => 1n), config.cost, config.maxWinUnits);
  return {
    name: config.name, cost: config.cost, kind: config.kind, maxWinUnits: config.maxWinUnits, seed: derivedSeed, rounds: count, sampledRounds: rounds,
    events: eventsName, weights: weightsName, eventCount, maxBookBytes,
    files: { events: eventsFile, weights: weightsFile },
    target: balanced.target, distribution: D.profile(config), statistics: balanced.statistics, sampledStatistics: sampled,
    sourceStatistics: balanced.sourceStatistics, balancing: balanced.factors, features,
    witness: { row: rounds, id: rounds, payoutUnits: config.maxWinUnits, sourceWeight: WITNESS_WEIGHT, finalWeight: balanced.weights[rounds], frequency: Number(balanced.weights[rounds]) / Number(balanced.statistics.totalWeight) },
  };
}

async function exportBooks(directory, options) {
  const opts = Object.assign({ rounds: MIN_ROUNDS, seed: 20261023, compress: true, production: true }, options);
  if (!Number.isSafeInteger(opts.rounds) || opts.rounds < (opts.production ? MIN_ROUNDS : 2) || opts.rounds >= MAX_ROUNDS) throw new RangeError('Invalid production round count');
  if (!Number.isSafeInteger(opts.seed) || opts.seed < 0 || opts.seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer');
  const configs = opts.modes ? opts.modes.map(name => B.mode(name)) : B.MODES;
  if (!configs.length || configs.length > 20 || new Set(configs.map(item => item.name)).size !== configs.length) throw new RangeError('Invalid publication mode list');
  if (opts.production && (configs.length !== B.MODES.length || B.MODES.some(item => !configs.some(config => config.name === item.name)))) throw new RangeError('Production publication requires all ' + B.MODES.length + ' modes');
  const destination = path.resolve(directory);
  await fsp.mkdir(destination, { recursive: true });
  if ((await fsp.readdir(destination)).length) throw new Error('Output directory must be empty');
  const hashes = await sourceHashes();
  const modes = [];
  for (const config of configs) {
    const result = await exportMode(destination, config, opts);
    modes.push(result);
    if (opts.onMode) await opts.onMode(result);
  }
  const afterHashes = await sourceHashes();
  if (JSON.stringify(hashes) !== JSON.stringify(afterHashes)) throw new Error('Math sources changed during export');
  const manifest = {
    version: VERSION, schema: B.SCHEMA, modelProfile: M.PROFILE_VERSION, node: process.version,
    generatedAt: new Date().toISOString(), production: !!opts.production, seed: opts.seed,
    targetRtp: { numerator: '963', denominator: '1000', percent: 96.3 }, maxPayoutUnits: B.CAP_UNITS,
    sourceHashes: hashes,
    generation: { sampledSourceWeight: SOURCE_WEIGHT.toString(), witnessSourceWeight: WITNESS_WEIGHT.toString(), witnessPurpose: 'Explicit reachable maximum outcome with reduced source mass', balancing: 'Two payout groups receive exact positive integer factors; this intentionally changes outcome probabilities from the reference model', settlement: 'Payout units are hundredths of the base bet; RGS owns monetary settlement' },
    modes,
  };
  const index = { modes: modes.map(item => ({ name: item.name, cost: item.cost, events: item.events, weights: item.weights })) };
  await fsp.writeFile(path.join(destination, 'manifest.json'), json(manifest), { flag: 'wx' });
  await fsp.writeFile(path.join(destination, 'index.json'), json(index), { flag: 'wx' });
  return manifest;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, rounds: { type: 'string' }, seed: { type: 'string' }, modes: { type: 'string' }, preview: { type: 'boolean' }, uncompressed: { type: 'boolean' } } });
  if (!values.out) throw new Error('Specify --out with an empty output directory');
  const manifest = await exportBooks(values.out, {
    rounds: values.rounds === undefined ? MIN_ROUNDS : Number(values.rounds),
    seed: values.seed === undefined ? 20261023 : Number(values.seed),
    modes: values.modes ? values.modes.split(',') : undefined,
    production: !values.preview, compress: !values.uncompressed,
    onMode: result => process.stdout.write(json({ mode: result.name, rounds: result.rounds, rtp: result.statistics.rtpPercent, bytes: result.files.events.bytes, maxWinFrequency: result.statistics.maxWinFrequency })),
  });
  process.stdout.write(json({ directory: path.resolve(values.out), production: manifest.production, modes: manifest.modes.length }));
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

module.exports = Object.freeze({ VERSION, MIN_ROUNDS, MAX_ROUNDS, MAX_FILE_BYTES, SOURCE_WEIGHT, WITNESS_WEIGHT, MAX_WIN_FREQUENCY_DENOMINATOR, FEATURE_NAMES, featureMask, featureStatistics, requireDiversity, requireProductionStatistics, sourceWeights, modeSeed, sourceHashes, exportMode, exportBooks });

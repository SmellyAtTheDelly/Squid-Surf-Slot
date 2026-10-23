'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const M = require('../math/model.js');
const C = require('../shared/modes.js');
const { Moments } = require('./statistics.js');

const MODES = ['base', 'ante', 'buy'];
const KINDS = [...M.BONUS_KINDS, 'wilds'];

function positiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(name + ' must be a positive safe integer');
  return n;
}

function parseArgs(args) {
  const positional = [], options = {};
  const names = new Set(['mode', 'kind', 'bet-cents', 'seed', 'spins', 'buys']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--help') options[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!names.has(name) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error('Invalid option: ' + arg);
      options[name] = args[++i];
    } else positional.push(arg);
  }
  if (positional.length > 3) throw new Error('Expected at most three positional arguments');
  const seed = Number(options.seed ?? positional[2] ?? 12345);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer');
  const modes = options.mode == null || options.mode === 'all' ? MODES.slice() : options.mode.split(',');
  const kinds = options.kind == null || options.kind === 'all' ? KINDS.slice() : options.kind.split(',');
  if (!modes.length || modes.some(mode => !MODES.includes(mode)) || new Set(modes).size !== modes.length) throw new Error('Mode must be base, ante, buy, all, or a comma-separated selection');
  if (!kinds.length || kinds.some(kind => !KINDS.includes(kind)) || new Set(kinds).size !== kinds.length) throw new Error('Unknown or duplicate bonus choice');
  if (!C.MODES.some(item => modes.includes(item.name.split('_')[0]) && kinds.includes(item.kind))) throw new Error('No published mode matches this selection; natural play uses vault');
  return {
    spins: positiveInteger(options.spins ?? positional[0] ?? 2000000, 'Spins'),
    buys: positiveInteger(options.buys ?? positional[1] ?? 100000, 'Buys'),
    seed,
    betCents: positiveInteger(options['bet-cents'] ?? 100, 'Bet cents'),
    modes,
    kinds,
    json: !!options.json,
    help: !!options.help,
  };
}

function fingerprint() {
  const sources = {};
  for (const name of ['math/model.js', 'shared/modes.js', 'tools/statistics.js', 'tools/rtp-sim.js', 'tools/rtp-exact.js']) {
    sources[name] = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', name))).digest('hex');
  }
  return sources;
}

function simulateCell(config, mode, kind) {
  const selected = C.MODES.find(item => item.name === mode + '_' + kind);
  if (!selected) throw new Error('Unknown published mode: ' + mode + '_' + kind);
  const count = mode === 'buy' ? config.buys : config.spins;
  const seed = (config.seed + Math.imul(MODES.indexOf(mode) + 1, 0x9e3779b1) + Math.imul(KINDS.indexOf(kind) + 1, 0x85ebca6b)) >>> 0;
  const rand = M.mulberry32(seed), moments = new Moments();
  let totalCostCents = 0, costCents = null, hits = 0, zeros = 0, losses = 0, profits = 0, breaksEven = 0, caps = 0, triggers = 0, attacks = 0;
  for (let i = 0; i < count; i++) {
    const round = M.playRound(rand, { kind, betCents: config.betCents, ante: mode === 'ante', buy: mode === 'buy' });
    const s = round.settlement;
    if (costCents == null) costCents = s.costCents;
    if (s.costCents !== costCents) throw new Error('Cost changed within simulation cell');
    if (s.costCents <= 0 || !Number.isSafeInteger(s.costCents) || !Number.isSafeInteger(s.paidCents)) throw new Error('Settlement must use integer cents and a positive cost');
    moments.add(s.paidCents);
    totalCostCents += s.costCents;
    if (!Number.isSafeInteger(totalCostCents) || !Number.isSafeInteger(moments.sum)) throw new RangeError('Simulation totals exceed safe integer cents');
    if (s.paidCents > 0) hits++; else zeros++;
    if (s.netCents < 0) losses++; else if (s.netCents > 0) profits++; else breaksEven++;
    if (s.paidCents === Math.round(selected.maxWinUnits * s.betCents / M.UNIT_SCALE)) caps++;
    if (round.base.fsAward) triggers++;
    if (round.base.attack) attacks++;
  }
  const s = moments.summary(), fraction = n => n / count;
  return {
    mode, kind, seed, rounds: count, betCents: config.betCents, costCents,
    totalCostCents, totalPaidCents: s.sum, totalNetCents: s.sum - totalCostCents,
    rtpPercent: 100 * s.sum / totalCostCents,
    rtpStandardErrorPercentagePoints: s.standardError == null ? null : 100 * s.standardError / costCents,
    rtpConfidence95Percent: s.confidence95 && s.confidence95.map(v => 100 * v / costCents),
    meanWinXBaseBet: s.mean / config.betCents,
    standardDeviationXBaseBet: s.standardDeviation == null ? null : s.standardDeviation / config.betCents,
    standardDeviationXWager: s.standardDeviation == null ? null : s.standardDeviation / costCents,
    maxObservedXBaseBet: s.max / config.betCents,
    hitFrequency: fraction(hits), zeroPayoutFrequency: fraction(zeros),
    netLossFrequency: fraction(losses), netProfitFrequency: fraction(profits), breakEvenFrequency: fraction(breaksEven),
    capHitFrequency: fraction(caps), bonusTriggerFrequency: fraction(triggers), attackFrequency: fraction(attacks),
    counts: { hits, zeros, losses, profits, breaksEven, caps, triggers, attacks },
  };
}

function run(config) {
  const report = {
    method: 'Procedural candidate Monte Carlo with cent settlement; excludes publication weights and does not estimate the published 96.3% RTP',
    profile: M.PROFILE_VERSION,
    unitScale: M.UNIT_SCALE,
    seed: config.seed,
    nodeVersion: process.version,
    startedAt: new Date().toISOString(),
    command: [process.execPath, ...process.argv.slice(1)],
    sourceSha256: fingerprint(),
    confidenceMethod: 'Two-sided 95% normal approximation using unbiased sample variance and standard error; not a guarantee of convergence for rare outcomes',
    volatilityMeasure: 'Sample standard deviation of gross return, in base-bet and actual-wager multiples',
    config,
    results: [],
  };
  for (const mode of config.modes) for (const kind of config.kinds) {
    if (C.MODES.some(item => item.name === mode + '_' + kind)) report.results.push(simulateCell(config, mode, kind));
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

function printReport(report) {
  console.log(report.method + ' | profile ' + report.profile + ' | seed ' + report.seed);
  console.log(report.confidenceMethod);
  for (const r of report.results) {
    const ci = r.rtpConfidence95Percent ? r.rtpConfidence95Percent.map(v => v.toFixed(3)).join(', ') : 'unavailable';
    const se = r.rtpStandardErrorPercentagePoints == null ? 'unavailable' : r.rtpStandardErrorPercentagePoints.toFixed(3);
    const sd = r.standardDeviationXWager == null ? 'unavailable' : r.standardDeviationXWager.toFixed(3);
    console.log(r.mode.toUpperCase().padEnd(4) + ' ' + r.kind.padEnd(6) + ' n=' + r.rounds + ' seed=' + r.seed + ' bet=' + r.betCents + 'c cost=' + r.costCents + 'c RTP=' + r.rtpPercent.toFixed(3) + '% SE=' + se + 'pp 95%CI=[' + ci + ']% SD=' + sd + 'x wager hit=' + (r.hitFrequency * 100).toFixed(3) + '% loss=' + (r.netLossFrequency * 100).toFixed(3) + '% zero=' + (r.zeroPayoutFrequency * 100).toFixed(3) + '% cap=' + r.counts.caps + ' max=' + r.maxObservedXBaseBet.toFixed(2) + 'x base bet');
  }
}

function runCli(args = process.argv.slice(2)) {
  try {
    const config = parseArgs(args);
    if (config.help) {
      console.log('Usage: node tools/rtp-sim.js [spinsPerChoice] [buysPerChoice] [seed] [--mode base|ante|buy|all] [--kind kraken|reef|vault|wheel|wilds|all] [--bet-cents 100] [--json]');
      console.log('Natural play uses vault. Only the seven published mode combinations are sampled. --spins, --buys and --seed override positional arguments. Use math:verify for exact published RTP.');
      return;
    }
    const report = run(config);
    if (config.json) console.log(JSON.stringify(report, null, 2)); else printReport(report);
    return report;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = { parseArgs, simulateCell, run, runCli };

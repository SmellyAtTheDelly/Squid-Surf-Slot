'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const M = require('../math/model.js');
const { Moments } = require('./statistics.js');

function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--help') options[arg.slice(2)] = true;
    else if (arg === '--bet-cents' || arg === '--pre-win-units') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      options[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('--')) throw new Error('Unknown option: ' + arg);
    else positional.push(arg);
  }
  if (positional.length > 2) throw new Error('Expected at most two positional arguments');
  const runs = Number(positional[0] ?? 200000), seed = Number(positional[1] ?? 7);
  const betCents = Number(options['bet-cents'] ?? 100), preWinUnits = Number(options['pre-win-units'] ?? 0);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new RangeError('Runs must be a positive safe integer');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer');
  if (!Number.isSafeInteger(betCents) || betCents < 1) throw new RangeError('Bet cents must be a positive safe integer');
  if (!Number.isSafeInteger(preWinUnits) || preWinUnits < 0 || preWinUnits > M.MAX_WIN * M.UNIT_SCALE) throw new RangeError('Pre-win units must be within the round cap');
  return { runs, seed, betCents, preWinUnits, json: !!options.json, help: !!options.help };
}

function simulateCell(config, kind, pearls, sup) {
  const seed = (config.seed + Math.imul(M.BONUS_KINDS.indexOf(kind) + 1, 0x9e3779b1) + Math.imul(pearls, 0x85ebca6b) + (sup ? 0xc2b2ae35 : 0)) >>> 0;
  const rand = M.mulberry32(seed), units = new Moments(), paid = new Moments();
  let zeros = 0, caps = 0, big = 0;
  for (let i = 0; i < config.runs; i++) {
    const round = M.createRound(config.betCents);
    M.awardRound(round, config.preWinUnits);
    const award = M.awardRound(round, M.toUnits(M.playBonus(rand, kind, pearls, sup)));
    const settlement = M.closeRound(round);
    units.add(award.units);
    paid.add(award.paidCents / config.betCents);
    if (award.paidCents === 0) zeros++;
    if (settlement.winUnits === M.MAX_WIN * M.UNIT_SCALE) caps++;
    if (award.paidCents >= 500 * config.betCents) big++;
  }
  return {
    kind, pearls, super: sup, seed, rounds: config.runs,
    acceptedWinUnits: units.summary(), paidXBaseBet: paid.summary(),
    zeroPayoutFrequency: zeros / config.runs, capHitFrequency: caps / config.runs, atLeast500xFrequency: big / config.runs,
    counts: { zeros, caps, atLeast500x: big },
  };
}

function runCli(args = process.argv.slice(2)) {
  try {
    const config = parseArgs(args);
    if (config.help) {
      console.log('Usage: node tools/bonus-sim.js [runsPerCell] [seed] [--bet-cents 100] [--pre-win-units 0] [--json]');
      console.log('Conditional bonus-only means, not RTP. One multiplier unit is 1 / UNIT_SCALE of the base bet. Pre-win units reserve part of the shared round cap.');
      return;
    }
    const sourceSha256 = {};
    for (const name of ['math/model.js', 'tools/statistics.js', 'tools/bonus-sim.js']) sourceSha256[name] = createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', name))).digest('hex');
    const report = {
      method: 'Conditional bonus-only seeded Monte Carlo using production bonus math and shared round settlement',
      profile: M.PROFILE_VERSION, unitScale: M.UNIT_SCALE, nodeVersion: process.version, config,
      startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)], sourceSha256,
      interpretation: 'Means exclude trigger-spin awards and feature purchase cost. They are not RTP and do not assert equal bonus values. Optional pre-win units consume cap allowance before the bonus.',
      confidenceMethod: 'Two-sided 95% normal approximation using unbiased sample variance and standard error; rare outcomes can converge slowly',
      results: [],
    };
    for (const kind of M.BONUS_KINDS) {
      for (const pearls of [3, 4, 5]) {
        report.results.push(simulateCell(config, kind, pearls, false));
        if (kind !== 'wheel') report.results.push(simulateCell(config, kind, pearls, true));
      }
    }
    report.finishedAt = new Date().toISOString();
    if (config.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(report.method + ' | profile ' + report.profile + ' | seed ' + config.seed);
      console.log(report.interpretation);
      console.log(report.confidenceMethod);
      for (const r of report.results) {
        const s = r.paidXBaseBet, ci = s.confidence95 ? s.confidence95.map(v => v.toFixed(3)).join(', ') : 'unavailable';
        const se = s.standardError == null ? 'unavailable' : s.standardError.toFixed(3);
        const sd = s.standardDeviation == null ? 'unavailable' : s.standardDeviation.toFixed(3);
        console.log(r.kind.padEnd(6) + ' pearls=' + r.pearls + ' super=' + r.super + ' n=' + r.rounds + ' seed=' + r.seed + ' mean=' + s.mean.toFixed(3) + 'x SE=' + se + 'x 95%CI=[' + ci + ']x SD=' + sd + 'x zero=' + (100 * r.zeroPayoutFrequency).toFixed(3) + '% cap=' + r.counts.caps + ' max=' + s.max.toFixed(2) + 'x base bet');
      }
    }
    return report;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = { parseArgs, simulateCell, runCli };

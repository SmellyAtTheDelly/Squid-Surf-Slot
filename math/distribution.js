'use strict';

const M = require('./model');
const B = require('./books');

const TAIL_SYMBOLS = Object.freeze([[M.S.SILVER, 1], [M.S.GOLD, 2], [M.S.ANCHOR, 7]].map(Object.freeze));
const WILDS_PROFILE = Object.freeze({
  name: 'six-wilds-extreme-1',
  candidateInterval: 20,
  candidateSymbolWeight: 1500,
  candidateTargets: TAIL_SYMBOLS,
  highPayoutUnits: 75000,
  minimumStandardDeviation: 4,
  maximumHitFrequency: 0.1,
  maximumProfitFrequency: 0.08,
  zeroSourceWeight: '1000',
  ordinarySourceWeight: '1',
  highSourceWeight: '1000',
  maximumSourceWeight: '50',
});
const REFERENCE_PROFILE = Object.freeze({ name: 'reference-sampling-1' });
const TAIL_WEIGHTS = new Map(TAIL_SYMBOLS.map(([target]) => [target, Object.freeze(M.BUY_WEIGHTS.map(row => Object.freeze(row.map((weight, symbol) => symbol === target ? WILDS_PROFILE.candidateSymbolWeight : weight))))]));

function profile(config) {
  return config.kind === 'wilds' ? WILDS_PROFILE : REFERENCE_PROFILE;
}

function sourceWeight(payout, config, fallback) {
  if (config.kind !== 'wilds') return fallback;
  if (payout === config.maxWinUnits) return BigInt(WILDS_PROFILE.maximumSourceWeight);
  if (payout === 0) return BigInt(WILDS_PROFILE.zeroSourceWeight);
  return BigInt(payout >= WILDS_PROFILE.highPayoutUnits ? WILDS_PROFILE.highSourceWeight : WILDS_PROFILE.ordinarySourceWeight);
}

function sampleBook(rand, config, id) {
  if (config.kind !== 'wilds' || id % WILDS_PROFILE.candidateInterval) return B.generateBook(rand, { mode: config.name, id });
  const symbol = M.pickWeighted(TAIL_SYMBOLS, rand), board = M.spinGrid(TAIL_WEIGHTS.get(symbol), rand), tape = [];
  for (let r = 0; r < M.REELS; r++) {
    let scatter = false;
    for (const value of board[r]) {
      const weights = M.BUY_WEIGHTS[r].map((weight, item) => scatter && item === M.S.SCATTER ? 0 : weight);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const lower = weights.slice(0, value).reduce((sum, weight) => sum + weight, 0);
      tape.push((lower + weights[value] / 2) / total);
      if (value === M.S.SCATTER) scatter = true;
    }
  }
  let cursor = 0;
  return B.generateBook(() => cursor < tape.length ? tape[cursor++] : rand(), { mode: config.name, id });
}

function requireStatistics(statistics, config) {
  if (config.kind !== 'wilds') return;
  if (!Number.isFinite(statistics.standardDeviation) || statistics.standardDeviation < WILDS_PROFILE.minimumStandardDeviation) throw new Error('Six-wild volatility is below the required threshold');
  if (statistics.hitWeight * 10n > statistics.totalWeight) throw new Error('Six-wild hit frequency exceeds ten percent');
  if (statistics.profitWeight * 100n > statistics.totalWeight * 8n) throw new Error('Six-wild profit frequency exceeds eight percent');
}

module.exports = Object.freeze({ WILDS_PROFILE, profile, sourceWeight, sampleBook, requireStatistics });

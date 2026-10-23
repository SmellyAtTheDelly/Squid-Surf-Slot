const M = require('../js/math.js');

function reelTotal(weights, rows, scatter) {
  if (!Array.isArray(weights) || !weights.length || weights.some(w => !Number.isFinite(w) || w < 0)) throw new RangeError('Weights must be finite non-negative numbers');
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError('Rows must be a positive integer');
  if (!Number.isInteger(scatter) || scatter < 0 || scatter >= weights.length) throw new RangeError('Scatter symbol is outside the reel weights');
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('Reel weight total must be positive and finite');
  if (rows > 1 && total === weights[scatter]) throw new RangeError('Reel must have a non-scatter symbol after its first scatter');
  return total;
}

function scatterProbability(weights, rows = M.ROWS, scatter = M.S.SCATTER) {
  const total = reelTotal(weights, rows, scatter);
  return 1 - Math.pow(1 - weights[scatter] / total, rows);
}

function poissonBinomial(probabilities) {
  if (!Array.isArray(probabilities) || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new RangeError('Probabilities must be between zero and one');
  let distribution = [1];
  for (const p of probabilities) {
    const next = new Array(distribution.length + 1).fill(0);
    for (let i = 0; i < distribution.length; i++) {
      next[i] += distribution[i] * (1 - p);
      next[i + 1] += distribution[i] * p;
    }
    distribution = next;
  }
  return distribution;
}

function reelDistribution(weights, rows = M.ROWS, scatter = M.S.SCATTER) {
  const total = reelTotal(weights, rows, scatter);
  const distribution = [], symbols = [];
  function visit(probability, hasScatter) {
    if (symbols.length === rows) {
      distribution.push({ symbols: symbols.slice(), probability });
      return;
    }
    const remaining = total - (hasScatter ? weights[scatter] : 0);
    for (let sym = 0; sym < weights.length; sym++) {
      if (!weights[sym] || (hasScatter && sym === scatter)) continue;
      symbols.push(sym);
      visit(probability * weights[sym] / remaining, hasScatter || sym === scatter);
      symbols.pop();
    }
  }
  visit(1, false);
  return distribution;
}

function lineExpectation(weightSet, options = {}) {
  const rows = options.rows ?? M.ROWS, scatter = options.scatter ?? M.S.SCATTER;
  const wild = options.wild ?? M.S.WILD, pays = options.pays ?? M.PAYS;
  if (!Array.isArray(weightSet) || !weightSet.length) throw new RangeError('At least one reel is required');
  if (!Number.isInteger(wild) || wild < 0 || wild === scatter) throw new RangeError('Wild symbol must be distinct from scatter');
  if (!Array.isArray(pays) || pays.some(p => !Array.isArray(p) || p.length < weightSet.length - 2 || p.some(v => !Number.isFinite(v) || v < 0))) throw new RangeError('Paytable must cover every payable reel length');
  const reels = weightSet.map(weights => {
    const distribution = reelDistribution(weights, rows, scatter);
    if (wild >= weights.length || pays.length > weights.length) throw new RangeError('Paytable or wild symbol is outside the reel weights');
    return distribution;
  });
  let total = 0;
  const symbols = pays.map((pay, sym) => {
    const stats = reels.map(reel => {
      let meanCount = 0, zeroProbability = 0;
      for (const outcome of reel) {
        const count = outcome.symbols.reduce((n, s) => n + (s === sym || s === wild ? 1 : 0), 0);
        meanCount += count * outcome.probability;
        if (!count) zeroProbability += outcome.probability;
      }
      return { meanCount, zeroProbability };
    });
    let product = 1, expectedPayout = 0;
    const byLength = [];
    for (let i = 0; i < stats.length; i++) {
      product *= stats[i].meanCount;
      if (i < 2) continue;
      const expectedWays = product * (i + 1 < stats.length ? stats[i + 1].zeroProbability : 1);
      const amount = expectedWays * pay[i - 2];
      expectedPayout += amount;
      byLength.push({ length: i + 1, expectedWays, payout: pay[i - 2], expectedPayout: amount });
    }
    total += expectedPayout;
    return { sym, reels: stats, byLength, expectedPayout };
  });
  return { total, symbols };
}

function analyzeWeights(weightSet, options = {}) {
  const rows = options.rows ?? M.ROWS, scatter = options.scatter ?? M.S.SCATTER;
  const scatterPay = options.scatterPay ?? M.SCATTER_PAY, cost = options.cost ?? 1;
  if (!Number.isFinite(cost) || cost <= 0) throw new RangeError('Mode cost must be positive and finite');
  const lines = lineExpectation(weightSet, options);
  const scatterPerReel = weightSet.map(weights => scatterProbability(weights, rows, scatter));
  const scatterCounts = poissonBinomial(scatterPerReel);
  const triggerRate = scatterCounts.slice(3).reduce((sum, p) => sum + p, 0);
  let scatterEV = 0;
  for (let n = 3; n < scatterCounts.length; n++) {
    const payout = scatterPay[n] ?? 0;
    if (!Number.isFinite(payout) || payout < 0) throw new RangeError('Scatter payouts must be finite non-negative numbers');
    scatterEV += scatterCounts[n] * payout;
  }
  const unmodifiedEV = lines.total + scatterEV;
  return {
    scope: 'Unmodified reel wins and scatter pays only; excludes Squad Attack and all bonuses; not whole-game RTP',
    cost,
    scatterPerReel,
    scatterCounts,
    triggerRate,
    triggerOneIn: triggerRate ? 1 / triggerRate : null,
    lineEV: lines.total,
    scatterEV,
    unmodifiedEV,
    unmodifiedReturnContribution: unmodifiedEV / cost,
    lineDetails: lines.symbols,
  };
}

function analyzeGame(math = M) {
  const options = { rows: math.ROWS, scatter: math.S.SCATTER, wild: math.S.WILD, pays: math.PAYS, scatterPay: math.SCATTER_PAY };
  const base = analyzeWeights(math.BASE_WEIGHTS, options);
  const ante = analyzeWeights(math.ANTE_WEIGHTS, { ...options, cost: math.ANTE_COST });
  return { base, ante, tripleChanceRatio: base.triggerRate ? ante.triggerRate / base.triggerRate : null };
}

module.exports = { scatterProbability, poissonBinomial, reelDistribution, lineExpectation, analyzeWeights, analyzeGame };

if (require.main === module) console.log(JSON.stringify(analyzeGame(), null, 2));

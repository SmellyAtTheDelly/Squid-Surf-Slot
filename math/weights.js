'use strict';

const UINT64_MAX = (1n << 64n) - 1n;
const TARGET_NUMERATOR = 963n;
const TARGET_DENOMINATOR = 1000n;

function gcd(a, b) {
  while (b) { const next = a % b; a = b; b = next; }
  return a < 0n ? -a : a;
}

function uint64(value, name, positive) {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > UINT64_MAX) throw new RangeError(name + ' exceeds unsigned 64-bit bounds');
  return value;
}

function summarize(payouts, weights, cost, maxPayoutUnits = 500000) {
  if (!Number.isSafeInteger(cost) || cost < 1) throw new RangeError('Invalid mode cost');
  if (!Number.isSafeInteger(maxPayoutUnits) || maxPayoutUnits < 1 || maxPayoutUnits > 500000) throw new RangeError('Invalid mode maximum');
  if (!payouts || !weights || payouts.length !== weights.length) throw new RangeError('Weights do not match payouts');
  let totalWeight = 0n, payoutSum = 0n, squareSum = 0n, hitWeight = 0n, profitWeight = 0n, capWeight = 0n;
  let minimum = Infinity, maximum = 0;
  for (let i = 0; i < payouts.length; i++) {
    const value = payouts[i];
    if (!Number.isSafeInteger(value) || value < 0 || value > maxPayoutUnits) throw new RangeError('Invalid payout units');
    const payout = BigInt(value), weight = uint64(weights[i], 'Weight', true);
    totalWeight += weight; payoutSum += payout * weight; squareSum += payout * payout * weight;
    if (value > 0) hitWeight += weight;
    if (value > cost * 100) profitWeight += weight;
    if (value === maxPayoutUnits) capWeight += weight;
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  uint64(totalWeight, 'Total weight', true);
  const denominator = totalWeight * BigInt(cost) * 100n;
  const divisor = gcd(payoutSum, denominator);
  const meanUnits = Number(payoutSum) / Number(totalWeight);
  const varianceUnits = Math.max(0, Number(squareSum) / Number(totalWeight) - meanUnits * meanUnits);
  return {
    totalWeight, payoutSum, squareSum, hitWeight, profitWeight, capWeight,
    rtpNumerator: payoutSum / divisor, rtpDenominator: denominator / divisor,
    rtp: Number(payoutSum) / Number(denominator), rtpPercent: 100 * Number(payoutSum) / Number(denominator),
    standardDeviation: Math.sqrt(varianceUnits) / (cost * 100),
    hitFrequency: Number(hitWeight) / Number(totalWeight), profitFrequency: Number(profitWeight) / Number(totalWeight),
    maxWinFrequency: Number(capWeight) / Number(totalWeight), minimumUnits: minimum, maximumUnits: maximum,
  };
}

function balance(payouts, cost, options) {
  const opts = options || {};
  const maxPayoutUnits = opts.maxPayoutUnits === undefined ? 500000 : opts.maxPayoutUnits;
  if (!Number.isSafeInteger(maxPayoutUnits) || maxPayoutUnits < 1 || maxPayoutUnits > 500000) throw new RangeError('Invalid mode maximum');
  if (!Number.isSafeInteger(cost) || cost < 1) throw new RangeError('Invalid mode cost');
  if (!payouts || payouts.length < 2) throw new RangeError('At least two outcomes are required');
  if (opts.sourceWeights && opts.sourceWeights.length !== payouts.length) throw new RangeError('Source weights do not match outcomes');
  const p = TARGET_NUMERATOR * BigInt(cost), q = 10n;
  let lowWeight = 0n, highWeight = 0n, lowSum = 0n, highSum = 0n;
  const sourceWeights = Array.from(payouts, (_, i) => opts.sourceWeights ? BigInt(opts.sourceWeights[i]) : 1n);
  for (let i = 0; i < payouts.length; i++) {
    const value = payouts[i];
    if (!Number.isSafeInteger(value) || value < 0 || value > maxPayoutUnits) throw new RangeError('Invalid payout units');
    const payout = BigInt(value), weight = uint64(sourceWeights[i], 'Source weight', true);
    if (payout * q <= p) { lowWeight += weight; lowSum += payout * weight; }
    else { highWeight += weight; highSum += payout * weight; }
  }
  const lowMultiplier = q * highSum - p * highWeight;
  const highMultiplier = p * lowWeight - q * lowSum;
  if (lowMultiplier <= 0n || highMultiplier <= 0n) throw new RangeError('Outcome means must bracket the target RTP');
  const weights = sourceWeights.map((weight, i) => weight * (BigInt(payouts[i]) * q <= p ? lowMultiplier : highMultiplier));
  let divisor = weights[0];
  for (let i = 1; i < weights.length && divisor !== 1n; i++) divisor = gcd(divisor, weights[i]);
  for (let i = 0; i < weights.length; i++) weights[i] /= divisor;
  const statistics = summarize(payouts, weights, cost, maxPayoutUnits);
  if (statistics.payoutSum * q !== statistics.totalWeight * p) throw new Error('Exact target RTP was not reached');
  return {
    weights, statistics,
    sourceStatistics: summarize(payouts, sourceWeights, cost, maxPayoutUnits),
    factors: { lowMultiplier, highMultiplier, divisor, thresholdNumerator: p, thresholdDenominator: q },
    target: { numerator: TARGET_NUMERATOR, denominator: TARGET_DENOMINATOR },
  };
}

module.exports = Object.freeze({ UINT64_MAX, TARGET_NUMERATOR, TARGET_DENOMINATOR, gcd, uint64, summarize, balance });

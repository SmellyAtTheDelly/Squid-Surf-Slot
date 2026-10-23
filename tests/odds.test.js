const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math/model.js');
const O = require('../tools/odds.js');

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);
}

test('Poisson-binomial convolution handles deterministic and unequal probabilities', () => {
  assert.deepEqual(O.poissonBinomial([]), [1]);
  assert.deepEqual(O.poissonBinomial([0, 1]), [0, 1, 0]);
  const distribution = O.poissonBinomial([0.2, 0.5, 0.8]);
  [0.08, 0.42, 0.42, 0.08].forEach((p, n) => close(distribution[n], p));
  close(distribution.reduce((sum, p) => sum + p, 0), 1);
});

test('scatter chance accounts for all rows until the first scatter', () => {
  close(O.scatterProbability([3, 1], 3, 1), 37 / 64);
  close(O.scatterProbability([1, 0], 3, 1), 0);
  close(O.scatterProbability([0, 1], 1, 1), 1);
});

test('ordered reel outcomes renormalize after the first scatter', () => {
  const distribution = O.reelDistribution([1, 1, 1], 2, 2);
  assert.equal(distribution.length, 8);
  const probabilities = new Map(distribution.map(o => [o.symbols.join(','), o.probability]));
  for (const key of ['0,0', '0,1', '0,2', '1,0', '1,1', '1,2']) close(probabilities.get(key), 1 / 9);
  for (const key of ['2,0', '2,1']) close(probabilities.get(key), 1 / 6);
  assert.equal(probabilities.has('2,2'), false);
  close(distribution.reduce((sum, o) => sum + o.probability, 0), 1);
  close(distribution.filter(o => o.symbols.includes(2)).reduce((sum, o) => sum + o.probability, 0), 5 / 9);
});

test('line expectations match exhaustive toy boards with longest-reel wins', () => {
  const columns = [
    { symbols: [0, 0], probability: 1 / 9 },
    { symbols: [0, 1], probability: 1 / 9 },
    { symbols: [0, 2], probability: 1 / 9 },
    { symbols: [1, 0], probability: 1 / 9 },
    { symbols: [1, 1], probability: 1 / 9 },
    { symbols: [1, 2], probability: 1 / 9 },
    { symbols: [2, 0], probability: 1 / 6 },
    { symbols: [2, 1], probability: 1 / 6 },
  ];
  const pays = [[2, 5, 11]], lengthEV = [0, 0, 0];
  let total = 0, mass = 0;
  for (let code = 0; code < Math.pow(columns.length, 5); code++) {
    let index = code, probability = 1;
    const grid = [];
    for (let r = 0; r < 5; r++) {
      const column = columns[index % columns.length];
      index = Math.floor(index / columns.length);
      grid.push(column.symbols);
      probability *= column.probability;
    }
    mass += probability;
    const paths = new Map();
    for (let way = 0; way < 32; way++) {
      const path = [];
      for (let r = 0; r < 5; r++) {
        const row = (way >> r) & 1;
        if (grid[r][row] !== 0) break;
        path.push(row);
      }
      if (path.length >= 3) paths.set(path.join(','), path.length);
    }
    const longest = Math.max(0, ...paths.values());
    if (longest < 3) continue;
    const ways = Array.from(paths.values()).filter(length => length === longest).length;
    const amount = ways * pays[0][longest - 3] * probability;
    total += amount;
    lengthEV[longest - 3] += amount;
  }
  const actual = O.lineExpectation(Array.from({ length: 5 }, () => [1, 1, 1, 0]), { rows: 2, scatter: 2, wild: 3, pays });
  close(mass, 1, 1e-11);
  close(actual.total, total, 1e-9);
  actual.symbols[0].byLength.forEach((entry, i) => close(entry.expectedPayout, lengthEV[i], 1e-9));
  close(actual.symbols[0].reels[0].meanCount, 13 / 18);
});

test('three and four reel wins stop when the next reel has no match', () => {
  const options = { rows: 1, scatter: 2, wild: 1, pays: [[2, 5, 11]] };
  const match = [1, 0, 0], miss = [0, 0, 1];
  close(O.lineExpectation([match, match, match, miss, match], options).total, 2);
  close(O.lineExpectation([match, match, match, match, miss], options).total, 5);
  close(O.lineExpectation([match, match, match, match, match], options).total, 11);
  close(O.lineExpectation([match, miss, match, match, match], options).total, 0);
});

test('each ordinary symbol receives its own substitution and paytable calculation', () => {
  const weights = Array.from({ length: 5 }, () => [0, 0, 1, 0]);
  const actual = O.lineExpectation(weights, { rows: 1, scatter: 3, wild: 2, pays: [[1, 2, 3], [4, 5, 6]] });
  close(actual.total, 9);
  close(actual.symbols[0].expectedPayout, 3);
  close(actual.symbols[1].expectedPayout, 6);
});

test('scatter awards and contributions use the selected mode cost', () => {
  const weights = Array.from({ length: 5 }, () => [1, 0, 1]);
  const result = O.analyzeWeights(weights, { rows: 1, scatter: 2, wild: 1, pays: [[0, 0, 0]], scatterPay: { 3: 2, 4: 10, 5: 50 }, cost: 2 });
  close(result.triggerRate, 0.5);
  close(result.triggerOneIn, 2);
  close(result.scatterEV, 3.75);
  close(result.unmodifiedEV, 3.75);
  close(result.unmodifiedReturnContribution, 1.875);
  assert.match(result.scope, /Excludes Squad Attack, bonuses and publication weights/);
  assert.match(result.scope, /not published RTP/);
});

test('procedural Pearl scatter distributions are normalized and Enhanced Chance increases Pearl frequency', () => {
  const result = O.analyzeGame();
  for (const mode of [result.base, result.ante]) {
    assert.equal(mode.scatterCounts.length, 6);
    close(mode.scatterCounts.reduce((sum, p) => sum + p, 0), 1);
    close(mode.scatterEV, mode.scatterCounts[3] * 2 + mode.scatterCounts[4] * 10 + mode.scatterCounts[5] * 50);
    close(mode.unmodifiedEV, mode.lineEV + mode.scatterEV);
    close(mode.unmodifiedReturnContribution, mode.unmodifiedEV / mode.cost);
    assert.ok(mode.lineEV > 0 && mode.triggerRate > 0);
  }
  assert.equal(result.base.cost, 1);
  assert.equal(result.ante.cost, M.ANTE_COST);
  close(result.tripleChanceRatio, 3, 0.02);
  assert.ok(result.base.triggerOneIn > 200 && result.base.triggerOneIn < 260);
  assert.ok(result.ante.triggerOneIn > 65 && result.ante.triggerOneIn < 90);
});

test('production ordered reel distributions match analytic scatter probabilities', () => {
  for (const weights of [...M.BASE_WEIGHTS, ...M.ANTE_WEIGHTS]) {
    const distribution = O.reelDistribution(weights);
    close(distribution.reduce((sum, o) => sum + o.probability, 0), 1);
    assert.ok(distribution.every(o => o.symbols.filter(sym => sym === M.S.SCATTER).length <= 1));
    const p = distribution.filter(o => o.symbols.includes(M.S.SCATTER)).reduce((sum, o) => sum + o.probability, 0);
    close(p, O.scatterProbability(weights));
  }
});

test('invalid probabilities, reel definitions, and costs are rejected', () => {
  assert.throws(() => O.poissonBinomial([-0.1]), RangeError);
  assert.throws(() => O.poissonBinomial([1.1]), RangeError);
  assert.throws(() => O.poissonBinomial([NaN]), RangeError);
  assert.throws(() => O.reelDistribution([0, 0], 1, 1), RangeError);
  assert.throws(() => O.reelDistribution([1, -1], 1, 1), RangeError);
  assert.throws(() => O.reelDistribution([0, 1], 2, 1), RangeError);
  assert.throws(() => O.scatterProbability([1, 1], 0, 1), RangeError);
  assert.throws(() => O.scatterProbability([1, 1], 1, 2), RangeError);
  assert.throws(() => O.analyzeWeights(M.BASE_WEIGHTS, { cost: 0 }), RangeError);
});

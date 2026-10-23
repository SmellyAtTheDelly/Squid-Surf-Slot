'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Moments, Z95 } = require('../tools/statistics.js');

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('sample moments and mean uncertainty match known observations', () => {
  const moments = new Moments();
  for (const value of [2, 4, 4, 4, 5, 5, 7, 9]) moments.add(value);
  const s = moments.summary();
  assert.equal(s.count, 8);
  assert.equal(s.sum, 40);
  close(s.mean, 5);
  close(s.variance, 32 / 7);
  close(s.standardDeviation, Math.sqrt(32 / 7));
  close(s.standardError, Math.sqrt(4 / 7));
  close(s.confidence95[0], 5 - Z95 * Math.sqrt(4 / 7));
  close(s.confidence95[1], 5 + Z95 * Math.sqrt(4 / 7));
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
});

test('variance stays accurate for observations with a large common offset', () => {
  const moments = new Moments();
  for (const value of [1, 2, 3, 4, 5]) moments.add(1e12 + value);
  const s = moments.summary();
  assert.equal(s.mean, 1e12 + 3);
  close(s.variance, 2.5);
  close(s.standardError, Math.sqrt(0.5));
});

test('constant observations have zero variance and a point interval', () => {
  const moments = new Moments();
  for (let i = 0; i < 100; i++) moments.add(17.5);
  const s = moments.summary();
  assert.equal(s.variance, 0);
  assert.equal(s.standardError, 0);
  assert.deepEqual(s.confidence95, [17.5, 17.5]);
});

test('empty and single-sample streams do not claim measured uncertainty', () => {
  const moments = new Moments();
  assert.deepEqual(moments.summary(), { count: 0, sum: 0, mean: null, variance: null, standardDeviation: null, standardError: null, confidence95: null, min: null, max: null });
  moments.add(5);
  assert.deepEqual(moments.summary(), { count: 1, sum: 5, mean: 5, variance: null, standardDeviation: null, standardError: null, confidence95: null, min: 5, max: 5 });
});

test('invalid samples fail without changing the stream', () => {
  const moments = new Moments().add(2).add(6);
  const before = moments.summary();
  for (const value of [NaN, Infinity, -Infinity, '3', undefined]) assert.throws(() => moments.add(value), TypeError);
  assert.deepEqual(moments.summary(), before);
});

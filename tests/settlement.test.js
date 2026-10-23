'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math/model.js');

const BETS = [20, 40, 60, 100, 200, 400, 600, 1000, 2000, 5000, 10000];
const MODES = require('../shared/modes').MODES;
const centsOracle = (units, bet) => Number((BigInt(units) * BigInt(bet) + 50n) / 100n);

for (const bet of BETS) {
  for (const opts of MODES) {
    test(`stake ${bet} cents settles exact amounts for ${JSON.stringify(opts)}`, () => {
      const round = M.createRound(bet, opts);
      const cost = opts.cost;
      assert.equal(round.costCents, bet * cost);
      assert.equal(round.betCents, bet);
      let credits = 0, total = 0;
      for (const units of [6, 7, 12, 14, 25, 40, 65, 200, 1375, 75000, 499999, 1000]) {
        const before = centsOracle(total, bet);
        const accepted = Math.min(units, opts.maxWinUnits - total);
        total += accepted;
        const award = M.awardRound(round, units);
        assert.equal(award.units, accepted);
        assert.equal(award.paidCents, centsOracle(total, bet) - before);
        assert.equal(award.totalCents, centsOracle(total, bet));
        assert.equal(award.totalUnits, total);
        assert.equal(award.capped, total === opts.maxWinUnits);
        credits += award.paidCents;
      }
      const settled = M.closeRound(round);
      assert.equal(credits, centsOracle(opts.maxWinUnits, bet));
      assert.equal(settled.paidCents, credits);
      assert.equal(settled.netCents, credits - bet * cost);
      assert.ok(Object.isFrozen(settled));
    });
  }
}

test('half cents round upward once on the cumulative round award', () => {
  assert.equal(M.payoutCents(25, 2), 1);
  assert.equal(M.payoutCents(24, 2), 0);
  const round = M.createRound(20);
  assert.equal(M.awardRound(round, 6).paidCents, 1);
  assert.equal(M.awardRound(round, 6).paidCents, 1);
  assert.equal(M.awardRound(round, 6).paidCents, 2);
  assert.equal(round.paidCents, 4);
  assert.equal(M.payoutCents(18, 20), 4);
});

test('payout rounding is invariant under arbitrary award partitions', () => {
  const rand = M.mulberry32(21831);
  for (let i = 0; i < 3000; i++) {
    const bet = BETS[Math.floor(rand() * BETS.length)];
    const total = Math.floor(rand() * 500001);
    const round = M.createRound(bet);
    let remaining = total, credits = 0;
    while (remaining) {
      const units = 1 + Math.floor(rand() * remaining);
      credits += M.awardRound(round, units).paidCents;
      remaining -= units;
    }
    assert.equal(credits, centsOracle(total, bet));
    assert.equal(M.closeRound(round).winUnits, total);
  }
});

test('base awards consume the same cap as the complete bonus', () => {
  const round = M.createRound(100, { buy: true });
  assert.equal(M.awardRound(round, 5000).paidCents, 5000);
  const bonus = M.awardRound(round, 500000);
  assert.equal(bonus.units, 495000);
  assert.equal(bonus.totalCents, 500000);
  assert.equal(M.awardRound(round, 100).paidCents, 0);
  assert.equal(M.closeRound(round).netCents, 490000);
});

test('feature purchase cost is not the denomination for prize multipliers', () => {
  const round = M.createRound(100, { buy: true });
  M.awardRound(round, 8000);
  const result = M.closeRound(round);
  assert.equal(result.costCents, 10000);
  assert.equal(result.paidCents, 8000);
  assert.equal(result.netCents, -2000);
  assert.equal(result.paidCents / result.costCents, 0.8);
});

test('accepted stake, cost, profile, and ledger cannot be changed by presentation', () => {
  const round = M.createRound(100, { ante: true });
  for (const key of ['betCents', 'costCents', 'capUnits', 'profile', 'mode', 'winUnits', 'paidCents', 'closed']) {
    assert.throws(() => { round[key] = 123; }, TypeError);
  }
  assert.equal(round.costCents, 200);
  assert.equal(M.awardRound(round, 100).paidCents, 100);
});

test('closed and forged ledgers reject further payments', () => {
  const round = M.createRound(100);
  M.closeRound(round);
  assert.throws(() => M.awardRound(round, 1));
  assert.throws(() => M.closeRound(round));
  for (const invalid of [null, undefined, {}, { betCents: 100, capUnits: 500000, winUnits: 0, paidCents: 0 }]) {
    assert.throws(() => M.awardRound(invalid, 1));
    assert.throws(() => M.closeRound(invalid));
  }
});

test('invalid money and award inputs fail without mutating a round', () => {
  for (const bet of [-1, 0, 1.2, NaN, Infinity, '100', 1000001, Number.MAX_SAFE_INTEGER]) assert.throws(() => M.createRound(bet));
  assert.throws(() => M.createRound(100, { buy: true, ante: true }));
  const round = M.createRound(100);
  for (const units of [-1, 0.5, NaN, Infinity, '100', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => M.awardRound(round, units));
  assert.equal(round.winUnits, 0);
  assert.equal(round.paidCents, 0);
  assert.equal(M.awardRound(round, Number.MAX_SAFE_INTEGER).totalUnits, 500000);
});

test('decimal payout conversion accepts only hundredth-bet precision', () => {
  for (const value of [0, 0.06, 0.29, 1.25, 7.5, 5000, 123456.75]) assert.equal(M.toUnits(value), Math.round(value * 100));
  for (const value of [-1, NaN, Infinity, '1', 0.001, 0.12345]) assert.throws(() => M.toUnits(value));
  assert.equal(M.payoutCents(500000, 1000000), 5000000000);
  assert.throws(() => M.payoutCents(500001, 100));
});

for (const opts of MODES) {
  for (const kind of [opts.kind]) {
    test(`complete ${JSON.stringify(opts)} ${kind} rounds match independent cent settlement`, () => {
      const rand = M.mulberry32(73242);
      for (let i = 0; i < 1000; i++) {
        const betCents = BETS[i % BETS.length];
        const result = M.playRound(rand, { ...opts, kind, betCents });
        const units = result.baseAward.units + result.bonusAward.units;
        const resultCents = centsOracle(units, betCents);
        assert.equal(result.settlement.paidCents, resultCents);
        assert.equal(result.settlement.winUnits, units);
        assert.equal(result.baseAward.paidCents + result.bonusAward.paidCents, resultCents);
        assert.equal(result.settlement.netCents, resultCents - betCents * opts.cost);
        assert.ok(units >= 0 && units <= 500000);
        assert.ok(!opts.buy || opts.kind === 'wilds' ? result.base.fsAward === 0 || !opts.buy : result.base.fsAward > 0);
        if (!result.base.fsAward) assert.equal(result.bonusAward.units, 0);
      }
    });
  }
}

test('bet size and mode-cost settlement do not feed back into outcome generation', () => {
  for (const opts of MODES) {
    const low = M.mulberry32(873), high = M.mulberry32(873);
    for (let i = 0; i < 100; i++) {
      const a = M.playRound(low, { ...opts, betCents: 20 });
      const b = M.playRound(high, { ...opts, betCents: 10000 });
      assert.deepEqual(a.base, b.base);
      assert.equal(a.settlement.winUnits, b.settlement.winUnits);
    }
  }
});

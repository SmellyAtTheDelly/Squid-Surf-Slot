const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, predictRound, findRound } = require('./helpers/game-harness');
const Contract = require('../shared/contract');
const studioConfig = require('./fixtures/current-auth-config');

const count = (h, endpoint) => h.server.calls.filter(call => call.endpoint === endpoint).length;

for (const [label, config] of [['empty betModes', { gameModes: undefined, betModes: {} }], ['current modes in Studio format', studioConfig]]) for (const mode of Contract.MODES) {
  test(label + ' authenticates and completes ' + mode.name, async () => {
    const expected = predictRound(1, { mode: mode.name });
    const h = await createHarness({ seed: 1, kind: mode.kind, ante: mode.ante, config });
    assert.equal(h.api.st.connected, true);
    assert.equal(h.get('engineStatus').hidden, true);
    assert.equal(h.get('btnSpin').disabled, false);
    const round = await h.round({ kind: mode.kind, buy: mode.buy });
    assert.equal(round.mode, mode.name);
    assert.equal(round.cost, expected.cost);
    assert.equal(round.payout, expected.payout);
    assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
    assert.equal(count(h, '/wallet/play'), 1);
    assert.equal(count(h, '/wallet/end-round'), expected.payout > 0 ? 1 : 0);
    assert.equal(h.api.st.engineError, null);
  });
}

for (const kind of ['kraken', 'reef', 'vault', 'wheel']) {
  test('authentication resumes an interrupted ' + kind + ' book without placing another wager', async () => {
    const expected = predictRound(1, { buy: true, kind });
    const h = await createHarness({ balanceMicro: 1000000000 - expected.cost, activeRound: { book: expected.book, event: 1 } });
    await h.until(() => !!h.api.st.lastRound && !h.api.st.busy, kind);
    assert.equal(count(h, '/wallet/play'), 0);
    assert.equal(count(h, '/wallet/authenticate'), 1);
    assert.equal(count(h, '/wallet/end-round'), 1);
    assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
    assert.equal(h.api.st.lastRound.payout, expected.payout);
    assert.equal(h.api.st.lastRound.mode, expected.mode);
    assert.equal(h.api.st.shownMicro, expected.payout);
    assert.equal(h.api.st.resuming, false);
    assert.ok(h.server.calls.filter(call => call.endpoint === '/bet/event').every(call => Number(call.body.event) > 1));
  });
}

test('a lost play response blocks controls and resumes the accepted book after explicit recovery', async () => {
  const expected = predictRound(1, { buy: true, kind: 'vault' });
  const h = await createHarness({ seed: 1 });
  h.server.faults['/wallet/play'] = ({ run }) => { run(); throw new Error('response lost'); };
  h.api.buy('vault');
  await h.flush();
  assert.equal(h.api.st.connected, false);
  assert.equal(h.api.st.busy, false);
  assert.equal(h.api.st.balanceMicro, 1000000000);
  assert.equal(h.server.balance, 900000000);
  h.api.spin();
  h.api.buy('reef');
  await h.flush();
  assert.equal(count(h, '/wallet/play'), 1);
  h.api.recover();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy, 'vault');
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
  assert.equal(count(h, '/wallet/authenticate'), 2);
  assert.equal(count(h, '/wallet/play'), 1);
  assert.equal(count(h, '/wallet/end-round'), 1);
  assert.equal(h.server.settlements.length, 1);
  assert.equal(h.api.st.engineError, null);
});

test('a rejected network request leaves the wallet intact and never generates a local fallback outcome', async () => {
  const h = await createHarness();
  h.server.faults['/wallet/play'] = () => { throw new Error('offline'); };
  h.api.spin();
  await h.flush();
  assert.equal(h.api.st.balanceMicro, 1000000000);
  assert.equal(h.server.balance, 1000000000);
  assert.equal(h.log.filter(entry => entry.name === 'baseSpin').length, 0);
  assert.equal(h.api.st.lastRound, undefined);
  assert.equal(h.get('engineStatus').hidden, false);
  assert.equal(h.get('btnSpin').disabled, true);
  h.api.recover();
  await h.flush();
  assert.equal(h.api.st.connected, true);
  assert.equal(h.api.st.busy, false);
  assert.equal(count(h, '/wallet/play'), 1);
  assert.equal(count(h, '/wallet/authenticate'), 2);
});

test('a lost settlement response restores the credited balance without crediting or ending twice', async () => {
  const expected = predictRound(1, { buy: true, kind: 'reef' });
  const h = await createHarness({ seed: 1 });
  h.server.faults['/wallet/end-round'] = ({ run }) => { run(); throw new Error('settlement response lost'); };
  h.api.buy('reef');
  await h.until(() => !!h.api.st.engineError && !h.api.st.busy, 'reef');
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost);
  assert.equal(h.server.balance, 1000000000 - expected.cost + expected.payout);
  h.api.recover();
  await h.flush();
  assert.equal(h.api.st.balanceMicro, h.server.balance);
  assert.equal(h.api.st.connected, true);
  assert.equal(h.api.st.busy, false);
  assert.equal(count(h, '/wallet/end-round'), 1);
  assert.equal(count(h, '/wallet/play'), 1);
  assert.equal(h.server.settlements.length, 1);
});

test('an interrupted checkpoint reconstructs the same feature and settles the original wager once', async () => {
  const expected = predictRound(1, { buy: true, kind: 'kraken' });
  const h = await createHarness({ seed: 1 });
  h.server.faults['/bet/event'] = ({ run }) => { run(); throw new Error('checkpoint response lost'); };
  h.api.buy('kraken');
  await h.until(() => !!h.api.st.engineError && !h.api.st.busy, 'kraken');
  h.api.recover();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy, 'kraken');
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
  assert.equal(h.api.st.shownMicro, expected.payout);
  assert.equal(count(h, '/wallet/play'), 1);
  assert.equal(count(h, '/wallet/end-round'), 1);
  assert.equal(h.server.settlements.length, 1);
});

for (const kind of ['kraken', 'reef', 'vault', 'wheel']) {
  test(kind + ' replay waits for Play and repeats locally without authenticating or changing a wallet', async () => {
    const expected = predictRound(1, { buy: true, kind, amount: 2000000 });
    const location = 'https://game.example/?replay=true&rgs_url=rgs.example&game=test&version=1&mode=buy_' + kind + '&event=1&amount=2000000&currency=EUR&debug=1';
    const h = await createHarness({ replayBook: expected.book, location });
    assert.equal(h.api.st.replayOnly, true);
    assert.equal(h.get('balance').textContent, 'REPLAY');
    assert.equal(h.api.st.busy, false);
    assert.equal(h.api.st.lastRound, undefined);
    assert.equal(h.api.st.balanceMicro, null);
    assert.equal(h.get('btnAuto').disabled, true);
    assert.equal(h.get('betUp').disabled, true);
    assert.equal(h.server.calls.length, 1);
    for (let repeat = 0; repeat < 2; repeat++) {
      await h.round();
      assert.equal(h.api.st.lastRound.payout, expected.payout);
      assert.equal(h.api.st.shownMicro, expected.payout);
      assert.equal(h.api.st.balanceMicro, null);
      assert.equal(h.api.st.currency, 'EUR');
    }
    assert.equal(h.server.calls.length, 1);
    assert.ok(h.server.calls[0].endpoint.startsWith('/bet/replay/'));
    assert.equal(h.server.calls[0].method, 'GET');
    assert.equal(h.server.settlements.length, 0);
  });
}

test('production launches without a session show a connection error instead of granting demo money', async () => {
  const h = await createHarness({ location: 'https://game.example/?debug=1' });
  assert.equal(h.server.calls.length, 0);
  assert.equal(h.api.st.balanceMicro, null);
  assert.equal(h.api.st.ready, false);
  assert.equal(h.get('engineStatus').hidden, false);
  assert.equal(h.get('btnSpin').disabled, true);
});

test('jurisdiction restrictions disable autoplay, turbo, feature purchases and unnecessary controls', async () => {
  const h = await createHarness({ jurisdiction: { disabledTurbo: true, disabledAutoplay: true, disabledBuyFeature: true, disabledSlamstop: true } });
  assert.equal(h.api.st.turbo, false);
  assert.equal(h.get('btnTurbo').disabled, true);
  assert.equal(h.get('btnAuto').disabled, true);
  h.api.buy('vault');
  h.get('autoChips').children[0].click();
  await h.flush();
  assert.equal(count(h, '/wallet/play'), 0);
  assert.equal(h.api.st.auto, 0);
});

test('a supported mode subset and fallback default amount remain playable', async () => {
  const expected = findRound(value => value.units === 0);
  const h = await createHarness({ seed: expected.seed, config: { betLevels: [], gameModes: { base_vault: { costMultiplier: 1, maxBet: 1000000 } } } });
  assert.equal(h.api.st.selectedDive, 'vault');
  await h.round();
  assert.equal(h.api.st.lastRound.mode, 'base_vault');
  assert.equal(h.api.st.lastRound.amount, 1000000);
  assert.equal(h.api.st.balanceMicro, 999000000);
});

test('positive unsupported round-duration configuration blocks wagers until the integration is defined', async () => {
  const h = await createHarness({ jurisdiction: { minimumRoundDuration: 2500 } });
  assert.equal(h.api.st.ready, false);
  assert.equal(h.get('engineStatus').hidden, false);
  assert.match(h.get('engineMessage').textContent, /duration|timing/i);
  h.api.spin();
  await h.flush();
  assert.equal(count(h, '/wallet/play'), 0);
});

test('Enhanced Chance clamps the amount to its authenticated mode maximum', async () => {
  const h = await createHarness({ betIdx: 7, config: { gameModes: { base_vault: { costMultiplier: 1, maxBet: 10000000 }, ante_vault: { costMultiplier: 2, maxBet: 1000000 } } } });
  assert.equal(h.api.st.betIdx, 7);
  h.get('btnAnte').click();
  assert.equal(h.api.st.ante, true);
  assert.equal(h.api.st.betIdx, 3);
  assert.equal(h.get('betUp').disabled, true);
  await h.round();
  const wager = h.server.calls.find(call => call.endpoint === '/wallet/play');
  assert.equal(wager.body.mode, 'ante_vault');
  assert.equal(wager.body.amount, 1000000);
});

test('settlement recovery accepts explicit no-active-round authentication without submitting end-round twice', async () => {
  const expected = predictRound(1, { buy: true, kind: 'reef' });
  const h = await createHarness({ seed: 1 });
  h.server.faults['/wallet/end-round'] = ({ run, server }) => { run(); server.round = null; throw new Error('settlement response lost'); };
  h.api.buy('reef');
  await h.until(() => !!h.api.st.engineError && !h.api.st.busy, 'reef');
  h.api.recover();
  await h.flush();
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
  assert.equal(h.api.st.connected, true);
  assert.equal(h.api.st.busy, false);
  assert.equal(h.api.session.state.phase, 'ready');
  assert.equal(count(h, '/wallet/end-round'), 1);
  assert.equal(h.server.settlements.length, 1);
});

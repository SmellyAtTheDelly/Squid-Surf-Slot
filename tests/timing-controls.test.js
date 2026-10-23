const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, findRound, predictRound, Books, M } = require('./helpers/game-harness');

const smallWin = findRound(value => value.units > 0 && value.units < M.BIG_WIN * 100 && !value.base.fsAward && !value.base.attack);
const loss = findRound(value => value.units === 0 && !value.base.fsAward && !value.base.attack);
const requestCount = (h, endpoint) => h.server.calls.filter(call => call.endpoint === endpoint).length;

async function advanceUntil(h, predicate, limit = 10000) {
  const start = h.context.performance.now();
  while (!predicate()) {
    assert.ok(h.context.performance.now() - start < limit, 'Presentation did not reach the expected state');
    await h.tick(16);
  }
  return h.context.performance.now() - start;
}

async function dismissResult(h, start, limit) {
  while (h.api.st.busy) {
    assert.ok(h.context.performance.now() - start < limit, 'Result dismissal exceeded ' + limit + 'ms');
    h.api.spin();
    await h.tick(16);
  }
  assert.ok(h.context.performance.now() - start <= limit);
}

function assertPaidOnce(h, expected) {
  assert.equal(h.api.st.lastRound.payout, expected.payout);
  assert.equal(h.api.st.shownMicro, expected.payout);
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout);
  assert.equal(requestCount(h, '/wallet/play'), 1);
  assert.equal(requestCount(h, '/wallet/end-round'), expected.payout > 0 ? 1 : 0);
  assert.equal(h.server.settlements.length, 1);
  assert.deepEqual(h.errors, []);
}

test('rapid spin input shortens reel stops while gameplay and background keep real frame time', async () => {
  const h = await createHarness({ books: [loss.book] }), normal = await createHarness({ books: [loss.book] }), updates = [], draws = [], particles = [];
  h.api.st.turbo = normal.api.st.turbo = false;
  h.context.SeaLife.update = (dt, time) => updates.push({ dt, time });
  h.context.SeaLife.drawFar = (g, time) => draws.push(time);
  h.context.FX.Particles.prototype.update = dt => particles.push(dt);
  await h.tick(16);
  await normal.tick(16);
  h.api.spin();
  normal.api.spin();
  await h.flush();
  await normal.flush();
  const start = h.context.performance.now();
  for (let i = 0; i < 10; i++) h.api.spin();
  assert.ok(h.api.reels.every(reel => reel.phase === 'idle'));
  assert.deepEqual(Array.from(h.api.reels, reel => Array.from(reel.strip)), loss.base.landed);
  const before = h.api.clock, ambientBefore = updates.at(-1).time;
  updates.length = 0;
  draws.length = 0;
  particles.length = 0;
  await h.tick(16);
  await normal.tick(16);
  assert.equal(h.api.st.spinning, false);
  assert.equal(h.api.st.busy, false);
  assert.ok(Math.abs(h.api.clock - before - 0.016) < 1e-10);
  assert.equal(updates.length, 1);
  assert.ok(Math.abs(updates[0].dt - 0.016) < 1e-10);
  assert.ok(Math.abs(updates[0].time - ambientBefore - 0.016) < 1e-10);
  assert.deepEqual(draws, [updates[0].time]);
  assert.equal(particles.length, 2);
  assert.ok(particles.every(dt => Math.abs(dt - 0.016) < 1e-10));
  for (let i = 0; i < 10; i++) {
    const previous = h.api.clock, ambient = updates.at(-1).time;
    await h.tick(16);
    await normal.tick(16);
    assert.ok(Math.abs(h.api.clock - previous - 0.016) < 1e-10);
    assert.ok(Math.abs(updates.at(-1).time - ambient - 0.016) < 1e-10);
  }
  await advanceUntil(h, () => !h.api.st.busy);
  await advanceUntil(normal, () => !normal.api.st.busy);
  assert.ok(h.context.performance.now() - start < normal.context.performance.now() - start);
  assertPaidOnce(h, loss);
  assertPaidOnce(normal, loss);
});

for (const phase of ['windup', 'spin', 'land', 'settle', 'idle']) {
  test('reel skipping during ' + phase + ' shows the accepted board and emits each landing exactly once', async () => {
    const sounds = [], sound = new Proxy({}, { get: (target, key) => key === 'play' ? (...args) => sounds.push(args) : () => {} });
    const h = await createHarness({ books: [loss.book], sound });
    h.api.st.turbo = false;
    h.api.spin();
    await h.flush();
    await advanceUntil(h, () => h.api.st.spinning && h.api.reels[0].phase === phase);
    const before = h.api.clock, moving = Array.from(h.api.reels, reel => reel.phase !== 'idle');
    for (let i = 0; i < 10; i++) h.api.spin();
    assert.equal(h.api.clock, before);
    assert.equal(h.api.st.slammed, true);
    assert.ok(h.api.reels.every((reel, index) => reel.phase === 'idle' && (!moving[index] || reel.pos === 0 && reel.v === 0 && reel.vi === 0 && !reel.ant)));
    assert.deepEqual(Array.from(h.api.reels, reel => Array.from(reel.strip)), loss.base.landed);
    assert.deepEqual(sounds.filter(args => args[0] === 'reelStop').map(args => args[1]).sort(), [0, 1, 2, 3, 4]);
    await h.tick(16);
    assert.equal(h.api.st.spinning, false);
    await advanceUntil(h, () => !h.api.st.busy);
    assert.deepEqual(sounds.filter(args => args[0] === 'reelStop').map(args => args[1]).sort(), [0, 1, 2, 3, 4]);
    assertPaidOnce(h, loss);
  });
}

test('repeated win clicks leave rendered symbol animation at the same rate as normal play', async () => {
  const normal = await createHarness({ books: [smallWin.book] }), clicked = await createHarness({ books: [smallWin.book] });
  normal.api.st.turbo = clicked.api.st.turbo = false;
  normal.api.spin();
  clicked.api.spin();
  await advanceUntil(normal, () => !!normal.api.st.plaque);
  await advanceUntil(clicked, () => !!clicked.api.st.plaque);
  assert.equal(normal.api.clock, clicked.api.clock);
  const normalSymbols = [], clickedSymbols = [];
  normal.get('game').getContext('2d').transform = (...values) => normalSymbols.push(values);
  clicked.get('game').getContext('2d').transform = (...values) => clickedSymbols.push(values);
  for (let i = 0; i < 6; i++) {
    normalSymbols.length = 0;
    clickedSymbols.length = 0;
    clicked.api.spin();
    await normal.tick(16);
    await clicked.tick(16);
    assert.equal(normal.api.clock, clicked.api.clock);
    assert.equal(normalSymbols.length, 15);
    assert.deepEqual(clickedSymbols, normalSymbols);
  }
  await advanceUntil(normal, () => !normal.api.st.busy);
  await dismissResult(clicked, clicked.context.performance.now(), 250);
  assertPaidOnce(normal, smallWin);
  assertPaidOnce(clicked, smallWin);
});

test('turbo keeps ambient motion at the same rate as normal play', async () => {
  const h = await createHarness({ books: [loss.book] }), updates = [];
  h.context.SeaLife.update = (dt, time) => updates.push({ dt, time });
  await h.tick(16);
  h.api.spin();
  await h.flush();
  const start = updates.at(-1).time;
  updates.length = 0;
  for (let i = 0; i < 10; i++) await h.tick(16);
  assert.equal(updates.length, 10);
  assert.ok(updates.every(value => Math.abs(value.dt - 0.016) < 1e-10));
  assert.ok(Math.abs(updates.at(-1).time - start - 0.16) < 1e-10);
  await advanceUntil(h, () => !h.api.st.busy);
  assertPaidOnce(h, loss);
});

test('disabled turbo and slam stop retain ordinary gameplay timing under repeated input', async () => {
  const h = await createHarness({ books: [loss.book], jurisdiction: { disabledTurbo: true, disabledSlamstop: true } });
  await h.tick(16);
  h.api.spin();
  await h.flush();
  h.api.spin();
  assert.equal(h.api.st.spinning, true);
  assert.ok(h.api.reels.some(reel => reel.phase !== 'idle'));
  const before = h.api.clock;
  await h.tick(16);
  assert.ok(Math.abs(h.api.clock - before - 0.016) < 1e-10);
  await advanceUntil(h, () => !h.api.st.busy);
  assertPaidOnce(h, loss);
});

for (const turbo of [false, true]) {
  test((turbo ? 'turbo' : 'normal') + ' small wins count promptly and retain the final amount before settling', async () => {
    const h = await createHarness({ books: [smallWin.book] });
    h.api.st.turbo = turbo;
    h.api.spin();
    await advanceUntil(h, () => !!h.api.st.plaque);
    const elapsed = await advanceUntil(h, () => h.api.st.plaque.dur === 0);
    assert.ok(elapsed <= (turbo ? 250 : 700), 'Win count took ' + elapsed + 'ms');
    assert.equal(h.api.st.plaque.target, smallWin.payout / 1000000);
    const finished = h.context.performance.now();
    while (h.context.performance.now() - finished < 128) {
      await h.tick(16);
      assert.equal(h.api.st.busy, true);
      assert.equal(requestCount(h, '/wallet/end-round'), 0);
    }
    await advanceUntil(h, () => !h.api.st.busy);
    assert.ok(h.context.performance.now() - finished <= 200);
    assertPaidOnce(h, smallWin);
  });
}

test('one press finishes a small win count and repeated presses preserve the real-time final amount hold', async () => {
  const h = await createHarness({ books: [smallWin.book] });
  h.api.st.turbo = false;
  h.api.spin();
  await advanceUntil(h, () => !!h.api.st.plaque && h.api.st.plaque.dur > 0);
  h.api.spin();
  await h.tick(16);
  assert.equal(h.api.st.plaque.dur, 0);
  assert.equal(h.api.st.plaque.target, smallWin.payout / 1000000);
  const finished = h.context.performance.now();
  while (h.context.performance.now() - finished < 128) {
    h.api.spin();
    await h.tick(16);
    assert.equal(h.api.st.busy, true);
    assert.equal(requestCount(h, '/wallet/end-round'), 0);
  }
  await dismissResult(h, finished, 250);
  assert.equal(h.api.st.plaque, null);
  assertPaidOnce(h, smallWin);
});

for (const [name, minimum, maximum, duration] of [['big', M.BIG_WIN, M.MEGA_WIN, 1200], ['mega', M.MEGA_WIN, M.EPIC_WIN, 1600], ['epic', M.EPIC_WIN, Infinity, 2000]]) {
  const expected = findRound(value => value.units >= minimum * 100 && value.units < maximum * 100, { buy: true, kind: 'wilds' });
  for (const turbo of [false, true]) {
    test((turbo ? 'turbo ' : 'normal ') + name + ' win counts finish without a long celebration lock', async () => {
      const h = await createHarness({ books: [expected.book] });
      h.api.st.turbo = turbo;
      h.api.buy('wilds');
      await advanceUntil(h, () => !!h.api.st.bw);
      const elapsed = await advanceUntil(h, () => h.api.st.bw.done);
      assert.ok(elapsed <= (turbo ? 400 : duration + 50), 'Win count took ' + elapsed + 'ms');
      assert.equal(h.api.st.bw.shown, expected.payout / 1000000);
      await advanceUntil(h, () => !h.api.st.busy);
      assertPaidOnce(h, expected);
    });
  }
}

test('one press reveals the complete big win and a second press dismisses it only after the final amount hold', async () => {
  const book = Books.maxWinBook('buy_wilds'), expected = predictRound(1, { buy: true, kind: 'wilds', book });
  const h = await createHarness({ books: [book] });
  h.api.st.turbo = false;
  h.api.buy('wilds');
  await advanceUntil(h, () => !!h.api.st.bw && !h.api.st.bw.done);
  h.api.spin();
  await h.tick(16);
  assert.equal(h.api.st.bw.shown, expected.payout / 1000000);
  assert.equal(h.api.st.bw.done, true);
  const finished = h.context.performance.now();
  h.api.spin();
  while (h.context.performance.now() - finished < 128) {
    await h.tick(16);
    assert.equal(h.api.st.bw.shown, expected.payout / 1000000);
    assert.equal(h.api.st.busy, true);
    assert.equal(requestCount(h, '/wallet/end-round'), 0);
  }
  await dismissResult(h, finished, 250);
  assertPaidOnce(h, expected);
});

for (const disabledTurbo of [false, true]) {
  test('clicking a big win fade dismisses it immediately with turbo ' + (disabledTurbo ? 'disabled' : 'available'), async () => {
    const book = Books.maxWinBook('buy_wilds'), expected = predictRound(1, { buy: true, kind: 'wilds', book });
    const h = await createHarness({ books: [book], jurisdiction: { disabledTurbo } });
    h.api.st.turbo = false;
    h.api.buy('wilds');
    await advanceUntil(h, () => !!h.api.st.bw && h.api.st.bw.out > 0);
    assert.equal(h.api.st.bw.done, true);
    assert.equal(h.api.st.bw.shown, expected.payout / 1000000);
    const start = h.context.performance.now();
    h.api.spin();
    await h.tick(16);
    assert.equal(h.api.st.bw, null);
    await advanceUntil(h, () => !h.api.st.busy);
    assert.ok(h.context.performance.now() - start <= 32);
    assertPaidOnce(h, expected);
  });

  test('clicking a bonus total preserves a brief reading pause and skips the exit with turbo ' + (disabledTurbo ? 'disabled' : 'available'), async () => {
    const expected = predictRound(1, { buy: true, kind: 'vault' });
    const h = await createHarness({ books: [expected.book], jurisdiction: { disabledTurbo } });
    h.api.st.turbo = false;
    h.api.buy('vault');
    await h.until(() => h.api.st.panel && h.api.st.panel.kind === 'outro' && h.api.st.panel.shown < h.api.st.panel.total, 'vault');
    const total = h.api.st.panel.total;
    h.api.spin();
    await h.tick(16);
    assert.equal(h.api.st.panel.shown, total);
    const finished = h.context.performance.now();
    h.api.spin();
    while (h.context.performance.now() - finished < 128) {
      await h.tick(16);
      assert.ok(h.api.st.panel);
      assert.equal(h.api.st.panel.shown, total);
      assert.equal(requestCount(h, '/wallet/end-round'), 0);
    }
    await dismissResult(h, finished, 300);
    assert.equal(h.api.st.panel, null);
    assert.equal(h.api.st.ink, null);
    assert.equal(h.api.st.scene, 'base');
    assertPaidOnce(h, expected);
  });
}

test('repeated dismissal clicks never queue a wager and the next explicit click starts one round after settlement', async () => {
  const h = await createHarness({ books: [smallWin.book, loss.book] });
  let releaseSettlement;
  const pendingSettlement = new Promise(resolve => { releaseSettlement = resolve; });
  h.server.faults['/wallet/end-round'] = async ({ run }) => { await pendingSettlement; return run(); };
  h.api.st.turbo = false;
  h.api.spin();
  await advanceUntil(h, () => !!h.api.st.plaque);
  const start = h.context.performance.now();
  while (requestCount(h, '/wallet/end-round') === 0) {
    assert.ok(h.context.performance.now() - start < 300);
    h.api.spin();
    await h.tick(16);
  }
  assert.equal(h.api.st.plaque, null);
  for (let i = 0; i < 10; i++) {
    h.api.spin();
    await h.tick(16);
    assert.equal(h.api.st.busy, true);
    assert.equal(h.api.st.plaque, null);
    assert.equal(requestCount(h, '/wallet/play'), 1);
    assert.equal(h.server.settlements.length, 0);
  }
  releaseSettlement();
  await h.flush();
  await advanceUntil(h, () => !h.api.st.busy);
  assertPaidOnce(h, smallWin);
  const firstId = h.api.st.lastRound.id;
  for (let i = 0; i < 20; i++) await h.tick(16);
  assert.equal(requestCount(h, '/wallet/play'), 1);
  h.api.spin();
  await h.flush();
  assert.equal(requestCount(h, '/wallet/play'), 2);
  assert.equal(h.api.st.busy, true);
  await dismissResult(h, h.context.performance.now(), 3000);
  assert.notEqual(h.api.st.lastRound.id, firstId);
  assert.equal(h.api.st.lastRound.payout, loss.payout);
  assert.equal(h.api.st.balanceMicro, 1000000000 - smallWin.cost + smallWin.payout - loss.cost + loss.payout);
  assert.equal(requestCount(h, '/wallet/play'), 2);
  assert.equal(requestCount(h, '/wallet/end-round'), 1);
  assert.equal(h.server.settlements.length, 2);
  assert.equal(h.log.filter(entry => entry.name === 'finish').length, 2);
  assert.deepEqual(h.errors, []);
});

test('disabled slam stop prevents bonus count skipping while still allowing the completed panel to continue', async () => {
  const expected = predictRound(1, { buy: true, kind: 'vault' });
  const h = await createHarness({ books: [expected.book], jurisdiction: { disabledSlamstop: true } });
  h.api.st.turbo = false;
  h.api.buy('vault');
  await h.until(() => h.api.st.panel && h.api.st.panel.kind === 'outro' && h.api.st.panel.shown < h.api.st.panel.total, 'vault');
  const total = h.api.st.panel.total;
  h.api.spin();
  await h.tick(16);
  assert.ok(h.api.st.panel.shown < total);
  await advanceUntil(h, () => h.api.st.panel.shown === total);
  h.api.spin();
  await advanceUntil(h, () => !h.api.st.busy);
  assertPaidOnce(h, expected);
});

for (const kind of ['vault', 'reef', 'kraken', 'wheel', 'wilds']) {
  test('repeated speed-up input preserves ' + kind + ' playback and settles the accepted outcome once', async () => {
    const expected = predictRound(1, { buy: true, kind }), h = await createHarness({ books: [expected.book] });
    h.api.buy(kind);
    await h.flush();
    const start = h.context.performance.now();
    while (h.api.st.busy) {
      assert.ok(h.context.performance.now() - start < 30000);
      h.api.spin();
      await h.tick(16);
    }
    assertPaidOnce(h, expected);
    assert.equal(h.log.filter(entry => entry.name === 'finish').length, 1);
    const checkpointEvents = h.server.calls.filter(call => call.endpoint === '/bet/event').map(call => Number(call.body.event));
    assert.ok(checkpointEvents.every((event, i) => i === 0 || event > checkpointEvents[i - 1]));
    for (let i = 0; i < 20; i++) await h.tick(16);
    assert.equal(requestCount(h, '/wallet/play'), 1);
    assert.equal(h.server.settlements.length, 1);
  });
}

test('speed-up input in replay preserves the recorded payout without wallet requests', async () => {
  const expected = predictRound(1, { buy: true, kind: 'wheel' });
  const location = 'https://game.example/?replay=true&rgs_url=rgs.example&game=test&version=1&mode=buy_wheel&event=1&amount=1000000&currency=EUR&debug=1';
  const h = await createHarness({ replayBook: expected.book, location });
  h.api.spin();
  await h.flush();
  const start = h.context.performance.now();
  while (h.api.st.busy) {
    assert.ok(h.context.performance.now() - start < 30000);
    h.api.spin();
    await h.tick(16);
  }
  assert.equal(h.api.st.lastRound.payout, expected.payout);
  assert.equal(h.api.st.shownMicro, expected.payout);
  assert.equal(h.api.st.balanceMicro, null);
  assert.equal(h.server.calls.length, 1);
  assert.equal(h.server.settlements.length, 0);
  assert.deepEqual(h.errors, []);
});

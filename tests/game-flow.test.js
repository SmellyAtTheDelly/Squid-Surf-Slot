const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, predictRound, findRound, Books, M } = require('./helpers/game-harness');

const requestCount = (h, endpoint) => h.server.calls.filter(call => call.endpoint === endpoint).length;
const loss = findRound(value => value.units === 0 && !value.base.fsAward);
const win = findRound(value => value.units > 0 && !value.base.fsAward && !value.base.attack);
const attack = findRound(value => value.base.attack && value.base.attack.length > 0 && !value.base.fsAward);
const anteLoss = findRound(value => value.units === 0 && !value.base.fsAward, { ante: true });
const anteWin = findRound(value => value.units > 0 && !value.base.fsAward, { ante: true });

function assertSettlement(h, expected, initial = 1000000000) {
  const { st } = h.api, round = st.lastRound;
  assert.equal(round.payoutUnits, expected.units);
  assert.equal(round.payout, expected.payout);
  assert.equal(round.cost, expected.cost);
  assert.equal(round.amount, expected.amount);
  assert.equal(round.mode, expected.mode);
  assert.equal(st.balanceMicro, initial - expected.cost + expected.payout);
  assert.equal(st.balance, st.balanceMicro / 1000000);
  assert.equal(st.lastWin, expected.payout / 1000000);
  assert.equal(st.shownMicro, expected.payout);
  assert.equal(st.shownUnits, expected.units);
  assert.equal(st.balanceMicro, h.server.balance);
  assert.equal(st.busy, false);
  assert.equal(!!st.inBonus, false);
  assert.equal(st.mode, 'base');
  assert.equal(st.scene, 'base');
  assert.equal(Object.isFrozen(round), true);
  assert.equal(requestCount(h, '/wallet/play'), 1);
  assert.equal(requestCount(h, '/wallet/end-round'), expected.units ? 1 : 0);
  assert.equal(h.server.settlements.length, 1);
  assert.equal(h.log.filter(entry => entry.name === 'baseSpin').length, 1);
  assert.equal(h.log.filter(entry => entry.name === 'finish').length, 1);
  assert.equal(h.api.session.state.phase, 'ready');
  assert.equal(h.storage.get('ss_balance'), '999999');
  assert.deepEqual(h.errors, []);
}

for (const [name, fixture, ante] of [['base loss', loss, false], ['base win', win, false], ['Squad Attack', attack, false], ['Enhanced Chance loss', anteLoss, true], ['Enhanced Chance win', anteWin, true]]) {
  test(name + ' displays the accepted outcome and settles the server wallet exactly once', async () => {
    const h = await createHarness({ seed: fixture.seed, ante });
    await h.round();
    assertSettlement(h, fixture);
  });
}

for (const kind of ['kraken', 'reef', 'vault', 'wheel']) {
  test('purchased ' + kind + ' includes its trigger and recorded bonus in one server settlement', async () => {
    const expected = predictRound(1, { buy: true, kind });
    const h = await createHarness({ seed: 1 });
    await h.round({ buy: true, kind });
    assertSettlement(h, expected);
    assert.ok(expected.base.triggerCount >= 3);
    assert.ok(expected.bonusUnits > 0);
  });
  test('natural trigger always settles Coin Vault despite selecting ' + kind, async () => {
    const expected = findRound(value => value.base.fsAward > 0, { kind });
    const h = await createHarness({ seed: expected.seed });
    await h.round({ kind });
    assertSettlement(h, expected);
    assert.equal(h.api.st.lastChoice, 'vault');
    assert.equal(h.server.calls.find(call => call.endpoint === '/wallet/play').body.mode, 'base_vault');
  });
}

test('Enhanced Chance awards the recorded bonus against the base amount rather than the doubled cost', async () => {
  const expected = findRound(value => value.base.fsAward > 0, { ante: true, kind: 'reef' });
  const h = await createHarness({ seed: expected.seed, ante: true });
  await h.round({ kind: 'reef' });
  assertSettlement(h, expected);
  assert.equal(h.api.st.lastRound.cost, 2000000);
  assert.equal(h.api.st.lastRound.amount, 1000000);
});

for (let segment = 0; segment < 8; segment++) {
  test('wheel segment ' + segment + ' presents its recorded cash or feature without a second wager', async () => {
    const expected = findRound(value => value.wheel === segment, { buy: true, kind: 'wheel' });
    const h = await createHarness({ seed: expected.seed });
    await h.round({ buy: true, kind: 'wheel' });
    assertSettlement(h, expected);
    assert.equal(h.log.filter(entry => entry.name === 'wheelSpin').length, 1);
    const route = h.log.find(entry => entry.name === expected.kind + 'Start');
    if (expected.kind === 'cash') assert.equal(h.log.filter(entry => /^(kraken|reef|vault)Start$/.test(entry.name)).length, 0);
    else { assert.ok(route); assert.equal(!!route.args[1], expected.sup); }
  });
}

test('subcent awards use the accepted integer micro amount without rounding each display award to cents', async () => {
  const expected = predictRound(1, { buy: true, kind: 'kraken', amount: 12345 });
  const h = await createHarness({ seed: 1, amount: 12345, config: { minBet: 1, stepBet: 1 } });
  await h.round({ buy: true, kind: 'kraken' });
  assertSettlement(h, expected);
  assert.equal(h.api.st.lastRound.amount, 12345);
  assert.notEqual(expected.payout % 10000, 0);
});

for (const kind of ['kraken', 'reef', 'vault', 'wheel']) {
  test(kind + ' caps the complete recorded award at 5000 base amounts', async () => {
    const book = Books.maxWinBook('buy_' + kind, 0);
    const expected = predictRound(1, { buy: true, kind, book, betIdx: 0 });
    const h = await createHarness({ books: [book], betIdx: 0 });
    await h.round({ buy: true, kind });
    assertSettlement(h, expected);
    assert.equal(h.api.st.lastRound.payout, 1000000000);
    assert.equal(h.api.st.shownUnits, 500000);
    if (kind === 'kraken') assert.equal(h.log.filter(entry => entry.name === 'krakenStep' && entry.value).length, 1);
  });
}

test('the accepted round retains its base amount and mode when controls change during animation', async () => {
  const expected = predictRound(1, { buy: true, kind: 'reef' });
  const h = await createHarness({ seed: 1 });
  h.api.buy('reef');
  await h.flush();
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost);
  assert.equal(h.api.st.round.amount, 1000000);
  h.api.st.betIdx = 10;
  h.api.st.ante = true;
  h.api.select('vault');
  await h.until(() => !h.api.st.busy, 'reef');
  assertSettlement(h, expected);
});

test('duplicate spin and purchase inputs during animation cannot debit or settle twice', async () => {
  const expected = predictRound(1, { buy: true, kind: 'vault' });
  const h = await createHarness({ seed: 1 });
  h.api.buy('vault');
  for (let i = 0; i < 8; i++) { h.api.spin(); h.api.buy('reef'); }
  await h.flush();
  assert.equal(h.api.st.balanceMicro, 900000000);
  assert.equal(requestCount(h, '/wallet/play'), 1);
  await h.until(() => !h.api.st.busy, 'vault');
  assertSettlement(h, expected);
  const settledBalance = h.api.st.balanceMicro;
  for (let i = 0; i < 80; i++) await h.tick();
  assert.equal(h.api.st.balanceMicro, settledBalance);
  assert.equal(requestCount(h, '/wallet/end-round'), 1);
});

for (const [name, balance, ante, buy] of [['base', 0.99, false, false], ['Enhanced Chance', 1.99, true, false], ['bonus purchase', 99.99, false, true]]) {
  test('insufficient ' + name + ' funds leave the server wallet unchanged', async () => {
    const h = await createHarness({ balance, ante });
    if (buy) h.api.buy('reef');
    else h.api.spin();
    await h.flush();
    assert.equal(h.api.st.balanceMicro, Math.round(balance * 1000000));
    assert.equal(h.api.st.busy, false);
    assert.equal(h.api.st.lastRound, undefined);
    assert.equal(requestCount(h, '/wallet/play'), 0);
    assert.equal(h.server.settlements.length, 0);
  });
}

test('a subsequent losing round resets last win and preserves the accumulated server balance', async () => {
  const h = await createHarness({ books: [win.book, loss.book] });
  await h.round();
  const initial = h.api.st.balanceMicro;
  h.log.length = 0;
  h.server.calls.length = 0;
  h.server.settlements.length = 0;
  await h.round();
  assertSettlement(h, loss, initial);
  assert.equal(h.api.st.lastWin, 0);
});

test('browser outcome RNG is never used to resolve an accepted purchased round', async () => {
  const h = await createHarness({ seed: 1 });
  h.context.crypto.getRandomValues = () => { throw new Error('Browser RNG is unavailable'); };
  await h.round({ buy: true, kind: 'vault' });
  assertSettlement(h, predictRound(1, { buy: true, kind: 'vault' }));
});

test('disabled bet controls cannot change the wager while a purchased bonus is running', async () => {
  const h = await createHarness({ seed: 1 });
  h.api.buy('vault');
  assert.equal(h.get('betUp').disabled, true);
  assert.equal(h.get('betDown').disabled, true);
  h.get('betUp').click();
  h.get('betDown').click();
  assert.equal(h.api.st.betIdx, 3);
  await h.until(() => !h.api.st.busy, 'vault');
  assertSettlement(h, predictRound(1, { buy: true, kind: 'vault' }));
});

test('autoplay submits each loss once and preserves all three server debits', async () => {
  const h = await createHarness({ books: [loss.book, loss.book, loss.book] });
  h.get('autoChips').children[0].click();
  h.api.st.auto = 3;
  await h.until(() => h.server.settlements.length === 3 && !h.api.st.busy);
  for (let i = 0; i < 30; i++) await h.tick();
  assert.equal(h.api.st.balanceMicro, 997000000);
  assert.equal(h.api.st.lastWin, 0);
  assert.equal(h.api.st.auto, 0);
  assert.equal(requestCount(h, '/wallet/play'), 3);
  assert.equal(requestCount(h, '/wallet/end-round'), 0);
  assert.equal(h.log.filter(entry => entry.name === 'baseSpin').length, 3);
  assert.deepEqual(h.errors, []);
});

test('stopping autoplay during animation completes the accepted round without placing another wager', async () => {
  const h = await createHarness({ books: [win.book] });
  h.get('autoChips').children[0].click();
  h.api.spin();
  assert.equal(h.api.st.auto, 0);
  await h.until(() => !h.api.st.busy);
  for (let i = 0; i < 30; i++) await h.tick();
  assertSettlement(h, win);
});

for (const choice of [null, 'reef', 'vault', 'wheel', 'unknown']) {
  test('autoplay always plays Coin Vault after selecting ' + (choice || 'the default choice'), async () => {
    const kind = ['reef', 'vault', 'wheel'].includes(choice) ? choice : 'kraken';
    const expected = findRound(value => value.base.fsAward > 0, { kind });
    const h = await createHarness({ seed: expected.seed, automaticBonus: true });
    if (choice) h.api.select(choice);
    h.get('autoChips').children[0].click();
    h.api.st.auto = 2;
    await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
    h.api.st.auto = 0;
    for (let i = 0; i < 20; i++) await h.tick();
    assertSettlement(h, expected);
    assert.equal(h.api.st.lastChoice, 'vault');
  });
}

for (const kind of ['vault', 'wheel']) {
  test('automatic and reversed manual ' + kind + ' chest picks preserve the same recorded payout', async () => {
    const expected = findRound(value => value.kind === 'vault', { buy: true, kind, betIdx: 0 });
    const automatic = await createHarness({ seed: expected.seed, betIdx: 0, automaticBonus: true });
    automatic.api.st.auto = 1;
    automatic.api.buy(kind);
    await automatic.until(() => !!automatic.api.st.lastRound && !automatic.api.st.busy);
    automatic.api.st.auto = 0;
    const manual = await createHarness({ seed: expected.seed, betIdx: 0, reversePicks: true });
    await manual.round({ buy: true, kind });
    assertSettlement(automatic, expected);
    assertSettlement(manual, expected);
    const autoPicks = automatic.log.filter(entry => entry.name === 'vaultPick').map(entry => entry.args[1]);
    const manualPicks = manual.log.filter(entry => entry.name === 'vaultPick').map(entry => entry.args[1]);
    assert.equal(autoPicks.length, expected.picks.length);
    assert.notDeepEqual(autoPicks, manualPicks);
    assert.equal(new Set(manualPicks).size, manualPicks.length);
    assert.deepEqual(automatic.log.filter(entry => entry.name === 'vaultPick').map(entry => JSON.stringify(entry.value)), manual.log.filter(entry => entry.name === 'vaultPick').map(entry => JSON.stringify(entry.value)));
  });
}

test('the rules dialog reflects current base amount, mode costs and player-facing settlement terms', async () => {
  const h = await createHarness({ betIdx: 0 });
  h.get('btnInfo').click();
  const html = h.get('infoBody').innerHTML;
  assert.match(html, /current bet of <b>\$0\.20<\/b>/);
  assert.match(html, /2x your bet \(\$0\.40\)/);
  assert.match(html, /100x the base bet \(\$20\.00\)/);
  assert.match(html, /5,000x the base bet/);
  assert.match(html, /RGS.*settles the wallet/);
  assert.match(html, /at the start of the round/);
  assert.match(html, /does not change the payout/);
  assert.doesNotMatch(html, /nearest cent|Triple Chance|triple your chance|one million integer units/);
  h.api.st.betIdx = 3;
  h.get('btnInfo').click();
  assert.match(h.get('infoBody').innerHTML, /current bet of <b>\$1\.00<\/b>/);
});

test('obsolete simulation profiles cannot replace published game rules or add stale return tables', async () => {
  const h = await createHarness();
  h.get('btnInfo').click();
  const original = h.get('infoBody').innerHTML;
  h.context.SlotReturnProfile = { profile: 'obsolete-profile', results: [{ rtpPercent: 20 }] };
  h.get('btnInfo').click();
  assert.equal(h.get('infoBody').innerHTML, original);
  assert.doesNotMatch(original, /simulated complete rounds|confidence intervals|Cent rounding/);
});

test('the live rules dialog publishes the uploaded-book RTP with the actual wager denominator', async () => {
  const h = await createHarness();
  h.get('btnInfo').click();
  const html = h.get('infoBody').innerHTML;
  assert.match(html, /96\.3/);
  assert.match(html, /theoretical/i);
  assert.match(html, /amount paid|total cost|total wager|full wager/i);
  assert.match(html, /96\.30% of the full wager in all 7 modes/);
  assert.match(html, /5,000x the base bet/);
  assert.match(html, /2,500x the total Enhanced Chance wager/);
  assert.match(html, /31\.59x its 50x spin price/);
});

test('the rules disclose obtainable bonus values and their modifiers from public configuration', async () => {
  const h = await createHarness();
  h.get('btnInfo').click();
  const html = h.get('infoBody').innerHTML, config = h.context.SlotConfig;
  const reef = M.REEF_VALUES.map(pair => pair[0]).filter(value => typeof value === 'number');
  const vault = M.VAULT_COIN.map(pair => pair[0]);
  assert.deepEqual(Array.from(config.REEF_CASH_VALUES), reef);
  assert.deepEqual(Array.from(config.VAULT_COIN_VALUES), vault);
  assert.ok(html.includes(reef.map(value => value + 'x').join(', ')));
  assert.ok(html.includes(vault.map(value => value + 'x').join(', ')));
  assert.match(html, /x1, x3 or x7\.5/);
  assert.match(html, /x3, x9 or x22\.5/);
  assert.match(html, /Golden Pearl doubles all cash Pearls currently on the board/);
  assert.match(html, /Level, Super and Golden Pearl multipliers do not change the fixed prizes/);
  assert.match(html, /Super Vault[\s\S]*x2, x2 or x6[\s\S]*adds \+2/);
});

test('the rules explain button actions, purchase confirmation and autoplay count confirmation', async () => {
  const h = await createHarness();
  h.get('btnInfo').click();
  const html = h.get('infoBody').innerHTML;
  for (const label of ['Info', '+ / -', '3 Squids: Coin', 'Enhanced Chance', 'Buy Bonus', 'Auto', 'Turbo', 'Sound', 'Music', 'Spin', 'PLAY']) assert.ok(html.includes('<b>' + label + '</b>'), label);
  assert.match(html, /review its displayed price[\s\S]*confirm and place/);
  assert.match(html, /Choose a count to confirm and start autoplay/);
  assert.match(html, /an accepted round still finishes/);
  assert.match(html, /repeat it without placing a wager/);
});

test('the rules cover operating faults, connectivity, unfinished rounds and illustrative displays', async () => {
  const h = await createHarness();
  h.get('btnInfo').click();
  const html = h.get('infoBody').innerHTML;
  assert.match(html, /malfunction invalidates affected plays and wins/);
  assert.match(html, /stable internet connection/);
  assert.match(html, /reload the game[\s\S]*restore an unfinished accepted round/);
  assert.match(html, /very large number of plays/);
  assert.match(html, /browser presentation does not determine settlement/);
  assert.match(html, /do not simulate physical devices/);
});

test('wallet state comes from authentication even when old browser storage contains a different balance', async () => {
  const h = await createHarness({ balanceMicro: 0, storedBalance: 1000000 });
  assert.equal(h.api.st.balanceMicro, 0);
  assert.equal(h.api.st.balance, 0);
  assert.equal(h.storage.get('ss_balance'), '1000000');
  assert.equal(requestCount(h, '/wallet/authenticate'), 1);
});

test('the settlement test hook is unavailable outside explicit debug mode', async () => {
  const h = await createHarness({ debug: false });
  assert.equal(h.context.__ss, undefined);
});

test('six-wild losses settle once with no feature and no guaranteed payout', async () => {
  const expected = findRound(value => value.units === 0, { buy: true, kind: 'wilds' });
  const h = await createHarness({ seed: expected.seed });
  await h.round({ buy: true, kind: 'wilds' });
  assertSettlement(h, expected);
  assert.equal(expected.base.triggerCount, 6);
  assert.equal(h.api.st.lastRound.cost, 50000000);
  assert.equal(h.api.st.shownMicro, 0);
  assert.equal(h.log.some(entry => /Start$/.test(entry.name)), false);
});

test('the six-wild maximum displays and settles its own reachable payout cap', async () => {
  const book = Books.maxWinBook('buy_wilds');
  const expected = predictRound(1, { buy: true, kind: 'wilds', book, betIdx: 0 });
  const h = await createHarness({ books: [book], betIdx: 0 });
  await h.round({ buy: true, kind: 'wilds' });
  assertSettlement(h, expected);
  assert.equal(h.api.st.shownUnits, 157950);
  assert.equal(h.api.st.lastRound.payout, 315900000);
  assert.equal(h.log.some(entry => /Start$/.test(entry.name)), false);
});

test('every purchase selection displays its authored price at every offered base bet', async () => {
  const costs = { vault: 100, reef: 250, kraken: 500, wheel: 185, wilds: 50 };
  const amounts = [0.2, 0.4, 0.6, 1, 2, 3, 5, 10, 20, 50, 100];
  for (let betIdx = 0; betIdx < amounts.length; betIdx++) {
    const h = await createHarness({ betIdx });
    h.get('btnBuy').click();
    for (const [kind, cost] of Object.entries(costs)) {
      h.get('buyGrid').children.find(card => card.dataset.kind === kind).click();
      const expected = '$' + (amounts[betIdx] * cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      assert.equal(h.api.st.buyKind, kind);
      assert.equal(h.get('divePrice').textContent, expected);
      assert.equal(h.get('buyCost').textContent, expected);
      assert.equal(requestCount(h, '/wallet/play'), 0);
    }
  }
});

test('an exact six-wild purchase balance is accepted while an unaffordable Legendary buy is blocked', async () => {
  const h = await createHarness({ balance: 50 });
  h.get('btnBuy').click();
  h.get('buyGrid').children.find(card => card.dataset.kind === 'kraken').click();
  h.get('buyConfirm').click();
  await h.tick();
  assert.equal(requestCount(h, '/wallet/play'), 0);
  assert.equal(h.api.st.balanceMicro, 50000000);
  h.get('buyGrid').children.find(card => card.dataset.kind === 'wilds').click();
  h.get('buyConfirm').click();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  assert.equal(h.api.st.lastRound.mode, 'buy_wilds');
  assert.equal(h.api.st.lastRound.cost, 50000000);
  assert.equal(requestCount(h, '/wallet/play'), 1);
});

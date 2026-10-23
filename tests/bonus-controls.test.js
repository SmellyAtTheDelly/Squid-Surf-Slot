const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, findRound, predictRound, Books } = require('./helpers/game-harness');

const plays = h => h.server.calls.filter(call => call.endpoint === '/wallet/play');
const wildLoss = findRound(value => value.units === 0, { mode: 'buy_wilds' });
const baseLoss = findRound(value => value.units === 0 && !value.base.fsAward);
const anteLoss = findRound(value => value.units === 0 && !value.base.fsAward, { ante: true });
const choose = (h, kind) => h.get('buyGrid').children.find(card => card.dataset.kind === kind).click();
const close = h => h.dispatchWindow('keydown', { code: 'Escape', preventDefault() {} });

test('activating Six Wilds places one reviewed wager and keeps future manual spins at 50x', async () => {
  const h = await createHarness({ books: [wildLoss.book, wildLoss.book] });
  h.get('btnBuy').click(); choose(h, 'wilds');
  assert.equal(h.api.st.wilds, false);
  assert.equal(h.get('diveAction').textContent, 'Activate & Spin');
  assert.equal(h.get('buyCost').textContent, '$50.00');
  assert.equal(plays(h).length, 0);
  h.get('buyConfirm').click();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  assert.equal(h.api.st.wilds, true);
  assert.equal(h.storage.get('ss_wilds'), '1');
  assert.equal(h.get('wildsMode').hidden, false);
  assert.equal(h.get('wildsPrice').textContent, '$50.00 PER SPIN');
  assert.equal(h.get('betLabel').textContent, 'Six Wilds bet');
  assert.equal(h.get('btnDive').innerHTML, '6 WILDS<br>NO BONUS');
  assert.equal(h.get('btnDive')['aria-label'], 'Six squid wilds, no bonus trigger');
  assert.equal(h.get('bet').textContent, '$50.00');
  assert.match(h.get('btnSpin')['aria-label'], /Six Wilds for \$50\.00/);
  for (let i = 0; i < 100; i++) await h.tick();
  assert.equal(plays(h).length, 1);
  await h.round();
  assert.deepEqual(plays(h).map(call => call.body.mode), ['buy_wilds', 'buy_wilds']);
  assert.equal(h.api.st.balanceMicro, 900000000);
  assert.equal(h.server.settlements.length, 2);
  assert.equal(h.log.filter(entry => entry.name === 'baseSpin').every(entry => entry.value.triggerCount === 6 && entry.value.fsAward === 0), true);
  assert.deepEqual(h.errors, []);
});

test('turning Six Wilds off during a spin preserves its accepted result and only changes the next wager', async () => {
  const book = Books.maxWinBook('buy_wilds'), expected = predictRound(1, { mode: 'buy_wilds', book });
  const h = await createHarness({ books: [book, baseLoss.book] });
  h.api.buy('wilds'); await h.flush();
  assert.equal(h.api.st.busy, true);
  h.get('wildsOff').click();
  assert.equal(h.api.st.wilds, false);
  assert.equal(h.storage.get('ss_wilds'), '0');
  assert.equal(h.get('wildsMode').hidden, true);
  assert.equal(h.get('btnDive').innerHTML, '6 WILDS<br>NO BONUS');
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  assert.equal(h.api.st.lastRound.mode, 'buy_wilds');
  assert.equal(h.api.st.lastRound.cost, expected.cost);
  assert.equal(h.api.st.lastRound.payout, expected.payout);
  assert.equal(h.server.settlements.length, 1);
  assert.equal(h.get('btnDive').innerHTML, '3 SQUIDS:<br>COIN');
  assert.equal(h.get('btnDive')['aria-label'], 'Three squids trigger the Coin Bonus');
  await h.round();
  assert.deepEqual(plays(h).map(call => call.body.mode), ['buy_wilds', 'base_vault']);
  assert.equal(h.api.st.balanceMicro, 1000000000 - expected.cost + expected.payout - 1000000);
  assert.deepEqual(h.errors, []);
});

test('a saved Six Wilds selection is visible after reload without placing an automatic wager', async () => {
  const h = await createHarness({ storage: { ss_wilds: '1' } });
  assert.equal(h.api.st.wilds, true);
  assert.equal(h.get('wildsMode').hidden, false);
  assert.equal(h.get('wildsPrice').textContent, '$50.00 PER SPIN');
  for (let i = 0; i < 100; i++) await h.tick();
  assert.equal(plays(h).length, 0);
  h.get('wildsOff').click();
  assert.equal(h.storage.get('ss_wilds'), '0');
  assert.equal(h.get('bet').textContent, '$1.00');
});

test('Six Wilds preserves Enhanced Chance and survives a separate one-off bonus purchase', async () => {
  const vault = predictRound(1, { mode: 'buy_vault' });
  const h = await createHarness({ ante: true, storage: { ss_wilds: '1' }, books: [vault.book, wildLoss.book, anteLoss.book] });
  assert.equal(h.api.st.ante, true);
  assert.equal(h.get('btnAnte').disabled, true);
  h.get('btnBuy').click(); choose(h, 'vault'); h.get('buyConfirm').click();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy, 'vault');
  assert.equal(h.api.st.wilds, true);
  assert.equal(h.api.st.ante, true);
  await h.round();
  h.get('wildsOff').click();
  assert.equal(h.get('bet').textContent, '$2.00');
  await h.round();
  assert.deepEqual(plays(h).map(call => call.body.mode), ['buy_vault', 'buy_wilds', 'ante_vault']);
});

test('turning Six Wilds off stops explicit autoplay before another wager is placed', async () => {
  const h = await createHarness({ storage: { ss_wilds: '1' }, books: [wildLoss.book] });
  h.get('autoChips').children[0].click(); await h.flush();
  assert.equal(h.api.st.auto, 9);
  h.get('wildsOff').click();
  assert.equal(h.api.st.auto, 0);
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  for (let i = 0; i < 100; i++) await h.tick();
  assert.equal(plays(h).length, 1);
});

test('turning Six Wilds off releases held Space and does not start a replacement normal spin', async () => {
  const h = await createHarness({ storage: { ss_wilds: '1' }, books: [wildLoss.book] });
  h.dispatchWindow('keydown', { code: 'Space', target: { tagName: 'BODY' }, preventDefault() {} });
  await h.tick(300);
  h.get('wildsOff').click();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  for (let i = 0; i < 100; i++) await h.tick();
  assert.equal(plays(h).length, 1);
});

test('an accepted Six Wilds wager with a lost response recovers once and keeps the selected mode', async () => {
  const book = Books.maxWinBook('buy_wilds');
  const h = await createHarness({ books: [book, wildLoss.book] });
  h.server.faults['/wallet/play'] = ({ run }) => { run(); throw new Error('response lost'); };
  h.api.buy('wilds'); await h.flush();
  assert.equal(h.api.st.connected, false);
  assert.equal(h.storage.get('ss_wilds'), '1');
  h.api.recover();
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  assert.equal(h.api.st.wilds, true);
  assert.equal(plays(h).length, 1);
  assert.equal(h.server.settlements.length, 1);
  assert.equal(h.api.st.lastRound.payoutUnits, book.payoutMultiplier);
  await h.round();
  assert.deepEqual(plays(h).map(call => call.body.mode), ['buy_wilds', 'buy_wilds']);
});

for (const [label, options] of [
  ['disabled feature purchases', { jurisdiction: { disabledBuyFeature: true } }],
  ['unavailable Six Wilds mode', { config: { gameModes: { base_vault: { costMultiplier: 1, maxBet: 100000000 } } } }],
]) test(label + ' prevents restoring or activating Six Wilds', async () => {
  const h = await createHarness({ ...options, storage: { ss_wilds: '1' }, books: [baseLoss.book] });
  assert.equal(h.api.st.wilds, false);
  assert.equal(h.get('wildsMode').hidden, true);
  h.api.buy('wilds'); await h.flush();
  assert.equal(plays(h).length, 0);
  assert.equal(h.api.st.wilds, false);
  await h.round();
  assert.equal(h.api.st.lastRound.mode, 'base_vault');
});

test('a replay ignores saved Six Wilds selection and never places a wallet wager', async () => {
  const location = 'https://game.example/?replay=true&rgs_url=rgs.example&game=test&version=1&mode=buy_wilds&event=1&amount=1000000&currency=USD&debug=1';
  const h = await createHarness({ location, replayBook: wildLoss.book, storage: { ss_wilds: '1', ss_ante: '1' } });
  assert.equal(h.api.st.wilds, false);
  assert.equal(h.get('wildsMode').hidden, true);
  assert.equal(h.get('betLabel').textContent, 'Recorded bet');
  assert.equal(h.get('btnDive').innerHTML, '6 WILDS<br>NO BONUS');
  assert.equal(h.get('btnDive')['aria-label'], 'Six squid wilds, no bonus trigger');
  assert.equal(h.get('bet').textContent, '$50.00');
  await h.round();
  assert.equal(h.api.st.lastRound.mode, 'buy_wilds');
  assert.equal(h.api.st.lastRound.cost, 50000000);
  assert.equal(h.get('bet').textContent, '$50.00');
  assert.equal(h.storage.get('ss_wilds'), '1');
  assert.equal(h.storage.get('ss_ante'), '1');
  assert.equal(plays(h).length, 0);
  assert.equal(h.server.settlements.length, 0);
  assert.equal(h.server.balance, 1000000000);
});

test('bonus-menu bet controls immediately update the base bet and all purchase prices without wagering', async () => {
  const h = await createHarness();
  h.get('btnBuy').click();
  h.get('buyBetUp').click();
  assert.equal(h.get('buyBet').textContent, '$2.00');
  assert.equal(h.get('buyCost').textContent, '$200.00');
  assert.equal(h.get('divePrice').textContent, '$200.00');
  for (const [kind, cost] of Object.entries({ vault: 100, reef: 250, kraken: 500, wheel: 185, wilds: 50 })) {
    const card = h.get('buyGrid').children.find(item => item.dataset.kind === kind);
    assert.match(card['aria-label'], new RegExp('\\$' + (cost * 2).toLocaleString('en-US') + '\\.00'));
  }
  choose(h, 'wilds'); h.get('buyBetDown').click();
  assert.equal(h.get('buyBet').textContent, '$1.00');
  assert.equal(h.get('buyCost').textContent, '$50.00');
  assert.equal(plays(h).length, 0);
});

test('bonus-menu bet controls respect the selected purchase limit and the lowest offered base amount', async () => {
  const gameModes = { base_vault: { costMultiplier: 1, maxBet: 100000000 }, buy_vault: { costMultiplier: 100, maxBet: 2000000 }, buy_wilds: { costMultiplier: 50, maxBet: 600000 } };
  const h = await createHarness({ betIdx: 7, config: { gameModes } });
  h.get('btnBuy').click();
  assert.equal(h.get('buyBet').textContent, '$2.00');
  assert.equal(h.get('buyBetUp').disabled, true);
  choose(h, 'wilds');
  assert.equal(h.get('buyBet').textContent, '$0.60');
  assert.equal(h.get('buyBetUp').disabled, true);
  h.get('buyBetDown').click(); h.get('buyBetDown').click();
  assert.equal(h.get('buyBet').textContent, '$0.20');
  assert.equal(h.get('buyBetDown').disabled, true);
  h.get('buyBetDown').click();
  assert.equal(h.get('buyBet').textContent, '$0.20');
  assert.equal(h.get('buyCost').textContent, '$10.00');
  assert.equal(plays(h).length, 0);
});

test('confirming a purchase locks its reviewed amount during the menu transition', async () => {
  const h = await createHarness({ books: [wildLoss.book] });
  h.get('btnBuy').click(); choose(h, 'wilds'); h.get('buyBetUp').click();
  assert.equal(h.get('divePrice').textContent, '$100.00');
  h.get('buyConfirm').click();
  assert.equal(h.get('buyBetUp').disabled, true);
  assert.equal(h.get('buyBetDown').disabled, true);
  h.get('buyBetUp').click(); choose(h, 'kraken');
  await h.until(() => !!h.api.st.lastRound && !h.api.st.busy);
  assert.equal(h.api.st.lastRound.mode, 'buy_wilds');
  assert.equal(h.api.st.lastRound.amount, 2000000);
  assert.equal(h.api.st.lastRound.cost, 100000000);
  assert.equal(plays(h).length, 1);
});

test('changing the bonus-menu bet enforces affordability against the newly displayed purchase price', async () => {
  const h = await createHarness({ balance: 50 });
  h.get('btnBuy').click(); choose(h, 'wilds'); h.get('buyBetUp').click(); h.get('buyConfirm').click();
  await h.tick();
  assert.equal(plays(h).length, 0);
  assert.equal(h.api.st.wilds, false);
  assert.equal(h.get('buyCost').textContent, '$100.00');
  assert.match(h.get('toast').textContent, /Not enough balance/);
});

test('closing the bonus menu restores the active spin mode bet limit without a wager', async () => {
  const gameModes = { base_vault: { costMultiplier: 1, maxBet: 1000000 }, buy_wilds: { costMultiplier: 50, maxBet: 5000000 } };
  const h = await createHarness({ config: { gameModes } });
  h.get('btnBuy').click(); h.get('buyBetUp').click();
  assert.equal(h.get('buyBet').textContent, '$2.00');
  close(h);
  assert.equal(h.get('mBuy').hidden, true);
  assert.equal(h.get('bet').textContent, '$1.00');
  assert.equal(h.get('betUp').disabled, true);
  assert.equal(plays(h).length, 0);
});

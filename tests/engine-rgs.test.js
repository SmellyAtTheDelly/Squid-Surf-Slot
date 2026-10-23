const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../frontend/js/engine.js');
const Contract = require('../shared/contract.js');
const STUDIO_CONFIG = require('./fixtures/current-auth-config');
const LEGACY_STUDIO_CONFIG = require('./fixtures/stake-auth-config.json');
const Books = require('../math/books');
const M = require('../math/model');

const LIVE = 'https://game.example/?sessionID=session-secret&rgs_url=rgs.example&lang=de';
const REPLAY = 'https://game.example/?replay=true&rgs_url=rgs.example&game=game-123&version=1&mode=base_vault&event=42';
const clone = value => JSON.parse(JSON.stringify(value));

function events(mode = 'base_vault', units = 0) {
  if (Contract.mode(mode).buy) return Books.generateBook(M.mulberry32(1), { mode }).events;
  const grid = [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 0, 1], [1, 2, 3]];
  if (units) { grid[1][0] = 0; grid[2][0] = 0; }
  const ev = { wins: units ? [{ sym: 0, units, amount: units / 100, len: 3, ways: 1, mult: 1, cells: [[0, 0], [1, 0], [2, 0]] }] : [], totalUnits: units, total: units / 100, scatterUnits: 0, scatterPay: 0, scatterCount: 0, scatterCells: [] };
  return [{ index: 0, type: 'round', schema: Contract.SCHEMA, mode, kind: Contract.mode(mode).kind, base: { landed: grid, grid, ev, fsAward: 0, attack: null, triggerCount: 0, triggerCells: [] } }, { index: 1, type: 'final', payoutUnits: units, baseUnits: units, bonusUnits: 0, capped: units === 500000 }];
}

function round(options = {}) {
  const mode = options.mode || 'base_vault', amount = options.amount || 1000000, state = events(mode, options.units || 0), units = state.at(-1).payoutUnits;
  return { id: 'round-1', betID: 'round-1', amount, payout: Contract.payoutAmount(amount, units), payoutMultiplier: units / 100, mode, state, active: true, event: null, ...options };
}

function limits(options = {}) {
  return { minBet: 10000, maxBet: 100000000, stepBet: 10000, defaultBetLevel: 1000000, betLevels: [10000, 1000000, 2000000], gameModes: Object.fromEntries(Contract.MODES.map(mode => [mode.name, { costMultiplier: mode.cost, maxBet: 100000000 }])), jurisdiction: {}, ...options };
}

function auth(options = {}) {
  return { balance: { amount: 1000000000, currency: 'USD' }, config: limits(), round: null, ...options };
}

function result(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => clone(value) };
}

function setup(queue, options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const call = { url, method: init.method, body: init.body ? JSON.parse(init.body) : null, init };
    calls.push(call);
    if (!queue.length) throw new Error('Unexpected request');
    const entry = queue.shift();
    return typeof entry === 'function' ? entry(call) : result(entry);
  };
  const session = Engine.create({ location: LIVE, contract: Contract, fetch, timeoutMs: 1000, ...options });
  return { session, calls };
}

function rejects(promise, code, ambiguous) {
  return assert.rejects(promise, error => {
    assert.ok(error instanceof Engine.EngineError);
    assert.equal(error.code, code);
    if (ambiguous != null) assert.equal(error.ambiguous, ambiguous);
    return true;
  });
}

test('live launch resolves a dynamic HTTPS bare host and authenticates with the official wire body', async () => {
  const { session, calls } = setup([auth()]);
  assert.equal(session.state.phase, 'idle');
  await session.init();
  assert.equal(calls[0].url, 'https://rgs.example/wallet/authenticate');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { sessionID: 'session-secret', language: 'de' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.balance, 1000000000);
  assert.equal(session.state.currency, 'USD');
  assert.equal(session.state.config.gameModes.buy_kraken.costMultiplier, 500);
  await rejects(session.init(), 'ALREADY_INITIALIZED');
  assert.equal(calls.length, 1);
});

test('only an explicit same-origin loopback demo permits HTTP', () => {
  const local = 'http://127.0.0.1:5177/?sessionID=local-demo&demo=true&rgs_url=http%3A%2F%2F127.0.0.1%3A5177';
  assert.equal(Engine.parseLaunch(local).localDemo, true);
  const invalid = [local.replace('&demo=true', ''), local.replace('rgs_url=http%3A%2F%2F127.0.0.1%3A5177', 'rgs_url=http%3A%2F%2F127.0.0.1%3A5178'), local.replace('http://127.0.0.1:5177/', 'https://game.example/'), local.replaceAll('127.0.0.1', 'remote.example')];
  for (const location of invalid) assert.throws(() => Engine.parseLaunch(location), { code: 'INVALID_LAUNCH' });
  assert.equal(Engine.parseLaunch(local.replaceAll('127.0.0.1', 'localhost')).localDemo, true);
});

test('unsafe or incomplete live launch parameters fail before contacting any server', async () => {
  const invalid = [
    'https://game.example/',
    'https://game.example/?rgs_url=rgs.example',
    LIVE + '&sessionID=second',
    LIVE.replace('rgs.example', 'https%3A%2F%2Fuser%3Apassword%40rgs.example'),
    LIVE.replace('rgs.example', 'https%3A%2F%2Frgs.example%2Fwallet'),
    LIVE.replace('rgs.example', 'rgs.example%23fragment'),
    LIVE.replace('rgs.example', 'http%3A%2F%2Frgs.example'),
    LIVE.replace('rgs.example', 'javascript%3Aalert(1)'),
    LIVE.replace('rgs.example', 'rgs.example%5Cevil'),
  ];
  for (const location of invalid) {
    const { session, calls } = setup([], { location });
    await rejects(session.init(), 'INVALID_LAUNCH');
    assert.equal(calls.length, 0);
    assert.equal(session.state.phase, 'error');
    assert.equal(JSON.stringify(session.state).includes('session-secret'), false);
  }
});

test('zero balance is retained without refill and unknown well-formed currencies are accepted', async () => {
  const { session, calls } = setup([auth({ balance: { amount: 0, currency: 'ZZZ' } })]);
  await session.init();
  assert.equal(session.state.balance, 0);
  assert.equal(session.state.currency, 'ZZZ');
  await rejects(session.start('base_vault', 1000000), 'INSUFFICIENT_BALANCE');
  assert.equal(calls.length, 1);
});

test('malformed server balances and currencies fail closed', async () => {
  for (const wallet of [{ amount: -1, currency: 'USD' }, { amount: 1.5, currency: 'USD' }, { amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }, { amount: 1, currency: 'usd' }, { amount: 1, currency: '<b>' }, { amount: 1, currency: '' }]) {
    const { session } = setup([auth({ balance: wallet })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.balance, null);
    assert.equal(session.state.phase, 'error');
  }
});

test('configuration validates costs and limits before enabling wagers', async () => {
  const invalid = [limits({ minBet: 200, maxBet: 100 }), limits({ stepBet: 0 }), limits({ gameModes: { base_vault: { costMultiplier: 2, maxBet: 1000000 } } }), limits({ gameModes: { buy_kraken: { costMultiplier: 100, maxBet: -1 } } })];
  for (const config of invalid) {
    const { session } = setup([auth({ config })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.phase, 'error');
    assert.equal(session.state.balance, null);
  }
});

test('missing null and empty mode metadata use authored modes with authenticated global limits', async () => {
  for (const gameModes of [undefined, null, {}, []]) for (const betModes of [undefined, null, {}, []]) {
    const config = limits({ gameModes, betModes, maxBet: 2500000 });
    const { session, calls } = setup([auth({ config })]);
    await session.init();
    assert.equal(session.state.phase, 'ready');
    assert.deepEqual(Object.keys(session.state.config.gameModes).sort(), Contract.MODES.map(mode => mode.name).sort());
    for (const mode of Contract.MODES) {
      assert.deepEqual(session.state.config.gameModes[mode.name], { costMultiplier: mode.cost, maxBet: 2500000 });
    }
    assert.equal(calls.length, 1);
  }
});

test('fallback and betModes configurations submit the base amount for all seven authored costs', async () => {
  const configurations = [
    limits({ gameModes: undefined }),
    limits({ gameModes: null, betModes: null }),
    limits({ gameModes: {}, betModes: {} }),
    limits({ gameModes: undefined, betModes: Object.fromEntries(Contract.MODES.map(mode => [mode.name, {}])) }),
  ];
  for (const config of configurations) for (const mode of Contract.MODES) {
    const amount = 1000000, initial = 1000000000;
    const { session, calls } = setup([auth({ config }), { balance: { amount: initial - amount * mode.cost, currency: 'USD' }, round: round({ mode: mode.name, amount, units: 125 }) }]);
    await session.init();
    const recorded = await session.start(mode.name, amount);
    assert.deepEqual(calls[1].body, { sessionID: 'session-secret', mode: mode.name, amount });
    assert.equal(recorded.cost, amount * mode.cost);
    assert.equal(recorded.payout, round({ mode: mode.name, amount, units: 125 }).payout);
    assert.equal(session.state.balance, initial - amount * mode.cost);
  }
});

test('current authored modes in the Studio array format authenticate and play each new mode', async () => {
  assert.deepEqual(Object.keys(STUDIO_CONFIG).sort(), ['gameID', 'minBet', 'maxBet', 'stepBet', 'defaultBetLevel', 'betLevels', 'gameModes', 'jurisdiction'].sort());
  assert.equal(STUDIO_CONFIG.gameID, '');
  assert.ok(Array.isArray(STUDIO_CONFIG.gameModes));
  assert.equal(STUDIO_CONFIG.gameModes.length, 7);
  for (const mode of Contract.MODES) {
    const amount = STUDIO_CONFIG.defaultBetLevel, initial = 1000000000;
    const debit = amount * mode.cost, payout = round({ mode: mode.name, amount, units: 125 }).payout;
    const { session, calls } = setup([{ balance: { amount: initial, currency: 'USD' }, config: STUDIO_CONFIG }, { balance: { amount: initial - debit, currency: 'USD' }, round: round({ mode: mode.name, amount, units: 125 }) }, { balance: { amount: initial - debit + payout, currency: 'USD' } }]);
    await session.init();
    assert.equal(session.state.phase, 'ready');
    assert.deepEqual(session.state.config.betLevels, STUDIO_CONFIG.betLevels);
    assert.equal(session.state.config.maxBet, 1000000000);
    assert.deepEqual(session.state.config.gameModes[mode.name], { costMultiplier: mode.cost, maxBet: 1000000000 });
    const recorded = await session.start(mode.name, amount);
    assert.deepEqual(calls[1].body, { sessionID: 'session-secret', mode: mode.name, amount });
    assert.equal(recorded.cost, debit);
    assert.equal(recorded.payout, payout);
    await session.finish();
    assert.equal(session.state.phase, 'ready');
    assert.equal(session.state.balance, initial - debit + payout);
    assert.equal(calls.filter(call => call.url.endsWith('/wallet/play')).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/wallet/end-round')).length, 1);
  }
});

test('both metadata aliases accept current-mode arrays without changing authored mode costs', async () => {
  for (const field of ['gameModes', 'betModes']) {
    const config = clone(STUDIO_CONFIG);
    delete config.gameModes;
    config[field] = clone(STUDIO_CONFIG.gameModes);
    const { session } = setup([{ balance: { amount: 1000000000, currency: 'USD' }, config }]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, Object.fromEntries(Contract.MODES.map(mode => [mode.name, { costMultiplier: mode.cost, maxBet: 1000000000 }])));
  }
});

test('nonempty mode arrays restrict availability and empty arrays cannot broaden them', async () => {
  for (const field of ['gameModes', 'betModes']) for (const empty of [undefined, null, {}, []]) {
    const other = field === 'gameModes' ? 'betModes' : 'gameModes';
    const config = limits({ [field]: [{ mode: 'ante_vault' }, { mode: 'buy_wheel', maxBet: 1500000 }], [other]: empty });
    const { session, calls } = setup([auth({ config })]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, { ante_vault: { costMultiplier: 2, maxBet: 100000000 }, buy_wheel: { costMultiplier: 185, maxBet: 1500000 } });
    await rejects(session.start('base_vault', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('buy_wheel', 1600000), 'INVALID_BET');
    assert.equal(calls.length, 1);
  }
});

test('mode arrays reject malformed items missing names and nonstring names', async () => {
  const items = [null, [], true, false, 1, 'base_vault', {}, { costMultiplier: 1 }, { mode: null }, { mode: 1 }, { mode: false }, { mode: [] }, { mode: {} }, { mode: '' }];
  for (const field of ['gameModes', 'betModes']) for (const item of items) {
    const other = field === 'gameModes' ? 'betModes' : 'gameModes';
    const config = limits({ [field]: [{ mode: 'base_vault' }, item], [other]: { base_vault: {} } });
    const { session } = setup([auth({ config })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.balance, null);
    assert.equal(session.state.phase, 'error');
  }
});

test('duplicate array mode names reject ambiguous availability costs and limits', async () => {
  const duplicates = [
    [{ mode: 'base_vault' }, { mode: 'base_vault' }],
    [{ mode: 'base_vault', costMultiplier: 1 }, { mode: 'base_vault', costMultiplier: 2 }],
    [{ mode: 'base_vault', maxBet: 1000000 }, { mode: 'base_vault', maxBet: 2000000 }],
    [{ mode: 'base_vault' }, { mode: 'unknown' }, { mode: 'unknown' }],
  ];
  for (const field of ['gameModes', 'betModes']) for (const value of duplicates) {
    const { session } = setup([auth({ config: limits({ gameModes: undefined, [field]: value }) })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.balance, null);
  }
});

test('array entry costs and maxima are validated before intersecting supported modes', async () => {
  const invalid = [{ costMultiplier: 1 }, { costMultiplier: '1' }, { costMultiplier: 0 }, { maxBet: 0 }, { maxBet: -1 }, { maxBet: 1.5 }, { maxBet: '1000000' }];
  for (const field of ['gameModes', 'betModes']) for (const entry of invalid) {
    const other = field === 'gameModes' ? 'betModes' : 'gameModes';
    const config = limits({ [field]: [{ mode: 'base_vault' }, { mode: 'ante_vault', ...entry }], [other]: { base_vault: {} } });
    const { session } = setup([auth({ config })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.balance, null);
  }
});

test('array and object metadata intersect modes and enforce every maximum on actual requests', async () => {
  const array = [{ mode: 'base_vault', costMultiplier: 1, maxBet: 1500000 }, { mode: 'ante_vault' }];
  const object = { base_vault: { maxBet: 1200000 }, buy_kraken: {} };
  for (const [gameModes, betModes] of [[array, object], [object, array], [array, Object.entries(object).map(([mode, entry]) => ({ mode, ...entry }))]]) {
    const config = limits({ maxBet: 2000000, gameModes, betModes });
    const { session, calls } = setup([auth({ config }), { balance: { amount: 998800000, currency: 'USD' }, round: round({ amount: 1200000 }) }]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, { base_vault: { costMultiplier: 1, maxBet: 1200000 } });
    await rejects(session.start('ante_vault', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('buy_kraken', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('base_vault', 1210000), 'INVALID_BET');
    await session.start('base_vault', 1200000);
    assert.deepEqual(calls[1].body, { sessionID: 'session-secret', mode: 'base_vault', amount: 1200000 });
  }
});

test('unknown-only and disjoint mode arrays never enable authored fallback modes', async () => {
  const configurations = [
    limits({ gameModes: [{ mode: 'unknown' }] }),
    limits({ gameModes: [], betModes: [{ mode: 'unknown' }] }),
    limits({ gameModes: [{ mode: 'base_vault' }], betModes: [{ mode: 'ante_vault' }] }),
    limits({ gameModes: [{ mode: 'base_vault' }], betModes: { ante_vault: {} } }),
  ];
  for (const config of configurations) {
    const { session } = setup([auth({ config })]);
    await rejects(session.init(), 'INVALID_CONFIG');
    assert.equal(session.state.balance, null);
  }
});

test('either nonempty mode map restricts availability and may omit authored costs', async () => {
  for (const field of ['betModes', 'gameModes']) {
    const config = limits({ gameModes: undefined, [field]: { ante_vault: {}, buy_vault: { maxBet: 1500000 } } });
    const { session, calls } = setup([auth({ config })]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, { ante_vault: { costMultiplier: 2, maxBet: 100000000 }, buy_vault: { costMultiplier: 100, maxBet: 1500000 } });
    await rejects(session.start('base_vault', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('buy_vault', 1600000), 'INVALID_BET');
    assert.equal(calls.length, 1);
  }
});

test('empty or absent metadata cannot broaden a restriction supplied by the other mode map', async () => {
  for (const field of ['betModes', 'gameModes']) for (const empty of [undefined, null, {}, []]) {
    const other = field === 'betModes' ? 'gameModes' : 'betModes';
    const config = limits({ [field]: { ante_vault: { costMultiplier: 2, maxBet: 1800000 } }, [other]: empty });
    const { session, calls } = setup([auth({ config })]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, { ante_vault: { costMultiplier: 2, maxBet: 1800000 } });
    await rejects(session.start('base_vault', 1000000), 'MODE_UNAVAILABLE');
    assert.equal(calls.length, 1);
  }
});

test('two nonempty mode maps intersect supported modes and preserve the strictest maximum', async () => {
  for (const maxima of [[1500000, 1200000, 2000000], [1200000, 1500000, 2000000], [2000000, 2500000, 1000000]]) {
    const [betMaximum, gameMaximum, globalMaximum] = maxima;
    const maximum = Math.min(...maxima);
    const config = limits({ maxBet: globalMaximum, betModes: { base_vault: { costMultiplier: 1, maxBet: betMaximum }, ante_vault: {} }, gameModes: { base_vault: { maxBet: gameMaximum }, buy_kraken: {} } });
    const { session, calls } = setup([auth({ config }), { balance: { amount: 1000000000 - maximum, currency: 'USD' }, round: round({ amount: maximum }) }]);
    await session.init();
    assert.deepEqual(session.state.config.gameModes, { base_vault: { costMultiplier: 1, maxBet: maximum } });
    await rejects(session.start('ante_vault', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('buy_kraken', 1000000), 'MODE_UNAVAILABLE');
    await rejects(session.start('base_vault', maximum + 10000), 'INVALID_BET');
    await session.start('base_vault', maximum);
    assert.equal(calls[1].body.amount, maximum);
  }
});

test('malformed mode maps and known entries fail even when another valid map is present', async () => {
  for (const field of ['betModes', 'gameModes']) {
    const other = field === 'betModes' ? 'gameModes' : 'betModes';
    const malformed = [['base_vault'], 0, 1, '', 'base_vault', true, false, { base_vault: null }, { base_vault: [] }, { base_vault: true }, { base_vault: 1 }, { base_vault: 'enabled' }];
    for (const value of malformed) {
      const config = limits({ [field]: value, [other]: { base_vault: {} } });
      const { session, calls } = setup([auth({ config })]);
      await assert.rejects(session.init(), Engine.EngineError);
      assert.equal(session.state.balance, null);
      assert.equal(session.state.phase, 'error');
      assert.equal(calls.length, 1);
    }
  }
});

test('explicit mode costs and maxima are validated for both aliases', async () => {
  for (const field of ['betModes', 'gameModes']) {
    for (const entry of [{ costMultiplier: 0 }, { costMultiplier: 2 }, { costMultiplier: '1' }, { costMultiplier: 1.5 }, { maxBet: 0 }, { maxBet: -1 }, { maxBet: 1.5 }, { maxBet: '1000000' }, { maxBet: [] }, { maxBet: {} }]) {
      const config = limits({ gameModes: undefined, [field]: { base_vault: entry } });
      const { session } = setup([auth({ config })]);
      await assert.rejects(session.init(), Engine.EngineError);
      assert.equal(session.state.balance, null);
    }
  }
});

test('cost mismatches in either metadata source cannot be hidden by intersection', async () => {
  const maps = [
    { betModes: { base_vault: { costMultiplier: 2 } }, gameModes: { base_vault: { costMultiplier: 1 } } },
    { betModes: { base_vault: { costMultiplier: 1 } }, gameModes: { base_vault: { costMultiplier: 2 } } },
    { betModes: { base_vault: {}, ante_vault: { costMultiplier: 1 } }, gameModes: { base_vault: {} } },
    { betModes: { base_vault: {} }, gameModes: { base_vault: {}, ante_vault: { costMultiplier: 1 } } },
  ];
  for (const metadata of maps) {
    const { session } = setup([auth({ config: limits(metadata) })]);
    await rejects(session.init(), 'MODE_COST_MISMATCH');
    assert.equal(session.state.balance, null);
  }
});

test('unknown-only or disjoint nonempty mode maps never fall back to all modes', async () => {
  const configurations = [
    limits({ gameModes: undefined, betModes: { unknown: {} } }),
    limits({ gameModes: { unknown: {} } }),
    limits({ gameModes: { base_vault: {} }, betModes: { ante_vault: {} } }),
    limits({ gameModes: {}, betModes: { unknown: {} } }),
    limits({ gameModes: { unknown: {} }, betModes: {} }),
  ];
  for (const config of configurations) {
    const { session, calls } = setup([auth({ config })]);
    await rejects(session.init(), 'INVALID_CONFIG');
    assert.equal(session.state.balance, null);
    assert.equal(calls.length, 1);
  }
});

test('an explicit metadata mode must agree with its authored key', async () => {
  for (const field of ['betModes', 'gameModes']) {
    const { session } = setup([auth({ config: limits({ gameModes: undefined, [field]: { base_vault: { mode: 'ante_vault' } } }) })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.balance, null);
    const valid = setup([auth({ config: limits({ gameModes: undefined, [field]: { base_vault: { mode: 'base_vault' } } }) })]);
    await valid.session.init();
    assert.deepEqual(valid.session.state.config.gameModes, { base_vault: { costMultiplier: 1, maxBet: 100000000 } });
  }
});

test('fallback modes still enforce global limits balance and feature purchase restrictions', async () => {
  const config = limits({ gameModes: undefined, betModes: {}, minBet: 20000, maxBet: 1500000, stepBet: 20000, jurisdiction: { disabledBuyFeature: true } });
  const { session, calls } = setup([auth({ config, balance: { amount: 500000, currency: 'USD' } })]);
  await session.init();
  for (const amount of [10000, 1500001, 1520000, 30000, 20000.5]) await rejects(session.start('base_vault', amount), 'INVALID_BET');
  await rejects(session.start('base_vault', 1000000), 'INSUFFICIENT_BALANCE');
  await rejects(session.start('buy_kraken', 20000), 'MODE_UNAVAILABLE');
  assert.equal(calls.length, 1);
  const { session: outside } = setup([auth({ config: limits({ gameModes: null, jurisdiction: undefined }), jurisdictionFlags: { disabledBuyFeature: true } })]);
  await outside.init();
  await rejects(outside.start('buy_vault', 1000000), 'MODE_UNAVAILABLE');
});

test('reauthentication replaces fallback availability and global limits after a lost request', async () => {
  const first = limits({ gameModes: undefined });
  const next = limits({ gameModes: {}, betModes: { ante_vault: {} }, maxBet: 500000, stepBet: 20000 });
  const { session, calls } = setup([auth({ config: first }), () => { throw new Error('lost'); }, auth({ config: next }), { balance: { amount: 999500000, currency: 'USD' }, round: round({ mode: 'ante_vault', amount: 500000 }) }]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK', true);
  await session.recover();
  assert.equal(session.state.phase, 'ready');
  assert.deepEqual(session.state.config.gameModes, { ante_vault: { costMultiplier: 2, maxBet: 500000 } });
  await rejects(session.start('base_vault', 20000), 'MODE_UNAVAILABLE');
  await rejects(session.start('ante_vault', 520000), 'INVALID_BET');
  await rejects(session.start('ante_vault', 30000), 'INVALID_BET');
  await session.start('ante_vault', 500000);
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/play')).length, 2);
  assert.deepEqual(calls.at(-1).body, { sessionID: 'session-secret', mode: 'ante_vault', amount: 500000 });
});

test('an accepted round survives reauthentication even when refreshed metadata removes its mode', async () => {
  const next = limits({ gameModes: undefined, betModes: { ante_vault: { maxBet: 500000 } } });
  const accepted = round({ mode: 'buy_vault', units: 125 });
  const { session, calls } = setup([auth({ config: limits({ gameModes: null }) }), () => { throw new Error('lost'); }, auth({ config: next, balance: { amount: 900000000, currency: 'USD' }, round: accepted }), { balance: { amount: 901250000, currency: 'USD' } }]);
  await session.init();
  await rejects(session.start('buy_vault', 1000000), 'NETWORK', true);
  await session.recover();
  assert.equal(session.state.phase, 'active');
  assert.equal(session.state.round.mode, 'buy_vault');
  assert.equal(session.state.round.cost, 100000000);
  await session.finish();
  await rejects(session.start('buy_vault', 1000000), 'MODE_UNAVAILABLE');
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/play')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/end-round')).length, 1);
});

test('malformed refreshed mode metadata cannot replace an already authenticated wallet', async () => {
  const { session } = setup([auth({ config: limits({ gameModes: undefined }) }), () => { throw new Error('lost'); }, auth({ balance: { amount: 123, currency: 'USD' }, config: limits({ gameModes: undefined, betModes: { base_vault: { costMultiplier: 2 } } }) })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK');
  await rejects(session.recover(), 'MODE_COST_MISMATCH');
  assert.equal(session.state.balance, 1000000000);
  assert.equal(session.state.phase, 'error');
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
});

test('per-mode maximum and bet increments are enforced while betLevels remain advisory', async () => {
  const config = limits({ gameModes: { base_vault: { costMultiplier: 1, maxBet: 1500000 } }, betLevels: [1000000] });
  const wager = round({ amount: 1100000 });
  const { session, calls } = setup([auth({ config }), { balance: { amount: 998900000, currency: 'USD' }, round: wager }]);
  await session.init();
  await rejects(session.start('ante_vault', 1000000), 'MODE_UNAVAILABLE');
  for (const amount of [9999, 1500001, 1600000, 1000001, 10000.5]) await rejects(session.start('base_vault', amount), 'INVALID_BET');
  assert.equal(calls.length, 1);
  assert.equal((await session.start('base_vault', 1100000)).amount, 1100000);
  assert.deepEqual(calls[1].body, { sessionID: 'session-secret', mode: 'base_vault', amount: 1100000 });
});

test('jurisdiction flags support both official response layouts and block feature purchases', async () => {
  for (const response of [auth({ config: limits({ jurisdiction: { disabledBuyFeature: true, disabledAutoplay: true } }) }), auth({ config: limits({ jurisdiction: undefined }), jurisdictionFlags: { disabledBuyFeature: true } })]) {
    const { session, calls } = setup([response]);
    await session.init();
    assert.equal(session.state.config.jurisdiction.disabledBuyFeature, true);
    await rejects(session.start('buy_kraken', 1000000), 'MODE_UNAVAILABLE');
    assert.equal(calls.length, 1);
  }
});

test('each published mode submits the base amount while exposing its actual cost', async () => {
  for (const mode of Contract.MODES) {
    const initial = 1000000000, amount = 1000000, expected = round({ mode: mode.name, units: 125 });
    const { session, calls } = setup([auth(), { balance: { amount: initial - amount * mode.cost, currency: 'USD' }, round: round({ mode: mode.name, units: 125 }) }, { balance: { amount: initial - amount * mode.cost + expected.payout, currency: 'USD' } }]);
    await session.init();
    const outcome = await session.start(mode.name, amount);
    assert.equal(calls[1].body.amount, amount);
    assert.equal(outcome.cost, amount * mode.cost);
    assert.equal(outcome.payout, expected.payout);
    assert.equal(outcome.payoutUnits, expected.payoutMultiplier * 100);
    assert.equal(session.state.balance, initial - amount * mode.cost);
    await session.finish();
    assert.equal(session.state.balance, initial - amount * mode.cost + expected.payout);
    assert.equal(session.state.round, null);
    assert.equal(session.state.phase, 'ready');
  }
});

test('financial snapshots and recorded events cannot be mutated by the presentation layer', async () => {
  const { session } = setup([auth(), { balance: { amount: 999000000, currency: 'USD' }, round: round() }]);
  await session.init();
  const before = session.state;
  const outcome = await session.start('base_vault', 1000000);
  assert.equal(before.balance, 1000000000);
  assert.ok(Object.isFrozen(outcome.events[0].base.ev));
  assert.equal(Reflect.set(outcome, 'amount', 1), false);
  assert.equal(Reflect.set(session.state.config.gameModes.base_vault, 'costMultiplier', 100), false);
  assert.equal(session.state.round.amount, 1000000);
});

test('start rejects overlapping clicks without placing a second wager or changing balance optimistically', async () => {
  let resolve;
  const { session, calls } = setup([auth(), () => new Promise(done => { resolve = done; })]);
  await session.init();
  const first = session.start('base_vault', 1000000);
  assert.equal(session.state.balance, 1000000000);
  await rejects(session.start('base_vault', 1000000), 'BUSY');
  assert.equal(calls.length, 2);
  resolve(result({ balance: { amount: 999000000, currency: 'USD' }, round: round() }));
  await first;
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
  assert.equal(calls.length, 2);
});

test('active authentication resumes the existing book with its saved checkpoint and no play request', async () => {
  const { session, calls } = setup([auth({ round: round({ event: '0', units: 100 }) })]);
  await session.init();
  assert.equal(session.state.phase, 'active');
  assert.equal(session.state.round.id, 'round-1');
  assert.equal(session.state.round.eventIndex, 0);
  assert.equal(session.state.round.payout, 1000000);
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
  assert.equal(calls.length, 1);
});

test('inactive previous rounds do not become new live wagers', async () => {
  const { session, calls } = setup([auth({ round: round({ active: false }) })]);
  await session.init();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.round, null);
  await session.finish();
  assert.equal(calls.length, 1);
});

test('missing round state, payout disagreement, invalid cursor and mismatched identities fail authentication', async () => {
  const invalid = [round({ state: undefined }), round({ state: [] }), round({ payout: 1 }), round({ payoutMultiplier: 1 }), round({ id: 'other' }), round({ betID: {}, id: undefined }), round({ event: '2' }), round({ event: '-1' }), round({ active: undefined })];
  for (const value of invalid) {
    const { session } = setup([auth({ round: value })]);
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.phase, 'error');
    assert.equal(session.state.balance, null);
  }
});

test('Studio authentication with only balance and config means no active round', async () => {
  const response = { balance: { amount: 1000000000, currency: 'USD' }, config: clone(STUDIO_CONFIG) };
  assert.deepEqual(Object.keys(response), ['balance', 'config']);
  const { session, calls } = setup([response]);
  await session.init();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.round, null);
  assert.equal(session.state.balance, 1000000000);
  assert.equal(Object.keys(session.state.config.gameModes).length, 7);
  assert.equal(calls.length, 1);
});

test('a play response must match requested mode, amount and a new round identity', async () => {
  for (const value of [round({ mode: 'ante_vault' }), round({ amount: 2000000 }), round({ id: 'previous', betID: 'previous' })]) {
    const { session, calls } = setup([auth({ round: round({ id: 'previous', betID: 'previous', active: false }) }), { balance: { amount: 999000000, currency: 'USD' }, round: value }]);
    await session.init();
    await rejects(session.start('base_vault', 1000000), 'ROUND_MISMATCH', true);
    assert.equal(session.state.balance, 1000000000);
    await rejects(session.start('base_vault', 1000000), 'NOT_READY');
    assert.equal(calls.length, 2);
  }
});

test('currency changes during play or settlement never change the local wallet', async () => {
  const { session } = setup([auth(), { balance: { amount: 999000000, currency: 'EUR' }, round: round() }]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'CURRENCY_MISMATCH', true);
  assert.equal(session.state.balance, 1000000000);
  assert.equal(session.state.currency, 'USD');
  const settled = setup([auth({ round: round() }), { balance: { amount: 123, currency: 'EUR' } }]);
  await settled.session.init();
  await rejects(settled.session.finish(), 'CURRENCY_MISMATCH', true);
  assert.equal(settled.session.state.balance, 1000000000);
});

test('monotonic event checkpoints use the official string wire and never alter the wallet', async () => {
  const { session, calls } = setup([auth({ round: round() }), { event: '0' }, { event: '1' }]);
  await session.init();
  await session.checkpoint(0);
  await session.checkpoint(0);
  await session.checkpoint(1);
  await session.checkpoint(0);
  assert.equal(session.state.round.eventIndex, 1);
  assert.equal(session.state.balance, 1000000000);
  assert.deepEqual(calls.slice(1).map(call => [call.url, call.body]), [['https://rgs.example/bet/event', { sessionID: 'session-secret', event: '0' }], ['https://rgs.example/bet/event', { sessionID: 'session-secret', event: '1' }]]);
  await rejects(session.checkpoint(2), 'INVALID_EVENT');
});

test('checkpoint disagreement blocks progress until authentication recovers the confirmed server cursor', async () => {
  const { session, calls } = setup([auth({ round: round() }), { event: '1' }, auth({ round: round({ event: '0' }) })]);
  await session.init();
  await rejects(session.checkpoint(0), 'EVENT_MISMATCH');
  await rejects(session.finish(), 'NOT_READY');
  await session.recover();
  assert.equal(session.state.phase, 'active');
  assert.equal(session.state.round.eventIndex, 0);
  assert.equal(calls[2].url, 'https://rgs.example/wallet/authenticate');
});

test('server-closed zero wins finish locally without an end-round request', async () => {
  const { session, calls } = setup([auth(), { balance: { amount: 999000000, currency: 'USD' }, round: round({ active: false }) }]);
  await session.init();
  await session.start('base_vault', 1000000);
  await session.checkpoint(1);
  await session.finish();
  await session.finish();
  assert.equal(calls.length, 2);
  assert.equal(session.state.balance, 999000000);
});

test('settlement replaces the balance exactly once, including a returned zero balance', async () => {
  let resolve;
  const { session, calls } = setup([auth({ round: round({ units: 500000 }) }), () => new Promise(done => { resolve = done; })]);
  await session.init();
  const first = session.finish();
  await rejects(session.finish(), 'BUSY');
  assert.equal(session.state.balance, 1000000000);
  resolve(result({ balance: { amount: 0, currency: 'USD' } }));
  await first;
  await session.finish();
  assert.equal(session.state.balance, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { sessionID: 'session-secret' });
});

test('a disconnected wager is never retried and recovery resumes the accepted active round', async () => {
  const { session, calls } = setup([auth(), () => { throw new Error('lost connection'); }, auth({ balance: { amount: 999000000, currency: 'USD' }, round: round({ units: 150 }) })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK', true);
  assert.equal(session.state.balance, 1000000000);
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
  await session.recover();
  assert.equal(session.state.phase, 'active');
  assert.equal(session.state.balance, 999000000);
  assert.equal(session.state.round.payoutUnits, 150);
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/play')).length, 1);
  assert.equal(calls[2].url, 'https://rgs.example/wallet/authenticate');
});

test('request timeout remains ambiguous even when fetch ignores abort and requires recovery', async () => {
  const { session, calls } = setup([auth(), () => new Promise(() => {}), auth()], { timeoutMs: 15 });
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'TIMEOUT', true);
  assert.equal(calls[1].init.signal.aborted, true);
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
  await session.recover();
  assert.equal(session.state.phase, 'ready');
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/play')).length, 1);
});

test('timeout covers unreadable response bodies as well as connection setup', async () => {
  const { session } = setup([() => ({ ok: true, status: 200, json: () => new Promise(() => {}) })], { timeoutMs: 15 });
  await rejects(session.init(), 'TIMEOUT', false);
  assert.equal(session.state.balance, null);
});

test('interrupted wagers already closed by the server are presented once without resubmitting or resettling', async () => {
  const { session, calls } = setup([auth(), () => { throw new Error('lost'); }, auth({ balance: { amount: 999000000, currency: 'USD' }, round: round({ active: false }) })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK');
  await session.recover();
  assert.equal(session.state.phase, 'active');
  assert.equal(session.state.round.active, false);
  await session.finish();
  assert.equal(session.state.phase, 'ready');
  assert.equal(calls.length, 3);
});

test('authentication after an interrupted rejected wager returns ready without presenting the old round', async () => {
  const previous = round({ id: 'old', betID: 'old', active: false });
  const { session } = setup([auth({ round: previous }), () => { throw new Error('lost'); }, auth({ round: previous })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK');
  await session.recover();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.round, null);
});

test('a mismatched recovered wager stays blocked and cannot replace the wallet', async () => {
  const { session, calls } = setup([auth(), () => { throw new Error('lost'); }, auth({ balance: { amount: 12, currency: 'USD' }, round: round({ amount: 2000000 }) })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'NETWORK');
  await rejects(session.recover(), 'ROUND_MISMATCH');
  assert.equal(session.state.phase, 'error');
  assert.equal(session.state.balance, 1000000000);
  await rejects(session.start('base_vault', 1000000), 'NOT_READY');
  assert.equal(calls.length, 3);
});

test('lost settlement responses recover a closed round without a second end-round call', async () => {
  const settled = round({ units: 225, active: false });
  const { session, calls } = setup([auth({ round: round({ units: 225 }) }), () => { throw new Error('lost'); }, auth({ balance: { amount: 1002250000, currency: 'USD' }, round: settled })]);
  await session.init();
  await rejects(session.finish(), 'NETWORK', true);
  await rejects(session.finish(), 'NOT_READY');
  await session.recover();
  await session.finish();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.balance, 1002250000);
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/end-round')).length, 1);
});

test('an uncompleted settlement can only retry after authentication confirms the same active round', async () => {
  const { session, calls } = setup([auth({ round: round() }), () => { throw new Error('lost'); }, auth({ round: round() }), { balance: { amount: 0, currency: 'USD' } }]);
  await session.init();
  await rejects(session.finish(), 'NETWORK');
  await session.recover();
  assert.equal(session.state.phase, 'active');
  await session.finish();
  assert.deepEqual(calls.map(call => call.url.split('/').at(-1)), ['authenticate', 'end-round', 'authenticate', 'end-round']);
  assert.equal(session.state.balance, 0);
});

test('lost settlement responses accept an omitted or empty authenticated round without another settlement', async () => {
  for (const current of [undefined, null, {}]) {
    const { session, calls } = setup([auth({ round: round({ units: 225 }) }), () => { throw new Error('lost'); }, auth({ balance: { amount: 1002250000, currency: 'USD' }, round: current })]);
    await session.init();
    await rejects(session.finish(), 'NETWORK', true);
    await session.recover();
    await session.finish();
    assert.equal(session.state.phase, 'ready');
    assert.equal(session.state.round, null);
    assert.equal(session.state.balance, 1002250000);
    assert.equal(calls.filter(call => call.url.endsWith('/wallet/end-round')).length, 1);
  }
});

test('invalid empty-looking round values cannot masquerade as confirmed settlement', async () => {
  for (const current of [false, 0, '', []]) {
    const { session } = setup([auth({ round: round() }), () => { throw new Error('lost'); }, auth({ round: current })]);
    await session.init();
    await rejects(session.finish(), 'NETWORK');
    await rejects(session.recover(), 'INVALID_ROUND');
    assert.equal(session.state.phase, 'error');
    assert.equal(session.state.round.id, 'round-1');
  }
});

test('a server-active zero-payout round still requires exactly one end-round request', async () => {
  const { session, calls } = setup([auth({ round: round({ units: 0, active: true }) }), { balance: { amount: 0, currency: 'USD' } }]);
  await session.init();
  await session.finish();
  await session.finish();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.balance, 0);
  assert.equal(calls.filter(call => call.url.endsWith('/wallet/end-round')).length, 1);
});

test('recovery refuses a different round identity after a failed settlement', async () => {
  const { session } = setup([auth({ round: round() }), () => { throw new Error('lost'); }, auth({ round: round({ id: 'other', betID: 'other' }) })]);
  await session.init();
  await rejects(session.finish(), 'NETWORK');
  await rejects(session.recover(), 'ROUND_MISMATCH');
  assert.equal(session.state.round.id, 'round-1');
});

test('HTTP rejections retain server error codes and cannot trigger an automatic retry or refill', async () => {
  for (const [status, code, ambiguous] of [[400, 'ERR_IPB', false], [400, 'ERR_IS', false], [500, 'ERR_GEN', true]]) {
    const { session, calls } = setup([auth(), () => result({ error: { code, message: 'sensitive session-secret' } }, status)]);
    await session.init();
    await rejects(session.start('base_vault', 1000000), code, ambiguous);
    assert.equal(session.state.balance, 1000000000);
    assert.equal(session.state.error.message.includes('session-secret'), false);
    assert.equal(calls.length, 2);
  }
});

test('a malformed successful play response is ambiguous and cannot create a local outcome', async () => {
  const { session } = setup([auth(), () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } })]);
  await session.init();
  await rejects(session.start('base_vault', 1000000), 'INVALID_RESPONSE', true);
  assert.equal(session.state.round, null);
  assert.equal(session.state.balance, 1000000000);
});

test('replay launch performs only the unauthenticated GET and repeat playback remains local', async () => {
  const location = REPLAY + '&sessionID=must-not-send&amount=2000000&currency=EUR';
  const { session, calls } = setup([{ state: events('base_vault', 250), costMultiplier: 1, payoutMultiplier: 2.5 }], { location });
  await session.init();
  assert.equal(calls[0].url, 'https://rgs.example/bet/replay/game-123/1/base_vault/42');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, null);
  assert.equal(JSON.stringify(calls).includes('must-not-send'), false);
  assert.equal(session.state.balance, null);
  assert.equal(session.state.currency, 'EUR');
  assert.equal(session.state.round.payout, 5000000);
  assert.equal(session.state.phase, 'replay');
  await rejects(session.start('base_vault', 2000000), 'REPLAY_ONLY');
  await session.checkpoint(1);
  await session.finish();
  assert.equal((await session.replay()).eventIndex, -1);
  await session.finish();
  assert.equal(calls.length, 1);
});

test('invalid optional replay values fall back safely while required launch values fail', async () => {
  const { session } = setup([{ state: events(), costMultiplier: 1, payoutMultiplier: 0 }], { location: REPLAY + '&amount=-42&currency=bad&lang=not-a-language&social=true' });
  await session.init();
  assert.equal(session.state.round.amount, 1000000);
  assert.equal(session.state.currency, 'XSC');
  for (const location of [REPLAY.replace('&event=42', ''), REPLAY.replace('event=42', 'event=..%2Fsecret'), REPLAY.replace('mode=base_vault', 'mode=unknown')]) {
    const invalid = setup([], { location });
    await assert.rejects(invalid.session.init(), Engine.EngineError);
    assert.equal(invalid.calls.length, 0);
  }
});

test('replay missing events, mismatched costs or inconsistent payout cannot start playback', async () => {
  for (const response of [{ costMultiplier: 1, payoutMultiplier: 0 }, { state: events(), costMultiplier: 2, payoutMultiplier: 0 }, { state: events(), costMultiplier: 1, payoutMultiplier: 10 }]) {
    const { session, calls } = setup([response], { location: REPLAY });
    await assert.rejects(session.init(), Engine.EngineError);
    assert.equal(session.state.round, null);
    assert.equal(session.state.balance, null);
    assert.equal(calls.length, 1);
  }
});

test('a plain replay 404 is reported clearly without attempting authentication', async () => {
  const { session, calls } = setup([() => ({ ok: false, status: 404, json: async () => { throw new Error('not JSON'); } })], { location: REPLAY });
  await rejects(session.init(), 'HTTP_404', false);
  assert.match(session.state.error.message, /replay was not found/);
  assert.equal(calls.length, 1);
  assert.equal(session.state.replayOnly, true);
});

test('replay recovery only refetches the unauthenticated replay endpoint', async () => {
  const response = { state: events(), costMultiplier: 1, payoutMultiplier: 0 };
  const { session, calls } = setup([() => { throw new Error('offline'); }, response], { location: REPLAY });
  await rejects(session.init(), 'NETWORK');
  await session.recover();
  assert.equal(session.state.phase, 'replay');
  assert.ok(calls.every(call => call.method === 'GET' && call.url.includes('/bet/replay/')));
});

test('micro-unit payout calculation preserves fractions below a cent and caps without floating wallet math', async () => {
  const amount = 10001, units = 13, config = limits({ minBet: 1, stepBet: 1 });
  const { session } = setup([auth({ config }), { balance: { amount: 999989999, currency: 'USD' }, round: round({ amount, units }) }, { balance: { amount: 999991299, currency: 'USD' } }]);
  await session.init();
  const recorded = await session.start('base_vault', amount);
  assert.equal(recorded.payout, 1300);
  await session.finish();
  assert.equal(session.state.balance, 999991299);
});

test('overflowing mode costs and replay payouts fail before any unsafe arithmetic reaches the wallet', async () => {
  const huge = Number.MAX_SAFE_INTEGER;
  const config = limits({ maxBet: huge, stepBet: 1, gameModes: { buy_kraken: { costMultiplier: 500, maxBet: huge } } });
  const { session, calls } = setup([auth({ config, balance: { amount: huge, currency: 'USD' } })]);
  await session.init();
  await rejects(session.start('buy_kraken', huge), 'AMOUNT_OVERFLOW');
  assert.equal(calls.length, 1);
  const replay = setup([{ state: events('base_vault', 500000), costMultiplier: 1, payoutMultiplier: 5000 }], { location: REPLAY + '&amount=' + huge });
  await rejects(replay.session.init(), 'INVALID_RESPONSE');
  assert.equal(replay.session.state.balance, null);
});

test('consumer update errors cannot corrupt request completion or authoritative wallet state', async () => {
  const { session } = setup([auth()], { onChange() { throw new Error('presentation failure'); } });
  await session.init();
  assert.equal(session.state.phase, 'ready');
  assert.equal(session.state.balance, 1000000000);
});

test('the captured twelve-mode Studio configuration rejects outdated purchase costs', async () => {
  assert.equal(LEGACY_STUDIO_CONFIG.gameModes.length, 12);
  const { session, calls } = setup([auth({ config: LEGACY_STUDIO_CONFIG })]);
  await rejects(session.init(), 'MODE_COST_MISMATCH');
  assert.equal(session.state.balance, null);
  assert.equal(calls.length, 1);
});

test('every authenticated bet level debits each authored cost without scaling the base amount sent', async () => {
  for (const amount of STUDIO_CONFIG.betLevels) for (const mode of Contract.MODES) {
    const initial = amount * mode.cost + 1000000000;
    const expected = round({ mode: mode.name, amount, units: 125 });
    const { session, calls } = setup([auth({ balance: { amount: initial, currency: 'USD' }, config: STUDIO_CONFIG }), { balance: { amount: initial - amount * mode.cost, currency: 'USD' }, round: expected }, { balance: { amount: initial - amount * mode.cost + expected.payout, currency: 'USD' } }]);
    await session.init();
    const outcome = await session.start(mode.name, amount);
    assert.equal(calls[1].body.amount, amount);
    assert.equal(outcome.cost, amount * mode.cost);
    assert.equal(outcome.payout, expected.payout);
    await session.finish();
    assert.equal(session.state.balance, initial - amount * mode.cost + expected.payout);
  }
});

test('a changed server cost for any current mode is rejected before enabling play', async () => {
  for (const mode of Contract.MODES) {
    const config = limits({ gameModes: [{ mode: mode.name, costMultiplier: mode.cost + 1 }] });
    const { session, calls } = setup([auth({ config })]);
    await rejects(session.init(), 'MODE_COST_MISMATCH');
    assert.equal(session.state.balance, null);
    assert.equal(calls.length, 1);
  }
});

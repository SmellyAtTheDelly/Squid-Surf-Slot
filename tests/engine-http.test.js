'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');
const { createServer } = require('../tools/serve');
const { Publication, DemoRgs } = require('../tools/demo-rgs');
const Engine = require('../frontend/js/engine');
const C = require('../shared/contract');
const B = require('../math/books');
const M = require('../math/model');

function publication(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squid-http-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('squid-http-'));
    fs.rmSync(resolved, { recursive: true });
  });
  const modes = C.MODES.map((mode, index) => {
    const book = B.generateBook(M.mulberry32(18 + index), { mode: mode.name, id: 0 });
    const entry = { name: mode.name, cost: mode.cost, events: mode.name + '.jsonl.zst', weights: mode.name + '.csv' };
    fs.writeFileSync(path.join(directory, entry.events), zlib.zstdCompressSync(JSON.stringify(book) + '\n'));
    fs.writeFileSync(path.join(directory, entry.weights), '0,1,' + book.payoutMultiplier + '\n');
    return entry;
  });
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({ modes }));
  return new Publication(directory);
}

async function host(t) {
  const source = publication(t), rgs = new DemoRgs(source), server = createServer({ rgs });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const location = new URL('/?' + new URLSearchParams({ sessionID: 'integration', rgs_url: origin, demo: 'true', currency: 'USD' }), origin);
  return { source, rgs, origin, location };
}

test('all seven modes play and settle through real HTTP and compressed publication files', async t => {
  const { source, location } = await host(t);
  const engine = Engine.create({ location, fetch });
  await engine.init();
  let expected = engine.state.balance;
  for (const selected of C.MODES) {
    const book = await source.replay(selected.name, 0), round = await engine.start(selected.name, 10000);
    expected -= selected.cost * 10000;
    assert.equal(engine.state.balance, expected);
    assert.equal(round.payoutUnits, book.payoutMultiplier);
    assert.deepEqual(round.events, book.events);
    await engine.checkpoint(round.events.length - 1);
    await engine.finish();
    expected += C.payoutAmount(10000, book.payoutMultiplier);
    assert.equal(engine.state.balance, expected);
    assert.equal(engine.state.phase, 'ready');
  }
});

test('refresh restores the accepted HTTP round and only credits it once', async t => {
  const { location } = await host(t);
  const first = Engine.create({ location, fetch });
  await first.init();
  const round = await first.start('buy_reef', 10000), debited = first.state.balance;
  assert.equal(round.active, true);
  await first.checkpoint(1);
  const restored = Engine.create({ location, fetch });
  await restored.init();
  assert.equal(restored.state.round.id, round.id);
  assert.equal(restored.state.round.eventIndex, 1);
  assert.equal(restored.state.balance, debited);
  await restored.finish();
  const final = debited + round.payout;
  assert.equal(restored.state.balance, final);
  await restored.finish();
  assert.equal(restored.state.balance, final);
});

test('every replay loads recorded events through GET without authenticating or changing the wallet', async t => {
  const { origin, rgs } = await host(t);
  for (const selected of C.MODES) {
    const location = new URL('/?' + new URLSearchParams({ replay: 'true', game: 'local-game', version: '1', mode: selected.name, event: '0', amount: '10000', rgs_url: origin, demo: 'true', currency: 'USD' }), origin);
    const requests = [], engine = Engine.create({ location, fetch: (url, options) => { requests.push([url, options]); return fetch(url, options); } });
    await engine.init();
    assert.equal(engine.state.phase, 'replay');
    assert.equal(engine.state.balance, null);
    assert.equal(engine.state.round.cost, selected.cost * 10000);
    await engine.checkpoint(1);
    await engine.finish();
    await engine.replay();
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].method, 'GET');
    assert.equal(rgs.sessions.size, 0);
  }
});

test('local launch stays same-origin, serves local assets and does not expose math source', async t => {
  const { origin } = await host(t);
  const launch = await fetch(origin + '/', { redirect: 'manual' });
  assert.equal(launch.status, 302);
  const target = new URL(launch.headers.get('location'), origin);
  assert.equal(target.searchParams.get('rgs_url'), origin);
  assert.equal(target.searchParams.get('demo'), 'true');
  const page = await fetch(target);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Squid/);
  const font = await fetch(origin + '/assets/fonts/lilita-one.ttf');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/ttf');
  for (const name of ['/math/model.js', '/js/math.js', '/dist/math/index.json']) assert.equal((await fetch(origin + name)).status, 404);
});

test('a corrupted publication is rejected without debiting a real HTTP session', async t => {
  const { source, origin, location } = await host(t);
  const entry = source.index.modes.find(mode => mode.name === 'buy_reef');
  fs.writeFileSync(source.file(entry.events), 'invalid compressed content');
  const engine = Engine.create({ location, fetch });
  await engine.init();
  const before = engine.state.balance;
  await assert.rejects(engine.start('buy_reef', 10000));
  const response = await fetch(origin + '/wallet/authenticate', { method: 'POST', body: JSON.stringify({ sessionID: 'integration' }), headers: { 'Content-Type': 'application/json' } });
  const recovered = await response.json();
  assert.equal(recovered.balance.amount, before);
  assert.equal(recovered.round, null);
});

test('a structurally readable but invalid model outcome cannot debit a local wallet', async t => {
  const { source, location, rgs } = await host(t);
  const entry = source.index.modes.find(mode => mode.name === 'buy_reef');
  const book = JSON.parse(zlib.zstdDecompressSync(fs.readFileSync(source.file(entry.events))).toString());
  book.events[0].base.fsAward = 1;
  fs.writeFileSync(source.file(entry.events), zlib.zstdCompressSync(JSON.stringify(book) + '\n'));
  const engine = Engine.create({ location, fetch });
  await engine.init();
  const before = engine.state.balance;
  await assert.rejects(engine.start('buy_reef', 10000));
  assert.equal(rgs.sessions.get('integration').amount, before);
  assert.equal(rgs.sessions.get('integration').round, null);
});

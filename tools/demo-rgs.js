'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline');
const C = require('../shared/contract.js');
const B = require('../math/books.js');

function randomBelow(total, source = crypto.randomBytes) {
  if (typeof total !== 'bigint' || total <= 0n || total > 0xffffffffffffffffn) throw new RangeError('Invalid probability total');
  const range = 1n << 64n, limit = range - range % total;
  for (;;) { const value = source(8).readBigUInt64LE(); if (value < limit) return value % total; }
}

class Publication {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.index = JSON.parse(fs.readFileSync(path.join(this.directory, 'index.json'), 'utf8'));
    this.lookups = new Map(); this.books = new Map();
    for (const selected of C.MODES) {
      const entry = this.index.modes.find(value => value.name === selected.name);
      if (!entry || entry.cost !== selected.cost) throw new Error('Incomplete math publication');
      for (const name of [entry.events, entry.weights]) this.file(name);
    }
  }
  file(name) {
    if (typeof name !== 'string') throw new Error('Invalid publication path');
    const target = path.resolve(this.directory, name);
    if (!target.startsWith(this.directory + path.sep) || !fs.existsSync(target)) throw new Error('Invalid publication file');
    return target;
  }
  lookup(name) {
    C.mode(name);
    if (this.lookups.has(name)) return this.lookups.get(name);
    const entry = this.index.modes.find(value => value.name === name);
    const lines = fs.readFileSync(this.file(entry.weights), 'utf8').trim().split(/\r?\n/);
    let total = 0n;
    const rows = lines.map((line, position) => {
      if (!/^\d+,\d+,\d+$/.test(line)) throw new Error('Invalid lookup row');
      const [id, weight, payout] = line.split(',').map(BigInt); total += weight;
      if (payout > 500000n || id > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid lookup value');
      return { id: Number(id), weight, end: total, payout: Number(payout), position };
    });
    if (!total || total > 0xffffffffffffffffn) throw new Error('Invalid weight sum');
    const result = { entry, rows, total };
    if (this.lookups.size >= 2) this.lookups.delete(this.lookups.keys().next().value);
    this.lookups.set(name, result); return result;
  }
  async read(name, row) {
    const key = name + '/' + row.position;
    if (this.books.has(key)) return this.books.get(key);
    const entry = this.lookup(name).entry, input = fs.createReadStream(this.file(entry.events));
    const stream = /\.(zst|zstd)$/.test(entry.events) ? input.pipe(zlib.createZstdDecompress()) : input;
    if (stream !== input) input.on('error', error => stream.destroy(error));
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let position = 0;
    try {
      for await (const line of reader) {
        if (!line.trim()) continue;
        if (position++ !== row.position) continue;
        const book = C.validateBook(JSON.parse(line), { mode: name });
        B.validateBook(book);
        if (book.payoutMultiplier !== row.payout || book.id !== row.id) throw new Error('Publication lookup mismatch');
        if (this.books.size >= 32) this.books.delete(this.books.keys().next().value);
        this.books.set(key, book); return book;
      }
      throw new Error('Missing published round');
    } finally { reader.close(); stream.destroy(); input.destroy(); }
  }
  async select(name) {
    const { rows, total } = this.lookup(name), choice = randomBelow(total);
    let low = 0, high = rows.length - 1;
    while (low < high) { const mid = (low + high) >>> 1; if (rows[mid].end <= choice) low = mid + 1; else high = mid; }
    return this.read(name, rows[low]);
  }
  async replay(name, id) {
    const row = this.lookup(name).rows.find(value => value.id === id);
    return row ? this.read(name, row) : null;
  }
}

class DemoRgs {
  constructor(publication) { this.publication = publication; this.sessions = new Map(); this.counter = 0; }
  config() {
    return {
      minBet: 10000, maxBet: 100000000, stepBet: 10000, defaultBetLevel: 1000000,
      betLevels: [10000, 20000, 50000, 100000, 200000, 400000, 600000, 1000000, 2000000, 4000000, 6000000, 10000000, 20000000, 50000000, 100000000],
      gameModes: C.MODES.map(mode => ({ mode: mode.name, costMultiplier: mode.cost, maxBet: 100000000 })),
      jurisdiction: { socialCasino: false, disabledAutoplay: false, disabledTurbo: false, disabledSlamStop: false, disabledSpacebar: false, disabledBuyFeature: false, disabledFullscreen: false, minimumRoundDuration: 0 },
    };
  }
  balance(session) { return { amount: session.amount, currency: 'USD' }; }
  session(id, create = false) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Object.assign(new Error('Invalid demo session'), { code: 'ERR_IS' });
    if (create && !this.sessions.has(id)) this.sessions.set(id, { amount: 1000000000, round: null, pending: null });
    const session = this.sessions.get(id);
    if (!session) throw Object.assign(new Error('Authenticate first'), { code: 'ERR_IS' });
    return session;
  }
  async call(endpoint, body) {
    const session = this.session(body.sessionID, endpoint === '/wallet/authenticate');
    if (endpoint === '/wallet/authenticate') {
      if (session.pending) await session.pending;
      return { balance: this.balance(session), config: this.config(), round: session.round };
    }
    if (endpoint === '/wallet/balance') return { balance: this.balance(session) };
    if (endpoint === '/wallet/play') {
      if (session.pending || session.round && session.round.active) throw Object.assign(new Error('Round already active'), { code: 'ERR_VAL' });
      const selected = C.mode(body.mode), config = this.config();
      C.integer(body.amount, 'bet amount', config.minBet, config.maxBet);
      if (body.amount % config.stepBet) throw new Error('Invalid bet step');
      const debit = body.amount * selected.cost;
      if (session.amount < debit) throw Object.assign(new Error('Insufficient demo balance'), { code: 'ERR_IPB' });
      session.pending = this.publication.select(selected.name).then(book => {
        session.amount -= debit;
        const payout = C.payoutAmount(body.amount, book.payoutMultiplier);
        session.round = { id: String(++this.counter), betID: String(this.counter), amount: body.amount, payout, payoutMultiplier: book.payoutMultiplier / 100, mode: selected.name, state: book.events, active: payout > 0, event: null, eventID: book.id };
        return { balance: this.balance(session), round: session.round };
      });
      try { return await session.pending; } finally { session.pending = null; }
    }
    if (endpoint === '/wallet/end-round') {
      if (session.pending) await session.pending;
      if (session.round && session.round.active) { session.amount += session.round.payout; session.round.active = false; }
      return { balance: this.balance(session) };
    }
    if (endpoint === '/bet/event') {
      if (!session.round || !session.round.active || typeof body.event !== 'string' || body.event.length > 16384) throw new Error('Invalid round checkpoint');
      session.round.event = body.event; return { event: body.event };
    }
    throw new Error('Unknown demo endpoint');
  }
}

module.exports = { Publication, DemoRgs, randomBelow };

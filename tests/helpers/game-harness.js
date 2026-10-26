const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../../math/model');
const Books = require('../../math/books');
const Contract = require('../../shared/contract');

const root = path.resolve(__dirname, '../..');
const sources = Object.fromEntries(['config', 'modes', 'contract', 'engine', 'playback', 'bonus', 'game'].map(name => [name, fs.readFileSync(path.join(root, 'frontend', 'js', name + '.js'), 'utf8')]));
const noop = () => {};
const copy = value => JSON.parse(JSON.stringify(value));
const BETS = [200000, 400000, 600000, 1000000, 2000000, 3000000, 5000000, 10000000, 20000000, 50000000, 100000000];

function predictRound(seed, options) {
  const opts = options || {}, mode = opts.mode || (opts.buy ? 'buy_' + (opts.kind || 'vault') : opts.ante ? 'ante_vault' : 'base_vault');
  const book = opts.book || Books.generateBook(M.mulberry32(seed), { mode, id: seed });
  Books.validateBook(book);
  const base = book.events[0].base, final = book.events.at(-1), wheel = book.events.find(event => event.type === 'wheel');
  const feature = book.events.find(event => event.type.endsWith('Start'));
  const kind = feature ? feature.type.slice(0, -5) : wheel ? 'cash' : Contract.mode(mode).kind;
  const amount = opts.amount || BETS[opts.betIdx == null ? 3 : opts.betIdx];
  return { book, mode, base, units: final.payoutUnits, bonusUnits: final.bonusUnits, payout: Contract.payoutAmount(amount, final.payoutUnits), cost: amount * Contract.mode(mode).cost, amount, kind, sup: !!(feature && feature.sup), wheel: wheel ? wheel.segment : null, picks: book.events.filter(event => event.type === 'vaultPick').map(event => event.choice) };
}

function findRound(predicate, options) {
  for (let seed = 1; seed < 100000; seed++) {
    const value = predictRound(seed, options);
    if (predicate(value)) return { seed, ...value };
  }
  throw new Error('Fixture outcome was not found');
}

function drawingContext() {
  return new Proxy({
    globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    measureText: text => ({ width: String(text).length * 12 }),
    getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  }, { get: (target, key) => key in target ? target[key] : noop });
}

class Element {
  constructor(id) {
    this.id = id;
    this.children = [];
    this.style = { setProperty: noop };
    this.dataset = {};
    this.hidden = true;
    this.width = 64;
    this.height = 64;
    this.offsetHeight = 100;
    this.offsetWidth = 100;
    this.listeners = {};
    this.context = drawingContext();
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => { const on = force == null ? !classes.has(name) : force; if (on) classes.add(name); else classes.delete(name); return on; },
    };
  }
  getContext() { return this.context; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  setAttribute(name, value) { this[name] = String(value); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100 }; }
  querySelector(selector) {
    if (selector === '.buyOpt.sel') return this.children.find(child => child.classList.contains('sel')) || null;
    const kind = /data-kind="([a-z]+)"/.exec(selector);
    if (kind) return this.children.find(child => child.dataset.kind === kind[1]);
    return new Element(selector);
  }
  querySelectorAll() { return this.children; }
  closest() { return this.parentElement || this; }
  click() { if (!this.disabled && this.onclick) this.onclick(); }
  focus() {}
  blur() {}
  remove() {}
}

async function createHarness(options) {
  const opts = options || {}, elements = new Map(), log = [], errors = [], timers = new Map(), frames = new Map();
  const windowListeners = new Map(), documentListeners = new Map();
  const listen = (listeners, name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const dispatch = (listeners, name, event) => { for (const fn of [...(listeners.get(name) || [])]) fn(event); };
  let now = 0, nextId = 1, seed = opts.seed || 1;
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  get('buyGrid').parentElement = get('buyScroll');
  const storage = new Map(Object.entries({ ss_balance: String(opts.storedBalance == null ? 999999 : opts.storedBalance), ss_bet: '3', ss_turbo: '1', ss_ante: opts.ante ? '1' : '0', ss_dive: opts.kind || 'vault', ...opts.storage }));
  const config = { minBet: 10000, maxBet: 100000000, stepBet: 10000, defaultBetLevel: opts.amount || BETS[opts.betIdx == null ? 3 : opts.betIdx], betLevels: opts.amount ? [...new Set([...BETS, opts.amount])].sort((a, b) => a - b) : BETS, gameModes: Object.fromEntries(Contract.MODES.map(mode => [mode.name, { costMultiplier: mode.cost, maxBet: 100000000 }])), jurisdiction: opts.jurisdiction || {}, ...opts.config };
  const server = { balance: opts.balanceMicro == null ? Math.round((opts.balance == null ? 1000 : opts.balance) * 1000000) : opts.balanceMicro, currency: opts.currency || 'USD', round: null, calls: [], settlements: [], books: (opts.books || []).slice(), faults: {}, serial: 0 };
  const wallet = () => ({ amount: server.balance, currency: server.currency });
  const wireRound = (book, amount) => ({ betID: 'test-' + ++server.serial, amount, mode: book.events[0].mode, payout: Contract.payoutAmount(amount, book.payoutMultiplier), payoutMultiplier: book.payoutMultiplier / 100, active: book.payoutMultiplier > 0, event: null, state: copy(book.events) });
  if (opts.activeRound) { server.round = wireRound(opts.activeRound.book, opts.activeRound.amount || config.defaultBetLevel); server.round.active = true; server.round.event = opts.activeRound.event == null ? null : String(opts.activeRound.event); }
  const settle = () => {
    server.balance += server.round.payout;
    server.round.active = false;
    server.settlements.push({ id: server.round.betID, payout: server.round.payout, amount: server.round.amount, mode: server.round.mode });
  };
  const fetch = async (url, init) => {
    const endpoint = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : null;
    const call = { endpoint, body, method: init.method };
    server.calls.push(call);
    const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => copy(data) });
    const run = () => {
      if (endpoint === '/wallet/authenticate') return reply({ balance: wallet(), config, round: server.round });
      if (endpoint.startsWith('/bet/replay/')) {
        const book = opts.replayBook;
        return book ? reply({ state: book.events, costMultiplier: Contract.mode(book.events[0].mode).cost, payoutMultiplier: book.payoutMultiplier / 100 }) : reply({}, 404);
      }
      if (endpoint === '/wallet/play') {
        if (server.round && server.round.active) return reply({ error: { code: 'ERR_VAL' } }, 400);
        const mode = Contract.mode(body.mode), cost = body.amount * mode.cost;
        if (cost > server.balance) return reply({ error: { code: 'ERR_IPB' } }, 400);
        const book = server.books.shift() || Books.generateBook(M.mulberry32(seed++), { mode: body.mode, id: server.serial + 1 });
        Books.validateBook(book, { mode: body.mode });
        server.balance -= cost;
        server.round = wireRound(book, body.amount);
        if (!server.round.active) settle();
        return reply({ balance: wallet(), round: server.round });
      }
      if (endpoint === '/bet/event') { server.round.event = body.event; return reply({ event: body.event }); }
      if (endpoint === '/wallet/end-round') { if (server.round.active) settle(); return reply({ balance: wallet() }); }
      throw new Error('Unknown mock endpoint');
    };
    const fault = server.faults[endpoint];
    if (fault) { delete server.faults[endpoint]; return fault({ call, run, server, reply }); }
    return run();
  };
  const canvas = (width, height) => Object.assign(new Element('canvas'), { width, height });
  const fx = {
    TAU: Math.PI * 2,
    rnd: (min, max) => min + (max - min) / 2,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    lerp: (a, b, u) => a + (b - a) * u,
    Ease: new Proxy({}, { get: () => u => u }),
    SPR: new Proxy({}, { get: () => canvas(8, 8) }),
    canvas, buildSprites: noop, sunburst: noop, dappleTile: () => canvas(8, 8),
    Particles: class { add() {} update() {} draw() {} clear() {} },
    InkWipe: class { seed() {} draw() {} },
  };
  const sound = opts.sound || new Proxy({}, { get: () => noop });
  const sea = new Proxy({ batch: (g, fn) => fn() }, { get: (target, key) => target[key] || noop });
  const timer = (fn, delay, repeat) => { const id = nextId++; timers.set(id, { fn, at: now + delay, repeat }); return id; };
  const visualMath = Object.create(Math);
  visualMath.random = () => 0.5;
  const context = vm.createContext({
    console: { log: noop, error: error => errors.push(error) },
    document: {
      getElementById: get,
      createElement: name => new Element(name),
      querySelectorAll: selector => selector === '#buyGrid .buyOpt' ? get('buyGrid').children : [],
      addEventListener: (name, fn) => listen(documentListeners, name, fn),
      fonts: { load: async () => [] },
    },
    FX: fx, SFX: sound, SeaLife: sea, Math: visualMath,
    innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1,
    location: (() => { const url = new URL(opts.location || 'https://game.example/?sessionID=test-session&rgs_url=rgs.example' + (opts.debug === false ? '' : '&debug=1')); return { href: url.href, search: url.search }; })(),
    URLSearchParams, URL, AbortController, fetch,
    performance: { now: () => now },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) },
    crypto: { getRandomValues: () => { throw new Error('Browser outcome RNG must not be called'); } },
    addEventListener: (name, fn) => listen(windowListeners, name, fn), removeEventListener: (name, fn) => windowListeners.get(name)?.delete(fn),
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: fn => { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay = 0) => timer(fn, delay, 0), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => timer(fn, delay, delay), clearInterval: id => timers.delete(id),
    Image: class { constructor() { this.width = this.height = 64; } set src(value) { this.url = value; Promise.resolve().then(() => this.onload()); } },
    DOMMatrix: class { translate() { return this; } scale() { return this; } },
  });
  context.window = context;
  for (const name of ['config', 'modes', 'contract', 'engine', 'playback']) vm.runInContext(sources[name], context, { filename: 'frontend/js/' + name + '.js' });
  const playback = context.SlotPlayback;
  context.SlotPlayback = { create(events) {
    const player = playback.create(events), observed = {};
    for (const name of Object.keys(player)) {
      if (typeof player[name] === 'function') observed[name] = (...args) => {
        const value = player[name](...args);
        log.push({ name, args, value });
        return value;
      };
      else Object.defineProperty(observed, name, { get: () => player[name] });
    }
    return observed;
  } };
  vm.runInContext(sources.bonus, context, { filename: 'frontend/js/bonus.js' });
  vm.runInContext(sources.game, context, { filename: 'frontend/js/game.js' });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const tick = async (milliseconds = 50) => {
    now += milliseconds;
    for (const [id, item] of [...timers]) {
      if (item.at > now) continue;
      if (item.repeat) item.at = now + item.repeat;
      else timers.delete(id);
      item.fn();
    }
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(now));
    await flush();
  };
  await flush();
  get('btnStart').click();
  await flush();
  const api = context.__ss;
  const drive = kind => {
    if (!api || opts.automaticBonus) return;
    if (api.st.panel && api.st.panel.resolve) api.st.panel.resolve();
    const bonus = api.bon();
    if (bonus.active()) bonus.key('Digit' + (['kraken', 'reef', 'vault', 'wheel'].indexOf(kind || 'kraken') + 1));
    bonus.tapToSpin();
    if (api.st.scene === 'vault') {
      const entry = log.findLast(item => item.name === 'vaultStart');
      if (entry) {
        const closed = entry.value.open.map((open, index) => open ? -1 : index).filter(index => index >= 0);
        const index = opts.reversePicks ? closed.at(-1) : closed[0];
        if (index >= 0) bonus.pointer('down', 370 + (index % 4 + 0.5) * 215, 222 + (Math.floor(index / 4) + 0.5) * 172);
      }
    }
    if (api.st.bw) api.st.bw.skip = true;
  };
  const until = async (predicate, kind, limit = 40000) => {
    for (let i = 0; i < limit; i++) {
      if (predicate()) return i;
      drive(kind);
      await tick();
    }
    throw new Error('Game did not settle: ' + JSON.stringify({ scene: api && api.st.scene, spinning: api && api.st.spinning, panel: api && api.st.panel && api.st.panel.type, calls: log.slice(-5).map(item => item.name), errors: errors.map(error => error.message) }));
  };
  return {
    api, context, get, log, errors, storage, server, config, tick, until, flush,
    dispatchWindow: (name, event) => dispatch(windowListeners, name, event),
    dispatchDocument: (name, event) => dispatch(documentListeners, name, event),
    setRandom(nextSeed) { seed = nextSeed; },
    async round(roundOptions) {
      const next = roundOptions || {}, start = api.st.lastRound;
      if (next.kind) api.select(next.kind);
      if (next.buy) api.buy(next.kind || 'vault');
      else api.spin();
      await until(() => !api.st.busy && api.st.lastRound !== start, next.kind);
      return api.st.lastRound;
    },
  };
}

module.exports = { createHarness, predictRound, findRound, Books, M, BETS };

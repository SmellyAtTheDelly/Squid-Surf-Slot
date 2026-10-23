(function (root) {
  'use strict';

  const MONEY_SCALE = 1000000;
  const LANGUAGES = new Set(['en', 'es', 'pt', 'fr', 'de', 'ja', 'zh', 'ko', 'ru', 'tr', 'ar', 'hi', 'id', 'it', 'pl', 'vi', 'fi', 'da']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  class EngineError extends Error {
    constructor(code, message, ambiguous = false) {
      super(message);
      this.name = 'EngineError';
      this.code = code;
      this.ambiguous = ambiguous;
    }
  }

  function fail(code, message, ambiguous = false) { throw new EngineError(code, message, ambiguous); }
  function integer(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) fail('INVALID_RESPONSE', 'Invalid ' + name + '.');
    return value;
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function currency(value) {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) fail('INVALID_CURRENCY', 'The server returned an invalid currency.');
    return value;
  }
  function identity(value) {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)) return value;
    fail('INVALID_ROUND', 'The server returned an invalid round identity.');
  }
  function product(amount, multiplier) {
    integer(amount, 'base amount', 1);
    integer(multiplier, 'mode cost', 1);
    const result = BigInt(amount) * BigInt(multiplier);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW', 'The wager exceeds supported precision.');
    return Number(result);
  }
  function loopback(host) { return ['localhost', '127.0.0.1', '[::1]'].includes(host); }

  function parseLaunch(location) {
    let page;
    try { page = new URL(typeof location === 'string' ? location : location && location.href); }
    catch (_) { fail('INVALID_LAUNCH', 'The game launch URL is invalid.'); }
    const query = page.searchParams;
    for (const key of ['sessionID', 'rgs_url', 'replay', 'game', 'version', 'mode', 'event', 'demo']) {
      if (query.getAll(key).length > 1) fail('INVALID_LAUNCH', 'The game launch has duplicate parameters.');
    }
    const raw = query.get('rgs_url'), demo = query.get('demo') === 'true', replayOnly = query.get('replay') === 'true';
    if (!raw || /[\s\\?#%@]/.test(raw)) fail('INVALID_LAUNCH', 'A valid RGS host is required to launch this game.');
    let rgs;
    try { rgs = new URL(raw.includes('://') ? raw : 'https://' + raw); }
    catch (_) { fail('INVALID_LAUNCH', 'The RGS host is invalid.'); }
    if (rgs.username || rgs.password || !rgs.hostname || rgs.pathname !== '/' || rgs.search || rgs.hash) fail('INVALID_LAUNCH', 'The RGS URL must contain only a host.');
    const localDemo = demo && loopback(page.hostname) && loopback(rgs.hostname) && page.origin === rgs.origin;
    if (rgs.protocol !== 'https:' && !(rgs.protocol === 'http:' && localDemo)) fail('INVALID_LAUNCH', 'The RGS connection requires HTTPS.');
    const language = LANGUAGES.has(query.get('lang')) ? query.get('lang') : 'en';
    const result = { endpoint: rgs.origin, sessionID: null, replayOnly, demo, localDemo, language };
    if (!replayOnly) {
      const sessionID = query.get('sessionID');
      if (!sessionID || sessionID.length > 4096 || /[\x00-\x1f\x7f]/.test(sessionID)) fail('INVALID_LAUNCH', 'A valid session ID is required to launch this game.');
      result.sessionID = sessionID;
      return result;
    }
    for (const key of ['game', 'version', 'mode', 'event']) {
      const value = query.get(key);
      if (!value || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) fail('INVALID_REPLAY', 'The replay launch is missing a valid ' + key + '.');
      result[key] = value;
    }
    const amount = query.get('amount'), parsed = amount && /^\d+$/.test(amount) ? Number(amount) : NaN;
    result.amount = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MONEY_SCALE;
    const code = query.get('currency');
    result.currency = typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : query.get('social') === 'true' ? 'XSC' : 'USD';
    return result;
  }

  function create(options = {}) {
    const contract = options.contract || root.SlotContract || (typeof module !== 'undefined' && module.exports ? require('../../shared/contract.js') : null);
    const fetcher = options.fetch || (root.fetch && root.fetch.bind(root));
    const timeoutMs = options.timeoutMs == null ? 15000 : options.timeoutMs;
    if (!contract || typeof contract.validateEvents !== 'function' || typeof fetcher !== 'function') fail('UNAVAILABLE', 'The game connection is unavailable.');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('INVALID_OPTIONS', 'The request timeout must be positive.');
    let launch, busy = false, pending = null, lastID = null;
    let data = { phase: 'idle', balance: null, currency: null, config: null, round: null, replayOnly: false, demo: false, error: null };
    let snapshot = freeze(copy(data));

    function publish(patch) {
      data = { ...data, ...patch };
      snapshot = freeze(copy(data));
      if (typeof options.onChange === 'function') {
        try { options.onChange(snapshot); } catch (_) {}
      }
      return snapshot;
    }
    function asError(error, ambiguous = false) {
      if (error instanceof EngineError) {
        if (ambiguous) error.ambiguous = true;
        return error;
      }
      return new EngineError('INVALID_RESPONSE', 'The server returned an invalid game response.', ambiguous);
    }
    async function operation(phase, callback) {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      busy = true;
      publish({ phase, error: null });
      try { return await callback(); }
      catch (error) {
        const problem = asError(error);
        publish({ phase: 'error', error: { code: problem.code, message: problem.message, ambiguous: problem.ambiguous } });
        throw problem;
      } finally { busy = false; }
    }
    async function request(path, body, wager = false) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (controller) controller.abort();
          reject(new EngineError('TIMEOUT', 'The server did not respond in time. Recover the session before continuing.', wager));
        }, timeoutMs);
      });
      const execute = async () => {
        let response;
        try {
          response = await fetcher(launch.endpoint + path, {
            method: body ? 'POST' : 'GET',
            headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
            credentials: 'omit', cache: 'no-store', redirect: 'error',
            ...(controller ? { signal: controller.signal } : {}),
          });
        } catch (_) { fail('NETWORK', 'The server connection was interrupted. Recover the session before continuing.', wager); }
        if (!response || typeof response.ok !== 'boolean') fail('INVALID_RESPONSE', 'The server response is invalid.', wager);
        let value;
        try { value = await response.json(); }
        catch (_) {
          if (!response.ok) fail('HTTP_' + response.status, response.status === 404 && !body ? 'The requested replay was not found.' : 'The server rejected the request.', wager && response.status >= 500);
          fail('INVALID_RESPONSE', 'The server returned an unreadable response.', wager);
        }
        if (!response.ok || value && value.error) {
          const source = value && (value.error || value);
          const code = source && typeof source.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(source.code) ? source.code : 'HTTP_' + response.status;
          const messages = { ERR_IPB: 'The server balance is insufficient for this wager.', ERR_IS: 'The game session has expired.', ERR_ATE: 'The game session could not be authenticated.', ERR_GLE: 'The wager exceeds the permitted game limits.', ERR_LOC: 'The game is unavailable in this location.', ERR_MAINTENANCE: 'The game server is under maintenance.', ERR_VAL: 'The server rejected the game request.' };
          fail(code, messages[code] || 'The server could not complete the request.', wager && response.status >= 500);
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RESPONSE', 'The server response is invalid.', wager);
        return value;
      };
      try { return await Promise.race([execute(), timeout]); }
      finally { clearTimeout(timer); }
    }
    function balance(value) {
      if (!value || typeof value !== 'object') fail('INVALID_RESPONSE', 'The server did not return a balance.');
      const code = currency(value.currency);
      if (data.currency && data.currency !== code) fail('CURRENCY_MISMATCH', 'The server changed the session currency.');
      return { balance: integer(value.amount, 'server balance'), currency: code };
    }
    function config(value, flags) {
      if (!value || typeof value !== 'object') fail('INVALID_CONFIG', 'The server did not return game limits.');
      const minBet = integer(value.minBet, 'minimum bet', 1), maxBet = integer(value.maxBet, 'maximum bet', 1), stepBet = integer(value.stepBet, 'bet increment', 1);
      if (minBet > maxBet || Math.ceil(minBet / stepBet) > Math.floor(maxBet / stepBet)) fail('INVALID_CONFIG', 'The server returned inconsistent game limits.');
      const gameModes = {};
      const modeMaps = [value.betModes, value.gameModes].filter(modes => modes != null).map(modes => {
        if (typeof modes !== 'object') fail('INVALID_CONFIG', 'The server returned invalid game modes.');
        if (!Array.isArray(modes)) return modes;
        const entries = Object.create(null);
        for (const entry of modes) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.mode !== 'string' || !entry.mode || own(entries, entry.mode)) fail('INVALID_CONFIG', 'The server returned invalid game modes.');
          entries[entry.mode] = entry;
        }
        return entries;
      });
      const suppliedModes = modeMaps.filter(modes => Object.keys(modes).length);
      for (const known of contract.MODES) {
        let modeMax = maxBet, available = true;
        for (const modes of suppliedModes) {
          if (!own(modes, known.name)) { available = false; continue; }
          const entry = modes[known.name];
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('INVALID_CONFIG', 'The server returned an invalid game mode.');
          if (own(entry, 'mode') && entry.mode !== known.name) fail('INVALID_CONFIG', 'The server mode name does not match this game.');
          if (own(entry, 'costMultiplier') && entry.costMultiplier !== known.cost) fail('MODE_COST_MISMATCH', 'The server mode cost does not match this game.');
          if (entry.maxBet != null) modeMax = Math.min(modeMax, integer(entry.maxBet, 'mode maximum bet', 1));
        }
        if (available) gameModes[known.name] = { costMultiplier: known.cost, maxBet: modeMax };
      }
      if (!Object.keys(gameModes).length) fail('INVALID_CONFIG', 'No supported game modes are available.');
      const validBet = amount => Number.isSafeInteger(amount) && amount >= minBet && amount <= maxBet && amount % stepBet === 0;
      const betLevels = Array.isArray(value.betLevels) ? [...new Set(value.betLevels.filter(validBet))].sort((a, b) => a - b) : [];
      const defaultBetLevel = validBet(value.defaultBetLevel) ? value.defaultBetLevel : betLevels[0] || Math.ceil(minBet / stepBet) * stepBet;
      const jurisdiction = value.jurisdiction == null ? flags == null ? {} : flags : value.jurisdiction;
      if (typeof jurisdiction !== 'object' || Array.isArray(jurisdiction)) fail('INVALID_CONFIG', 'The server jurisdiction settings are invalid.');
      return { minBet, maxBet, stepBet, defaultBetLevel, betLevels, gameModes, jurisdiction: copy(jurisdiction) };
    }
    function round(value, expected) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ROUND', 'The server did not return a round.');
      const id = identity(value.betID == null ? value.id : value.betID);
      if (value.id != null && identity(value.id) !== id) fail('ROUND_MISMATCH', 'The server returned conflicting round identities.');
      if (typeof value.active !== 'boolean') fail('INVALID_ROUND', 'The server did not return the round status.');
      const selected = contract.mode(value.mode), amount = integer(value.amount, 'round base amount', 1);
      if (expected && (selected.name !== expected.mode || amount !== expected.amount || expected.id != null && id !== expected.id)) fail('ROUND_MISMATCH', 'The server round does not match the requested wager.');
      const events = copy(contract.validateEvents(value.state, { mode: selected.name }));
      const payoutUnits = events[events.length - 1].payoutUnits;
      if (value.payoutMultiplier != null && (!Number.isFinite(value.payoutMultiplier) || Math.abs(value.payoutMultiplier * 100 - payoutUnits) > 0.000001)) fail('PAYOUT_MISMATCH', 'The server payout does not match the recorded outcome.');
      const calculated = contract.payoutAmount(amount, payoutUnits), payout = integer(value.payout, 'round payout');
      if (payout !== calculated) fail('PAYOUT_MISMATCH', 'The server payout does not match the recorded outcome.');
      let eventIndex = -1;
      if (value.event != null && value.event !== '') {
        if (typeof value.event !== 'string' || !/^(0|[1-9]\d*)$/.test(value.event)) fail('INVALID_ROUND', 'The saved round event is invalid.');
        eventIndex = Number(value.event);
        if (!Number.isSafeInteger(eventIndex) || eventIndex >= events.length) fail('INVALID_ROUND', 'The saved round event is outside the recorded outcome.');
      }
      return { id, betID: id, mode: selected.name, kind: selected.kind, amount, cost: product(amount, selected.cost), payout, payoutUnits, events, eventIndex, active: value.active };
    }
    async function authenticate(recovering) {
      const response = await request('/wallet/authenticate', { sessionID: launch.sessionID, language: launch.language });
      const wallet = balance(response.balance), limits = config(response.config, response.jurisdictionFlags);
      const raw = response.round == null ? null : response.round;
      if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) fail('INVALID_ROUND', 'The server returned an invalid current round status.');
      const returned = raw && Object.keys(raw).length ? round(raw) : null;
      const previous = data.round;
      let resumed = returned && returned.active ? returned : null;
      if (recovering && pending && pending.kind === 'play') {
        if (returned && returned.id !== pending.beforeID) {
          if (returned.mode !== pending.mode || returned.amount !== pending.amount) fail('ROUND_MISMATCH', 'The recovered round does not match the interrupted wager.');
          resumed = returned;
        } else if (returned && returned.active) fail('ROUND_MISMATCH', 'The recovered round identity is inconsistent.');
      } else if (recovering && pending && pending.kind === 'finish' && !returned) {
        resumed = null;
      } else if (recovering && previous) {
        if (!returned || returned.id !== previous.id || returned.mode !== previous.mode || returned.amount !== previous.amount) fail('ROUND_MISMATCH', 'The recovered session does not match the active round.');
        resumed = pending && pending.kind === 'finish' && !returned.active ? null : returned;
      }
      if (returned) lastID = returned.id;
      pending = null;
      publish({ ...wallet, config: limits, round: resumed, phase: resumed ? 'active' : 'ready', error: null });
      return snapshot;
    }
    async function loadReplay() {
      const selected = contract.mode(launch.mode);
      const response = await request('/bet/replay/' + [launch.game, launch.version, launch.mode, launch.event].map(encodeURIComponent).join('/'));
      if (response.costMultiplier !== selected.cost) fail('MODE_COST_MISMATCH', 'The replay cost does not match this game.');
      const events = copy(contract.validateEvents(response.state, { mode: selected.name })), payoutUnits = events[events.length - 1].payoutUnits;
      if (!Number.isFinite(response.payoutMultiplier) || Math.abs(response.payoutMultiplier * 100 - payoutUnits) > 0.000001) fail('PAYOUT_MISMATCH', 'The replay payout does not match its recorded outcome.');
      const recorded = { id: launch.event, betID: launch.event, mode: selected.name, kind: selected.kind, amount: launch.amount, cost: product(launch.amount, selected.cost), payout: contract.payoutAmount(launch.amount, payoutUnits), payoutUnits, events, eventIndex: -1, active: false };
      publish({ currency: launch.currency, balance: null, round: recorded, phase: 'replay', error: null });
      return snapshot;
    }
    async function init() {
      if (data.phase !== 'idle') fail('ALREADY_INITIALIZED', 'The session has already been initialized.');
      return operation('authenticating', async () => {
        launch = parseLaunch(options.location || root.location);
        publish({ replayOnly: launch.replayOnly, demo: launch.demo });
        return launch.replayOnly ? loadReplay() : authenticate(false);
      });
    }
    async function start(mode, amount) {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      if (data.replayOnly) fail('REPLAY_ONLY', 'A replay cannot place wagers.');
      if (data.phase !== 'ready' || data.round) fail('NOT_READY', 'Recover or complete the current round before placing another wager.');
      const selected = contract.mode(mode), limits = data.config, entry = limits.gameModes[mode];
      if (!entry) fail('MODE_UNAVAILABLE', 'This mode is unavailable in the current session.');
      if (!Number.isSafeInteger(amount) || amount < limits.minBet || amount > entry.maxBet || amount % limits.stepBet !== 0) fail('INVALID_BET', 'The wager does not meet the server bet limits.');
      if (selected.buy && limits.jurisdiction.disabledBuyFeature) fail('MODE_UNAVAILABLE', 'Feature purchases are unavailable in this jurisdiction.');
      const cost = product(amount, selected.cost);
      if (cost > data.balance) fail('INSUFFICIENT_BALANCE', 'The server balance is insufficient for this wager.');
      return operation('playing', async () => {
        pending = { kind: 'play', mode, amount, beforeID: lastID };
        try {
          const response = await request('/wallet/play', { sessionID: launch.sessionID, mode, amount }, true);
          const wallet = balance(response.balance), result = round(response.round, { mode, amount });
          if (result.id === lastID) fail('ROUND_MISMATCH', 'The server reused a completed round identity.');
          lastID = result.id;
          pending = null;
          publish({ ...wallet, round: result, phase: 'active', error: null });
          return snapshot.round;
        } catch (error) { throw asError(error, !(error instanceof EngineError) || error.ambiguous || !/^ERR_|^HTTP_4/.test(error.code)); }
      });
    }
    async function checkpoint(eventIndex) {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      if (!data.round || !['active', 'replay'].includes(data.phase)) fail('NOT_READY', 'There is no round ready to checkpoint.');
      if (!Number.isSafeInteger(eventIndex) || eventIndex < 0 || eventIndex >= data.round.events.length) fail('INVALID_EVENT', 'The round event is invalid.');
      if (eventIndex <= data.round.eventIndex) return snapshot.round;
      if (data.replayOnly || !data.round.active) {
        publish({ round: { ...data.round, eventIndex } });
        return snapshot.round;
      }
      return operation('active', async () => {
        const response = await request('/bet/event', { sessionID: launch.sessionID, event: String(eventIndex) });
        if (response.event !== String(eventIndex)) fail('EVENT_MISMATCH', 'The server did not confirm the recorded round event.');
        publish({ round: { ...data.round, eventIndex }, phase: 'active', error: null });
        return snapshot.round;
      });
    }
    async function finish() {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      if (data.replayOnly) {
        if (data.phase !== 'replay' || !data.round) fail('NOT_READY', 'The replay is unavailable.');
        return publish({ round: { ...data.round, eventIndex: data.round.events.length - 1 }, phase: 'replay' });
      }
      if (data.phase === 'ready' && !data.round) return snapshot;
      if (data.phase !== 'active' || !data.round) fail('NOT_READY', 'Recover the session before completing the round.');
      if (!data.round.active) return publish({ round: null, phase: 'ready', error: null });
      return operation('settling', async () => {
        pending = { kind: 'finish', id: data.round.id };
        try {
          const response = await request('/wallet/end-round', { sessionID: launch.sessionID }, true), wallet = balance(response.balance);
          if (response.round && identity(response.round.betID == null ? response.round.id : response.round.betID) !== data.round.id) fail('ROUND_MISMATCH', 'The server settled a different round.');
          pending = null;
          publish({ ...wallet, round: null, phase: 'ready', error: null });
          return snapshot;
        } catch (error) { throw asError(error, true); }
      });
    }
    async function recover() {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      if (!launch) fail('INVALID_LAUNCH', 'Reopen the game with a valid session launch URL.');
      if (launch.replayOnly) return operation('recovering', loadReplay);
      return operation('recovering', () => authenticate(true));
    }
    async function replay() {
      if (busy) fail('BUSY', 'A game request is already in progress.');
      if (!data.replayOnly || data.phase !== 'replay' || !data.round) fail('REPLAY_ONLY', 'No recorded replay is available.');
      publish({ round: { ...data.round, eventIndex: -1 }, error: null });
      return snapshot.round;
    }

    return Object.freeze({ init, start, checkpoint, finish, recover, replay, get state() { return snapshot; } });
  }

  const api = Object.freeze({ create, parseLaunch, EngineError, MONEY_SCALE });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineSession = api;
})(typeof window !== 'undefined' ? window : globalThis);

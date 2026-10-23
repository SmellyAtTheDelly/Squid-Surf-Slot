(function (root) {
  'use strict';
  const SCHEMA = 2, UNIT_SCALE = 100, MONEY_SCALE = 1000000, MAX_UNITS = 500000;
  const { MODES } = typeof module !== 'undefined' && module.exports ? require('./modes') : root.SlotModes;
  const TYPES = new Set(['round', 'wheel', 'krakenStart', 'krakenStep', 'reefStart', 'reefRespin', 'vaultStart', 'vaultPick', 'final']);
  function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + name);
    return value;
  }
  function mode(name) {
    const result = MODES.find(value => value.name === name);
    if (!result) throw new RangeError('Unknown game mode');
    return result;
  }
  function payoutAmount(amount, units) {
    integer(amount, 'base amount', 0);
    integer(units, 'payout units', 0, MAX_UNITS);
    const result = BigInt(amount) * BigInt(units) / 100n;
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Payout exceeds supported precision');
    return Number(result);
  }
  function grid(value, name, max = 8) {
    if (!Array.isArray(value) || value.length !== 5) throw new Error('Invalid ' + name);
    for (const reel of value) {
      if (!Array.isArray(reel) || reel.length !== 3) throw new Error('Invalid ' + name);
      for (const cell of reel) integer(cell, name, 0, max);
    }
    if (max === 8 && (value[0].includes(7) || value.some(reel => reel.filter(cell => cell === 8).length > 1))) throw new Error('Invalid symbol board');
  }
  function boolean(value, name) {
    if (typeof value !== 'boolean') throw new Error('Invalid ' + name);
  }
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
  }
  function cells(value, name, width = 2, firstReel = 0) {
    if (!Array.isArray(value) || value.length > 15) throw new Error('Invalid ' + name);
    const seen = new Set();
    for (const cell of value) {
      if (!Array.isArray(cell) || cell.length !== width) throw new Error('Invalid ' + name);
      integer(cell[0], 'reel', firstReel, 4); integer(cell[1], 'row', 0, 2);
      if (width === 3) integer(cell[2], 'wild multiplier', 1, 60);
      const position = cell[0] * 3 + cell[1];
      if (seen.has(position)) throw new Error('Duplicate ' + name);
      seen.add(position);
    }
  }
  function evaluation(value, board) {
    if (!value || !Array.isArray(value.wins) || value.wins.length > 7) throw new Error('Invalid evaluation');
    cells(value.scatterCells, 'scatter cells');
    integer(value.totalUnits, 'evaluated payout', 0);
    integer(value.scatterUnits, 'scatter payout', 0);
    integer(value.scatterCount, 'scatter count', 0, 5);
    if (value.scatterCells.length !== value.scatterCount || board.flat().filter(symbol => symbol === 8).length !== value.scatterCount || value.scatterCells.some(([r, y]) => board[r][y] !== 8)) throw new Error('Inconsistent scatter positions');
    let total = value.scatterUnits;
    const symbols = new Set();
    for (const win of value.wins) {
      if (!win || typeof win !== 'object') throw new Error('Invalid winning way');
      integer(win.sym, 'winning symbol', 0, 6);
      if (symbols.has(win.sym)) throw new Error('Duplicate winning symbol');
      symbols.add(win.sym);
      integer(win.units, 'symbol payout', 0);
      integer(win.len, 'winning reels', 3, 5);
      integer(win.ways, 'winning ways', 1, 243);
      if (!Number.isFinite(win.mult) || win.mult < 1 || win.amount !== win.units / 100) throw new Error('Invalid winning way');
      cells(win.cells, 'winning cells');
      if (!win.cells.length || win.cells.some(([r, y]) => r >= win.len || board[r][y] !== win.sym && board[r][y] !== 7)) throw new Error('Inconsistent winning cells');
      total += win.units;
    }
    if (total !== value.totalUnits || value.total !== total / 100 || value.scatterPay !== value.scatterUnits / 100) throw new Error('Inconsistent evaluation');
  }
  function krakenState(state) {
    if (!state || typeof state !== 'object') throw new Error('Invalid Kraken state');
    grid(state.sticky, 'sticky wilds', 60);
    if (state.sticky[0].some(Boolean)) throw new Error('Invalid first-reel sticky wild');
    integer(state.rage, 'rage counter', 0, 2); integer(state.played, 'played free spins', 0, 60);
    integer(state.left, 'remaining free spins', 0, 60 - state.played); integer(state.totalUnits, 'free spin total', 0, MAX_UNITS);
    if (state.preset !== undefined) cells([state.preset], 'sticky preset', 3, 1);
  }
  function reefState(state) {
    if (!state || !Array.isArray(state.cells) || state.cells.length !== 15) throw new Error('Invalid pearl board');
    boolean(state.grand, 'full pearl board'); integer(state.respins, 'remaining respins', 0, 3);
    if (!Number.isFinite(state.lvl) || state.lvl <= 0) throw new Error('Invalid pearl level');
    let sum = state.grand ? 1000 : 0;
    for (const cell of state.cells) {
      if (cell === null) continue;
      if (!cell || !['cash', 'gold', 'mini', 'minor', 'major'].includes(cell.kind) || !Number.isFinite(cell.v) || cell.v < 0 || !Number.isSafeInteger(cell.v * 100)) throw new Error('Invalid pearl value');
      if (cell.kind === 'gold' && cell.v !== 0) throw new Error('Invalid gold pearl');
      sum += cell.v;
    }
    if (state.grand !== state.cells.every(Boolean) || state.grand && state.respins !== 0) throw new Error('Inconsistent full pearl board');
    const units = sum * 100;
    if (!Number.isSafeInteger(units)) throw new Error('Pearl total exceeds supported precision');
    return units;
  }
  function chest(value) {
    if (!value || !['coin', 'mult', 'life', 'kraken'].includes(value.kind)) throw new Error('Invalid chest');
    if (value.kind === 'coin') integer(value.v, 'chest coins', 1);
    if (value.kind === 'mult') integer(value.v, 'chest multiplier', 1, 2);
  }
  function vaultState(state) {
    if (!state || !Array.isArray(state.chests) || state.chests.length !== 12 || !Array.isArray(state.open) || state.open.length !== 12) throw new Error('Invalid chest board');
    for (const value of state.chests) chest(value);
    for (const open of state.open) boolean(open, 'open chest');
    boolean(state.over, 'Vault completion'); integer(state.lives, 'Vault lives', 0, 5); integer(state.picks, 'Vault picks', 0, 12);
    integer(state.coins, 'vault coins', 0); integer(state.mult, 'vault multiplier', 1, 8);
    if (state.open.filter(Boolean).length !== state.picks || state.over !== (state.lives === 0 || !state.chests.some((value, i) => !state.open[i] && value.kind !== 'kraken'))) throw new Error('Inconsistent Vault completion');
    const units = state.coins * state.mult * 100;
    if (!Number.isSafeInteger(units)) throw new Error('Vault total exceeds supported precision');
    return units;
  }
  function validateEvents(events, options = {}) {
    if (!Array.isArray(events) || events.length < 2 || events.length > 1000) throw new Error('Invalid round events');
    const first = events[0], last = events[events.length - 1];
    if (!first || first.type !== 'round' || first.schema !== SCHEMA || !last || last.type !== 'final') throw new Error('Unsupported round schema');
    const selected = mode(first.mode);
    if (first.kind !== selected.kind || options.mode && first.mode !== options.mode) throw new Error('Round mode mismatch');
    if (!first.base) throw new Error('Missing base outcome');
    grid(first.base.landed, 'base reveal'); grid(first.base.grid, 'base result'); evaluation(first.base.ev, first.base.grid);
    if (first.base.attack !== null) cells(first.base.attack, 'attack cells', 2, 1);
    integer(first.base.fsAward, 'free spin award', 0, 60);
    integer(first.base.triggerCount, 'squid trigger count', 0, 12);
    cells(first.base.triggerCells, 'squid trigger cells', 2, 1);
    const triggerCells = [];
    for (let r = 1; r < 5; r++) for (let y = 0; y < 3; y++) if (first.base.grid[r][y] === 7) triggerCells.push([r, y]);
    if (triggerCells.length !== first.base.triggerCount || !same(first.base.triggerCells, triggerCells)) throw new Error('Inconsistent squid trigger positions');
    const triggerLevel = Math.min(5, first.base.triggerCount), wildSpin = selected.name === 'buy_wilds', cap = selected.maxWinUnits;
    if (first.base.fsAward !== (wildSpin ? 0 : ({ 3: 8, 4: 10, 5: 13 }[triggerLevel] || 0))) throw new Error('Inconsistent feature trigger');
    if (wildSpin && (first.base.triggerCount !== 6 || first.base.attack !== null || !same(first.base.grid, first.base.landed))) throw new Error('Invalid guaranteed wild spin');
    if (selected.buy && !wildSpin && (first.base.triggerCount < 3 || first.base.triggerCount > 5 || first.base.attack !== null || !same(first.base.grid, first.base.landed))) throw new Error('Invalid purchased feature trigger');
    let feature = selected.kind, phase = 'base', total = Math.min(cap, first.base.ev.totalUnits), featureUnits = 0, wheel = false, state = null, sup = false;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event || event.index !== i || !TYPES.has(event.type)) throw new Error('Invalid event sequence');
      if (i > 0 && event.type === 'round' || i < events.length - 1 && event.type === 'final') throw new Error('Duplicate round boundary');
      if (event.type === 'round' || event.type === 'final') continue;
      if (!first.base.fsAward) throw new Error('Feature without trigger');
      if (event.type === 'wheel') {
        if (phase !== 'base' || feature !== 'wheel' || wheel) throw new Error('Unexpected wheel result');
        integer(event.segment, 'wheel segment', 0, 7);
        const outcomes = ['kraken', 'cash', 'reef', 'vault', 'kraken', 'reef', 'cash', 'vault'];
        feature = outcomes[event.segment]; wheel = true;
        sup = [2, 4, 7].includes(event.segment);
        if (!event.result || event.result.kind !== feature || !!event.result.sup !== sup) throw new Error('Inconsistent Wheel feature');
        if (feature === 'cash' && event.result.v !== (event.segment === 1 ? 25 : 40)) throw new Error('Inconsistent Wheel cash');
        if (feature === 'cash') { featureUnits = event.segment === 1 ? 2500 : 4000; phase = 'cash'; }
      } else if (event.type.endsWith('Start')) {
        if (phase !== 'base' || feature === 'wheel' || event.type !== feature + 'Start' || !event.state) throw new Error('Unexpected feature start');
        integer(event.pearls, 'feature level', 3, 5);
        if (event.pearls !== triggerLevel) throw new Error('Feature trigger mismatch');
        boolean(event.sup, 'super feature');
        if (event.sup !== sup) throw new Error('Super feature mismatch');
        phase = feature;
        if (phase === 'kraken') {
          krakenState(event.state);
          if (!event.state.left || event.state.played || event.state.totalUnits || event.state.rage) throw new Error('Invalid initial Kraken counters');
        }
        if (phase === 'reef') {
          if (event.state.respins !== 3 || event.state.grand) throw new Error('Invalid initial Reef counters');
          const positions = new Set(first.base.triggerCells.slice(0, triggerLevel).map(([r, y]) => y * 5 + r));
          if (!event.sup && (!Array.isArray(event.state.cells) || event.state.cells.some((cell, index) => !!cell !== positions.has(index)))) throw new Error('Invalid initial Reef positions');
        }
        if (phase === 'vault' && (event.state.picks || event.state.coins || event.state.over || !event.state.lives)) throw new Error('Invalid initial Vault counters');
      } else {
        const expected = { kraken: 'krakenStep', reef: 'reefRespin', vault: 'vaultPick' }[phase];
        if (event.type !== expected || !event.state || !event.result) throw new Error('Unexpected feature step');
        if (phase === 'kraken') {
          if (!state.left || total + featureUnits >= MAX_UNITS) throw new Error('Free spin after completion');
          krakenState(event.state);
          grid(event.result.landed, 'free spin reveal'); grid(event.result.grid, 'free spin result'); grid(event.result.mults, 'wild multipliers', 60); evaluation(event.result.ev, event.result.grid);
          cells(event.result.newWilds, 'new wilds', 3, 1);
          integer(event.result.awaken, 'rage awakenings', 0, 4); integer(event.result.extra, 'rage spin award', 0, 60);
          integer(event.result.retrigger, 'retrigger spin award', 0, 60); integer(event.result.extraAdded, 'added rage spins', 0, event.result.extra);
          integer(event.result.retriggerAdded, 'added retrigger spins', 0, event.result.retrigger); boolean(event.result.capped, 'free spin cap');
          integer(event.result.paidUnits, 'free spin payment', 0, MAX_UNITS);
          if (event.result.paidUnits !== Math.min(event.result.ev.totalUnits, MAX_UNITS - total - featureUnits)) throw new Error('Invalid accepted free spin payout');
          if (!same(event.state.sticky, event.result.mults) || event.result.grid.some((reel, r) => reel.some((symbol, y) => (symbol === 7) !== !!event.result.mults[r][y]))) throw new Error('Inconsistent sticky multipliers');
          featureUnits += event.result.paidUnits;
          if (event.state.totalUnits !== featureUnits) throw new Error('Inconsistent free spin total');
          const capped = total + featureUnits === MAX_UNITS;
          if (event.result.capped !== capped || event.state.played !== state.played + 1 || event.state.left !== (capped ? 0 : state.left - 1 + event.result.extraAdded + event.result.retriggerAdded)) throw new Error('Inconsistent free spin counters');
        }
        if (phase === 'reef') {
          if (!state.respins) throw new Error('Respin after completion');
          if (!Array.isArray(event.result.landed) || new Set(event.result.landed).size !== event.result.landed.length) throw new Error('Invalid new pearl positions');
          for (const position of event.result.landed) {
            integer(position, 'new pearl position', 0, 14);
            if (state.cells[position] || !event.state.cells || !event.state.cells[position]) throw new Error('Invalid new pearl');
          }
          integer(event.result.gold, 'gold pearl count', 0, event.result.landed.length); boolean(event.result.full, 'full pearl result');
          if (event.result.full !== event.state.grand || event.state.respins !== (event.result.full ? 0 : event.result.landed.length ? 3 : state.respins - 1)) throw new Error('Inconsistent respin counters');
        }
        if (phase === 'vault') {
          integer(event.choice, 'recorded chest', 0, 11); chest(event.result);
          if (state.over || state.open[event.choice] || event.choice !== state.picks || !event.state.open || !event.state.open[event.choice]) throw new Error('Invalid recorded chest sequence');
          if (!same(state.chests, event.state.chests) || !same(event.result, state.chests[event.choice]) || event.state.picks !== state.picks + 1) throw new Error('Inconsistent chest reveal');
          if (event.state.coins !== state.coins + (event.result.kind === 'coin' ? event.result.v : 0) || event.state.mult !== state.mult + (event.result.kind === 'mult' ? event.result.v : 0) || event.state.lives !== state.lives + (event.result.kind === 'life' ? 1 : event.result.kind === 'kraken' ? -1 : 0)) throw new Error('Inconsistent Vault counters');
        }
      }
      if (phase === 'reef') {
        featureUnits = reefState(event.state);
      }
      if (phase === 'vault') {
        featureUnits = vaultState(event.state);
      }
      if (phase !== 'cash') state = event.state;
    }
    if (first.base.fsAward && phase === 'base') throw new Error('Missing triggered feature');
    if (phase === 'kraken' && state.left || phase === 'reef' && state.respins || phase === 'vault' && !state.over) throw new Error('Unfinished recorded feature');
    total = Math.min(cap, total + featureUnits);
    integer(last.payoutUnits, 'final payout', 0, cap);
    if (last.payoutUnits !== total || options.payoutMultiplier != null && options.payoutMultiplier !== total) throw new Error('Final payout mismatch');
    if (last.baseUnits !== Math.min(cap, first.base.ev.totalUnits) || last.bonusUnits !== total - last.baseUnits || last.capped !== (total === cap)) throw new Error('Final award breakdown mismatch');
    return events;
  }
  function validateBook(book, options = {}) {
    if (!book || !Number.isSafeInteger(book.id) || book.id < 0) throw new Error('Invalid book identity');
    integer(book.payoutMultiplier, 'book payout', 0, MAX_UNITS);
    validateEvents(book.events, { ...options, payoutMultiplier: book.payoutMultiplier });
    return book;
  }
  const api = Object.freeze({ SCHEMA, UNIT_SCALE, MONEY_SCALE, MAX_UNITS, MODES, mode, integer, payoutAmount, validateEvents, validateBook });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlotContract = api;
})(typeof window !== 'undefined' ? window : globalThis);

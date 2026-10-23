(function (root) {
  'use strict';

  const copy = value => JSON.parse(JSON.stringify(value));

  function create(events) {
    if (!Array.isArray(events) || events.length < 2 || events[0].type !== 'round' || events.at(-1).type !== 'final') throw new Error('Invalid recorded round');
    const book = copy(events);
    const first = book[0], final = book.at(-1);
    let cursor = 0, baseRead = false;
    const replace = (state, next) => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, copy(next));
      return state;
    };
    const take = type => {
      const event = book[cursor];
      if (!event || event.type !== type || event.index !== cursor) throw new Error('Recorded event order mismatch: ' + type);
      cursor++;
      return copy(event);
    };
    const start = (type, pearls, sup) => {
      const event = take(type);
      if (event.pearls != null && event.pearls !== pearls || event.sup != null && !!event.sup !== !!sup) throw new Error('Recorded feature does not match the selected round');
      return event.state;
    };
    return Object.freeze({
      get eventIndex() { return cursor - 1; },
      get kind() { return first.kind; },
      get mode() { return first.mode; },
      get payoutUnits() { return final.payoutUnits; },
      get baseUnits() { return final.baseUnits; },
      get bonusUnits() { return final.bonusUnits; },
      get capped() { return !!final.capped; },
      baseSpin() {
        if (baseRead) throw new Error('Recorded base outcome was already consumed');
        baseRead = true;
        return take('round').base;
      },
      krakenStart(pearls, sup) { return start('krakenStart', pearls, sup); },
      krakenStep(state) {
        if (!state.left) return null;
        const event = take('krakenStep');
        replace(state, event.state);
        return event.result;
      },
      reefStart(pearls, sup) { return start('reefStart', pearls, sup); },
      reefRespin(state) {
        const event = take('reefRespin');
        replace(state, event.state);
        return event.result;
      },
      vaultStart(pearls, sup) { return start('vaultStart', pearls, sup); },
      vaultPick(state, index) {
        if (!Number.isInteger(index) || index < 0 || index >= state.open.length || state.open[index] || state.over) throw new Error('Invalid recorded chest selection');
        const event = take('vaultPick');
        const open = state.open.slice(), chests = state.chests.slice();
        open[index] = true;
        chests[index] = copy(event.result);
        const recorded = event.state;
        if (recorded.over) {
          const remaining = recorded.chests.filter((item, i) => !recorded.open[i]);
          let next = 0;
          for (let i = 0; i < open.length; i++) if (!open[i]) chests[i] = copy(remaining[next++]);
          if (next !== remaining.length) throw new Error('Recorded chest remainder mismatch');
        }
        replace(state, recorded);
        state.open = open;
        state.chests = chests;
        return copy(event.result);
      },
      wheelSpin() { return take('wheel').segment; },
      vaultTotal(state) { return state.coins * state.mult; },
      finish() {
        const event = take('final');
        if (cursor !== book.length) throw new Error('Unconsumed recorded events');
        return event;
      },
    });
  }

  const api = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlotPlayback = api;
})(typeof window !== 'undefined' ? window : globalThis);

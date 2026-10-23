(function (root) {
  'use strict';
  const KINDS = Object.freeze(['kraken', 'reef', 'vault', 'wheel']);
  const MODES = Object.freeze([
    ['base_vault', 1, 'vault', false, false, 500000],
    ['ante_vault', 2, 'vault', true, false, 500000],
    ['buy_vault', 100, 'vault', false, true, 500000],
    ['buy_reef', 250, 'reef', false, true, 500000],
    ['buy_kraken', 500, 'kraken', false, true, 500000],
    ['buy_wheel', 185, 'wheel', false, true, 500000],
    ['buy_wilds', 50, 'wilds', false, true, 157950],
  ].map(([name, cost, kind, ante, buy, maxWinUnits]) => Object.freeze({ name, cost, kind, ante, buy, maxWinUnits })));
  const api = Object.freeze({ KINDS, MODES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlotModes = api;
})(typeof window !== 'undefined' ? window : globalThis);

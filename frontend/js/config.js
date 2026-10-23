(function (root) {
  'use strict';
  const value = {
  "S": {
    "J": 0,
    "Q": 1,
    "K": 2,
    "A": 3,
    "SILVER": 4,
    "GOLD": 5,
    "ANCHOR": 6,
    "WILD": 7,
    "SCATTER": 8
  },
  "REELS": 5,
  "ROWS": 3,
  "NAMES": [
    "J",
    "Q",
    "K",
    "A",
    "SILVER",
    "GOLD",
    "ANCHOR",
    "WILD",
    "SCATTER"
  ],
  "LABELS": [
    "J",
    "Q",
    "K",
    "A",
    "Silver Coin",
    "Gold Coin",
    "Anchor",
    "Squid Chest",
    "Pearl"
  ],
  "PAYS": [
    [
      0.06,
      0.2,
      0.6
    ],
    [
      0.07,
      0.25,
      0.8
    ],
    [
      0.12,
      0.35,
      1
    ],
    [
      0.14,
      0.4,
      1.3
    ],
    [
      0.25,
      0.8,
      2.6
    ],
    [
      0.4,
      1.3,
      4
    ],
    [
      0.65,
      2,
      6.5
    ]
  ],
  "UNIT_SCALE": 100,
  "ANTE_COST": 2,
  "BIG_WIN": 15,
  "MEGA_WIN": 40,
  "EPIC_WIN": 100,
  "FS_MAX_SPINS": 60,
  "FS_AWARD": {
    "3": 8,
    "4": 10,
    "5": 13
  },
  "FS_RETRIGGER": 5,
  "SCATTER_PAY": {
    "3": 2,
    "4": 10,
    "5": 50
  },
  "MAX_WIN": 5000,
  "RAGE_MAX": 3,
  "RAGE_SPINS": 2,
  "BONUS_KINDS": [
    "kraken",
    "reef",
    "vault",
    "wheel"
  ],
  "PROFILE_VERSION": "squid-engine-3",
  "PRIZES": {
    "MINI": 20,
    "MINOR": 50,
    "MAJOR": 150,
    "GRAND": 1000
  },
  "JACKPOT": {
    "MINI": 20,
    "MINOR": 50,
    "MAJOR": 150,
    "GRAND": 1000
  },
  "TUNE": {
    "rageMax": 3,
    "rageSpins": 2,
    "krakenSpins": {
      "3": 8,
      "4": 10,
      "5": 13
    },
    "reefLevel": {
      "3": 1,
      "4": 3,
      "5": 7.5
    },
    "reefSuper": 3,
    "superSpins": 0,
    "superPreset": 2
  },
  "WHEEL": [
    {
      "kind": "kraken"
    },
    {
      "kind": "cash",
      "v": 25
    },
    {
      "kind": "reef",
      "sup": true
    },
    {
      "kind": "vault"
    },
    {
      "kind": "kraken",
      "sup": true
    },
    {
      "kind": "reef"
    },
    {
      "kind": "cash",
      "v": 40
    },
    {
      "kind": "vault",
      "sup": true
    }
  ],
  "REEF_CASH_VALUES": [
    1,
    2,
    3,
    4,
    5,
    8,
    10,
    15
  ],
  "VAULT_COIN_VALUES": [
    3,
    5,
    8,
    10,
    15,
    20,
    30,
    50,
    100,
    250
  ],
  "MODES": [
    {
      "name": "base_vault",
      "cost": 1,
      "kind": "vault",
      "ante": false,
      "buy": false,
      "maxWinUnits": 500000
    },
    {
      "name": "ante_vault",
      "cost": 2,
      "kind": "vault",
      "ante": true,
      "buy": false,
      "maxWinUnits": 500000
    },
    {
      "name": "buy_vault",
      "cost": 100,
      "kind": "vault",
      "ante": false,
      "buy": true,
      "maxWinUnits": 500000
    },
    {
      "name": "buy_reef",
      "cost": 250,
      "kind": "reef",
      "ante": false,
      "buy": true,
      "maxWinUnits": 500000
    },
    {
      "name": "buy_kraken",
      "cost": 500,
      "kind": "kraken",
      "ante": false,
      "buy": true,
      "maxWinUnits": 500000
    },
    {
      "name": "buy_wheel",
      "cost": 185,
      "kind": "wheel",
      "ante": false,
      "buy": true,
      "maxWinUnits": 500000
    },
    {
      "name": "buy_wilds",
      "cost": 50,
      "kind": "wilds",
      "ante": false,
      "buy": true,
      "maxWinUnits": 157950
    }
  ],
  "RTP": 96.3
};
  function freeze(data) { if (data && typeof data === 'object') { Object.values(data).forEach(freeze); Object.freeze(data); } return data; }
  if (typeof module !== 'undefined' && module.exports) module.exports = freeze(value);
  else root.SlotConfig = freeze(value);
})(typeof window !== 'undefined' ? window : globalThis);

const { MODES } = require('../../shared/modes');
const original = require('./stake-auth-config.json');
module.exports = { ...original, gameModes: MODES.map(mode => ({ mode: mode.name, costMultiplier: mode.cost, maxBet: original.maxBet })) };

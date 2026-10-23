'use strict';

const fs = require('node:fs');
const path = require('node:path');
const M = require('../math/model.js');
const C = require('../shared/contract.js');
const root = path.resolve(__dirname, '..');
const front = path.join(root, 'frontend');
const output = path.join(root, 'dist/frontend');

function publicConfig() {
  const keys = ['S', 'REELS', 'ROWS', 'NAMES', 'LABELS', 'PAYS', 'UNIT_SCALE', 'ANTE_COST', 'BIG_WIN', 'MEGA_WIN', 'EPIC_WIN', 'FS_MAX_SPINS', 'FS_AWARD', 'FS_RETRIGGER', 'SCATTER_PAY', 'MAX_WIN', 'RAGE_MAX', 'RAGE_SPINS', 'BONUS_KINDS'];
  const data = Object.fromEntries(keys.map(key => [key, M[key]]));
  data.PROFILE_VERSION = 'squid-engine-3';
  data.PRIZES = M.JACKPOT;
  data.JACKPOT = M.JACKPOT;
  data.TUNE = Object.fromEntries(['rageMax', 'rageSpins', 'krakenSpins', 'reefLevel', 'reefSuper', 'superSpins', 'superPreset'].map(key => [key, M.TUNE[key]]));
  data.WHEEL = M.WHEEL.map(({ w, ...segment }) => segment);
  data.REEF_CASH_VALUES = M.REEF_VALUES.map(([value]) => value).filter(value => typeof value === 'number');
  data.VAULT_COIN_VALUES = M.VAULT_COIN.map(([value]) => Math.round(value * M.TUNE.vaultCoin));
  data.MODES = C.MODES;
  data.RTP = 96.3;
  return data;
}

function writeConfig() {
  const data = JSON.stringify(publicConfig(), null, 2);
  fs.writeFileSync(path.join(front, 'js/config.js'), "(function (root) {\n  'use strict';\n  const value = " + data + ";\n  function freeze(data) { if (data && typeof data === 'object') { Object.values(data).forEach(freeze); Object.freeze(data); } return data; }\n  if (typeof module !== 'undefined' && module.exports) module.exports = freeze(value);\n  else root.SlotConfig = freeze(value);\n})(typeof window !== 'undefined' ? window : globalThis);\n");
  fs.copyFileSync(path.join(root, 'shared/contract.js'), path.join(front, 'js/contract.js'));
  fs.copyFileSync(path.join(root, 'shared/modes.js'), path.join(front, 'js/modes.js'));
}

function build() {
  writeConfig();
  if (fs.existsSync(output)) {
    const resolved = fs.realpathSync(output);
    if (resolved !== output || !resolved.startsWith(root + path.sep)) throw new Error('Unsafe build output');
    fs.rmSync(output, { recursive: true });
  }
  fs.cpSync(front, output, { recursive: true, filter: source => !source.endsWith('math-report.js') });
  const index = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const name = match[1];
    if (name.startsWith('#') || name.startsWith('data:')) continue;
    if (/^(https?:)?\/\//.test(name) || name.startsWith('/')) throw new Error('Non-local asset: ' + name);
    if (!fs.existsSync(path.join(output, name.split('?')[0]))) throw new Error('Missing built asset: ' + name);
  }
  const source = fs.readFileSync(path.join(output, 'js/game.js'), 'utf8');
  if (/M\.(cryptoRand|baseSpin|createRound|awardRound|closeRound)\b/.test(source)) throw new Error('Production frontend still generates or settles outcomes');
  if (fs.existsSync(path.join(output, 'js/math.js'))) throw new Error('Math engine must not be bundled');
  console.log('Frontend built at ' + output);
  return output;
}

if (require.main === module) {
  if (process.argv.includes('--config')) writeConfig();
  else build();
}
module.exports = { publicConfig, writeConfig, build };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const C = require('../shared/modes');
const E = require('../math/export');

const root = path.join(__dirname, '..');
const file = path.join(root, 'dist/math/manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
if (manifest.version !== E.VERSION || !manifest.production || manifest.modes.length !== C.MODES.length) throw new Error('Generate the current production publication first');
const results = C.MODES.map(config => {
  const item = manifest.modes.find(mode => mode.name === config.name);
  if (!item || item.cost !== config.cost || item.maxWinUnits !== config.maxWinUnits || item.statistics.rtpNumerator !== '963' || item.statistics.rtpDenominator !== '1000') throw new Error('Publication mode mismatch: ' + config.name);
  return { name: config.name, cost: config.cost, maximumXBaseBet: config.maxWinUnits / 100, rounds: item.rounds, statistics: item.statistics, features: item.features };
});
const report = {
  version: manifest.version,
  source: 'dist/math/manifest.json',
  method: 'Exact finite weighted publication statistics; run math:verify to independently validate every book and source hash',
  targetRtp: manifest.targetRtp,
  totalBooks: results.reduce((sum, mode) => sum + mode.rounds, 0),
  results,
};
fs.writeFileSync(path.join(root, 'reports/current-math-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Publication statistics for ' + report.totalBooks.toLocaleString('en-US') + ' books across ' + results.length + ' modes');

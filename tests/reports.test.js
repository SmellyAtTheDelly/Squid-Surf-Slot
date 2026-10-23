const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const M = require('../reports/legacy-sources/js/math.js');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'reports', name), 'utf8').replace(/^\uFEFF/, ''));
const hash = name => createHash('sha256').update(fs.readFileSync(path.join(root, 'reports/legacy-sources/' + name))).digest('hex');
const primary = ['base', 'ante', 'buy'].map(mode => read('rtp-' + mode + '.json'));

for (const mode of ['base', 'ante', 'buy']) {
  test(mode + ' historical simulation matches its archived source and reconciles its turnover', () => {
    const report = primary.find(value => value.config.modes[0] === mode);
    assert.equal(report.profile, M.PROFILE_VERSION);
    for (const [file, expected] of Object.entries(report.sourceSha256)) assert.equal(hash(file), expected, file);
    assert.deepEqual(report.results.map(row => row.kind), M.BONUS_KINDS);
    for (const row of report.results) {
      assert.equal(row.mode, mode);
      assert.equal(row.betCents, 100);
      assert.equal(row.costCents, 100 * (mode === 'buy' ? M.BUY_COST : mode === 'ante' ? M.ANTE_COST : 1));
      assert.equal(row.totalCostCents, row.costCents * row.rounds);
      assert.equal(row.totalNetCents, row.totalPaidCents - row.totalCostCents);
      assert.equal(row.rtpPercent, 100 * row.totalPaidCents / row.totalCostCents);
      assert.equal(row.counts.hits + row.counts.zeros, row.rounds);
      assert.equal(row.counts.losses + row.counts.profits + row.counts.breaksEven, row.rounds);
      assert.ok(row.maxObservedXBaseBet <= M.MAX_WIN);
      assert.ok(row.rtpConfidence95Percent[0] <= row.rtpPercent);
      assert.ok(row.rtpConfidence95Percent[1] >= row.rtpPercent);
      assert.ok(row.rtpStandardErrorPercentagePoints > 0);
      assert.ok(Number.isSafeInteger(row.totalPaidCents));
    }
  });
}

test('the archived display profile preserves the historical estimates for every mode and choice', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'reports/legacy-sources/math-report.js'), 'utf8'), context);
  const profile = context.window.SlotReturnProfile;
  const rows = primary.flatMap(report => report.results);
  assert.equal(profile.profile, M.PROFILE_VERSION);
  assert.equal(profile.mathSha256, hash('js/math.js'));
  assert.equal(profile.totalRounds, rows.reduce((total, row) => total + row.rounds, 0));
  assert.equal(profile.results.length, 12);
  for (const row of rows) {
    const displayed = profile.results.find(value => value.mode === row.mode && value.kind === row.kind);
    assert.equal(displayed.rounds, row.rounds);
    assert.equal(displayed.rtpPercent, row.rtpPercent);
    assert.deepEqual(Array.from(displayed.confidence95Percent), row.rtpConfidence95Percent);
  }
});

for (const name of ['rtp-confirmation.json', 'rtp-minimum-bet.json']) {
  test(name + ' independently checks all twelve cells with the same source model', () => {
    const report = read(name);
    assert.equal(report.sourceSha256['js/math.js'], hash('js/math.js'));
    assert.equal(report.results.length, 12);
    assert.notEqual(report.seed, primary[0].seed);
    assert.equal(report.config.betCents, name === 'rtp-minimum-bet.json' ? 20 : 100);
    assert.equal(new Set(report.results.map(row => row.mode + '/' + row.kind)).size, 12);
    for (const row of report.results) {
      assert.ok(Number.isSafeInteger(row.totalPaidCents));
      assert.equal(row.totalCostCents, row.costCents * row.rounds);
      assert.equal(row.rtpPercent, 100 * row.totalPaidCents / row.totalCostCents);
    }
  });
}

test('conditional bonus reports cover all trigger strengths and super variants', () => {
  const report = read('conditional-bonuses.json');
  assert.equal(report.sourceSha256['js/math.js'], hash('js/math.js'));
  assert.equal(report.results.length, 21);
  assert.equal(new Set(report.results.map(row => [row.kind, row.pearls, row.super].join('/'))).size, 21);
  for (const row of report.results) {
    assert.equal(row.rounds, report.config.runs);
    assert.ok(row.paidXBaseBet.max <= M.MAX_WIN);
    assert.ok(row.paidXBaseBet.mean >= 0);
    assert.ok(row.paidXBaseBet.confidence95[0] <= row.paidXBaseBet.mean);
    assert.ok(row.paidXBaseBet.confidence95[1] >= row.paidXBaseBet.mean);
  }
});

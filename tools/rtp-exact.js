// Low-noise RTP: base game parts and trigger odds from a fast base-only run, plus each bonus's value from
// many independent plays.  RTP(choice) = base parts + sum over pearl counts of P(trigger n) * EV_n(choice).
// usage: node tools/rtp-exact.js [baseSpins] [bonusRuns] [seed] [ante]   (ante: measure Triple Chance spins at M.ANTE_COST)
const M = require('../js/math.js');
const N = Number(process.argv[2] || 1e7);
const R = Number(process.argv[3] || 4e5);
const rand = M.mulberry32(Number(process.argv[4] || 5));
const ante = process.argv[5] === 'ante', cost = ante ? M.ANTE_COST : 1;

let parts = 0;
const trig = { 3: 0, 4: 0, 5: 0 };
for (let i = 0; i < N; i++) {
  const r = M.baseSpin(rand, { ante });
  parts += r.ev.total;
  if (r.fsAward) trig[Math.min(5, r.ev.scatterCount)]++;
}
const ev = (kind, p, sup) => { let s = 0; for (let i = 0; i < R; i++) s += Math.min(M.MAX_WIN, M.playBonus(rand, kind, p, sup)); return s / R; };
console.log(`${ante ? 'TRIPLE CHANCE ' : ''}base parts (lines + attack + scatter pays) ${(100 * parts / N).toFixed(2)}%   trigger 1 in ${(N / (trig[3] + trig[4] + trig[5])).toFixed(0)}  (3:${trig[3]} 4:${trig[4]} 5:${trig[5]})`);
const buyShare = { 3: 0.945, 4: 0.052, 5: 0.003 }, buyScatter = 0.945 * 2 + 0.052 * 10 + 0.003 * 50;
for (const kind of M.BONUS_KINDS) {
  const e = { 3: ev(kind, 3, false), 4: ev(kind, 4, false), 5: ev(kind, 5, false) };
  const nat = (trig[3] * e[3] + trig[4] * e[4] + trig[5] * e[5]) / N;
  const buy = buyShare[3] * e[3] + buyShare[4] * e[4] + buyShare[5] * e[5] + buyScatter;
  console.log(`${kind.padEnd(7)} EV3 ${e[3].toFixed(1)}x EV4 ${e[4].toFixed(1)}x EV5 ${e[5].toFixed(1)}x  ->  game RTP ${((100 * parts / N + 100 * nat) / cost).toFixed(2)}%   buy RTP ${(buy / M.BUY_COST * 100).toFixed(2)}%`);
}

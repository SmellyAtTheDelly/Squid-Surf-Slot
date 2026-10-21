// Bonus balance simulator: average value (x bet) of every bonus by pearl count, Super versions and the Wheel.
// usage: node tools/bonus-sim.js [runsPerCell] [seed]
const M = require('../js/math.js');
const N = Number(process.argv[2] || 200000);
const rand = M.mulberry32(Number(process.argv[3] || 7));

function stats(fn) {
  let sum = 0, sq = 0, zero = 0, max = 0, big = 0;
  for (let i = 0; i < N; i++) {
    const v = Math.min(M.MAX_WIN, fn());
    sum += v; sq += v * v;
    if (v === 0) zero++;
    if (v > max) max = v;
    if (v >= 500) big++;
  }
  const mean = sum / N, sd = Math.sqrt(sq / N - mean * mean);
  return `${mean.toFixed(1).padStart(7)}x  ±${(sd / Math.sqrt(N)).toFixed(1).padStart(4)}  sd ${sd.toFixed(0).padStart(4)}  500x+ ${(100 * big / N).toFixed(2)}%  max ${max.toFixed(0)}`;
}

for (const kind of ['kraken', 'reef', 'vault']) {
  for (const p of [3, 4, 5]) console.log(`${kind.padEnd(7)} ${p} pearls ${stats(() => M.playBonus(rand, kind, p, false))}`);
  console.log(`${kind.padEnd(7)} SUPER    ${stats(() => M.playBonus(rand, kind, 3, true))}`);
}
console.log(`wheel   3 pearls ${stats(() => M.playBonus(rand, 'wheel', 3, false))}`);

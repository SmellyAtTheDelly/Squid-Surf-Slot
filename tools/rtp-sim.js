// Monte-Carlo RTP simulator for Squid Squad.  usage: node tools/rtp-sim.js [baseSpins] [buysPerBonus] [seed]
// Measures the full game once per bonus choice (the player picks a bonus on every trigger) and each bonus buy.
const M = require('../js/math.js');

const N = Number(process.argv[2] || 2e6);
const B = Number(process.argv[3] || 1e5);
const rand = M.mulberry32(Number(process.argv[4] || 12345));
const pct = (x, n) => (100 * x / n).toFixed(2) + '%';

for (const choice of M.BONUS_KINDS) {
  let base = 0, attackWin = 0, scatterPay = 0, bonusWin = 0, hits = 0, triggers = 0, attacks = 0, maxWin = 0;
  for (let i = 0; i < N; i++) {
    const r = M.baseSpin(rand);
    let win = r.ev.total;
    if (r.attack) { attacks++; attackWin += r.ev.total - r.ev.scatterPay; } else base += r.ev.total - r.ev.scatterPay;
    scatterPay += r.ev.scatterPay;
    if (r.fsAward) {
      triggers++;
      const f = Math.min(M.MAX_WIN - win, M.playBonus(rand, choice, r.ev.scatterCount, false));
      bonusWin += f; win += f;
    }
    if (win > 0) hits++;
    if (win > maxWin) maxWin = win;
  }
  const total = base + attackWin + scatterPay + bonusWin;
  console.log(`CHOOSING ${choice.toUpperCase().padEnd(6)} (${N.toLocaleString()} spins)  RTP ${pct(total, N)}  | lines ${pct(base, N)}  attack ${pct(attackWin, N)} (1 in ${(N / attacks).toFixed(0)})  scatter ${pct(scatterPay, N)}  bonus ${pct(bonusWin, N)} (1 in ${(N / triggers).toFixed(0)}, avg ${(bonusWin / triggers).toFixed(1)}x)  hit ${(100 * hits / N).toFixed(1)}%  max ${maxWin.toFixed(0)}x`);
}

for (const kind of M.BONUS_KINDS) {
  let tot = 0;
  for (let i = 0; i < B; i++) {
    const r = M.baseSpin(rand, { buy: true });
    tot += Math.min(M.MAX_WIN, r.ev.total + M.playBonus(rand, kind, r.ev.scatterCount, false));
  }
  console.log(`BUY ${kind.toUpperCase().padEnd(6)} @ ${M.BUY_COST}x  RTP ${(100 * tot / B / M.BUY_COST).toFixed(2)}%  (avg ${(tot / B).toFixed(1)}x)`);
}

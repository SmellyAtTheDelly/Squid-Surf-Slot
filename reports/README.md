**Squid Surf Slot validation reports**

**Current Stake Engine validation, 2026-10-23**

All 575 automated tests pass for `squid-engine-3`, including the seven mode prices, raw squid trigger counts, standalone six-wild guarantees, per-mode caps, integer settlement, recovery and replay. The production verifier checked 700,007 recorded books across all seven modes and proved exact weighted RTP of `963/1000` for each mode, with matching source and output hashes. See [the test output](stake-engine-tests.txt), [the full verification report](stake-engine-verification.json), [the current statistics](current-math-summary.json), and [the publication manifest](../dist/math/manifest.json).

Normal and Enhanced Chance play now route three or more purple squid wilds to Captain's Vault. Prices are Coin/Vault 100x, Super/Reef 250x, Legendary/Kraken 500x, Mystery/Wheel 185x, and Six Wilds 50x. Six Wilds never triggers a bonus and has a reachable maximum of 1,579.5x the base bet; other modes retain the 5,000x cap. Test coverage includes all seven modes across 42 authenticated bet levels and all five purchase controls across 11 local UI bet levels.

The new frontend and math must be uploaded as matching new versions. Hosted testing for this version remains outstanding. Earlier matched packages are preserved in `releases/squid-engine-1` and `releases/squid-engine-2`. Earlier Studio demo checks used the former twelve-mode math and do not establish hosted compatibility of this release. The original observed Studio configuration remains an unchanged historical fixture; tests reject its obsolete prices. The [migration specification](../docs/math-model.md) records deployment steps and outstanding hosted constraints.

A browser check completed the standalone six-wild mode on the local play-money RGS: 1,000.00 starting credits minus the 50.00 cost plus a 67.60 payout settled at 1,017.60. Exactly six purple wilds were visible, no bonus started, and no console warnings or errors occurred. See [the settled six-wild screenshot](six-wild-spin.png). The recorded round retained normal animation skipping and returned to the base controls.

The purchase menu was checked at 1280x720, 375x667 and 400x225. All five prices and selected purchase totals were correct; scrolling and label wrapping worked without horizontal overflow. See [the first purchase options](bonus-buy-prices.png) and [Legendary and Six Wilds](bonus-buy-wilds.png).

Volume and animation controls have 59 automated tests: independent music/effects levels, persistence, mute and reverb behavior, accessible slider controls, normal animation clocks, faster win counts, real-time result holds, and unchanged settlement under repeated input. Rapid input now stops reels directly at their accepted result without accelerating character, symbol or background motion. Symbol transformation matrices match between clicked and untouched playback; landing effects fire once even during repeated reel skips. Final win amounts have a 150ms minimum hold. Repeated input dismisses small and big wins within 250ms and bonus totals within 300ms in controlled playback tests; clicks cannot queue a paid spin while settlement is pending. Browser checks confirmed saved levels and panel visibility at desktop, 375x667 and 400x225. See [volume controls](volume-controls.png) and [compact landscape controls](volume-controls-landscape.png).

Six Wilds now remains selected until its visible Turn Off control is used. The price is shown per spin, including after reload; activation and reload never queue extra wagers. Fifteen bonus-control tests cover persistence, explicit spin requests, OFF during an accepted round, autoplay and held-input cancellation, recovery, replay, restrictions, bonus-menu bet changes, and authenticated limits. The bonus menu was checked at desktop, 375x667 and 400x225, including recalculation of all five prices. See [bonus-menu bet controls](bonus-menu-bet-controls.png).

The publication 3 local browser check activated Six Wilds at a 1.00 base bet, charged 50.00, paid the recorded 1,053.00 result and settled at 2,003.00 credits. A subsequent explicit Spin charged another 50.00, returned zero and retained the active mode at 1,953.00 credits. Reload retained both that balance and the selected mode without an extra wager. Turn Off restored the 1.00 normal-spin price. The mode control was visible on desktop and at 375x667, and the browser reported no console errors. See [the persistent mode control](persistent-six-wilds.png).

Publication 3 changes only the Six Wilds weighted distribution: zero-payout probability is 93.674778%, profit probability is 4.545038%, and payout standard deviation is 4.413174 times the 50x purchase cost, compared with 0.547 previously. RTP remains exactly 96.3%, the six-wild guarantee remains exact, and the maximum remains 1,579.5x base bet. Six dedicated distribution tests cover candidate reachability, payout boundaries, exact production-size statistics, reproducibility, untouched other modes, and verifier rejection of insufficient volatility. All six other modes' event and lookup files match publication 2 byte-for-byte. See [the exact comparison](six-wilds-volatility.json).

**Historical source-model results**

Generated on 2026-10-22 using profile `squid-ways-2` and Node.js `v24.13.0`. Everything below describes the archived source model, not the active `squid-engine-2` weighted publication. Current Engine math and deployment instructions are in [the migration specification](../docs/math-model.md); current exact weighted statistics are in [dist/math/manifest.json](../dist/math/manifest.json). Historical model and helper sources are retained in [legacy-sources](legacy-sources) for fingerprint verification. These reports are not certified theoretical RTP or a promise about a session.

**Primary full-round results**

The primary run covers 82,000,000 completed paid rounds: 40,000,000 base rounds, 40,000,000 Triple Chance rounds, and 2,000,000 purchases. The base bet is 100 cents. Actual debits are 100 cents for base, 200 cents for Triple Chance, and 10,000 cents for Bonus Buy. Payouts and the 5,000x combined-round cap remain denominated in the base bet.

Each row follows a fixed selection policy: always choose the named bonus on every natural trigger, or always purchase it. Wheel still draws its weighted cash or feature result. The rows do not mix choices or evaluate a strategy that changes the selected bonus according to the trigger Pearl count. Such a strategy has a different distribution and needs its own analysis.

RTP is total settled payout cents divided by total actual debit cents, multiplied by 100. Natural-mode denominators include every paid spin, including spins without a trigger. Purchase denominators include the full 100x purchase cost. Numerators include the actual trigger-spin ways and scatter awards, all feature awards, cumulative cent rounding, and the shared round cap.

| Mode | Fixed bonus choice | Rounds | Cell seed | Estimated RTP | SE, percentage points | Approximate 95% CI |
| --- | --- | --- | --- | --- | --- | --- |
| Base | Kraken | 10,000,000 | 626551994 | 94.788% | 0.655 | 93.505 to 96.072% |
| Base | Reef | 10,000,000 | 2873374501 | 93.487% | 0.466 | 92.575 to 94.400% |
| Base | Vault | 10,000,000 | 825229712 | 94.607% | 0.264 | 94.090 to 95.125% |
| Base | Wheel | 10,000,000 | 3072052219 | 94.375% | 0.496 | 93.403 to 95.347% |
| Triple Chance | Kraken | 10,000,000 | 3280987755 | 94.232% | 0.582 | 93.090 to 95.373% |
| Triple Chance | Reef | 10,000,000 | 1232842966 | 95.049% | 0.415 | 94.235 to 95.863% |
| Triple Chance | Vault | 10,000,000 | 3479665473 | 94.479% | 0.230 | 94.028 to 94.930% |
| Triple Chance | Wheel | 10,000,000 | 1431520684 | 94.539% | 0.427 | 93.701 to 95.376% |
| Bonus Buy | Kraken | 500,000 | 1640456220 | 96.305% | 0.445 | 95.433 to 97.178% |
| Bonus Buy | Reef | 500,000 | 3887278727 | 95.436% | 0.294 | 94.860 to 96.012% |
| Bonus Buy | Vault | 500,000 | 1839133938 | 95.231% | 0.118 | 94.999 to 95.463% |
| Bonus Buy | Wheel | 500,000 | 4085956445 | 95.279% | 0.305 | 94.682 to 95.876% |

Sources: [base report](rtp-base.json), [Triple Chance report](rtp-ante.json), and [purchase report](rtp-buy.json). Their common master seed is `20261022`; deterministic mode and bonus offsets produce the cell seeds shown above.

Intervals use unbiased sample variance and a two-sided normal approximation: mean plus or minus 1.959963984540054 standard errors. Standard error is sample standard deviation divided by the square root of the sample count, then normalized by actual wager. The intervals are marginal estimates for individual rows, not a simultaneous confidence statement about all 12. Rare large awards can be poorly represented even in large samples; these intervals do not prove convergence or identify an exact house edge.

**Hits, losses, and payout dispersion**

A hit means any positive gross payment. A net loss means payment below the actual charged wager. Standard deviation below is the sample standard deviation of gross return in actual-wager multiples. Observed maximum is measured in base-bet multiples. These definitions remain distinct across modes.

| Mode | Bonus | Hit frequency | Net-loss frequency | SD per actual wager | Maximum observed | Cap hits |
| --- | --- | --- | --- | --- | --- | --- |
| Base | Kraken | 45.581% | 85.261% | 20.708x | 5000.00x | 23 |
| Base | Reef | 45.593% | 85.257% | 14.725x | 1459.00x | 0 |
| Base | Vault | 45.582% | 85.249% | 8.345x | 1302.00x | 0 |
| Base | Wheel | 45.555% | 85.260% | 15.683x | 5000.00x | 7 |
| Triple Chance | Kraken | 47.553% | 89.607% | 18.418x | 5000.00x | 85 |
| Triple Chance | Reef | 47.562% | 89.612% | 13.132x | 1835.00x | 0 |
| Triple Chance | Vault | 47.534% | 89.615% | 7.270x | 1366.00x | 0 |
| Triple Chance | Wheel | 47.542% | 89.612% | 13.515x | 5000.00x | 35 |
| Bonus Buy | Kraken | 100.000% | 81.315% | 3.147x | 5000.00x | 370 |
| Bonus Buy | Reef | 100.000% | 88.330% | 2.079x | 2445.00x | 0 |
| Bonus Buy | Vault | 100.000% | 59.557% | 0.838x | 1690.00x | 0 |
| Bonus Buy | Wheel | 100.000% | 77.070% | 2.154x | 5000.00x | 116 |

Every purchased round has a positive scatter award, so a 100% hit frequency does not imply profit. Purchases still lose money on most rounds for all four choices. A zero observed cap count does not establish that the cap is unreachable. Complete zero-payout, profit, break-even, trigger, and attack counts are retained in each JSON report.

**Confirmation and minimum-bet runs**

The [confirmation run](rtp-confirmation.json) uses master seed `3735928559`, 1,000,000 rounds per natural-mode/choice cell, and 100,000 per purchase cell, for 8,400,000 additional completed rounds at a 100-cent base bet.

For a conventional approximate cross-run diagnostic, divide each RTP difference by the square root of the sum of the two squared standard errors. The largest absolute standardized difference between primary and confirmation results is 1.087, for Triple Chance Kraken. All 12 are below 1.96 under this diagnostic. This uses the independent-run approximation for separate seeded streams; it does not prove equal true returns, PRNG independence, or provider certification. It also does not mean each confirmation estimate falls inside the narrower primary interval.

The [minimum-bet run](rtp-minimum-bet.json) uses the same cell counts, a 20-cent base bet, and master seed `324508639`, adding another 8,400,000 completed rounds. Costs are 20, 40, and 2,000 cents for base, Triple Chance, and purchase. This exercises actual cumulative cent rounding at the smallest browser stake. Because the seed and observed outcomes also differ, subtracting this run's RTP from the primary RTP does not isolate a rounding effect. Numerical results and intervals are preserved in its JSON.

Together, the primary, confirmation, and minimum-bet runs contain 98,800,000 completed paid rounds. The conditional bonus samples below are a separate population.

**Analytic reel odds**

The [analytic odds report](exact-odds.json) comes from finite ordered-reel enumeration and probability convolution, evaluated with floating-point arithmetic. It is not a simulation. It excludes Squad Attack's award changes, all bonuses, combined-cap effects, and cent rounding, so its unmodified return contribution is not whole-game RTP.

| Mode | Natural trigger probability | Mean trigger spacing | Pre-attack ways plus scatter EV, x base bet | Contribution per actual wager |
| --- | --- | --- | --- | --- |
| Base | 0.433491% | 1 in 230.685 | 0.485154071x | 48.515407% |
| Triple Chance | 1.302294% | 1 in 76.788 | 0.565485743x | 28.274287% |

The ante/base natural-trigger ratio is 3.004200623, approximately three rather than exactly three. Attack preserves Pearls, so these trigger probabilities also apply after attack. Purchased triggers instead use their explicit 94.5% / 5.2% / 0.3% distribution over three, four, and five Pearls.

**Conditional bonus values are not RTP**

The [conditional bonus report](conditional-bonuses.json) contains 5,250,000 feature samples: 250,000 for each of 21 cells, covering three/four/five Pearls, normal and Super Kraken/Reef/Vault, and the normal Wheel. Master seed is `19088743`, base bet is 100 cents, and prior-win units are zero. Each cell therefore starts with the full cap allowance.

These samples exclude trigger-spin payment and purchase cost. They measure capped feature-only payment in base-bet multiples, not return on a paid spin or purchase. An actual trigger has already consumed some cap allowance. The report contains per-cell seeds, mean, standard deviation, standard error, confidence interval, maxima, and cap/zero frequencies.

Four-Pearl normal features illustrate why equal conditional value is not assumed:

| Feature | Mean bonus-only payment | Approximate 95% CI |
| --- | --- | --- |
| Kraken | 165.327x | 163.506 to 167.148x |
| Reef | 166.043x | 165.180 to 166.905x |
| Vault | 149.826x | 149.485 to 150.168x |
| Wheel | 157.843x | 156.654 to 159.033x |

**Reproduction and source provenance**

Run these commands from the project directory. JSON is written to standard output; preserve UTF-8 when saving it. All cell counts and seeds are explicit. The three primary commands together produce the 82,000,000-round primary sample.

```text
node reports/legacy-sources/tools/rtp-sim.js 10000000 500000 20261022 --mode base --json
node reports/legacy-sources/tools/rtp-sim.js 10000000 500000 20261022 --mode ante --json
node reports/legacy-sources/tools/rtp-sim.js 10000000 500000 20261022 --mode buy --json
node reports/legacy-sources/tools/rtp-sim.js 1000000 100000 3735928559 --json
node reports/legacy-sources/tools/rtp-sim.js 1000000 100000 324508639 --bet-cents 20 --json
node reports/legacy-sources/tools/bonus-sim.js 250000 19088743 --json
node reports/legacy-sources/tools/odds.js
```

The Monte Carlo tools call production math and shared settlement rather than a separate payout approximation. Welford accumulation computes sample variance. Seeded Mulberry32 is for reproducibility; the browser uses Web Crypto and unbiased bounded-integer rejection sampling. The historical `rtp-exact.js` entry is explicitly a Monte Carlo compatibility wrapper. The analytic program is `odds.js`.

Every Monte Carlo JSON records profile, unit scale, runtime, complete command, configuration, timestamps, and source SHA-256 values. All saved Monte Carlo reports use the same math fingerprint below. The analytic JSON has no embedded provenance wrapper; its program fingerprint and saved-report digest are recorded here.

| Source | SHA-256 |
| --- | --- |
| [js/math.js](legacy-sources/js/math.js) | `15f7373f4aa9971ab9aa6b8be7507ffe50368c6258ca78745721eb5df9adb4db` |
| [tools/statistics.js](legacy-sources/tools/statistics.js) | `13c11ddea87e10f7f7a855c0dd7c4daa20145927733d1badc50629e7dbf37207` |
| [tools/rtp-sim.js](legacy-sources/tools/rtp-sim.js) | `44b49077c9d3deab6a0a9bbc4d1e5610b87ea1b49e9177ddf160c2e22c0f482d` |
| [tools/rtp-exact.js](legacy-sources/tools/rtp-exact.js) | `6d8fd895487ce03b360dbdc35f8f82ec6e1f4514ab7c04ef3ee376590a49ce3f` |
| [tools/bonus-sim.js](legacy-sources/tools/bonus-sim.js) | `e409a0caf8f64a6211b2117988570c3f441ad5309e3ffd81411e6d291fd09e94` |
| [tools/odds.js](legacy-sources/tools/odds.js) | `52d18a1dff1ecebd79c216e51078a667d79c09178223ff677091cc31594cc40f` |

Replaying identical source, seeds, and options reproduces numerical outcomes. Timestamps and absolute command paths can change the regenerated JSON bytes, so whole-file hashes need not match a rerun. The following digests identify these saved reports, not a mathematical proof of their correctness.

| Saved report | SHA-256 |
| --- | --- |
| [rtp-base.json](rtp-base.json) | `1286035b086cfb5fc1f543a87fee82d58d2f68214f0bd6210f9aaf37324a521a` |
| [rtp-ante.json](rtp-ante.json) | `a72528950b81f2eb78e9039d97fd3f3e2d0c302e96b9b8e5091c50121afeb65e` |
| [rtp-buy.json](rtp-buy.json) | `d9e4826c7b1f161d42716e4f3207ebc321820e8682b098c0f6bbd21d0554ea15` |
| [rtp-confirmation.json](rtp-confirmation.json) | `28ec1d8a68033ffc46ba668ab424a9b0f67ce4aee27d7ce67b88ce2df38d06d0` |
| [rtp-minimum-bet.json](rtp-minimum-bet.json) | `e94171b795d93e96c5540ee9893de2f27abfba020008b78ec1e6966a65fee7de` |
| [conditional-bonuses.json](conditional-bonuses.json) | `0990e096a868fce29febf7264e268d7453510d182439ac5ddc4eaa2b119fa5d8` |
| [exact-odds.json](exact-odds.json) | `f935575fb1c83692cb58399d5bf2adc9d84ffd7407b2bce04f131cd71e4dabf3` |

**Browser snapshot and supporting documents**

`node --test tests/*.test.js` passed all 253 tests with no failures or skips. This includes 46 browser-flow integration tests running the real game, bonus, and math scripts with display/audio stubs and controlled time. Coverage includes an independent enumeration of winning ways, all paytable entries, weighted-draw boundaries, secure rejection sampling, every bonus route, all eight wheel segments, cumulative rounding, combined caps, autoplay, duplicate inputs, insufficient funds, immutable accepted wagers, and report/source consistency. Every JavaScript file also passed `node --check`.

The [return-estimates screenshot](return-estimates.png) shows the browser rules panel displaying the primary estimates and intervals, actual-wager wording, cumulative rounding, combined cap, and demo limitation.

A manual browser check also verified normal and Triple Chance debits and a completed Reef payout: a 998.60-credit starting balance minus the 100-credit purchase plus the 2-credit trigger award and 12-credit Reef award produced 912.60 credits. The browser reported no console warnings or errors during that check.

- [Mathematical specification](../docs/math-model.md): exact ways formulas, feature state transitions, denomination, cap, rounding, and analytic versus simulated quantities.
- [Provider research](../docs/provider-research.md): primary-source evidence for different multiplier and payout models, and limits of public proprietary-math information.
- [Operator and standards research](../docs/operator-standards-research.md): outcome generation, authoritative settlement, versioning, fairness, and deployment requirements.

This local browser demo is not an authoritative real-money wallet or a certified gaming system. The reports validate the specified local model and expose uncertainty; they do not supply the operational controls required for production deployment.


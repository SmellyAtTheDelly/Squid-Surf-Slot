**Squid Surf Slot mathematical model**

**Stake Engine migration, 2026-10-23**

The active publication profile is `squid-engine-3`, with event schema 2. The project separates [offline mathematics](../math), [static frontend](../frontend), and the [shared event contract](../shared/contract.js). Stake's RGS selects an entire recorded outcome and owns the wallet. The frontend presents the returned events. It does not generate wagers or settle a local wallet. Decorative animation randomness remains in the renderer.

The `squid-ways-3` source model in [math/model.js](../math/model.js) generates candidate events with the squid triggers and purchase prices. Offline publication weights intentionally change the candidate frequencies to reach the target RTP. Publication 3 changes the Six Wilds candidate mix and weights to produce much higher payout variance while retaining the same rules, paytable and maximum. The original `squid-ways-2` model is preserved byte-for-byte in [the source archive](../reports/legacy-sources/js/math.js). The historical simulation results below and in [reports/README.md](../reports/README.md) describe that former model, not the current Engine distribution. Previous matched upload packages are preserved in `releases/squid-engine-1` and `releases/squid-engine-2`.

**Published modes and amounts**

| Group | Mode names | Charge | Theoretical RTP |
| --- | --- | --- | --- |
| Base | `base_vault` | 1x base stake | 96.3% |
| Enhanced Chance | `ante_vault` | 2x base stake | 96.3% |
| Coin / Captain's Vault | `buy_vault` | 100x base stake | 96.3% |
| Super / Pearl Reef | `buy_reef` | 250x base stake | 96.3% |
| Legendary / Kraken's Wrath | `buy_kraken` | 500x base stake | 96.3% |
| Mystery / Wheel | `buy_wheel` | 185x base stake | 96.3% |
| Six Wilds | `buy_wilds` | 50x base stake | 96.3% |

Three or more purple squid wilds on the final base or Enhanced Chance board trigger Captain's Vault. The count includes wilds added by Squad Attack. All trigger cells are recorded; feature strength uses a level capped at five squids. Purchased bonuses force three to five wilds and suppress attacks. The 50x purchase guarantees exactly six wilds, suppresses attacks, and never triggers a bonus. Pearl scatters still pay cash awards and retrigger Kraken spins; they no longer trigger a bonus from the base game. Super and Legendary are purchase labels for the existing Reef and Kraken features; Wheel's internal Super variants retain their own mechanics.

Every triggered feature is already part of its mode's complete recorded round. Vault chest positions reveal a predetermined sequence; clicking a different position cannot change the payout. Wheel results and any resulting feature are included in the same round. Reef's named prizes are fixed multipliers rather than progressive jackpots.

Activating Six Wilds selects `buy_wilds` for each subsequent Spin until the visible Turn Off control is used. Each spin costs 50 times the selected base bet; activation does not grant free spins. The selection survives reload, but reload never places a wager. Turning it off during an accepted round affects subsequent wagers only. The bonus menu provides base-bet controls and recalculates every purchase price while respecting the authenticated limits for the selected mode.

Book payouts use hundredths of the base stake: `100` means 1x. Normal and bonus rounds have a 5,000x cap (`500000` units); Six Wilds has a 1,579.5x maximum (`157950` units), reachable as 243 Anchor ways paying 6.5x each. The CSV payout column must equal the corresponding JSONL book's `payoutMultiplier` by row position. The wallet uses integer micro-units: `1000000` means one currency unit. `/wallet/play.amount` is always the base stake. For example, a 1-unit Legendary purchase debits 500 units; a 750x result pays 750 units. A 0.01-unit wager with a 0.06x win pays 0.0006 units, without cent rounding in the frontend. The RGS response owns the actual balance and settlement.

For weights `w`, book payouts `p` in hundredths, and mode cost `c`, exact RTP is `sum(w*p) / (100*c*sum(w))`. [math/weights.js](../math/weights.js) balances two groups around the target mean using positive integer weights. BigInt arithmetic proves the reduced result is exactly `963/1000`, rather than accepting a Monte Carlo interval around the target. This is an offline fixed distribution and never adapts to a player's history or balance.

The default production export records 100,000 seeded sampled rounds and one explicitly reachable maximum-win round per mode. The maximum outcome has lower source mass than an ordinary sample; the final frequency is checked against Stake's guidance and recorded in the manifest. Sampled payout statistics and feature counts, published hit and feature frequencies, standard deviation, max-win frequency, file hashes, and balancing factors are all reported. The target applies to the published weighted multiplier distribution. Any server-side rounding at denominations smaller than the payout precision must be checked in Studio.

Six Wilds uses the `six-wilds-extreme-1` publication profile. One in twenty candidate boards favors an existing premium symbol before the ordinary six-wild placement; every resulting outcome still passes the unchanged ways evaluator. Zero results and non-maximum results of at least 750x base stake receive source weight 1,000, other positive results receive 1, and maximum results receive 50. Exact balancing then reaches 96.3% RTP. The published probability of zero payout is 93.674778%, any payout 6.325222%, and profit over the 50x charge 4.545038%. Standard deviation is 4.413174 times the purchase cost, compared with 0.547 in publication 2. The 1,579.5x base-bet maximum occurs about once in 507 rounds; it is distributed across many reachable boards. These are fixed weighted probabilities, not promises about a short session. Production verification enforces a standard deviation of at least 4, a hit rate no greater than 10%, and a profit rate no greater than 8%. See [the exact comparison](../reports/six-wilds-volatility.json).

This candidate selection and fixed probability weighting follows the separation described in Stake's [math SDK quick start](https://github.com/engineio/docs/blob/main/src/routes/docs/math-sdk/quick-start/%2Bpage.svx): recorded outcomes supply the event books, and offline optimization sets their selection weights. The probability profile is included in the manifest and its implementation is covered by source hashes.

**Build, verify, and run locally**

Use Node.js 24.13 or later with built-in Zstandard support. No third-party runtime dependencies are required.

```text
npm run math:export
npm run math:verify
npm test
npm run build
npm start
```

`math:export` requires an empty `dist/math` directory and refuses to overwrite a publication. A new candidate can be generated separately with `node math/export.js --out dist/math-candidate`; verify it using `node math/verify.js --dir dist/math-candidate --production`. The verifier checks every event and payout, source hashes, row correspondence, uint64 weight limits, file limits, mode completeness, and exact RTP.

The build writes [dist/frontend](../dist/frontend). The export writes [dist/math](../dist/math), including `index.json`, seven compressed event books, seven CSV lookup tables, and `manifest.json`. The manifest is an audit artifact; `index.json` names the required upload files. Do not upload `tools/`, the local mock server, source reports, or the offline generator as frontend assets.

`npm start` serves http://localhost:5177 and redirects to a same-origin local demo launch. [tools/demo-rgs.js](../tools/demo-rgs.js) samples the published weighted files using unbiased cryptographic draws and implements a disposable in-memory demo wallet. Restarting this local server resets demo sessions. It is a test harness, not the production Stake wallet.

**Stake Studio handoff**

Create or select the game in Stake Engine Studio. Upload the contents of `dist/frontend` as a new frontend version. Upload `dist/math/index.json` together with all math publication files it references as a new math version. Associate both new versions before testing. The previous twelve-mode math has incompatible costs and schema; uploading only this frontend will reject that configuration. Test the launch URL supplied by Studio, including all seven mode names, purchase costs, real session limits, currency display, interrupted rounds, and replay. Compose the game tile using the dashboard's built-in Tile Editor, configure the provider logo under Team Settings > Branding, and complete Studio's game details and review checklist. The [official Tile Editor guide](https://github.com/engineio/docs/blob/main/src/routes/docs/approval/game-tile/%2Bpage.svx) replaces older separate-cover instructions. Account access, hosted compatibility testing, review, and approval are still external steps; local validation does not establish acceptance or certification.

The adapter reads `sessionID` and `rgs_url` from the launch URL, authenticates before wagering, consumes `round.state`, checkpoints with `/bet/event`, and ends active rounds once presentation finishes. Ambiguous play or settlement failures block new wagers until authentication recovers the accepted round. Replaying a round uses the dedicated GET endpoint with no wallet calls. Replay URLs use `replay=true`, `game`, `version`, `mode`, `event`, and optional `amount` and `currency`, plus `rgs_url`.

Authentication accepts `config.gameModes` as returned by the Studio RGS: an array of objects containing `mode`, `costMultiplier`, and `maxBet`. The original twelve-mode observed configuration is retained unchanged in [the historical regression fixture](../tests/fixtures/stake-auth-config.json); tests now explicitly reject its obsolete costs. Current tests construct the seven-mode configuration from the shared registry. Both `gameModes` and `betModes` also accept keyed objects; the [official authentication example](https://github.com/engineio/docs/blob/main/src/routes/docs/api/authenticate/%2Bpage.svx) uses an empty `betModes` object. Absent or empty metadata uses the fixed published mode names and costs with authenticated global bet limits. Explicit mode costs, identities, duplicates, and limits are validated. Studio omits `round` when no current round exists; this is handled like `round: null`, without weakening validation of returned rounds.

Known hosted verification point: the public primary sources expose `minimumRoundDuration` but do not specify its units. A positive value currently blocks wagering with an explicit unsupported timing message. Confirm the unit with Stake and implement that wait before enabling such jurisdictions. Zero/default sessions work. Autoplay, turbo, spacebar, fullscreen and purchase restrictions are read from the session configuration.

This publication targets the standard Stake.com experience. Stake.us social distribution requires a separate review: its current rules prohibit terms including `buy` in math mode names and require alternate wording throughout the interface, rules and replay. The current `buy_*` identifiers and standard terminology are not a social-approved release. SC/GC formatting alone does not establish social compliance. See [jurisdiction requirements](https://stake-engine.com/docs/approval-guidelines/jurisdiction-requirements).

Primary references checked on 2026-10-23: [math file format](https://stake-engine.com/docs/math/math-file-format), [math verification](https://stake-engine.com/docs/approval-guidelines/math-verification), [wallet API](https://stake-engine.com/docs/rgs/wallet), [mandatory replay](https://stake-engine.com/docs/approval-guidelines/game-replay-requirements), and [submission checklist](https://stake-engine.com/docs/approval-guidelines/submission-checklist). Current math guidance specifies 96.0% to 96.7% RTP for every mode; older wider ranges are not used here.

**Historical source-model specification, 2026-10-22**

The remainder of this document describes the unchanged `squid-ways-2` source model and its former standalone settlement. Its browser-wallet, rounding, probabilities and production-boundary descriptions are historical. Current browser orchestration is in [frontend/js/game.js](../frontend/js/game.js) and [frontend/js/bonus.js](../frontend/js/bonus.js).

**Board, denomination, and accepted wager**

The game has five reels and three visible rows. Its 243 possible five-reel ways are the choices of one row on each reel, $3^5 = 243$. Matching symbols pay on consecutive reels beginning with reel one, in any row. There are no paylines to select and no additional division of a listed award by 243.

Let $B$ be the accepted base bet in integer cents. Every symbol award, feature prize, and maximum-win multiple refers to this base bet. The amount charged is a separate quantity:

| Mode | Cost in cents | Outcome configuration |
| --- | --- | --- |
| Base | $B$ | Base weights and ordinary attack probability |
| Triple Chance / ante | $2B$ | Ante weights and ante attack probability |
| Bonus Buy | $100B$ | Base weights with a purchased scatter trigger; no attack |

Ante and purchase cannot be combined. The round accepts and freezes its bet, mode, cost, cap, and profile before settlement. The math API permits whole-cent bets from 1 through 1,000,000 cents; the browser offers a smaller fixed stake list. Changing denomination does not change the random outcome distribution, although cent rounding can change the return ratio at small bets.

**Symbol generation**

Each cell is drawn from the selected reel's weights in row order. After the first Pearl on a reel, the Pearl weight is excluded for that reel's remaining rows, and the other weights are renormalized. There can be at most one Pearl per reel. Reels use separate draws; rows on the same reel are not independent because of this exclusion. These are weighted symbol draws, not windows cut from a physical reel strip.

| Configuration | Reel | J | Q | K | A | Silver | Gold | Anchor | Wild | Pearl |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base | 1 | 30 | 28 | 26 | 24 | 13 | 11 | 9 | 0 | 4 |
| Base | 2-5 | 30 | 28 | 26 | 24 | 13 | 11 | 9 | 4 | 4 |
| Ante | 1 | 30 | 28 | 26 | 24 | 13 | 11 | 9 | 0 | 6.11 |
| Ante | 2-5 | 30 | 28 | 26 | 24 | 13 | 11 | 9 | 5.8 | 6.11 |
| Kraken | 1 | 28 | 26 | 24 | 22 | 14 | 12 | 10 | 0 | 2.4 |
| Kraken | 2-5 | 28 | 26 | 24 | 22 | 14 | 12 | 10 | 2.63 | 2.4 |

A weight is relative, not a percentage. Before any exclusion, a symbol with weight $w$ on a reel of total weight $T$ has probability $w/T$. Weighted selection converts weights to integer tickets at a scale of 10,000. Zero weights cannot be selected. Wilds never land on reel one, including during Kraken.

**Ways evaluation and multiplier scope**

The table gives the payout for one winning way as a multiple of the base bet:

| Symbol | 3 reels | 4 reels | 5 reels |
| --- | --- | --- | --- |
| J | 0.06 | 0.20 | 0.60 |
| Q | 0.07 | 0.25 | 0.80 |
| K | 0.12 | 0.35 | 1.00 |
| A | 0.14 | 0.40 | 1.30 |
| Silver | 0.25 | 0.80 | 2.60 |
| Gold | 0.40 | 1.30 | 4.00 |
| Anchor | 0.65 | 2.00 | 6.50 |

For each ordinary symbol separately, find its longest consecutive run $L$ from reel one, counting Wild as a substitute. Fewer than three reels pays nothing. Only that longest length pays for the symbol; its shorter prefixes do not also pay. Awards for different symbols are added. Wild has no standalone award and does not substitute for Pearl. The absence of reel-one Wild avoids an all-wild substitution ambiguity.

On each eligible reel $r$, define $c_r$ as the count of matching symbols and all Wilds, $z_r$ as the count of matching symbols and plain Wilds, and $V_r$ as the sum of positive Wild multiplier values. The number of ways is

$$
W = \prod_{r=1}^{L} c_r.
$$

Each individual way with multiplier Wilds uses the sum of those Wild values. A way with none uses x1. A plain Wild substitutes but adds nothing to a way already containing multiplier Wilds. Consequently the sum of all effective way multipliers is

$$
E = \prod_{r=1}^{L} z_r
  + \sum_{r=1}^{L}\left(V_r\prod_{q\ne r} c_q\right).
$$

For paytable amount $P_{s,L}$, the symbol award is $P_{s,L}E$ base bets. The implementation multiplies integer paytable units by $E$, avoiding floating-point accumulation in ways awards. Its reported `mult` field is $E/W$, an average over ways, not an additional global multiplier.

Example: a three-reel J run with 2, 1, and 3 matching positions pays $2 \times 1 \times 3 \times 0.06 = 0.36$ base bets. Assume the fourth reel breaks the run.

Example with multipliers: Gold has one match on reel one, Gold plus x2 Wild on reel two, and Gold plus x3 Wild on reel three, followed by a break. The four ways use multipliers 1, 2, 3, and 5. They pay $0.40 \times (1+2+3+5)=4.40$ base bets. The way containing both Wilds uses $2+3=5$. At a 200-cent base bet, this symbol contributes 880 cents before any shared cap.

**Pearls, Squad Attack, and purchased triggers**

Three, four, or five visible Pearls award 2x, 10x, or 50x base bet respectively, and trigger the selected bonus with the same Pearl count. Scatter awards are added to any ways awards on the trigger spin.

Squad Attack is one random attempt per eligible paid base spin: probability $1/84$ in base mode and $1/50$ in ante mode. Its target count is 2, 3, 4, or 5 with weights 40, 34, 18, and 8. It uniformly shuffles eligible positions on reels two through five, excluding existing Wilds and Pearls, and converts the first positions to plain Wilds. If fewer positions exist, the count is reduced. It evaluates the resulting board once. There is no retry conditioned on whether the attack wins, improves the previous board, or meets a desired return. It leaves Pearl counts unchanged.

A purchase draws its trigger count with weights 94.5, 5.2, and 0.3 for three, four, and five Pearls. These sum to 100. Existing Pearls are replaced by non-Pearl draws from the base weights; the chosen number of distinct reels is selected uniformly, with one random row per chosen reel replaced by a Pearl. The actual resulting board is evaluated, including regular ways and the scatter award, before its bonus. A purchased round is not represented by an isolated bonus plus an assumed fixed trigger payout.

**Kraken free spins**

Three, four, and five trigger Pearls start 8, 10, and 13 spins. Super Kraken adds one uniformly positioned x2 sticky Wild on reels two through five, with no additional starting spins.

Each spin draws the Kraken weight configuration, then overlays existing sticky Wilds. An overlay can cover a newly drawn Pearl, which then does not count toward the visible scatter award or retrigger. A new Wild receives x2, x3, or x5 with weights 62, 28, and 10, and becomes sticky.

Every three newly landed Wilds causes one awakening. The rage remainder is retained. Each awakening increases every current sticky Wild multiplier by one, including Wilds that arrived on that spin, before evaluating that same spin. It also grants two spins. Three or more visible Pearls grant five more spins, in addition to their scatter award.

At most 60 spins can be played in the feature. Awakening spins consume available spin allowance before scatter retriggers. The bonus also stops when its allowed payout is exhausted. `krakenStep` is the shared state transition used by the browser and the simulator; the browser supplies the remaining combined-round allowance.

**Pearl Reef**

The 15-cell board begins with as many locked pearls as the triggering count. Super Reef adds two starting pearls. Cash values are multiplied by a level of 1, 3, or 7.5 for three, four, or five trigger Pearls, and by a further 3 in Super Reef. Jackpot values do not receive this level multiplier.

The pearl value distribution is:

| Value | 1 | 2 | 3 | 4 | 5 | 8 | 10 | 15 | Mini | Minor | Major | Golden |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Weight | 230 | 220 | 160 | 110 | 95 | 60 | 42 | 24 | 15 | 5 | 1.5 | 13 |

Mini, Minor, and Major award 20x, 50x, and 150x base bet. Golden has no direct cash value. Starting pearls use this distribution with Golden removed and the remaining weights renormalized.

The feature starts with three respins. On each respin, every empty cell independently has a 0.0965 landing probability. Every newly occupied cell receives a weighted pearl value. Any landing restores three respins; no landing removes one. If $g$ Golden pearls arrive, every cash pearl currently present is multiplied by $2^g$, including cash landing on that same respin. Jackpot pearls are unchanged. Cash arriving on later respins does not inherit earlier doublings. Filling all 15 cells ends the feature and adds a 1,000x Grand to the collected values. Final payment still consumes the shared round cap.

**Treasure Vault**

Twelve concealed chests contain seven independently drawn coin amounts, one multiplier chest, one extra life, and three Kraken hazards. The entire pool is uniformly shuffled before selection. Coin values and relative weights are:

| Coins | 3 | 5 | 8 | 10 | 15 | 20 | 30 | 50 | 100 | 250 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Weight | 15 | 18 | 17 | 14 | 11 | 8 | 5 | 2.4 | 0.8 | 0.12 |

Starting lives are 2, 3, or 4 for three, four, or five trigger Pearls. The starting multiplier is x1 for three/four Pearls and x3 for five; Super Vault doubles it to x2 or x6. The multiplier chest adds one normally or two in Super Vault. A life adds one life, and a Kraken removes one.

The feature ends when lives reach zero or every non-Kraken chest is open. Its payout is collected coin total times the final multiplier, so a later multiplier also affects earlier coins. The simulator opens indices in sequence. With a uniform hidden shuffle and no information about unopened contents, those selections have the same distribution as any selection order that does not inspect hidden contents. This is an exchangeability argument, not a claim that the browser can prevent a user from inspecting its local state.

**Mystery Wheel**

The eight slices have total weight 90. Normal Kraken, Reef, and Vault each have weight 20; their Super versions each have weight 4; the 25x and 40x cash prizes each have weight 9. Thus each normal feature has probability $20/90$, each Super feature $4/90$, and each cash slice $9/90$. Visual slice size does not define probability.

The selected result is drawn before its landing animation. A feature slice retains the original trigger Pearl count and applies its Super flag. A cash slice pays directly. Wheel does not dispatch another Wheel, and there is no recursive wheel chain.

**Integer settlement, rounding, and the combined cap**

One payout unit is one hundredth of the base bet: `UNIT_SCALE = 100`. Therefore 4.40x is 440 units, independently of currency denomination. `toUnits` rejects amounts that cannot be represented at that precision. The combined cap is 500,000 units, or 5,000x base bet.

For cumulative accepted units $U$, the amount paid in whole cents is

$$
C(U,B)=\left\lfloor\frac{UB+50}{100}\right\rfloor.
$$

This is nearest-cent, half-up rounding for nonnegative amounts. For each incoming award $A$, settlement accepts

$$
a=\min(A,500000-U),\qquad
\Delta C=C(U+a,B)-C(U,B).
$$

It then updates $U$ and pays only $\Delta C$. Rounding the cumulative amount makes payment invariant to how animation or feature steps partition the same award. At a 20-cent bet, an award of three units is 0.6 cents and pays one cent. A second three-unit award makes the cumulative amount 1.2 cents, still one cent, so its incremental payment is zero. Separately rounding both awards would incorrectly pay two cents.

The trigger-spin ways, trigger scatter award, all free spins, retriggers, and chosen or wheel-awarded bonus share one cap. For example, a trigger spin awarding 2x followed by a raw 6,000x bonus settles as 2x plus 4,998x. At a 100-cent base bet the gross maximum is 500,000 cents. A purchase costs 10,000 cents, so that capped purchased round has net payment 490,000 cents. Its gross cap is not 5,000 times the purchase cost.

`awardRound` owns the cumulative private ledger. The public round object is frozen, and forged or closed rounds are rejected. `closeRound` returns gross paid cents, charged cents, and their difference as net cents. `playRound` runs the real base evaluation, bonus, and this settlement sequence for simulation. Individual evaluators can return raw awards above the cap; only the shared settlement determines how much is payable.

**Randomness and fixed probabilities**

Browser outcome generation uses Web Crypto through `cryptoRand`. Bounded integer draws reject the incomplete remainder bucket before applying modulo, avoiding modulo bias. Missing or failing secure randomness raises an error rather than switching to `Math.random`. Weighted tickets, shuffles, and attack decisions use that random interface. Rendering also has decorative randomness, which does not define the weighted outcome tables.

The configuration and exported math API are recursively frozen. No outcome probability depends on wallet balance, deposits, recent wins or losses, or a desired measured RTP. Bonus state changes probabilities or awards only through the specified transitions, such as occupied Reef cells, sticky Kraken Wilds, and remaining Vault chests. Such state is part of the model. The implementation does not compensate a player's session toward an average.

Tests and simulations inject deterministic random functions, normally seeded Mulberry32. This permits replay and boundary testing; it is not a cryptographic production generator. Its finite 32-bit output mapped with `floor(rand() * range)` is also distinct from the production rejection sampler. A fixed seed with identical code and invocation is reproducible; a seed without the configuration and code version is insufficient provenance.

**What is analytic and what is estimated**

[tools/odds.js](../tools/odds.js) calculates the unmodified base and ante reel distributions by finite enumeration and probability convolution. For Pearl weight $w_r$, original reel total $T_r$, and three rows, the probability of any Pearl on reel $r$ is

$$
p_r=1-(1-w_r/T_r)^3.
$$

This follows because every draw on the no-Pearl path still uses the original weights. Let $K$ be the total Pearl count. The coefficient of $z^k$ in

$$
\prod_{r=1}^{5}\big((1-p_r)+p_r z\big)
$$

is $P(K=k)$. The trigger probability is the sum for $k=3,4,5$, and scatter expected value is $2P(K=3)+10P(K=4)+50P(K=5)$. Attack does not change Pearls, so this natural-trigger probability also applies after attack. It does not describe the separately forced purchase distribution. The ante/base trigger-probability ratio is calculated from these tables; the name Triple Chance is not a proof of an exactly threefold ratio.

For each ordinary symbol, the tool enumerates ordered outcomes within each reel, including Pearl exclusion, to obtain mean matching count $\mu_r$ and zero-match probability $q_r$. Independence between reels gives the expected ways paying at length $L$:

$$
\operatorname{E}[W_L]=
\begin{cases}
\left(\prod_{r=1}^{L}\mu_r\right)q_{L+1},&L=3,4,\\
\prod_{r=1}^{5}\mu_r,&L=5.
\end{cases}
$$

Multiplying by the appropriate paytable amount and summing over lengths and symbols gives pre-attack ways expected value. These are analytic finite-model calculations evaluated with ordinary floating-point arithmetic. They exclude attack changes, every bonus, the combined cap, and cent rounding. Their cost-normalized contribution is not whole-game RTP.

[tools/rtp-sim.js](../tools/rtp-sim.js) instead samples complete settled rounds for every requested mode and bonus choice. Its return estimate is $100\sum_i P_i/\sum_i D_i$, where $P_i$ is paid cents and $D_i$ is actual debited cents. A bonus win smaller than its purchase cost is a net loss even when it is a positive gross hit. Reports keep hit, zero-payout, net-loss, net-profit, break-even, cap-hit, trigger, and attack frequencies separate.

For a fixed-cost cell with $n$ payouts and sample standard deviation $s$, the payout mean has estimated standard error $s/\sqrt n$. The displayed two-sided interval is mean plus or minus $1.959963984540054s/\sqrt n$, converted to RTP percentage points using actual cost. Welford accumulation provides the sample variance with denominator $n-1$. Fewer than two samples cannot supply variance or an interval. The normal approximation can underrepresent uncertainty when important rare outcomes are poorly sampled; it is not certification or a convergence guarantee. Maximum observed payout is a sample statistic, while the 5,000x cap is a rule.

[tools/rtp-exact.js](../tools/rtp-exact.js) is a compatibility wrapper explicitly labeled Monte Carlo; its historical filename does not make its results exact. [tools/bonus-sim.js](../tools/bonus-sim.js) estimates conditional feature-only values by trigger Pearl count and Super status. It excludes trigger awards and purchase cost, so its mean is not RTP. Its optional prior-win units reserve cap allowance and cumulative rounding before the feature.

Saved reports include sample counts, per-cell seeds, base bet, cost, profile, command, runtime version, timestamps, and source SHA-256 fingerprints. Use those reports for measured results. No equal-value relationship among the four bonuses, common RTP across modes, or target percentage is asserted by this specification.

**Validation scope and production boundary**

The deterministic suites independently enumerate individual ways to check the optimized evaluator, exercise weight boundaries and secure rejection, verify bonus transitions and termination, test shared-cap and cumulative-cent settlement, compare analytic odds against exhaustive small models, and check known statistical moments. Seeded integration cases compare complete round settlement and stepwise bonus resolution. Passing these tests establishes the covered invariants; it does not disclose a proprietary provider distribution or establish regulatory approval.

The [provider comparison](provider-research.md) documents additive and multiplicative games, local and global multiplier scopes, ways, paylines, scatter pays, and cascades. This implementation deliberately specifies local additive multipliers on fixed ways. It does not combine incompatible rules or claim to reproduce private provider reel strips and feature weights. The [operator and standards research](operator-standards-research.md) separates mathematical correctness from deployment requirements.

This is a local browser demo. Its balance persists in editable local storage, its JavaScript runs on the user's machine, and its debug mode can expose development controls. Frozen configuration and a private settlement object prevent accidental in-process drift, but do not create an authoritative money system. Production use would require an authoritative result and wallet service, authenticated and idempotent round transactions, interruption recovery, audit and version records, appropriate RNG review, and the applicable independent testing and approval. Web Crypto and reproducible development tests alone provide neither a provably fair commitment protocol nor those operational controls.

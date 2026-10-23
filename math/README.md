**Offline Engine math**

`model.js` is the `squid-ways-3` procedural candidate model. `books.js` records complete outcomes by calling that model, including base reveals, attacks, feature state transitions, canonical Vault reveals, Wheel results, and capped totals. Books contain no monetary balance or bet amount. Integer payout units represent hundredths of the base bet. The publication is `squid-engine-2` and its event schema is 2.

Seven modes are defined in `shared/modes.js`: base Vault at 1x, Enhanced Chance Vault at 2x, Coin/Vault at 100x, Super/Reef at 250x, Legendary/Kraken at 500x, Mystery/Wheel at 185x, and a standalone six-wild spin at 50x. Three or more purple squid wilds in base or Enhanced Chance play trigger Vault. Purchased bonuses force three to five squid wilds. The six-wild purchase always contains exactly six wilds and never enters a bonus. Pearl scatters still pay cash awards and retrigger Kraken spins.

Vault interaction chooses where to display the next recorded reveal; it cannot change the recorded award. The browser must consume these events without generating new outcome randomness. Normal and bonus rounds retain the 5,000x combined-round limit. The standalone six-wild spin has a reachable 1,579.5x limit under the unchanged ways paytable.

**Generate and verify**

Run from the project root with Node.js 24.13 or later with Zstandard streams:

```text
node math/export.js --out dist/math --rounds 100000 --seed 20261023
node math/verify.js --dir dist/math --production
```

The output directory must be empty. Default generation produces 100,000 sampled rounds and one deliberate maximum witness per mode, for 700,007 books across seven modes. Each mode gets a deterministic seed derived from the supplied master seed and mode name. Books stream directly to compressed JSONL; only payouts, feature flags, and weights remain in memory. `--uncompressed` emits plain JSONL. `--preview` explicitly marks smaller development exports as nonproduction.

Upload the generated `index.json` and the event and lookup files it references. Keep `manifest.json` as release evidence. It records source hashes, exact weighting statistics, sampled statistics, feature frequencies, witness frequencies, file hashes, and sizes. Historical reports outside this directory describe the procedural reference model, not the newly weighted publication model.

**Exact weighting**

The published RTP is exactly 963/1000 of the actual mode cost before any operator monetary precision handling. Each ordinary sample starts with source weight 1000. The deliberate maximum witness starts with weight 50, so merely including a maximum does not give it the same probability as an ordinary sample. Production verification requires the final maximum-win probability to exceed one in ten million in every mode.

Outcomes are divided at the target mean payout into lower and higher payout groups. Each group receives one positive rational factor, converted to exact positive integer weights and reduced by their common divisor. This preserves relative source mass inside a group while intentionally changing the probability mass of the two groups. The resulting distribution is a finite weighted book model and is not claimed to reproduce the original procedural probabilities.

The calculation uses BigInt throughout. Verification independently requires the weighted payout sum divided by total weight and mode cost to equal 963/1000 exactly. CSV weights and their total must fit unsigned 64-bit integers. A request that cannot meet these limits fails rather than rounding the target or silently truncating weights.

**Maximum outcomes and validation**

Each maximum witness uses a fixed sequence of valid RNG selections through the model. Kraken reaches the cap through additive sticky multipliers. Reef reaches it through valid cash pearls and gold doubling. Vault reaches it through valid coin values and its multiplier. Wheel selects Kraken and follows its valid maximum sequence. The six-wild witness forms 243 Anchor ways at 6.5x per way, reaching 1,579.5x without a feature. Raw feature awards may exceed the cap; the final recorded award and Kraken incremental accepted awards obey the combined round limit.

Every generated and verified book passes both the shared frontend contract and an independent model-aware validator. The latter recomputes ways, attacks, sticky transitions, rage, retriggers, Reef landings and doubling, Vault inventory and picks, and final capped totals. CSV payouts are compared to books at the same row position. Books must be smaller than 1 MiB; files must be smaller than 4 GiB; each mode is limited to 10 million books. Production generation also requires the chosen feature and all eight Wheel branches in Wheel modes.

Verification checks hashes, source provenance, statistics, weighting factors, reachable witnesses, and mode costs. A successful local verification establishes these technical invariants. Approval and deployment remain separate operator steps.

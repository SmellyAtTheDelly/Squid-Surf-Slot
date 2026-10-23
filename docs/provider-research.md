**Provider rules and math comparison**

Researched: 2026-10-22. Scope: publicly available provider product pages, game sheets, and provider explanations. This research supports a coherent original game specification. It does not reconstruct any provider's proprietary math model or certify this project's RTP.

**The central finding**

There is no universal slot-provider payout formula. Even games from the same provider use different multiplier operators, payout scopes, and persistence rules. A multiplier can modify one winning combination, every win on the screen, a completed tumble sequence, a cash collection, or a whole bonus. The correct implementation follows the particular game's published rules, then verifies its own distribution.

**Documented multiplier models**

| Provider and game | Documented behavior | Relevance |
| --- | --- | --- |
| Pragmatic Play, Sweet Bonanza | Matching symbols pay anywhere. During free spins, multiplier symbols range from 2x to 100x and their values are added at the end of the tumble sequence. | A tumble-level additive mechanism, not an additive wild on each way. [Product page](https://www.pragmaticplay.com/en/games/sweet-bonanza-slot/) |
| Pragmatic Play, Gates of Olympus | A 6x5 pay-anywhere game. Four or more scatters trigger 15 free spins. Winning multiplier symbols add to a running feature multiplier, which applies to the respective win. | Persistent feature accumulation must not be confused with a fixed per-way multiplier. [Official game page](https://www.pragmaticplay.fun/en/slots/gates-of-olympus/) |
| Pragmatic Play, The Dog House Megaways 1000 | The product description explicitly says multiple wild multiplier values multiply together before application to the total win. Sticky and random-wild bonus modes differ. | Multiplication is a title-specific rule, not a reason to change every ways game. [Product page](https://www.pragmaticplay.com/en/games/the-dog-house-megaways-1000/) |
| Hacksaw Gaming, Wanted Dead Or a Wild | DuelReels become multiplier wild reels. Multipliers belonging to the same winning combination are added, and that sum multiplies the payline win. | Direct evidence for additive multipliers restricted to the winning combination. The game uses 15 paylines, so its evaluation geometry differs from 243 ways. [Product page](https://www.hacksawgaming.com/games/wanted-dead-or-a-wild) |
| Play'n GO, Mega Don Triple Threat | Up to 1,024 ways. Hammerhead Wild multipliers affect only wins containing a Wild; multiple multipliers in the same winning combination are added. | A documented additive combination rule in an actual ways game. [Product page](https://www.playngo.com/games/mega-don-triple-threat) |
| Play'n GO, Triple Beasts of Fortune | The base game has 1,024 payways. Its multiplier feature puts x2/x3 wilds on reels two through four. Values add when several belong to the same winning combination. | Additional confirmation that additive per-combination multipliers are a valid production design. [Provider release](https://www.playngo.com/post/triple-beasts-of-fortune) |
| NetEnt, Godbreaker | Wild multipliers anywhere on the reels multiply together, and the result applies to all bet-way wins. Wild substitution pays the highest possible combination on each way. | Both the multiplication operator and global scope differ from this project's local additive rule. [Product page](https://netent.com/games/godbreaker) |
| Nolimit City, The Crypt | Consecutive xNudge Wild multipliers are added; the provider gives x3 + x1 = x4 as its example. Wilds exclude scatters from substitution. | Another explicit additive rule. [Official game sheet](https://fan-cdn.nolimitcity.com/Nolimit_City_Game_sheet_Slots_The_Crypt_aa2081f2be.pdf) |
| Nolimit City, Nine to Five | Multiple xNudge Wild multipliers multiply together to produce the total Nudge multiplier. | The same provider and mechanic family can use a different operator. [Official game sheet](https://fan-cdn.nolimitcity.com/Nolimit_City_Game_sheet_Slots_Nine_To_Five_3b4eeeb2a9.pdf) |

These examples establish design alternatives. They do not establish the undisclosed weights of multipliers or symbols. Product descriptions also do not resolve every edge case, such as overlapping all-wild substitutions, unless they explicitly state it.

**Paylines, ways, clusters, cascades, and collections**

Ways describe which combinations qualify; cascading describes what happens after a win. They are separate choices. Big Time Gaming describes Bonanza as a Megaways game with up to 117,649 ways plus a cascading mechanism operating in two directions. That does not make a fixed 5x3 game a Megaways game. [Bonanza product page](https://www.bigtimegaming.com/games/bonanza)

Play'n GO's Tome of Madness instead matches clusters of four or more symbols on a 5x5 cascading grid. Its portal is charged by qualifying symbols and unlocks additional features. Cluster connectivity and portal progression require different evaluation and state rules from left-to-right ways. [Provider walkthrough](https://www.playngo.com/posts/tome-of-madness-walkthrough)

NetEnt's Gonzo's Quest combines paylines with Avalanche replacement and an escalating win multiplier. This is another demonstration that replacement sequences are independent of the underlying line/ways/cluster geometry. [Product page](https://netent.com/games/gonzos-quest)

Pragmatic Play's Big Bass Bonanza uses a collection feature: wilds collect visible money symbols during free spins. Three, four, or five scatters award 10, 15, or 20 spins. Every fourth collected wild retriggers additional spins and advances the multiplier through 2x, 3x, and 10x. Money-symbol collection is a separate award operation, not a reason to multiply unrelated symbol wins. [Product page](https://www.pragmaticplay.com/en/games/big-bass-bonanza/)

Relax Gaming describes Money Train 4 as scatter pays with a separate Money Cart bonus, including persistent symbols and feature interactions. Its launch documentation states that a purchased bonus starts with a guaranteed persistent symbol. Therefore, a bought feature cannot universally be assumed to have the same initial distribution as an organically triggered feature. [Product page](https://www.relax-gaming.com/products/casino/moneytrain4), [provider launch description](https://www.relax-gaming.com/news/2023/09/relax-gamings-legendary-bandits-depart-the-station-for-their-last-stand-in-money-train-4)

**Stake, purchase cost, and caps**

Nine to Five distinguishes base stake from an xBet charge: xBet adds 10% to the cost while symbol payouts stay unchanged. Its bonus purchases cost 75x, 200x, or 1,370x base bet, and its maximum round award is 9,217x base bet. Exceeding that limit ends the round and pays the cap. Those are separate units: purchase cost is not automatically the payout denomination. [Official game sheet](https://fan-cdn.nolimitcity.com/Nolimit_City_Game_sheet_Slots_Nine_To_Five_3b4eeeb2a9.pdf)

The Crypt similarly specifies a 3x base-bet xBet charge, purchases at 100x/200x/500x base bet, and a 27,000x base-bet round cap. Its sheet explicitly ends the round when the limit is exceeded. [Official game sheet](https://fan-cdn.nolimitcity.com/Nolimit_City_Game_sheet_Slots_The_Crypt_aa2081f2be.pdf)

Big Time Gaming's Pop lists a purchase of 12 free spins for 90 times stake. This supplies another concrete example of feature cost expressed as a multiple of the underlying stake. [Official fact sheet](https://clientarea.evolution.com/big-time-gaming/wp-content/nfs-uploads/uploads/cdn/3b559dc1298addba63d80c97af8781fd/Pop_ShortFactSheet.pdf)

For this project, keep distinct values for base bet, debited cost, outcome multipliers, and remaining round-cap allowance. The expected return for a purchased feature must be divided by the purchase cost, while its prize and cap calculations must use the game's declared base stake. This is a mathematical recommendation based on the documented unit distinctions, not a claim about every provider.

**RTP, variance, and evidence quality**

Wanted Dead Or a Wild publishes several RTP configurations: 96.38%, 94.55%, 92.33%, and 88.42%, alongside a 12,500x maximum and a 4/5 volatility rating. A game title alone therefore does not identify the deployed RTP configuration. [Product page](https://www.hacksawgaming.com/games/wanted-dead-or-a-wild)

Nine to Five publishes separate base-game and bonus contributions of 63.08% and 32.95%, together giving the 96.03% standard total. These contributions are not the conditional return from purchasing a bonus. Its reported frequency figures are configuration-specific. [Official game sheet](https://fan-cdn.nolimitcity.com/Nolimit_City_Game_sheet_Slots_Nine_To_Five_3b4eeeb2a9.pdf)

Pragmatic Play distinguishes long-run RTP from a session result and from maximum win. It also notes that high volatility does not necessarily make the maximum more likely. A maximum, average return, hit frequency, and variance describe different properties. [Provider explanation](https://www.pragmaticplay.fun/en/how-to/faqs/rtp-vs-max-win/)

Marketing pages are useful evidence but are not complete math specifications. For example, the current Gates page labels volatility medium, while the original provider release describes it as highly volatile. Do not interpret informal ratings as comparable measured variance, and prefer the actual rules and configuration identifier when numbers conflict. [Current page](https://www.pragmaticplay.fun/en/slots/gates-of-olympus/), [original release](https://www.pragmaticplay.com/en/news/pragmatic-play-aims-for-the-heavens-in-gates-of-olympus/)

The reviewed sources do not disclose complete reel strips, symbol weights by state, multiplier probability tables, feature transition distributions, or reproducible certification models. Published RTP and maximum payout cannot uniquely determine those private distributions. Matching a headline RTP does not reproduce a provider's game or prove equivalent volatility.

**Randomness and persistent state**

Pragmatic Play explains that RNG results are not influenced by previous spins. This supports avoiding loss-dependent or balance-dependent outcome adjustment. It does not remove explicitly disclosed feature state such as sticky wilds or collected bonus multipliers. [Provider RNG explanation](https://www.pragmaticplay.fun/en/how-to/faqs/what-is-rng-and-how-does-it-work/)

Godbreaker explicitly says its pot accumulation is visual and does not influence random bonus triggering. Mega Don Triple Threat says the same about its collection meters. Conversely, Red Tiger's London Tube stores golden frames and activates its train feature every tenth spin when frames exist. Persistent state must be classified according to the specific rules rather than assumed cosmetic or assumed predictive. [Godbreaker](https://netent.com/games/godbreaker), [Mega Don](https://www.playngo.com/games/mega-don-triple-threat), [London Tube](https://redtiger.com/games/london-tube)

**Recommendation for Squid Surf Slot**

Preserve the fixed 243-ways design and additive multipliers on each individual winning way. This is coherent with the documented additive ways examples above. State explicitly that a way with no multiplier wild pays at x1, that only multiplier wilds participating in that way contribute, and that scatter awards follow their own rule. Do not combine global NetEnt multipliers, Sweet Bonanza tumble aggregation, and additive wild contributions into one calculation.

Verify evaluation against an independent explicit enumeration of individual ways, including multiple matching symbols on one reel, mixed regular and multiplier wilds, longest-run selection, and separate scatter awards. Test base stake versus purchase cost, combined round caps, and each bonus state transition. Measure normal play, enhanced bets, and purchases separately, with sample sizes and uncertainty reported. Use this project's documented rules and measured results as the authority for its behavior.

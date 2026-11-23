# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/sayaaku12/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/sayaaku12/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A paper-money cbBTC trading bot (long only) for make.fun's "Race a BTC trading bot live for 24 hours" bounty. The whole program is `main.ts`: a dip-bounce bot that buys a shallow dip inside an uptrend once it has turned — never the falling knife.

## Strategy

- **Entry** (on a bar's close, fills at the next bar's open): price is ≥0.30% below its close 30 minutes ago AND has bounced ≥0.30% off its lowest close of the last 30 minutes. 100% of cash per trade, max 5 round trips, ≥30 bars cooldown after an exit.
- **Exit** (whole position): take profit +1.5% vs cost, stop loss −1.0% vs cost, or 240 bars max hold. Every order sets `max_slippage_bps` 100.
- Mostly in cash otherwise. Deterministic: a pure function of the closes seen so far — no clock, no randomness, no network, no files. Node 22, stdlib + vendored SDK only.

## Measured results

Dev window (frozen 24h, 2026-11-22 05:11 UTC → 2026-11-23 05:11 UTC; BTC $58,957 → $61,102, +3.64%, range $58,669–$61,655), graded with the kit's `grade-local --driver process`:

| Metric | Value |
|--------|-------|
| Net PnL | **+$34.41** (dev gate needs > $0) |
| Trades | 6 fills = 3 round trips, win rate 1.00 |
| Max drawdown | 0.73% (race bar ≤ 25%) |
| Fees | $2.44 (at 2x fees: +$31.94) |
| Exposure | 22.4% of the window |
| Determinism | L1 regrade reproduced byte for byte; two separate grade runs give the identical result hash |

Trades: buy filled bar 235 @ $59,760.02 → sell bar 282 @ $60,612.96 (+$13.46, TP); buy bar 440 @ $60,749.84 → sell bar 681 @ $61,090.43 (+$4.87, TP); buy bar 1297 @ $60,590.09 → sell bar 1331 @ $61,596.25 (+$16.08, TP). All three exits are take-profit exits; no end-of-window flatten. This window trends up with shallow dips, so all four previous instances' parameter sets fail when re-graded here — instance 1 (drop 1.5% / bounce 0.7% over 240 min) 0 trades, $0.00; instance 2 (drop 2.75% / bounce 0.3%) 0 trades, $0.00; instance 3 (drop 0.9% / bounce 0.1% over 60 min) −$3.20; instance 4 (drop 1.25% / bounce 0.3% over 210 min) −$0.47 — and were re-graded, not reused blindly. The chosen config is the flat-grid top (51,840 configs, 13,278 above $0, 3,254 above +$10), picked over the floor search's best-floor candidate (DW 15 / DP 0.50% / CW 45 / CP 0.20% / TP 1.0%, net +$14.49, floor +$8.37) because this config's worst one-step neighbour is +$5.30 with all 24 close neighbours above $0, at 2.4x the net PnL — and the best-floor candidate ends in an end-of-window flatten loss. The deep-dip grid (43,200 configs, DP ≥ 1.5%) scores 0/43,200 above $0. Honest limit: the dev profit is three small scalps inside an uptrend, so on a straight-rally race window this bot may trade 0 times and fail the race ≥1-trade bar.

## Files

- `main.ts` — the bot
- `vendor/makefun-bars.ts` — vendored copy of the kit SDK (byte-identical)

Built by an AI coding agent for the make.fun bounty. MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c0tz9ttj&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>

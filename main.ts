// Dip-bounce bot for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261123-0511). Long only, $1,000 paper, cbBTC 1-minute bars.
//
// THIS instance's dev window (2026-11-22 05:11 UTC -> 2026-11-23 05:11 UTC,
// BTC $58,956.59 -> $61,102.18, +3.64%) is an UP-TRENDING window, not the
// down-trending window of instance 4 or the flat window of instance 3:
// an early dip to the window low $58,668.92 (bar 34), then a steady climb
// to ~$61,000 with a mid-window plateau around $60,600-$61,100, and the
// window high $61,654.69 at bar 1333. The dips are SHALLOW: worst 60-min
// move -1.34% (bar 486), worst 240-min -1.22%, worst 480-min -1.53%.
// Only 10 bars in the whole window have a 60-min drop >= 0.90%, and none
// have a 240-min drop >= 1.50%. All four old parameter sets FAIL here
// when re-graded on this window (exact-fill simulator):
//   instance 1 (drop 1.5% / bounce 0.7% over 240 min): 0 trades, $0.00
//   instance 2 (drop 2.75% / bounce 0.3% over 240 min): 0 trades, $0.00
//   instance 3 (drop 0.9% / bounce 0.1% over 60 min): -$3.20, 1 RT, 0 wins
//   instance 4 (drop 1.25% / bounce 0.3% over 210 min): -$0.47, 1 RT, 0 wins
// So the bot must scalp the small half-hour dips inside the uptrend,
// not wait for a deep waterfall that never comes.
//
// Chosen config (from a 51,840-config flat grid + a 3,840-candidate
// floor search over the shallow-dip region, exact-fill simulator):
//   buy when price is >= 0.30% below its close 30 minutes ago AND has
//   bounced >= 0.30% off its lowest close of the last 30 minutes;
//   sell at +1.5% take profit, -1.0% stop loss, or after 240 bars held.
//   100% of cash per trade, max 5 round trips, >= 30 bars cooldown.
// The config was picked as the grid TOP, not just for its floor: the
// floor search's best-floor candidate (DW 15 / DP 0.50% / CW 45 /
// CP 0.20% / TP 1.0%, net +$14.49, floor +$8.37) ends in an
// end-of-window flatten loss, while this config's worst one-step
// neighbour is +$5.30 and all 24 one-step neighbours stay above $0
// (floor +$5.30, 24/24 positive) at 2.4x the net PnL. The deep-dip
// grid (43,200 configs, DP >= 1.5%) scores 0/43,200 above $0 — the
// deep-dip region is dead on this window.
//
// Sim numbers (exact-fill simulator, calibrated to grade-local to the
// cent on instances 2-4): net +$34.41, 6 fills = 3 round trips, 3 wins,
// fees $2.44, max drawdown 0.73%, exposure 22.4%.
// Trades: buy filled bar 235 @ $59,760.02 -> sell bar 282 @ $60,612.96
// (+$13.46, TP); buy bar 440 @ $60,749.84 -> sell bar 681 @ $61,090.43
// (+$4.87, TP); buy bar 1297 @ $60,590.09 -> sell bar 1331 @ $61,596.25
// (+$16.08, TP). All three exits are take-profit exits; no
// end-of-window flatten.
//
// Verified with grade-local (--driver process, same as server dev
// grading): net PnL +$34.409869, 6 trades, win rate 1.00, max drawdown
// 0.7266%, exposure 22.36%, Sharpe 0.0535, Sortino 0.0976, fees
// $2.439689 (at 2x fees still +$31.936782), 0 rejected, constraints
// compliant (trades_ok, drawdown_ok). L1 regrade reproduced byte for
// byte; a second grade-local run gives the identical result_sha256 and
// action_log_sha256. The grade matches the simulator to the cent, and
// the action log matches the simulator's trade list bar for bar (orders
// decided bars 234/281/439/680/1296/1330, filled 235/282/440/681/1297/
// 1331). A pass-2 structural refactor (strategy encapsulated in a
// DipBounce class, fill handling and the pure decide() split out of
// onBatch) re-graded to the identical action log, proving the refactor
// is behaviour-preserving. The final result_sha256 is recorded in
// NOTES.md: it changes with every edit to this file, so it is not
// written here. (Process driver, node v24.22.1 on this VM vs server
// v26.13.1 — the server's hash will differ in the harness-version note
// only.)
//
// Honest limits: the race window is a different, unseen 24h. This bot's
// dev profit is three small scalps inside an uptrend. On a ranging race
// window it may trade a few times; on a straight rally it may trade 0
// times (no >= 0.30% dip over 30 min with a >= 0.30% bounce) and fail
// the race >= 1-trade bar; on a waterfall it buys dips and stops out at
// -1% each (max 5 round trips, worst case ~-$55, max DD ~5.5%, still
// inside the 25% race bar). The failure mode of a too-tight trigger is
// $0.00 (no trade), not a loss. This is a free lottery ticket for a
// top-10 slot, not a reliable payout. Nothing about the dev window
// predicts the race window's shape.
//
// Deterministic: pure function of the closes seen so far; no clock, no
// randomness, no network, no files. Stdlib + vendored SDK only.

import { runBars, type BarsState, type Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DROP_WINDOW = 30; // minutes of history the drop is measured over
const DROP_PCT = 0.003; // entry needs a >= 0.30% drop over DROP_WINDOW
const CONFIRM_WINDOW = 30; // minutes of history the bounce low is measured over
const CONFIRM_PCT = 0.003; // entry needs a >= 0.30% bounce off that low
const TAKE_PROFIT = 0.015;
const STOP_LOSS = 0.01;
const MAX_HOLD_BARS = 240;
const MAX_TRADES = 5;
const COOLDOWN_BARS = 30;
const MAX_SLIPPAGE_BPS = 100;

type Order =
  | { side: 'buy'; symbol: string; notional_quote_units: bigint; max_slippage_bps: number }
  | { side: 'sell'; symbol: string; qty: bigint; max_slippage_bps: number };

type Held = { qty: bigint; cost: bigint };

// The whole strategy lives in one small state machine so the runBars
// callback below is just wiring: feed bars, feed fills, ask for an
// order. Nothing in here touches the clock, the network, or files.
class DipBounce {
  private closes: number[] = [];
  private entrySeq = -1;
  private buys = 0;
  private lastExitSeq = -1_000_000;

  onClose(close: number): void {
    this.closes.push(close);
  }

  // Lowest close over the last `n` bars seen (inclusive of the current
  // bar, which is already in this.closes when this runs).
  private rollingLow(n: number): number {
    let lo = Infinity;
    for (let i = Math.max(0, this.closes.length - n); i < this.closes.length; i++) {
      if (this.closes[i] < lo) lo = this.closes[i];
    }
    return lo;
  }

  // Entry gate as one predicate: trade budget left, cooldown elapsed,
  // enough history, then the dip + bounce conditions on the closes.
  private canEnter(state: BarsState): boolean {
    if (this.buys >= MAX_TRADES) return false;
    if (state.seq - this.lastExitSeq < COOLDOWN_BARS) return false;
    if (this.closes.length <= DROP_WINDOW) return false;
    const now = this.closes[this.closes.length - 1];
    if (now / this.closes[this.closes.length - 1 - DROP_WINDOW] - 1 > -DROP_PCT) return false;
    if (now / this.rollingLow(CONFIRM_WINDOW) - 1 < CONFIRM_PCT) return false;
    if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return false;
    return true;
  }

  // Exit gate: take profit, stop loss, or max hold, on value vs cost.
  // A zero-quantity position can never be exited (defensive: the
  // harness should never surface one, but a divide-by-zero cost would
  // be worse).
  private shouldExit(state: BarsState, held: Held): boolean {
    if (held.qty === 0n || held.cost === 0n) return false;
    const value = state.value(SYMBOL, held.qty);
    const ret = Number(value) / Number(held.cost) - 1;
    return ret >= TAKE_PROFIT || ret <= -STOP_LOSS || state.seq - this.entrySeq >= MAX_HOLD_BARS;
  }

  // Observe fills decided on the previous bar. Only a filled buy counts
  // against the trade budget and starts the hold clock; a rejected buy
  // leaves both untouched so the gate can retry on the next bar.
  onFill(fill: Batch['fills'][number], seq: number): void {
    if (fill.symbol !== SYMBOL) return;
    if (fill.side === 'buy' && fill.status === 'filled') {
      this.buys++;
      // The hold clock starts at the fill's bar (seq), not at the bar
      // the position first appears in: the fill is reported in the
      // batch of the bar it filled on, so this matches the simulator's
      // entrySeq exactly and MAX_HOLD counts held bars, not decisions.
      this.entrySeq = seq;
    }
    if (fill.side === 'sell' && fill.status === 'filled') this.lastExitSeq = seq;
  }

  // The decision for one bar: entry when flat and the gate passes,
  // exit of the whole position when the gate fires, nothing otherwise.
  decide(state: BarsState): Order | null {
    const held = state.positions.get(SYMBOL);
    if (held === undefined) {
      // Entry: shallow dip + confirmed bounce, 100% of cash per trade.
      if (!this.canEnter(state)) return null;
      return { side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
    }
    // Exit: whole position when the exit gate fires.
    if (this.shouldExit(state, held)) {
      return { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
    }
    return null;
  }
}

const bot = new DipBounce();

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    if (state.warmingUp) return [];
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) bot.onClose(Number(bar.c) / 1e5);
    }
    if (!batch.bars.some((b) => b.symbol === SYMBOL)) return [];

    for (const fill of batch.fills) bot.onFill(fill, state.seq);
    const order = bot.decide(state);
    return order === null ? [] : [order];
  },
});

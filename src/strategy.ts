// The trading rules. Backtest and live mode both call this, so paper results
// match backtest logic exactly. Swap in your own strategy by editing decide().

import { Candle } from "./market.js";
import { Config } from "./config.js";
import { ema, rsi } from "./indicators.js";

export type Action =
  | { type: "BUY"; reason: string }
  | { type: "SELL"; reason: string }
  | { type: "HOLD"; reason: string };

export interface PositionView {
  inPosition: boolean;
  entryPriceUsdt: number;
}

export interface Indicators {
  emaFast: number[];
  emaSlow: number[];
  rsi: number[];
}

export function computeIndicators(candles: Candle[], cfg: Config): Indicators {
  const closes = candles.map((c) => c.close);
  return {
    emaFast: ema(closes, cfg.emaFast),
    emaSlow: ema(closes, cfg.emaSlow),
    rsi: rsi(closes, cfg.rsiPeriod),
  };
}

/** Decide what to do at candle index i (the most recent closed candle being considered). */
export function decide(i: number, candles: Candle[], ind: Indicators, pos: PositionView, cfg: Config): Action {
  if (i < 1) return { type: "HOLD", reason: "warming up" };
  const f = ind.emaFast[i], s = ind.emaSlow[i], fPrev = ind.emaFast[i - 1], sPrev = ind.emaSlow[i - 1], r = ind.rsi[i];
  if ([f, s, fPrev, sPrev, r].some(Number.isNaN)) return { type: "HOLD", reason: "warming up" };

  const price = candles[i].close;

  if (pos.inPosition) {
    const change = price / pos.entryPriceUsdt - 1;
    if (change <= -cfg.stopLossPct) return { type: "SELL", reason: `stop-loss (${(change * 100).toFixed(2)}%)` };
    if (change >= cfg.takeProfitPct) return { type: "SELL", reason: `take-profit (+${(change * 100).toFixed(2)}%)` };
    if (fPrev >= sPrev && f < s) return { type: "SELL", reason: "EMA bearish cross" };
    return { type: "HOLD", reason: "holding position" };
  }

  if (fPrev <= sPrev && f > s) {
    if (r >= cfg.rsiMaxToBuy) return { type: "HOLD", reason: `bullish cross skipped, RSI ${r.toFixed(1)} too high` };
    return { type: "BUY", reason: `EMA bullish cross, RSI ${r.toFixed(1)}` };
  }
  return { type: "HOLD", reason: "no signal" };
}

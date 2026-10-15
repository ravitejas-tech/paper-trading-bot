// Runs the strategy over a list of candles. Pure function: no network, no files.

import { Candle } from "./market.js";
import { Config } from "./config.js";
import { PaperBroker } from "./paperBroker.js";
import { EquityPoint } from "./stats.js";
import { computeIndicators, decide } from "./strategy.js";

export function runBacktest(candles: Candle[], cfg: Config) {
  const broker = new PaperBroker(cfg);
  const ind = computeIndicators(candles, cfg);
  const equity: EquityPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const action = decide(i, candles, ind, { inPosition: broker.inPosition, entryPriceUsdt: broker.state.entryPriceUsdt }, cfg);
    if (action.type === "BUY") broker.buy(c.close, c.closeTime, action.reason);
    else if (action.type === "SELL") broker.sell(c.close, c.closeTime, action.reason);
    equity.push({ time: new Date(c.closeTime).toISOString(), priceUsdt: c.close, equityInr: broker.equityInr(c.close) });
  }

  return { broker, equity };
}

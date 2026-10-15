// One step of the live paper-trading session: fetch new closed candles, act on them,
// log, save. Used by both `npm run live` (loops forever) and `npm run tick` (runs once,
// for GitHub Actions).

import { config } from "./config.js";
import { fetchRecentCandles, intervalToMs, lastSource } from "./market.js";
import { PaperBroker } from "./paperBroker.js";
import { writeDashboardJson } from "./site.js";
import { computeIndicators, decide } from "./strategy.js";
import { Storage } from "./storage.js";

const inr = (x: number) => `₹${x.toFixed(2)}`;
const stamp = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export class LiveSession {
  storage = new Storage(config.dataDir);
  broker: PaperBroker;
  lastCandleTime: number;
  lastAction = "";
  lastPrice = 0;

  constructor() {
    const saved = this.storage.loadState();
    this.broker = new PaperBroker(config, saved?.broker);
    this.lastCandleTime = saved?.lastCandleTime ?? 0;
    this.lastAction = saved?.lastAction ?? "";
    console.log(`Paper bot: ${config.symbol} @ ${config.interval}. ${saved ? "Resuming saved session." : "New session."}`);
  }

  async tick() {
    const candles = await fetchRecentCandles(config.symbol, config.interval, 200);
    const latest = candles[candles.length - 1];
    this.lastPrice = latest.close;
    if (latest.openTime <= this.lastCandleTime) console.log(`[${stamp()}] No new candle yet (BTC $${latest.close.toFixed(2)}).`);

    // First run: start from the latest candle instead of trading on old history.
    if (this.lastCandleTime === 0) {
      this.lastCandleTime = latest.openTime;
      this.lastAction = "Started with " + inr(this.broker.state.cashInr);
      this.storage.logEquity({
        time: new Date(latest.closeTime).toISOString(),
        priceUsdt: latest.close,
        equityInr: this.broker.equityInr(latest.close),
      });
      this.save();
      console.log(`[${stamp()}] Started fresh with ${inr(this.broker.state.cashInr)} (data: ${lastSource}).`);
      return;
    }

    const ind = computeIndicators(candles, config);
    const lateLimit = Date.now() - config.maxLateCandles * intervalToMs(config.interval);

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.openTime <= this.lastCandleTime) continue;

      // Candles that closed while the bot was off: it couldn't have traded them, so only track equity.
      const missed = c.closeTime < lateLimit;
      const pos = { inPosition: this.broker.inPosition, entryPriceUsdt: this.broker.state.entryPriceUsdt };
      const action = missed ? ({ type: "HOLD", reason: "missed while offline" } as const) : decide(i, candles, ind, pos, config);
      const trade =
        action.type === "BUY" ? this.broker.buy(c.close, c.closeTime, action.reason)
        : action.type === "SELL" ? this.broker.sell(c.close, c.closeTime, action.reason)
        : null;

      const equity = this.broker.equityInr(c.close);
      this.storage.logEquity({ time: new Date(c.closeTime).toISOString(), priceUsdt: c.close, equityInr: equity });
      this.lastCandleTime = c.openTime;

      if (trade) {
        this.storage.logTrade(trade);
        const pnl = trade.pnlInr !== null ? `  P&L ${trade.pnlInr >= 0 ? "+" : ""}${inr(trade.pnlInr)}` : "";
        this.lastAction = `${trade.side} @ $${trade.priceUsdt.toFixed(2)} (${trade.reason})`;
        console.log(`[${stamp()}] ${this.lastAction}${pnl}`);
      } else {
        this.lastAction = `HOLD · ${action.reason}`;
        const change = (equity / config.startingCapitalInr - 1) * 100;
        console.log(
          `[${stamp()}] $${c.close.toFixed(2)}  equity ${inr(equity)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)  ` +
            `${this.broker.inPosition ? "IN POSITION" : "flat"}  · ${action.reason}`,
        );
      }
    }
    this.save();
  }

  save(status = "ok") {
    this.storage.saveState(this.broker.state, this.lastCandleTime, this.lastAction);
    writeDashboardJson("live", this.broker.state.trades, this.storage.readEquity(), this.broker.state.totalTdsInr, config, {
      source: lastSource,
      inPosition: this.broker.inPosition,
      entryPriceUsdt: this.broker.state.entryPriceUsdt,
      lastPriceUsdt: this.lastPrice,
      lastAction: this.lastAction,
      status,
    });
  }
}

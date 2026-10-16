// One step of the live paper-trading session: fetch the latest daily candles and the current
// price, act on any new decision at that price, log, save. Used by both `npm run live`
// (loops on your computer) and `npm run tick` (runs once, for GitHub Actions).

import { coinOf, config, costsOf } from "./config.js";
import { fetchPrice, fetchRecentCandles, lastSource, toBar } from "./market.js";
import { latestDecision, nextCheck, ruleFromConfig, sessionKey } from "./rules.js";
import { writeDashboardJson } from "./site.js";
import { computeStats, EquityPoint, toTrade, Trade } from "./stats.js";
import { Storage } from "./storage.js";
import { Wallet, WalletState } from "./wallet.js";

const DAY = 86_400_000;
export const VERSION = 2;

export interface SavedState {
  version: number;
  session: string;        // rule + coin; changing either starts a new session
  startedAt: number;      // ms; 0 until the first successful check
  startPriceUsdt: number; // price at the start, for the buy & hold comparison
  lastCandleTime: number; // open time of the newest daily candle already acted on
  wallet: WalletState;
  trades: Trade[];
  lastAction: string;
}

const inr = (x: number) => `₹${x.toFixed(2)}`;
const usd = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 4 : 2 });
const stamp = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export class LiveSession {
  storage = new Storage(config.dataDir);
  rule = ruleFromConfig(config);
  costs = costsOf(config);
  coin = coinOf(config.symbol);
  st: SavedState;
  wallet: Wallet;
  lastPrice = 0;
  triggerUsdt?: number;

  constructor() {
    const saved = this.storage.loadState<SavedState>();
    const key = sessionKey(config);
    const resume = saved?.version === VERSION && saved.session === key;
    if (saved && !resume) {
      const where = this.storage.archive();
      console.log(`Settings changed (${saved.session ?? "old 15-minute bot"} → ${key}). Previous session archived to ${where}.`);
    }
    this.st = resume ? saved : {
      version: VERSION, session: key, startedAt: 0, startPriceUsdt: 0, lastCandleTime: 0,
      wallet: new Wallet(this.costs, config.startingCapitalInr).s, trades: [], lastAction: "",
    };
    this.wallet = new Wallet(this.costs, this.st.wallet);
    console.log(`Paper bot: ${this.coin}, ${this.rule.name}. ${resume ? "Resuming saved session." : "New session."}`);
  }

  /** Value of buying once at the session's start price and holding, after the same costs and tax. */
  holdValue(priceUsdt: number): number {
    if (!this.st.startPriceUsdt) return config.startingCapitalInr;
    const w = new Wallet(this.costs, config.startingCapitalInr);
    w.buy(this.st.startPriceUsdt * config.usdtToInr, this.st.startedAt);
    return w.value(priceUsdt * config.usdtToInr);
  }

  async tick() {
    const candles = await fetchRecentCandles(config.symbol, "1d", this.rule.warmupDays + 60);
    const price = await fetchPrice(config.symbol);
    const now = Date.now();
    const bars = candles.map((c) => toBar(c));
    const newest = bars[bars.length - 1];
    const priceInr = price * config.usdtToInr;
    const st = this.st;
    this.lastPrice = price;

    if (!st.startedAt) {
      st.startedAt = now;
      st.startPriceUsdt = price;
      st.lastCandleTime = newest.t - DAY; // so the latest closed candle is acted on right away
      st.lastAction = `Started with ${inr(config.startingCapitalInr)}`;
      console.log(`[${stamp()}] Started fresh with ${inr(config.startingCapitalInr)} (data: ${lastSource}).`);
    }

    // 1 Aug after each financial year: TDS refunded, tax on that year's winning sales paid.
    for (const s of this.wallet.settle(now)) {
      st.lastAction = `Tax year ${s.fy}-${String((s.fy + 1) % 100).padStart(2, "0")} settled: TDS ${inr(s.tds)} refunded, tax ${inr(s.tax)} paid`;
      console.log(`[${stamp()}] ${st.lastAction}`);
    }

    // Act on every daily candle that closed since the last run; trade at the price now.
    const logic = this.rule.make(bars);
    const d = latestDecision(logic, bars, st.lastCandleTime, this.wallet.inPosition);
    if (newest.t > st.lastCandleTime) st.lastCandleTime = newest.t;
    if (d.at !== null) {
      const reason = logic.explain(d.at);
      const fill = d.hold === this.wallet.inPosition ? null : d.hold ? this.wallet.buy(priceInr, now) : this.wallet.sell(priceInr, now);
      if (fill) {
        const t = toTrade(fill, config.usdtToInr, reason);
        st.trades.push(t);
        this.storage.logTrade(t);
        const gain = t.gainInr !== null ? `  gain ${t.gainInr >= 0 ? "+" : ""}${inr(t.gainInr)} before tax` : "";
        st.lastAction = `${t.side} @ ${usd(t.priceUsdt)} (${reason})`;
        console.log(`[${stamp()}] ${st.lastAction}${gain}`);
      } else {
        st.lastAction = `${this.wallet.inPosition ? `Holding ${this.coin}` : "In cash"} · ${reason}`;
        console.log(`[${stamp()}] ${st.lastAction}`);
      }
    } else {
      console.log(`[${stamp()}] No new decision (next check ${new Date(nextCheck(this.rule, now)).toISOString()}).`);
    }

    this.triggerUsdt = this.rule.trigger?.(bars, nextCheck(this.rule, now) - DAY) ?? undefined;

    const point: EquityPoint = {
      time: new Date(now).toISOString(),
      priceUsdt: price,
      valueInr: this.wallet.value(priceInr),
      holdInr: this.holdValue(price),
    };
    this.storage.logEquity(point);
    const change = (point.valueInr / config.startingCapitalInr - 1) * 100;
    console.log(
      `[${stamp()}] ${this.coin} ${usd(price)}  value ${inr(point.valueInr)} after tax (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)  ` +
        `${this.wallet.inPosition ? "IN POSITION" : "in cash"}  · buy & hold ${inr(point.holdInr)}`,
    );
    this.save();
  }

  save(status = "ok") {
    this.storage.saveState(this.st);
    const equity = this.storage.readEquity();
    const price = this.lastPrice || equity[equity.length - 1]?.priceUsdt || 0;
    const stats = computeStats(this.st.trades, equity, config, this.wallet, price * config.usdtToInr);
    writeDashboardJson("live", this.rule, this.st.trades, equity, stats, config, {
      source: lastSource,
      inPosition: this.wallet.inPosition,
      entryPriceUsdt: this.wallet.s.entryPrice / config.usdtToInr,
      lastPriceUsdt: price,
      lastAction: this.st.lastAction,
      status,
      nextCheck: nextCheck(this.rule, Date.now()),
      triggerUsdt: this.triggerUsdt,
    });
  }
}

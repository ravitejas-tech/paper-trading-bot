// npm run backtest   → test the live rule on daily candles since config.backtestFrom, with the
// same engine and costs as the research lab (decide at a day's close, fill at the next open).

import { coinOf, config, costsOf } from "./config.js";
import { fetchHistory, lastSource, toBar } from "./market.js";
import { simulate } from "./research/sim.js";
import { ruleFromConfig, toDecider } from "./rules.js";
import { writeDashboardJson } from "./site.js";
import { computeStats, EquityPoint, summarize, toTrade } from "./stats.js";
import { Storage } from "./storage.js";
import { Wallet } from "./wallet.js";

const DAY = 86_400_000;

async function main() {
  const rule = ruleFromConfig(config);
  const costs = costsOf(config), rate = config.usdtToInr, start = config.startingCapitalInr;
  const from = Date.parse(config.backtestFrom);

  console.log(`Downloading ${coinOf(config.symbol)} daily candles since ${config.backtestFrom} (plus warm-up)...`);
  const candles = await fetchHistory(config.symbol, "1d", from - (rule.warmupDays + 10) * DAY, Date.now());
  console.log(`Got ${candles.length} candles from ${lastSource}. Running "${rule.name}"...\n`);

  const usdBars = candles.map((c) => toBar(c));        // the rule decides on USDT prices
  const inrBars = candles.map((c) => toBar(c, rate));  // the wallet counts INR
  const times = usdBars.map((b) => b.t);
  const logic = rule.make(usdBars);
  const sim = simulate([inrBars], times, toDecider(logic), costs, start, from);
  const holdSim = simulate([inrBars], times, () => 0, costs, start, from);

  const k0 = times.findIndex((t) => t >= from);
  const equity: EquityPoint[] = [
    { time: new Date(times[k0]).toISOString(), priceUsdt: usdBars[k0].open, valueInr: start, holdInr: start },
    ...times.slice(k0).map((t, j) => ({
      time: new Date(t + DAY - 1).toISOString(),
      priceUsdt: usdBars[k0 + j].close,
      valueInr: sim.values[k0 + j],
      holdInr: holdSim.values[k0 + j],
    })),
  ];
  // A fill at day i's open was decided at day i-1's close.
  const trades = sim.fills.map((f) => toTrade(f, rate, logic.explain(times.indexOf(f.time) - 1)));

  const last = usdBars[usdBars.length - 1];
  const wallet = new Wallet(costs, sim.wallet);
  const stats = computeStats(trades, equity, config, wallet, last.close * rate);
  const report = summarize(stats, config, rule.name);

  const storage = new Storage(config.dataDir);
  storage.writeAll("backtest_", trades, equity);
  storage.writeText("backtest_report.txt", report + "\n");
  writeDashboardJson("backtest", rule, trades, equity, stats, config, {
    source: lastSource,
    status: `since ${new Date(from).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`,
    inPosition: wallet.inPosition,
    entryPriceUsdt: wallet.s.entryPrice / rate,
    lastPriceUsdt: last.close,
  });

  console.log(report);
  console.log(`\nSaved: ${config.dataDir}/backtest_trades.csv, backtest_equity.csv, backtest_report.txt`);
}

main().catch((err) => {
  console.error("Backtest failed:", err.message ?? err);
  process.exit(1);
});

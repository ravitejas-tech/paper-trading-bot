// npm run backtest            → test the strategy on the last N days (config.backtestDays)
// npm run backtest -- 180     → test on the last 180 days

import { fetchHistory, lastSource } from "./market.js";
import { config } from "./config.js";
import { runBacktest } from "./engine.js";
import { summarize } from "./stats.js";
import { writeDashboardJson } from "./site.js";
import { Storage } from "./storage.js";

async function main() {
  const days = Number(process.argv[2]) || config.backtestDays;
  const end = Date.now();
  const start = end - days * 86_400_000;

  console.log(`Downloading ${days} days of ${config.symbol} ${config.interval} candles from Binance...`);
  const candles = await fetchHistory(config.symbol, config.interval, start, end);
  console.log(`Got ${candles.length} candles from ${lastSource}. Running strategy...\n`);

  const { broker, equity } = runBacktest(candles, config);
  const report = summarize(broker.state.trades, equity, config, broker.state.totalTdsInr);

  const storage = new Storage(config.dataDir);
  storage.writeAll("backtest_", broker.state.trades, equity);
  storage.writeText("backtest_report.txt", report + "\n");
  writeDashboardJson("backtest", broker.state.trades, equity, broker.state.totalTdsInr, config, { source: lastSource, status: `${days}-day backtest` });

  console.log(report);
  console.log(`\nSaved: ${config.dataDir}/backtest_trades.csv, backtest_equity.csv, backtest_report.txt`);
}

main().catch((err) => {
  console.error("Backtest failed:", err.message ?? err);
  process.exit(1);
});

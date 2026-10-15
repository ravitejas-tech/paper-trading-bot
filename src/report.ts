// npm run report   → performance summary of the live paper-trading session so far.

import { config } from "./config.js";
import { summarize } from "./stats.js";
import { Storage } from "./storage.js";

const storage = new Storage(config.dataDir);
const state = storage.loadState();
const equity = storage.readEquity();

if (!state || equity.length === 0) {
  console.log('No live session data yet. Start one with "npm run live" and let it run for a while.');
  process.exit(0);
}

const report = summarize(state.broker.trades, equity, config, state.broker.totalTdsInr);
storage.writeText("live_report.txt", report + "\n");
console.log(report);
console.log(`\nOpen position: ${state.broker.qty > 0 ? `yes, entered at $${state.broker.entryPriceUsdt.toFixed(2)}` : "no"}`);
console.log(`Data: ${config.dataDir}/trades.csv, equity.csv (open in Excel or Google Sheets)`);

// npm run report   → performance summary of the live paper-trading session so far.

import { config, costsOf } from "./config.js";
import { ruleFromConfig, sessionKey } from "./rules.js";
import { SavedState, VERSION } from "./session.js";
import { computeStats, summarize } from "./stats.js";
import { Storage } from "./storage.js";
import { Wallet } from "./wallet.js";

const storage = new Storage(config.dataDir);
const st = storage.loadState<SavedState>();
const equity = storage.readEquity();

if (!st || !st.startedAt || equity.length === 0) {
  console.log('No live session data yet. Start one with "npm run live" and let it run for a while.');
  process.exit(0);
}
if (st.version !== VERSION || st.session !== sessionKey(config)) {
  console.log(`The saved session (${st.session ?? "old 15-minute bot"}) uses different settings from src/config.ts. Run "npm run live" to start a new one.`);
  process.exit(0);
}

const wallet = new Wallet(costsOf(config), st.wallet);
const price = equity[equity.length - 1].priceUsdt * config.usdtToInr;
const report = summarize(computeStats(st.trades, equity, config, wallet, price), config, ruleFromConfig(config).name);
storage.writeText("live_report.txt", report + "\n");
console.log(report);
console.log(`\nOpen position: ${wallet.inPosition ? `yes, bought at $${(wallet.s.entryPrice / config.usdtToInr).toFixed(2)}` : "no"}`);
console.log(`Data: ${config.dataDir}/trades.csv, equity.csv (open in Excel or Google Sheets)`);

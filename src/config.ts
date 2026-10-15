// All tunable settings live here. Change values, re-run, compare results.

export const config = {
  // Market
  symbol: "BTCUSDT",          // e.g. ETHUSDT, SOLUSDT
  interval: "15m",            // 1m, 5m, 15m, 1h, 4h, 1d

  // Paper wallet (everything is reported in INR)
  startingCapitalInr: 500,
  usdtToInr: 88,              // fixed conversion for reporting; update occasionally

  // Costs (be pessimistic: real results are usually worse than paper)
  feeRate: 0.001,             // 0.1% exchange fee per buy and per sell
  tdsRate: 0.01,              // 1% TDS withheld on every sell (India, crypto)
  slippageRate: 0.0005,       // 0.05% worse price than the candle close

  // Strategy: EMA crossover filtered by RSI
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  rsiMaxToBuy: 70,            // don't buy when already overbought

  // Risk management
  stopLossPct: 0.02,          // exit if price falls 2% below entry
  takeProfitPct: 0.04,        // exit if price rises 4% above entry
  positionSizePct: 1.0,       // fraction of cash used per trade (1.0 = all-in)

  // Live mode: candles older than this many intervals are treated as "missed while offline"
  // and never traded (the bot couldn't have acted on them in real life).
  maxLateCandles: 4,

  // Backtest
  backtestDays: 90,

  // Output folders (overridable for the GitHub Actions runner)
  dataDir: process.env.DATA_DIR ?? "data",
  siteDataDir: process.env.SITE_DATA_DIR ?? "",   // if set, dashboard JSON is written here
};

export type Config = typeof config;

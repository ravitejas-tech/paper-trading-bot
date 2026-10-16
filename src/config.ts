// All tunable settings live here. Change values, re-run, compare results.

export const config = {
  // Market (daily candles; see src/rules.ts)
  symbol: "BTCUSDT",          // e.g. ETHUSDT, SOLUSDT

  // Which rule the live bot and the backtest run (details in src/rules.ts):
  //   "momentum": every Sunday, hold the coin if it's worth more than `lookbackDays` ago, else cash
  //   "trend":    every day, hold the coin while it's above its `lookbackDays`-day average, else cash
  //   "hold":     buy once and never sell (the benchmark)
  // Changing the rule or symbol starts a new live session; the old one is archived.
  strategy: "momentum" as "momentum" | "trend" | "hold",
  lookbackDays: 365,

  // Paper wallet (everything is reported in INR)
  startingCapitalInr: 500,
  usdtToInr: 88,              // fixed conversion for reporting; update occasionally

  // Costs (be pessimistic: real results are usually worse than paper)
  feeRate: 0.001,             // 0.1% exchange fee per buy and per sell
  slippageRate: 0.0005,       // 0.05% worse price than the market price
  tdsRate: 0.01,              // 1% TDS withheld on every sell (India, crypto)
  taxRate: 0.312,             // 30% + 4% cess on each profitable sale; losses can't offset gains

  // Backtest
  backtestFrom: "2020-01-01",

  // Output folders (overridable for the GitHub Actions runner)
  dataDir: process.env.DATA_DIR ?? "data",
  siteDataDir: process.env.SITE_DATA_DIR ?? "",   // if set, dashboard JSON is written here
};

export type Config = typeof config;

export const costsOf = (cfg: Config) => ({
  feeRate: cfg.feeRate, slippageRate: cfg.slippageRate, tdsRate: cfg.tdsRate, taxRate: cfg.taxRate,
});

/** "BTCUSDT" → "BTC" */
export const coinOf = (symbol: string) => symbol.replace(/USDT$|USDC$|USD$/, "");

// Writes the JSON files the mobile dashboard (dashboard/index.html) reads.

import fs from "node:fs";
import path from "node:path";
import { Config } from "./config.js";
import { Trade } from "./paperBroker.js";
import { computeStats, EquityPoint } from "./stats.js";

/** Keep charts light on phones: at most ~maxPoints, always keeping the last point. */
function downsample<T>(xs: T[], maxPoints = 800): T[] {
  if (xs.length <= maxPoints) return xs;
  const step = xs.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints - 1; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}

export interface DashboardExtra {
  source?: string;
  inPosition?: boolean;
  entryPriceUsdt?: number;
  lastPriceUsdt?: number;
  lastAction?: string;
  status?: string;
}

export function writeDashboardJson(
  kind: "live" | "backtest",
  trades: Trade[],
  equity: EquityPoint[],
  totalTdsInr: number,
  cfg: Config,
  extra: DashboardExtra = {},
) {
  if (!cfg.siteDataDir) return;
  const payload = {
    kind,
    updatedAt: new Date().toISOString(),
    settings: {
      symbol: cfg.symbol,
      interval: cfg.interval,
      startingCapitalInr: cfg.startingCapitalInr,
      usdtToInr: cfg.usdtToInr,
      strategy: `EMA ${cfg.emaFast}/${cfg.emaSlow} crossover, RSI(${cfg.rsiPeriod}) < ${cfg.rsiMaxToBuy}`,
      stopLossPct: cfg.stopLossPct * 100,
      takeProfitPct: cfg.takeProfitPct * 100,
    },
    stats: computeStats(trades, equity, cfg, totalTdsInr),
    ...extra,
    // [time ms, price USDT, equity INR]
    equity: downsample(equity).map((p) => [Date.parse(p.time), +p.priceUsdt.toFixed(2), +p.equityInr.toFixed(2)]),
    trades: trades.slice(-200).reverse().map((t) => ({
      time: t.time,
      side: t.side,
      priceUsdt: +t.priceUsdt.toFixed(2),
      valueInr: +t.valueInr.toFixed(2),
      pnlInr: t.pnlInr === null ? null : +t.pnlInr.toFixed(2),
      reason: t.reason,
    })),
  };
  fs.mkdirSync(cfg.siteDataDir, { recursive: true });
  const f = path.join(cfg.siteDataDir, `${kind}.json`);
  fs.writeFileSync(f + ".tmp", JSON.stringify(payload));
  fs.renameSync(f + ".tmp", f);
}

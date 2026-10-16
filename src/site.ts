// Writes the JSON files the mobile dashboard (dashboard/index.html) reads.

import fs from "node:fs";
import path from "node:path";
import { coinOf, Config } from "./config.js";
import { Rule } from "./rules.js";
import { EquityPoint, Stats, Trade } from "./stats.js";

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
  nextCheck?: number; // ms: when the rule next makes a decision
  triggerUsdt?: number; // the close that flips that decision (hold above it)
}

const px = (x: number) => +x.toPrecision(7);

export function writeDashboardJson(
  kind: "live" | "backtest",
  rule: Rule,
  trades: Trade[],
  equity: EquityPoint[],
  stats: Stats,
  cfg: Config,
  extra: DashboardExtra = {},
) {
  if (!cfg.siteDataDir) return;
  const payload = {
    kind,
    updatedAt: new Date().toISOString(),
    settings: {
      symbol: cfg.symbol,
      coin: coinOf(cfg.symbol),
      startingCapitalInr: cfg.startingCapitalInr,
      usdtToInr: cfg.usdtToInr,
      strategy: rule.name,
      why: rule.why,
      when: rule.when,
      feePct: cfg.feeRate * 100,
      slippagePct: cfg.slippageRate * 100,
      tdsPct: cfg.tdsRate * 100,
      taxPct: cfg.taxRate * 100,
    },
    stats,
    ...extra,
    // [time ms, price USDT, value INR, buy & hold INR]
    equity: downsample(equity).map((p) => [Date.parse(p.time), px(p.priceUsdt), +p.valueInr.toFixed(2), +p.holdInr.toFixed(2)]),
    trades: trades.slice(-200).reverse().map((t) => ({
      time: t.time,
      side: t.side,
      priceUsdt: px(t.priceUsdt),
      valueInr: +t.valueInr.toFixed(2),
      gainInr: t.gainInr === null ? null : +t.gainInr.toFixed(2),
      reason: t.reason,
    })),
  };
  fs.mkdirSync(cfg.siteDataDir, { recursive: true });
  const f = path.join(cfg.siteDataDir, `${kind}.json`);
  fs.writeFileSync(f + ".tmp", JSON.stringify(payload));
  fs.renameSync(f + ".tmp", f);
}

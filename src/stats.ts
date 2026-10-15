// Performance summary shared by backtest, live report and the dashboard.

import { Config } from "./config.js";
import { Trade } from "./paperBroker.js";

export interface EquityPoint {
  time: string;
  priceUsdt: number;
  equityInr: number;
}

export interface Stats {
  periodStart: string | null;
  periodEnd: string | null;
  startInr: number;
  endInr: number;
  returnPct: number;
  holdReturnPct: number;
  completedTrades: number;
  winRatePct: number;
  avgWinInr: number;
  avgLossInr: number;
  maxDrawdownPct: number;
  feesInr: number;
  tdsInr: number;
  taxableGainsInr: number;
  estTaxInr: number;
  netAfterTaxInr: number;
  netAfterTaxPct: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeStats(trades: Trade[], equity: EquityPoint[], cfg: Config, totalTdsInr: number): Stats {
  const start = cfg.startingCapitalInr;
  const end = equity.length ? equity[equity.length - 1].equityInr : start;
  const sells = trades.filter((t) => t.side === "SELL");
  const wins = sells.filter((t) => (t.pnlInr ?? 0) > 0);
  const losses = sells.filter((t) => (t.pnlInr ?? 0) <= 0);

  // Max drawdown: worst peak-to-trough fall in equity
  let peak = -Infinity, maxDd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equityInr);
    maxDd = Math.max(maxDd, (peak - p.equityInr) / peak);
  }

  // Buy-and-hold benchmark: did the bot beat simply buying once and waiting?
  const hold = equity.length > 1 ? equity[equity.length - 1].priceUsdt / equity[0].priceUsdt - 1 : 0;

  // India crypto tax: 30% (+4% cess) on each profitable trade; losses can't offset gains.
  const taxable = wins.reduce((a, t) => a + (t.pnlInr ?? 0), 0);
  const estTax = taxable * 0.312;
  // Equity already includes TDS receivable; TDS counts toward this tax and any excess is refunded.
  const net = end - estTax;

  return {
    periodStart: equity[0]?.time ?? null,
    periodEnd: equity[equity.length - 1]?.time ?? null,
    startInr: start,
    endInr: end,
    returnPct: (end / start - 1) * 100,
    holdReturnPct: hold * 100,
    completedTrades: sells.length,
    winRatePct: sells.length ? (wins.length / sells.length) * 100 : 0,
    avgWinInr: avg(wins.map((t) => t.pnlInr ?? 0)),
    avgLossInr: avg(losses.map((t) => t.pnlInr ?? 0)),
    maxDrawdownPct: -maxDd * 100,
    feesInr: trades.reduce((a, t) => a + t.feeInr, 0),
    tdsInr: totalTdsInr,
    taxableGainsInr: taxable,
    estTaxInr: estTax,
    netAfterTaxInr: net,
    netAfterTaxPct: (net / start - 1) * 100,
  };
}

export function summarize(trades: Trade[], equity: EquityPoint[], cfg: Config, totalTdsInr: number): string {
  const s = computeStats(trades, equity, cfg, totalTdsInr);
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
  const inr = (x: number) => `₹${x.toFixed(2)}`;
  return [
    `Period:            ${s.periodStart ?? "-"}  →  ${s.periodEnd ?? "-"}`,
    `Market:            ${cfg.symbol} @ ${cfg.interval}`,
    `Starting capital:  ${inr(s.startInr)}`,
    `Ending equity:     ${inr(s.endInr)}  (${pct(s.returnPct)})`,
    `Buy & hold:        ${pct(s.holdReturnPct)}  ← the bot must beat this to be worth running`,
    `Completed trades:  ${s.completedTrades}   Win rate: ${s.winRatePct.toFixed(1)}%`,
    `Avg win / loss:    ${inr(s.avgWinInr)} / ${inr(s.avgLossInr)}`,
    `Max drawdown:      ${pct(s.maxDrawdownPct)}`,
    `Fees paid:         ${inr(s.feesInr)}`,
    `TDS withheld:      ${inr(s.tdsInr)}  (included in equity; locked until you file taxes, so the bot can't trade it)`,
    `Est. tax (31.2%):  ${inr(s.estTaxInr)}  on ${inr(s.taxableGainsInr)} of winning trades`,
    `Net after tax:     ${inr(s.netAfterTaxInr)}  (${pct(s.netAfterTaxPct)})`,
  ].join("\n");
}

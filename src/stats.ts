// Trade records and the performance summary shared by backtest, live report and the dashboard.

import { coinOf, Config } from "./config.js";
import { Fill, Wallet } from "./wallet.js";

export interface Trade {
  time: string;           // ISO timestamp of the fill
  side: "BUY" | "SELL";
  priceUsdt: number;      // fill price after slippage
  priceInr: number;
  qty: number;
  valueInr: number;       // gross trade value
  feeInr: number;
  tdsInr: number;         // withheld on sells: refunded at tax time, but not tradable until then
  gainInr: number | null; // realized gain on sells, after fees (taxed at 31.2% if > 0)
  reason: string;
  cashAfterInr: number;
}

/** A wallet fill (prices in INR) as a trade record. */
export const toTrade = (f: Fill, usdtToInr: number, reason: string): Trade => ({
  time: new Date(f.time).toISOString(),
  side: f.side,
  priceUsdt: f.price / usdtToInr,
  priceInr: f.price,
  qty: f.qty,
  valueInr: f.value,
  feeInr: f.fee,
  tdsInr: f.tds,
  gainInr: f.gain,
  reason,
  cashAfterInr: f.cashAfter,
});

export interface EquityPoint {
  time: string;
  priceUsdt: number;
  valueInr: number; // if you sold everything now and paid all tax
  holdInr: number;  // same, for buying once at the start and holding
}

export interface Stats {
  periodStart: string | null;
  periodEnd: string | null;
  startInr: number;
  endInr: number;
  returnPct: number;
  holdInr: number;
  holdReturnPct: number;
  completedTrades: number;
  winRatePct: number;
  avgWinInr: number;
  avgLossInr: number;
  maxDrawdownPct: number;
  holdMaxDrawdownPct: number;
  feesInr: number;
  tdsLockedInr: number;
  tdsRefundedInr: number;
  taxPaidInr: number;
  taxDueInr: number; // if you sold everything now
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function maxDrawdown(xs: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const x of xs) {
    peak = Math.max(peak, x);
    if (peak > 0) dd = Math.max(dd, (peak - x) / peak);
  }
  return -dd * 100;
}

export function computeStats(trades: Trade[], equity: EquityPoint[], cfg: Config, wallet: Wallet, priceInr: number): Stats {
  const start = cfg.startingCapitalInr;
  const last = equity[equity.length - 1];
  const end = last ? last.valueInr : start;
  const holdEnd = last ? last.holdInr : start;
  const sells = trades.filter((t) => t.side === "SELL");
  const wins = sells.filter((t) => (t.gainInr ?? 0) > 0);
  const losses = sells.filter((t) => (t.gainInr ?? 0) <= 0);

  return {
    periodStart: equity[0]?.time ?? null,
    periodEnd: last?.time ?? null,
    startInr: start,
    endInr: end,
    returnPct: (end / start - 1) * 100,
    holdInr: holdEnd,
    holdReturnPct: (holdEnd / start - 1) * 100,
    completedTrades: sells.length,
    winRatePct: sells.length ? (wins.length / sells.length) * 100 : 0,
    avgWinInr: avg(wins.map((t) => t.gainInr ?? 0)),
    avgLossInr: avg(losses.map((t) => t.gainInr ?? 0)),
    maxDrawdownPct: maxDrawdown(equity.map((p) => p.valueInr)),
    holdMaxDrawdownPct: maxDrawdown(equity.map((p) => p.holdInr)),
    feesInr: trades.reduce((a, t) => a + t.feeInr, 0),
    tdsLockedInr: wallet.tdsLocked(),
    tdsRefundedInr: wallet.s.tdsRefunded,
    taxPaidInr: wallet.s.taxPaid,
    taxDueInr: wallet.taxDue(priceInr),
  };
}

export function summarize(s: Stats, cfg: Config, ruleName: string): string {
  const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
  const inr = (x: number) => `₹${x.toFixed(2)}`;
  return [
    `Period:            ${s.periodStart ?? "-"}  →  ${s.periodEnd ?? "-"}`,
    `Market:            ${coinOf(cfg.symbol)}, daily candles`,
    `Rule:              ${ruleName}`,
    `Starting capital:  ${inr(s.startInr)}`,
    `Value now:         ${inr(s.endInr)}  (${pct(s.returnPct)})  ← if you sold everything and paid all tax`,
    `Buy & hold:        ${inr(s.holdInr)}  (${pct(s.holdReturnPct)})  ← same costs and tax; the rule must beat this`,
    `Completed trades:  ${s.completedTrades}   Win rate: ${s.winRatePct.toFixed(1)}%`,
    `Avg win / loss:    ${inr(s.avgWinInr)} / ${inr(s.avgLossInr)}  (after fees, before tax)`,
    `Worst drop:        ${pct(s.maxDrawdownPct)}  (buy & hold: ${pct(s.holdMaxDrawdownPct)})`,
    `Fees paid:         ${inr(s.feesInr)}`,
    `TDS:               ${inr(s.tdsLockedInr)} locked until the next refund, ${inr(s.tdsRefundedInr)} refunded so far`,
    `Tax:               ${inr(s.taxPaidInr)} paid, ${inr(s.taxDueInr)} more due if sold now (31.2% of each winning sale)`,
  ].join("\n");
}

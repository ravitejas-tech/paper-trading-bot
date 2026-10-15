// Simulated wallet. No real money, no real orders. Everything in INR.

import { Config } from "./config.js";

export interface Trade {
  side: "BUY" | "SELL";
  time: string;          // ISO timestamp of the candle close
  priceUsdt: number;     // fill price after slippage
  priceInr: number;
  qty: number;
  valueInr: number;      // gross trade value
  feeInr: number;
  tdsInr: number;        // withheld on sells: a tax prepayment, credited back at ITR time but not tradable now
  pnlInr: number | null; // realized P&L on sells, after fees (TDS is not a loss, see tdsInr)
  reason: string;
  cashAfterInr: number;
}

export interface BrokerState {
  cashInr: number;
  qty: number;
  entryPriceUsdt: number;
  entryCostInr: number;   // total INR spent on the open position, including buy fee
  totalTdsInr: number;
  trades: Trade[];
}

export class PaperBroker {
  state: BrokerState;

  constructor(private cfg: Config, state?: BrokerState) {
    this.state = state ?? {
      cashInr: cfg.startingCapitalInr,
      qty: 0,
      entryPriceUsdt: 0,
      entryCostInr: 0,
      totalTdsInr: 0,
      trades: [],
    };
  }

  get inPosition(): boolean {
    return this.state.qty > 0;
  }

  /** Total value: tradable cash + open position + TDS receivable (yours, but locked until tax filing). */
  equityInr(priceUsdt: number): number {
    return this.state.cashInr + this.state.qty * priceUsdt * this.cfg.usdtToInr + this.state.totalTdsInr;
  }

  buy(closeUsdt: number, time: number, reason: string): Trade | null {
    if (this.inPosition) return null;
    const spend = this.state.cashInr * this.cfg.positionSizePct;
    if (spend <= 1) return null;
    const fillUsdt = closeUsdt * (1 + this.cfg.slippageRate);
    const fillInr = fillUsdt * this.cfg.usdtToInr;
    const fee = spend * this.cfg.feeRate;
    const qty = (spend - fee) / fillInr;

    const s = this.state;
    s.cashInr -= spend;
    s.qty = qty;
    s.entryPriceUsdt = fillUsdt;
    s.entryCostInr = spend;

    const trade: Trade = {
      side: "BUY", time: new Date(time).toISOString(), priceUsdt: fillUsdt, priceInr: fillInr,
      qty, valueInr: spend, feeInr: fee, tdsInr: 0, pnlInr: null, reason, cashAfterInr: s.cashInr,
    };
    s.trades.push(trade);
    return trade;
  }

  sell(closeUsdt: number, time: number, reason: string): Trade | null {
    if (!this.inPosition) return null;
    const s = this.state;
    const fillUsdt = closeUsdt * (1 - this.cfg.slippageRate);
    const fillInr = fillUsdt * this.cfg.usdtToInr;
    const gross = s.qty * fillInr;
    const fee = gross * this.cfg.feeRate;
    const tds = gross * this.cfg.tdsRate;
    const proceeds = gross - fee - tds; // cash actually received now
    const pnl = gross - fee - s.entryCostInr;

    const trade: Trade = {
      side: "SELL", time: new Date(time).toISOString(), priceUsdt: fillUsdt, priceInr: fillInr,
      qty: s.qty, valueInr: gross, feeInr: fee, tdsInr: tds, pnlInr: pnl, reason, cashAfterInr: s.cashInr + proceeds,
    };
    s.cashInr += proceeds;
    s.totalTdsInr += tds;
    s.qty = 0;
    s.entryPriceUsdt = 0;
    s.entryCostInr = 0;
    s.trades.push(trade);
    return trade;
  }
}

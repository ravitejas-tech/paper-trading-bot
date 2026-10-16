// The one place money is counted. The research lab, the backtest and live paper trading all
// use this, so their numbers follow exactly the same rules. No real money, no real orders.
//
//  - Every buy and sell pays the exchange fee and slippage.
//  - Every sale has 1% TDS withheld: still yours, but locked until the tax refund.
//  - Indian crypto tax: 30% + 4% cess on each profitable sale; losses can't offset gains.
//    TDS and tax for a financial year (Apr–Mar) settle on 1 Aug after it ends (≈ ITR refund).
//  - value() = what you'd hold if you sold everything now and paid all tax due.

export interface Costs {
  feeRate: number;
  slippageRate: number;
  tdsRate: number;
  taxRate: number; // 0.312 = 30% + 4% cess
}

export interface Fill {
  side: "BUY" | "SELL";
  time: number;        // ms
  price: number;       // fill price after slippage
  qty: number;
  value: number;       // gross trade value
  fee: number;
  tds: number;         // withheld on sells
  gain: number | null; // realized gain on sells, after fees (taxed if > 0)
  cashAfter: number;
}

export interface WalletState {
  cash: number;
  qty: number;
  costBasis: number;  // total spent on the open position, including the buy fee
  entryPrice: number; // fill price of the open position
  fy: Record<number, { tds: number; gains: number }>; // unsettled financial years, keyed by start year
  taxPaid: number;
  tdsRefunded: number;
}

export interface Settlement {
  fy: number;
  tds: number; // refunded
  tax: number; // paid
}

export const fyOf = (t: number) => {
  const d = new Date(t);
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
};
export const settleTimeOf = (fy: number) => Date.UTC(fy + 1, 7, 1);

export class Wallet {
  s: WalletState;
  // Cached totals over unsettled years; they only change in sell() and settle().
  private nextSettle = Infinity;
  private lockedTds = 0;
  private owedTax = 0;

  constructor(private costs: Costs, state: WalletState | number) {
    this.s = typeof state === "number"
      ? { cash: state, qty: 0, costBasis: 0, entryPrice: 0, fy: {}, taxPaid: 0, tdsRefunded: 0 }
      : state;
    this.refresh();
  }

  get inPosition(): boolean {
    return this.s.qty > 0;
  }

  private refresh() {
    this.nextSettle = Infinity;
    this.lockedTds = 0;
    this.owedTax = 0;
    for (const [k, e] of Object.entries(this.s.fy)) {
      this.nextSettle = Math.min(this.nextSettle, settleTimeOf(Number(k)));
      this.lockedTds += e.tds;
      this.owedTax += e.gains * this.costs.taxRate;
    }
  }

  /** Go all-in at `price` (before slippage). */
  buy(price: number, time: number): Fill | null {
    const s = this.s, { feeRate, slippageRate } = this.costs;
    if (s.qty > 0 || s.cash <= 0) return null;
    const fill = price * (1 + slippageRate);
    const value = s.cash, fee = value * feeRate;
    s.qty = (value - fee) / fill;
    s.costBasis = value;
    s.entryPrice = fill;
    s.cash = 0;
    return { side: "BUY", time, price: fill, qty: s.qty, value, fee, tds: 0, gain: null, cashAfter: 0 };
  }

  /** Sell the whole position at `price` (before slippage). */
  sell(price: number, time: number): Fill | null {
    const s = this.s, { feeRate, slippageRate, tdsRate } = this.costs;
    if (s.qty <= 0) return null;
    const fill = price * (1 - slippageRate);
    const gross = s.qty * fill;
    const fee = gross * feeRate, tds = gross * tdsRate;
    const gain = gross - fee - s.costBasis;
    s.cash += gross - fee - tds;
    const e = (s.fy[fyOf(time)] ??= { tds: 0, gains: 0 });
    e.tds += tds;
    if (gain > 0) e.gains += gain;
    const f: Fill = { side: "SELL", time, price: fill, qty: s.qty, value: gross, fee, tds, gain, cashAfter: s.cash };
    s.qty = 0;
    s.costBasis = 0;
    s.entryPrice = 0;
    this.refresh();
    return f;
  }

  /** Refund TDS and pay tax for every financial year whose settlement date has passed. */
  settle(time: number): Settlement[] {
    if (time < this.nextSettle) return [];
    const done: Settlement[] = [];
    for (const k of Object.keys(this.s.fy).map(Number).sort((a, b) => a - b)) {
      if (time < settleTimeOf(k)) continue;
      const e = this.s.fy[k];
      const tax = e.gains * this.costs.taxRate;
      this.s.cash += e.tds - tax;
      this.s.taxPaid += tax;
      this.s.tdsRefunded += e.tds;
      delete this.s.fy[k];
      done.push({ fy: k, tds: e.tds, tax });
    }
    this.refresh();
    return done;
  }

  /** TDS withheld and not yet refunded. */
  tdsLocked(): number {
    return this.lockedTds;
  }

  /** Tax you'd owe if you sold everything at `price` now (unsettled years + the open position). */
  taxDue(price: number): number {
    let x = this.owedTax;
    if (this.s.qty > 0) {
      const { feeRate, slippageRate, taxRate } = this.costs;
      const gain = this.s.qty * price * (1 - slippageRate) * (1 - feeRate) - this.s.costBasis;
      if (gain > 0) x += gain * taxRate;
    }
    return x;
  }

  /** What you'd hold if you sold everything at `price` now and paid all tax due. */
  value(price: number): number {
    let v = this.s.cash + this.lockedTds - this.owedTax;
    if (this.s.qty > 0) {
      const { feeRate, slippageRate, taxRate } = this.costs;
      const net = this.s.qty * price * (1 - slippageRate) * (1 - feeRate);
      const gain = net - this.s.costBasis;
      v += net - (gain > 0 ? gain * taxRate : 0);
    }
    return v;
  }
}

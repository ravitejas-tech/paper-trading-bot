// Research simulator: one wallet, all-in or all-cash, spot only (no leverage, no shorting).
//
// Honesty rules:
//  - decide(i) only sees data up to the CLOSE of bar i; the trade fills at the OPEN of bar i+1.
//  - Every sale pays fee + slippage and has 1% TDS withheld (not tradable until refunded).
//  - Indian crypto tax: 30% + 4% cess on each profitable sale; losses can't offset gains.
//    TDS and tax for a financial year (Apr–Mar) settle on 1 Aug after it ends (≈ ITR refund).
//  - Reported value = what you'd hold if you sold everything now and paid all tax due.

export interface Bar {
  t: number; // open time, ms
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Costs {
  feeRate: number;
  slippageRate: number;
  tdsRate: number;
  taxRate: number; // 0.312 = 30% + 4% cess
}

export interface Ctx {
  holding: number;    // asset index held, or -1 for cash
  entryPrice: number; // fill price of the current position
}

/** Return the asset index to hold from the next bar on, or -1 for cash. */
export type Decider = (i: number, ctx: Ctx) => number;

export interface SimResult {
  times: number[];
  values: number[];
  entries: number;      // number of buys
  entryTimes: number[];
  held: Uint8Array;     // 1 if in a position at bar close
  barsInMarket: number;
  taxPaid: number;
}

const fyOf = (t: number) => {
  const d = new Date(t);
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
};
const settleTimeOf = (fy: number) => Date.UTC(fy + 1, 7, 1);

export function simulate(
  assets: (Bar | null)[][],
  times: number[],
  decide: Decider,
  costs: Costs,
  startCash: number,
  startAt = -Infinity, // no trading before this time; the wallet starts fresh here
): SimResult {
  const { feeRate, slippageRate: slip, tdsRate, taxRate } = costs;
  let cash = startCash, holding = -1, qty = 0, costBasis = 0, entryPrice = 0;
  let entries = 0, barsInMarket = 0, taxPaid = 0;
  const fy = new Map<number, { tds: number; gains: number }>();
  const lastClose = new Array<number>(assets.length).fill(NaN);
  const values: number[] = [];
  const entryTimes: number[] = [];
  const held = new Uint8Array(times.length);
  let target = -1;

  const sell = (price: number, t: number) => {
    const gross = qty * price * (1 - slip);
    const fee = gross * feeRate;
    const tds = gross * tdsRate;
    cash += gross - fee - tds;
    const gain = gross - fee - costBasis;
    const k = fyOf(t);
    const e = fy.get(k) ?? { tds: 0, gains: 0 };
    e.tds += tds;
    if (gain > 0) e.gains += gain;
    fy.set(k, e);
    holding = -1; qty = 0; costBasis = 0; entryPrice = 0;
  };

  const buy = (a: number, price: number, t: number) => {
    if (cash <= 0) return;
    const fill = price * (1 + slip);
    qty = (cash - cash * feeRate) / fill;
    costBasis = cash;
    cash = 0;
    holding = a;
    entryPrice = fill;
    entries++;
    entryTimes.push(t);
  };

  for (let i = 0; i < times.length; i++) {
    const t = times[i];

    // Settle any financial year whose refund date has passed.
    for (const [k, e] of fy) {
      if (t >= settleTimeOf(k)) {
        const tax = e.gains * taxRate;
        taxPaid += tax;
        cash += e.tds - tax;
        fy.delete(k);
      }
    }

    // Execute yesterday's decision at today's open.
    if (i > 0 && target !== holding) {
      if (holding >= 0) {
        const b = assets[holding][i];
        if (b) sell(b.open, t);
      }
      if (target >= 0 && holding === -1) {
        const b = assets[target][i];
        if (b) buy(target, b.open, t);
      }
    }

    for (let a = 0; a < assets.length; a++) {
      const b = assets[a][i];
      if (b) lastClose[a] = b.close;
    }

    // Mark to "sell everything now, pay all tax".
    let pending = 0;
    for (const e of fy.values()) pending += e.tds - e.gains * taxRate;
    let pos = 0;
    if (holding >= 0) {
      barsInMarket++;
      held[i] = 1;
      const net = qty * lastClose[holding] * (1 - slip) * (1 - feeRate);
      const gain = net - costBasis;
      pos = net - (gain > 0 ? gain * taxRate : 0);
    }
    values.push(cash + pending + pos);

    // Decide only once the next bar is inside the trading window.
    const nextLive = i + 1 >= times.length || times[i + 1] >= startAt;
    target = nextLive ? decide(i, { holding, entryPrice }) : -1;
  }

  return { times, values, entries, entryTimes, held, barsInMarket, taxPaid };
}

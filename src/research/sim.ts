// Research simulator: one wallet, all-in or all-cash, spot only (no leverage, no shorting).
//
// Honesty rules:
//  - decide(i) only sees data up to the CLOSE of bar i; the trade fills at the OPEN of bar i+1.
//  - Money is counted by src/wallet.ts, the same code the live bot uses: fees, slippage,
//    1% TDS, 30% + cess tax per winning sale with no loss offset, settled each financial year.
//  - Reported value = what you'd hold if you sold everything now and paid all tax due.

import { Bar } from "../market.js";
import { Costs, Fill, Wallet, WalletState } from "../wallet.js";

export type { Bar } from "../market.js";
export type { Costs } from "../wallet.js";

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
  fills: (Fill & { asset: number })[];
  wallet: WalletState;  // at the end
}

export function simulate(
  assets: (Bar | null)[][],
  times: number[],
  decide: Decider,
  costs: Costs,
  startCash: number,
  startAt = -Infinity, // no trading before this time; the wallet starts fresh here
): SimResult {
  const w = new Wallet(costs, startCash);
  let holding = -1, entries = 0, barsInMarket = 0;
  const lastClose = new Array<number>(assets.length).fill(NaN);
  const values: number[] = [];
  const entryTimes: number[] = [];
  const fills: SimResult["fills"] = [];
  const held = new Uint8Array(times.length);
  let target = -1;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];

    // Settle any financial year whose refund date has passed.
    w.settle(t);

    // Execute yesterday's decision at today's open.
    if (i > 0 && target !== holding) {
      if (holding >= 0) {
        const b = assets[holding][i];
        const f = b && w.sell(b.open, t);
        if (f) { fills.push({ ...f, asset: holding }); holding = -1; }
      }
      if (target >= 0 && holding === -1) {
        const b = assets[target][i];
        const f = b && w.buy(b.open, t);
        if (f) {
          fills.push({ ...f, asset: target });
          holding = target;
          entries++;
          entryTimes.push(t);
        }
      }
    }

    for (let a = 0; a < assets.length; a++) {
      const b = assets[a][i];
      if (b) lastClose[a] = b.close;
    }

    if (holding >= 0) {
      barsInMarket++;
      held[i] = 1;
    }
    values.push(w.value(holding >= 0 ? lastClose[holding] : 0));

    // Decide only once the next bar is inside the trading window.
    const nextLive = i + 1 >= times.length || times[i + 1] >= startAt;
    target = nextLive ? decide(i, { holding, entryPrice: w.s.entryPrice }) : -1;
  }

  return { times, values, entries, entryTimes, held, barsInMarket, taxPaid: w.s.taxPaid, fills, wallet: w.s };
}

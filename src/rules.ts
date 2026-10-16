// The trading rules. Live paper trading, the backtest and the research lab all call these,
// on daily candles, so paper results follow exactly the same logic as the tests.
//
// A rule only sees closed daily candles. At candle i it answers:
//   true  → hold the coin from now on
//   false → hold cash
//   null  → not a decision day (keep whatever you hold)
//
// Rules decide from the current state of the market (where the price is), not one-off events
// like "a crossover happened on this candle". So if GitHub skips or delays a run, nothing is
// missed: the next run looks at the latest candles and acts at the price then.

import { coinOf, Config } from "./config.js";
import { sma } from "./indicators.js";
import { Bar } from "./market.js";
import type { Decider } from "./research/sim.js";

const DAY = 86_400_000;

export interface RuleLogic {
  decide: (i: number, holding: boolean) => boolean | null;
  /** Plain-language reason for the decision at candle i. */
  explain: (i: number) => string;
}

export interface Rule {
  id: string;
  name: string;
  why: string;
  when: string;       // when it makes decisions, in plain words
  warmupDays: number; // daily candles needed before the first decision
  /** Whether the daily candle opening at `t` is one the rule decides on. */
  decidesOn: (t: number) => boolean;
  make: (bars: Bar[]) => RuleLogic;
  /** The close at which the decision on the candle opening at `decisionOpen` flips (hold above it), if known now. */
  trigger?: (bars: Bar[], decisionOpen: number) => number | null;
}

const usd = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: x < 10 ? 4 : 0 });
const isSunday = (t: number) => new Date(t).getUTCDay() === 0;

export const hold = (): Rule => ({
  id: "hold",
  name: "Buy & hold",
  why: "Buy once and never sell. Tax is only paid when you finally sell, which is a big advantage under Indian crypto tax.",
  when: "buys at the first check, then never sells",
  warmupDays: 1,
  decidesOn: () => true,
  make: () => ({ decide: () => true, explain: () => "buy & hold" }),
});

export const momentum = (days: number): Rule => ({
  id: `momentum-${days}`,
  name: `${days}-day momentum, checked weekly`,
  why: `Every Sunday, hold the coin if it's worth more than it was ${days} days ago; otherwise sit in cash. A slow rule that aims to sit out long crashes and trades about once a year, so fees, TDS and tax barely eat into it.`,
  when: "checks after each Sunday's daily close (Monday 05:30 IST)",
  warmupDays: days + 1,
  decidesOn: isSunday,
  // The bar to beat is the close exactly `days` days before the decision day, so it's known in advance.
  trigger: (bars, decisionOpen) => bars.find((b) => b.t === decisionOpen - days * DAY)?.close ?? null,
  make: (bars) => {
    const c = bars.map((b) => b.close);
    return {
      decide: (i) => (!isSunday(bars[i].t) ? null : i >= days ? c[i] > c[i - days] : false),
      explain: (i) => i < days
        ? "not enough history yet"
        : `price ${usd(c[i])} is ${c[i] > c[i - days] ? "above" : "below"} ${usd(c[i - days])} from ${days} days ago`,
    };
  },
});

export const trend = (days: number): Rule => ({
  id: `trend-${days}`,
  name: `${days}-day average trend filter`,
  why: `Every day, hold the coin while it closes above its ${days}-day average; sit in cash when it's below. Aims to dodge long crashes, but trades more often in choppy markets.`,
  when: "checks after each daily close (05:30 IST)",
  warmupDays: days,
  decidesOn: () => true,
  // close > (sum of the previous days-1 closes + close) / days  ⇔  close > their average
  trigger: (bars, decisionOpen) => {
    const prev = bars.filter((b) => b.t < decisionOpen && b.t >= decisionOpen - (days - 1) * DAY);
    return prev.length === days - 1 ? prev.reduce((a, b) => a + b.close, 0) / prev.length : null;
  },
  make: (bars) => {
    const c = bars.map((b) => b.close), avg = sma(c, days);
    return {
      decide: (i) => (Number.isNaN(avg[i]) ? false : c[i] > avg[i]),
      explain: (i) => Number.isNaN(avg[i])
        ? "not enough history yet"
        : `price ${usd(c[i])} is ${c[i] > avg[i] ? "above" : "below"} its ${days}-day average ${usd(avg[i])}`,
    };
  },
});

export function ruleFromConfig(cfg: Config): Rule {
  if (cfg.strategy === "hold") return hold();
  if (cfg.strategy === "trend") return trend(cfg.lookbackDays);
  if (cfg.strategy === "momentum") return momentum(cfg.lookbackDays);
  throw new Error(`Unknown strategy "${cfg.strategy}" in src/config.ts (use momentum, trend or hold)`);
}

/** Identifies a live session: changing the rule or the coin starts a new one. */
export const sessionKey = (cfg: Config) => `${ruleFromConfig(cfg).id}:${coinOf(cfg.symbol)}`;

/**
 * Act on every candle newer than `after` (an open time), oldest first; the latest decision wins.
 * Returns what to hold now and the index of the candle that decided it (null if none did).
 */
export function latestDecision(logic: RuleLogic, bars: Bar[], after: number, holding: boolean): { hold: boolean; at: number | null } {
  let h = holding, at: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].t <= after) continue;
    const d = logic.decide(i, h);
    if (d !== null) { h = d; at = i; }
  }
  return { hold: h, at };
}

/** Run a rule in the simulator (src/research/sim.ts) on a single coin. */
export function toDecider(logic: RuleLogic): Decider {
  return (i, ctx) => {
    const d = logic.decide(i, ctx.holding >= 0);
    return d === null ? ctx.holding : d ? 0 : -1;
  };
}

/** When the next decision happens: the close of the next candle the rule decides on. */
export function nextCheck(rule: Rule, now: number): number {
  let close = Math.floor(now / DAY) * DAY + DAY;
  while (!rule.decidesOn(close - DAY)) close += DAY;
  return close;
}

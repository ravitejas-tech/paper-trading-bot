// The trading rules under test. Each family has a plain-language reason and a small
// set of settings; the walk-forward test picks settings using only past data.

import { config } from "../config.js";
import { prevMax, prevMin, sma } from "../indicators.js";
import { ruleFromConfig, toDecider } from "../rules.js";
import { Bar, Decider } from "./sim.js";

export interface SingleCoinFamily<P = any> {
  id: string;
  name: string;
  why: string;
  params: P[];
  label: (p: P) => string;
  make: (p: P, bars: Bar[], fng: Map<number, number>) => Decider;
}

const DAY = 86_400_000;
const dayKey = (t: number) => Math.floor(t / DAY) * DAY;

export const hold: SingleCoinFamily<null> = {
  id: "hold",
  name: "Buy & hold",
  why: "Buy once, never sell. The benchmark every rule has to beat. Tax is only paid when you finally sell.",
  params: [null],
  label: () => "buy once",
  make: () => () => 0,
};

export const trend: SingleCoinFamily<number> = {
  id: "trend",
  name: "Trend filter",
  why: "Hold only while the price is above its N-day average; sit in cash when it's below. Aims to dodge long crashes.",
  params: [20, 50, 100, 150, 200],
  label: (n) => `${n}-day average`,
  make: (n, bars) => {
    const closes = bars.map((b) => b.close);
    const avg = sma(closes, n);
    return (i) => (closes[i] > avg[i] ? 0 : -1);
  },
};

export const cross: SingleCoinFamily<[number, number]> = {
  id: "cross",
  name: "Average crossover",
  why: "Hold while a fast average is above a slow one (the classic 'golden cross'). Slower to react, fewer trades.",
  params: [[10, 30], [20, 50], [50, 100], [50, 200]],
  label: ([f, s]) => `${f}/${s}-day averages`,
  make: ([f, s], bars) => {
    const closes = bars.map((b) => b.close);
    const fast = sma(closes, f), slow = sma(closes, s);
    return (i) => (fast[i] > slow[i] ? 0 : -1);
  },
};

export const breakout: SingleCoinFamily<[number, number]> = {
  id: "breakout",
  name: "Breakout",
  why: "Buy when the price makes a new N-day high, sell on a new M-day low. Rides big moves, ignores noise.",
  params: [[20, 10], [30, 15], [55, 20], [100, 50]],
  label: ([n, m]) => `${n}-day high / ${m}-day low`,
  make: ([n, m], bars) => {
    const closes = bars.map((b) => b.close);
    const hi = prevMax(bars.map((b) => b.high), n);
    const lo = prevMin(bars.map((b) => b.low), m);
    return (i, ctx) => {
      if (ctx.holding < 0) return closes[i] > hi[i] ? 0 : -1;
      return closes[i] < lo[i] ? -1 : 0;
    };
  },
};

export const fear: SingleCoinFamily<[number, number]> = {
  id: "fear",
  name: "Fear & Greed (market mood)",
  why: "Uses the daily Crypto Fear & Greed index, built from volatility, momentum, social media and search trends. Buy when the crowd is fearful, sell when it's greedy.",
  params: [[20, 60], [25, 75], [20, 80], [30, 70]],
  label: ([a, b]) => `buy ≤ ${a}, sell ≥ ${b}`,
  make: ([a, b], bars, fng) => (i, ctx) => {
    const v = fng.get(dayKey(bars[i].t));
    if (v === undefined) return ctx.holding;
    if (v <= a) return 0;
    if (v >= b) return -1;
    return ctx.holding;
  },
};

export const momentum: SingleCoinFamily<number> = {
  id: "momentum",
  name: "Momentum (weekly)",
  why: "Every Sunday, hold the coin if it's worth more than it was N days ago; otherwise sit in cash. Slow, about one trade a year.",
  params: [120, 250, 365],
  label: (n) => `vs ${n} days ago`,
  make: (n, bars) => {
    const closes = bars.map((b) => b.close);
    return (i, ctx) => (new Date(bars[i].t).getUTCDay() !== 0 ? ctx.holding : i >= n && closes[i] > closes[i - n] ? 0 : -1);
  },
};

/** The exact rule the live bot runs (src/config.ts → src/rules.ts), with its fixed settings. */
const liveRule = ruleFromConfig(config);
export const liveBot: SingleCoinFamily<null> = {
  id: "live",
  name: `Your live bot: ${liveRule.name}`,
  why: `The rule the live bot runs. ${liveRule.why}`,
  params: [null],
  label: () => "fixed settings",
  make: (_p, bars) => toDecider(liveRule.make(bars)),
};

export const SINGLE_COIN_FAMILIES = [hold, trend, cross, breakout, momentum, fear];

/** Rotation across coins: every 7 days, hold the coin with the best L-day return (cash if all negative). */
export const rotation = {
  id: "rotation",
  name: "Rotation (strongest coin)",
  why: "Every week, move the whole wallet into whichever coin rose most over the last L days; hold cash if all of them fell.",
  params: [14, 30, 60, 90],
  label: (l: number) => `${l}-day strength, weekly`,
  make: (l: number, assets: (Bar | null)[][]): Decider => (i, ctx) => {
    if (i % 7 !== 0) return ctx.holding;
    let best = -1, bestRet = 0;
    for (let a = 0; a < assets.length; a++) {
      const now = assets[a][i], then = i >= l ? assets[a][i - l] : null;
      if (!now || !then) continue;
      const r = now.close / then.close - 1;
      if (r > bestRet) { bestRet = r; best = a; }
    }
    return best;
  },
};

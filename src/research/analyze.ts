// Turns simulated value curves into the answers that matter:
// what ₹500 became, how low it went, how often it doubled, and how long that took.

export const DAY = 86_400_000;
export const dayKey = (t: number) => Math.floor(t / DAY) * DAY;

/** A value curve on a daily grid: days[k] = UTC midnight, values[k] = value at that day's close. */
export interface Curve {
  days: number[];
  values: number[];
}

/** Sample a bar-level curve to one value per UTC day (the last bar of each day). */
export function toDaily(times: number[], values: number[]): Curve {
  const m = new Map<number, number>();
  for (let i = 0; i < times.length; i++) m.set(dayKey(times[i]), values[i]);
  const days = [...m.keys()].sort((a, b) => a - b);
  return { days, values: days.map((d) => m.get(d)!) };
}

/** Slice a curve to start at `from` and rescale so its first value is `start`. */
export function rebase(c: Curve, from: number, start: number): Curve {
  const k = c.days.findIndex((d) => d >= from);
  if (k < 0) return { days: [], values: [] };
  const s = start / c.values[k];
  return { days: c.days.slice(k), values: c.values.slice(k).map((v) => v * s) };
}

const valueAt = (c: Curve, day: number): number => {
  // last value on or before `day`
  let lo = 0, hi = c.days.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c.days[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans < 0 ? NaN : c.values[ans];
};

/**
 * Walk-forward: for each calendar year from `testFrom`, pick the settings that grew most over
 * the previous `trainDays` (data the rule could actually have seen), then use them for that year.
 */
export function walkForward(
  curves: Curve[],
  labels: string[],
  testFrom: number,
  start: number,
  trainDays = 730,
): { curve: Curve; picks: { year: number; label: string }[] } {
  const lastDay = Math.max(...curves.map((c) => c.days[c.days.length - 1]));
  const days: number[] = [];
  for (let d = testFrom; d <= lastDay; d += DAY) days.push(d);
  const values: number[] = [];
  const picks: { year: number; label: string }[] = [];

  let chosen = -1, year = -1, v = start;
  for (let k = 0; k < days.length; k++) {
    const d = days[k];
    const y = new Date(d).getUTCFullYear();
    if (y !== year) {
      year = y;
      const trainEnd = d - DAY, trainStart = d - trainDays * DAY;
      let best = -Infinity;
      curves.forEach((c, idx) => {
        const a = valueAt(c, trainStart) || c.values[0], b = valueAt(c, trainEnd);
        if (!(a > 0) || !(b > 0) || c.days[0] > trainEnd - 365 * DAY) return; // need ≥1 year of history
        const g = b / a;
        if (g > best) { best = g; chosen = idx; }
      });
      picks.push({ year: y, label: chosen >= 0 ? labels[chosen] : "-" });
    }
    if (k > 0 && chosen >= 0) {
      const c = curves[chosen];
      const prev = valueAt(c, days[k - 1]), cur = valueAt(c, d);
      if (prev > 0 && cur > 0) v *= cur / prev;
    }
    values.push(v);
  }
  return { curve: { days, values }, picks };
}

export interface Metrics {
  start: string;
  end: string;
  years: number;
  finalValue: number;
  multiple: number;
  cagrPct: number;
  maxDrawdownPct: number;
  lowestValue: number;          // lowest the wallet fell to (started at `start`)
  yearly: { year: number; returnPct: number }[];
  worstYearPct: number;
  // From many possible start dates (every 7 days):
  rollingStarts: number;
  doubledWithin1yPct: number;   // % of start dates that reached 2x within 365 days
  doubledWithin2yPct: number;   // % of start dates (with 2y of data after) that reached 2x within 730 days
  medianDaysToDouble: number | null;
  neverDoubledPct: number;      // % of start dates that never reached 2x by today
  lossAfter1yPct: number;       // % of start dates down after one year
  worstDipFromStartPct: number; // worst fall below the starting amount, over all start dates
}

export function metrics(c: Curve, extra: { entries?: number; barsInMarketPct?: number } = {}) {
  const n = c.values.length;
  const v0 = c.values[0], vN = c.values[n - 1];
  const years = (c.days[n - 1] - c.days[0]) / (365.25 * DAY);

  let peak = -Infinity, maxDd = 0, lowest = Infinity;
  for (const v of c.values) {
    peak = Math.max(peak, v);
    maxDd = Math.max(maxDd, 1 - v / peak);
    lowest = Math.min(lowest, v);
  }

  const yearly: { year: number; returnPct: number }[] = [];
  let yStartV = v0, yCur = new Date(c.days[0]).getUTCFullYear();
  for (let k = 1; k < n; k++) {
    const y = new Date(c.days[k]).getUTCFullYear();
    if (y !== yCur) {
      yearly.push({ year: yCur, returnPct: (c.values[k - 1] / yStartV - 1) * 100 });
      yStartV = c.values[k - 1];
      yCur = y;
    }
  }
  yearly.push({ year: yCur, returnPct: (vN / yStartV - 1) * 100 });

  // Rolling start dates
  let starts = 0, d1 = 0, d2 = 0, d2n = 0, never = 0, loss1 = 0, loss1n = 0, worstDip = 0;
  const daysToDouble: number[] = [];
  for (let s = 0; s + 365 < n; s += 7) {
    starts++;
    const vs = c.values[s];
    let doubledAt = -1;
    for (let k = s + 1; k < n; k++) {
      worstDip = Math.max(worstDip, 1 - c.values[k] / vs);
      if (doubledAt < 0 && c.values[k] >= 2 * vs) { doubledAt = k; }
    }
    const dd = doubledAt >= 0 ? (c.days[doubledAt] - c.days[s]) / DAY : Infinity;
    if (doubledAt >= 0) daysToDouble.push(dd);
    else never++;
    if (dd <= 365) d1++;
    if (s + 730 < n) {
      d2n++;
      if (dd <= 730) d2++;
    }
    loss1n++;
    if (c.values[s + 365] < vs) loss1++;
  }
  daysToDouble.sort((a, b) => a - b);

  const m: Metrics & typeof extra = {
    start: new Date(c.days[0]).toISOString().slice(0, 10),
    end: new Date(c.days[n - 1]).toISOString().slice(0, 10),
    years: +years.toFixed(2),
    finalValue: vN,
    multiple: vN / v0,
    cagrPct: ((vN / v0) ** (1 / years) - 1) * 100,
    maxDrawdownPct: -maxDd * 100,
    lowestValue: lowest,
    yearly,
    worstYearPct: Math.min(...yearly.map((y) => y.returnPct)),
    rollingStarts: starts,
    doubledWithin1yPct: starts ? (d1 / starts) * 100 : 0,
    doubledWithin2yPct: d2n ? (d2 / d2n) * 100 : 0,
    medianDaysToDouble: daysToDouble.length ? daysToDouble[Math.floor(daysToDouble.length / 2)] : null,
    neverDoubledPct: starts ? (never / starts) * 100 : 0,
    lossAfter1yPct: loss1n ? (loss1 / loss1n) * 100 : 0,
    worstDipFromStartPct: -worstDip * 100,
    ...extra,
  };
  return m;
}

/** Weekly points for charts: [day, value]. */
export function weekly(c: Curve): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < c.days.length; k += 7) out.push([c.days[k], +c.values[k].toFixed(2)]);
  const last = c.days.length - 1;
  if (last % 7 !== 0) out.push([c.days[last], +c.values[last].toFixed(2)]);
  return out;
}

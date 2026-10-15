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
 * Walk-forward selection: for each calendar year from `testFrom`, pick the settings that grew
 * most over the previous `trainDays` — data the rule could actually have seen at the time.
 */
export function choosePicks(
  curves: Curve[],
  labels: string[],
  testFrom: number,
  trainDays = 730,
): { year: number; idx: number; label: string }[] {
  const lastDay = Math.max(...curves.map((c) => c.days[c.days.length - 1]));
  const picks: { year: number; idx: number; label: string }[] = [];
  let prev = -1;
  for (let y = new Date(testFrom).getUTCFullYear(); y <= new Date(lastDay).getUTCFullYear(); y++) {
    const yearStart = Math.max(testFrom, Date.UTC(y, 0, 1));
    const trainEnd = yearStart - DAY, trainStart = yearStart - trainDays * DAY;
    let best = -Infinity, chosen = prev;
    curves.forEach((c, idx) => {
      if (c.days[0] > trainEnd - 365 * DAY) return; // need at least a year of history
      const a = valueAt(c, trainStart) || c.values[0], b = valueAt(c, trainEnd);
      if (!(a > 0) || !(b > 0)) return;
      if (b / a > best) { best = b / a; chosen = idx; }
    });
    if (chosen < 0) chosen = 0;
    picks.push({ year: y, idx: chosen, label: labels[chosen] });
    prev = chosen;
  }
  return picks;
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
}

/** Answers for "what if I had started on a random day?" Every start is a fresh simulation. */
export interface RollingStats {
  rollingStarts: number;
  doubledWithin1yPct: number;   // % of start dates that reached 2x within 365 days
  doubledWithin2yPct: number;   // % of start dates (with 2y of data after) that reached 2x within 730 days
  medianDaysToDouble: number | null;
  neverDoubledPct: number;      // % of start dates that never reached 2x by today
  lossAfter1yPct: number;       // % of start dates down after one year
  worstDipFromStartPct: number; // worst fall below the starting amount, over all start dates
}

export function metrics<E extends object>(c: Curve, extra: E = {} as E) {
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
      yearly.push({ year: yCur, returnPct: yStartV > 0 ? (c.values[k - 1] / yStartV - 1) * 100 : NaN });
      yStartV = c.values[k - 1];
      yCur = y;
    }
  }
  yearly.push({ year: yCur, returnPct: yStartV > 0 ? (vN / yStartV - 1) * 100 : NaN }); // NaN once the wallet is gone

  const m: Metrics & E = {
    start: new Date(c.days[0]).toISOString().slice(0, 10),
    end: new Date(c.days[n - 1]).toISOString().slice(0, 10),
    years: +years.toFixed(2),
    finalValue: vN,
    multiple: vN / v0,
    cagrPct: ((vN / v0) ** (1 / years) - 1) * 100,
    maxDrawdownPct: -maxDd * 100,
    lowestValue: lowest,
    yearly,
    worstYearPct: Math.min(...yearly.map((y) => y.returnPct).filter((x) => !Number.isNaN(x))),
    ...extra,
  };
  return m;
}

export function rollingStats(runFrom: (startAt: number) => Curve, testFrom: number, lastDay: number, start: number): RollingStats {
  let starts = 0, d1 = 0, d2 = 0, d2n = 0, never = 0, loss1 = 0, worstDip = 0;
  const daysToDouble: number[] = [];
  for (let s = testFrom; s + 365 * DAY <= lastDay; s += 7 * DAY) {
    const c = runFrom(s);
    if (c.values.length < 2) continue;
    starts++;
    let doubledAt = -1;
    for (let k = 1; k < c.values.length; k++) {
      worstDip = Math.max(worstDip, 1 - c.values[k] / start);
      if (doubledAt < 0 && c.values[k] >= 2 * start) doubledAt = k;
    }
    const dd = doubledAt >= 0 ? (c.days[doubledAt] - s) / DAY : Infinity;
    if (doubledAt >= 0) daysToDouble.push(dd); else never++;
    if (dd <= 365) d1++;
    if (s + 730 * DAY <= lastDay) { d2n++; if (dd <= 730) d2++; }
    if (valueAt(c, s + 365 * DAY) < start) loss1++;
  }
  daysToDouble.sort((a, b) => a - b);
  return {
    rollingStarts: starts,
    doubledWithin1yPct: starts ? (d1 / starts) * 100 : 0,
    doubledWithin2yPct: d2n ? (d2 / d2n) * 100 : 0,
    medianDaysToDouble: daysToDouble.length ? daysToDouble[Math.floor(daysToDouble.length / 2)] : null,
    neverDoubledPct: starts ? (never / starts) * 100 : 0,
    lossAfter1yPct: starts ? (loss1 / starts) * 100 : 0,
    worstDipFromStartPct: -worstDip * 100,
  };
}

/** Weekly points for charts: [day, value]. */
export function weekly(c: Curve): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < c.days.length; k += 7) out.push([c.days[k], +c.values[k].toFixed(2)]);
  const last = c.days.length - 1;
  if (last % 7 !== 0) out.push([c.days[last], +c.values[last].toFixed(2)]);
  return out;
}

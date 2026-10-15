// npm run verify   → correctness checks for the research engine (no lookahead, tax/TDS math, walk-forward).

import { simulate, Bar, Costs } from "./sim.js";
import { trend, cross, breakout, fear, currentBot, rotation } from "./families.js";
import { metrics, toDaily, choosePicks, rollingStats, Curve } from "./analyze.js";
const DAY = 864e5, C: Costs = { feeRate: 0.001, slippageRate: 0.0005, tdsRate: 0.01, taxRate: 0.312 };
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function series(n: number, t0: number, step: number, vol = 0.03, drift = 0.0008): Bar[] {
  let p = 1000; return Array.from({ length: n }, (_, i) => { const o = p; p = p * Math.exp(drift + (rnd() - 0.5) * 2 * vol); return { t: t0 + i * step, open: o, high: Math.max(o, p) * 1.01, low: Math.min(o, p) * 0.99, close: p }; });
}
const t0 = Date.UTC(2018, 0, 1);
const bars = series(3000, t0, DAY);
const times = bars.map(b => b.t);
let ok = true; const check = (name: string, cond: boolean, info = "") => { console.log(cond ? "PASS" : "FAIL", name, info); ok &&= cond; };

// 1. Hold, analytic: buy at bar1 open, liquidate at last close, tax on gain
{
  const r = simulate([bars], times, () => 0, C, 500);
  const qty = (500 * (1 - 0.001)) / (bars[1].open * 1.0005);
  const net = qty * bars.at(-1)!.close * (1 - 0.0005) * (1 - 0.001);
  const exp = net - Math.max(0, net - 500) * 0.312;
  check("hold matches hand calculation", Math.abs(r.values.at(-1)! - exp) < 1e-6, `${r.values.at(-1)!.toFixed(4)} vs ${exp.toFixed(4)}`);
  check("hold value before buy = 500", r.values[0] === 500);
}
// 2. No lookahead: running on truncated data gives identical values for every family
for (const [fam, p] of [[trend, 100], [cross, [20, 50]], [breakout, [55, 20]]] as const) {
  const full = simulate([bars], times, (fam as any).make(p, bars, new Map()), C, 500);
  const k = 1700, cut = bars.slice(0, k);
  const part = simulate([cut], times.slice(0, k), (fam as any).make(p, cut, new Map()), C, 500);
  check(`no lookahead: ${fam.id}`, part.values.every((v, i) => Math.abs(v - full.values[i]) < 1e-9));
}
{ // rotation no-lookahead
  const a = [bars, series(3000, t0, DAY, 0.05, 0.001)];
  const full = simulate(a, times, rotation.make(30, a), C, 500);
  const cut = a.map(x => x.slice(0, 1500));
  const part = simulate(cut, times.slice(0, 1500), rotation.make(30, cut), C, 500);
  check("no lookahead: rotation", part.values.every((v, i) => Math.abs(v - full.values[i]) < 1e-9), `entries ${full.entries}`);
}
{ // current bot on 15m bars, no lookahead
  const b15 = series(20000, t0, 9e5, 0.004, 0);
  const full = simulate([b15], b15.map(b => b.t), currentBot.make(null, b15, new Map()), C, 500);
  const cut = b15.slice(0, 12000);
  const part = simulate([cut], cut.map(b => b.t), currentBot.make(null, cut, new Map()), C, 500);
  check("no lookahead: current bot", part.values.every((v, i) => Math.abs(v - full.values[i]) < 1e-9), `entries ${full.entries}`);
}
// 3. Tax/TDS: one profitable round trip, then settle on Aug 1 of next FY
{
  const b: Bar[] = Array.from({ length: 600 }, (_, i) => ({ t: Date.UTC(2020, 3, 1) + i * DAY, open: i < 10 ? 100 : 200, high: 200, low: 100, close: i < 10 ? 100 : 200 }));
  const r = simulate([b], b.map(x => x.t), (i) => (i < 20 ? 0 : -1), C, 500); // buy bar1 @100, sell bar21 @200
  const qty = 500 * 0.999 / (100 * 1.0005), gross = qty * 200 * 0.9995, fee = gross * 0.001, tds = gross * 0.01, gain = gross - fee - 500;
  const cashAfterSale = gross - fee - tds;
  const afterSettle = cashAfterSale + tds - gain * 0.312;
  const settleIdx = b.findIndex(x => x.t >= Date.UTC(2021, 7, 1));
  check("value right after sale = after-tax", Math.abs(r.values[25] - afterSettle) < 1e-6, `${r.values[25].toFixed(4)} vs ${afterSettle.toFixed(4)}`);
  check("value unchanged by settlement", Math.abs(r.values[settleIdx] - r.values[settleIdx - 1]) < 1e-9);
  check("tax paid recorded", Math.abs(r.taxPaid - gain * 0.312) < 1e-6, r.taxPaid.toFixed(4));
}
// 4. Losses don't offset gains: win then loss in same FY -> tax on win only
{
  const px = (i: number) => (i < 10 ? 100 : i < 30 ? 150 : i < 40 ? 150 : 100);
  const b: Bar[] = Array.from({ length: 80 }, (_, i) => ({ t: Date.UTC(2021, 4, 1) + i * DAY, open: px(i), high: 999, low: 1, close: px(i) }));
  const dec = (i: number) => (i < 20 ? 0 : i < 35 ? -1 : i < 45 ? 0 : -1); // win 100->150, buy 150 sell 100
  const r = simulate([b], b.map(x => x.t), dec, C, 500);
  check("two entries", r.entries === 2);
  check("loss not offset (value < naive net)", r.values.at(-1)! < 500 * 1.5 * (100 / 150), r.values.at(-1)!.toFixed(2));
}
// 5. Walk-forward picks only use the past: cutting off future data doesn't change past picks
{
  const c1 = toDaily(times, simulate([bars], times, trend.make(50, bars, new Map()), C, 500).values);
  const c2 = toDaily(times, simulate([bars], times, trend.make(200, bars, new Map()), C, 500).values);
  const cut = (c: Curve, before: number): Curve => { const k = c.days.filter((d) => d < before).length; return { days: c.days.slice(0, k), values: c.values.slice(0, k) }; };
  const full = choosePicks([c1, c2], ["50", "200"], Date.UTC(2020, 0, 1));
  const part = choosePicks([cut(c1, Date.UTC(2022, 0, 1)), cut(c2, Date.UTC(2022, 0, 1))], ["50", "200"], Date.UTC(2020, 0, 1));
  check("walk-forward picks stable under future changes", JSON.stringify(full.slice(0, 2)) === JSON.stringify(part.slice(0, 2)), full.map((p) => `${p.year}:${p.label}`).join(" "));
}
// 6. Fresh start: hold from a later date matches a hand calculation from THAT date's price
{
  const s0 = Date.UTC(2020, 0, 1), k = bars.findIndex((b) => b.t >= s0);
  const r = simulate([bars], times, () => 0, C, 500, s0);
  check("no trading before start", r.values.slice(0, k).every((v) => v === 500) && r.entryTimes[0] === bars[k].t);
  const qty = (500 * 0.999) / (bars[k].open * 1.0005);
  const net = qty * bars.at(-1)!.close * 0.9995 * 0.999;
  const exp = net - Math.max(0, net - 500) * 0.312;
  check("fresh-start hold matches hand calculation", Math.abs(r.values.at(-1)! - exp) < 1e-6, `${r.values.at(-1)!.toFixed(2)} vs ${exp.toFixed(2)}`);
}
// 7. After tax, doubling ₹500 needs the price to rise ~2.45x (not 2x)
{
  const b: Bar[] = Array.from({ length: 900 }, (_, i) => { const p = 100 * Math.pow(3, i / 800); return { t: Date.UTC(2021, 0, 1) + i * DAY, open: p, high: p, low: p, close: p }; });
  const tt = b.map((x) => x.t);
  const st = rollingStats((s) => {
    const r = simulate([b], tt, () => 0, C, 500, s);
    const i0 = tt.findIndex((t) => t >= s);
    return { days: [s - DAY, ...tt.slice(i0)], values: [500, ...r.values.slice(i0)] };
  }, tt[0], tt.at(-1)!, 500);
  const expDays = 800 * Math.log(2.45 / 1.0) / Math.log(3); // price must rise ~2.45x (+ costs)
  check("doubling after tax needs ~2.45x price", st.medianDaysToDouble !== null && Math.abs(st.medianDaysToDouble - expDays) < 15, `${st.medianDaysToDouble} days vs ~${expDays.toFixed(0)}`);
}
// 8. Metrics sanity on a known curve: doubles smoothly over 2 years
{
  const days = Array.from({ length: 1100 }, (_, i) => t0 + i * DAY);
  const m = metrics({ days, values: days.map((_, i) => 500 * Math.pow(2, i / 730)) });
  check("CAGR of 2x over 2y ≈ 41.4%", Math.abs(m.cagrPct - 41.42) < 0.2, m.cagrPct.toFixed(2));
  check("no drawdown", m.maxDrawdownPct === 0 && m.lowestValue === 500);
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
if (!ok) process.exit(1);

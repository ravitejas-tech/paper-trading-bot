// npm run research   → test every rule on every coin with real history and write the results.
// Output: SITE_DATA_DIR/research.json (dashboard "Research" tab) and DATA_DIR/research_report.md

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { fetchHistory } from "../market.js";
import { choosePicks, Curve, Metrics, RollingStats, DAY, dayKey, metrics, rollingStats, toDaily, weekly } from "./analyze.js";
import { currentBot, rotation, SINGLE_COIN_FAMILIES, SingleCoinFamily } from "./families.js";
import { Bar, Costs, Decider, simulate, SimResult } from "./sim.js";

const COINS: [string, string][] = [
  ["BTCUSDT", "BTC"],
  ["ETHUSDT", "ETH"],
  ["BNBUSDT", "BNB"],
  ["SOLUSDT", "SOL"],
  ["XRPUSDT", "XRP"],
];
const TEST_FROM = Date.UTC(2020, 0, 1);
const START = config.startingCapitalInr;
const COSTS: Costs = { feeRate: config.feeRate, slippageRate: config.slippageRate, tdsRate: config.tdsRate, taxRate: 0.312 };

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function loadBars(symbol: string, interval: string, from: number): Promise<Bar[]> {
  const candles = await fetchHistory(symbol, interval, from, Date.now());
  return candles.map((c) => ({ t: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close }));
}

async function loadFearGreed(): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=0&format=json", { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json()) as { data: { value: string; timestamp: string }[] };
    for (const r of j.data) m.set(dayKey(Number(r.timestamp) * 1000), Number(r.value));
  } catch (err) {
    log("Fear & Greed index unavailable:", (err as Error).message);
  }
  return m;
}

/** Entries per year and share of days in the market over [from, to), for one simulation. */
function activity(sim: SimResult, from: number, to = Infinity) {
  const entries = sim.entryTimes.filter((t) => t >= from && t < to).length;
  let n = 0, held = 0;
  for (let i = 0; i < sim.times.length; i++) {
    if (sim.times[i] < from || sim.times[i] >= to) continue;
    n++;
    held += sim.held[i];
  }
  return { entries, heldFrac: n ? held / n : 0, years: n ? (Math.min(to, sim.times[sim.times.length - 1]) - from) / (365.25 * DAY) : 0 };
}

interface Row {
  id: string;
  name: string;
  why: string;
  settings: string;
  picks: { year: number; label: string }[];
  metrics: Metrics & RollingStats & { tradesPerYear: number; inMarketPct: number };
  hindsight?: { label: string; multiple: number; cagrPct: number; maxDrawdownPct: number };
  curve: [number, number][];
}

/** Daily curve of a simulation from `startAt`, beginning with the untouched starting amount. */
function fromStart(sim: SimResult, startAt: number): Curve {
  let lo = 0, hi = sim.times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sim.times[mid] < startAt) lo = mid + 1; else hi = mid; }
  const days = [dayKey(startAt) - DAY], values = [START];
  for (let i = lo; i < sim.times.length; i++) {
    const d = dayKey(sim.times[i]);
    if (d === days[days.length - 1]) values[values.length - 1] = sim.values[i];
    else { days.push(d); values.push(sim.values[i]); }
  }
  return { days, values };
}

type Fam = { id: string; name: string; why: string; params: any[]; label: (p: any) => string };

/**
 * Evaluate one rule honestly from `testFrom`: settings re-picked each year from past data only,
 * one continuous simulation (so tax and TDS are exact), plus a fresh simulation for every
 * weekly start date to answer "what if I had started then?".
 */
function evaluateFamily(fam: Fam, assets: (Bar | null)[][], times: number[], deciders: Decider[], testFrom: number): Row {
  const labels = fam.params.map((p) => fam.label(p));
  const lastDay = dayKey(times[times.length - 1]);
  let decider: Decider = deciders[0];
  let picks: { year: number; label: string }[] = [];
  let hindsight: Row["hindsight"];

  if (deciders.length > 1) {
    const full = deciders.map((d) => toDaily(times, simulate(assets, times, d, COSTS, START).values));
    const ps = choosePicks(full, labels, testFrom);
    picks = ps.map(({ year, label }) => ({ year, label }));
    const byYear = new Map(ps.map((p) => [p.year, p.idx]));
    decider = (i, ctx) => deciders[byYear.get(new Date(times[i]).getUTCFullYear()) ?? ps[0].idx](i, ctx);

    // Best settings in hindsight (cheating: chosen after seeing the whole test period).
    let best: Curve | null = null, bestIdx = 0;
    deciders.forEach((d, idx) => {
      const c = fromStart(simulate(assets, times, d, COSTS, START, testFrom), testFrom);
      if (!best || c.values[c.values.length - 1] > best.values[best.values.length - 1]) { best = c; bestIdx = idx; }
    });
    const hm = metrics(best!);
    hindsight = { label: labels[bestIdx], multiple: hm.multiple, cagrPct: hm.cagrPct, maxDrawdownPct: hm.maxDrawdownPct };
  }

  const runFrom = (s: number) => fromStart(simulate(assets, times, decider, COSTS, START, s), s);
  const mainSim = simulate(assets, times, decider, COSTS, START, testFrom);
  const curve = fromStart(mainSim, testFrom);
  const act = activity(mainSim, testFrom);
  const m = metrics(curve, {
    ...rollingStats(runFrom, testFrom, lastDay, START),
    tradesPerYear: act.years ? act.entries / act.years : 0,
    inMarketPct: act.heldFrac * 100,
  });

  return {
    id: fam.id,
    name: fam.name,
    why: fam.why,
    settings: deciders.length === 1 ? labels[0] : "re-chosen each year from the previous 2 years",
    picks,
    metrics: m,
    hindsight,
    curve: weekly(curve),
  };
}

async function main() {
  log("Loading Fear & Greed index...");
  const fng = await loadFearGreed();
  log(`Fear & Greed days: ${fng.size}`);

  const daily = new Map<string, Bar[]>();
  for (const [sym, coin] of COINS) {
    daily.set(coin, await loadBars(sym, "1d", Date.UTC(2017, 0, 1)));
    log(`${coin}: ${daily.get(coin)!.length} daily candles from ${new Date(daily.get(coin)![0].t).toISOString().slice(0, 10)}`);
  }

  // Rotation across all coins on one aligned daily timeline.
  const allDays = [...new Set([...daily.values()].flatMap((bars) => bars.map((b) => b.t)))].sort((a, b) => a - b);
  const aligned = COINS.map(([, coin]) => {
    const byDay = new Map(daily.get(coin)!.map((b) => [b.t, b]));
    return allDays.map((d) => byDay.get(d) ?? null);
  });
  const rotDeciders = rotation.params.map((l) => rotation.make(l, aligned));

  // The live bot's rules on 15-minute BTC candles.
  log("Loading 15-minute BTC candles for the current bot (takes a minute)...");
  const btc15 = await loadBars("BTCUSDT", "15m", TEST_FROM - 30 * DAY);
  log(`BTC 15m: ${btc15.length} candles`);
  const btc15Times = btc15.map((b) => b.t);
  const currentDecider = currentBot.make(null, btc15, fng);

  const coins: { coin: string; symbol: string; testFrom: string; rows: Row[] }[] = [];
  for (const [sym, coin] of COINS) {
    const bars = daily.get(coin)!;
    const times = bars.map((b) => b.t);
    const testFrom = Math.max(TEST_FROM, Date.UTC(new Date(bars[0].t + 365 * DAY).getUTCFullYear() + 1, 0, 1));
    const rows: Row[] = [];

    for (const fam of SINGLE_COIN_FAMILIES as SingleCoinFamily[]) {
      if (fam.id === "fear" && fng.size === 0) continue;
      const deciders = fam.params.map((p) => fam.make(p, bars, fng));
      rows.push(evaluateFamily(fam, [bars], times, deciders, testFrom));
    }
    rows.push(evaluateFamily({ ...rotation, name: "Rotation (strongest of 5 coins)" }, aligned, allDays, rotDeciders, testFrom));
    if (coin === "BTC") rows.push(evaluateFamily(currentBot, [btc15], btc15Times, [currentDecider], testFrom));

    log(`${coin} done (test from ${new Date(testFrom).toISOString().slice(0, 10)})`);
    coins.push({ coin, symbol: sym, testFrom: new Date(testFrom).toISOString().slice(0, 10), rows });
  }

  // Which rules beat simply holding, coin by coin?
  const summary = [...new Set(coins.flatMap((c) => c.rows.map((r) => r.id)))]
    .filter((id) => id !== "hold")
    .map((id) => {
      const per = coins.flatMap((c) => {
        const r = c.rows.find((x) => x.id === id), h = c.rows.find((x) => x.id === "hold")!;
        return r ? [{ coin: c.coin, beat: r.metrics.multiple > h.metrics.multiple, shallower: r.metrics.maxDrawdownPct > h.metrics.maxDrawdownPct }] : [];
      });
      const name = coins.flatMap((c) => c.rows).find((r) => r.id === id)!.name;
      return {
        id, name,
        beatHold: per.filter((p) => p.beat).map((p) => p.coin),
        shallowerDrop: per.filter((p) => p.shallower).map((p) => p.coin),
        testedOn: per.map((p) => p.coin),
      };
    });

  const out = {
    updatedAt: new Date().toISOString(),
    startInr: START,
    costs: COSTS,
    fearGreedAvailable: fng.size > 0,
    coins,
    summary,
  };

  if (config.siteDataDir) {
    fs.mkdirSync(config.siteDataDir, { recursive: true });
    fs.writeFileSync(path.join(config.siteDataDir, "research.json"), JSON.stringify(out));
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(path.join(config.dataDir, "research_report.md"), report(out));
  console.log("\n" + report(out));
}

function report(out: { coins: { coin: string; testFrom: string; rows: Row[] }[]; summary: any[] }): string {
  const f = (x: number, d = 0) => x.toLocaleString("en-IN", { maximumFractionDigits: d });
  const lines = [`# Research results (${new Date().toISOString().slice(0, 10)})`, "", `Start ₹${START}, all costs and Indian tax included. Settings chosen walk-forward (past data only).`, ""];
  for (const c of out.coins) {
    lines.push(`## ${c.coin} (from ${c.testFrom})`, "", "| Rule | ₹500 → | Lowest | Worst drop | 2x within 1y | Median days to 2x | Trades/yr |", "|---|---|---|---|---|---|---|");
    for (const r of c.rows) {
      const m = r.metrics;
      lines.push(`| ${r.name} | ₹${f(m.finalValue)} | ₹${f(m.lowestValue)} | ${f(m.maxDrawdownPct)}% | ${f(m.doubledWithin1yPct)}% | ${m.medianDaysToDouble ?? "never"} | ${f(m.tradesPerYear, 1)} |`);
    }
    lines.push("");
  }
  lines.push("## Beat buy & hold?", "");
  for (const s of out.summary) lines.push(`- ${s.name}: more money on ${s.beatHold.join(", ") || "none"}; smaller worst drop on ${s.shallowerDrop.join(", ") || "none"} (tested: ${s.testedOn.join(", ")})`);
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error("Research failed:", err);
  process.exit(1);
});

// npm run research   → test every rule on every coin with real history and write the results.
// Output: SITE_DATA_DIR/research.json (dashboard "Research" tab) and DATA_DIR/research_report.md

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { fetchHistory } from "../market.js";
import { Curve, DAY, dayKey, metrics, rebase, toDaily, walkForward, weekly } from "./analyze.js";
import { currentBot, rotation, SINGLE_COIN_FAMILIES, SingleCoinFamily } from "./families.js";
import { Bar, Costs, simulate, SimResult } from "./sim.js";

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
  metrics: ReturnType<typeof metrics> & { tradesPerYear: number; inMarketPct: number };
  hindsight?: { label: string; multiple: number; cagrPct: number; maxDrawdownPct: number };
  curve: [number, number][];
}

/** Run one family (all its settings) and evaluate it honestly from `testFrom`. */
function evaluateFamily(
  fam: { id: string; name: string; why: string; params: any[]; label: (p: any) => string },
  sims: SimResult[],
  testFrom: number,
): Row {
  const curves = sims.map((s) => toDaily(s.times, s.values));
  const labels = fam.params.map((p) => fam.label(p));

  let curve: Curve, picks: { year: number; label: string }[] = [], hindsight: Row["hindsight"];
  let entries = 0, heldDays = 0, totalYears = 0;

  if (sims.length === 1) {
    curve = rebase(curves[0], testFrom, START);
    const a = activity(sims[0], testFrom);
    entries = a.entries; heldDays = a.heldFrac * a.years; totalYears = a.years;
  } else {
    const wf = walkForward(curves, labels, testFrom, START);
    curve = wf.curve;
    picks = wf.picks;
    for (const p of picks) {
      const idx = labels.indexOf(p.label);
      if (idx < 0) continue;
      const a = activity(sims[idx], Math.max(testFrom, Date.UTC(p.year, 0, 1)), Date.UTC(p.year + 1, 0, 1));
      entries += a.entries; heldDays += a.heldFrac * a.years; totalYears += a.years;
    }
    // Best settings in hindsight (cheating: chosen after seeing the whole test period).
    let bestIdx = 0, bestM = -Infinity;
    curves.forEach((c, i) => {
      const r = rebase(c, testFrom, START);
      const m = r.values[r.values.length - 1] / START;
      if (m > bestM) { bestM = m; bestIdx = i; }
    });
    const hm = metrics(rebase(curves[bestIdx], testFrom, START));
    hindsight = { label: labels[bestIdx], multiple: hm.multiple, cagrPct: hm.cagrPct, maxDrawdownPct: hm.maxDrawdownPct };
  }

  const m = metrics(curve);
  return {
    id: fam.id,
    name: fam.name,
    why: fam.why,
    settings: sims.length === 1 ? labels[0] : "re-chosen each year from the previous 2 years",
    picks,
    metrics: { ...m, tradesPerYear: totalYears ? entries / totalYears : 0, inMarketPct: totalYears ? (heldDays / totalYears) * 100 : 0 },
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
  const rotSims = rotation.params.map((l) => simulate(aligned, allDays, rotation.make(l, aligned), COSTS, START));

  // The live bot's rules on 15-minute BTC candles.
  log("Loading 15-minute BTC candles for the current bot (takes a minute)...");
  const btc15 = await loadBars("BTCUSDT", "15m", TEST_FROM - 30 * DAY);
  log(`BTC 15m: ${btc15.length} candles`);
  const currentSim = simulate([btc15], btc15.map((b) => b.t), currentBot.make(null, btc15, fng), COSTS, START);

  const coins: { coin: string; symbol: string; testFrom: string; rows: Row[] }[] = [];
  for (const [sym, coin] of COINS) {
    const bars = daily.get(coin)!;
    const times = bars.map((b) => b.t);
    const testFrom = Math.max(TEST_FROM, Date.UTC(new Date(bars[0].t + 365 * DAY).getUTCFullYear() + 1, 0, 1));
    const rows: Row[] = [];

    for (const fam of SINGLE_COIN_FAMILIES as SingleCoinFamily[]) {
      if (fam.id === "fear" && fng.size === 0) continue;
      const sims = fam.params.map((p) => simulate([bars], times, fam.make(p, bars, fng), COSTS, START));
      rows.push(evaluateFamily(fam, sims, testFrom));
    }
    rows.push(evaluateFamily({ ...rotation, name: "Rotation (strongest of 5 coins)" }, rotSims, testFrom));
    if (coin === "BTC") rows.push(evaluateFamily(currentBot, [currentSim], testFrom));

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

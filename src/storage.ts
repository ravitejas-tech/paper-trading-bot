// CSV logs + a JSON state file so the live bot can be stopped and resumed.

import fs from "node:fs";
import path from "node:path";
import type { Decision } from "./session.js";
import { EquityPoint, Trade } from "./stats.js";

const TRADE_COLS: (keyof Trade)[] = [
  "time", "side", "priceUsdt", "priceInr", "qty", "valueInr", "feeInr", "tdsInr", "gainInr", "reason", "cashAfterInr",
];
const EQUITY_COLS = ["time", "priceUsdt", "valueInr", "holdInr"];
const DECISION_COLS: (keyof Decision)[] = ["at", "candle", "hold", "action", "priceUsdt", "reason"];

/** Files that belong to the live session (moved aside when a new session starts). */
const LIVE_FILES = ["state.json", "trades.csv", "equity.csv", "decisions.csv", "live_report.txt"];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class Storage {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(name: string) {
    return path.join(this.dir, name);
  }

  private appendRow(name: string, header: string[], row: unknown[]) {
    const f = this.file(name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, header.join(",") + "\n");
    fs.appendFileSync(f, row.map(csvCell).join(",") + "\n");
  }

  logTrade(t: Trade, prefix = "") {
    this.appendRow(`${prefix}trades.csv`, TRADE_COLS, TRADE_COLS.map((c) => t[c]));
  }

  logEquity(p: EquityPoint, prefix = "") {
    this.appendRow(`${prefix}equity.csv`, EQUITY_COLS, [p.time, p.priceUsdt, p.valueInr.toFixed(4), p.holdInr.toFixed(4)]);
  }

  logDecision(d: Decision) {
    this.appendRow("decisions.csv", DECISION_COLS, DECISION_COLS.map((c) => d[c]));
  }

  /** Overwrite a CSV in one go (used by backtests so each run starts clean). */
  writeAll(prefix: string, trades: Trade[], equity: EquityPoint[]) {
    for (const n of ["trades.csv", "equity.csv"]) fs.rmSync(this.file(prefix + n), { force: true });
    trades.forEach((t) => this.logTrade(t, prefix));
    equity.forEach((p) => this.logEquity(p, prefix));
  }

  loadState<T>(): T | null {
    const f = this.file("state.json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }

  saveState(state: unknown) {
    const f = this.file("state.json");
    fs.writeFileSync(f + ".tmp", JSON.stringify(state, null, 2));
    fs.renameSync(f + ".tmp", f);
  }

  /** Move the live session's files to archive/<time>/ so a new session starts clean. */
  archive(): string {
    const dest = path.join(this.dir, "archive", new Date().toISOString().slice(0, 16).replace(":", "-"));
    fs.mkdirSync(dest, { recursive: true });
    for (const n of LIVE_FILES) if (fs.existsSync(this.file(n))) fs.renameSync(this.file(n), path.join(dest, n));
    return dest;
  }

  readEquity(prefix = ""): EquityPoint[] {
    const f = this.file(`${prefix}equity.csv`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, "utf8").trim().split("\n").slice(1).map((line) => {
      const [time, price, value, hold] = line.split(",");
      return { time, priceUsdt: Number(price), valueInr: Number(value), holdInr: Number(hold) };
    });
  }

  writeText(name: string, text: string) {
    fs.writeFileSync(this.file(name), text);
  }
}

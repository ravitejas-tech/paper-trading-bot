// CSV logs + a JSON state file so the live bot can be stopped and resumed.

import fs from "node:fs";
import path from "node:path";
import { BrokerState, Trade } from "./paperBroker.js";
import { EquityPoint } from "./stats.js";

const TRADE_COLS: (keyof Trade)[] = [
  "time", "side", "priceUsdt", "priceInr", "qty", "valueInr", "feeInr", "tdsInr", "pnlInr", "reason", "cashAfterInr",
];

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
    this.appendRow(`${prefix}equity.csv`, ["time", "priceUsdt", "equityInr"], [p.time, p.priceUsdt, p.equityInr.toFixed(4)]);
  }

  /** Overwrite a CSV in one go (used by backtests so each run starts clean). */
  writeAll(prefix: string, trades: Trade[], equity: EquityPoint[]) {
    for (const n of ["trades.csv", "equity.csv"]) fs.rmSync(this.file(prefix + n), { force: true });
    trades.forEach((t) => this.logTrade(t, prefix));
    equity.forEach((p) => this.logEquity(p, prefix));
  }

  loadState(): { broker: BrokerState; lastCandleTime: number; lastAction?: string } | null {
    const f = this.file("state.json");
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }

  saveState(broker: BrokerState, lastCandleTime: number, lastAction = "") {
    const f = this.file("state.json");
    fs.writeFileSync(f + ".tmp", JSON.stringify({ broker, lastCandleTime, lastAction }, null, 2));
    fs.renameSync(f + ".tmp", f);
  }

  readEquity(prefix = ""): EquityPoint[] {
    const f = this.file(`${prefix}equity.csv`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, "utf8").trim().split("\n").slice(1).map((line) => {
      const [time, price, eq] = line.split(",");
      return { time, priceUsdt: Number(price), equityInr: Number(eq) };
    });
  }

  writeText(name: string, text: string) {
    fs.writeFileSync(this.file(name), text);
  }
}

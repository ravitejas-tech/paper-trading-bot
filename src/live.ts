// npm run live   → paper-trade on live market data on your own computer.
// Ctrl+C to stop; run again to resume. No real money, no real orders.

import { LiveSession } from "./session.js";

const EVERY_MS = 60 * 60_000; // the rule decides on daily candles; an hourly check is plenty

const session = new LiveSession();

async function loop() {
  try {
    await session.tick();
  } catch (err) {
    console.error("Data fetch failed, will retry next hour:", (err as Error).message);
  }
  setTimeout(loop, EVERY_MS);
}

process.on("SIGINT", () => {
  session.save();
  console.log(`\nStopped. State saved; run "npm run live" again to resume. "npm run report" for results.`);
  process.exit(0);
});

loop();

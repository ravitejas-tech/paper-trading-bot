// npm run live   → paper-trade on live market data on your own computer.
// Ctrl+C to stop; run again to resume. No real money, no real orders.

import { config } from "./config.js";
import { intervalToMs } from "./market.js";
import { LiveSession } from "./session.js";

const session = new LiveSession();

/** Wait until just after the next candle closes. */
function msUntilNextCandle(): number {
  const step = intervalToMs(config.interval);
  return step - (Date.now() % step) + 3_000;
}

async function loop() {
  try {
    await session.tick();
  } catch (err) {
    console.error("Data fetch failed, will retry next candle:", (err as Error).message);
  }
  setTimeout(loop, msUntilNextCandle());
}

process.on("SIGINT", () => {
  session.save();
  console.log(`\nStopped. State saved; run "npm run live" again to resume. "npm run report" for results.`);
  process.exit(0);
});

loop();

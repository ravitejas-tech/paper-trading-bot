// npm run tick   → run ONE step of the live paper session and exit.
// GitHub Actions calls this every 15 minutes, so the bot runs without your computer.

import { LiveSession } from "./session.js";

const session = new LiveSession();
try {
  await session.tick();
} catch (err) {
  const msg = (err as Error).message;
  console.error("Tick failed:", msg);
  session.save(`Last check failed: ${msg.split("\n")[0]}`);
  process.exitCode = 1;
}

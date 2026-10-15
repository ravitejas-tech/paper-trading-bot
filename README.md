# Paper Trading Bot

A free paper-trading bot. It uses **live crypto prices** (Binance's public API, with Coinbase as a backup), trades a **simulated ₹500 wallet**, logs every trade, and shows the results on a **mobile-friendly dashboard**.

**No real money moves. No real orders are placed.**

📱 **Dashboard:** https://ravitejas-tech.github.io/paper-trading-bot/

## How it runs (no computer needed)

GitHub Actions runs the bot every 15 minutes on GitHub's servers, which is free for public repos:

1. Fetches the latest closed BTC candle.
2. Decides BUY / SELL / HOLD and updates the paper wallet.
3. Saves the wallet and trade history to the **`bot-data`** branch.
4. Re-runs a 90-day backtest once a day.
5. Republishes the dashboard.

From your phone you can:
- **Open the dashboard** to see wallet value vs buy & hold, open position, stats and every trade.
- **Run it now:** Actions tab → *Paper bot* → *Run workflow*.
- **Pause it:** Actions tab → *Paper bot* → ⋯ → *Disable workflow*.
- **Change settings:** edit `src/config.ts` on github.com. The next run uses the new values.
- **Start over:** delete the `bot-data` branch.

> GitHub's 15-minute schedule is best effort; runs can be a few minutes late. Candles the bot missed by more than an hour are recorded but never traded, since it couldn't have acted on them in real life. GitHub pauses schedules in repos with no activity for 60 days; if that happens, re-enable the workflow in the Actions tab.

## Run it on a computer instead (optional)

Needs Node.js 18+.

```bash
npm install
npm run backtest          # test on the last 90 days (or: npm run backtest -- 365)
npm run live              # paper-trade continuously; Ctrl+C to stop, run again to resume
npm run report            # summary of the live session
```

Output goes to `data/`.

## How it decides

The strategy (`src/strategy.ts`) is a simple, well-known starting point, not a money-maker:

- **Buy** when the 9-period EMA crosses above the 21-period EMA, unless RSI is above 70 (overbought).
- **Sell** on the opposite crossover, at a 2% stop-loss, or at a 4% take-profit.

All numbers live in `src/config.ts`. Change one thing at a time and compare backtests.

## Realistic costs are built in

| Cost | Default | Notes |
|---|---|---|
| Exchange fee | 0.1% per buy and per sell | `feeRate` |
| Slippage | 0.05% worse than the candle close | `slippageRate` |
| TDS (India, crypto) | 1% of every sale | Withheld from cash, so the bot can't trade it. Counted in wallet value because it's credited back at tax time. |
| Income tax (India, crypto) | 30% + 4% cess on each winning trade | Losses can't offset gains. Shown as "After tax". |

## When is it "working"?

Don't trust a strategy until all of these are true:

1. It **beats buy & hold** (the dashboard shows both).
2. The backtest is profitable over **6–12 months**, not one lucky stretch.
3. **Live paper results roughly match the backtest** for at least 4–8 weeks.
4. The worst drop (max drawdown) is something you could stomach with real money.
5. It's still profitable **after tax**.

Even then, start real money small, and expect real results to be worse than paper.

## Project layout

```
.github/workflows/bot.yml   the 15-minute scheduled run + dashboard deploy
dashboard/index.html        mobile dashboard (reads data/live.json, data/backtest.json)
src/
  config.ts       all settings
  market.ts       free market data (Binance → Coinbase fallback)
  indicators.ts   EMA, RSI
  strategy.ts     the trading rules: edit this to try new ideas
  paperBroker.ts  simulated wallet in INR
  session.ts      one live step: fetch, decide, log, save
  tick.ts         npm run tick (one step, used by GitHub Actions)
  live.ts         npm run live (loops on your computer)
  backtest.ts     npm run backtest
  report.ts       npm run report
  stats.ts        win rate, drawdown, tax estimate
  site.ts         writes the dashboard JSON
  storage.ts      CSV logs + resumable state
```

*Educational project, not financial advice.*

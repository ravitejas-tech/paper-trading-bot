# Paper Trading Bot

A free paper-trading bot. It uses **live crypto prices** (Binance's public API, with Coinbase as a backup), trades a **simulated ₹500 wallet** with a slow, research-tested rule, logs every trade, and shows the results on a **mobile-friendly dashboard**.

**No real money moves. No real orders are placed.**

📱 **Dashboard:** https://ravitejas-tech.github.io/paper-trading-bot/

## How it runs (no computer needed)

GitHub Actions runs the bot about every hour on GitHub's servers, which is free for public repos:

1. Fetches the latest closed daily BTC candles and the current price.
2. If the rule made a new decision since the last run, trades at the current price.
3. Saves the wallet and trade history to the **`bot-data`** branch.
4. Re-runs the backtest once a day and the research lab once a week.
5. Republishes the dashboard.

From your phone you can:
- **Open the dashboard** to see the wallet (after tax) vs buy & hold, the open position, stats and every trade.
- **Run it now:** Actions tab → *Paper bot* → *Run workflow*.
- **Pause it:** Actions tab → *Paper bot* → ⋯ → *Disable workflow*.
- **Change settings:** edit `src/config.ts` on github.com. Changing the rule or coin starts a new session; the old one is moved to `state/archive/` on the `bot-data` branch.
- **Start over:** delete the `bot-data` branch.

> GitHub's schedule is best effort: runs are often late and some are skipped. That's fine here. The rule decides on daily candles, so a late run just acts a little later, at the price then, and never misses a decision. GitHub pauses schedules in repos with no activity for 60 days; if that happens, re-enable the workflow in the Actions tab.

## How it decides

The live rule (`src/rules.ts`, set in `src/config.ts`) is **365-day momentum, checked weekly**:

- After each Sunday's daily close (Monday 05:30 IST), **hold BTC if it's worth more than it was 365 days ago; otherwise hold cash.**
- That's it. No stop-loss, no take-profit. It trades about once a year.

Two other rules are one setting away: `"trend"` (hold while above the N-day average) and `"hold"` (buy once, never sell).

### Why this rule, and what to expect

The bot used to trade EMA crossovers on 15-minute candles. Tested the same way as everything else, it turned ₹500 into about ₹35: roughly 840 trades a year, each paying fees and locking 1% TDS. **Under Indian crypto tax, frequent trading can't win**: every sale locks 1% TDS until the refund, and 31.2% of every winning sale goes to tax with no loss offset, while buy & hold pays tax only once, at the end.

So the rule was picked by testing ~20 slow, well-known rules on 12 coins, choosing on 5 coins up to 2023 and then checking on 2024–26 and on 7 coins it was never chosen on. What that showed (October 2026):

- **No rule reliably made more money than simply buying and holding.** Rules that looked best up to 2023 fell behind holding on 2024–26 and on the unseen coins.
- **Slow rules did reliably cut the worst drops**: typically −50% to −65% instead of −75% to −90%.
- For BTC since 2020, the live rule turned ₹500 into **₹4,743 after tax vs ₹4,076 for holding**, with a worst drop of **−50% vs −73%**. But that's only 4 round trips, and the same idea with its setting re-picked each year (the *Momentum (weekly)* row in Research) made ₹2,564. Treat it as "smaller drops, about the same money", not a proven edge.
- Holding BTC was profitable after tax for **every** 3-year period since 2019, but only for 76% of 2-year periods. Time in the market mattered more than any rule.

## Research tab: which rules actually work?

`npm run research` (run weekly on GitHub) tests several rules on real daily prices since 2020 for BTC, ETH, BNB, SOL and XRP:

| Rule | Idea |
|---|---|
| Buy & hold | Benchmark: buy once, never sell |
| Trend filter | Hold only while price is above its N-day average |
| Average crossover | Hold while a fast average is above a slow one |
| Breakout | Buy new N-day highs, sell new M-day lows |
| Momentum (weekly) | Hold while the price is above where it was N days ago |
| Fear & Greed | Buy when the market mood index shows fear, sell on greed |
| Rotation | Weekly, hold whichever of the 5 coins is strongest |
| Your live bot | The live bot's rule with its fixed settings |

How it stays honest:
- **No peeking:** decisions use a candle's close and trade at the next candle's open.
- **Walk-forward:** settings are re-chosen each year using only the previous 2 years. The best-in-hindsight settings are shown separately so you can see how much overfitting flatters results.
- **All costs:** fees, slippage, 1% TDS (refunded yearly), 30% + cess tax on each winning trade with no loss offset. Values assume you sold everything and paid the tax.
- **Your questions answered per rule:** what ₹500 became, its lowest point, the worst drop, how often it doubled within a year (across hundreds of start dates), and the typical wait to double.

`npm run verify` runs the engine's correctness checks: no lookahead, tax/TDS math against hand calculations, walk-forward picks that never use future data, and the live bot making exactly the same decisions as the simulator even when runs are skipped.

## Run it on a computer instead (optional)

Needs Node.js 18+.

```bash
npm install
npm run backtest          # test the live rule on daily candles since 2020
npm run live              # paper-trade, checking hourly; Ctrl+C to stop, run again to resume
npm run report            # summary of the live session
npm run research          # all rules on 5 coins (about 10 seconds)
npm run verify            # correctness checks
```

Output goes to `data/`.

## Realistic costs are built in

Live, backtest and research all count money with the same code (`src/wallet.ts`):

| Cost | Default | Notes |
|---|---|---|
| Exchange fee | 0.1% per buy and per sell | `feeRate` |
| Slippage | 0.05% worse than the market price | `slippageRate` |
| TDS (India, crypto) | 1% of every sale | Withheld from cash so the bot can't trade it; refunded on 1 Aug after the financial year (≈ your ITR refund). |
| Income tax (India, crypto) | 30% + 4% cess on each winning sale | Losses can't offset gains. Paid on 1 Aug after the financial year; every value shown already subtracts tax you'd owe if you sold now. |

## When is it "working"?

Don't trust a rule until all of these are true:

1. It **beats buy & hold after tax** (the dashboard shows both, with the same costs and tax).
2. It holds up on **other coins and later years**, not just the data it was picked on (the Research tab shows this).
3. **Live paper results roughly match the backtest** for months. With about one trade a year, that takes patience.
4. The worst drop is something you could stomach with real money.

Even then, start real money small, and expect real results to be worse than paper.

## Project layout

```
.github/workflows/bot.yml   the hourly scheduled run + dashboard deploy
dashboard/index.html        mobile dashboard (reads data/live.json, backtest.json, research.json)
src/
  config.ts       all settings: coin, rule, costs
  rules.ts        the trading rules (live, backtest and research all use these)
  wallet.ts       simulated wallet: fees, slippage, TDS, tax, yearly settlement
  market.ts       free market data (Binance → Coinbase fallback)
  indicators.ts   moving averages, highs and lows
  session.ts      one live check: fetch, decide, trade at the current price, log, save
  tick.ts         npm run tick (one check, used by GitHub Actions)
  live.ts         npm run live (loops on your computer)
  backtest.ts     npm run backtest
  report.ts       npm run report
  stats.ts        trade records, win rate, drawdown, tax summary
  site.ts         writes the dashboard JSON
  storage.ts      CSV logs + resumable state
  research/       the research lab (npm run research, npm run verify)
```

*Educational project, not financial advice.*

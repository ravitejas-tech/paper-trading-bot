// Free, public market data. No account or API key needed.
// Tries Binance first, then Coinbase (Binance blocks some regions, e.g. US cloud servers
// like GitHub Actions).

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

/** A price bar as the rules and the simulator see it. */
export interface Bar {
  t: number; // open time, ms
  open: number;
  high: number;
  low: number;
  close: number;
}

export const toBar = (c: Candle, scale = 1): Bar => ({
  t: c.openTime, open: c.open * scale, high: c.high * scale, low: c.low * scale, close: c.close * scale,
});

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export function intervalToMs(interval: string): number {
  const ms = INTERVAL_MS[interval];
  if (!ms) throw new Error(`Unsupported interval: ${interval} (use ${Object.keys(INTERVAL_MS).join(", ")})`);
  return ms;
}

/** Name of the source that served the most recent request. */
export let lastSource = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "paper-trading-bot", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

interface Source {
  name: string;
  /** Candles with openTime in [start, end), oldest first. */
  range(symbol: string, interval: string, start: number, end: number): Promise<Candle[]>;
  /** Latest traded price. */
  price(symbol: string): Promise<number>;
}

function binance(base: string): Source {
  return {
    name: `binance (${new URL(base).host})`,
    async range(symbol, interval, start, end) {
      const step = intervalToMs(interval);
      const out: Candle[] = [];
      let cursor = start;
      while (cursor < end) {
        const rows = (await getJson(
          `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${end - 1}&limit=1000`,
        )) as unknown[][];
        if (rows.length === 0) break;
        for (const r of rows) {
          out.push({
            openTime: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]),
            close: Number(r[4]), volume: Number(r[5]), closeTime: Number(r[6]),
          });
        }
        cursor = out[out.length - 1].openTime + step;
        if (rows.length < 1000) break;
        await sleep(200);
      }
      return out;
    },
    async price(symbol) {
      return Number(((await getJson(`${base}/api/v3/ticker/price?symbol=${symbol}`)) as { price: string }).price);
    },
  };
}

const COINBASE_GRANULARITY: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };

const coinbaseProduct = (symbol: string) => symbol.replace(/USDT$|USDC$|USD$/, "") + "-USD"; // BTCUSDT -> BTC-USD

const coinbase: Source = {
  name: "coinbase",
  async range(symbol, interval, start, end) {
    const gran = COINBASE_GRANULARITY[interval];
    if (!gran) throw new Error(`Coinbase has no ${interval} candles`);
    const product = coinbaseProduct(symbol);
    const step = gran * 1000;
    const byTime = new Map<number, Candle>();
    for (let s = start; s < end; s += 300 * step) {
      const e = Math.min(end, s + 300 * step);
      const rows = (await getJson(
        `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}` +
          `&start=${new Date(s).toISOString()}&end=${new Date(e - 1).toISOString()}`,
      )) as number[][];
      // [time(sec), low, high, open, close, volume], newest first
      for (const [t, low, high, open, close, volume] of rows) {
        const openTime = t * 1000;
        if (openTime < start || openTime >= end) continue;
        byTime.set(openTime, { openTime, open, high, low, close, volume, closeTime: openTime + step - 1 });
      }
      await sleep(350);
    }
    return [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
  },
  async price(symbol) {
    return Number(((await getJson(`https://api.exchange.coinbase.com/products/${coinbaseProduct(symbol)}/ticker`)) as { price: string }).price);
  },
};

const SOURCES: Source[] = [
  binance("https://data-api.binance.vision"),
  binance("https://api.binance.com"),
  coinbase,
];

let preferred = 0; // stick with whichever source worked last

async function fromAnySource<T>(fn: (s: Source) => Promise<T>, ok: (x: T) => boolean): Promise<T> {
  const errors: string[] = [];
  for (let k = 0; k < SOURCES.length; k++) {
    const idx = (preferred + k) % SOURCES.length;
    try {
      const x = await fn(SOURCES[idx]);
      if (!ok(x)) throw new Error("no data returned");
      preferred = idx;
      lastSource = SOURCES[idx].name;
      return x;
    } catch (err) {
      errors.push(`${SOURCES[idx].name}: ${(err as Error).message}`);
    }
  }
  throw new Error(`All market data sources failed:\n  ${errors.join("\n  ")}`);
}

/** Latest closed candles (the still-forming candle is dropped). */
export async function fetchRecentCandles(symbol: string, interval: string, limit = 200): Promise<Candle[]> {
  const step = intervalToMs(interval);
  const currentOpen = Math.floor(Date.now() / step) * step;
  return fromAnySource((s) => s.range(symbol, interval, currentOpen - limit * step, currentOpen), (c) => c.length > 0);
}

/** Historical closed candles over a date range. */
export async function fetchHistory(symbol: string, interval: string, startTime: number, endTime: number): Promise<Candle[]> {
  const step = intervalToMs(interval);
  const end = Math.min(endTime, Math.floor(Date.now() / step) * step);
  return fromAnySource((s) => s.range(symbol, interval, startTime, end), (c) => c.length > 0);
}

/** Latest traded price (what a market order would fill near right now). */
export async function fetchPrice(symbol: string): Promise<number> {
  return fromAnySource((s) => s.price(symbol), (p) => Number.isFinite(p) && p > 0);
}

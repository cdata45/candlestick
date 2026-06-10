import type { Candle, Symbol, TimeFrame } from '../types';

// ---------------------------------------------------------------------------
// Twelve Data API
// Get your free key at: https://twelvedata.com/account/api-keys
// ---------------------------------------------------------------------------
const API_KEY = '12cea044900f49b29df57b55293548a2';
const API_BASE = 'https://api.twelvedata.com/time_series';
const MAX_PER_REQUEST = 5000; // Twelve Data allows up to 5000 per call
const MIN_DELAY = 300;        // ms between paginated requests
const MAX_CONSECUTIVE_ERRORS = 3;

// Map app symbols → Twelve Data symbols
const SYMBOL_MAP: Record<Symbol, string> = {
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  BTCUSD: 'BTC/USD',
};

// Map app timeframes → Twelve Data intervals
const TIMEFRAME_MAP: Record<TimeFrame, string> = {
  '1m':  '1min',
  '5m':  '5min',
  '15m': '15min',
  '30m': '30min',
  '1h':  '1h',
  '4h':  '4h',
  '1d':  '1day',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchOptions {
  symbol: Symbol;
  timeFrame: TimeFrame;
  candleCount: number;
  onProgress: (downloaded: number) => void;
  abortSignal?: AbortSignal;
}

interface TwelveCandle {
  datetime: string; // "2024-01-15 14:30:00"
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface TwelveResponse {
  status: string;
  message?: string;
  code?: number;
  values?: TwelveCandle[];
  meta?: { symbol: string; interval: string; exchange: string };
}

// Parse "2024-01-15 14:30:00" (UTC) to Unix timestamp
function parseDatetime(dt: string): number {
  // Twelve Data daily candles return "2024-01-15" without time
  const normalized = dt.length === 10 ? `${dt} 00:00:00` : dt;
  return Math.floor(new Date(`${normalized}Z`).getTime() / 1000);
}

// Fetch one page ending at (and including) endDatetime
// endDatetime format: "YYYY-MM-DD HH:mm:ss"
async function fetchPage(
  symbol: Symbol,
  timeFrame: TimeFrame,
  outputSize: number,
  endDatetime: string | null,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol:   SYMBOL_MAP[symbol],
    interval: TIMEFRAME_MAP[timeFrame],
    outputsize: String(outputSize),
    order:    'DESC', // newest first — we paginate backward
    apikey:   API_KEY,
  });

  if (endDatetime) {
    params.set('end_date', endDatetime);
  }

  const url = `${API_BASE}?${params.toString()}`;
  console.log('Fetching:', url.replace(API_KEY, '***'));

  const response = await fetch(url, {
    signal,
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json: TwelveResponse = await response.json();

  if (json.status === 'error') {
    // Code 429 = rate limit, code 400 = bad params
    throw new Error(`Twelve Data error ${json.code ?? ''}: ${json.message ?? 'Unknown error'}`);
  }

  if (!json.values || json.values.length === 0) {
    return [];
  }

  return json.values.map((v) => ({
    t: parseDatetime(v.datetime),
    o: parseFloat(v.open),
    h: parseFloat(v.high),
    l: parseFloat(v.low),
    c: parseFloat(v.close),
    v: parseFloat(v.volume) || 0,
  }));
}

// Format Unix timestamp back to "YYYY-MM-DD HH:mm:ss" for the API end_date param
function formatEndDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

export async function fetchAllCandles(options: FetchOptions): Promise<Candle[]> {
  const { symbol, timeFrame, candleCount, onProgress, abortSignal } = options;

  const candlesByTime = new Map<number, Candle>();
  let endDatetime: string | null = null; // null = start from latest (real-time)
  let consecutiveErrors = 0;

  console.log(`Starting fetch: ${symbol} ${timeFrame}, requesting ${candleCount} candles`);

  while (candlesByTime.size < candleCount) {
    if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const remaining = candleCount - candlesByTime.size;
    const pageSize = Math.min(remaining, MAX_PER_REQUEST);

    console.log(
      `Fetching page — end=${endDatetime ?? 'latest'} — ` +
      `collected ${candlesByTime.size}/${candleCount}`,
    );

    try {
      const page = await fetchPage(symbol, timeFrame, pageSize, endDatetime, abortSignal);
      consecutiveErrors = 0;

      if (page.length === 0) {
        console.log('Empty page — no more historical data available');
        break;
      }

      // page is DESC (newest first), add all
      for (const candle of page) {
        if (!candlesByTime.has(candle.t)) {
          candlesByTime.set(candle.t, candle);
        }
      }

      onProgress(candlesByTime.size);
      console.log(`Page had ${page.length} candles — total unique: ${candlesByTime.size}`);

      if (candlesByTime.size >= candleCount) break;

      // Oldest candle in this page → next end_date is one second before it
      const oldestTimestamp = Math.min(...page.map((c) => c.t));
      endDatetime = formatEndDate(oldestTimestamp - 1);

      await delay(MIN_DELAY);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;

      consecutiveErrors++;
      console.error(`Fetch error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(
          `Failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ` +
          (err instanceof Error ? err.message : 'Unknown error'),
        );
      }

      await delay(MIN_DELAY * 4);
    }
  }

  const sorted = Array.from(candlesByTime.values()).sort((a, b) => a.t - b.t);
  console.log(`Fetch complete. Total candles: ${sorted.length}`);
  return sorted.slice(-candleCount);
}

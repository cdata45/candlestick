import type { Candle, Symbol, TimeFrame } from '../types';

const API_KEY = '82c11f0706c647a286e2cc089f7b4163';
const API_BASE = 'https://api.twelvedata.com';

export interface FetchOptions {
  symbol: Symbol;
  timeFrame: TimeFrame;
  candleCount: number;
  onProgress: (downloaded: number) => void;
  abortSignal?: AbortSignal;
}

function toTwelveDataInterval(tf: TimeFrame): string {
  return tf; // already in Twelve Data format: 1min, 5min, 1h, 4h, 1day, 1week
}

function parseCandles(values: Array<Record<string, string>>): Candle[] {
  return values.map((v) => ({
    t: Math.floor(new Date(v.datetime).getTime() / 1000),
    o: parseFloat(v.open),
    h: parseFloat(v.high),
    l: parseFloat(v.low),
    c: parseFloat(v.close),
    v: parseFloat(v.volume ?? '0'),
  }));
}

export async function fetchAllCandles(options: FetchOptions): Promise<Candle[]> {
  const { symbol, timeFrame, candleCount, onProgress, abortSignal } = options;
  const interval = toTwelveDataInterval(timeFrame);

  // Twelve Data max per request is 5000; we batch if needed
  const perPage = Math.min(candleCount, 5000);

  const url = new URL(`${API_BASE}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', String(perPage));
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('order', 'ASC');

  const res = await fetch(url.toString(), { signal: abortSignal });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const json = await res.json();

  if (json.status === 'error') {
    throw new Error(json.message || 'Twelve Data API error');
  }

  if (!json.values || !Array.isArray(json.values)) {
    throw new Error('Unexpected API response format');
  }

  const candles = parseCandles(json.values);
  onProgress(candles.length);
  return candles;
}

// Fetch only the latest candle (for live polling)
export async function fetchLatestCandle(
  symbol: Symbol,
  timeFrame: TimeFrame,
  signal?: AbortSignal,
): Promise<Candle | null> {
  const interval = toTwelveDataInterval(timeFrame);

  const url = new URL(`${API_BASE}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', '1');
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('format', 'JSON');

  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.values?.[0]) return null;
    const [latest] = parseCandles(json.values);
    return latest;
  } catch {
    return null;
  }
}

// WebSocket live price feed
export function createLiveFeed(
  symbol: Symbol,
  onPrice: (price: number, timestamp: number) => void,
  onStatusChange: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function connect() {
    if (destroyed) return;
    try {
      ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${API_KEY}`);

      ws.onopen = () => {
        onStatusChange(true);
        ws?.send(JSON.stringify({ action: 'subscribe', params: { symbols: symbol } }));
      };

      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.price) {
            onPrice(parseFloat(d.price), Math.floor(Date.now() / 1000));
          }
        } catch { /* ignore */ }
      };

      ws.onerror = () => {
        onStatusChange(false);
      };

      ws.onclose = () => {
        onStatusChange(false);
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    } catch {
      onStatusChange(false);
      if (!destroyed) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }
  }

  connect();

  // Return cleanup function
  return () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

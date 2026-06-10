import type { Candle, ApiResponse, Symbol, TimeFrame } from '../types';

const API_BASE = 'https://widget-data.bitycle.com/c1/api/exchange/widget_data';
const MAX_PER_REQUEST = 500;
const MIN_DELAY = 250;

// CORS Proxies to try
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://cors-anywhere.herokuapp.com/${url}`,
];

function getBackoffSeconds(timeFrame: TimeFrame): number {
  const frameInSeconds: Record<TimeFrame, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  return frameInSeconds[timeFrame] * 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchOptions {
  symbol: Symbol;
  timeFrame: TimeFrame;
  candleCount: number;
  onProgress: (downloaded: number) => void;
  abortSignal?: AbortSignal;
}

async function tryFetch(url: string, signal?: AbortSignal): Promise<ApiResponse> {
  // First try direct fetch
  try {
    const directResponse = await fetch(url, {
      method: 'GET',
      signal,
      headers: { 'Accept': 'application/json' },
    });
    if (directResponse.ok) {
      const data = await directResponse.json();
      console.log('Direct fetch succeeded');
      return data as ApiResponse;
    }
  } catch (e) {
    console.log('Direct fetch failed, trying proxies...', e);
  }

  // Try each CORS proxy
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](url);
    try {
      console.log(`Trying proxy ${i + 1}/${CORS_PROXIES.length}:`, proxyUrl.substring(0, 50) + '...');
      const response = await fetch(proxyUrl, {
        method: 'GET',
        signal,
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.ok) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          console.log(`Proxy ${i + 1} succeeded`);
          return data as ApiResponse;
        } catch {
          console.log(`Proxy ${i + 1} returned invalid JSON`);
          continue;
        }
      }
    } catch (e) {
      console.log(`Proxy ${i + 1} failed:`, e);
      continue;
    }
  }

  throw new Error('All fetch methods failed. The API may be blocking requests.');
}

export async function fetchAllCandles(options: FetchOptions): Promise<Candle[]> {
  const { symbol, timeFrame, candleCount, onProgress, abortSignal } = options;
  const allCandles: Map<number, Candle> = new Map();
  const backoffSec = getBackoffSeconds(timeFrame);
  
  let endTimestamp: number | null = null;
  let emptyRetries = 0;
  const maxEmptyRetries = 5;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  console.log(`Starting fetch: ${symbol} ${timeFrame}, requesting ${candleCount} candles`);

  while (allCandles.size < candleCount) {
    if (abortSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Build URL
    const params = new URLSearchParams({
      symbol: symbol,
      time_frame: timeFrame,
      source: 'alpari',
    });
    
    if (endTimestamp !== null) {
      params.set('end', endTimestamp.toString());
    }

    const url = `${API_BASE}?${params.toString()}`;
    console.log('Fetching:', url);

    try {
      const json = await tryFetch(url, abortSignal);

      if (json.status !== 'success') {
        throw new Error(`API returned status: ${json.status}`);
      }

      if (!json.data || json.data.length === 0) {
        emptyRetries++;
        console.log(`Empty response, retry ${emptyRetries}/${maxEmptyRetries}`);
        if (emptyRetries >= maxEmptyRetries) {
          console.log('Max empty retries reached, stopping');
          break;
        }
        if (endTimestamp === null) {
          endTimestamp = Math.floor(Date.now() / 1000) - backoffSec;
        } else {
          endTimestamp -= backoffSec;
        }
        await delay(MIN_DELAY);
        continue;
      }

      emptyRetries = 0;
      consecutiveErrors = 0;

      let addedCount = 0;
      for (const candle of json.data) {
        if (allCandles.size >= candleCount) break;
        if (candle && typeof candle.t === 'number' && !allCandles.has(candle.t)) {
          allCandles.set(candle.t, {
            t: candle.t,
            o: candle.o,
            h: candle.h,
            l: candle.l,
            c: candle.c,
            v: candle.v || 0,
          });
          addedCount++;
        }
      }

      onProgress(allCandles.size);
      console.log(`Fetched ${json.data.length} candles, added ${addedCount}, total: ${allCandles.size}`);

      if (addedCount === 0) {
        emptyRetries++;
        if (emptyRetries >= maxEmptyRetries) {
          break;
        }
      }

      const timestamps = json.data.map((c) => c.t).filter((t): t is number => typeof t === 'number');
      if (timestamps.length === 0) break;

      const oldestTimestamp = Math.min(...timestamps);
      endTimestamp = oldestTimestamp - 1;

      if (json.data.length < MAX_PER_REQUEST && allCandles.size < candleCount) {
        endTimestamp -= backoffSec;
      }

      await delay(MIN_DELAY);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      consecutiveErrors++;
      console.error(`Fetch error (${consecutiveErrors}/${maxConsecutiveErrors}):`, err);

      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Failed after ${maxConsecutiveErrors} attempts: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      await delay(MIN_DELAY * 3);
    }
  }

  const sorted = Array.from(allCandles.values()).sort((a, b) => a.t - b.t);
  console.log(`Fetch complete. Total candles: ${sorted.length}`);
  
  return sorted.slice(-candleCount);
}

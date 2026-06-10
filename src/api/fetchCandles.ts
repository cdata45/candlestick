import type { Candle, ApiResponse, Symbol, TimeFrame } from '../types';

const API_BASE = 'https://widget-data.bitycle.com/c1/api/exchange/widget_data';
const MIN_DELAY = 250;
const MAX_FETCH_ATTEMPTS = 20;
const EMPTY_PAGE_SEARCH_STEP_SECONDS = 60 * 60; // 1 hour
const MAX_EMPTY_PAGE_SEARCH_ATTEMPTS = 120;
const MAX_CONSECUTIVE_ERRORS = 3;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://cors-anywhere.herokuapp.com/${url}`,
];

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

async function tryFetch(url: string, signal?: AbortSignal): Promise<ApiResponse> {
  // Try proxies first — avoids CORS block from browsers without GitHub session
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](url);
    try {
      console.log(`Trying proxy ${i + 1}/${CORS_PROXIES.length}`);
      const res = await fetch(proxyUrl, { method: 'GET', signal, headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          console.log(`Proxy ${i + 1} succeeded`);
          return data as ApiResponse;
        } catch {
          console.log(`Proxy ${i + 1} returned invalid JSON`);
        }
      }
    } catch (e) {
      console.log(`Proxy ${i + 1} failed:`, e);
    }
  }

  // Fallback: direct fetch (works when GitHub is open in same browser)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://widget-data.bitycle.com',
        'Referer': 'https://widget-data.bitycle.com/',
      },
    });
    if (res.ok) {
      console.log('Direct fetch succeeded');
      return res.json() as Promise<ApiResponse>;
    }
  } catch (e) {
    console.log('Direct fetch also failed:', e);
  }

  throw new Error('All fetch methods failed. The API may be blocking requests.');
}

async function fetchCandlePage(
  symbol: Symbol,
  timeFrame: TimeFrame,
  endTimestamp: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    time_frame: timeFrame,
    source: 'alpari',
    end: endTimestamp.toString(),
  });

  const url = `${API_BASE}?${params.toString()}`;
  console.log('Fetching:', url);

  const json = await tryFetch(url, signal);

  if (json.status !== 'success') throw new Error(`API returned status: ${json.status}`);
  if (!json.data || !Array.isArray(json.data)) return [];

  return json.data
    .filter((c) => c && typeof c.t === 'number')
    .map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 0 }));
}

async function findPreviousAvailablePage(
  symbol: Symbol,
  timeFrame: TimeFrame,
  endTimestamp: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  console.log('Empty response — searching backward hour by hour...');
  let searchEnd = endTimestamp;

  for (let attempt = 1; attempt <= MAX_EMPTY_PAGE_SEARCH_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    searchEnd -= EMPTY_PAGE_SEARCH_STEP_SECONDS;
    console.log(`Search attempt ${attempt} with end=${new Date(searchEnd * 1000).toISOString()}`);
    const page = await fetchCandlePage(symbol, timeFrame, searchEnd, signal);
    if (page.length > 0) {
      console.log('Found older data at', new Date(searchEnd * 1000).toISOString());
      return page;
    }
    await delay(MIN_DELAY);
  }

  throw new Error(`Could not find older data after ${MAX_EMPTY_PAGE_SEARCH_ATTEMPTS} hours of search.`);
}

export async function fetchAllCandles(options: FetchOptions): Promise<Candle[]> {
  const { symbol, timeFrame, candleCount, onProgress, abortSignal } = options;

  const candlesByTime = new Map<number, Candle>();
  let endTimestamp = Math.floor(Date.now() / 1000);
  let consecutiveErrors = 0;

  console.log(`Starting fetch: ${symbol} ${timeFrame}, requesting ${candleCount} candles`);

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');

    console.log(
      `Page ${attempt} — end=${new Date(endTimestamp * 1000).toISOString()}` +
      ` — collected ${candlesByTime.size}/${candleCount}`,
    );

    try {
      let page = await fetchCandlePage(symbol, timeFrame, endTimestamp, abortSignal);

      if (page.length === 0) {
        page = await findPreviousAvailablePage(symbol, timeFrame, endTimestamp, abortSignal);
      }

      consecutiveErrors = 0;

      for (const candle of page) {
        if (!candlesByTime.has(candle.t)) candlesByTime.set(candle.t, candle);
      }

      onProgress(candlesByTime.size);
      console.log(`Page had ${page.length} candles — total unique: ${candlesByTime.size}`);

      if (candlesByTime.size >= candleCount) break;

      const oldestTimestamp = Math.min(...page.map((c) => c.t));
      const nextEnd = oldestTimestamp - 1;

      if (nextEnd >= endTimestamp) {
        throw new Error('API pagination did not move backward — stopping.');
      }

      endTimestamp = nextEnd;
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

      await delay(MIN_DELAY * 3);
    }
  }

  const sorted = Array.from(candlesByTime.values()).sort((a, b) => a.t - b.t);
  console.log(`Fetch complete. Total candles: ${sorted.length}`);
  return sorted.slice(-candleCount);
        }
  

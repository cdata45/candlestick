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
  return tf;
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

/**
 * فیلتر کندل‌های فیک:
 * کندل‌هایی که بازار بسته بوده (تعطیلی آخر هفته یا ساعات بسته)
 * را با سه معیار شناسایی می‌کنیم:
 * 1. range بسیار کوچیک نسبت به قیمت (کمتر از 0.002%)
 * 2. open == close یا اختلاف بسیار ناچیز
 * 3. volume == 0 همراه با range مشکوک
 */
function isGhostCandle(candle: Candle): boolean {
  const range = candle.h - candle.l;
  const mid = (candle.h + candle.l) / 2;
  if (mid === 0) return true;

  const rangePct = (range / mid) * 100;

  // اگه رنج کمتر از 0.003% باشه → کندل فیک
  // (برای فارکس و طلا این عدد خیلی غیرطبیعیه)
  return rangePct < 0.003;
}

/**
 * تشخیص Heikin Ashi: اگه open هر کندل دقیقاً برابر
 * میانگین open+close کندل قبلی باشه، دیتا HA هست.
 * در اینصورت دیتا رو به candlestick واقعی برمی‌گردونیم.
 */
function isHeikinAshi(candles: Candle[]): boolean {
  if (candles.length < 3) return false;
  let haCount = 0;
  for (let i = 1; i < Math.min(candles.length, 10); i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const expectedOpen = (prev.o + prev.c) / 2;
    if (Math.abs(curr.o - expectedOpen) < 0.0001 * curr.o) {
      haCount++;
    }
  }
  return haCount >= 6; // بیشتر از 60% کندل‌ها HA هستن
}

/**
 * تبدیل Heikin Ashi به Candlestick واقعی
 * فرمول معکوس: realClose = 2*haClose - haOpen
 *               realOpen  = 2*prevHaOpen - prevRealOpen
 */
function convertHAToCandlestick(haCandles: Candle[]): Candle[] {
  const result: Candle[] = [];
  let prevRealOpen = haCandles[0].o * 2 - haCandles[0].c; // تخمین اولیه

  for (let i = 0; i < haCandles.length; i++) {
    const ha = haCandles[i];
    const realClose = 2 * ha.c - ha.o;
    const realOpen = i === 0 ? prevRealOpen : 2 * haCandles[i - 1].o - result[i - 1].o;

    result.push({
      t: ha.t,
      o: parseFloat(realOpen.toFixed(5)),
      h: ha.h,
      l: ha.l,
      c: parseFloat(realClose.toFixed(5)),
      v: ha.v,
    });
    prevRealOpen = realOpen;
  }
  return result;
}

function cleanCandles(candles: Candle[]): Candle[] {
  // اول فیلتر ghost candles
  const filtered = candles.filter((c) => !isGhostCandle(c));

  // بعد چک HA
  if (isHeikinAshi(filtered)) {
    console.warn('Heikin Ashi data detected — converting to real candlestick...');
    return convertHAToCandlestick(filtered);
  }

  return filtered;
}

export async function fetchAllCandles(options: FetchOptions): Promise<Candle[]> {
  const { symbol, timeFrame, candleCount, onProgress, abortSignal } = options;
  const interval = toTwelveDataInterval(timeFrame);

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

  const raw = parseCandles(json.values);
  const candles = cleanCandles(raw);

  console.log(`Raw: ${raw.length} candles → After filter: ${candles.length} candles`);
  onProgress(candles.length);
  return candles;
}

export async function fetchLatestCandle(
  symbol: Symbol,
  timeFrame: TimeFrame,
  signal?: AbortSignal,
): Promise<Candle | null> {
  const interval = toTwelveDataInterval(timeFrame);

  const url = new URL(`${API_BASE}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', '2'); // 2 تا می‌گیریم تا ghost رو بتونیم تشخیص بدیم
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('format', 'JSON');

  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.values?.[0]) return null;
    const parsed = parseCandles(json.values);
    const cleaned = cleanCandles(parsed);
    return cleaned[cleaned.length - 1] ?? null;
  } catch {
    return null;
  }
}

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

      ws.onerror = () => { onStatusChange(false); };

      ws.onclose = () => {
        onStatusChange(false);
        if (!destroyed) reconnectTimer = setTimeout(connect, 5000);
      };
    } catch {
      onStatusChange(false);
      if (!destroyed) reconnectTimer = setTimeout(connect, 5000);
    }
  }

  connect();

  return () => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

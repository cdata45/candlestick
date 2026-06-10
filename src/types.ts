export interface Candle {
  t: number; // Unix timestamp (UTC)
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

// Twelve Data response — internal use in fetchCandles.ts
export interface ApiResponse {
  status: string;
  data: Candle[];
}

export type Symbol = 'XAUUSD' | 'XAGUSD' | 'EURUSD' | 'GBPUSD' | 'BTCUSD';
export type TimeFrame = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface FetchProgress {
  downloaded: number;
  total: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
}

export interface AppSettings {
  symbol: Symbol;
  timeFrame: TimeFrame;
  candleCount: number;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

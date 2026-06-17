export interface Candle {
  t: number; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface ApiResponse {
  status: string;
  data: Candle[];
}

export type Symbol =
  | 'XAU/USD'
  | 'XAG/USD'
  | 'WTI/USD'
  | 'EUR/USD'
  | 'GBP/USD'
  | 'USD/JPY'
  | 'USD/CAD'
  | 'AUD/USD'
  | 'USD/CHF'
  | 'GBP/JPY'
  | 'EUR/JPY'
  | 'NZD/USD';

export type TimeFrame = '1min' | '5min' | '15min' | '30min' | '1h' | '4h' | '1day' | '1week';

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

export interface LiveStatus {
  connected: boolean;
  lastUpdate: number | null;
}

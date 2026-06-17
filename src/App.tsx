import { useState, useCallback, useRef, useEffect } from 'react';
import CandlestickChart from './components/CandlestickChart';
import ToastContainer from './components/ToastContainer';
import OnlineStatus from './components/OnlineStatus';
import ProgressBar from './components/ProgressBar';
import { useToast } from './hooks/useToast';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchAllCandles, fetchLatestCandle, createLiveFeed } from './api/fetchCandles';
import { downloadExcel, candlesToCSV, copyToClipboard } from './utils/exportData';
import type { Candle, FetchProgress, Symbol as TSymbol, TimeFrame } from './types';

const SYMBOLS: { value: TSymbol; label: string; emoji: string }[] = [
  { value: 'XAU/USD', label: 'Gold / USD',    emoji: '🥇' },
  { value: 'XAG/USD', label: 'Silver / USD',  emoji: '🥈' },
  { value: 'WTI/USD', label: 'Oil / USD',     emoji: '🛢️' },
  { value: 'EUR/USD', label: 'EUR / USD',     emoji: '💶' },
  { value: 'GBP/USD', label: 'GBP / USD',     emoji: '💷' },
  { value: 'USD/JPY', label: 'USD / JPY',     emoji: '💴' },
  { value: 'USD/CAD', label: 'USD / CAD',     emoji: '🍁' },
  { value: 'AUD/USD', label: 'AUD / USD',     emoji: '🦘' },
  { value: 'USD/CHF', label: 'USD / CHF',     emoji: '🇨🇭' },
  { value: 'GBP/JPY', label: 'GBP / JPY',     emoji: '🔀' },
  { value: 'EUR/JPY', label: 'EUR / JPY',     emoji: '🔀' },
  { value: 'NZD/USD', label: 'NZD / USD',     emoji: '🥝' },
];

const TIMEFRAMES: { value: TimeFrame; label: string }[] = [
  { value: '1min',  label: '1 Minute'  },
  { value: '5min',  label: '5 Minutes' },
  { value: '15min', label: '15 Minutes'},
  { value: '30min', label: '30 Minutes'},
  { value: '1h',    label: '1 Hour'    },
  { value: '4h',    label: '4 Hours'   },
  { value: '1day',  label: '1 Day'     },
  { value: '1week', label: '1 Week'    },
];

// Polling interval per timeframe (ms)
const POLL_INTERVALS: Record<TimeFrame, number> = {
  '1min':  15_000,
  '5min':  30_000,
  '15min': 60_000,
  '30min': 60_000,
  '1h':    120_000,
  '4h':    300_000,
  '1day':  600_000,
  '1week': 600_000,
};

export default function App() {
  const [settings, setSettings] = useLocalStorage('bitycle-settings-v2', {
    symbol: 'XAU/USD' as TSymbol,
    timeFrame: '1h' as TimeFrame,
    candleCount: 500,
  });

  const [candles, setCandles] = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [progress, setProgress] = useState<FetchProgress>({ downloaded: 0, total: 0, status: 'idle' });
  const [copyFormat, setCopyFormat] = useState<'csv' | 'json'>('csv');
  const [lastError, setLastError] = useState<string | null>(null);

  const { toasts, addToast, removeToast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const cleanupLiveFeedRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candlesRef = useRef<Candle[]>([]);

  // Keep candlesRef in sync
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Cleanup live feed on unmount
  useEffect(() => {
    return () => {
      cleanupLiveFeedRef.current?.();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const startLiveFeed = useCallback((symbol: TSymbol, timeFrame: TimeFrame) => {
    // Cleanup previous
    cleanupLiveFeedRef.current?.();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    // WebSocket for tick-by-tick price
    const cleanup = createLiveFeed(
      symbol,
      (price, _ts) => {
        setLivePrice(price);
        setLastUpdateTime(new Date());
      },
      (connected) => setLiveConnected(connected),
    );
    cleanupLiveFeedRef.current = cleanup;

    // Polling to refresh the latest candle OHLCV
    const pollInterval = POLL_INTERVALS[timeFrame];
    const poll = async () => {
      const latest = await fetchLatestCandle(symbol, timeFrame);
      if (latest && candlesRef.current.length > 0) {
        setCandles((prev) => {
          const withoutLast = prev.slice(0, -1);
          const last = prev[prev.length - 1];
          // If same candle time, update it; else append
          if (last.t === latest.t) {
            return [...withoutLast, latest];
          }
          return [...prev, latest];
        });
        setLastUpdateTime(new Date());
      }
      pollTimerRef.current = setTimeout(poll, pollInterval);
    };

    pollTimerRef.current = setTimeout(poll, pollInterval);
  }, []);

  const handleFetch = useCallback(async () => {
    if (progress.status === 'loading') {
      abortRef.current?.abort();
      return;
    }

    const { symbol, timeFrame, candleCount } = settings;

    if (candleCount < 1 || candleCount > 5000) {
      addToast('Candle count must be between 1 and 5000', 'error');
      return;
    }

    if (!navigator.onLine) {
      addToast('You are offline. Please check your internet connection.', 'error');
      return;
    }

    // Stop previous live feed
    cleanupLiveFeedRef.current?.();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setLivePrice(null);
    setLiveConnected(false);
    setCandles([]);
    setLastError(null);
    setProgress({ downloaded: 0, total: candleCount, status: 'loading' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      addToast(`Fetching ${symbol} ${timeFrame} data...`, 'info');

      const result = await fetchAllCandles({
        symbol,
        timeFrame,
        candleCount,
        onProgress: (downloaded) => setProgress((prev) => ({ ...prev, downloaded })),
        abortSignal: controller.signal,
      });

      if (result.length === 0) {
        setProgress({ downloaded: 0, total: candleCount, status: 'error', error: 'No data received' });
        setLastError('No data received from API. Try a different symbol or timeframe.');
        addToast('No data received from API', 'error');
        return;
      }

      setCandles(result);
      setProgress({ downloaded: result.length, total: candleCount, status: 'done' });
      addToast(`✅ Downloaded ${result.length} candles — live feed started`, 'success');

      // Start live feed
      startLiveFeed(symbol, timeFrame);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setProgress((prev) => ({ ...prev, status: 'idle' }));
        addToast('Fetch cancelled', 'info');
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setProgress((prev) => ({ ...prev, status: 'error', error: message }));
      setLastError(message);
      addToast(`Error: ${message}`, 'error');
    }
  }, [settings, progress.status, addToast, startLiveFeed]);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    cleanupLiveFeedRef.current?.();
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setCandles([]);
    setLastError(null);
    setLivePrice(null);
    setLiveConnected(false);
    setProgress({ downloaded: 0, total: 0, status: 'idle' });
    addToast('Data cleared', 'info');
  }, [addToast]);

  const handleDownloadExcel = useCallback(() => {
    if (candles.length === 0) { addToast('No data to download', 'error'); return; }
    try {
      downloadExcel(candles, settings.symbol, settings.timeFrame);
      addToast('Excel file downloaded', 'success');
    } catch {
      addToast('Failed to generate Excel', 'error');
    }
  }, [candles, settings, addToast]);

  const handleCopy = useCallback(async () => {
    if (candles.length === 0) { addToast('No data to copy', 'error'); return; }
    const text = copyFormat === 'csv' ? candlesToCSV(candles) : JSON.stringify(candles, null, 2);
    const success = await copyToClipboard(text);
    if (success) addToast(`Copied ${candles.length} candles as ${copyFormat.toUpperCase()}`, 'success');
    else addToast('Failed to copy to clipboard', 'error');
  }, [candles, copyFormat, addToast]);

  const timeRange = candles.length > 0
    ? { from: new Date(candles[0].t * 1000), to: new Date(candles[candles.length - 1].t * 1000) }
    : null;

  const lastCandle = candles[candles.length - 1] ?? null;
  const displayPrice = livePrice ?? lastCandle?.c ?? null;
  const isLoading = progress.status === 'loading';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800/80 border-b border-slate-700 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-lg font-bold shadow-lg shadow-indigo-500/20">
              📊
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">Bitycle Chart</h1>
              <p className="text-[10px] text-slate-400 leading-tight">Live Candlestick Viewer</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Live indicator */}
            {candles.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${liveConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-[10px] text-slate-400">{liveConnected ? 'LIVE' : 'Polling'}</span>
              </div>
            )}
            <OnlineStatus />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4 pb-20">
        {/* Config */}
        <section className="bg-slate-800 rounded-2xl border border-slate-700 p-4 space-y-4 shadow-xl">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
            Configuration
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Symbol</label>
              <select
                value={settings.symbol}
                onChange={(e) => setSettings((s) => ({ ...s, symbol: e.target.value as TSymbol }))}
                disabled={isLoading}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all appearance-none cursor-pointer disabled:opacity-50"
              >
                {SYMBOLS.map((s) => (
                  <option key={s.value} value={s.value}>{s.emoji} {s.value}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Timeframe</label>
              <select
                value={settings.timeFrame}
                onChange={(e) => setSettings((s) => ({ ...s, timeFrame: e.target.value as TimeFrame }))}
                disabled={isLoading}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all appearance-none cursor-pointer disabled:opacity-50"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>{tf.value} — {tf.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              Candle Count
              <span className="text-slate-500 ml-1">(1 – 5000)</span>
            </label>
            <input
              type="number"
              min={1}
              max={5000}
              value={settings.candleCount}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setSettings((s) => ({ ...s, candleCount: Math.max(1, Math.min(5000, val)) }));
              }}
              disabled={isLoading}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-mono disabled:opacity-50"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleFetch}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
                isLoading
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-indigo-600/20'
              }`}
            >
              {isLoading ? (
                <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Cancel</>
              ) : (
                <>🚀 Fetch Data</>
              )}
            </button>
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="px-5 py-3 rounded-xl font-semibold text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all border border-slate-600 disabled:opacity-50"
            >
              ↺ Reset
            </button>
          </div>
        </section>

        {/* Progress */}
        {progress.status !== 'idle' && (
          <section className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl">
            <ProgressBar progress={progress} />
          </section>
        )}

        {/* Error */}
        {lastError && progress.status === 'error' && (
          <section className="bg-red-900/30 rounded-2xl border border-red-800 p-4 shadow-xl space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-300">Error Fetching Data</h3>
                <p className="text-xs text-red-400 mt-1">{lastError}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleFetch} className="flex-1 py-2 rounded-lg font-semibold text-xs bg-red-700 hover:bg-red-600 text-white transition-all flex items-center justify-center gap-2">
                🔄 Retry
              </button>
              <button onClick={handleReset} className="px-4 py-2 rounded-lg font-semibold text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all">
                Dismiss
              </button>
            </div>
          </section>
        )}

        {/* Live price bar */}
        {candles.length > 0 && displayPrice !== null && (
          <section className="bg-slate-800 rounded-2xl border border-slate-700 p-3 shadow-xl">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${liveConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span className="text-xs text-slate-400 font-medium">{settings.symbol}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xl font-bold text-white font-mono">
                    {displayPrice.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                  </div>
                  {lastUpdateTime && (
                    <div className="text-[10px] text-slate-500">
                      Updated {lastUpdateTime.toLocaleTimeString()}
                    </div>
                  )}
                </div>
                {lastCandle && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono">
                    <span className="text-slate-500">O</span><span className="text-slate-300">{lastCandle.o.toFixed(5)}</span>
                    <span className="text-slate-500">H</span><span className="text-emerald-400">{lastCandle.h.toFixed(5)}</span>
                    <span className="text-slate-500">L</span><span className="text-red-400">{lastCandle.l.toFixed(5)}</span>
                    <span className="text-slate-500">C</span><span className="text-amber-400">{displayPrice.toFixed(5)}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Chart */}
        {candles.length > 0 && (
          <section className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
            <CandlestickChart
              candles={candles}
              symbol={`${settings.symbol} • ${settings.timeFrame}`}
              livePrice={livePrice}
            />
          </section>
        )}

        {/* Data Summary */}
        {timeRange && (
          <section className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              Data Summary
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">From</div>
                <div className="text-xs text-emerald-400 font-mono">{timeRange.from.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{timeRange.from.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <div className="bg-slate-900 rounded-xl p-3 border border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">To</div>
                <div className="text-xs text-emerald-400 font-mono">{timeRange.to.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{timeRange.to.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-slate-900 rounded-xl p-3 border border-slate-700 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Records</div>
                <div className="text-lg font-bold text-indigo-400 font-mono">{candles.length.toLocaleString()}</div>
              </div>
              <div className="flex-1 bg-slate-900 rounded-xl p-3 border border-slate-700 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Latest Close</div>
                <div className="text-lg font-bold text-amber-400 font-mono">
                  {(displayPrice ?? lastCandle?.c ?? 0).toLocaleString(undefined, { maximumFractionDigits: 5 })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Export */}
        {candles.length > 0 && (
          <section className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
              Export Data
            </h2>

            <button
              onClick={handleDownloadExcel}
              className="w-full py-3 rounded-xl font-semibold text-sm bg-emerald-700 hover:bg-emerald-600 text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/20"
            >
              📥 Download Excel (.xlsx)
            </button>

            <div className="flex gap-2">
              <div className="flex bg-slate-900 rounded-xl border border-slate-600 overflow-hidden">
                <button
                  onClick={() => setCopyFormat('csv')}
                  className={`px-4 py-2 text-xs font-medium transition-all ${copyFormat === 'csv' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  CSV
                </button>
                <button
                  onClick={() => setCopyFormat('json')}
                  className={`px-4 py-2 text-xs font-medium transition-all ${copyFormat === 'json' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  JSON
                </button>
              </div>
              <button
                onClick={handleCopy}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all flex items-center justify-center gap-2 border border-slate-600"
              >
                📋 Copy to Clipboard
              </button>
            </div>
          </section>
        )}

        {/* Empty State */}
        {candles.length === 0 && progress.status === 'idle' && (
          <section className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-8 text-center space-y-3">
            <div className="text-5xl">📈</div>
            <h3 className="text-base font-semibold text-slate-300">No Data Yet</h3>
            <p className="text-sm text-slate-500 max-w-xs mx-auto">
              Select a symbol and timeframe, then tap <strong className="text-indigo-400">"Fetch Data"</strong> to load live candlestick data.
            </p>
          </section>
        )}

        <section className="text-[10px] text-slate-600 text-center">
          Powered by Twelve Data API | PWA Ready
        </section>
      </main>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

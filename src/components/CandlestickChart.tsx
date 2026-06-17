import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, Time } from 'lightweight-charts';
import type { Candle } from '../types';

interface CandlestickChartProps {
  candles: Candle[];
  symbol: string;
  livePrice?: number | null;
}

export default function CandlestickChart({ candles, symbol, livePrice }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#6366f1', width: 1, style: 2, labelBackgroundColor: '#6366f1' },
        horzLine: { color: '#6366f1', width: 1, style: 2, labelBackgroundColor: '#6366f1' },
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Load historical candles
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.t as Time,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    const volumeData: HistogramData<Time>[] = candles.map((c) => ({
      time: c.t as Time,
      value: c.v,
      color: c.c >= c.o ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Apply live price to last candle
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0 || livePrice == null) return;

    const last = candles[candles.length - 1];
    const updatedCandle: CandlestickData<Time> = {
      time: last.t as Time,
      open: last.o,
      high: Math.max(last.h, livePrice),
      low: Math.min(last.l, livePrice),
      close: livePrice,
    };
    candleSeriesRef.current.update(updatedCandle);
  }, [livePrice, candles]);

  return (
    <div className="relative w-full">
      <div className="absolute top-2 left-2 z-10 bg-slate-900/80 px-3 py-1 rounded-md text-xs text-indigo-400 font-medium backdrop-blur-sm border border-slate-700/50">
        📊 {symbol}
      </div>
      <div ref={chartContainerRef} className="w-full" style={{ height: '400px' }} />
    </div>
  );
}

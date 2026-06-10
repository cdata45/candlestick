import * as XLSX from 'xlsx';
import type { Candle } from '../types';

export function downloadExcel(candles: Candle[], symbol: string, timeFrame: string) {
  const data = candles.map((c) => ({
    Date: new Date(c.t * 1000).toISOString(),
    Timestamp: c.t,
    Open: c.o,
    High: c.h,
    Low: c.l,
    Close: c.c,
    Volume: c.v,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candles');

  // Set column widths
  ws['!cols'] = [
    { wch: 24 }, // Date
    { wch: 12 }, // Timestamp
    { wch: 12 }, // Open
    { wch: 12 }, // High
    { wch: 12 }, // Low
    { wch: 12 }, // Close
    { wch: 12 }, // Volume
  ];

  const filename = `${symbol}_${timeFrame}_${candles.length}candles_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function candlesToCSV(candles: Candle[]): string {
  const header = 'Date,Timestamp,Open,High,Low,Close,Volume';
  const rows = candles.map((c) =>
    `${new Date(c.t * 1000).toISOString()},${c.t},${c.o},${c.h},${c.l},${c.c},${c.v}`
  );
  return [header, ...rows].join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      document.body.removeChild(textArea);
      return false;
    }
  }
}

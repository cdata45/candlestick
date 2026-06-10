import * as XLSX from 'xlsx';
import type { Candle } from '../types';

// UTC+3:30 offset in milliseconds (Iran Standard Time)
const IRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;

function toIranTime(unixSeconds: number): string {
  const utcMs = unixSeconds * 1000;
  const iranMs = utcMs + IRAN_OFFSET_MS;
  const d = new Date(iranMs);

  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');

  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

export function downloadExcel(candles: Candle[], symbol: string, timeFrame: string) {
  const data = candles.map((c) => ({
    time:   toIranTime(c.t),
    open:   c.o,
    high:   c.h,
    low:    c.l,
    close:  c.c,
    volume: c.v,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Candles');

  ws['!cols'] = [
    { wch: 22 }, // time
    { wch: 12 }, // open
    { wch: 12 }, // high
    { wch: 12 }, // low
    { wch: 12 }, // close
    { wch: 12 }, // volume
  ];

  const filename = `${symbol}_${timeFrame}_${candles.length}candles_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function candlesToCSV(candles: Candle[]): string {
  const header = 'time\topen\thigh\tlow\tclose\tvolume';
  const rows = candles.map((c) =>
    `${toIranTime(c.t)}\t${c.o}\t${c.h}\t${c.l}\t${c.c}\t${c.v}`
  );
  return [header, ...rows].join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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
  

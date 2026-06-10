import type { FetchProgress } from '../types';

interface ProgressBarProps {
  progress: FetchProgress;
}

export default function ProgressBar({ progress }: ProgressBarProps) {
  if (progress.status === 'idle') return null;

  const percentage = progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between items-center text-xs text-slate-400">
        <span className="flex items-center gap-2">
          {progress.status === 'loading' && (
            <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          )}
          {progress.status === 'loading' ? 'Downloading...' : progress.status === 'done' ? '✅ Complete' : '❌ Error'}
        </span>
        <span className="text-indigo-400 font-mono font-bold">
          {progress.downloaded.toLocaleString()} / {progress.total.toLocaleString()} candles
        </span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            progress.status === 'error' ? 'bg-red-500' :
            progress.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

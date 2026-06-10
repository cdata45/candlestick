import type { Toast } from '../types';

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: number) => void;
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            rounded-lg px-4 py-3 shadow-xl border backdrop-blur-sm
            flex items-center justify-between gap-3
            animate-slide-in text-sm font-medium
            ${toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-700 text-emerald-200' : ''}
            ${toast.type === 'error' ? 'bg-red-900/90 border-red-700 text-red-200' : ''}
            ${toast.type === 'info' ? 'bg-blue-900/90 border-blue-700 text-blue-200' : ''}
          `}
        >
          <span className="flex items-center gap-2">
            {toast.type === 'success' && '✅'}
            {toast.type === 'error' && '❌'}
            {toast.type === 'info' && 'ℹ️'}
            {toast.message}
          </span>
          <button
            onClick={() => onRemove(toast.id)}
            className="text-white/60 hover:text-white transition-colors shrink-0"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

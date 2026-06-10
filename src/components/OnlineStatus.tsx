import { useOnlineStatus } from '../hooks/useOnlineStatus';

export default function OnlineStatus() {
  const isOnline = useOnlineStatus();

  return (
    <div className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border ${
      isOnline
        ? 'bg-emerald-950/50 border-emerald-800 text-emerald-400'
        : 'bg-red-950/50 border-red-800 text-red-400'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
      {isOnline ? 'Online' : 'Offline'}
    </div>
  );
}

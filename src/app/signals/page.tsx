import { prisma } from '@/lib/prisma';
import { Activity, TrendingUp, TrendingDown, Clock } from 'lucide-react';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  PENDING:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  EXECUTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:   'bg-red-50 text-red-700 border-red-200',
  SKIPPED:  'bg-slate-100 text-slate-500 border-slate-200',
};

export default async function Signals() {
  const signals = await prisma.incomingSignal.findMany({
    include: { trader: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black text-slate-800 tracking-tighter">Signals Log</h1>
        <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-widest">
          <Activity size={14} /> Last 200 signals
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Time</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Trader</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Token</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Side</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {signals.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                  No signals received yet.
                </td>
              </tr>
            )}
            {signals.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-[10px] text-slate-400 font-mono whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <Clock size={10} />
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-bold text-slate-800 text-sm">{s.trader.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {s.trader.walletAddress
                      ? `${s.trader.walletAddress.slice(0, 6)}…${s.trader.walletAddress.slice(-4)}`
                      : '—'}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <code className="text-xs font-black text-slate-700 bg-slate-100 px-2 py-1 rounded">
                    {s.symbol}
                  </code>
                </td>
                <td className="px-6 py-4">
                  <div className={`inline-flex items-center gap-1 text-xs font-black ${s.side === 'BUY' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {s.side === 'BUY'
                      ? <TrendingUp size={12} />
                      : <TrendingDown size={12} />}
                    {s.side}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-block border px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${STATUS_STYLE[s.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-[10px] text-red-400 font-mono max-w-[200px] truncate">
                  {s.errorMessage ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

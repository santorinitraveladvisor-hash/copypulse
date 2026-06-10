import { prisma } from '@/lib/prisma';
import { History, TrendingUp, TrendingDown, Clock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Orders() {
  const orders = await prisma.copiedOrder.findMany({
    include: { trader: true },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">Live Trade History</h1>
      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Time</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Trader</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Pair</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Side</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest text-right">PnL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No trades executed yet.</td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-[10px] text-slate-400 font-mono">
                  {new Date(o.createdAt).toLocaleTimeString()}
                </td>
                <td className="px-6 py-4 font-bold text-slate-700">{o.trader.name}</td>
                <td className="px-6 py-4 text-xs font-black">{o.symbol}</td>
                <td className={`px-6 py-4 text-xs font-black ${o.side === 'BUY' ? 'text-emerald-500' : 'text-red-500'}`}>
                  {o.side}
                </td>
                <td className={`px-6 py-4 text-right font-black ${o.fee! > 0 ? 'text-emerald-600' : o.fee! < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                  {o.side === 'SELL' ? `$${o.fee?.toFixed(2)}` : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

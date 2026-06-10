import { prisma } from '@/lib/prisma';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const dynamic = 'force-dynamic';

function fmt(n: number, decimals = 4) {
  return (n >= 0 ? '+' : '') + n.toFixed(decimals);
}

export default async function PnL() {
  const sells = await prisma.copiedOrder.findMany({
    where: { side: 'SELL', status: 'FILLED' },
    include: { trader: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pnlAllTime = sells.reduce((s, o) => s + (o.fee ?? 0), 0);
  const pnlToday   = sells
    .filter(o => new Date(o.createdAt) >= todayStart)
    .reduce((s, o) => s + (o.fee ?? 0), 0);
  const wins    = sells.filter(o => (o.fee ?? 0) > 0).length;
  const winRate = sells.length > 0 ? Math.round((wins / sells.length) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">PnL Tracker</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">All-Time PnL</div>
          <div className={`text-2xl font-black ${pnlAllTime >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmt(pnlAllTime)} BNB
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Today PnL</div>
          <div className={`text-2xl font-black ${pnlToday >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmt(pnlToday)} BNB
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Win Rate</div>
          <div className="text-2xl font-black text-slate-700">{winRate}%</div>
          <div className="text-[10px] text-slate-400 mt-1">{wins}W / {sells.length - wins}L</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Closed Trades</div>
          <div className="text-2xl font-black text-slate-700">{sells.length}</div>
        </div>
      </div>

      {/* Trade table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Time</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Token</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">BNB Spent</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">BNB Received</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest text-right">PnL</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sells.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                  No closed trades yet.
                </td>
              </tr>
            )}
            {sells.map((o) => {
              const pnl      = o.fee ?? 0;
              const bnbSpent = o.price ?? null;
              const bnbRecv  = o.fillPrice ?? null;
              const pnlPct   = bnbSpent && bnbSpent > 0 ? (pnl / bnbSpent) * 100 : null;
              const win      = pnl >= 0;
              // strip /BNB suffix for display
              const symbol   = o.symbol.replace('/BNB', '');
              return (
                <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 text-[10px] text-slate-400 font-mono whitespace-nowrap">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4">
                    <code className="text-xs font-black text-slate-700 bg-slate-100 px-2 py-1 rounded">
                      {symbol}
                    </code>
                    {o.trader && (
                      <div className="text-[9px] text-slate-400 mt-0.5">{o.trader.name}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-slate-500">
                    {bnbSpent !== null ? `${bnbSpent.toFixed(4)} BNB` : '—'}
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-slate-500">
                    {bnbRecv !== null ? `${bnbRecv.toFixed(4)} BNB` : '—'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className={`font-black text-sm ${win ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmt(pnl)} BNB
                    </div>
                    {pnlPct !== null && (
                      <div className={`text-[10px] font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(pnlPct, 1)}%
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {win ? (
                      <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                        <TrendingUp size={10} /> WIN
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                        <TrendingDown size={10} /> LOSS
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

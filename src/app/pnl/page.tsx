import { prisma } from '@/lib/prisma';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

export const dynamic = 'force-dynamic';

function fmt(n: number, decimals = 4) {
  return (n >= 0 ? '+' : '') + n.toFixed(decimals);
}

const REASON_LABEL: Record<string, string> = {
  TAKE_PROFIT: 'Take Profit',
  STOP_LOSS:   'Stop Loss',
  TIME_EXIT:   'Time Exit',
};

export default async function PnL() {
  const results = await prisma.tradeResult.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pnlAllTime = results.reduce((s, r) => s + r.pnlBnb, 0);
  const pnlToday   = results.filter(r => new Date(r.createdAt) >= todayStart).reduce((s, r) => s + r.pnlBnb, 0);
  const wins       = results.filter(r => r.pnlBnb > 0).length;
  const winRate    = results.length > 0 ? Math.round((wins / results.length) * 100) : 0;

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
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Trades</div>
          <div className="text-2xl font-black text-slate-700">{results.length}</div>
        </div>
      </div>

      {/* Trade table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[800px] text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Time</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Token</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Buy / Sell Price</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">BNB Spent / Received</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest text-right">PnL</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Exit</th>
              <th className="px-5 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                  No closed trades yet.
                </td>
              </tr>
            )}
            {results.map((r) => {
              const win = r.pnlBnb >= 0;
              return (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 text-[10px] text-slate-400 font-mono whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4">
                    <code className="text-xs font-black text-slate-700 bg-slate-100 px-2 py-1 rounded">
                      {r.symbol}
                    </code>
                    <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                      {r.tokenAddress.slice(0, 8)}…{r.tokenAddress.slice(-4)}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-slate-600">
                    <span className="text-slate-400">{r.buyPrice.toExponential(3)}</span>
                    <span className="text-slate-300 mx-1">→</span>
                    <span>{r.sellPrice.toExponential(3)}</span>
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-slate-600">
                    <span className="text-slate-400">{r.bnbSpent.toFixed(4)}</span>
                    <span className="text-slate-300 mx-1">→</span>
                    <span>{r.bnbReceived.toFixed(4)}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className={`font-black text-sm ${win ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmt(r.pnlBnb)} BNB
                    </div>
                    <div className={`text-[10px] font-bold ${win ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(r.pnlPct, 1)}%
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded">
                      {REASON_LABEL[r.exitReason] ?? r.exitReason}
                    </span>
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

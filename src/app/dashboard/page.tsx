'use client'
import { useState, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, CheckCircle, Wallet, BarChart2 } from 'lucide-react';

interface StatusData {
  balance: string;
  status: string;
  traderCount: number;
  orderCount: number;
  loading: boolean;
}

interface PnlData {
  pnlAllTime: number;
  pnlToday: number;
  winsAllTime: number;
  totalTrades: number;
  loading: boolean;
}

function fmt(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(4);
}

export default function Dashboard() {
  const [data, setData] = useState<StatusData>({ balance: '0.00', status: 'Connecting...', traderCount: 0, orderCount: 0, loading: true });
  const [pnl, setPnl] = useState<PnlData>({ pnlAllTime: 0, pnlToday: 0, winsAllTime: 0, totalTrades: 0, loading: true });

  useEffect(() => {
    async function fetchAll() {
      const [statusRes, pnlRes] = await Promise.allSettled([
        fetch('/api/account-status').then(r => r.json()),
        fetch('/api/pnl-summary').then(r => r.json()),
      ]);
      if (statusRes.status === 'fulfilled') setData({ ...statusRes.value, loading: false });
      else setData(d => ({ ...d, status: 'Disconnected', loading: false }));
      if (pnlRes.status === 'fulfilled') setPnl({ ...pnlRes.value, loading: false });
      else setPnl(d => ({ ...d, loading: false }));
    }
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, []);

  const winRate = pnl.totalTrades > 0 ? Math.round((pnl.winsAllTime / pnl.totalTrades) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-black text-slate-800 tracking-tighter">CopyPulse Live</h1>
        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-2 rounded-full border border-emerald-100 font-bold text-xs uppercase tracking-widest">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div> System Active
        </div>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">BNB Balance</span>
            <Wallet className="text-blue-500" size={18} />
          </div>
          <div className="text-2xl font-black text-slate-700">{data.loading ? '...' : data.balance}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Bot Status</span>
            <Activity className="text-emerald-500" size={18} />
          </div>
          <div className="text-sm font-bold text-slate-600">{data.status}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Active Traders</span>
            <CheckCircle className="text-purple-500" size={18} />
          </div>
          <div className="text-2xl font-black text-slate-700">{data.traderCount}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Orders</span>
            <TrendingUp className="text-orange-500" size={18} />
          </div>
          <div className="text-2xl font-black text-slate-700">{data.orderCount}</div>
        </div>
      </div>

      {/* PnL row */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-slate-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Performance</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">All-Time PnL</div>
            {pnl.loading ? (
              <div className="text-slate-300 text-2xl font-black">...</div>
            ) : (
              <div className={`text-2xl font-black flex items-center gap-1.5 ${pnl.pnlAllTime >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {pnl.pnlAllTime >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                {fmt(pnl.pnlAllTime)} BNB
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Today PnL</div>
            {pnl.loading ? (
              <div className="text-slate-300 text-2xl font-black">...</div>
            ) : (
              <div className={`text-2xl font-black flex items-center gap-1.5 ${pnl.pnlToday >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {pnl.pnlToday >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                {fmt(pnl.pnlToday)} BNB
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Win Rate</div>
            <div className="text-2xl font-black text-slate-700">{pnl.loading ? '...' : `${winRate}%`}</div>
            {!pnl.loading && (
              <div className="text-[10px] text-slate-400 mt-1">{pnl.winsAllTime}W / {pnl.totalTrades - pnl.winsAllTime}L</div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Closed Trades</div>
            <div className="text-2xl font-black text-slate-700">{pnl.loading ? '...' : pnl.totalTrades}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

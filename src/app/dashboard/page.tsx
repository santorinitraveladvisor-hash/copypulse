'use client'
import { useState, useEffect } from 'react';
import { Activity, TrendingUp, CheckCircle, Wallet, Loader2 } from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState({ balance: "0.00", status: "Connecting...", traderCount: 0, orderCount: 0, loading: true });

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/account-status');
        const json = await res.json();
        setData({ ...json, loading: false });
      } catch (e) {
        setData({ balance: "0.00", status: "Disconnected", traderCount: 0, orderCount: 0, loading: false });
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-black text-slate-800 tracking-tighter">CopyPulse Live</h1>
        <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-2 rounded-full border border-emerald-100 font-bold text-xs uppercase tracking-widest">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div> System Active
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4"><span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">USDT Balance</span><Wallet className="text-blue-500" size={18} /></div>
          <div className="text-2xl font-black text-slate-700">{data.loading ? "..." : `$${data.balance}`}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4"><span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Binance Link</span><Activity className="text-emerald-500" size={18} /></div>
          <div className="text-sm font-bold text-slate-600">{data.status}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4"><span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Active Traders</span><CheckCircle className="text-purple-500" size={18} /></div>
          <div className="text-2xl font-black text-slate-700">{data.traderCount}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4"><span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Orders</span><TrendingUp className="text-orange-500" size={18} /></div>
          <div className="text-2xl font-black text-slate-700">{data.orderCount}</div>
        </div>
      </div>
    </div>
  );
}

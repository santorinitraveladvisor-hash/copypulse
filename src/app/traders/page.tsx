import { Plus, Wallet } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { addTrader, deleteTrader } from './actions';

export const dynamic = 'force-dynamic';

export default async function Traders() {
  const traders = await prisma.trader.findMany();

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">Manage Traders</h1>
      </div>

      {/* ADD TRADER FORM */}
      <div className="bg-white p-4 md:p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-700">
           <Plus size={20} className="text-blue-600"/> Add Signal Source
        </h2>
        <form action={addTrader} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Trader Name</label>
            <input name="name" required placeholder="ALPHA_ONE" className="w-full p-3.5 bg-slate-900 text-white placeholder-slate-500 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Wallet Address</label>
            <input name="walletAddress" placeholder="0x123..." className="w-full p-3.5 bg-slate-900 text-white placeholder-slate-500 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Allowed Coins</label>
            <input name="allowedPairs" defaultValue="BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT" className="w-full p-3.5 bg-slate-900 text-white placeholder-slate-500 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Max Trade Size (USDT)</label>
            <input name="maxTradeSize" type="number" required placeholder="11" className="w-full p-3.5 bg-slate-900 text-white placeholder-slate-500 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Risk Mult.</label>
            <input name="riskMultiplier" type="number" step="0.1" defaultValue="1.0" className="w-full p-3.5 bg-slate-900 text-white placeholder-slate-500 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full bg-blue-600 text-white font-black py-4 rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 uppercase text-xs tracking-widest active:scale-95">
              Save Trader
            </button>
          </div>
        </form>
      </div>

      {/* TRADER LIST TABLE */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Trader / Wallet</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest">Allowed Coins</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest text-center">Webhook ID</th>
              <th className="px-6 py-4 font-black text-slate-500 text-[10px] uppercase tracking-widest text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-bold">
            {traders.length === 0 && (
               <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-300 italic font-medium">No traders defined.</td></tr>
            )}
            {traders.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-5">
                  <div className="font-bold text-slate-800">{t.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1 flex items-center gap-1">
                    <Wallet size={10} /> {t.walletAddress || "No wallet linked"}
                  </div>
                </td>
                <td className="px-6 py-5">
                   <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {t.allowedPairs.split(',').map(p => (
                        <span key={p} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[8px] uppercase">{p}</span>
                      ))}
                   </div>
                </td>
                <td className="px-6 py-5 text-center">
                  <code className="bg-slate-900 text-blue-400 px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider border border-slate-800">
                    {t.id}
                  </code>
                </td>
                <td className="px-6 py-5 text-right">
                   <form action={deleteTrader.bind(null, t.id)}>
                      <button type="submit" className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-red-100 transition-all">
                        Remove
                      </button>
                   </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

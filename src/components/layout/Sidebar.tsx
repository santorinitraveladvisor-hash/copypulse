import Link from 'next/link';
import { LayoutDashboard, Users, Settings, History, ShieldAlert, Activity, BarChart2 } from 'lucide-react';
import { WalletLogin } from './WalletLogin';

const menuItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { name: 'Traders', icon: Users, href: '/traders' },
  { name: 'Signals Log', icon: Activity, href: '/signals' },
  { name: 'Orders', icon: History, href: '/orders' },
  { name: 'PnL Tracker', icon: BarChart2, href: '/pnl' },
  { name: 'Binance Connection', icon: Settings, href: '/connection' },
];

export function Sidebar() {
  return (
    <div className="hidden md:flex w-64 bg-slate-900 text-white h-screen fixed left-0 top-0 p-4 border-r border-slate-800 flex-col z-50">
      <div className="text-2xl font-black mb-8 text-blue-400 px-2 tracking-tighter italic">CopyPulse</div>
      <nav className="flex-1 space-y-1">
        {menuItems.map((item) => (
          <Link key={item.name} href={item.href} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800 transition-all group">
            <item.icon size={18} className="text-slate-500 group-hover:text-blue-400" />
            <span className="font-medium text-sm text-slate-300 group-hover:text-white">{item.name}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto space-y-3 pt-4 border-t border-slate-800">
        <WalletLogin />
        <button className="w-full bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white py-2 rounded-xl font-bold flex items-center justify-center gap-2 text-[10px] border border-red-600/20 transition-all uppercase tracking-widest">
          <ShieldAlert size={14} /> Emergency Stop
        </button>
      </div>
    </div>
  );
}

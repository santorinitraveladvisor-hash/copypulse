'use client'
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Activity, History, BarChart2 } from 'lucide-react';

const items = [
  { name: 'Home',    icon: LayoutDashboard, href: '/dashboard' },
  { name: 'Traders', icon: Users,           href: '/traders'   },
  { name: 'Signals', icon: Activity,        href: '/signals'   },
  { name: 'Orders',  icon: History,         href: '/orders'    },
  { name: 'PnL',     icon: BarChart2,       href: '/pnl'       },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 flex">
      {items.map(({ name, icon: Icon, href }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              active ? 'text-blue-400' : 'text-slate-500'
            }`}
          >
            <Icon size={20} />
            <span className="text-[9px] font-black uppercase tracking-wider">{name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

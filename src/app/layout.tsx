import './globals.css';
import { Inter } from 'next/font/google';
import { Sidebar } from '@/components/layout/Sidebar';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex">
          <Sidebar />
          <main className="ml-64 flex-1 min-h-screen bg-slate-50 p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

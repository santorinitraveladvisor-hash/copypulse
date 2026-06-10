import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [allSells, todaySells] = await Promise.all([
    prisma.copiedOrder.findMany({
      where: { side: 'SELL', status: 'FILLED' },
      select: { fee: true },
    }).catch(() => []),
    prisma.copiedOrder.findMany({
      where: { side: 'SELL', status: 'FILLED', createdAt: { gte: todayStart } },
      select: { fee: true },
    }).catch(() => []),
  ]);

  const pnlAllTime  = allSells.reduce((s, o) => s + (o.fee ?? 0), 0);
  const pnlToday    = todaySells.reduce((s, o) => s + (o.fee ?? 0), 0);
  const winsAllTime = allSells.filter(o => (o.fee ?? 0) > 0).length;
  const totalTrades = allSells.length;

  return NextResponse.json({ pnlAllTime, pnlToday, winsAllTime, totalTrades });
}

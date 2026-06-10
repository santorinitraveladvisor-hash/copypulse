import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [allResults, todayResults] = await Promise.all([
    prisma.tradeResult.findMany({ select: { pnlBnb: true } }).catch(() => []),
    prisma.tradeResult.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { pnlBnb: true },
    }).catch(() => []),
  ]);

  const pnlAllTime = allResults.reduce((s, r) => s + r.pnlBnb, 0);
  const pnlToday   = todayResults.reduce((s, r) => s + r.pnlBnb, 0);
  const winsAllTime = allResults.filter(r => r.pnlBnb > 0).length;
  const totalTrades = allResults.length;

  return NextResponse.json({ pnlAllTime, pnlToday, winsAllTime, totalTrades });
}

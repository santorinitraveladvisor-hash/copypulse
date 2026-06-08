import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const traderCount = await prisma.trader.count({ where: { isActive: true } });
    const orderCount = await prisma.copiedOrder.count();

    return NextResponse.json({
      balance: "See Binance App",
      status: "Bot Running",
      traderCount,
      orderCount,
    });
  } catch (e: any) {
    return NextResponse.json({ balance: "—", status: "DB Error: " + e.message, traderCount: 0, orderCount: 0 });
  }
}

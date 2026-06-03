import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const signalSchema = z.object({
  traderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  secret: z.string()
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = signalSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
    
    const saved = await prisma.incomingSignal.create({
      data: {
        traderId: validation.data.traderId,
        symbol: validation.data.symbol,
        side: validation.data.side,
        rawPayload: JSON.stringify(body),
        status: 'PENDING'
      }
    });
    return NextResponse.json({ message: 'Signal received', id: saved.id });
  } catch (e) { return NextResponse.json({ error: 'Server error' }, { status: 500 }); }
}

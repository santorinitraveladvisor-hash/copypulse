'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function addTrader(formData: FormData) {
  const name = formData.get('name') as string;
  const walletAddress = formData.get('walletAddress') as string;
  const maxTradeSize = parseFloat(formData.get('maxTradeSize') as string);
  const riskMultiplier = parseFloat(formData.get('riskMultiplier') as string);
  const allowedPairs = formData.get('allowedPairs') as string;

  await prisma.trader.create({
    data: {
      name,
      walletAddress: walletAddress || null,
      signalSourceType: 'WEBHOOK',
      maxTradeSize: maxTradeSize || 11,
      riskMultiplier: riskMultiplier || 1.0,
      allowedPairs: allowedPairs || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT',
      isActive: true,
    }
  });

  revalidatePath('/traders');
}

export async function deleteTrader(id: string) {
  await prisma.trader.delete({
    where: { id }
  });
  revalidatePath('/traders');
}

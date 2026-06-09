'use server'

import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { redirect } from 'next/navigation';

export async function connectExchange(formData: FormData) {
  const apiKey = formData.get('apiKey') as string;
  const apiSecret = formData.get('apiSecret') as string;

  if (!apiKey || !apiSecret) {
    throw new Error('API Key and Secret are required');
  }

  const encryptedKey = encrypt(apiKey);
  const encryptedSecret = encrypt(apiSecret);

  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'admin@copypulse.local',
        password: 'secure-password',
      }
    });
  }

  // Deactivate any existing exchange accounts before adding a new one
  await prisma.exchangeAccount.updateMany({
    where: { userId: user.id },
    data: { isActive: false },
  });

  await prisma.exchangeAccount.create({
    data: {
      userId: user.id,
      name: 'Binance Testnet',
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      isTestnet: true,
      isActive: true,
    }
  });

  redirect('/dashboard');
}

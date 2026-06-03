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

  // 1. Encrypt the keys for safety
  const encryptedKey = encrypt(apiKey);
  const encryptedSecret = encrypt(apiSecret);

  // 2. Save to your local database
  // We check if the user exists first, if not we create one
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'admin@copypulse.local',
        password: 'secure-password', // In a real app, use hashing
        id: 'default-user'
      }
    });
  }

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

  // 3. Go back to dashboard
  redirect('/dashboard');
}

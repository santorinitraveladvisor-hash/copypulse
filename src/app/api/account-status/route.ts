import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JsonRpcProvider, formatEther } from 'ethers';

const WALLET = '0xD7D4E440b6E99d097C061cb53639D404d421Ff6B';
const BSC_RPC = 'https://bsc-dataseed1.binance.org/';

export async function GET() {
  const [traderCount, orderCount, balance] = await Promise.all([
    prisma.trader.count({ where: { isActive: true } }).catch(() => 0),
    prisma.copiedOrder.count().catch(() => 0),
    new JsonRpcProvider(BSC_RPC).getBalance(WALLET)
      .then(b => `${parseFloat(formatEther(b)).toFixed(4)} BNB`)
      .catch(() => '— BNB'),
  ]);

  return NextResponse.json({ balance, status: 'Bot Running', traderCount, orderCount });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JsonRpcProvider, formatEther } from 'ethers';

export const dynamic = 'force-dynamic';

const WALLET  = '0xD7D4E440b6E99d097C061cb53639D404d421Ff6B';
const BSC_RPCS = [
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-rpc.publicnode.com',
];

async function getBnbBalance(): Promise<number | null> {
  for (const rpc of BSC_RPCS) {
    try {
      const balance = await new JsonRpcProvider(rpc).getBalance(WALLET);
      const bnb = parseFloat(formatEther(balance));
      if (bnb > 0) return bnb;
    } catch (_) { /* try next */ }
  }
  // All RPCs returned 0 or failed — return the last known 0 if any succeeded
  try {
    const balance = await new JsonRpcProvider(BSC_RPCS[0]).getBalance(WALLET);
    return parseFloat(formatEther(balance));
  } catch (_) {
    return null;
  }
}

export async function GET() {
  const [traderCount, orderCount, bnbRaw, bnbPrice] = await Promise.all([
    prisma.trader.count({ where: { isActive: true } }).catch(() => 0),
    prisma.copiedOrder.count().catch(() => 0),
    getBnbBalance(),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd')
      .then(r => r.json())
      .then((d: { binancecoin: { usd: number } }) => d.binancecoin.usd)
      .catch(() => null),
  ]);

  const bnbBalance = bnbRaw !== null ? parseFloat(bnbRaw.toFixed(4)) : null;
  const usdtValue  = bnbRaw !== null && bnbPrice !== null
    ? parseFloat((bnbRaw * bnbPrice).toFixed(2))
    : null;

  return NextResponse.json({ bnbBalance, usdtValue, status: 'Bot Running', traderCount, orderCount });
}

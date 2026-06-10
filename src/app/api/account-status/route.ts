import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { JsonRpcProvider, formatEther } from 'ethers';

const WALLET = '0xD7D4E440b6E99d097C061cb53639D404d421Ff6B';
const BSC_RPC = 'https://bsc-dataseed1.binance.org/';

export async function GET() {
  const [traderCount, orderCount, bnbRaw, bnbPrice] = await Promise.all([
    prisma.trader.count({ where: { isActive: true } }).catch(() => 0),
    prisma.copiedOrder.count().catch(() => 0),
    new JsonRpcProvider(BSC_RPC).getBalance(WALLET)
      .then(b => parseFloat(formatEther(b)))
      .catch(() => null),
    fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT')
      .then(r => r.json())
      .then(d => parseFloat(d.price))
      .catch(() => null),
  ]);

  const bnbBalance = bnbRaw !== null ? parseFloat(bnbRaw.toFixed(4)) : null;
  const usdtValue  = bnbRaw !== null && bnbPrice !== null
    ? parseFloat((bnbRaw * bnbPrice).toFixed(2))
    : null;

  return NextResponse.json({ bnbBalance, usdtValue, status: 'Bot Running', traderCount, orderCount });
}

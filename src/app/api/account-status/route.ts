import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBinanceClient } from '@/lib/binance';
import { decrypt } from '@/lib/encryption';

export async function GET() {
  try {
    const account = await prisma.exchangeAccount.findFirst({ where: { isActive: true } });
    if (!account) return NextResponse.json({ balance: "0.00", status: "Disconnected" });

    const client = getBinanceClient({
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      isTestnet: false
    });

    // 1. Get Spot Balance
    const spotInfo = await client.accountInfo();
    const spotUsdt = spotInfo.balances.find((b: any) => b.asset === 'USDT');
    const spotTotal = spotUsdt ? parseFloat(spotUsdt.free) : 0;

    // 2. Get Funding/User Balance (Where P2P money usually sits)
    // Note: This requires "Permits Universal Transfer" permission on your API Key
    let fundingTotal = 0;
    try {
      const userAssets = await client.userAsset();
      const fundingUsdt = userAssets.find((a: any) => a.asset === 'USDT');
      fundingTotal = fundingUsdt ? parseFloat(fundingUsdt.free) : 0;
    } catch (e) {
      console.log("Funding wallet fetch skipped (Check API permissions)");
    }

    const totalBalance = (spotTotal + fundingTotal).toFixed(2);

    const traderCount = await prisma.trader.count({ where: { isActive: true } });
    const orderCount = await prisma.copiedOrder.count();

    return NextResponse.json({ 
      balance: totalBalance, 
      status: "Live Connected",
      traderCount,
      orderCount
    });
  } catch (e: any) {
    return NextResponse.json({ balance: "0.00", status: "Error: " + e.message });
  }
}

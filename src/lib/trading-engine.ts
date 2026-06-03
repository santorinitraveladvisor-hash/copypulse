import { prisma } from './prisma';
import { getBinanceClient } from './binance';
import { decrypt } from './encryption';

export async function processSignal(signal: { traderId: string, symbol: string, side: 'BUY' | 'SELL' }) {
  const trader = await prisma.trader.findUnique({ where: { id: signal.traderId } });
  if (!trader || !trader.isActive) return;

  const account = await prisma.exchangeAccount.findFirst({ where: { isActive: true } });
  if (!account) return;

  try {
    const client = getBinanceClient({
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      isTestnet: false
    });

    let order;
    if (signal.side === 'BUY') {
      const usdtAmount = trader.maxTradeSize * trader.riskMultiplier;
      order = await client.order({
        symbol: signal.symbol,
        side: 'BUY',
        type: 'MARKET',
        quoteOrderQty: usdtAmount.toFixed(2),
      });
    } else {
      const asset = signal.symbol.replace('USDT', '');
      const accountInfo = await client.accountInfo();
      const balance = accountInfo.balances.find(b => b.asset === asset);
      if (balance && parseFloat(balance.free) > 0) {
        order = await client.order({
          symbol: signal.symbol,
          side: 'SELL',
          type: 'MARKET',
          quantity: balance.free,
        });
      }
    }

    if (order) {
      // Calculate PnL if it's a SELL
      let pnl = 0;
      if (signal.side === 'SELL') {
        const lastBuy = await prisma.copiedOrder.findFirst({
          where: { traderId: trader.id, symbol: signal.symbol, side: 'BUY' },
          orderBy: { createdAt: 'desc' }
        });
        if (lastBuy && lastBuy.price) {
          const sellPrice = parseFloat(order.fills?.[0]?.price || "0");
          pnl = (sellPrice - lastBuy.price) * parseFloat(order.executedQty);
        }
      }

      await prisma.copiedOrder.create({
        data: {
          traderId: trader.id,
          exchangeAccountId: account.id,
          symbol: signal.symbol,
          side: signal.side,
          quantity: parseFloat(order.executedQty || "0"),
          price: parseFloat(order.fills?.[0]?.price || "0"),
          status: 'FILLED',
          exchangeOrderId: order.orderId.toString(),
          fee: pnl // We store the trade PnL in the 'fee' column for the demo
        }
      });
    }
  } catch (e: any) { console.error("Trade Error:", e.message); }
}

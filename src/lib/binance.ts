import Binance, { Binance as BinanceClient } from 'binance-api-node';

export function getBinanceClient(keys: {apiKey: string, apiSecret: string, isTestnet: boolean}): BinanceClient {
  return Binance({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    // POINTING TO REAL BINANCE
    httpBase: 'https://api.binance.com',
    getTime: () => Date.now(),
  });
}

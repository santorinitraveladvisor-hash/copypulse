import Binance from 'binance-api-node';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BinanceClient = ReturnType<typeof Binance>;

export function getBinanceClient(keys: {apiKey: string, apiSecret: string, isTestnet: boolean}): BinanceClient {
  return Binance({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    // POINTING TO REAL BINANCE
    httpBase: 'https://api.binance.com',
    getTime: () => Date.now(),
  });
}

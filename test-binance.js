const Binance = require('binance-api-node').default;

// PASTE YOUR KEYS HERE MANUALLY TO TEST
const apiKey = 'YOUR_API_KEY';
const apiSecret = 'YOUR_SECRET_KEY';

const client = Binance({
  apiKey: apiKey,
  apiSecret: apiSecret,
  httpBase: 'https://testnet.binance.vision',
});

async function runTest() {
  console.log('Testing connection to Binance Testnet...');
  try {
    const info = await client.accountInfo();
    console.log('✅ SUCCESS! Your keys are working.');
    console.log('Balance:', info.balances.find(b => b.asset === 'USDT'));
  } catch (e) {
    console.log('❌ FAILED!');
    console.log('Error Message:', e.message);
    if (e.message.includes('permissions')) {
      console.log('Tip: Ensure you are using the SPOT Testnet, not the Futures Testnet.');
    }
  }
}
runTest();

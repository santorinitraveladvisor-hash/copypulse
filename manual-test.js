const crypto = require('crypto');
const https = require('https');

// --- PASTE YOUR KEYS HERE ---
const rawKey = 'YOUR_API_KEY_HERE';
const rawSecret = 'YOUR_SECRET_KEY_HERE';
// ----------------------------

// CLEAN THE KEYS (Remove spaces, quotes, and newlines)
const apiKey = rawKey.trim().replace(/['"]/g, '');
const apiSecret = rawSecret.trim().replace(/['"]/g, '');

console.log(`Key Length: ${apiKey.length} characters`);
if (apiKey.length !== 64) {
  console.log('⚠️ WARNING: Your API Key is not 64 characters. It might be incomplete!');
}

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function test() {
  console.log('--- Manual Binance Test (Cleaned) ---');
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = sign(queryString, apiSecret);
  const url = `https://testnet.binance.vision/api/v3/account?${queryString}&signature=${signature}`;

  const options = {
    headers: { 'X-MBX-APIKEY': apiKey }
  };

  https.get(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ SUCCESS! Your keys are working.');
      } else {
        console.log('❌ FAILED!');
        console.log('Binance Response:', data);
      }
    });
  });
}
test();

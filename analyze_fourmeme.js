#!/usr/bin/env node
'use strict';

// Load local .env only as a fallback — Railway/Neon vars take precedence
require('dotenv').config();

// Detect dead local Railway Postgres and refuse to use it
const dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('rlwy.net') || dbUrl.includes('railway.internal')) {
  console.error('ERROR: DATABASE_URL points to local Railway Postgres (dead DB). Set it to the Neon URL before running.');
  console.error('  export DATABASE_URL="$(railway variables --json | python3 -c \\"import sys,json; d=json.load(sys.stdin); print(d[\'DATABASE_URL_UNPOOLED\'])\\"")"');
  process.exit(1);
}

const { ethers } = require('ethers');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const WBNB            = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095d';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const FACTORY_ABI     = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI        = [
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
];
const ROUTER_ABI      = ['function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'];
const PANCAKE_ROUTER  = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org/');
const factory  = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
const router   = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);

// Min BNB reserve to not count as a rug (~$600/BNB × 0.5 BNB ≈ $300)
const MIN_BNB_RESERVE = 0.5;

async function getPriceAndReserve(tokenAddress) {
  try {
    const pairAddr = await factory.getPair(tokenAddress, WBNB);
    if (!pairAddr || pairAddr === ethers.ZeroAddress) return null;

    const pair   = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const [r0, r1, ] = await pair.getReserves();
    const token0 = (await pair.token0()).toLowerCase();

    const wbnbIsToken1  = token0 === tokenAddress.toLowerCase();
    const wbnbReserve   = parseFloat(ethers.formatEther(wbnbIsToken1 ? r1 : r0));

    // Get spot price via getAmountsOut(1 token → WBNB)
    let pricePerToken = null;
    try {
      const oneToken = ethers.parseEther('1');
      const amounts  = await router.getAmountsOut(oneToken, [tokenAddress, WBNB]);
      pricePerToken  = parseFloat(ethers.formatEther(amounts[1]));
    } catch (_) {}

    return { pairAddr, wbnbReserve, pricePerToken };
  } catch (_) {
    return null;
  }
}

async function analyzeRow(row) {
  const result = await getPriceAndReserve(row.tokenAddress);

  let graduated       = false;
  let currentPriceBnb = null;
  let status          = 'no_pair_yet';

  if (result) {
    graduated       = true;
    currentPriceBnb = result.pricePerToken;
    status          = result.wbnbReserve < MIN_BNB_RESERVE ? 'likely_rug' : 'graduated';
  }

  await prisma.fourMemeSignal.update({
    where: { id: row.id },
    data: { graduated, currentPriceBnb, status, checkedAt: new Date() },
  });

  return { ...row, graduated, currentPriceBnb, status, wbnbReserve: result?.wbnbReserve ?? null };
}

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const rows = await prisma.fourMemeSignal.findMany({ orderBy: { signalTime: 'asc' } });

  if (rows.length === 0) {
    console.log('No four.meme signals logged yet.');
    process.exit(0);
  }

  console.log(`\nChecking ${rows.length} signals...\n`);

  const results = [];
  for (const row of rows) {
    process.stdout.write(`  ${row.tokenAddress.slice(0, 12)}...`);
    const r = await analyzeRow(row);
    results.push(r);
    process.stdout.write(` → ${r.status}\n`);
    // polite pace — avoid hammering the RPC
    await new Promise(res => setTimeout(res, 250));
  }

  const total      = results.length;
  const graduated  = results.filter(r => r.status === 'graduated');
  const likelyRug  = results.filter(r => r.status === 'likely_rug');
  const noPairYet  = results.filter(r => r.status === 'no_pair_yet');

  // Returns for graduated tokens that have an entry price
  const returns = graduated
    .filter(r => r.entryPriceBnb && r.currentPriceBnb)
    .map(r => ((r.currentPriceBnb - r.entryPriceBnb) / r.entryPriceBnb) * 100);

  const avgReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
  const medReturn = median(returns);

  console.log('\n' + '─'.repeat(60));
  console.log('  four.meme Consensus Signal Analysis');
  console.log('─'.repeat(60));
  console.log(`  Total signals logged : ${total}`);
  console.log(`  Graduated (pair+liq) : ${graduated.length}  (${((graduated.length/total)*100).toFixed(1)}%)`);
  console.log(`  Likely rug (low liq) : ${likelyRug.length}  (${((likelyRug.length/total)*100).toFixed(1)}%)`);
  console.log(`  Still on curve       : ${noPairYet.length}  (${((noPairYet.length/total)*100).toFixed(1)}%)`);

  if (returns.length > 0) {
    console.log(`\n  Return vs entry price (${returns.length} graduated with entry price):`);
    console.log(`    Average : ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}%`);
    console.log(`    Median  : ${medReturn >= 0 ? '+' : ''}${medReturn.toFixed(1)}%`);
  } else {
    console.log(`\n  No entry prices recorded yet — run again after signals accumulate.`);
  }

  if (graduated.length > 0) {
    console.log('\n  Graduated tokens:');
    console.log(`  ${'Token'.padEnd(14)} ${'Entry BNB'.padStart(12)} ${'Current BNB'.padStart(13)} ${'Return'.padStart(9)} ${'BNB Reserve'.padStart(13)}`);
    console.log('  ' + '─'.repeat(63));
    for (const r of graduated) {
      const entry   = r.entryPriceBnb   ? r.entryPriceBnb.toExponential(3)   : '     n/a';
      const current = r.currentPriceBnb ? r.currentPriceBnb.toExponential(3) : '          n/a';
      const ret     = r.entryPriceBnb && r.currentPriceBnb
        ? `${(((r.currentPriceBnb - r.entryPriceBnb) / r.entryPriceBnb) * 100).toFixed(1)}%`
        : '    n/a';
      const liq     = r.wbnbReserve ? `${r.wbnbReserve.toFixed(2)} BNB` : '    n/a';
      console.log(`  ${r.tokenAddress.slice(0, 12)}...  ${entry.padStart(10)} ${current.padStart(13)} ${ret.padStart(9)} ${liq.padStart(13)}`);
    }
  }

  console.log('─'.repeat(60) + '\n');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

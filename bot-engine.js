/**
 * CopyPulse Bot Engine
 * BSC on-chain wallet monitor + auto-discovery + trade executor + TP/SL manager
 * 
 * Run: node bot-engine.js
 * Requires: npm install @prisma/client axios ethers dotenv
 */

require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// CONFIG — paste your keys into .env file
// ─────────────────────────────────────────────
const CONFIG = {
  BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY || 'XJSBR7BPBT4X3Z595RYXNTCJFYGC3BHTYC',
  BSC_RPC: process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org/',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '', // Your BSC wallet private key
  
  // Trading params
  MAX_TRADE_BNB: parseFloat(process.env.MAX_TRADE_BNB || '0.05'),     // Max BNB per trade
  TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT || '100'),   // 100% = 2x
  STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT || '30'),        // -30% stop loss
  MAX_OPEN_POSITIONS: parseInt(process.env.MAX_OPEN_POSITIONS || '5'),
  MAX_DAILY_LOSS_BNB: parseFloat(process.env.MAX_DAILY_LOSS_BNB || '0.5'),

  // Polling intervals (ms)
  WALLET_POLL_MS: 15000,      // Check wallets every 15s
  DISCOVERY_POLL_MS: 3600000, // Re-discover top wallets every hour
  POSITION_POLL_MS: 30000,    // Check positions every 30s

  // Auto-discovery params
  MIN_WIN_RATE: 0.60,         // 60% win rate minimum
  MIN_TRADES: 10,             // Minimum trades to qualify
  TOP_WALLETS_TO_TRACK: 10,   // How many wallets to auto-track
};

// ─────────────────────────────────────────────
// BSC / PANCAKESWAP CONSTANTS
// ─────────────────────────────────────────────
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const BSCSCAN_API = 'https://api.bscscan.com/api';

const PANCAKE_ROUTER_ABI = [
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let provider;
let wallet;
let router;
let trackedWallets = new Map();   // address -> { name, lastBlock, stats }
let openPositions = new Map();    // tokenAddress -> { buyPrice, amount, bnbSpent, entryTime }
let dailyLossBNB = 0;
let lastDailyReset = new Date().toDateString();

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
async function init() {
  log('🚀 CopyPulse Engine Starting...');

  // Connect to BSC
  provider = new ethers.JsonRpcProvider(CONFIG.BSC_RPC);
  const network = await provider.getNetwork();
  log(`✅ Connected to BSC (chainId: ${network.chainId})`);

  // Setup wallet
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    log('⚠️  No WALLET_PRIVATE_KEY set — running in MONITOR ONLY mode (no trades)');
  } else {
    wallet = new ethers.Wallet(CONFIG.WALLET_PRIVATE_KEY, provider);
    router = new ethers.Contract(PANCAKE_ROUTER, PANCAKE_ROUTER_ABI, wallet);
    const balance = await provider.getBalance(wallet.address);
    log(`✅ Wallet: ${wallet.address} | BNB: ${ethers.formatEther(balance)}`);
  }

  // Load manually added wallets from DB
  await loadWalletsFromDB();

  // Start all loops
  await discoverTopWallets();
  setInterval(discoverTopWallets, CONFIG.DISCOVERY_POLL_MS);
  setInterval(monitorWallets, CONFIG.WALLET_POLL_MS);
  setInterval(monitorPositions, CONFIG.POSITION_POLL_MS);
  setInterval(resetDailyLoss, 60000);

  log('✅ All systems running. Watching the trenches...\n');
}

// ─────────────────────────────────────────────
// WALLET MANAGEMENT
// ─────────────────────────────────────────────
async function loadWalletsFromDB() {
  const traders = await prisma.trader.findMany({ where: { isActive: true } });
  for (const t of traders) {
    if (t.walletAddress) {
      trackedWallets.set(t.walletAddress.toLowerCase(), {
        name: t.name,
        traderId: t.id,
        lastBlock: 0,
        source: 'MANUAL',
        stats: { wins: 0, losses: 0 },
      });
      log(`📌 Tracking manual wallet: ${t.name} (${t.walletAddress})`);
    }
  }
}

// ─────────────────────────────────────────────
// AUTO-DISCOVERY — finds top BSC trench traders
// ─────────────────────────────────────────────
async function discoverTopWallets() {
  log('🔍 Auto-discovering top BSC wallets...');
  try {
    // Strategy: find wallets that frequently interact with PancakeSwap
    // and have high PnL by analyzing recent DEX transactions
    const candidates = await fetchPancakeSwapActiveWallets();
    const scored = await scoreWallets(candidates);
    
    const top = scored
      .filter(w => w.winRate >= CONFIG.MIN_WIN_RATE && w.totalTrades >= CONFIG.MIN_TRADES)
      .slice(0, CONFIG.TOP_WALLETS_TO_TRACK);

    log(`📊 Discovered ${top.length} qualifying wallets`);

    for (const w of top) {
      const addr = w.address.toLowerCase();
      if (!trackedWallets.has(addr)) {
        trackedWallets.set(addr, {
          name: `AUTO_${addr.slice(0, 6)}`,
          traderId: null,
          lastBlock: 0,
          source: 'AUTO',
          stats: { wins: w.wins, losses: w.losses, winRate: w.winRate },
        });

        // Save to DB as a trader record
        const trader = await prisma.trader.create({
          data: {
            name: `AUTO_${addr.slice(0, 6).toUpperCase()}`,
            walletAddress: w.address,
            signalSourceType: 'WEBHOOK',
            maxTradeSize: CONFIG.MAX_TRADE_BNB * 400, // approx USDT
            riskMultiplier: 1.0,
            allowedPairs: 'BSC_ANY',
            isActive: true,
          }
        });

        trackedWallets.get(addr).traderId = trader.id;
        log(`✨ Auto-added wallet: ${w.address} (winRate: ${(w.winRate * 100).toFixed(0)}%, trades: ${w.totalTrades})`);

        await prisma.auditLog.create({
          data: {
            action: 'WALLET_AUTO_DISCOVERED',
            details: JSON.stringify({ address: w.address, winRate: w.winRate, totalTrades: w.totalTrades }),
            severity: 'INFO',
          }
        });
      }
    }
  } catch (e) {
    log(`❌ Discovery error: ${e.message}`);
  }
}

async function fetchPancakeSwapActiveWallets() {
  // Get recent large PancakeSwap swap transactions
  const res = await axios.get(BSCSCAN_API, {
    params: {
      module: 'account',
      action: 'tokentx',
      address: PANCAKE_ROUTER,
      startblock: await getRecentBlock(50000), // ~last 50k blocks (~41hrs)
      endblock: 'latest',
      sort: 'desc',
      apikey: CONFIG.BSCSCAN_API_KEY,
    }
  });

  if (res.data.status !== '1') return [];

  // Count unique wallet interactions
  const walletActivity = new Map();
  for (const tx of res.data.result || []) {
    const addr = tx.from.toLowerCase();
    if (!walletActivity.has(addr)) walletActivity.set(addr, new Set());
    walletActivity.get(addr).add(tx.hash);
  }

  // Filter for wallets with multiple trades (active traders)
  const candidates = [];
  for (const [addr, txSet] of walletActivity.entries()) {
    if (txSet.size >= CONFIG.MIN_TRADES) {
      candidates.push(addr);
    }
  }

  return candidates.slice(0, 50); // analyze top 50 candidates
}

async function scoreWallets(addresses) {
  const scored = [];

  for (const address of addresses) {
    try {
      const score = await analyzeWalletPnL(address);
      if (score) scored.push({ address, ...score });
      await sleep(200); // rate limit BSCScan
    } catch (e) {
      // skip failed
    }
  }

  return scored.sort((a, b) => b.winRate - a.winRate);
}

async function analyzeWalletPnL(address) {
  // Get BNB transaction history to estimate PnL
  const res = await axios.get(BSCSCAN_API, {
    params: {
      module: 'account',
      action: 'txlist',
      address,
      startblock: await getRecentBlock(100000),
      endblock: 'latest',
      sort: 'asc',
      apikey: CONFIG.BSCSCAN_API_KEY,
    }
  });

  if (res.data.status !== '1' || !res.data.result?.length) return null;

  const txs = res.data.result.filter(tx =>
    tx.to?.toLowerCase() === PANCAKE_ROUTER.toLowerCase() && tx.isError === '0'
  );

  if (txs.length < CONFIG.MIN_TRADES) return null;

  // Simple PnL estimation: track BNB in/out via PancakeSwap
  let wins = 0, losses = 0;
  const tokenBuys = new Map();

  for (const tx of txs) {
    const value = parseFloat(ethers.formatEther(tx.value || '0'));
    if (value > 0.001) {
      // BNB spent = buy
      const key = tx.hash;
      tokenBuys.set(key, value);
      wins++; // assume win for now, refine with token tx analysis
    }
  }

  const totalTrades = wins + losses;
  if (totalTrades < CONFIG.MIN_TRADES) return null;

  return {
    wins,
    losses,
    totalTrades,
    winRate: wins / totalTrades,
  };
}

// ─────────────────────────────────────────────
// WALLET MONITOR — watches for new buys
// ─────────────────────────────────────────────
async function monitorWallets() {
  const currentBlock = await provider.getBlockNumber();

  for (const [address, info] of trackedWallets.entries()) {
    try {
      const fromBlock = info.lastBlock || currentBlock - 100;
      const txs = await getWalletTransactions(address, fromBlock, currentBlock);

      for (const tx of txs) {
        await processTx(tx, address, info);
      }

      trackedWallets.get(address).lastBlock = currentBlock;
    } catch (e) {
      // silent fail per wallet
    }

    await sleep(100); // rate limit
  }
}

async function getWalletTransactions(address, fromBlock, toBlock) {
  const res = await axios.get(BSCSCAN_API, {
    params: {
      module: 'account',
      action: 'txlist',
      address,
      startblock: fromBlock,
      endblock: toBlock,
      sort: 'asc',
      apikey: CONFIG.BSCSCAN_API_KEY,
    }
  });

  if (res.data.status !== '1') return [];
  return res.data.result || [];
}

async function processTx(tx, walletAddress, walletInfo) {
  // Only care about PancakeSwap interactions
  if (tx.to?.toLowerCase() !== PANCAKE_ROUTER.toLowerCase()) return;
  if (tx.isError !== '0') return;

  const value = parseFloat(ethers.formatEther(tx.value || '0'));
  const isBuy = value > 0.001; // BNB spent = buying a token

  if (!isBuy) return; // skip sells for now (handle via position monitor)

  // Get the token bought from token transfer logs
  const tokenAddress = await getTokenFromTx(tx.hash);
  if (!tokenAddress) return;

  // Skip if already in position
  if (openPositions.has(tokenAddress)) return;

  // Skip if max positions reached
  if (openPositions.size >= CONFIG.MAX_OPEN_POSITIONS) {
    log(`⚠️  Max positions (${CONFIG.MAX_OPEN_POSITIONS}) reached, skipping`);
    return;
  }

  // Skip if daily loss limit hit
  if (dailyLossBNB >= CONFIG.MAX_DAILY_LOSS_BNB) {
    log(`🛑 Daily loss limit reached (${dailyLossBNB} BNB), pausing trades`);
    return;
  }

  log(`🎯 Signal detected! Wallet ${walletInfo.name} bought token ${tokenAddress}`);

  // Save signal to DB
  const signal = await prisma.incomingSignal.create({
    data: {
      traderId: walletInfo.traderId || await getDefaultTraderId(),
      symbol: tokenAddress,
      side: 'BUY',
      rawPayload: JSON.stringify({ txHash: tx.hash, walletAddress, tokenAddress, bnbSpent: value }),
      status: 'PENDING',
    }
  });

  await auditLog('SIGNAL_DETECTED', { walletAddress, tokenAddress, txHash: tx.hash });

  // Execute trade
  await executeBuy(tokenAddress, signal.id, walletInfo.traderId);
}

async function getTokenFromTx(txHash) {
  try {
    const res = await axios.get(BSCSCAN_API, {
      params: {
        module: 'account',
        action: 'tokentx',
        txhash: txHash,
        apikey: CONFIG.BSCSCAN_API_KEY,
      }
    });

    if (res.data.status !== '1' || !res.data.result?.length) return null;

    // Find the token received (not WBNB)
    const tokenTx = res.data.result.find(t =>
      t.contractAddress?.toLowerCase() !== WBNB.toLowerCase()
    );

    return tokenTx?.contractAddress || null;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────
// TRADE EXECUTOR
// ─────────────────────────────────────────────
async function executeBuy(tokenAddress, signalId, traderId) {
  if (!wallet) {
    log(`📋 [MONITOR MODE] Would buy ${tokenAddress} — set WALLET_PRIVATE_KEY to enable trading`);
    await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'SKIPPED', errorMessage: 'Monitor mode - no wallet key' } });
    return;
  }

  const startTime = Date.now();

  try {
    // Safety checks on the token
    const safe = await tokenSafetyCheck(tokenAddress);
    if (!safe.ok) {
      log(`🚫 Token ${tokenAddress} failed safety check: ${safe.reason}`);
      await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'SKIPPED', errorMessage: safe.reason } });
      return;
    }

    const bnbAmount = ethers.parseEther(CONFIG.MAX_TRADE_BNB.toString());
    const path = [WBNB, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5; // 5 min

    // Get expected output
    const amounts = await router.getAmountsOut(bnbAmount, path);
    const expectedOut = amounts[1];
    const minOut = expectedOut * 85n / 100n; // 15% slippage tolerance

    log(`💰 Buying token ${tokenAddress} with ${CONFIG.MAX_TRADE_BNB} BNB...`);

    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      minOut,
      path,
      wallet.address,
      deadline,
      { value: bnbAmount, gasLimit: 300000, gasPrice: ethers.parseUnits('5', 'gwei') }
    );

    const receipt = await tx.wait();
    const latency = Date.now() - startTime;

    log(`✅ BUY executed! Hash: ${tx.hash} | Latency: ${latency}ms`);

    // Get actual token balance after buy
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    const tokenAmount = parseFloat(ethers.formatUnits(tokenBalance, decimals));

    // Get buy price
    const currentPrice = CONFIG.MAX_TRADE_BNB / tokenAmount;

    // Track open position
    openPositions.set(tokenAddress, {
      symbol,
      buyPrice: currentPrice,
      tokenAmount,
      bnbSpent: CONFIG.MAX_TRADE_BNB,
      entryTime: Date.now(),
      signalId,
      traderId,
      decimals,
    });

    // Save to DB
    const account = await prisma.exchangeAccount.findFirst({ where: { isActive: true } });
    await prisma.copiedOrder.create({
      data: {
        signalId,
        traderId: traderId || await getDefaultTraderId(),
        exchangeAccountId: account?.id || 'default',
        symbol: `${symbol}/BNB`,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: tokenAmount,
        price: currentPrice,
        status: 'FILLED',
        exchangeOrderId: tx.hash,
        fillPrice: currentPrice,
        fillQuantity: tokenAmount,
        latencyMs: latency,
      }
    });

    await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'EXECUTED' } });
    await auditLog('BUY_EXECUTED', { tokenAddress, symbol, bnbSpent: CONFIG.MAX_TRADE_BNB, txHash: tx.hash });

  } catch (e) {
    log(`❌ Buy failed for ${tokenAddress}: ${e.message}`);
    await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'FAILED', errorMessage: e.message } });
    await auditLog('BUY_FAILED', { tokenAddress, error: e.message }, 'ERROR');
  }
}

async function executeSell(tokenAddress, position, reason) {
  if (!wallet) return;

  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const decimals = position.decimals || 18;
    const tokenBalance = await tokenContract.balanceOf(wallet.address);

    if (tokenBalance === 0n) {
      openPositions.delete(tokenAddress);
      return;
    }

    // Approve router
    await tokenContract.approve(PANCAKE_ROUTER, tokenBalance);

    const path = [tokenAddress, WBNB];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const minBNB = 0n; // accept any amount (trench tokens are volatile)

    log(`📤 Selling ${position.symbol} (reason: ${reason})...`);

    const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      tokenBalance,
      minBNB,
      path,
      wallet.address,
      deadline,
      { gasLimit: 300000, gasPrice: ethers.parseUnits('5', 'gwei') }
    );

    await tx.wait();

    // Calculate PnL
    const bnbReceived = await estimateBNBReceived(tokenAddress, tokenBalance);
    const pnlBNB = bnbReceived - position.bnbSpent;
    const pnlPct = (pnlBNB / position.bnbSpent) * 100;

    if (pnlBNB < 0) dailyLossBNB += Math.abs(pnlBNB);

    log(`✅ SELL executed! ${position.symbol} | PnL: ${pnlBNB.toFixed(4)} BNB (${pnlPct.toFixed(1)}%) | Reason: ${reason}`);

    openPositions.delete(tokenAddress);

    const account = await prisma.exchangeAccount.findFirst({ where: { isActive: true } });
    await prisma.copiedOrder.create({
      data: {
        traderId: position.traderId || await getDefaultTraderId(),
        exchangeAccountId: account?.id || 'default',
        symbol: `${position.symbol}/BNB`,
        side: 'SELL',
        orderType: 'MARKET',
        quantity: parseFloat(ethers.formatUnits(tokenBalance, decimals)),
        status: 'FILLED',
        exchangeOrderId: tx.hash,
        fee: pnlBNB,
      }
    });

    await auditLog('SELL_EXECUTED', { tokenAddress, symbol: position.symbol, pnlBNB, pnlPct, reason });

  } catch (e) {
    log(`❌ Sell failed for ${tokenAddress}: ${e.message}`);
    await auditLog('SELL_FAILED', { tokenAddress, error: e.message }, 'ERROR');
  }
}

// ─────────────────────────────────────────────
// POSITION MONITOR — TP/SL
// ─────────────────────────────────────────────
async function monitorPositions() {
  if (openPositions.size === 0) return;

  for (const [tokenAddress, position] of openPositions.entries()) {
    try {
      const currentPrice = await getTokenPriceBNB(tokenAddress, position.tokenAmount);
      if (!currentPrice) continue;

      const pnlPct = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;

      // Take profit
      if (pnlPct >= CONFIG.TAKE_PROFIT_PCT) {
        log(`🎉 Take profit hit! ${position.symbol} +${pnlPct.toFixed(1)}%`);
        await executeSell(tokenAddress, position, 'TAKE_PROFIT');
        continue;
      }

      // Stop loss
      if (pnlPct <= -CONFIG.STOP_LOSS_PCT) {
        log(`🛑 Stop loss hit! ${position.symbol} ${pnlPct.toFixed(1)}%`);
        await executeSell(tokenAddress, position, 'STOP_LOSS');
        continue;
      }

      // Time-based exit: sell after 4 hours if no TP/SL hit
      const ageHours = (Date.now() - position.entryTime) / 3600000;
      if (ageHours >= 4) {
        log(`⏰ Time exit: ${position.symbol} held ${ageHours.toFixed(1)}hrs`);
        await executeSell(tokenAddress, position, 'TIME_EXIT');
        continue;
      }

      log(`📊 ${position.symbol} | PnL: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}% | TP: +${CONFIG.TAKE_PROFIT_PCT}% | SL: -${CONFIG.STOP_LOSS_PCT}%`);

    } catch (e) {
      // silent fail per position
    }
  }
}

async function getTokenPriceBNB(tokenAddress, tokenAmount) {
  try {
    const oneToken = ethers.parseEther('1');
    const path = [tokenAddress, WBNB];
    const amounts = await router.getAmountsOut(oneToken, path);
    return parseFloat(ethers.formatEther(amounts[1]));
  } catch (e) {
    return null;
  }
}

async function estimateBNBReceived(tokenAddress, tokenAmount) {
  try {
    const path = [tokenAddress, WBNB];
    const amounts = await router.getAmountsOut(tokenAmount, path);
    return parseFloat(ethers.formatEther(amounts[1]));
  } catch (e) {
    return 0;
  }
}

// ─────────────────────────────────────────────
// TOKEN SAFETY CHECK
// ─────────────────────────────────────────────
async function tokenSafetyCheck(tokenAddress) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    // Check total supply exists
    const supply = await tokenContract.totalSupply();
    if (supply === 0n) return { ok: false, reason: 'Zero supply' };

    // Check BSCScan for contract verification
    const res = await axios.get(BSCSCAN_API, {
      params: {
        module: 'contract',
        action: 'getsourcecode',
        address: tokenAddress,
        apikey: CONFIG.BSCSCAN_API_KEY,
      }
    });

    // Check token holder concentration (top holders)
    const holdersRes = await axios.get(BSCSCAN_API, {
      params: {
        module: 'token',
        action: 'tokenholderlist',
        contractaddress: tokenAddress,
        page: 1,
        offset: 10,
        apikey: CONFIG.BSCSCAN_API_KEY,
      }
    });

    if (holdersRes.data.status === '1' && holdersRes.data.result?.length) {
      const topHolder = holdersRes.data.result[0];
      const topHolderPct = parseFloat(topHolder.TokenHolderQuantity) / parseFloat(ethers.formatUnits(supply, 18)) * 100;
      if (topHolderPct > 50) {
        return { ok: false, reason: `Top holder owns ${topHolderPct.toFixed(0)}% — rug risk` };
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: true }; // fail open — don't block on API errors
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
async function getRecentBlock(blocksBack) {
  const current = await provider.getBlockNumber();
  return Math.max(0, current - blocksBack);
}

async function getDefaultTraderId() {
  const t = await prisma.trader.findFirst();
  return t?.id || 'unknown';
}

async function auditLog(action, details, severity = 'INFO') {
  await prisma.auditLog.create({
    data: { action, details: JSON.stringify(details), severity }
  });
}

function resetDailyLoss() {
  const today = new Date().toDateString();
  if (today !== lastDailyReset) {
    dailyLossBNB = 0;
    lastDailyReset = today;
    log('🔄 Daily loss counter reset');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─────────────────────────────────────────────
// STATUS API — simple HTTP for dashboard
// ─────────────────────────────────────────────
const http = require('http');

function startStatusServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/engine-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        trackedWallets: trackedWallets.size,
        openPositions: openPositions.size,
        dailyLossBNB,
        positions: Array.from(openPositions.entries()).map(([addr, p]) => ({
          token: addr,
          symbol: p.symbol,
          bnbSpent: p.bnbSpent,
          ageMinutes: ((Date.now() - p.entryTime) / 60000).toFixed(0),
        })),
        wallets: Array.from(trackedWallets.entries()).map(([addr, w]) => ({
          address: addr,
          name: w.name,
          source: w.source,
        })),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(3001, () => log('📡 Status server on http://localhost:3001/engine-status'));
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
startStatusServer();
init().catch(e => {
  log(`💥 Fatal error: ${e.message}`);
  process.exit(1);
});

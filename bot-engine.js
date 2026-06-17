/**
 * CopyPulse Bot Engine
 * BSC on-chain wallet monitor + auto-discovery + trade executor + TP/SL manager
 * 
 * Run: node bot-engine.js
 * Requires: npm install @prisma/client axios ethers dotenv
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { PrismaClient } = require('@prisma/client');
const { harvestWallets } = require('./harvest-wallets');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────
// CONFIG — paste your keys into .env file
// ─────────────────────────────────────────────
const CONFIG = {
  BSC_RPC: process.env.BSC_RPC || 'https://bsc-rpc.publicnode.com',
  BSC_WSS: process.env.QUICKNODE_WSS || 'wss://fluent-quaint-night.bsc.quiknode.pro/d99bf44ca3a1432d3b3a975cdb6b3d4b3ca013ad/',
  BSC_WSS_FALLBACK: 'wss://bsc-rpc.publicnode.com',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',

  // Binance API — used for momentum cross-check before executing buys
  BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
  BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY || '',

  // Trading params
  MAX_TRADE_BNB: parseFloat(process.env.MAX_TRADE_BNB || '0.05'),
  TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT || '100'),
  STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT || '30'),
  MAX_OPEN_POSITIONS: parseInt(process.env.MAX_OPEN_POSITIONS || '5'),
  MAX_DAILY_LOSS_BNB: parseFloat(process.env.MAX_DAILY_LOSS_BNB || '0.5'),

  // Momentum gates — skip buy if market is in heavy downtrend
  MIN_BNB_24H_CHANGE: -5,   // skip if BNB down >5% in 24h
  MIN_BTC_24H_CHANGE: -8,   // skip if BTC down >8% in 24h (macro crash)

  // Position monitoring interval (ms)
  POSITION_POLL_MS: 30000,

  // Auto-discovery params
  MIN_WIN_RATE: 0.60,
  MIN_TRADES: 10,
  TOP_WALLETS_TO_TRACK: 10,

  // Safety mode
  // SELF_TRADE=true  → run all safety checks and execute real buys
  // SELF_TRADE=false → monitor-only (log signals, never trade)
  SELF_TRADE: process.env.SELF_TRADE === 'true',

  // Telegram notifications
  TELEGRAM_TOKEN:   process.env.TELEGRAM_TOKEN   || '8917799761:AAHvE2LdQ85sMs_wNDNVVMBIYzeTXG3Cgkg',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '6488244344',
};

// ─────────────────────────────────────────────
// BSC / PANCAKESWAP CONSTANTS
// ─────────────────────────────────────────────
const BINANCE_API = 'https://api.binance.com';

const PANCAKE_ROUTER  = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const SWAP_TOPIC        = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const PAIR_CREATED_TOPIC = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
const TRANSFER_TOPIC    = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ─────────────────────────────────────────────
// BLACKLIST — known rug / scam token addresses
// ─────────────────────────────────────────────
const BLACKLISTED_TOKENS = new Set([
  '0xb8c77482e45f1f44de1745f52c74426c631bdd52', // fake BNB
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', // CAKE (avoid copy-buy)
  // Add more as discovered
  ...(process.env.BLACKLIST_TOKENS || '').split(',').filter(Boolean).map(a => a.toLowerCase()),
]);

const PANCAKE_ROUTER_ABI = [
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI    = ['function getReserves() view returns (uint112,uint112,uint32)'];

// ─────────────────────────────────────────────
// FOUR.MEME CONSTANTS
// ─────────────────────────────────────────────
const FOUR_MEME_CONTRACT = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
// Verified against live contract logs (publicnode RPC, block ~104009988).
// ALL 8 parameters are non-indexed — topics.length === 1 on every emission.
// Signature: TokenPurchase(address buyer, address token,
//   uint256 p2, uint256 tokenAmount, uint256 bnbReserve, uint256 bnbPaid,
//   uint256 p6, uint256 p7)
// Buyer  = ABI data[0], Token = data[1], BNB paid by buyer = data[5].
// keccak256("TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)")
// = 0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942
const FOUR_MEME_PURCHASE_TOPIC = ethers.id('TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)');

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let provider;
let wallet;
let router;
let trackedWallets = new Map();   // address -> { name, lastBlock, stats }
let openPositions = new Map();    // tokenAddress -> { buyPrice, amount, bnbSpent, entryTime }
let dailyLossBNB = 0;
let dailyPnLBNB  = 0;
let lastDailyReset = new Date().toDateString();
const pairTokenCache    = new Map(); // pairAddr -> tokenAddr
const fourMemeConsensus = new Map(); // tokenAddr -> { buyers: Set<address>, firstSeen: ms }
const closingPositions  = new Set(); // tokenAddresses currently being sold — double-fire guard
const positionPairAddrs = new Map(); // tokenAddr -> pairAddr, for event-driven SL subscriptions
const sellFailCounts    = new Map(); // tokenAddr -> consecutive sell failure count

// WebSocket state
let wsProvider        = null;
let wsConnected       = false;
let wsLastBlock       = 0;
let wsLastBlockTime   = 0;
let wsReconnectDelay  = 2000;
let wsReconnectTimer  = null;
let wsDisconnectTime  = 0;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
async function init() {
  log('🚀 CopyPulse Engine Starting...');

  // Connect to BSC — staticNetwork avoids ethers' background chain-ID polling
  // that spams "failed to detect network" retries when the RPC is slow.
  const bscNetwork = new ethers.Network('bnb', 56);
  provider = new ethers.JsonRpcProvider(CONFIG.BSC_RPC, bscNetwork, { staticNetwork: bscNetwork });
  log(`✅ Connected to BSC via ${CONFIG.BSC_RPC}`);

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
  await refreshTraders();                                          // initial discovery + dormancy prune
  setInterval(refreshTraders, 24 * 60 * 60 * 1000);              // daily re-scan
  setInterval(monitorPositions, CONFIG.POSITION_POLL_MS);
  setInterval(resetDailyLoss, 60000);

  // Prune stale four.meme consensus entries every 10 min
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [token, entry] of fourMemeConsensus.entries()) {
      if (entry.firstSeen < cutoff) fourMemeConsensus.delete(token);
    }
  }, 10 * 60 * 1000);

  // WebSocket block monitoring (replaces polling)
  await connectWebSocket();
  startWsWatchdog();

  // Wallet harvester — runs every 6h, first run 2 min after startup
  setTimeout(() => {
    harvestWallets(prisma, provider).catch(e => log(`❌ harvestWallets: ${e.message}`));
    setInterval(
      () => harvestWallets(prisma, provider).catch(e => log(`❌ harvestWallets: ${e.message}`)),
      6 * 60 * 60 * 1000
    );
  }, 2 * 60 * 1000);

  log('✅ All systems running. Watching the trenches...\n');
  await sendTelegram(`🚀 CopyPulse started — tracking ${trackedWallets.size} wallets`);
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
  // Rebuild Swap event subscription with the updated wallet list
  resubscribeSwaps();
}

// ─────────────────────────────────────────────
// TRADER REFRESH — daily dormancy prune + fresh discovery
// ─────────────────────────────────────────────
async function refreshTraders() {
  log('♻️  Refreshing trader list (dormancy prune + new discovery)...');
  try {
    const currentBlock = await provider.getBlockNumber();
    const sinceBlock   = currentBlock - 57600; // 48h at ~3s/block
    const padAddr = a => '0x' + a.replace('0x','').toLowerCase().padStart(64,'0');

    const allTraders = await prisma.trader.findMany({ where: { isActive: true } });
    let dormantCount = 0;

    for (const trader of allTraders) {
      if (!trader.walletAddress) continue;
      if (trader.signalSourceType !== 'AUTO_DISCOVERED') continue; // keep manual/webhook wallets
      // skip wallets added within the last 48h — they haven't had time to trade yet
      if (trader.createdAt && (Date.now() - new Date(trader.createdAt).getTime()) < 48 * 60 * 60 * 1000) continue;

      const addr = trader.walletAddress.toLowerCase();
      const padded = padAddr(addr);

      const [outLogs, inLogs] = await Promise.all([
        provider.getLogs({ topics: [TRANSFER_TOPIC, padded], fromBlock: sinceBlock, toBlock: currentBlock }).catch(() => []),
        provider.getLogs({ topics: [TRANSFER_TOPIC, null, padded], fromBlock: sinceBlock, toBlock: currentBlock }).catch(() => []),
      ]);

      if (outLogs.length + inLogs.length === 0) {
        await prisma.trader.update({ where: { id: trader.id }, data: { isActive: false } });
        trackedWallets.delete(addr);
        dormantCount++;
        log(`💤 Deactivated dormant: ${trader.name} (${addr.slice(0,10)}...)`);
        await auditLog('WALLET_DEACTIVATED', { address: addr, reason: 'No on-chain activity in 48h' });
      }
      await sleep(200);
    }

    log(`♻️  Pruned ${dormantCount} dormant wallets`);

    // Discover fresh wallets to keep the pool at TARGET
    const TARGET = 15;
    const activeCount = await prisma.trader.count({ where: { isActive: true } });
    if (activeCount < TARGET) {
      await discoverFreshEarlyBuyers(TARGET - activeCount);
    }

    // Reload trackedWallets from DB
    await loadWalletsFromDB();
  } catch (e) {
    log(`❌ refreshTraders error: ${e.message}`);
  }
}

// ─────────────────────────────────────────────
// AUTO-DISCOVERY — PancakeSwap factory early-buyer scan
// ─────────────────────────────────────────────
async function discoverFreshEarlyBuyers(needed = 10) {
  log(`🔍 Scanning for fresh early buyers (need ${needed})...`);
  try {
    const coder = new ethers.AbiCoder();
    const currentBlock = await provider.getBlockNumber();
    const since = currentBlock - 9600; // last 8h
    const CHUNK = 2000;

    // Step 1 — collect new WBNB pairs from PancakeSwap factory
    const newPairs = [];
    for (let from = since; from <= currentBlock; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, currentBlock);
      try {
        const logs = await provider.getLogs({ address: PANCAKE_FACTORY, topics: [PAIR_CREATED_TOPIC], fromBlock: from, toBlock: to });
        for (const l of logs) {
          const t0 = ('0x' + l.topics[1].slice(26)).toLowerCase();
          const t1 = ('0x' + l.topics[2].slice(26)).toLowerCase();
          if (t0 !== WBNB.toLowerCase() && t1 !== WBNB.toLowerCase()) continue;
          const pairAddr = ('0x' + l.data.slice(26, 66)).toLowerCase();
          newPairs.push({ pairAddr, launchBlock: l.blockNumber, wbnbIsToken1: t0 !== WBNB.toLowerCase() });
        }
      } catch(e) {}
      await sleep(80);
    }
    log(`  Found ${newPairs.length} new WBNB pairs in last 8h`);

    // Step 2 — filter by liquidity via DexScreener (batch 30 at a time)
    const qualified = [];
    for (let i = 0; i < newPairs.length && qualified.length < 20; i += 30) {
      const batch = newPairs.slice(i, i + 30);
      try {
        const resp = await axios.get(
          `https://api.dexscreener.com/latest/dex/pairs/bsc/${batch.map(p => p.pairAddr).join(',')}`,
          { timeout: 8000 }
        );
        const pairMap = {};
        for (const p of resp.data?.pairs || []) pairMap[p.pairAddress?.toLowerCase()] = p;
        for (const p of batch) {
          const dp = pairMap[p.pairAddr];
          if (!dp) continue;
          const liq = dp.liquidity?.usd || 0;
          if (liq < 5000) continue;
          qualified.push({ ...p, liq, priceChange1h: dp.priceChange?.h1 || 0, symbol: dp.baseToken?.symbol || '?' });
        }
      } catch(e) {}
      await sleep(300);
    }
    log(`  Qualified pairs (liq>$5k): ${qualified.length}`);

    // Step 3 — scan first 5 min (100 blocks) of Swap events per pair, get tx.from
    const walletStats = {};
    for (const pair of qualified) {
      const endBlock = Math.min(pair.launchBlock + 100, currentBlock);
      for (let from = pair.launchBlock; from <= endBlock; from += 100) {
        const to = Math.min(from + 99, endBlock);
        try {
          const logs = await provider.getLogs({ address: pair.pairAddr, topics: [SWAP_TOPIC], fromBlock: from, toBlock: to });
          for (let i = 0; i < Math.min(logs.length, 40); i += 5) {
            const batch = logs.slice(i, i + 5);
            const txes = await Promise.all(batch.map(l => provider.getTransaction(l.transactionHash).catch(() => null)));
            for (let j = 0; j < batch.length; j++) {
              const tx = txes[j];
              if (!tx?.from) continue;
              const w = tx.from.toLowerCase();
              let a0in, a1in;
              try { [a0in, a1in] = coder.decode(['uint256','uint256','uint256','uint256'], batch[j].data); } catch(e) { continue; }
              const bnbIn = pair.wbnbIsToken1 ? parseFloat(ethers.formatEther(a1in)) : parseFloat(ethers.formatEther(a0in));
              if (bnbIn < 0.001) continue;
              if (!walletStats[w]) walletStats[w] = {};
              if (!walletStats[w][pair.pairAddr]) walletStats[w][pair.pairAddr] = { bnbIn: 0, priceChange1h: pair.priceChange1h };
              walletStats[w][pair.pairAddr].bnbIn += bnbIn;
            }
            await sleep(80);
          }
        } catch(e) {}
        await sleep(80);
      }
    }

    // Step 4 — score by win rate (bought early + token is up)
    const existing = await prisma.trader.findMany({ select: { walletAddress: true } });
    const existingSet = new Set(existing.map(t => t.walletAddress?.toLowerCase()));

    const scored = Object.entries(walletStats)
      .map(([w, pairs]) => {
        const entries = Object.values(pairs).filter(p => p.bnbIn > 0.001);
        const profitable = entries.filter(p => p.priceChange1h > 0).length;
        return { wallet: w, total: entries.length, profitable, winRate: entries.length > 0 ? profitable / entries.length : 0 };
      })
      .filter(s => s.winRate >= 0.5)
      .sort((a, b) => b.winRate - a.winRate || b.total - a.total);

    let added = 0;
    for (const s of scored) {
      if (added >= needed) break;
      if (existingSet.has(s.wallet)) continue;
      try {
        const code = await provider.getCode(s.wallet);
        if (code !== '0x') continue; // skip contracts
      } catch(e) { continue; }

      const name = `EARLY_${s.wallet.slice(2, 8).toUpperCase()}_W${Math.round(s.winRate * 100)}`;
      const trader = await prisma.trader.create({
        data: { name, walletAddress: s.wallet, maxTradeSize: CONFIG.MAX_TRADE_BNB * 400, riskMultiplier: 1.0, allowedPairs: 'BSC_ANY', isActive: true, signalSourceType: 'AUTO_DISCOVERED' }
      });
      trackedWallets.set(s.wallet, { name, traderId: trader.id, lastBlock: 0, source: 'AUTO', stats: { wins: 0, losses: 0 } });
      log(`✨ New wallet: ${name} (${s.wallet})`);
      await auditLog('WALLET_AUTO_DISCOVERED', { address: s.wallet, winRate: s.winRate });
      added++;
      await sleep(100);
    }

    log(`✨ discoverFreshEarlyBuyers added ${added} wallets`);
  } catch (e) {
    log(`❌ discoverFreshEarlyBuyers error: ${e.message}`);
  }
}

// ─────────────────────────────────────────────
// WEBSOCKET MONITOR — event-based Swap log subscriptions
// ─────────────────────────────────────────────

// Build a log filter for PancakeSwap Swap events where topics[2] (the indexed
// `to` field) matches any tracked wallet. This fires only when a tracked wallet
// receives tokens — no full-block fetching needed.
function buildSwapFilter() {
  const addrs = [...trackedWallets.keys()];
  if (addrs.length === 0) return null;
  const padded = addrs.map(a => '0x' + a.replace('0x', '').padStart(64, '0'));
  return { topics: [SWAP_TOPIC, null, padded] };
}

// Register all WS event subscriptions on the current wsProvider.
// Safe to call at any time — no-ops when wsProvider is not yet live.
// Called on initial connect and again after the tracked-wallet list changes.
function resubscribeSwaps() {
  if (!wsProvider || !wsConnected) return;
  wsProvider.removeAllListeners();

  // Minimal block listener — watchdog heartbeat only, no full-block fetch
  wsProvider.on('block', (blockNumber) => {
    wsLastBlock = blockNumber;
    wsLastBlockTime = Date.now();
  });

  // Swap events filtered to tracked wallet addresses in topics[2]
  const filter = buildSwapFilter();
  if (filter) {
    wsProvider.on(filter, (eventLog) => {
      const recipient = ('0x' + eventLog.topics[2].slice(26)).toLowerCase();
      const walletInfo = trackedWallets.get(recipient);
      if (!walletInfo) return;
      processSwapEvent(eventLog, { hash: eventLog.transactionHash, from: recipient }, walletInfo)
        .catch(e => log(`⚠️  processSwapEvent: ${e.message}`));
    });
    log(`📡 Subscribed to Swap events for ${trackedWallets.size} wallets`);
  }

  // four.meme TokenPurchase subscription
  wsProvider.on(
    { address: FOUR_MEME_CONTRACT, topics: [FOUR_MEME_PURCHASE_TOPIC] },
    (eventLog) => processFourMemeEvent(eventLog).catch(e => log(`⚠️  processFourMemeEvent: ${e.message}`))
  );
  log('⚡ Subscribed to four.meme TokenPurchase events');

  // Mirror-sell: ERC-20 Transfer events where topics[1] (indexed `from`) matches a tracked wallet.
  // Fires whenever a tracked wallet sends any token out. handleMirrorSell checks whether the
  // transferred token matches an open position that wallet originally triggered.
  const trackedAddrs = [...trackedWallets.keys()];
  if (trackedAddrs.length > 0) {
    const paddedTracked = trackedAddrs.map(a => '0x' + a.replace('0x', '').padStart(64, '0'));
    wsProvider.on(
      { topics: [TRANSFER_TOPIC, paddedTracked] },
      (eventLog) => {
        const from  = ('0x' + eventLog.topics[1].slice(26)).toLowerCase();
        const token = eventLog.address.toLowerCase();
        handleMirrorSell(from, token).catch(e => log(`⚠️  handleMirrorSell: ${e.message}`));
      }
    );
    log(`🔁 Mirror-sell subscribed for ${trackedAddrs.length} tracked wallets`);
  }

  // Re-register per-position event-SL pair subscriptions (cleared by removeAllListeners above)
  for (const [tok, pair] of positionPairAddrs.entries()) {
    subscribePriceSL(tok, pair);
  }
  if (positionPairAddrs.size > 0) {
    log(`📡 [EVENT-SL] Re-subscribed ${positionPairAddrs.size} position pair(s)`);
  }
}

async function connectWebSocket() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

  // Use fallback after repeated failures (backoff > 32s means ≥4 failed attempts)
  const wsUrl = wsReconnectDelay > 32000 ? CONFIG.BSC_WSS_FALLBACK : CONFIG.BSC_WSS;
  log(`⚡ WebSocket connecting: ${wsUrl}`);

  try {
    if (wsProvider) {
      wsProvider.removeAllListeners();
      try { wsProvider.destroy(); } catch (_) {}
      wsProvider = null;
    }

    wsProvider = new ethers.WebSocketProvider(wsUrl);

    // Verify the connection responds before marking it live
    const connectTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 10000));
    wsLastBlock = await Promise.race([wsProvider.getBlockNumber(), connectTimeout]);
    wsLastBlockTime = Date.now();
    wsConnected = true;
    wsReconnectDelay = 2000; // reset backoff on success
    wsDisconnectTime = 0;

    log(`⚡ WebSocket connected | Block: ${wsLastBlock}`);
    sendTelegram(`⚡ CopyPulse WebSocket connected — monitoring ${trackedWallets.size} wallets`).catch(() => {});

    resubscribeSwaps();

  } catch (e) {
    wsConnected = false;
    log(`❌ WebSocket failed: ${e.message}`);
    // Destroy the failed provider immediately — leaving it alive causes its
    // internal _start() doDetect loop to spam "failed to detect network" every 1s
    // until the next reconnect attempt cleans it up.
    if (wsProvider) {
      wsProvider.removeAllListeners();
      try { wsProvider.destroy(); } catch (_) {}
      wsProvider = null;
    }
    scheduleWsReconnect();
  }
}

function scheduleWsReconnect() {
  if (wsReconnectTimer) return;
  if (wsDisconnectTime === 0) wsDisconnectTime = Date.now();
  const delay = wsReconnectDelay;
  log(`🔄 WebSocket reconnecting in ${delay / 1000}s...`);
  // Only alert Telegram once the outage has lasted more than 60 seconds
  if (Date.now() - wsDisconnectTime >= 60000) {
    sendTelegram(`⚠️ CopyPulse WebSocket disconnected — reconnecting in ${delay / 1000}s`).catch(() => {});
  }
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 60000);
    connectWebSocket();
  }, delay);
}

function startWsWatchdog() {
  // BSC mines ~1 block/3s. If no block in 30s, the connection is dead.
  setInterval(() => {
    if (wsConnected && wsLastBlockTime > 0 && Date.now() - wsLastBlockTime > 30000) {
      log('⚠️  WebSocket stale — no block in 30s, reconnecting...');
      wsConnected = false;
      scheduleWsReconnect();
    }
  }, 15000);

  // Heartbeat log every 60s
  setInterval(() => {
    log(`💓 Monitoring ${trackedWallets.size} wallets | Last block: ${wsLastBlock} | WebSocket: ${wsConnected ? 'connected' : 'disconnected'}`);
  }, 60000);
}


async function processSwapEvent(swapLog, tx, walletInfo) {
  try {
    const coder = new ethers.AbiCoder();
    let a0in, a1in;
    try { [a0in, a1in] = coder.decode(['uint256','uint256','uint256','uint256'], swapLog.data); }
    catch(e) { return; }

    // Resolve token first so we know which side of the pair WBNB sits on.
    // PancakeSwap sorts token0 < token1 by address, so:
    //   token < WBNB  →  token=token0, WBNB=token1  →  bnbIn = a1in
    //   token > WBNB  →  WBNB=token0, token=token1  →  bnbIn = a0in
    const tokenAddress = await getTokenFromPair(swapLog.address);
    if (!tokenAddress) return;

    const wbnbIsToken1 = tokenAddress.toLowerCase() < WBNB.toLowerCase();
    const bnbIn = wbnbIsToken1 ? a1in : a0in;
    if (bnbIn === 0n) return; // sell (WBNB going out, not in)
    const bnbSpent = parseFloat(ethers.formatEther(bnbIn));
    if (bnbSpent < 0.001) return; // dust

    if (openPositions.has(tokenAddress)) return;
    if (openPositions.size >= CONFIG.MAX_OPEN_POSITIONS) {
      log(`⚠️  Max positions (${CONFIG.MAX_OPEN_POSITIONS}) reached, skipping`);
      return;
    }
    if (dailyLossBNB >= CONFIG.MAX_DAILY_LOSS_BNB) {
      log(`🛑 Daily loss limit reached (${dailyLossBNB} BNB), pausing trades`);
      return;
    }

    log(`🎯 Signal: ${walletInfo.name} bought ${tokenAddress.slice(0,10)}... (${bnbSpent.toFixed(3)} BNB)`);
    sendTelegram(`🎯 Signal: ${walletInfo.name} bought ${tokenAddress.slice(0, 10)}...`).catch(() => {});

    const momentum = await checkBinanceMomentum();
    if (!momentum.ok) {
      log(`⏸️  Blocked by momentum: ${momentum.reason}`);
      await auditLog('TRADE_BLOCKED_MOMENTUM', { tokenAddress, walletAddress: tx.from, reason: momentum.reason });
      return;
    }

    const signal = await prisma.incomingSignal.create({
      data: {
        traderId: walletInfo.traderId || await getDefaultTraderId(),
        symbol: tokenAddress,
        side: 'BUY',
        rawPayload: JSON.stringify({ txHash: tx.hash, walletAddress: tx.from, tokenAddress, bnbSpent }),
        status: 'PENDING',
      }
    });

    await auditLog('SIGNAL_DETECTED', { walletAddress: tx.from, tokenAddress, txHash: tx.hash });
    await executeBuy(tokenAddress, signal.id, walletInfo.traderId, walletInfo.name, tx.from);
  } catch (e) {
    log(`⚠️  processSwapEvent error: ${e.message}`);
  }
}

async function getTokenFromPair(pairAddr) {
  const key = pairAddr.toLowerCase();
  if (pairTokenCache.has(key)) return pairTokenCache.get(key);
  try {
    const PAIR_ABI_TOKENS = ['function token0() view returns (address)', 'function token1() view returns (address)'];
    const pair = new ethers.Contract(key, PAIR_ABI_TOKENS, provider);
    const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
    // Assumes Pancake WBNB pair (most memecoin signals). For non-WBNB pairs this will pick one side;
    // bnbIn calc in caller will only be valid for WBNB pairs. Non-WBNB/curve tokens use four.meme direct paths.
    const token = t0.toLowerCase() === WBNB.toLowerCase() ? t1.toLowerCase() : t0.toLowerCase();
    pairTokenCache.set(key, token);
    return token;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────
// FOUR.MEME EVENT PROCESSOR
// ─────────────────────────────────────────────
async function processFourMemeEvent(eventLog) {
  try {
    // ALL 8 params are non-indexed — topics.length is always 1.
    // Layout: buyer(address), token(address), p2(uint256), tokenAmount(uint256),
    //         bnbReserve(uint256), bnbPaid(uint256), p6(uint256), p7(uint256)
    // Verified against live contract logs on BSC (block ~104009988).
    const coder = new ethers.AbiCoder();
    let decoded;
    try {
      decoded = coder.decode(
        ['address','address','uint256','uint256','uint256','uint256','uint256','uint256'],
        eventLog.data
      );
    } catch (_) { return; }

    const buyer        = decoded[0].toLowerCase();
    const tokenAddress = decoded[1].toLowerCase();
    const bnbSpent     = parseFloat(ethers.formatEther(decoded[5])); // data[5] = BNB paid by buyer

    if (bnbSpent < 0.001) return; // dust

    // Path 1: KOL signal — tracked wallet made the buy
    if (trackedWallets.has(buyer)) {
      const walletInfo = trackedWallets.get(buyer);
      log(`🎯 [4.meme] ${walletInfo.name} bought ${tokenAddress.slice(0, 10)}... (${bnbSpent.toFixed(3)} BNB)`);
      await handleFourMemeKolSignal(tokenAddress, buyer, walletInfo, bnbSpent);
    }

    // Path 2: consensus — count all buyers of the same token within 2 min
    const now = Date.now();
    let entry = fourMemeConsensus.get(tokenAddress);
    if (!entry || now - entry.firstSeen > 2 * 60 * 1000) {
      entry = { buyers: new Set(), firstSeen: now, lastPrice: null };
      fourMemeConsensus.set(tokenAddress, entry);
    }
    entry.buyers.add(buyer);
    // Track effective price from this buyer's trade (BNB per token, 18-dec assumed for four.meme)
    const tokenAmtF = parseFloat(ethers.formatEther(decoded[3]));
    if (tokenAmtF > 0) entry.lastPrice = bnbSpent / tokenAmtF;

    if (entry.buyers.size >= 3) {
      const buyerCount = entry.buyers.size;
      const entryPriceBnb = entry.lastPrice;
      fourMemeConsensus.delete(tokenAddress); // prevent re-triggering on the same wave
      log(`🔥 [4.meme Consensus] ${buyerCount} wallets bought ${tokenAddress.slice(0, 10)}... in 2min`);
      await handleFourMemeConsensusSignal(tokenAddress, buyerCount, entryPriceBnb);
    }
  } catch (e) {
    log(`⚠️  processFourMemeEvent: ${e.message}`);
  }
}

async function handleFourMemeKolSignal(tokenAddress, buyerAddr, walletInfo, bnbSpent) {
  if (openPositions.has(tokenAddress)) return;
  if (openPositions.size >= CONFIG.MAX_OPEN_POSITIONS) {
    log(`⚠️  Max positions reached, skipping [4.meme KOL]`);
    return;
  }
  if (dailyLossBNB >= CONFIG.MAX_DAILY_LOSS_BNB) {
    log(`🛑 Daily loss limit reached, skipping [4.meme KOL]`);
    return;
  }

  sendTelegram(`🎯 [4.meme] ${walletInfo.name} bought ${tokenAddress.slice(0, 10)}...`).catch(() => {});

  const momentum = await checkBinanceMomentum();
  if (!momentum.ok) {
    log(`⏸️  Blocked by momentum: ${momentum.reason}`);
    await auditLog('TRADE_BLOCKED_MOMENTUM', { source: '4.meme', tokenAddress, walletAddress: buyerAddr, reason: momentum.reason });
    return;
  }

  const signal = await prisma.incomingSignal.create({
    data: {
      traderId:   walletInfo.traderId || await getDefaultTraderId(),
      symbol:     tokenAddress,
      side:       'BUY',
      rawPayload: JSON.stringify({ source: '4.meme', buyerAddress: buyerAddr, tokenAddress, bnbSpent }),
      status:     'PENDING',
    }
  });
  await auditLog('SIGNAL_DETECTED', { source: '4.meme', walletAddress: buyerAddr, tokenAddress });
  await executeBuy(tokenAddress, signal.id, walletInfo.traderId, walletInfo.name, buyerAddr);
}

async function handleFourMemeConsensusSignal(tokenAddress, buyerCount, entryPriceBnb = null) {
  // Log every consensus signal for graduation analysis — dedupe within 6h per token
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const existing = await prisma.fourMemeSignal.findFirst({
      where: { tokenAddress, signalTime: { gte: sixHoursAgo } },
    });
    if (!existing) {
      await prisma.fourMemeSignal.create({
        data: { tokenAddress, walletCount: buyerCount, entryPriceBnb },
      });
      log(`📝 [4.meme] Logged signal for ${tokenAddress.slice(0, 10)}... (${buyerCount} wallets)`);
    }
  } catch (e) {
    log(`⚠️  [4.meme log] ${e.message}`);
  }

  if (openPositions.has(tokenAddress)) return;
  if (openPositions.size >= CONFIG.MAX_OPEN_POSITIONS) {
    log(`⚠️  Max positions reached, skipping [4.meme consensus]`);
    return;
  }
  if (dailyLossBNB >= CONFIG.MAX_DAILY_LOSS_BNB) {
    log(`🛑 Daily loss limit reached, skipping [4.meme consensus]`);
    return;
  }

  sendTelegram(`🔥 [4.meme Consensus] ${buyerCount} wallets → ${tokenAddress.slice(0, 10)}...`).catch(() => {});

  const momentum = await checkBinanceMomentum();
  if (!momentum.ok) {
    log(`⏸️  Blocked by momentum: ${momentum.reason}`);
    await auditLog('TRADE_BLOCKED_MOMENTUM', { source: '4.meme-consensus', tokenAddress, buyerCount, reason: momentum.reason });
    return;
  }

  const traderId = await getDefaultTraderId();
  const signal = await prisma.incomingSignal.create({
    data: {
      traderId,
      symbol:     tokenAddress,
      side:       'BUY',
      rawPayload: JSON.stringify({ source: '4.meme-consensus', buyerCount, tokenAddress }),
      status:     'PENDING',
    }
  });
  await auditLog('SIGNAL_DETECTED', { source: '4.meme-consensus', tokenAddress, buyerCount });
  // consensus positions have no single triggering wallet — mirror-sell doesn't apply
  await executeBuy(tokenAddress, signal.id, traderId, `4.meme-${buyerCount}x`, null);
}

// ─────────────────────────────────────────────
// MIRROR-SELL
// ─────────────────────────────────────────────

// Called on every ERC-20 Transfer where `from` is a tracked wallet.
// Checks whether the token matches an open position that wallet originally triggered,
// and if so calls a full exit. Consensus positions (triggeredByWallet = null) are
// excluded — they have no single wallet to follow on the way out.
async function handleMirrorSell(fromAddr, tokenAddr) {
  const from  = fromAddr.toLowerCase();
  const token = tokenAddr.toLowerCase();
  const pos   = openPositions.get(token);
  if (!pos) return;                           // we don't hold it
  if (pos.stuck) return;                      // flagged unsellable — manual exit required
  if (pos.triggeredByWallet !== from) return; // not the wallet that got us in
  if (closingPositions.has(token)) return;    // already closing — guard
  const name = trackedWallets.get(from)?.name || from.slice(0, 10) + '...';
  log(`🔁 Mirror-sell: ${name} exited ${pos.symbol} — closing our position`);
  sendTelegram(`🔁 Mirror-sell — ${pos.symbol}\n${name} is exiting`).catch(() => {});
  await executeSell(token, pos, 'MIRROR_SELL');
}

// ─────────────────────────────────────────────
// EVENT-DRIVEN STOP-LOSS
// ─────────────────────────────────────────────
const MAX_SELL_FAILURES = 3;

function subscribePriceSL(tokenAddr, pairAddr) {
  if (!wsProvider || !wsConnected) return;
  wsProvider.on(
    { address: pairAddr, topics: [SWAP_TOPIC] },
    () => {
      const pos = openPositions.get(tokenAddr);
      if (!pos || pos.stuck || closingPositions.has(tokenAddr)) return;
      checkPriceSL(tokenAddr, pos, pairAddr).catch(() => {});
    }
  );
}

async function checkPriceSL(tokenAddr, position, pairAddr) {
  const currentPrice = await getTokenPriceBNB(tokenAddr, position.tokenAmount);
  if (!currentPrice) return;
  const pnlPct = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
  if (pnlPct <= -CONFIG.STOP_LOSS_PCT) {
    log(`🛑 [EVENT-SL] Stop loss hit! ${position.symbol} ${pnlPct.toFixed(1)}%`);
    sendTelegram(`🛑 Event-SL — ${position.symbol} ${pnlPct.toFixed(1)}%`).catch(() => {});
    await executeSell(tokenAddr, position, 'STOP_LOSS');
  }
}

// ─────────────────────────────────────────────
// TRADE EXECUTOR
// ─────────────────────────────────────────────
async function getDynamicGasPrice() {
  try {
    const feeData = await provider.getFeeData();
    const base = feeData.gasPrice ?? ethers.parseUnits('5', 'gwei');
    return base * 120n / 100n; // +20% to beat frontrunners
  } catch (_) {
    return ethers.parseUnits('6', 'gwei'); // safe fallback
  }
}

async function getBnbAmountForUsd(usdAmount) {
  try {
    const ticker = await binanceGet('/api/v3/ticker/price', { symbol: 'BNBUSDT' });
    const bnbPrice = parseFloat(ticker.price);
    if (!bnbPrice || bnbPrice <= 0) throw new Error('invalid BNB price');
    const bnb = usdAmount / bnbPrice;
    log(`💵 Trade size: $${usdAmount} = ${bnb.toFixed(6)} BNB (@$${bnbPrice.toFixed(2)})`);
    return bnb;
  } catch (e) {
    log(`⚠️  BNB price fetch failed (${e.message}) — falling back to CONFIG.MAX_TRADE_BNB`);
    return CONFIG.MAX_TRADE_BNB;
  }
}

async function executeBuy(tokenAddress, signalId, traderId, traderName = 'Unknown', triggeredByWallet = null) {
  if (!wallet || !CONFIG.SELF_TRADE) {
    const reason = !wallet ? 'No WALLET_PRIVATE_KEY set' : 'SELF_TRADE=false (monitor-only mode)';
    log(`📋 [MONITOR MODE] Signal: ${tokenAddress} — ${reason}`);
    await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'SKIPPED', errorMessage: reason } });
    return;
  }

  const startTime = Date.now();

  try {
    // Safety checks on the token
    const safe = await tokenSafetyCheck(tokenAddress);
    if (!safe.ok) {
      log(`🚫 Token ${tokenAddress} failed safety check: ${safe.reason}`);
      await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'SKIPPED', errorMessage: safe.reason } });
      sendTelegram(`🚫 Skipped ${tokenAddress.slice(0, 10)}... — ${safe.reason}`).catch(() => {});
      return;
    }

    const tradeBnb = await getBnbAmountForUsd(5); // $5 USD worth of BNB
    const bnbAmount = ethers.parseEther(tradeBnb.toFixed(8));
    const path = [WBNB, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5; // 5 min

    // Get expected output
    const amounts = await router.getAmountsOut(bnbAmount, path);
    const expectedOut = amounts[1];
    const minOut = expectedOut * 85n / 100n; // 15% slippage tolerance

    log(`💰 Buying token ${tokenAddress} with ${tradeBnb.toFixed(6)} BNB ($5)...`);

    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      minOut,
      path,
      wallet.address,
      deadline,
      { value: bnbAmount, gasLimit: 300000, gasPrice: await getDynamicGasPrice() }
    );

    const receipt = await tx.wait();
    const latency = Date.now() - startTime;

    log(`✅ BUY executed! Hash: ${tx.hash} | Latency: ${latency}ms`);

    // Get actual token balance after buy
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();

    sendTelegram(`🟢 BUY — ${symbol}\nWallet: ${traderName}\nAmount: ${tradeBnb.toFixed(6)} BNB ($5)\nTx: ${tx.hash}`).catch(() => {});
    const tokenAmount = parseFloat(ethers.formatUnits(tokenBalance, decimals));

    // Get buy price
    const currentPrice = tradeBnb / tokenAmount;

    // Track open position
    openPositions.set(tokenAddress, {
      symbol,
      buyPrice: currentPrice,
      tokenAmount,
      bnbSpent: tradeBnb,
      entryTime: Date.now(),
      signalId,
      traderId,
      decimals,
      triggeredByWallet: triggeredByWallet ? triggeredByWallet.toLowerCase() : null,
    });

    // Event-driven SL: resolve pair and subscribe to Swap events on it
    {
      const _factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
      _factory.getPair(tokenAddress, WBNB).then(pairAddr => {
        if (pairAddr && pairAddr !== ethers.ZeroAddress) {
          const tok = tokenAddress.toLowerCase();
          positionPairAddrs.set(tok, pairAddr.toLowerCase());
          subscribePriceSL(tok, pairAddr.toLowerCase());
          log(`📡 [EVENT-SL] Subscribed pair ${pairAddr.slice(0, 10)}... for ${symbol}`);
        }
      }).catch(e => log(`⚠️  [EVENT-SL] Pair lookup failed: ${e.message}`));
    }

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
    await auditLog('BUY_EXECUTED', { tokenAddress, symbol, bnbSpent: tradeBnb, txHash: tx.hash });

  } catch (e) {
    log(`❌ Buy failed for ${tokenAddress}: ${e.message}`);
    await prisma.incomingSignal.update({ where: { id: signalId }, data: { status: 'FAILED', errorMessage: e.message } });
    await auditLog('BUY_FAILED', { tokenAddress, error: e.message }, 'ERROR');
  }
}

async function executeSell(tokenAddress, position, reason) {
  if (!wallet) return;
  // Double-fire guard: mirror-sell, event-SL, and poll-SL can all race.
  // Only the first caller proceeds; the rest are silently dropped.
  if (closingPositions.has(tokenAddress)) return;
  closingPositions.add(tokenAddress);

  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const decimals = position.decimals || 18;
    const tokenBalance = await tokenContract.balanceOf(wallet.address);

    if (tokenBalance === 0n) {
      openPositions.delete(tokenAddress);
      closingPositions.delete(tokenAddress);
      positionPairAddrs.delete(tokenAddress.toLowerCase());
      sellFailCounts.delete(tokenAddress.toLowerCase());
      return;
    }

    // Approve router — max-approve if current allowance is insufficient, then wait for mine
    const allowance = await tokenContract.allowance(wallet.address, PANCAKE_ROUTER);
    if (allowance < tokenBalance) {
      log(`🔑 Approving router for ${position.symbol}...`);
      const approveTx = await tokenContract.approve(PANCAKE_ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      log(`✅ Approval confirmed — proceeding to swap`);
    }

    const path = [tokenAddress, WBNB];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const expectedOut = await router.getAmountsOut(tokenBalance, path).catch(() => [0n, 0n]);
    const minBNB = expectedOut[1] * 85n / 100n; // 15% slippage tolerance

    log(`📤 Selling ${position.symbol} (reason: ${reason})...`);

    const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      tokenBalance,
      minBNB,
      path,
      wallet.address,
      deadline,
      { gasLimit: 300000, gasPrice: await getDynamicGasPrice() }
    );

    await tx.wait();

    // Calculate PnL
    const bnbReceived = await estimateBNBReceived(tokenAddress, tokenBalance);
    const pnlBNB = bnbReceived - position.bnbSpent;
    const pnlPct = (pnlBNB / position.bnbSpent) * 100;
    const sellPrice = position.tokenAmount > 0 ? bnbReceived / position.tokenAmount : 0;

    if (pnlBNB < 0) dailyLossBNB += Math.abs(pnlBNB);
    dailyPnLBNB += pnlBNB;

    const pnlSign = pnlBNB >= 0 ? '+' : '';
    const todaySign = dailyPnLBNB >= 0 ? '+' : '';
    log(`💰 PnL: ${pnlSign}${pnlBNB.toFixed(4)} BNB (${pnlSign}${pnlPct.toFixed(1)}%) on ${position.symbol} | Reason: ${reason} | Total today: ${todaySign}${dailyPnLBNB.toFixed(4)} BNB`);
    sendTelegram(`🔴 SELL — ${position.symbol}\nPnL: ${pnlSign}${pnlBNB.toFixed(3)} BNB (${pnlSign}${pnlPct.toFixed(1)}%)\nReason: ${reason}`).catch(() => {});

    await prisma.tradeResult.create({
      data: {
        symbol:       position.symbol || tokenAddress.slice(0, 10),
        tokenAddress,
        traderId:     position.traderId || null,
        exitReason:   reason,
        buyPrice:     position.buyPrice,
        sellPrice,
        bnbSpent:     position.bnbSpent,
        bnbReceived,
        pnlBnb:       pnlBNB,
        pnlPct,
      },
    }).catch(e => log(`⚠️  TradeResult save failed: ${e.message}`));

    openPositions.delete(tokenAddress);
    closingPositions.delete(tokenAddress);
    positionPairAddrs.delete(tokenAddress.toLowerCase());
    sellFailCounts.delete(tokenAddress.toLowerCase());

    const account = await prisma.exchangeAccount.findFirst({ where: { isActive: true } });
    await prisma.copiedOrder.create({
      data: {
        traderId: position.traderId || await getDefaultTraderId(),
        exchangeAccountId: account?.id || 'default',
        symbol: `${position.symbol}/BNB`,
        side: 'SELL',
        orderType: 'MARKET',
        quantity: parseFloat(ethers.formatUnits(tokenBalance, decimals)),
        price: position.bnbSpent,
        fillPrice: bnbReceived,
        status: 'FILLED',
        exchangeOrderId: tx.hash,
        fee: pnlBNB,
      }
    });

    await auditLog('SELL_EXECUTED', { tokenAddress, symbol: position.symbol, pnlBNB, pnlPct, reason });

  } catch (e) {
    closingPositions.delete(tokenAddress); // allow retry — sell failed before completing
    const tok = tokenAddress.toLowerCase();
    const failures = (sellFailCounts.get(tok) || 0) + 1;
    sellFailCounts.set(tok, failures);
    if (failures >= MAX_SELL_FAILURES) {
      position.stuck = true;
      positionPairAddrs.delete(tok); // stop the event-SL loop
      sellFailCounts.delete(tok);
      log(`🚨 [STUCK] ${position?.symbol || tok} failed ${failures} consecutive sells — likely honeypot, unsubscribed event-SL`);
      sendTelegram(`🚨 STUCK position — ${position?.symbol || tok}\nSell reverted ${failures}x — likely honeypot\nManual exit required`).catch(() => {});
    }
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
      if (position.stuck) continue; // flagged unsellable — manual exit required

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
    // Non-WBNB / curve fallback (see getPositionExitValueBNB)
    try {
      const ds = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { timeout: 2000 }).catch(() => null);
      const p = ds?.data?.pairs?.find(pp => pp.chainId === 'bsc' && pp.priceNative);
      if (p && p.priceNative && human > 0) return human * parseFloat(p.priceNative);
    } catch (_) {}
    return 0;
  }
}

// ─────────────────────────────────────────────
// TOKEN SAFETY CHECK — 6-layer filter
// ─────────────────────────────────────────────
async function tokenSafetyCheck(tokenAddress) {
  const addr = tokenAddress.toLowerCase();

  // 1. Blacklist
  if (BLACKLISTED_TOKENS.has(addr)) {
    log(`🚫 [BLACKLIST] ${tokenAddress} is on the blacklist`);
    return { ok: false, reason: 'Token is blacklisted' };
  }

  // 2. Honeypot detection + tax check (honeypot.is)
  try {
    const hp = await axios.get(`https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=56`, { timeout: 6000 });
    const data = hp.data;

    if (data.honeypotResult?.isHoneypot) {
      log(`🚫 [HONEYPOT] ${tokenAddress} — ${data.honeypotResult.honeypotReason || 'flagged'}`);
      return { ok: false, reason: `Honeypot: ${data.honeypotResult.honeypotReason || 'detected'}` };
    }

    const buyTax  = data.simulationResult?.buyTax  ?? 0;
    const sellTax = data.simulationResult?.sellTax ?? 0;
    if (buyTax > 10) {
      log(`🚫 [TAX] ${tokenAddress} buy tax ${buyTax}% > 10%`);
      return { ok: false, reason: `Buy tax too high: ${buyTax}%` };
    }
    if (sellTax > 10) {
      log(`🚫 [TAX] ${tokenAddress} sell tax ${sellTax}% > 10%`);
      return { ok: false, reason: `Sell tax too high: ${sellTax}%` };
    }

    log(`✅ [HONEYPOT] clean — buy: ${buyTax}% / sell: ${sellTax}%`);
  } catch (e) {
    log(`⚠️  [HONEYPOT] check failed (${e.message}) — skipping`);
  }

  // 3. Contract age + 4. Liquidity check (DexScreener — no API key needed)
  try {
    const ds = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { timeout: 6000 });
    const pairs = ds.data?.pairs?.filter(p => p.chainId === 'bsc') || [];

    if (pairs.length > 0) {
      const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

      // Contract age
      if (best.pairCreatedAt) {
        const ageHours = (Date.now() - best.pairCreatedAt) / 3_600_000;
        if (ageHours < 6) {
          log(`🚫 [AGE] ${tokenAddress} pair created ${ageHours.toFixed(1)}h ago — too new`);
          return { ok: false, reason: `Token too new: pair created ${ageHours.toFixed(1)}h ago` };
        }
        log(`✅ [AGE] pair age: ${ageHours.toFixed(1)}h`);
      }

      // Liquidity
      const liquidityUsd = best.liquidity?.usd || 0;
      if (liquidityUsd < 7_500) {
        log(`🚫 [LIQUIDITY] ${tokenAddress} only $${liquidityUsd.toFixed(0)} liquidity`);
        return { ok: false, reason: `Insufficient liquidity: $${liquidityUsd.toFixed(0)} (min $7,500)` };
      }
      log(`✅ [LIQUIDITY] $${liquidityUsd.toFixed(0)}`);
    } else {
      // Fallback: check on-chain reserves directly from PancakeSwap
      try {
        const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
        const pairAddr = await factory.getPair(tokenAddress, WBNB);
        if (pairAddr === ethers.ZeroAddress) {
          log(`🚫 [LIQUIDITY] No PancakeSwap pair found for ${tokenAddress}`);
          return { ok: false, reason: 'No PancakeSwap WBNB pair found (token may still be on four.meme curve — non-WBNB support active for direct paths)' };
        }
        const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
        const [r0, r1] = await pair.getReserves();
        // Determine which reserve is WBNB
        const wbnbReserve = parseFloat(ethers.formatEther(tokenAddress.toLowerCase() < WBNB.toLowerCase() ? r1 : r0));
        // Approximate USD: assume BNB ≈ $600 (rough gate, not price feed)
        const approxUsd = wbnbReserve * 600;
        if (approxUsd < 10_000) {
          log(`🚫 [LIQUIDITY] on-chain: ~$${approxUsd.toFixed(0)} (${wbnbReserve.toFixed(2)} BNB)`);
          return { ok: false, reason: `Insufficient on-chain liquidity: ~$${approxUsd.toFixed(0)}` };
        }
        log(`✅ [LIQUIDITY] on-chain: ~$${approxUsd.toFixed(0)}`);
      } catch (e) {
        log(`⚠️  [LIQUIDITY] on-chain fallback failed: ${e.message}`);
      }
    }
  } catch (e) {
    log(`⚠️  [DEXSCREENER] check failed (${e.message}) — skipping`);
  }

  // 5. Zero-supply check (paranoia guard — fail fast before executing a trade)
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const supply = await tokenContract.totalSupply();
    if (supply === 0n) {
      log(`🚫 [SUPPLY] zero supply`);
      return { ok: false, reason: 'Zero total supply' };
    }
    log(`✅ [SUPPLY] totalSupply OK`);
  } catch (e) {
    log(`⚠️  [SUPPLY] check failed (${e.message}) — skipping`);
  }

  log(`✅ [SAFETY] ${tokenAddress} passed all checks`);
  return { ok: true };
}

// ─────────────────────────────────────────────
// BINANCE API — momentum cross-check
// ─────────────────────────────────────────────

// Public ticker — no auth needed
async function binanceGet(endpoint, params = {}) {
  const res = await axios.get(`${BINANCE_API}${endpoint}`, {
    params,
    headers: CONFIG.BINANCE_API_KEY ? { 'X-MBX-APIKEY': CONFIG.BINANCE_API_KEY } : {},
    timeout: 5000,
  });
  return res.data;
}

// Signed request for account-level endpoints
async function binanceSignedGet(endpoint, params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = crypto.createHmac('sha256', CONFIG.BINANCE_SECRET_KEY).update(query).digest('hex');
  const res = await axios.get(`${BINANCE_API}${endpoint}?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': CONFIG.BINANCE_API_KEY },
    timeout: 5000,
  });
  return res.data;
}

let lastMomentumCheck = { time: 0, result: null };

async function checkBinanceMomentum() {
  // Cache for 60s — avoid hammering Binance on every detected tx
  if (Date.now() - lastMomentumCheck.time < 60000 && lastMomentumCheck.result) {
    return lastMomentumCheck.result;
  }

  try {
    const [bnb, btc] = await Promise.all([
      binanceGet('/api/v3/ticker/24hr', { symbol: 'BNBUSDT' }),
      binanceGet('/api/v3/ticker/24hr', { symbol: 'BTCUSDT' }),
    ]);

    const bnbChange = parseFloat(bnb.priceChangePercent);
    const btcChange = parseFloat(btc.priceChangePercent);

    log(`📈 Binance momentum — BNB: ${bnbChange > 0 ? '+' : ''}${bnbChange.toFixed(2)}% | BTC: ${btcChange > 0 ? '+' : ''}${btcChange.toFixed(2)}%`);

    if (bnbChange < CONFIG.MIN_BNB_24H_CHANGE) {
      const result = { ok: false, reason: `BNB down ${bnbChange.toFixed(1)}% in 24h — skipping trade`, bnbChange, btcChange };
      lastMomentumCheck = { time: Date.now(), result };
      return result;
    }

    if (btcChange < CONFIG.MIN_BTC_24H_CHANGE) {
      const result = { ok: false, reason: `BTC down ${btcChange.toFixed(1)}% in 24h — macro risk too high`, bnbChange, btcChange };
      lastMomentumCheck = { time: Date.now(), result };
      return result;
    }

    const result = { ok: true, bnbChange, btcChange };
    lastMomentumCheck = { time: Date.now(), result };
    return result;

  } catch (e) {
    // Fail open — don't block trades if Binance API is unreachable
    log(`⚠️  Binance momentum check failed (${e.message}) — proceeding anyway`);
    return { ok: true, bnbChange: 0, btcChange: 0 };
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
    dailyPnLBNB  = 0;
    lastDailyReset = today;
    log('🔄 Daily counters reset');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function sendTelegram(msg) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: CONFIG.TELEGRAM_CHAT_ID, text: msg },
      { timeout: 5000 }
    );
  } catch (e) {
    log(`⚠️  Telegram send failed: ${e.message}`);
  }
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
        momentum: lastMomentumCheck.result,
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

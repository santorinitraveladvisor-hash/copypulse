'use strict';

/**
 * CopyPulse Wallet Harvester
 *
 * Finds smart wallets by cross-referencing early buyers across trending BSC tokens.
 * A wallet qualifies if it bought early on 3+ winning tokens with >55% overall win rate
 * across at least 5 observed trades.
 *
 * Called by bot-engine.js every 6 hours.
 */

const axios  = require('axios');
const { ethers } = require('ethers');

// ── Constants ────────────────────────────────────────────────────────────────
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const WBNB       = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

const MIN_WIN_RATE      = 0.55;  // 55% minimum win rate
const MIN_TRADES        = 5;     // must appear on 5+ different token pairs
const MIN_WINNING_TOKENS = 3;   // must have profited on 3+ of them
const MAX_TOKEN_AGE_H   = 48;   // only consider tokens launched within 48h
const MIN_LIQUIDITY_USD = 5000; // skip pairs below $5k liquidity
const EARLY_BUYER_LIMIT = 10;   // first N buyers per pair to track
const MAX_PAIRS         = 40;   // cap to avoid hammering RPC

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

// ── Step 1: Fetch trending BSC tokens from DexScreener boosts ────────────────
async function fetchTrendingBscTokens() {
  const resp = await axios.get('https://api.dexscreener.com/token-boosts/top/v1', { timeout: 10000 });
  const boosts = Array.isArray(resp.data) ? resp.data : [];
  const addrs = [...new Set(
    boosts
      .filter(b => b.chainId === 'bsc' && b.tokenAddress)
      .map(b => b.tokenAddress.toLowerCase())
  )].slice(0, MAX_PAIRS);
  return addrs;
}

// ── Step 2: Resolve pair data for each token address ─────────────────────────
async function resolvePairs(tokenAddresses) {
  const qualified = [];

  for (let i = 0; i < tokenAddresses.length; i += 8) {
    const batch = tokenAddresses.slice(i, i + 8);
    await Promise.all(batch.map(async addr => {
      try {
        const r = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
          { timeout: 8000 }
        );
        const pairs = (r.data?.pairs || []).filter(p =>
          p.chainId === 'bsc' && p.pairAddress && p.pairCreatedAt
        );
        if (!pairs.length) return;

        // Pick the highest-liquidity PancakeSwap pair
        const pair = pairs
          .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        const liq     = pair.liquidity?.usd || 0;
        const ageMs   = Date.now() - pair.pairCreatedAt;
        const ageH    = ageMs / 3_600_000;

        if (liq < MIN_LIQUIDITY_USD) return;
        if (ageH > MAX_TOKEN_AGE_H)  return;

        qualified.push({
          pairAddress:    pair.pairAddress.toLowerCase(),
          tokenAddress:   addr,
          symbol:         pair.baseToken?.symbol || addr.slice(0, 8),
          pairCreatedAt:  pair.pairCreatedAt,
          priceChangeH1:  pair.priceChange?.h1  ?? 0,
          priceChangeH6:  pair.priceChange?.h6  ?? 0,
          liq,
          ageH,
        });
      } catch (_) {}
    }));
    await sleep(400);
  }

  return qualified;
}

// ── Step 3: Scan first 100 blocks of each pair for early buyers ──────────────
async function scanEarlyBuyers(pairs, provider) {
  // walletStats[addr] = { tokens: Set<pairAddr>, wins: Set<pairAddr>, roiSum }
  const walletStats = {};
  const currentBlock = await provider.getBlockNumber();

  for (const pair of pairs) {
    try {
      // Estimate launch block from pair creation timestamp
      const ageBlocks  = Math.round((Date.now() - pair.pairCreatedAt) / 3000);
      const launchBlock = Math.max(1, currentBlock - ageBlocks);
      const endBlock    = Math.min(launchBlock + 100, currentBlock);

      if (launchBlock >= currentBlock) continue;

      const swapLogs = await provider.getLogs({
        address:   pair.pairAddress,
        topics:    [SWAP_TOPIC],
        fromBlock: launchBlock,
        toBlock:   endBlock,
      }).catch(() => []);

      if (!swapLogs.length) continue;

      // Resolve tx.from for up to EARLY_BUYER_LIMIT unique EOA buyers
      const seen = new Set();
      const earlyBuyers = [];

      for (let i = 0; i < swapLogs.length && earlyBuyers.length < EARLY_BUYER_LIMIT; i += 3) {
        const batch = swapLogs.slice(i, i + 3);
        const txes  = await Promise.all(
          batch.map(l => provider.getTransaction(l.transactionHash).catch(() => null))
        );
        for (const tx of txes) {
          if (!tx?.from || seen.has(tx.from.toLowerCase())) continue;
          const from = tx.from.toLowerCase();
          const code = await provider.getCode(from).catch(() => '0x');
          if (code !== '0x') continue; // skip contracts / routers
          seen.add(from);
          earlyBuyers.push(from);
        }
        await sleep(80);
      }

      const isWin = pair.priceChangeH1 > 0;

      for (const buyer of earlyBuyers) {
        if (!walletStats[buyer]) {
          walletStats[buyer] = { tokens: new Set(), wins: new Set(), roiSum: 0 };
        }
        walletStats[buyer].tokens.add(pair.pairAddress);
        if (isWin) walletStats[buyer].wins.add(pair.pairAddress);
        walletStats[buyer].roiSum += pair.priceChangeH1;
      }

      await sleep(200);
    } catch (_) {}
  }

  return walletStats;
}

// ── Step 4: Score, filter and persist qualifying wallets ──────────────────────
async function persistQualified(walletStats, prisma) {
  const existing = await prisma.trader.findMany({ select: { walletAddress: true } });
  const existingSet = new Set(
    existing.map(t => t.walletAddress?.toLowerCase()).filter(Boolean)
  );

  // Score every observed wallet
  const candidates = Object.entries(walletStats)
    .map(([addr, s]) => ({
      addr,
      tradeCount: s.tokens.size,
      winCount:   s.wins.size,
      winRate:    s.tokens.size > 0 ? s.wins.size / s.tokens.size : 0,
      avgROI:     s.tokens.size > 0 ? s.roiSum / s.tokens.size : 0,
    }))
    .filter(c =>
      c.winRate    >= MIN_WIN_RATE        &&
      c.tradeCount >= MIN_TRADES          &&
      c.winCount   >= MIN_WINNING_TOKENS
    )
    .sort((a, b) => b.winRate - a.winRate || b.avgROI - a.avgROI);

  let added = 0;
  for (const c of candidates) {
    if (existingSet.has(c.addr)) continue;

    const name = `HARVEST_${c.addr.slice(2, 8).toUpperCase()}_W${Math.round(c.winRate * 100)}`;
    await prisma.trader.create({
      data: {
        name,
        walletAddress:    c.addr,
        signalSourceType: 'AUTO_DISCOVERED',
        isActive:         true,
        allowedPairs:     'BSC_ANY',
        maxTradeSize:     50,
        riskMultiplier:   1.0,
      },
    });
    log(`  ✨ ${name} | win:${Math.round(c.winRate * 100)}% | trades:${c.tradeCount} | avgROI:${c.avgROI.toFixed(0)}%`);
    added++;
  }

  return { added, candidates: candidates.length };
}

// ── Main export ───────────────────────────────────────────────────────────────
async function harvestWallets(prisma, provider) {
  log('🔍 Wallet harvest started — scanning trending BSC tokens...');

  try {
    // 1. Trending tokens
    const tokenAddresses = await fetchTrendingBscTokens();
    log(`  Trending BSC tokens: ${tokenAddresses.length}`);
    if (!tokenAddresses.length) {
      log('⚠️  No trending BSC tokens found — skipping harvest');
      return 0;
    }

    // 2. Resolve pair metadata
    const pairs = await resolvePairs(tokenAddresses);
    log(`  Qualified pairs (liq>$${MIN_LIQUIDITY_USD / 1000}k, <${MAX_TOKEN_AGE_H}h old): ${pairs.length}`);
    if (!pairs.length) {
      log('⚠️  No qualified pairs — skipping harvest');
      return 0;
    }

    // 3. Scan early buyers on-chain
    const walletStats = await scanEarlyBuyers(pairs, provider);
    const uniqueWallets = Object.keys(walletStats).length;
    log(`  Unique early-buyer wallets observed: ${uniqueWallets}`);

    // 4. Score + save
    const { added, candidates } = await persistQualified(walletStats, prisma);
    log(`  Scored candidates above threshold: ${candidates}`);
    log(`🔍 Harvested ${added} new smart wallets from trending tokens`);

    return added;
  } catch (e) {
    log(`❌ harvestWallets error: ${e.message}`);
    return 0;
  }
}

module.exports = { harvestWallets };

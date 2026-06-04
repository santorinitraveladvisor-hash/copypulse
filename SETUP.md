# CopyPulse Bot Engine — Setup Guide

## 1. Copy files into your project root
Place `bot-engine.js` and `.env` in your copypulse project folder (same level as package.json)

## 2. Install extra dependencies
```bash
npm install axios dotenv
```
(ethers and @prisma/client are already in your package.json)

## 3. Create your .env file
Copy .env.example to .env and fill in:
- WALLET_PRIVATE_KEY — your BSC wallet private key (the one that will trade)
- Keep BSCSCAN_API_KEY as is (already set)

⚠️  NEVER commit .env to GitHub — it's already in .gitignore

## 4. Run the bot engine (in a separate terminal from next dev)
```bash
node bot-engine.js
```

## 5. Run the dashboard (in another terminal)
```bash
npm run dev
```

## How it works
- Bot engine runs on its own (Node.js process)
- It monitors BSC wallets every 15 seconds
- Auto-discovers top traders every hour
- Executes buys via PancakeSwap when a signal is detected
- Monitors open positions every 30 seconds for TP/SL
- Dashboard reads from the same SQLite database

## Monitor mode (no trading)
Leave WALLET_PRIVATE_KEY empty — the bot will detect signals and log them
but NOT execute any trades. Good for testing first.

## Add wallets manually
Go to the Traders page in the dashboard → add wallet address
The bot picks it up automatically on next poll.

## Engine status
Visit http://localhost:3001/engine-status to see:
- How many wallets being tracked
- Open positions
- Daily loss counter

## Risk settings (in .env)
- MAX_TRADE_BNB=0.05 → spend max 0.05 BNB per trade
- TAKE_PROFIT_PCT=100 → sell at 2x (100% gain)
- STOP_LOSS_PCT=30 → sell if down 30%
- MAX_OPEN_POSITIONS=5 → max 5 trades open at once
- MAX_DAILY_LOSS_BNB=0.5 → stop trading if lost 0.5 BNB today

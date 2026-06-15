-- CreateTable
CREATE TABLE "TradeResult" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "traderId" TEXT,
    "exitReason" TEXT NOT NULL,
    "buyPrice" DOUBLE PRECISION NOT NULL,
    "sellPrice" DOUBLE PRECISION NOT NULL,
    "bnbSpent" DOUBLE PRECISION NOT NULL,
    "bnbReceived" DOUBLE PRECISION NOT NULL,
    "pnlBnb" DOUBLE PRECISION NOT NULL,
    "pnlPct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FourMemeSignal" (
    "id" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "signalTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "walletCount" INTEGER NOT NULL,
    "entryPriceBnb" DOUBLE PRECISION,
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "currentPriceBnb" DOUBLE PRECISION,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FourMemeSignal_pkey" PRIMARY KEY ("id")
);

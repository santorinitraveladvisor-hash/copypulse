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

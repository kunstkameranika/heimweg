-- CreateEnum
CREATE TYPE "CareersBoard" AS ENUM ('GREENHOUSE', 'LEVER', 'LEVER_EU', 'ASHBY');

-- AlterEnum
ALTER TYPE "PostingSource" ADD VALUE 'BRANDS';

-- CreateTable
CREATE TABLE "WatchedCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "board" "CareersBoard" NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedCompany_board_slug_key" ON "WatchedCompany"("board", "slug");

ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "hits" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

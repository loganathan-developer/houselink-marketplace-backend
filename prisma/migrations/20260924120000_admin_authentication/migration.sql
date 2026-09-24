CREATE TYPE "AdminChallengePurpose" AS ENUM ('MFA_SETUP', 'MFA_ENROLLMENT', 'MFA_LOGIN');

CREATE TABLE "AdminMfaCredential" (
    "userId" UUID NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(6),
    "lastAcceptedTotpStep" BIGINT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AdminMfaCredential_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "AdminMfaCredential_activation_check" CHECK ("activatedAt" IS NULL OR "lastAcceptedTotpStep" IS NOT NULL)
);

CREATE TABLE "AdminLoginChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AdminChallengePurpose" NOT NULL,
    "passwordChangedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminLoginChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminLoginChallenge_attempts_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts")
);

CREATE TABLE "AdminRecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminLoginChallenge_tokenHash_key" ON "AdminLoginChallenge"("tokenHash");
CREATE INDEX "AdminLoginChallenge_userId_consumedAt_idx" ON "AdminLoginChallenge"("userId", "consumedAt");
CREATE INDEX "AdminLoginChallenge_expiresAt_idx" ON "AdminLoginChallenge"("expiresAt");
CREATE UNIQUE INDEX "AdminRecoveryCode_codeHash_key" ON "AdminRecoveryCode"("codeHash");
CREATE INDEX "AdminRecoveryCode_userId_consumedAt_idx" ON "AdminRecoveryCode"("userId", "consumedAt");

ALTER TABLE "AdminMfaCredential" ADD CONSTRAINT "AdminMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminLoginChallenge" ADD CONSTRAINT "AdminLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminRecoveryCode" ADD CONSTRAINT "AdminRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

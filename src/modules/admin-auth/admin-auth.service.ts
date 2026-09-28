import { randomBytes } from "node:crypto";
import type {
  AdminChallengePurpose,
  Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { createSession, lockUser } from "../auth/session.service.js";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../auth/token.service.js";
import {
  acceptedTotpStep,
  authenticator,
  decryptSecret,
  encryptSecret,
  encryptionKey,
  newTotpSecret,
  recoveryHash,
  verifyPassword,
} from "./admin-auth.crypto.js";
import type { LoginBody } from "./admin-auth.types.js";

const invalidCredentials = () =>
  new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials.");
const invalidChallenge = () =>
  new HttpError(
    401,
    "INVALID_MFA_CHALLENGE",
    "Invalid or expired MFA challenge or code.",
  );
async function currentAdmin(tx: Prisma.TransactionClient, userId: string) {
  // Hold account/assignment rows until commit so a simultaneous block or role removal
  // cannot interleave between the eligibility check and STAFF session creation.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "UserRole" WHERE "userId" = ${userId}::uuid FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      passwordCredential: true,
      roles: { include: { role: true } },
      identities: {
        where: { provider: "EMAIL" },
        select: { identifier: true },
      },
    },
  });
  return user?.status === "ACTIVE" &&
    user.passwordCredential &&
    user.roles.some(({ role }) => role.code === "ADMIN")
    ? user
    : null;
}

async function newChallenge(
  tx: Prisma.TransactionClient,
  userId: string,
  passwordChangedAt: Date,
  purpose: AdminChallengePurpose,
  expiresAt = new Date(Date.now() + 300000),
) {
  const challengeToken = generateRefreshToken();
  await tx.adminLoginChallenge.create({
    data: {
      userId,
      passwordChangedAt,
      purpose,
      expiresAt,
      tokenHash: hashRefreshToken(challengeToken),
    },
  });
  return {
    challengeToken,
    expiresAt,
    nextStep:
      purpose === "MFA_SETUP"
        ? "MFA_SETUP"
        : purpose === "MFA_ENROLLMENT"
          ? "MFA_CONFIRM"
          : "MFA_VERIFY",
  };
}

export async function passwordLogin(body: LoginBody) {
  encryptionKey();
  const identity = await prisma.authIdentity.findUnique({
    where: {
      provider_identifier: { provider: "EMAIL", identifier: body.email },
    },
    include: { user: { include: { passwordCredential: true } } },
  });
  const credential = identity?.user.passwordCredential;
  const valid = await verifyPassword(credential?.passwordHash, body.password);
  if (!valid || !identity || !credential) throw invalidCredentials();
  const result = await prisma.$transaction(async (tx) => {
    await lockUser(tx, identity.userId);
    const user = await currentAdmin(tx, identity.userId);
    if (
      !user ||
      user.passwordCredential!.passwordHash !== credential.passwordHash
    )
      return null;
    const mfa = await tx.adminMfaCredential.findUnique({
      where: { userId: user.id },
    });
    return newChallenge(
      tx,
      user.id,
      credential.passwordChangedAt,
      mfa?.activatedAt ? "MFA_LOGIN" : "MFA_SETUP",
    );
  });
  if (!result) throw invalidCredentials();
  return result;
}

async function withChallenge<T>(
  raw: string,
  purpose: AdminChallengePurpose,
  run: (
    tx: Prisma.TransactionClient,
    challenge: NonNullable<Awaited<ReturnType<typeof loadChallenge>>>,
    user: NonNullable<Awaited<ReturnType<typeof currentAdmin>>>,
    now: Date,
  ) => Promise<T | null>,
): Promise<T> {
  const tokenHash = hashRefreshToken(raw);
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.adminLoginChallenge.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!initial) return null;
    await lockUser(tx, initial.userId);
    const challenge = await loadChallenge(tx, tokenHash);
    const now = new Date();
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.attemptCount >= challenge.maxAttempts
    )
      return null;
    const user = await currentAdmin(tx, challenge.userId);
    if (
      !user ||
      user.passwordCredential!.passwordChangedAt.getTime() !==
        challenge.passwordChangedAt.getTime()
    )
      return null;
    await tx.adminLoginChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: { increment: 1 } },
    });
    return run(tx, challenge, user, now);
  });
  // Invalid codes return null inside the transaction so failed attempts remain committed.
  if (result === null) throw invalidChallenge();
  return result;
}
const loadChallenge = (tx: Prisma.TransactionClient, tokenHash: string) =>
  tx.adminLoginChallenge.findUnique({ where: { tokenHash } });

export async function setupMfa(challengeToken: string) {
  return withChallenge(
    challengeToken,
    "MFA_SETUP",
    async (tx, challenge, user, now) => {
      const existing = await tx.adminMfaCredential.findUnique({
        where: { userId: user.id },
      });
      if (existing?.activatedAt) return null;
      const secret = newTotpSecret();
      const encryptedSecret = encryptSecret(secret, user.id);
      await tx.adminMfaCredential.upsert({
        where: { userId: user.id },
        create: { userId: user.id, encryptedSecret },
        update: { encryptedSecret },
      });
      // Starting over invalidates previous enrollment challenges, never an active factor.
      await tx.adminLoginChallenge.updateMany({
        where: {
          userId: user.id,
          purpose: { in: ["MFA_SETUP", "MFA_ENROLLMENT"] },
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      const next = await newChallenge(
        tx,
        user.id,
        challenge.passwordChangedAt,
        "MFA_ENROLLMENT",
        challenge.expiresAt,
      );
      const accountLabel = user.identities[0]!.identifier;
      return {
        ...next,
        manualKey: secret,
        otpauthUri: authenticator(secret, accountLabel).toString(),
        issuer: env.ADMIN_MFA_ISSUER,
        accountLabel,
      };
    },
  );
}

export async function finishMfa(
  challengeToken: string,
  code: string,
  mode: "confirm" | "verify" | "recovery",
) {
  return withChallenge(
    challengeToken,
    mode === "confirm" ? "MFA_ENROLLMENT" : "MFA_LOGIN",
    async (tx, challenge, user, now) => {
      const mfa = await tx.adminMfaCredential.findUnique({
        where: { userId: user.id },
      });
      if (!mfa || (mode === "confirm" ? !!mfa.activatedAt : !mfa.activatedAt))
        return null;
      let recoveryCodes: string[] | undefined;
      if (mode === "recovery") {
        const used = await tx.adminRecoveryCode.updateMany({
          where: {
            userId: user.id,
            codeHash: recoveryHash(user.id, code),
            consumedAt: null,
          },
          data: { consumedAt: now },
        });
        if (used.count !== 1) return null;
      } else {
        const step = acceptedTotpStep(
          decryptSecret(mfa.encryptedSecret, user.id),
          code,
          now,
        );
        if (
          step === null ||
          (mfa.lastAcceptedTotpStep !== null &&
            step <= mfa.lastAcceptedTotpStep)
        )
          return null;
        const updated = await tx.adminMfaCredential.updateMany({
          where: {
            userId: user.id,
            OR: [
              { lastAcceptedTotpStep: null },
              { lastAcceptedTotpStep: { lt: step } },
            ],
          },
          data: {
            lastAcceptedTotpStep: step,
            ...(mode === "confirm" ? { activatedAt: now } : {}),
          },
        });
        if (updated.count !== 1) return null;
        if (mode === "confirm") {
          recoveryCodes = Array.from({ length: 10 }, () =>
            randomBytes(16).toString("hex"),
          );
          await tx.adminRecoveryCode.createMany({
            data: recoveryCodes.map((value) => ({
              userId: user.id,
              codeHash: recoveryHash(user.id, value),
            })),
          });
        }
      }
      const consumed = await tx.adminLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1)
        throw new Error("Admin challenge consumption invariant failed");
      const tokens = await createSession(tx, user.id, "STAFF");
      return { tokens, ...(recoveryCodes ? { recoveryCodes } : {}) };
    },
  );
}

export async function adminProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      identities: {
        where: { provider: "EMAIL" },
        select: { identifier: true },
      },
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  return {
    id: user.id,
    email: user.identities[0]?.identifier ?? null,
    roles: user.roles.map(({ role }) => role.code),
  };
}

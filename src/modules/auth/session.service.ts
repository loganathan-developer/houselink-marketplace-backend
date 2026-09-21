import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { advisoryLockKey } from "./otp/otp.utils.js";
import { durationMs, generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from "./token.service.js";

export const unauthenticated = () => new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
export type AuthTokens = { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date };

export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`auth-user:${userId}`)})`;
}

async function issueTokens(tx: Prisma.TransactionClient, session: { id: string; userId: string; absoluteExpiresAt: Date; idleExpiresAt: Date }, now: Date) {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Math.min(now.getTime() + durationMs(env.REFRESH_TOKEN_EXPIRES_IN), session.absoluteExpiresAt.getTime(), session.idleExpiresAt.getTime()));
  const accessExpiresAt = new Date(Math.floor(Math.min(now.getTime() + durationMs(env.ACCESS_TOKEN_EXPIRES_IN), session.absoluteExpiresAt.getTime(), session.idleExpiresAt.getTime()) / 1000) * 1000);
  const record = await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: refreshExpiresAt } });
  const accessToken = await signAccessToken(session.userId, session.id, accessExpiresAt);
  return { record, tokens: { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } };
}

export async function createSession(tx: Prisma.TransactionClient, userId: string): Promise<AuthTokens> {
  await lockUser(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== "ACTIVE") throw unauthenticated();
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + env.SESSION_ABSOLUTE_EXPIRES_IN_SECONDS * 1000);
  const session = await tx.authSession.create({ data: {
    userId, context: "CUSTOMER", lastSeenAt: now, absoluteExpiresAt,
    idleExpiresAt: new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + env.SESSION_IDLE_EXPIRES_IN_SECONDS * 1000)),
  } });
  return (await issueTokens(tx, session, now)).tokens;
}

export async function rotateRefreshToken(raw: string | undefined): Promise<AuthTokens> {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw unauthenticated();
  const tokenHash = hashRefreshToken(raw);
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.refreshToken.findUnique({ where: { tokenHash }, select: { session: { select: { userId: true } } } });
    if (!initial) return null;
    // A common user lock serializes rotation, logout, logout-all and login session creation.
    await lockUser(tx, initial.session.userId);
    const token = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: { include: { user: { select: { status: true } } } } } });
    if (!token) return null;
    const now = new Date();
    const session = token.session;
    if (token.consumedAt) {
      await tx.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.updateMany({ where: { sessionId: session.id, revokedAt: null }, data: { revokedAt: now } });
      return { reuse: session.id };
    }
    if (token.revokedAt || token.expiresAt <= now || session.revokedAt || session.absoluteExpiresAt <= now || session.idleExpiresAt <= now || session.user.status !== "ACTIVE") return null;
    const consumed = await tx.refreshToken.updateMany({ where: { id: token.id, consumedAt: null, revokedAt: null }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new Error("Refresh consumption invariant failed");
    const updated = await tx.authSession.update({ where: { id: session.id }, data: {
      lastSeenAt: now,
      idleExpiresAt: new Date(Math.min(session.absoluteExpiresAt.getTime(), now.getTime() + env.SESSION_IDLE_EXPIRES_IN_SECONDS * 1000)),
    } });
    const issued = await issueTokens(tx, updated, now);
    await tx.refreshToken.update({ where: { id: token.id }, data: { replacedById: issued.record.id } });
    return { tokens: issued.tokens };
  });
  // Errors are raised after commit so reuse revocation is never rolled back.
  if (!result || "reuse" in result) {
    if (result) logger.warn({ event: "refresh_reuse", sessionId: result.reuse }, "Refresh reuse revoked session");
    throw unauthenticated();
  }
  return result.tokens;
}

export async function revokeSessionFromCookies(refresh: string | undefined, access: string | undefined) {
  let sessionId: string | undefined;
  if (refresh && /^[A-Za-z0-9_-]{43}$/.test(refresh)) {
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(refresh) }, select: { sessionId: true } });
    sessionId = token?.sessionId;
  }
  if (!sessionId && access) {
    try { sessionId = (await verifyAccessToken(access)).sid; } catch { /* Invalid credentials still allow cookie clearing. */ }
  }
  if (!sessionId) return;
  const session = await prisma.authSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!session) return;
  await revokeSessions(session.userId, sessionId);
}

export async function revokeSessions(userId: string, sessionId?: string) {
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const now = new Date();
    const where = { userId, ...(sessionId ? { id: sessionId } : {}) };
    await tx.authSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now } });
    await tx.refreshToken.updateMany({ where: { session: where, revokedAt: null }, data: { revokedAt: now } });
  });
  logger.info({ event: "session_revoked", userId, sessionId }, "Sessions revoked");
}

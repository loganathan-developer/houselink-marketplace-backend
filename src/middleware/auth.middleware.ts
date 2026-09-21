import type { RequestHandler } from "express";
import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { HttpError } from "../shared/errors/http-error.js";
import { ACCESS_COOKIE, readCookie } from "../modules/auth/auth.cookies.js";
import { verifyAccessToken } from "../modules/auth/token.service.js";
import { unauthenticated } from "../modules/auth/session.service.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string; roles: string[]; context: "CUSTOMER" | "STAFF"; mfaVerified: boolean };
    }
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const raw = readCookie(req, ACCESS_COOKIE);
  if (!raw) throw unauthenticated();
  let claims;
  try { claims = await verifyAccessToken(raw); } catch { throw unauthenticated(); }
  const session = await prisma.authSession.findUnique({ where: { id: claims.sid }, select: {
    id: true, userId: true, context: true, mfaVerifiedAt: true, revokedAt: true, absoluteExpiresAt: true, idleExpiresAt: true,
    user: { select: { status: true, roles: { select: { role: { select: { code: true } } } } } },
  } });
  const now = new Date();
  if (!session || session.userId !== claims.sub || session.revokedAt || session.absoluteExpiresAt <= now || session.idleExpiresAt <= now || session.user.status !== "ACTIVE") throw unauthenticated();
  req.auth = { userId: session.userId, sessionId: session.id, context: session.context, mfaVerified: session.mfaVerifiedAt !== null, roles: session.user.roles.map(({ role }) => role.code) };
  next();
};

export function requireAnyRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) throw unauthenticated();
    const auth = req.auth;
    if (!roles.some((role) => auth.roles.includes(role) &&
        (role !== "ADMIN" || (auth.context === "STAFF" && auth.mfaVerified)))) {
      logger.warn({ event: "authorization_failure", requestId: res.locals.requestId, userId: req.auth.userId }, "Permission denied");
      throw new HttpError(403, "FORBIDDEN", "Permission denied.");
    }
    next();
  };
}

export const requireRole = (role: string) => requireAnyRole(role);

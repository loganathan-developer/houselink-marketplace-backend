import { createHash } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";
import type { RequestHandler } from "express";
import { prisma } from "../../../config/database.js";
import { env } from "../../../config/env.js";
import { HttpError } from "../../../shared/errors/http-error.js";

function sharedRateLimiter(scope: string, windowSeconds: number, limit: number): RequestHandler {
  return async (req, res, next) => {
    const ip = ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
    const key = createHash("sha256").update(`${scope}:${ip}`).digest("hex");
    // Atomic upserts share counters across API instances, including IPv6 subnet grouping.
    const rows = await prisma.$queryRaw<Array<{ hits: number; expiresAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "hits", "expiresAt")
      VALUES (${key}, 1, clock_timestamp() + ${windowSeconds} * interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitBucket"."expiresAt" <= clock_timestamp() THEN 1 ELSE "RateLimitBucket"."hits" + 1 END,
        "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= clock_timestamp() THEN clock_timestamp() + ${windowSeconds} * interval '1 second' ELSE "RateLimitBucket"."expiresAt" END
      RETURNING "hits", "expiresAt"`;
    const row = rows[0]!;
    if (row.hits > limit) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)));
      throw new HttpError(429, "AUTH_RATE_LIMITED", "Too many requests. Please try again later.");
    }
    next();
  };
}
export const otpRequestRateLimiter = sharedRateLimiter("otp-request", env.OTP_REQUEST_WINDOW_SECONDS, env.OTP_REQUEST_MAX_PER_WINDOW);
export const authRateLimiter = sharedRateLimiter("auth", 60, 120);

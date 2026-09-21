import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const claimsSchema = z.object({ sub: z.uuid(), sid: z.uuid(), exp: z.number().int() });

export function durationMs(value: string): number {
  const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(value.slice(0, -1)) * units[value.slice(-1)]!;
}

export function generateRefreshToken() {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function signAccessToken(userId: string, sessionId: string, expiresAt: Date) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: env.JWT_ALGORITHM, typ: "JWT" })
    .setJti(randomUUID())
    .setSubject(userId).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE)
    .setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(secret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [env.JWT_ALGORITHM], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
    typ: "JWT", requiredClaims: ["sub", "sid", "exp", "iat"],
    maxTokenAge: durationMs(env.ACCESS_TOKEN_EXPIRES_IN) / 1000,
  });
  return claimsSchema.parse(payload);
}

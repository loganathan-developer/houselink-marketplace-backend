import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hash, verify, argon2id } from "argon2";
import { Secret, TOTP } from "otpauth";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/errors/http-error.js";

export const hashPassword = (password: string) => hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(passwordHash: string | undefined, password: string) {
  const encoded = passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString("hex")));
  try { return await verify(encoded, password) && !!passwordHash; } catch { return false; }
}

export function encryptionKey() {
  if (!env.ADMIN_MFA_ENCRYPTION_KEY) throw new HttpError(503, "ADMIN_AUTH_UNAVAILABLE", "Admin authentication is not configured.");
  return Buffer.from(env.ADMIN_MFA_ENCRYPTION_KEY, "hex");
}

export function encryptSecret(secret: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`admin-totp:v1:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(encrypted: string, userId: string) {
  const [version, iv, tag, ciphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid MFA encryption envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`admin-totp:v1:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function authenticator(secret: string, label = "admin") {
  return new TOTP({ issuer: env.ADMIN_MFA_ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}
export const newTotpSecret = () => new Secret({ size: 20 }).base32;
export function acceptedTotpStep(secret: string, otp: string, now: Date) {
  const delta = authenticator(secret).validate({ token: otp, timestamp: now.getTime(), window: 1 });
  return delta === null ? null : BigInt(Math.floor(now.getTime() / 30000) + delta);
}
export const recoveryHash = (userId: string, code: string) => createHash("sha256").update(`admin-recovery:v1:${userId}:${code}`).digest("hex");

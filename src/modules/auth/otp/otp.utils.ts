import {
  createHmac,
  createHash,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { env } from "../../../config/env.js";

export function generateOtp(): string {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(6, "0");
}

type HashOtpInput = {
  challengeId: string;
  destination: string;
  channel: "PHONE" | "EMAIL";
  purpose: string;
  otp: string;
};

export function hashOtp({
  challengeId,
  destination,
  channel,
  purpose,
  otp,
}: HashOtpInput): string {
  return createHmac(
    "sha256",
    env.OTP_HASH_SECRET,
  )
    .update(
      `${challengeId}:${destination}:${channel}:${purpose}:${otp}`,
    )
    .digest("hex");
}

export function verifyOtpDigest(
  candidateDigest: string,
  storedDigest: string,
): boolean {
  const candidate = Buffer.from(candidateDigest, "hex");
  const stored = Buffer.from(storedDigest, "hex");

  if (candidate.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(candidate, stored);
}

export function advisoryLockKey(value: string): bigint {
  const digest = createHash("sha256")
    .update(value)
    .digest();

  return digest.readBigInt64BE(0);
}

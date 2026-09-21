import type { OtpProvider } from "./otp-provider.js";
import { env } from "../../../config/env.js";

type MockOtpRecord = {
  destination: string;
  otp: string;
  createdAt: Date;
  expiresAt: Date;
};

const mockOtpStore = new Map<string, MockOtpRecord>();

export class MockOtpProvider implements OtpProvider {
  async sendOtp(
    destination: string,
    otp: string,
    context: { channel: "PHONE" | "EMAIL"; challengeId: string; expiresAt: Date },
  ): Promise<void> {
    if (env.NODE_ENV === "production") throw new Error("Mock OTP is unavailable in production");
    for (const [id, record] of mockOtpStore) {
      if (record.expiresAt.getTime() <= Date.now()) mockOtpStore.delete(id);
    }
    if (env.ENABLE_MOCK_OTP_RETRIEVAL) {
      if (mockOtpStore.size >= 10000) throw new Error("Mock OTP capacity reached");
      mockOtpStore.set(context.challengeId, {
        destination,
        otp,
        createdAt: new Date(),
        expiresAt: context.expiresAt,
      });
    }
  }
}

export function getMockOtp(challengeId: string): MockOtpRecord | null {
  const record = mockOtpStore.get(challengeId);

  if (!record) return null;

  if (record.expiresAt.getTime() <= Date.now()) {
    mockOtpStore.delete(challengeId);
    return null;
  }

  return record;
}

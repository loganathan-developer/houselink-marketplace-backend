import { env } from "../../../config/env.js";
import { MockOtpProvider } from "./mock-otp.provider.js";
import type { OtpProvider } from "./otp-provider.js";

export function createOtpProvider(): OtpProvider {
  switch (env.OTP_PROVIDER) {
    case "mock":
      return new MockOtpProvider();

    case "sms":
      throw new Error(
        "SMS OTP provider is not implemented yet",
      );

    default: {
      const unsupportedProvider: never =
        env.OTP_PROVIDER;

      throw new Error(
        `Unsupported OTP provider: ${unsupportedProvider}`,
      );
    }
  }
}

export const otpProvider = createOtpProvider();
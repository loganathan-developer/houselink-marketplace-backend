export interface OtpProvider {
  sendOtp(
    destination: string,
    otp: string,
    context: {
      channel: "PHONE" | "EMAIL";
      challengeId: string;
      expiresAt: Date;
    },
  ): Promise<void>;
}

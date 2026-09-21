export type OtpPurpose = "LOGIN" | "LINK_IDENTITY";
export type OtpChannel = "PHONE" | "EMAIL";

export type RequestOtpResponse = {
  success: true;
  data: {
    challengeId: string;
    expiresAt: string;
    resendAvailableAt: string;
  };
  message: string;
};

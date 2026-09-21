import { z } from "zod";

const phoneSchema = z.string().trim().max(64)
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .refine((value) => /^\+[1-9]\d{7,14}$/.test(value), "Phone number must be in international format");
// Account identifiers are case-insensitive; do not strip dots or plus tags.
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const purpose = z.literal("LOGIN").default("LOGIN");
const phoneInput = z.strictObject({ phone: phoneSchema, channel: z.literal("PHONE").default("PHONE"), purpose });
const emailInput = z.strictObject({ email: emailSchema, channel: z.literal("EMAIL").default("EMAIL"), purpose });

export const requestOtpBodySchema = z.union([phoneInput, emailInput]);
const verification = { challengeId: z.uuid(), otp: z.string().trim().regex(/^\d{6}$/, "OTP must contain exactly 6 digits") };
const challengeOnlyVerification = z.strictObject(verification);
export const verifyOtpBodySchema = z.union([challengeOnlyVerification, phoneInput.extend(verification), emailInput.extend(verification)]);
export const mockOtpParamsSchema = z.object({ challengeId: z.uuid() });

export type RequestOtpBody = z.infer<typeof requestOtpBodySchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;

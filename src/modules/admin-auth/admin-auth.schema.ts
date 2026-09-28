import { z } from "zod";

export const adminEmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const adminPasswordSchema = z.string().min(12).max(128);
export const loginSchema = z.strictObject({ email: adminEmailSchema, password: z.string().min(1).max(128) });
export const challengeSchema = z.strictObject({ challengeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const totpSchema = challengeSchema.extend({ otp: z.string().regex(/^\d{6}$/) });
export const recoverySchema = challengeSchema.extend({ recoveryCode: z.string().regex(/^[a-fA-F0-9]{32}$/).toLowerCase() });
export const emptySchema = z.strictObject({}).default({});

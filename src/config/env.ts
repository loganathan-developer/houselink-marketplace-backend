import "dotenv/config";
import { z } from "zod";
import { isIP } from "node:net";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce
    .number()
    .int()
    .positive()
    .max(65535)
    .default(5000),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => {
      try {
        const url = new URL(value);
        return ["postgresql:", "postgres:"].includes(url.protocol) && !!url.hostname && url.pathname.length > 1;
      } catch { return false; }
    }, "DATABASE_URL must identify a PostgreSQL database"),

  TRUST_PROXY: z.string().default("").transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean))
    .refine((entries) => entries.every((entry) => {
      const [address, prefix, extra] = entry.split("/");
      const version = isIP(address ?? "");
      return version !== 0 && extra === undefined && (prefix === undefined ||
        (/^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (version === 4 ? 32 : 128)));
    }), "TRUST_PROXY must contain explicit trusted IP addresses or CIDRs (no universal ranges)"),

  FRONTEND_ORIGIN: z
    .string()
    .url("FRONTEND_ORIGIN must be a valid URL")
    .refine((value) => {
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && url.origin === value;
      } catch { return false; }
    }, "FRONTEND_ORIGIN must be an exact HTTP(S) origin without a trailing slash"),

  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  ADMIN_MFA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "Use 32 random bytes encoded as hex").optional(),
  ADMIN_MFA_ISSUER: z.string().trim().min(1).max(100).default("HouseLink Admin"),

  OTP_HASH_SECRET: z
    .string()
    .min(32, "OTP_HASH_SECRET must be at least 32 characters"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),

  JWT_ALGORITHM: z
    .literal("HS256")
    .default("HS256"),

  JWT_ISSUER: z
    .string()
    .min(1, "JWT_ISSUER is required"),

  JWT_AUDIENCE: z
    .string()
    .min(1, "JWT_AUDIENCE is required"),

  ACCESS_TOKEN_EXPIRES_IN: z
    .string()
    .regex(/^[1-9]\d{0,5}[smhd]$/)
    .refine((value) => {
      const seconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      return Number(value.slice(0, -1)) * (seconds[value.slice(-1)] ?? Infinity) <= 3600;
    }, "Access tokens must expire within one hour")
    .default("15m"),

  REFRESH_TOKEN_EXPIRES_IN: z
    .string()
    .regex(/^[1-9]\d{0,5}[smhd]$/)
    .default("7d"),

  SESSION_IDLE_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  SESSION_ABSOLUTE_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  OTP_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),

  OTP_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),

  OTP_RESEND_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60),

  OTP_REQUEST_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 10),

  OTP_REQUEST_MAX_PER_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(10),

  OTP_DESTINATION_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  OTP_DESTINATION_MAX_PER_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(5),

  ENABLE_MOCK_OTP_RETRIEVAL: z.enum(["true", "false"])
    .default("false").transform((value) => value === "true"),

  ALLOW_ANY_DEV_OTP: z.enum(["true", "false"])
    .default("false").transform((value) => value === "true"),

  OTP_PROVIDER: z
    .enum(["mock", "sms"])
    .default("mock"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    "Invalid environment variables:",
    result.error.flatten().fieldErrors,
  );

  process.exit(1);
}

// Production safety check:
// Never allow mock OTP provider in production.
if (
  result.data.NODE_ENV === "production" &&
  result.data.OTP_PROVIDER === "mock"
) {
  console.error(
    "OTP_PROVIDER cannot be 'mock' in production.",
  );

  process.exit(1);
}

if (
  result.data.NODE_ENV === "production" &&
  result.data.ENABLE_MOCK_OTP_RETRIEVAL
) {
  console.error(
    "ENABLE_MOCK_OTP_RETRIEVAL cannot be true in production.",
  );

  process.exit(1);
}

if (
  result.data.NODE_ENV === "production" &&
  result.data.ALLOW_ANY_DEV_OTP
) {
  console.error(
    "ALLOW_ANY_DEV_OTP cannot be true in production.",
  );

  process.exit(1);
}

export const env = result.data;

if (env.NODE_ENV === "production" && (
  !env.FRONTEND_ORIGIN.startsWith("https://") ||
  env.JWT_SECRET === env.OTP_HASH_SECRET ||
  [env.JWT_SECRET, env.OTP_HASH_SECRET].some((value) => /replace|change.?me|test-only|example|placeholder/i.test(value) || new Set(value).size < 12)
)) {
  throw new Error("Production requires an HTTPS frontend and independent randomly generated secrets");
}

if ((env.NODE_ENV === "production" && env.COOKIE_SECURE === "false") ||
    (env.COOKIE_SAME_SITE === "none" && env.COOKIE_SECURE !== "true" && env.NODE_ENV !== "production")) {
  throw new Error("Production and SameSite=None require Secure cookies");
}

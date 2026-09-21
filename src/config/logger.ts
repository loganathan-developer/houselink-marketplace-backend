import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "req.query",
      "req.url",
      "req.originalUrl",
      "res.headers.set-cookie",
      "headers.authorization",
      "headers.cookie",
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "codeDigest",
      "otp",
      "accessToken",
      "refreshToken",
      "secret",
      "JWT_SECRET",
      "OTP_HASH_SECRET",
      "DATABASE_URL",
      "headers.set-cookie",
    ],
    remove: true,
  },
});

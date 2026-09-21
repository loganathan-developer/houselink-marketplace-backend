import type { RequestHandler } from "express";
import cors from "cors";
import { env } from "../config/env.js";
import { HttpError } from "../shared/errors/http-error.js";

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || origin === env.FRONTEND_ORIGIN) callback(null, true);
    else callback(new HttpError(403, "ORIGIN_DENIED", "Request origin is not allowed."));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Protection"],
});

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // Origin takes precedence; Referer is a fallback, never a bypass for a bad Origin.
  let origin = req.get("Origin");
  if (origin === undefined) {
    try { origin = new URL(req.get("Referer") ?? "").origin; } catch { /* Fail closed below. */ }
  }
  if (req.get("X-CSRF-Protection") !== "1" || origin !== env.FRONTEND_ORIGIN) {
    throw new HttpError(403, "CSRF_REJECTED", "Request verification failed.");
  }
  next();
};

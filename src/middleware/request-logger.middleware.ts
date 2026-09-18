import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../config/logger.js";

export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logger.info(
      {
        requestId,
        method: req.method,
        route: req.route?.path ?? "unmatched",
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      "HTTP request completed",
    );
  });

  next();
};

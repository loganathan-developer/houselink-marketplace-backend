import type { ErrorRequestHandler } from "express";
import { logger } from "../config/logger.js";
import { HttpError } from "../shared/errors/http-error.js";

const hasType = (error: unknown, type: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "type" in error &&
  error.type === type;

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const httpError =
    error instanceof HttpError
      ? error
      : hasType(error, "entity.parse.failed")
        ? new HttpError(400, "INVALID_JSON", "Malformed JSON request body")
        : hasType(error, "entity.too.large")
          ? new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large")
          : new HttpError(500, "INTERNAL_SERVER_ERROR", "Internal server error");

  const isServerError = httpError.statusCode >= 500;
  if (isServerError) {
    logger.error(
      { errorType: error instanceof Error ? error.name : "Unknown", requestId: res.locals.requestId },
      "Unhandled request error",
    );
  }

  if ([401, 403, 429].includes(httpError.statusCode)) {
    logger.warn({ event: "auth_request_rejected", code: httpError.code, requestId: res.locals.requestId, route: _req.route?.path ?? "unmatched" }, "Request rejected");
  }
  res.status(httpError.statusCode).json({
    success: false,
    error: {
      code: isServerError ? "INTERNAL_SERVER_ERROR" : httpError.code,
      message: isServerError ? "Internal server error" : httpError.message,
      ...(!isServerError && httpError.details ? { details: httpError.details } : {}),
    },
    requestId: res.locals.requestId,
  });
};

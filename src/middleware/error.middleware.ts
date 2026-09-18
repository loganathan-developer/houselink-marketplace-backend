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
      { err: error instanceof Error ? error : undefined, requestId: res.locals.requestId },
      "Unhandled request error",
    );
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

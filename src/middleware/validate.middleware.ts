import type { RequestHandler } from "express";
import { z } from "zod";
import {
  HttpError,
  type ValidationIssue,
} from "../shared/errors/http-error.js";

type RequestPart = "params" | "query" | "body";
type RequestSchemas = Partial<Record<RequestPart, z.ZodType>>;

export const validateRequest = (schemas: RequestSchemas): RequestHandler =>
  (req, res, next) => {
    const validated: Partial<Record<RequestPart, unknown>> = {};
    const issues: ValidationIssue[] = [];

    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        validated[part] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            path: [part, ...issue.path].join("."),
            message: issue.message,
          })),
        );
      }
    }

    if (issues.length > 0) {
      next(new HttpError(400, "VALIDATION_ERROR", "Invalid request", issues));
      return;
    }

    res.locals.validated = validated;
    next();
  };

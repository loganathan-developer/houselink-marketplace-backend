import type { RequestHandler } from "express";
import { HttpError } from "../shared/errors/http-error.js";

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", "Route not found"));
};

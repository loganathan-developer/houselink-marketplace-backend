import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { env } from "../../config/env.js";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { remove, upload } from "./media.controller.js";
import { mediaParams, mediaPurposeBody, noQuery } from "./media.schema.js";

const router = Router();
const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_UPLOAD_BYTES, files: 1, fields: 1, parts: 2 },
});
const uploadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 3 : 20,
  keyGenerator: (req) => req.auth!.userId,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, "MEDIA_UPLOAD_RATE_LIMITED", "Too many image uploads.")),
});

router.use(authenticate, requireRole("ADMIN"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.post("/", uploadLimit, multipart.single("file"), validateRequest({ body: mediaPurposeBody, query: noQuery }), upload);
router.delete("/:mediaId", validateRequest({ params: mediaParams, query: noQuery }), remove);

export default router;

import { Router } from "express";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { authRateLimiter } from "./otp/otp-rate-limit.middleware.js";

import {
  requestOtp,
  verifyOtp,
  refreshToken,
  getMe,
  logout,
  logoutAll,
  getMockOtp,
} from "./auth.controller.js";

import {
  requestOtpBodySchema,
  verifyOtpBodySchema,
  mockOtpParamsSchema,
} from "./auth.schema.js";
import {
  otpRequestRateLimiter,
} from "./otp/otp-rate-limit.middleware.js";

import { validateRequest } from "../../middleware/validate.middleware.js";

const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use(authRateLimiter);

router.post(
  "/otp/request",

  otpRequestRateLimiter,

  validateRequest({
    body: requestOtpBodySchema,
  }),

  requestOtp,
);

router.post(
  "/otp/verify",
  validateRequest({
    body: verifyOtpBodySchema,
  }),
  verifyOtp,
);

if (env.NODE_ENV !== "production" && env.OTP_PROVIDER === "mock" && env.ENABLE_MOCK_OTP_RETRIEVAL) {
  router.get("/otp/mock/:challengeId", validateRequest({ params: mockOtpParamsSchema }), getMockOtp);
}

router.post("/refresh", refreshToken);

router.get("/me", authenticate, getMe);

router.post("/logout", logout);

router.post("/logout-all", authenticate, logoutAll);

export default router;

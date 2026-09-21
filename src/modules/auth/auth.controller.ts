import type { Request, Response } from "express";
import { prisma } from "../../config/database.js";
import { logger } from "../../config/logger.js";
import type { RequestOtpBody, VerifyOtpBody } from "./auth.schema.js";
import { getDevelopmentMockOtp, requestLoginOtp, verifyLoginOtp } from "./auth.service.js";
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie, setAuthCookies, clearAuthCookies } from "./auth.cookies.js";
import { rotateRefreshToken, revokeSessionFromCookies, revokeSessions, unauthenticated } from "./session.service.js";

export async function requestOtp(_req: Request, res: Response) {
  const body = res.locals.validated.body as RequestOtpBody;
  const result = await requestLoginOtp(body);
  res.json({ success: true, data: result, message: "If the destination can receive OTPs, a code has been sent." });
}
export async function getMockOtp(req: Request, res: Response) {
  const id = req.params.challengeId;
  const record = getDevelopmentMockOtp(typeof id === "string" ? id : undefined, req.ip);
  res.json({ success: true, data: { destination: record.destination, otp: record.otp, expiresAt: record.expiresAt } });
}
export async function verifyOtp(_req: Request, res: Response) {
  const body = res.locals.validated.body as VerifyOtpBody;
  const result = await verifyLoginOtp(body);
  setAuthCookies(res, result.tokens);
  logger.info({ event: "login_success", requestId: res.locals.requestId, userId: result.user.id }, "Login succeeded");
  res.json({ success: true, message: "OTP verified successfully", data: { user: result.user } });
}
export async function refreshToken(req: Request, res: Response) {
  const tokens = await rotateRefreshToken(readCookie(req, REFRESH_COOKIE));
  setAuthCookies(res, tokens);
  logger.info({ event: "refresh_success", requestId: res.locals.requestId }, "Refresh succeeded");
  res.json({ success: true });
}
export async function getMe(req: Request, res: Response) {
  if (!req.auth) throw unauthenticated();
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { id: true, name: true, status: true } });
  if (!user || user.status !== "ACTIVE") throw unauthenticated();
  res.json({ success: true, data: { user: { id: user.id, name: user.name, status: user.status, roles: req.auth.roles } } });
}
export async function logout(req: Request, res: Response) {
  await revokeSessionFromCookies(readCookie(req, REFRESH_COOKIE), readCookie(req, ACCESS_COOKIE));
  clearAuthCookies(res);
  logger.info({ event: "logout", requestId: res.locals.requestId }, "Logout completed");
  res.json({ success: true });
}
export async function logoutAll(req: Request, res: Response) {
  if (!req.auth) throw unauthenticated();
  await revokeSessions(req.auth.userId);
  clearAuthCookies(res);
  logger.info({ event: "logout_all", requestId: res.locals.requestId, userId: req.auth.userId }, "Logout-all completed");
  res.json({ success: true });
}

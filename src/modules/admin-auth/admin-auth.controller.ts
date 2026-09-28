import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { readCookie } from "../auth/auth.cookies.js";
import { revokeSessions, rotateRefreshToken } from "../auth/session.service.js";
import { ADMIN_REFRESH_COOKIE, clearAdminCookies, setAdminCookies } from "./admin-auth.cookies.js";
import { adminProfile, finishMfa, passwordLogin, setupMfa } from "./admin-auth.service.js";
import type { ChallengeBody, LoginBody, RecoveryBody, TotpBody } from "./admin-auth.types.js";

export async function login(_req: Request, res: Response) {
  const data = await passwordLogin(res.locals.validated.body as LoginBody);
  res.json({ success: true, data });
}
export async function setup(_req: Request, res: Response) {
  const { challengeToken } = res.locals.validated.body as ChallengeBody;
  res.json({ success: true, data: await setupMfa(challengeToken) });
}
export function finish(mode: "confirm" | "verify" | "recovery") {
  return async (_req: Request, res: Response) => {
    const body = res.locals.validated.body as TotpBody | RecoveryBody;
    const result = await finishMfa(body.challengeToken, "otp" in body ? body.otp : body.recoveryCode, mode);
    setAdminCookies(res, result.tokens);
    logger.info({ event: "admin_login_success", requestId: res.locals.requestId, factor: mode }, "Admin login succeeded");
    res.json({ success: true, data: { context: "STAFF", mfaVerified: true, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) } });
  };
}
export async function me(req: Request, res: Response) {
  res.json({ success: true, data: { user: await adminProfile(req.auth!.userId), context: req.auth!.context, mfaVerified: req.auth!.mfaVerified } });
}
export async function refresh(req: Request, res: Response) {
  setAdminCookies(res, await rotateRefreshToken(readCookie(req, ADMIN_REFRESH_COOKIE), "STAFF"));
  res.json({ success: true });
}
export function logout(all: boolean) {
  return async (req: Request, res: Response) => {
    await revokeSessions(req.auth!.userId, all ? undefined : req.auth!.sessionId, "STAFF");
    clearAdminCookies(res);
    res.json({ success: true });
  };
}

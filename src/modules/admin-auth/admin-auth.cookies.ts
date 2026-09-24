import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";
import type { AuthTokens } from "../auth/session.service.js";

export const ADMIN_ACCESS_COOKIE = "admin_access_token";
export const ADMIN_REFRESH_COOKIE = "admin_refresh_token";
const base: CookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production" || env.COOKIE_SECURE === "true", sameSite: env.COOKIE_SAME_SITE };
const accessOptions = { ...base, path: "/api/admin" };
const refreshOptions = { ...base, path: "/api/admin/auth" };
export function setAdminCookies(res: Response, tokens: AuthTokens) {
  res.cookie(ADMIN_ACCESS_COOKIE, tokens.accessToken, { ...accessOptions, expires: tokens.accessExpiresAt });
  res.cookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, { ...refreshOptions, expires: tokens.refreshExpiresAt });
}
export function clearAdminCookies(res: Response) {
  res.clearCookie(ADMIN_ACCESS_COOKIE, accessOptions);
  res.clearCookie(ADMIN_REFRESH_COOKIE, refreshOptions);
}

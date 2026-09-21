import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import type { AuthTokens } from "./session.service.js";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
const base: CookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production" || env.COOKIE_SECURE === "true", sameSite: env.COOKIE_SAME_SITE };
const accessOptions: CookieOptions = { ...base, path: "/api" };
const refreshOptions: CookieOptions = { ...base, path: "/api/auth" };

export function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === "string" ? value : undefined;
}

export function setAuthCookies(res: Response, tokens: AuthTokens) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...accessOptions, expires: tokens.accessExpiresAt });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...refreshOptions, expires: tokens.refreshExpiresAt });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, accessOptions);
  res.clearCookie(REFRESH_COOKIE, refreshOptions);
}

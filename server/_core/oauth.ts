import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_RETURN_TO_COOKIE, OAUTH_STATE_COOKIE, SIGNUP_USERNAME_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF guard: the nonce in `state` must match the one-time cookie that
    // startLogin set in the browser that began this login. An attacker can
    // forge `state`, but cannot plant this cookie in the victim's browser.
    const { nonce } = decodeOAuthState(state);
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const expectedNonce = cookies[OAUTH_STATE_COOKIE];
    const requestedReturnTo = cookies[OAUTH_RETURN_TO_COOKIE] ? decodeURIComponent(cookies[OAUTH_RETURN_TO_COOKIE]) : '/';
    const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/';
    const signupUsername = cookies[SIGNUP_USERNAME_COOKIE] ? decodeURIComponent(cookies[SIGNUP_USERNAME_COOKIE]) : undefined;
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    const clearCookieOptions = { path: "/", secure: true, sameSite: "none" as const };
    res.clearCookie(OAUTH_STATE_COOKIE, clearCookieOptions);
    res.clearCookie(OAUTH_RETURN_TO_COOKIE, clearCookieOptions);
    res.clearCookie(SIGNUP_USERNAME_COOKIE, clearCookieOptions);

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        username: signupUsername,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
        accountSource: 'self_registered',
        isDummy: false,
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, returnTo);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('already') || error.message.includes('Duplicate entry') || error.message.includes('duplicate'))) {
        res.redirect(302, '/auth?error=account_exists');
        return;
      }
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

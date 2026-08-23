import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS, decodeOAuthState } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    return decodeOAuthState(state).redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    // jti (Phase 4A.6.6): a unique id per issued token, independent of every other
    // session for this user, so logout can revoke exactly this one session without
    // affecting any other device/tab's active session for the same account.
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setJti(randomUUID())
      // iat (Slice 3): required to enforce users.sessionsInvalidBefore. Without
      // an issue time there is no way to tell a session minted before a password
      // reset from one minted by the reset itself.
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string; jti: string | null; expiresAt: Date | null; issuedAt: Date | null } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, jti, exp, iat } = payload as Record<string, unknown>;

      // openId identifies the account. Without it the token means nothing, so
      // this is the one field whose mere presence is genuinely required.
      if (!isNonEmptyString(openId)) {
        console.warn("[Auth] Session payload has no openId");
        return null;
      }

      // appId is checked by COMPARISON, not by presence.
      //
      // This previously required appId to be a non-empty string while never
      // comparing it to anything - so it provided none of the isolation its
      // presence implied, and rejected every token this server itself mints
      // whenever VITE_APP_ID is unset. createSessionToken stamps
      // `appId: ENV.appId`, and ENV.appId falls back to "". The result was a
      // server that issued a session cookie on a successful sign-up, returned
      // success, and then treated that very cookie as invalid on every
      // subsequent request. Nothing surfaced: sign-up reported success, the
      // cookie was set, and the user was silently anonymous.
      //
      // Verified against a live server: sign-up returned
      // {"success":true,"userRole":"homeowner"}, the browser stored the cookie,
      // auth.me returned null, and the log read "Session payload missing
      // required fields" for a token whose payload was
      // {"openId":"local_...","appId":"","name":"Debug User"}.
      //
      // Render staging sets VITE_APP_ID and so was unaffected, which is exactly
      // why this survived: .env.example ships VITE_APP_ID empty, so the
      // documented local setup could not authenticate anyone.
      //
      // Comparing when configured is strictly stronger than the old check - a
      // token minted for a different app under a shared secret is now rejected
      // rather than accepted. When it is unconfigured there is nothing to
      // compare against, and JWT_SECRET remains the actual trust boundary.
      if (ENV.appId && appId !== ENV.appId) {
        console.warn("[Auth] Session was issued for a different app");
        return null;
      }

      return {
        openId,
        appId: isNonEmptyString(appId) ? appId : "",
        // A display name, never a security property. Requiring it made
        // `createSessionToken(openId)` - the usage this file documents as its
        // own example - mint a token that could never be redeemed.
        name: isNonEmptyString(name) ? name : "",
        // Tokens signed before this change carry no jti and are simply not
        // revocable by this mechanism - they remain valid until their natural
        // expiry, same as before. Not a regression: nothing was revocable before.
        jti: isNonEmptyString(jti) ? jti : null,
        expiresAt: typeof exp === "number" ? new Date(exp * 1000) : null,
        issuedAt: typeof iat === "number" ? new Date(iat * 1000) : null,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    // 1. Prefer the session cookie (regular OAuth login).
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);

    // 2. Fallback to the Authorization header (Preview auto-login via
    //    sessionStorage), used when the browser blocks iframe cookies such as
    //    Safari ITP, private browsing, or iOS/Android WebView.
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }

    const session = await this.verifySession(sessionToken);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    // Phase 4A.6.6: reject a token that was explicitly revoked by a prior logout,
    // even though it is still cryptographically valid and unexpired.
    if (session.jti && (await db.isSessionRevoked(session.jti))) {
      throw ForbiddenError("Session has been signed out");
    }

    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);

    // If user not in DB, sync from OAuth server automatically
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
          accountSource: 'self_registered',
          isDummy: false,
        });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    // Bulk invalidation (Slice 3): a password reset sets sessionsInvalidBefore,
    // which retires every session issued before it - including one an attacker
    // established with the stolen password the reset is meant to undo.
    //
    // Fails CLOSED for a token with no `iat`. Tokens minted before this change
    // carry none, so their issue time cannot be established, and "cannot prove
    // it was issued after the reset" has to mean rejected. The only accounts
    // affected are those that actually reset a password, and being signed out
    // is the outcome they just asked for.
    if (user.sessionsInvalidBefore) {
      // Compared at whole-second granularity on both sides. A JWT `iat` is
      // seconds by specification and MySQL `timestamp` is seconds by default,
      // so comparing raw milliseconds would reject the very session the reset
      // just minted whenever the reset landed part-way through a second.
      const cutoffSecond = Math.floor(new Date(user.sessionsInvalidBefore).getTime() / 1000);
      const issuedSecond = session.issuedAt ? Math.floor(session.issuedAt.getTime() / 1000) : null;
      if (issuedSecond === null || issuedSecond < cutoffSecond) {
        throw ForbiddenError("Session was invalidated; please sign in again");
      }
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt,
    });

    return { ...user, sessionJti: session.jti, sessionExpiresAt: session.expiresAt };
  }
}

const CRON_OPEN_ID_PREFIX = "cron_";

/** Result of `sdk.authenticateRequest`. Cron callbacks set `isCron=true` and `taskUid`; see `/home/ubuntu/skills/webdev-periodic-updates/SKILL.md`. */
export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
  // Phase 4A.6.6: the current request's own session identity, so authRouter.logout
  // can revoke exactly this session without needing to re-parse the cookie itself.
  sessionJti?: string | null;
  sessionExpiresAt?: Date | null;
};

function buildCronUser(
  userInfo: GetUserInfoWithJwtResponse
): AuthenticatedUser {
  const now = new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? undefined,
    isCron: true,
  } as AuthenticatedUser;
}

export const sdk = new SDKServer();

import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  // Production pins this true rather than deriving it per request. A single
  // request that looked plain-HTTP - a misconfigured proxy hop, a health check,
  // a stray internal call - would otherwise hand back a cookie the browser
  // discards, logging the user out for no visible reason. Production is HTTPS
  // by definition; derivation is kept only for local HTTP development.
  const secure = ENV.isProduction ? true : isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    // `SameSite=None` is only legal ALONGSIDE `Secure`. Browsers do not
    // downgrade the pairing, they reject the cookie outright - so pinning
    // "none" here while `secure` derived to false emitted:
    //
    //   Set-Cookie: app_session_id=...; Path=/; HttpOnly; SameSite=None
    //
    // which Chrome, Firefox and Safari all drop on the floor. Verified with a
    // real browser against a local HTTP server: sign-up succeeded, the account
    // was created, the server sent that header, the browser kept ZERO cookies,
    // auth.me returned null and the user was bounced back to the login screen.
    // Local development could not authenticate at all, in any browser.
    //
    // "lax" is the correct pairing for an insecure origin and is strictly the
    // safer of the two. Production and any HTTPS deployment keep "none", so
    // cross-site embedding is unaffected - the only behaviour that changes is
    // the plain-HTTP case that was previously broken outright.
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

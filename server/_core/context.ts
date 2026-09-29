import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { HttpError } from "@shared/_core/errors";
import { sdk, type AuthenticatedUser } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthenticatedUser | null;
  /**
   * TRUE WHEN WE COULD NOT TELL WHETHER THIS REQUEST HAS A SESSION.
   *
   * Not the same as `user: null`, and the difference is what somebody reads on
   * the screen. `user: null` means the request carries no valid session, which
   * is a fact. This flag means the question could not be answered - the user
   * store was unreachable - and the honest response to that is "try again",
   * not "you are signed out".
   */
  authUnavailable: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: AuthenticatedUser | null = null;
  let authUnavailable = false;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    /*
     * AN OUTAGE WAS BEING READ AS A SIGN-OUT.
     *
     * This caught everything and set `user = null` under the comment
     * "authentication is optional for public procedures" - true of a request
     * that simply has no cookie, and false of one whose session could not be
     * CHECKED. With the database down, the revocation lookup fails closed, the
     * authenticator reports "Session has been signed out", and this turned
     * that into an anonymous request: `auth.me` answered null, the app decided
     * the administrator was logged out and sent them to the sign-in screen -
     * where they could not sign in either, because the same database was down.
     * Mid-investigation, the product said "you are signed out" when it meant
     * "I cannot reach the user store".
     *
     * `HttpError` is what the authenticator raises for a genuine authentication
     * failure - no cookie, an invalid one, a revoked one. Anything else is
     * infrastructure, and is reported as such.
     *
     * THE REQUEST STILL FAILS CLOSED either way: `user` stays null and nothing
     * protected proceeds. Only the REASON given to the caller changes.
     */
    authUnavailable = !(error instanceof HttpError);
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authUnavailable,
  };
}

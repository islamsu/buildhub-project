import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

/**
 * What a client is allowed to learn when something breaks.
 *
 * Two leaks existed before this. tRPC attaches `shape.data.stack` whenever its
 * `isDev` flag is on, and that flag defaults to `NODE_ENV !== "production"` -
 * so any deploy that runs `node dist/index.js` without that variable set
 * (a bare process manager, a PaaS default, a Docker CMD) served full stack
 * traces on every API error. Separately, `shape.message` is copied from the
 * thrown error UNCONDITIONALLY, so raw `throw new Error(...)` messages from
 * internal modules reached unauthenticated callers - including the storage
 * layer's "set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY" and
 * database-layer messages.
 *
 * The rule below: never send a stack, and never send the message of an error
 * we did not deliberately write for the caller. Server-authored `TRPCError`
 * messages for expected conditions (NOT_FOUND, FORBIDDEN, BAD_REQUEST, …) are
 * part of the product - the billing lifecycle and RFQ targeting both rely on
 * the client showing the server's own refusal reason - so those pass through
 * untouched. INTERNAL_SERVER_ERROR is by definition not one of those.
 *
 * Note this shapes the HTTP response only. `createCaller`, which the test
 * suite uses, still receives the original error, so tests keep asserting the
 * real messages while clients no longer see the internal ones.
 */
const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Please try again.";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const { stack: _stack, ...data } = shape.data as typeof shape.data & { stack?: string };
    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? GENERIC_INTERNAL_MESSAGE : shape.message,
      data,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * "SIGNED OUT" AND "I COULD NOT CHECK" ARE DIFFERENT REFUSALS.
 *
 * UNAUTHORIZED is what makes the client show the sign-in screen, so sending it
 * during an outage tells a signed-in administrator that their session ended -
 * and sends them somewhere they cannot get back from. The request is refused
 * either way; only the explanation changes, and the explanation is the part
 * the person acts on.
 */
function refuseUnauthenticated(ctx: TrpcContext): never {
  if (ctx.authUnavailable) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Your session could not be checked right now. This does not mean you are signed out - please try again.",
    });
  }
  throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
}

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) refuseUnauthenticated(ctx);
  if (ctx.user.role !== 'admin' && ctx.user.accountStatus === 'frozen') {
    throw new TRPCError({ code: "FORBIDDEN", message: "This account is frozen. Contact an administrator." });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    // Same distinction. "You are not an administrator" is a claim about WHO
    // THEY ARE, and an outage is not evidence for it.
    if (!ctx.user) refuseUnauthenticated(ctx);
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

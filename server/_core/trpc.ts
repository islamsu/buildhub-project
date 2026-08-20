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

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
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

    if (!ctx.user || ctx.user.role !== 'admin') {
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

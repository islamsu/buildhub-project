import type { Express, NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ENV } from "./env";

/**
 * ── Structured request logging (Slice 4) ───────────────────────────────────
 *
 * Until now the only server-side record of anything was ad-hoc `console.log`
 * lines from whichever module happened to have one. Nothing recorded that a
 * request had been served at all, so on a production incident there was no way
 * to answer "was the request even reaching us, and how long did it take".
 *
 * One JSON object per completed request, which any log shipper can parse, and
 * which stays greppable by hand.
 *
 * WHAT IS DELIBERATELY ABSENT, and must stay absent:
 *
 *  - request and response bodies. tRPC carries passwords, reset tokens and
 *    invitation tokens through POST bodies; logging them would put every
 *    credential in the platform into a log file that is copied, shipped and
 *    retained far more casually than the database is.
 *  - the Cookie and Authorization headers, for the same reason - the session
 *    JWT is a bearer credential.
 *  - query strings, which is where `?token=` lands on the reset link.
 *
 * The path is logged, and the tRPC procedure name is part of the path, so the
 * log still says *what* was called - just never with what secret.
 */

/** Probes are excluded: at one call per second they would drown everything else. */
const UNLOGGED_PATHS = new Set(["/healthz", "/readyz"]);

export function registerRequestLogging(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (UNLOGGED_PATHS.has(req.path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    // Captured NOW, not in the finish handler. Express rewrites req.url when a
    // request passes into a mounted router, so by the time the response
    // finishes, a call to /api/trpc/auth.signIn reads as "/auth.signIn" and
    // every SPA route reads as "/" - which is what this logger did until it was
    // checked against a running server.
    const path = req.path;
    // Correlates the access line with any error logged while handling it, and
    // is echoed back so a user reporting a problem can quote something we can
    // find. Not a session identifier and not derived from one.
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const entry = {
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        time: new Date().toISOString(),
        requestId,
        method: req.method,
        // `req.path` excludes the query string by construction. Do not swap
        // this for req.originalUrl - that is where `?token=` would leak in.
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        ip: req.ip ?? null,
      };
      // Development already has Vite's own request output; a second stream of
      // JSON on top of it makes the terminal unusable.
      if (ENV.isProduction) {
        console.log(JSON.stringify(entry));
      }
    });

    next();
  });
}

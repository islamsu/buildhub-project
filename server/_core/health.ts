import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/**
 * ── Health probes (Slice 4) ────────────────────────────────────────────────
 *
 * BuildHub had no usable health endpoint. `system.health` looks like one but is
 * not: it lives under /api/trpc, requires a superjson-encoded `timestamp` input
 * to be accepted at all, and returns `{ ok: true }` without touching a single
 * dependency. A load balancer pointed at it would report a server with a dead
 * database as perfectly healthy, and would keep routing traffic to it.
 *
 * Two endpoints, because orchestrators genuinely need to distinguish two
 * questions:
 *
 *  - `/healthz` — "is this process alive?" Answers without touching the
 *    database, so a restart loop is never triggered by a database blip. This is
 *    the liveness probe.
 *
 *  - `/readyz` — "can this process serve real traffic?" Runs an actual
 *    `SELECT 1`. Returns 503 when the database is unreachable so the instance
 *    is drained from the pool rather than serving a site where every page is
 *    empty. This is the readiness probe.
 *
 * Both are deliberately unauthenticated - a probe has no credentials - so
 * neither returns anything an attacker could use: no version, no hostname, no
 * connection string, no error text from the driver. The distinction between a
 * healthy and an unhealthy instance is the status code.
 *
 *  - `/version` — "WHICH BUILD is this?" Added because a passing test suite
 *    against an unidentified deployment is not evidence of anything. Render
 *    redeploys on every push and nothing recorded which commit was live, so
 *    "the gate passed" could not be tied to a commit.
 *
 *    It returns the commit SHA and NOTHING else - no hostname, no versions of
 *    anything, no environment, no dependency list. The probes above keep their
 *    silence; identity lives here instead of being bolted onto them.
 *
 *    The SHA is not a secret: this repository is public, so the same value is
 *    already served by GitHub to anyone who asks. If BuildHub is ever made
 *    private, revisit this - the reasoning, not just the endpoint.
 */

/** Cap on the database probe, so a hung connection cannot hang the probe too. */
const DB_PROBE_TIMEOUT_MS = 2_000;

async function databaseReachable(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("database probe timed out")), DB_PROBE_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch (error) {
    // Logged for the operator, never returned to the caller: driver errors
    // carry host names and sometimes credentials.
    console.error("[health] Database probe failed:", error);
    return false;
  }
}

/**
 * The commit this image was built from.
 *
 * Render injects RENDER_GIT_COMMIT into every repo-backed service. BUILD_COMMIT
 * is the explicit override for anywhere that does not - a local `docker run`, or
 * the Vultr production target, which is not Render at all.
 *
 * "unknown" is returned rather than omitting the field or inventing a value:
 * a deployment that cannot say what it is should say so plainly, and the
 * staging gate treats "unknown" as a failure when it was told to expect a
 * specific commit.
 */
export function buildCommit(): string {
  const raw = process.env.RENDER_GIT_COMMIT ?? process.env.BUILD_COMMIT ?? "";
  const trimmed = raw.trim();
  // Only ever emit something that looks like a commit SHA. An env var holding
  // anything else is a misconfiguration, not something to echo to the internet.
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed : "unknown";
}

export function registerHealthRoutes(app: Express) {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/version", (_req: Request, res: Response) => {
    res.status(200).json({ commit: buildCommit() });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    const database = await databaseReachable();
    res.status(database ? 200 : 503).json({
      status: database ? "ready" : "unavailable",
      checks: { database },
    });
  });
}

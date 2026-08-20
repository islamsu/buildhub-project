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

export function registerHealthRoutes(app: Express) {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    const database = await databaseReachable();
    res.status(database ? 200 : 503).json({
      status: database ? "ready" : "unavailable",
      checks: { database },
    });
  });
}

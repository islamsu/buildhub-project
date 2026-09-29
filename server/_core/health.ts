import type { Express, Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * WHAT THIS BUILD IS, read once at startup.
 *
 * The owner reported changes missing from a deployed BuildHub. The code was on
 * the branch; the build in front of them did not contain it. Nothing running
 * could answer "which commit is this?", so a deployment lag looked exactly
 * like a missing feature. This is the answer, and it is release-critical for
 * that reason rather than as an operational nicety.
 *
 * THREE SOURCES, IN ORDER, and the order matters:
 *
 *   RENDER_GIT_COMMIT   injected at RUNTIME by Render into every service it
 *                       builds. Preferred because it describes the deployment
 *                       rather than the image, and Render can redeploy an
 *                       image it did not just build.
 *   BUILD_COMMIT        the explicit override, for anywhere Render is not -
 *                       a hand-built image, CI, the Vultr production target.
 *   dist/build-info.json  written at build time by scripts/build-info.mjs.
 *                       `.git` is excluded from the Docker build context, so
 *                       this file is how an image knows its own identity when
 *                       no environment variable was set.
 *
 * "unknown" is returned rather than omitting the field or inventing a value. A
 * deployment that cannot say what it is must say so plainly: the staging gate
 * treats "unknown" as a failure when it was told to expect a specific commit,
 * and every browser probe refuses to trust a build it cannot identify.
 *
 * READ ONCE. The file is read at module load, not per request, so /version
 * cannot become a disk read on a hot path - and a file that changes under a
 * running process would be describing a build that is no longer the one
 * serving.
 */
/** Only ever emit something shaped like a commit. Anything else is a
 *  misconfiguration, not something to echo to a caller. */
function asCommit(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed : null;
}

/**
 * The build stamp written beside the bundle, read ONCE.
 *
 * The file read is the only expensive part of answering "which build is
 * this?", and a file that changed under a running process would be describing
 * a build that is no longer the one serving. The ENVIRONMENT is read per call
 * instead: it costs nothing, and memoising it would make the resolution order
 * untestable without restarting the process.
 */
const BUILD_FILE: { commit: string | null; buildTime: string | null } = (() => {
  try {
    // Resolved from this module rather than from cwd, because the process is
    // started from different directories in development and in the image.
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, "build-info.json"),
      join(here, "..", "build-info.json"),
      join(here, "..", "..", "dist", "build-info.json"),
    ]) {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        commit?: string; buildTime?: string;
      };
      return {
        commit: asCommit(parsed.commit),
        buildTime: typeof parsed.buildTime === "string" ? parsed.buildTime : null,
      };
    }
  } catch {
    // A missing or malformed stamp is not worth failing startup over. It means
    // this build cannot identify itself, which is what "unknown" says, and the
    // staging gate refuses on that.
  }
  return { commit: null, buildTime: null };
})();

/**
 * The resolution rule itself, as a pure function of its three sources.
 *
 * Pulled out so the case that matters most can actually be tested: NO SOURCE
 * CAN ANSWER. That case is unreachable through `buildCommit()` in this repo,
 * because the build stamp is always present in a built tree - and a rule whose
 * most important branch cannot be exercised is a rule nobody has checked.
 *
 * A junk environment variable does not poison the answer. It is skipped, not
 * echoed and not treated as fatal, and resolution continues to the next
 * source: a misconfigured variable should not throw away a build stamp that
 * is sitting right there and is correct.
 */
export function resolveBuildCommit(
  renderEnv: string | undefined,
  buildEnv: string | undefined,
  fileCommit: string | null,
): string {
  return asCommit(renderEnv) ?? asCommit(buildEnv) ?? fileCommit ?? "unknown";
}

export function buildCommit(): string {
  return resolveBuildCommit(
    process.env.RENDER_GIT_COMMIT,
    process.env.BUILD_COMMIT,
    BUILD_FILE.commit,
  );
}

/** When the bundle was produced. Null when this build cannot say. */
export function buildTime(): string | null {
  return BUILD_FILE.buildTime;
}

/**
 * WHICH DEPLOYMENT THIS IS, as the process was told - never guessed from a
 * hostname or a database name.
 *
 * APP_ENV FIRST, AND THAT IS THE WHOLE POINT. NODE_ENV is a BUILD mode: every
 * deployed environment sets it to "production" so React, Vite and Express
 * take their optimised paths. Staging does too - render.yaml sets it. So
 * reporting NODE_ENV as the environment told the owner that STAGING WAS
 * PRODUCTION, which is the single most dangerous thing this field can say and
 * the exact ambiguity the build stamp exists to remove.
 *
 * APP_ENV names the deployment: "staging", "preview", "production". NODE_ENV
 * remains the fallback so a local `pnpm dev` still reports "development"
 * without anything configured.
 *
 * An unset value reads as "unknown" rather than being assumed to be
 * development. Assuming is how a production process ends up wearing a safe
 * label that every downstream decision then trusts.
 */
export function buildEnvironment(): string {
  const explicit = (process.env.APP_ENV ?? "").trim();
  if (explicit.length > 0) return explicit;
  const nodeEnv = (process.env.NODE_ENV ?? "").trim();
  return nodeEnv.length > 0 ? nodeEnv : "unknown";
}

export function registerHealthRoutes(app: Express) {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  /*
   * IDENTITY, NOT DIAGNOSTICS. Four facts that let a person or a probe
   * establish which build they are talking to, and nothing else: no branch,
   * no host, no versions, no configuration. `commit` stays first and keeps
   * its exact shape, because the staging gate and the migration-recovery
   * runbook already read it.
   */
  app.get("/version", (_req: Request, res: Response) => {
    const commit = buildCommit();
    res.status(200).json({
      commit,
      shortCommit: commit === "unknown" ? "unknown" : commit.slice(0, 7),
      buildTime: buildTime(),
      environment: buildEnvironment(),
    });
  });

  app.get("/readyz", async (_req: Request, res: Response) => {
    const database = await databaseReachable();
    res.status(database ? 200 : 503).json({
      status: database ? "ready" : "unavailable",
      checks: { database },
    });
  });
}

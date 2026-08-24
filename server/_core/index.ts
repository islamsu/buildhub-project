import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { runAdminBootstrap } from "../adminBootstrap";
import { ENV, assertEnvOrExit } from "./env";
import { buildCommit, registerHealthRoutes } from "./health";
import { registerRequestLogging } from "./httpLogging";
import { ConsoleMailer, resetMailer, setMailer } from "./mailer";
import { resolveMailerFromEnv } from "./smtpMailer";
import { registerSecurity } from "./security";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Resolve the port to listen on.
 *
 * Development scans for a free port, which is convenient when several sessions
 * are running. Production binds the configured port or fails: silently landing
 * on a different port leaves an orchestrator's health checks and routing
 * pointing somewhere nothing is listening, with only a console.log as warning.
 */
async function resolvePort(preferredPort: number): Promise<number> {
  if (ENV.isProduction) {
    if (await isPortAvailable(preferredPort)) return preferredPort;
    console.error(`[startup] Refusing to start: port ${preferredPort} is not available.`);
    process.exit(1);
  }

  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  return port;
}

async function startServer() {
  assertEnvOrExit();

  const app = express();
  const server = createServer(app);

  // Behind the production edge, req.protocol and req.ip must come from the
  // proxy's headers rather than the local socket - the session cookie's
  // `secure` flag and the rate limiter's IP key both depend on them. Left off
  // in development, where there is no proxy and trusting the header would let
  // any client spoof its own address.
  if (ENV.isProduction) {
    app.set("trust proxy", 1);
  }

  // Outbound email, resolved from the environment: a real SMTP sender when
  // SMTP_HOST is configured, a terminal-printing mailer in development so a
  // developer can complete a password reset by copying the link out of the log,
  // and NullMailer otherwise. On NullMailer `auth.capabilities` reports
  // password reset as unavailable and the UI hides it, rather than promising an
  // email nothing will send.
  const mail = resolveMailerFromEnv();
  if (mail.kind === "smtp") {
    setMailer(mail.mailer);
    // Prove the credentials at boot rather than the first time a locked-out
    // user asks for a reset.
    //
    // A failure is not fatal - the rest of BuildHub works fine without email,
    // and taking the whole site down over an SMTP password would turn a
    // degraded feature into an outage. But it DOES deregister the mailer, so
    // `auth.capabilities` reports password reset as unavailable and the UI
    // hides the button instead of offering one that can only fail. Found by the
    // production dry run: a deployment whose SMTP could not connect still
    // advertised reset as working.
    //
    // The cost is that a transient blip at boot disables reset until the next
    // restart. That is the right side to err on: a hidden button is a smaller
    // harm than a locked-out user being told a link is on its way.
    void mail.mailer.verify().then(
      () => console.log(`[mail] SMTP ready`),
      (error: unknown) => {
        console.error(`[mail] SMTP credentials failed to verify - password reset is DISABLED until restart:`, error);
        resetMailer();
      },
    );
  } else if (mail.kind === "console") {
    setMailer(new ConsoleMailer());
  }

  // The first administrator, from ADMIN_BOOTSTRAP_* if they are set and no
  // administrator exists yet. Idempotent, and awaited BEFORE routes are
  // registered so /admin/login is never briefly reachable on a platform whose
  // Super Admin is still being created.
  //
  // Never fatal: a bad bootstrap must degrade to "no admin account", not to a
  // boot loop that takes the whole site down. runAdminBootstrap swallows and
  // reports its own failures for exactly that reason.
  await runAdminBootstrap();

  // Order matters. Security headers and compression wrap every response
  // below, and the request log has to be installed before the routes it
  // observes. Health probes come next so a probe never waits behind a body
  // parser sizing a 50MB upload.
  registerSecurity(app);
  registerRequestLogging(app);
  // Stamped in the log at boot as well as served at /version. The log line is
  // for a human reading Render's output; the endpoint is for the staging gate,
  // which cannot read logs.
  console.log(`[build] commit ${buildCommit()}`);
  registerHealthRoutes(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = await resolvePort(parseInt(process.env.PORT || "3000"));

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(error => {
  console.error("[startup] Server failed to start:", error);
  process.exit(1);
});

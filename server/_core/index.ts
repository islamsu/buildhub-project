import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV, assertEnvOrExit } from "./env";
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

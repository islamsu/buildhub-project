import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";

// `vite` and the vite config are imported LAZILY, inside setupVite.
//
// They were static top-level imports, and esbuild bundles the server with
// --packages=external, so `import ... from "vite"` survived into dist/index.js
// and Node resolved it the instant the process started - in every environment,
// including production, where `pnpm prune --prod` has removed vite from the
// image. The container crashed on boot with ERR_MODULE_NOT_FOUND before it
// bound a port.
//
// It was invisible from the host because node_modules there still contains
// vite. Only a real pruned container shows it, which is exactly why the
// container had to be built and run rather than reasoned about.
//
// setupVite is called only when NODE_ENV=development, so deferring the import
// into the function body means production never resolves either module.
export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  // vite loads its own config from disk rather than the server bundle
  // importing it. Importing it meant esbuild inlined vite.config.ts, and its
  // top-level `import { defineConfig } from "vite"` reappeared as a static
  // import in dist/index.js - reintroducing the exact crash the lazy import
  // above was added to prevent. Letting vite resolve its own config is also
  // simply the idiomatic way to do this.
  const vite = await createViteServer({
    configFile: path.resolve(import.meta.dirname, "../../vite.config.ts"),
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

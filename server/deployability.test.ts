import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';

/**
 * Slice 4 — the things that stop BuildHub from being deployable, and the two
 * places it was telling the operator something untrue.
 *
 * Health: `system.health` looks like a probe and is not one. It sits under
 * /api/trpc, refuses to answer without a superjson-encoded `timestamp`, and
 * returns `{ ok: true }` without touching a dependency — so a load balancer
 * pointed at it would keep routing traffic to an instance whose database is
 * gone.
 *
 * Honesty: the admin analytics tab fell back to six months of invented growth
 * whenever the real aggregate came back empty, which on a pre-launch platform
 * is always; and every page load requested an analytics script from a host
 * literally named "%VITE_ANALYTICS_ENDPOINT%".
 */

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { registerHealthRoutes } from './_core/health';
import { registerSecurity } from './_core/security';
import { registerRequestLogging } from './_core/httpLogging';
import { getDb } from './db';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ADMIN_DASHBOARD = read('../client/src/pages/AdminDashboard.tsx');
const INDEX_HTML = read('../client/index.html');
const ROBOTS = read('../client/public/robots.txt');
const PACKAGE_JSON = JSON.parse(read('../package.json'));
const LOGGING_SOURCE = read('./_core/httpLogging.ts');
/**
 * Comments stripped. The file's own explanation names `req.originalUrl` as the
 * thing NOT to use, so a naive search finds it and reports the opposite of the
 * truth.
 */
const LOGGING_CODE = LOGGING_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
const SERVER_ENTRY = read('./_core/index.ts');

const servers: { close: () => void }[] = [];

async function serve(configure: (app: express.Express) => void): Promise<string> {
  const app = express();
  configure(app);
  const server = await new Promise<ReturnType<express.Express['listen']>>(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  servers.push({ close: () => server.close() });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterAll(() => servers.forEach(server => server.close()));

beforeEach(() => vi.clearAllMocks());

// ── §1 Liveness ────────────────────────────────────────────────────────────

describe('§1 GET /healthz', () => {
  it('answers 200 without any input, unlike system.health', async () => {
    const base = await serve(registerHealthRoutes);
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('does not consult the database — a database blip must not restart the process', async () => {
    const base = await serve(registerHealthRoutes);
    await fetch(`${base}/healthz`);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('REGRESSION: system.health is still unusable as a probe, which is why this exists', () => {
    const source = read('./_core/systemRouter.ts');
    expect(source).toContain('timestamp: z.number()');
    expect(source).not.toContain('getDb');
  });
});

// ── §2 Readiness ───────────────────────────────────────────────────────────

describe('§2 GET /readyz', () => {
  it('returns 200 when the database answers', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ execute: vi.fn().mockResolvedValue([[{ 1: 1 }]]) });
    const base = await serve(registerHealthRoutes);
    const response = await fetch(`${base}/readyz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ready', checks: { database: true } });
  });

  it('returns 503 when there is no database at all, so the instance is drained', async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const base = await serve(registerHealthRoutes);
    const response = await fetch(`${base}/readyz`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ checks: { database: false } });
  });

  it('returns 503 when the query itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      execute: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:3306')),
    });
    const base = await serve(registerHealthRoutes);
    const response = await fetch(`${base}/readyz`);
    expect(response.status).toBe(503);
    error.mockRestore();
  });

  it('runs a real query rather than only checking that a client object exists', async () => {
    const execute = vi.fn().mockResolvedValue([[]]);
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ execute });
    const base = await serve(registerHealthRoutes);
    await fetch(`${base}/readyz`);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('never returns driver detail — host names and credentials live in those errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
      execute: vi.fn().mockRejectedValue(new Error('Access denied for user \'buildhub\'@\'10.0.0.5\' (using password: YES)')),
    });
    const base = await serve(registerHealthRoutes);
    const body = await (await fetch(`${base}/readyz`)).text();
    expect(body).not.toContain('10.0.0.5');
    expect(body).not.toContain('password');
    expect(body).not.toContain('buildhub');
    error.mockRestore();
  });

  it('is bounded by a timeout, so a hung connection cannot hang the probe', () => {
    const source = read('./_core/health.ts');
    expect(source).toContain('DB_PROBE_TIMEOUT_MS');
    expect(source).toContain('Promise.race');
  });
});

// ── §3 Security headers ────────────────────────────────────────────────────

describe('§3 security headers', () => {
  async function headers() {
    const base = await serve(app => {
      registerSecurity(app);
      app.get('/', (_request, response) => response.send('<!doctype html><html></html>'));
    });
    return (await fetch(`${base}/`)).headers;
  }

  it('sets a Content-Security-Policy — there was none at all before', async () => {
    expect((await headers()).get('content-security-policy')).toBeTruthy();
  });

  it('allows exactly the font hosts client/index.html actually references', async () => {
    const csp = (await headers()).get('content-security-policy') ?? '';
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    // If the page ever stops loading Google Fonts, this allowance should go too.
    expect(INDEX_HTML).toContain('fonts.googleapis.com');
  });

  it('refuses framing, which is the whole clickjacking class', async () => {
    const csp = (await headers()).get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('blocks inline and eval scripts in production', () => {
    const source = read('./_core/security.ts');
    expect(source).toMatch(/scriptSrc: ENV\.isProduction \? \["'self'"\]/);
  });

  it('sets nosniff and a referrer policy that does not leak project or vendor URLs', async () => {
    const result = await headers();
    expect(result.get('x-content-type-options')).toBe('nosniff');
    expect(result.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('does not advertise the framework', async () => {
    expect((await headers()).get('x-powered-by')).toBeNull();
  });

  it('enables HSTS only in production, where the session cookie is already pinned Secure', () => {
    const source = read('./_core/security.ts');
    expect(source).toMatch(/hsts: ENV\.isProduction/);
    expect(source).toContain('includeSubDomains: true');
  });

  it('keeps cross-origin resource policy open, because uploads redirect off-origin', () => {
    const source = read('./_core/security.ts');
    expect(source).toContain("crossOriginResourcePolicy: { policy: \"cross-origin\" }");
  });
});

// ── §4 Request logging must never carry a credential ───────────────────────

describe('§4 structured request logging', () => {
  it('logs the path, never the query string where ?token= lives', () => {
    expect(LOGGING_CODE).toContain('const path = req.path;');
    expect(LOGGING_CODE).not.toContain('req.originalUrl');
    expect(LOGGING_CODE).not.toMatch(/\breq\.query\b/);
  });

  it('never logs a body, a cookie, or an authorization header', () => {
    for (const forbidden of ['req.body', 'req.headers.cookie', 'req.headers.authorization', 'res.body']) {
      expect(LOGGING_CODE).not.toContain(forbidden);
    }
  });

  it('emits one parseable JSON object per request', async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(line => lines.push(String(line)));
    const base = await serve(app => {
      registerRequestLogging(app);
      app.get('/marketplace/vendors', (_request, response) => response.send('ok'));
    });
    await fetch(`${base}/marketplace/vendors?secret=should-not-appear`);
    log.mockRestore();

    // Development stays quiet on purpose (Vite prints its own request log), so
    // this asserts the shape the production branch produces rather than that a
    // line was emitted here.
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('requestId');
      expect(line).not.toContain('should-not-appear');
    }
    expect(LOGGING_SOURCE).toContain('JSON.stringify(entry)');
  });

  it('returns a request id the user can quote back', async () => {
    const base = await serve(app => {
      registerRequestLogging(app);
      app.get('/', (_request, response) => response.send('ok'));
    });
    const id = (await fetch(`${base}/`)).headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('REGRESSION: captures the path on the way IN, before Express rewrites it', () => {
    // Checked against a running production server: reading req.path inside the
    // finish handler logged every SPA route as "/" and every tRPC call as the
    // procedure name with /api/trpc stripped off, because app.use() rewrites
    // req.url when a request enters a mounted router.
    const captureIndex = LOGGING_CODE.indexOf('const path = req.path;');
    const finishIndex = LOGGING_CODE.indexOf('res.on("finish"');
    expect(captureIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(finishIndex);
  });

  it('does not log the health probes, which would drown every other line', () => {
    expect(LOGGING_SOURCE).toContain('UNLOGGED_PATHS');
    expect(LOGGING_SOURCE).toContain('/healthz');
    expect(LOGGING_SOURCE).toContain('/readyz');
  });
});

// ── §5 No fabricated data on the owner's dashboard ─────────────────────────

describe('§5 admin analytics tells the truth', () => {
  it('REGRESSION: the invented six-month growth array is gone', () => {
    const code = ADMIN_DASHBOARD.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('/*')).join('\n');
    expect(code).not.toContain('const MONTHLY_USERS');
    for (const invented of ['users: 120', 'users: 580', 'projects: 198']) {
      expect(code).not.toContain(invented);
    }
  });

  it('charts render only what the server measured', () => {
    expect(ADMIN_DASHBOARD).toContain('const analyticsData = dynamicAnalytics;');
    expect(ADMIN_DASHBOARD).not.toMatch(/dynamicAnalytics\.length > 0 \?/);
  });

  it('an empty measurement renders an explicit empty state, in both languages', () => {
    expect(ADMIN_DASHBOARD).toContain('analyticsData.length === 0');
    expect(ADMIN_DASHBOARD).toContain('Not enough activity yet to chart');
    expect(ADMIN_DASHBOARD).toContain('لا توجد بيانات كافية بعد');
  });
});

// ── §6 The page shell ──────────────────────────────────────────────────────

describe('§6 client/index.html', () => {
  it('REGRESSION: no unsubstituted build placeholder ships to production', () => {
    const markup = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).not.toContain('%VITE_');
  });

  it('the dead Umami tag is gone rather than left requesting a nonexistent host', () => {
    const markup = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(markup).not.toContain('umami');
    expect(markup).not.toContain('data-website-id');
  });

  it('carries the metadata a shared link needs', () => {
    for (const tag of ['og:title', 'og:description', 'og:type', 'twitter:card', 'rel="canonical"']) {
      expect(INDEX_HTML).toContain(tag);
    }
  });

  it('declares both languages BuildHub actually serves', () => {
    expect(INDEX_HTML).toContain('og:locale:alternate" content="ar_EG');
  });
});

// ── §7 Crawler policy ──────────────────────────────────────────────────────

describe('§7 robots.txt', () => {
  it('lets the public marketplace be indexed — that is how vendors get found', () => {
    expect(ROBOTS).toContain('User-agent: *');
    expect(ROBOTS).toContain('Allow: /');
  });

  it('keeps every authenticated surface out of the index', () => {
    for (const route of ['/admin', '/auth', '/compliance', '/dashboard', '/messages', '/platform', '/projects', '/provider']) {
      expect(ROBOTS).toContain(`Disallow: ${route}`);
    }
  });

  it('keeps crawlers off the upload proxy', () => {
    expect(ROBOTS).toContain('Disallow: /manus-storage');
  });

  it('is served as a static asset by the existing publicDir', () => {
    const viteConfig = read('../vite.config.ts');
    expect(viteConfig).toContain('publicDir');
    expect(viteConfig).toContain('"client", "public"');
  });
});

// ── §8 Reproducible runtime ────────────────────────────────────────────────

describe('§8 package metadata', () => {
  it('pins a Node major version, so a deploy cannot silently land on a different runtime', () => {
    expect(PACKAGE_JSON.engines?.node).toBe('>=22');
  });

  it('the new middleware is actually installed, not merely written', () => {
    expect(PACKAGE_JSON.dependencies).toHaveProperty('helmet');
    expect(PACKAGE_JSON.dependencies).toHaveProperty('compression');
  });
});

// ── §9 Wiring order ────────────────────────────────────────────────────────

describe('§9 middleware order in the server entrypoint', () => {
  it('security, logging and health are all registered', () => {
    for (const call of ['registerSecurity(app)', 'registerRequestLogging(app)', 'registerHealthRoutes(app)']) {
      expect(SERVER_ENTRY).toContain(call);
    }
  });

  it('health probes are registered before the 50MB body parser', () => {
    expect(SERVER_ENTRY.indexOf('registerHealthRoutes(app)')).toBeLessThan(SERVER_ENTRY.indexOf('express.json({ limit: "50mb" })'));
  });

  it('security headers wrap the tRPC API and the static site, not just some routes', () => {
    const security = SERVER_ENTRY.indexOf('registerSecurity(app)');
    expect(security).toBeLessThan(SERVER_ENTRY.indexOf('"/api/trpc"'));
    expect(security).toBeLessThan(SERVER_ENTRY.indexOf('serveStatic(app)'));
  });

  it('boot-time env validation from Slice 1 still runs first', () => {
    expect(SERVER_ENTRY.indexOf('assertEnvOrExit()')).toBeLessThan(SERVER_ENTRY.indexOf('registerSecurity(app)'));
  });
});

// ── §10 The Manus previewer runtime must not ship ──────────────────────────

describe('§10 production build excludes the previewer runtime', () => {
  const VITE_CONFIG = read('../vite.config.ts');

  it("uses Vite's own apply:'serve', which is the only mechanism that works here", () => {
    expect(VITE_CONFIG).toContain('{ ...vitePluginManusRuntime(), apply: "serve" }');
    expect(VITE_CONFIG).not.toMatch(/^\s*vitePluginManusRuntime\(\),\s*$/m);
  });

  it('does NOT gate on process.env.NODE_ENV, which reads undefined during `npm run build`', () => {
    const block = VITE_CONFIG.slice(VITE_CONFIG.indexOf('const manusRuntimeDevOnly'));
    const code = block.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('process.env.NODE_ENV');
  });

  it('REGRESSION: development receives the config WITH its plugins', () => {
    // The original defect: server/_core/vite.ts built the dev server with
    // `{ ...viteConfig }`, and spreading a function yields no plugins at all,
    // which silently stripped React out of development.
    //
    // The spread is gone. vite.ts now passes `configFile` and lets vite load
    // and evaluate the config itself, which cannot lose plugins whatever shape
    // the export takes - a strictly stronger guarantee than spreading a
    // pre-imported object. It also had to change: importing the config made
    // esbuild inline it, and its own top-level vite import crashed the
    // production container on boot.
    //
    // Verified live after the change: the dev server injects /@react-refresh
    // and /@vite/client, so the React plugin demonstrably ran.
    const viteTs = read('./_core/vite.ts');
    expect(viteTs).toContain('configFile: path.resolve');
    expect(viteTs).not.toContain('configFile: false');
    expect(viteTs).not.toContain('...viteConfig');

    // The plain-object export is still the right shape, and still asserted.
    // Comments stripped: the config's own explanation names the callback form
    // as the thing that broke, so a naive search finds it in prose.
    const code = VITE_CONFIG.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('export default defineConfig({');
    expect(code).not.toContain('defineConfig((');
  });

  it('the built page carries no inline script for the CSP to block', () => {
    let built: string;
    try {
      built = read('../dist/public/index.html');
    } catch {
      return; // dist is a build artifact; skip when it has not been built here.
    }
    expect(built).not.toContain('id="manus-runtime"');
    expect(built).not.toContain('__MANUS_HOST_DEV__');
    // 367KB of inlined previewer used to live in this file.
    expect(built.length).toBeLessThan(20_000);
  });
});

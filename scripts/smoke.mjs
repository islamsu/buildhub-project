#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 * Runs against a deployed URL and answers one question: did this deployment
 * actually come up serving BuildHub, or did it come up serving an error page?
 *
 * Deliberately read-only and unauthenticated. It creates nothing, signs in as
 * nobody, and touches no user data - a smoke test that writes to production is
 * a smoke test nobody dares run.
 *
 *   node scripts/smoke.mjs https://staging.buildhub.eg
 *
 * Exits non-zero on the first failure so a deploy workflow can roll back.
 */

const base = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node scripts/smoke.mjs <base-url>');
  process.exit(2);
}

const TIMEOUT_MS = 15_000;
let failures = 0;

function report(ok, name, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function get(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, { signal: controller.signal, redirect: 'manual', ...options });
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, path, assert) {
  try {
    const response = await get(path);
    const detail = await assert(response);
    report(true, name, detail);
  } catch (error) {
    report(false, name, String(error?.message ?? error));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Is the process alive, and can it serve? ────────────────────────────────

await check('liveness', '/healthz', async response => {
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const body = await response.json();
  expect(body.status === 'ok', `unexpected body ${JSON.stringify(body)}`);
  return 'process up';
});

await check('readiness', '/readyz', async response => {
  const body = await response.json();
  expect(response.status === 200, `expected 200, got ${response.status} (${JSON.stringify(body)})`);
  expect(body.checks?.database === true, 'database check did not pass');
  return 'database reachable';
});

// ── Does it serve the application, not a placeholder? ──────────────────────

await check('landing page', '/', async response => {
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const html = await response.text();
  expect(html.includes('<div id="root">'), 'app root element missing');
  expect(html.includes('BuildHub'), 'page title missing');
  // Slice 4 removed both of these from production output; a deploy that brings
  // them back is a deploy of the wrong artefact.
  expect(!html.includes('%VITE_'), 'unsubstituted build placeholder in the served page');
  expect(!html.includes('id="manus-runtime"'), 'previewer runtime present in a deployed page');
  return `${html.length} bytes`;
});

await check('static assets', '/robots.txt', async response => {
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const body = await response.text();
  expect(body.includes('Disallow: /admin'), 'robots.txt is not the one in this repository');
  return 'served from the build';
});

// ── Is the API answering, and are the security headers on? ─────────────────

await check('public API', '/api/trpc/auth.capabilities', async response => {
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const body = await response.json();
  const data = body?.result?.data?.json;
  expect(data?.passwordSignIn === true, `unexpected capabilities payload ${JSON.stringify(body).slice(0, 200)}`);
  return `oauth=${data.oauthSignIn} reset=${data.passwordReset}`;
});

await check('billing catalogue', '/api/trpc/billing.plans', async response => {
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const plans = (await response.json())?.result?.data?.json?.plans;
  expect(Array.isArray(plans) && plans.length > 0, 'plan catalogue is empty');
  return `${plans.length} plans`;
});

await check('security headers', '/', async response => {
  const csp = response.headers.get('content-security-policy');
  expect(csp, 'no Content-Security-Policy');
  expect(csp.includes("script-src 'self'"), `CSP allows more than self for scripts: ${csp}`);
  expect(response.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  expect(response.headers.get('strict-transport-security'), 'HSTS missing');
  expect(!response.headers.get('x-powered-by'), 'x-powered-by is being advertised');
  return 'CSP, HSTS, nosniff present';
});

// ── Are protected surfaces still protected? ────────────────────────────────

await check('protected API refuses anonymous callers', '/api/trpc/billing.mySubscription', async response => {
  const body = await response.text();
  expect(response.status === 401 || body.includes('UNAUTHORIZED'), `expected an unauthorized response, got ${response.status}`);
  return 'refused';
});

await check('storage proxy refuses anonymous callers', '/manus-storage/registration/1/anything.pdf', async response => {
  expect(response.status === 401, `expected 401, got ${response.status}`);
  return 'refused';
});

console.log(`\n${failures === 0 ? 'smoke tests passed' : `${failures} smoke test(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

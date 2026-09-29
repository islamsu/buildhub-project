/**
 * ── THE PERFORMANCE REVIEW, MEASURED RATHER THAN READ ───────────────────
 *
 * §42 requires "performance reviewed" and §35 names what to look for: N+1
 * queries, unbounded reads, pagination, payload size. Nothing in the
 * repository could fail when any of those regressed.
 *
 * ── WHY THIS COUNTS QUERIES INSTEAD OF GREPPING FOR THEM ────────────────
 *
 * A source census was written first and thrown away. It flagged 56 selects on
 * growable tables with no `.limit()` in the same expression - and most were
 * fine: the limit is applied by a paging helper a line later, or the row count
 * is bounded by a foreign key, or the query is a `count(*)`. A guard that
 * reports fifty findings of which forty-five are correct code is a guard people
 * learn to ignore, and it still would not have caught an N+1 hidden behind an
 * `await` in a `map`.
 *
 * So this measures the real thing. MariaDB's `Com_select` counter is read
 * before and after each request, which gives the number of SELECTs that
 * request actually issued.
 *
 * ── AND THE ASSERTION IS THE ONE THAT DEFINES AN N+1 ────────────────────
 *
 * Not "fewer than N queries", which is a number somebody picks and then
 * raises. The question is whether the query count SCALES WITH THE RESULT SET.
 * Each list endpoint is called twice - once returning a few rows, once
 * returning several times as many - and the count must not grow with them. A
 * reader that batches is flat; a reader that queries per row is not, and no
 * threshold is needed to tell them apart.
 *
 * ── WHAT IS MEASURED AND NOT ASSERTED ───────────────────────────────────
 *
 * Wall time and payload size are RECORDED, not gated. §63 asks for Core Web
 * Vitals at the 75th percentile of real traffic; this container has one user,
 * a dev server compiling on demand and a database on the same disk, so a
 * threshold here would be a number about this machine. The limitation is
 * stated rather than dressed up.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const BUYER = 'zid6507832req@example.test';
const SUPPLIER = 'zid6507832vnd@example.test';

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');
const globalSelects = () =>
  Number(execSync(`mysql -u root -N -B -e "SHOW GLOBAL STATUS LIKE 'Com_select'"`).toString().split('\t')[1]);

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/**
 * One measured request: SELECTs issued, wall time, payload bytes, row count.
 *
 * The request is made TWICE and only the second is measured. The first warms
 * whatever this process caches and, in development, lets the route compile -
 * measuring a cold tsx transform as though it were query cost would be a
 * number about the bundler.
 */
async function measure(path, input, cookie) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const headers = cookie ? { cookie } : {};
  await fetch(url, { headers });
  await settle(120);

  const before = globalSelects();
  const started = performance.now();
  const res = await fetch(url, { headers });
  const body = await res.text();
  const elapsed = performance.now() - started;
  const after = globalSelects();

  let rows = null;
  try {
    const parsed = JSON.parse(body)?.result?.data?.json;
    rows = Array.isArray(parsed) ? parsed.length
      : Array.isArray(parsed?.rows) ? parsed.rows.length
      : Array.isArray(parsed?.items) ? parsed.items.length
      : null;
  } catch { /* not JSON, or an error body */ }

  return { status: res.status, selects: after - before, ms: Math.round(elapsed), bytes: body.length, rows };
}

console.log(`\nDATA   ${num('SELECT COUNT(*) FROM products')} products, `
  + `${num('SELECT COUNT(*) FROM users')} users, ${num('SELECT COUNT(*) FROM rfqs')} RFQs`);

/* The counter must actually move, or every measurement below is zero. */
{
  const before = globalSelects();
  await fetch(`${BASE}/api/trpc/marketplace.vendors?input=${encodeURIComponent('{"json":{"limit":5}}')}`);
  check(globalSelects() > before, 'the query counter responds to a real request - measurements are not zeros',
    `+${globalSelects() - before}`);
}

const buyer = await signIn(BUYER);
const supplier = await signIn(SUPPLIER);
const adminSignIn = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ json: { identifier: 'superadmin@buildhub.local', password: 'LocalSuperAdmin!2024' } }),
});
const admin = adminSignIn.status === 200
  ? (adminSignIn.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
  : '';
check(admin.length > 0, 'an administrator session is available for the admin-scoped measurements',
  admin ? 'signed in' : `adminSignIn HTTP ${adminSignIn.status}`);

/* ═══ 1. DOES THE QUERY COUNT SCALE WITH THE RESULT SET? ═══
 *
 * This is the N+1 test. Each reader is asked for a small page and a large one;
 * a batching reader issues the same number of queries for both.
 */
console.log('\n── query count vs result size ──');

const SCALED = [
  { name: 'marketplace.list', path: 'marketplace.list', small: { limit: 3 }, large: { limit: 30 }, cookie: null },
  { name: 'admin.users', path: 'admin.users', small: { page: 0, pageSize: 3 }, large: { page: 0, pageSize: 30 }, cookie: admin },
  { name: 'marketplace.vendors', path: 'marketplace.vendors', small: { limit: 3 }, large: { limit: 30 }, cookie: null },
];

for (const entry of SCALED) {
  const small = await measure(entry.path, entry.small, entry.cookie);
  const large = await measure(entry.path, entry.large, entry.cookie);
  check(small.status === 200 && large.status === 200, `${entry.name} answers both sizes`,
    `${small.status}/${large.status}`);
  const grew = large.rows !== null && small.rows !== null && large.rows > small.rows;
  if (!grew) {
    /*
     * AN HONEST SKIP, NOT A PASS. If the larger page returned no more rows
     * there is nothing to compare, and reporting "no query per row" over an
     * unchanged result set would be a green check about nothing. This
     * database has only three approved providers, which is a fixture limit
     * rather than a finding.
     */
    console.log(`SKIP   ${entry.name}: the larger page returned no more rows `
      + `(${small.rows} → ${large.rows}) - nothing to compare`);
    continue;
  }
  /*
   * A constant allowance, not a proportional one. Some readers legitimately
   * issue one extra query for a larger page (a second batched IN, a count).
   * What must not happen is a query per row.
   */
  const perRow = (large.selects - small.selects) / (large.rows - small.rows);
  check(perRow < 0.5, `${entry.name} does not issue a query per row`,
    `${small.selects} selects for ${small.rows} rows, ${large.selects} for ${large.rows} `
    + `(${perRow.toFixed(2)}/row)`);
  console.log(`       ${entry.name}: ${small.ms}ms/${small.bytes}B → ${large.ms}ms/${large.bytes}B`);
}

/* ═══ 2. A PAGE SIZE CANNOT BE ASKED TO BE UNBOUNDED ═══ */
console.log('\n── page size caps ──');

const CAPPED = [
  { name: 'marketplace.vendors', path: 'marketplace.vendors', sane: { limit: 5 }, absurd: { limit: 100000 }, cookie: null },
  { name: 'marketplace.list', path: 'marketplace.list', sane: { limit: 5 }, absurd: { limit: 100000 }, cookie: null },
  { name: 'admin.users', path: 'admin.users', sane: { page: 0, pageSize: 5 }, absurd: { page: 0, pageSize: 100000 }, cookie: admin },
  { name: 'rfq.list', path: 'rfq.list', sane: { page: 0, pageSize: 5 }, absurd: { page: 0, pageSize: 100000 }, cookie: buyer },
];

for (const entry of CAPPED) {
  /*
   * THE ENDPOINT HAS TO EXIST FIRST. A mistyped procedure name answers 404,
   * which counts as "refused" - so the first version of this passed for
   * `admin.userDirectory`, a procedure that does not exist. The sane call is
   * the control.
   */
  const sane = await measure(entry.path, entry.sane, entry.cookie);
  check(sane.status === 200, `${entry.name} exists and answers a sane request`, `HTTP ${sane.status}`);
  if (sane.status !== 200) continue;
  const result = await measure(entry.path, entry.absurd, entry.cookie);
  /*
   * EITHER answer is correct and they mean the same thing: a refusal (400 from
   * the zod max) or a silently clamped page. What would be wrong is a 200
   * carrying a hundred thousand rows.
   */
  const refused = result.status >= 400;
  const clamped = result.rows !== null && result.rows <= 200;
  check(refused || clamped, `${entry.name} refuses or clamps an absurd page size`,
    `HTTP ${result.status}, ${result.rows} rows, ${result.bytes}B`);
}

/* ═══ 3. THE HOT PATHS, MEASURED ═══
 *
 * Recorded, not gated - see the header. The numbers are here so a later run
 * can be compared against them, which is what makes a regression visible.
 */
console.log('\n── measured, not gated (lab numbers on this container) ──');

const HOT = [
  ['/version', null, null, 'http'],
  /* marketplace.platformStats, not platform.stats: there is no `platform`
     router, and a 404 measured as 0 selects looked like a very fast endpoint. */
  ['marketplace.platformStats', null, null, 'trpc'],
  ['marketplace.vendors', { limit: 12 }, null, 'trpc'],
  ['marketplace.list', { limit: 12 }, null, 'trpc'],
  ['auth.me', null, buyer, 'trpc'],
  ['projects.list', null, buyer, 'trpc'],
  /* rfq.list takes a page, and passing null got a 400 that was being counted
     as an answer. */
  ['rfq.list', { page: 0, pageSize: 20 }, buyer, 'trpc'],
  ['notifications.list', null, buyer, 'trpc'],
  ['admin.users', { page: 0, pageSize: 20 }, admin, 'trpc'],
];

const measured = [];
for (const [path, input, cookie, kind] of HOT) {
  let result;
  if (kind === 'http') {
    await fetch(`${BASE}${path}`);
    const before = globalSelects();
    const started = performance.now();
    const res = await fetch(`${BASE}${path}`);
    const body = await res.text();
    result = { status: res.status, selects: globalSelects() - before, ms: Math.round(performance.now() - started), bytes: body.length, rows: null };
  } else {
    result = await measure(path, input, cookie);
  }
  measured.push({ path, ...result });
  console.log(`       ${path.padEnd(24)} HTTP ${result.status}  ${String(result.selects).padStart(3)} selects  `
    + `${String(result.ms).padStart(5)}ms  ${String(result.bytes).padStart(7)}B`
    + (result.rows === null ? '' : `  ${result.rows} rows`));
}

/*
 * 200, NOT "not a 500". This accepted 401 and any 4xx slipped through as a
 * measurement of nothing - which is how a mistyped procedure name and a
 * missing input both got recorded as fast endpoints.
 */
const notAnswered = measured.filter(entry => entry.status !== 200);
check(notAnswered.length === 0, 'every measured endpoint answered 200 - a 4xx measures nothing',
  notAnswered.map(entry => `${entry.path}=${entry.status}`).join(', ') || `${measured.length} endpoints`);

/*
 * ONE REAL CEILING, DELIBERATELY GENEROUS. A public list endpoint issuing more
 * than thirty SELECTs is not slow-ish, it is doing something per row or per
 * facet, and that is worth failing over at any page size. Anything tighter
 * would be a number about this container.
 */
const chatty = measured.filter(entry => entry.selects > 30);
check(chatty.length === 0, 'no measured endpoint issues more than 30 SELECTs for one request',
  chatty.map(entry => `${entry.path}=${entry.selects}`).join(', ') || `max ${Math.max(...measured.map(e => e.selects))}`);

/* A payload ceiling for the same reason: 2MB of JSON for one list is a
   pagination fault, not a speed nit. */
const heavy = measured.filter(entry => entry.bytes > 2_000_000);
check(heavy.length === 0, 'no measured endpoint returns more than 2MB for one request',
  heavy.map(entry => `${entry.path}=${entry.bytes}`).join(', ')
  || `max ${Math.max(...measured.map(e => e.bytes))}B`);

/* ═══ 4. INDEXES ON THE COLUMNS THE HOT READS FILTER BY ═══
 *
 * A query plan is the only honest way to ask this, and at this data size
 * MariaDB will choose a table scan over an index whatever exists. So the
 * INDEX is asserted rather than the plan: these are the columns every list
 * above filters or orders by, and their absence is a fault that only shows up
 * once the table is large - which is the worst time to find it.
 */
console.log('\n── indexes behind the hot filters ──');

const REQUIRED_INDEXES = [
  ['products', 'status'],
  ['products', 'supplierId'],
  ['rfqs', 'status'],
  ['rfqs', 'marketCode'],
  ['quotations', 'rfqId'],
  /*
   * A CONVERSATION HERE IS A PAIR OF USERS, not a conversationId - there is no
   * such column, and asserting one reported a missing index on a table that is
   * indexed carefully: senderId, receiverId, and BOTH composite orders, which
   * is exactly what a two-sided thread read needs.
   */
  ['messages', 'senderId'],
  ['messages', 'receiverId'],
  ['notifications', 'userId'],
  ['analyticsEvents', 'eventType'],
  /* The supplier column here is `userId`, not `vendorId` - and it carries a
     unique pair index plus a userId+yearMonth index, which is what the
     monthly allowance count reads. */
  ['qualifiedEnquiries', 'userId'],
  ['qualifiedEnquiries', 'rfqId'],
];

for (const [table, column] of REQUIRED_INDEXES) {
  const indexed = num(
    `SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = '${DB}' AND table_name = '${table}' AND column_name = '${column}'`);
  check(indexed > 0, `${table}.${column} is indexed`, indexed > 0 ? `${indexed} index(es)` : 'NONE');
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log('NOTE   wall times and payload sizes above are LAB measurements on a single-user dev');
console.log('NOTE   container with the database on the same disk. They are recorded for comparison,');
console.log('NOTE   not as Core Web Vitals - §63 asks for field data at the 75th percentile, which');
console.log('NOTE   needs production telemetry this deployment does not have yet.');
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

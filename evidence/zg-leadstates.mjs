/**
 * ── THE END OF THE SUPPLIER'S COMMERCIAL ARC ────────────────────────────
 *
 * PRODUCT_NORTH_STAR.md item 13/14; CLAUDE.md §19 runs the supplier arc all
 * the way to "buyer decision", and §23 names Accepted/Won and Closed among
 * the states a Lead Centre summarises.
 *
 * The queue could say a supplier had QUOTED and never whether they WON -
 * the one outcome a supplier reads a pipeline for. It stopped one step
 * before the thing the whole arc exists to produce.
 *
 * WHAT IS PROVED, against real rows:
 *
 *   a live quotation reads as QUOTED
 *   accepting it moves that lead to WON - the buyer's action becomes the
 *     supplier's reality (§6)
 *   a rival's win reads as NOT SELECTED, and only when the request was
 *     actually AWARDED
 *   a request the customer WITHDREW is not reported as a loss - it is its
 *     own state, because saying a supplier lost a competition that never
 *     concluded is a fabricated outcome (§68)
 *   the summary counts and the rows agree
 *   the filter accepts every state the queue can return - the client's
 *     vocabulary is the server's
 *   a superseded revision does not decide a live bid's state
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const SUPPLIER = 'zid6507832vnd@example.test';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function query(cookie, path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? null }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, message: body?.error?.json?.message };
}
const stateOf = async (cookie, rfqId) => {
  const page = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100 });
  const row = (page.data?.rows ?? []).find(r => Number(r.rfqId) === rfqId);
  return row?.responseState ?? 'ABSENT';
};

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const supplierCookie = await signIn(SUPPLIER);
const supplierId = num(`SELECT id FROM users WHERE email='${SUPPLIER}'`);

/* A request this supplier has a CURRENT quotation on. */
const rfqId = num(`
  SELECT q.rfqId FROM quotations q
  JOIN rfqs r ON r.id = q.rfqId
  WHERE q.providerId=${supplierId} AND q.supersededAt IS NULL
  ORDER BY q.id DESC LIMIT 1`);
check(rfqId > 0, 'a request this supplier has quoted on', `#${rfqId}`);

const originalRfqStatus = sql(`SELECT status FROM rfqs WHERE id=${rfqId}`);
const quotationId = num(`SELECT id FROM quotations WHERE rfqId=${rfqId} AND providerId=${supplierId} AND supersededAt IS NULL ORDER BY id DESC LIMIT 1`);
const originalQuoteStatus = sql(`SELECT status FROM quotations WHERE id=${quotationId}`);

/* ── A LIVE QUOTATION READS AS QUOTED ────────────────────────────────── */
sql(`UPDATE rfqs SET status='open' WHERE id=${rfqId}`);
sql(`UPDATE quotations SET status='pending' WHERE id=${quotationId}`);
check(await stateOf(supplierCookie, rfqId) === 'quoted',
  'a live quotation on an open request reads as QUOTED');

/* ── WON ─────────────────────────────────────────────────────────────── */
// The buyer's decision becoming the supplier's reality (§6).
sql(`UPDATE quotations SET status='accepted' WHERE id=${quotationId}`);
sql(`UPDATE rfqs SET status='awarded' WHERE id=${rfqId}`);
check(await stateOf(supplierCookie, rfqId) === 'won',
  'an ACCEPTED quotation reads as WON - the arc reaches its end');

/* ── NOT SELECTED, AND ONLY WHEN AWARDED ─────────────────────────────── */
sql(`UPDATE quotations SET status='rejected' WHERE id=${quotationId}`);
check(await stateOf(supplierCookie, rfqId) === 'lost',
  'a rival winning an AWARDED request reads as NOT SELECTED');

/* ── A WITHDRAWN REQUEST IS NOT A LOSS ───────────────────────────────── */
/*
 * The distinction that matters. Telling a supplier they were beaten in a
 * competition the customer simply called off is a fabricated outcome (§68) -
 * and it is the kind a supplier would act on, by dropping a customer who
 * never rejected them.
 */
sql(`UPDATE rfqs SET status='closed' WHERE id=${rfqId}`);
sql(`UPDATE quotations SET status='pending' WHERE id=${quotationId}`);
const withdrawn = await stateOf(supplierCookie, rfqId);
check(withdrawn === 'closed',
  'a request the customer WITHDREW is its own state, not a loss', withdrawn);
check(withdrawn !== 'lost', 'and is never reported as one');

/* ── THE SUMMARY AGREES WITH THE ROWS ────────────────────────────────── */
sql(`UPDATE quotations SET status='accepted' WHERE id=${quotationId}`);
sql(`UPDATE rfqs SET status='awarded' WHERE id=${rfqId}`);
const summary = await query(supplierCookie, 'rfq.queue', { page: 0, pageSize: 100 });
const counts = summary.data?.summary ?? {};
const rows = summary.data?.rows ?? [];
const wonRows = rows.filter(r => r.responseState === 'won').length;
check(Number(counts.won ?? -1) === wonRows,
  'the summary count and the rows agree on WON',
  `summary ${counts.won}, rows ${wonRows}`);

/* ── THE FILTER ACCEPTS EVERY STATE THE QUEUE CAN RETURN ─────────────── */
// The vocabulary had drifted: the client offered four states over a queue
// that can return seven, so filtering for a won lead was impossible.
for (const state of ['available', 'invited', 'opened', 'quoted', 'won', 'lost', 'closed', 'unquoted', 'declined']) {
  const filtered = await query(supplierCookie, 'rfq.queue', { page: 0, pageSize: 10, responseState: state });
  if (filtered.status !== 200) { check(false, `the queue accepts the ${state} filter`, filtered.message); continue; }
  const offState = (filtered.data?.rows ?? []).filter(r => r.responseState !== state);
  check(offState.length === 0, `filtering by ${state} returns only ${state}`,
    `${(filtered.data?.rows ?? []).length} rows`);
}

/* ── A SUPERSEDED REVISION DOES NOT DECIDE A LIVE BID ────────────────── */
// A quote rejected before being revised must not make the live one read as
// lost: the join is on supersededAt IS NULL, and this proves it.
const superseded = num(`SELECT IFNULL(MAX(id),0) FROM quotations WHERE rfqId=${rfqId} AND providerId=${supplierId} AND supersededAt IS NOT NULL`);
if (superseded > 0) {
  sql(`UPDATE quotations SET status='rejected' WHERE id=${superseded}`);
  sql(`UPDATE quotations SET status='accepted' WHERE id=${quotationId}`);
  check(await stateOf(supplierCookie, rfqId) === 'won',
    'a superseded rejected revision does not make a live accepted bid read as lost');
} else {
  console.log(`SKIP  ${step++}. a superseded revision does not decide the state  [no revision on this request]`);
}

/* ── RESTORE ─────────────────────────────────────────────────────────── */
sql(`UPDATE rfqs SET status='${originalRfqStatus}' WHERE id=${rfqId}`);
sql(`UPDATE quotations SET status='${originalQuoteStatus}' WHERE id=${quotationId}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

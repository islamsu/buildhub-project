/**
 * ── A TERMINAL REQUEST IS NOT AN ACTIONABLE LEAD ────────────────────────
 *
 * Owner report, verbatim: "an opened/invited lead whose RFQ is subsequently
 * withdrawn or awarded must not remain displayed as Opened merely because
 * that supplier never submitted a quotation."
 *
 * THE DEFECT. Every arm of the state expression that consulted `rfqs.status`
 * also required a quotation, so a supplier who opened a lead - spending a
 * credit on it - and never bid fell through all of them to `opened` and
 * stayed there for good. The customer withdrew the request three weeks ago,
 * or awarded it to somebody else, and the pipeline still showed work waiting.
 * Worse for an invitation never touched: it sat in the OPPORTUNITY CENTRE
 * being offered as takeable, behind a button that could only ever fail.
 *
 * WHAT IS PROVED HERE, against real rows through the real query:
 *
 *   opened, no quotation, request still open   -> opened      (the control)
 *   opened, no quotation, request WITHDRAWN    -> closed
 *   opened, no quotation, request AWARDED      -> unquoted, and NOT lost
 *   invited, untouched, request WITHDRAWN/AWARDED leaves the Opportunity
 *     Centre and appears in My Leads instead
 *   a DECLINED invitation survives a later award - the supplier's own
 *     recorded decision is not rewritten
 *   and Won / Not selected / Request withdrawn remain four distinct
 *     outcomes, so the fix did not flatten the end of the funnel
 *
 * THE CONTROL MATTERS MOST. A state expression that answered `closed` for
 * everything would pass most of the checks below; the open-request case is
 * asserted first and again at the end so that "terminal" means terminal
 * rather than "always".
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

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const cookie = await signIn(SUPPLIER);
const supplierId = num(`SELECT id FROM users WHERE email='${SUPPLIER}'`);
const buyerId = num(`SELECT id FROM users WHERE email='${BUYER}'`);
check(supplierId > 0 && buyerId > 0, 'a supplier and a buyer exist', `#${supplierId} / #${buyerId}`);

/** The state THE PRODUCT reports for this row, read through the real query. */
/*
 * ABSENT IS NOT A STATE, and it must never satisfy a check.
 *
 * Every assertion here is of the form "this row says X" or "this row does
 * not say Y". A request that is not in the queue at all answers the second
 * form affirmatively for every Y, which is how a probe reports a rule
 * holding over rows that do not exist.
 */
const stateOf = async rfqId => {
  const page = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'all' });
  const row = (page.data?.rows ?? []).find(r => Number(r.rfqId) === rfqId);
  return row?.responseState ?? 'ABSENT';
};
const inScope = async (rfqId, scope) => {
  const page = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope });
  return (page.data?.rows ?? []).some(r => Number(r.rfqId) === rfqId);
};
const makeRfq = label => {
  sql(`INSERT INTO rfqs (requesterId, title, description, category, budget, currency, marketCode, location, status, createdAt, updatedAt)
       VALUES (${buyerId}, 'ZG lifecycle ${label}', 'Lifecycle probe.', 'general_contracting',
               100000.00, 'EGP', 'EG', 'Cairo', 'open', NOW(), NOW())`);
  return num(`SELECT id FROM rfqs WHERE title='ZG lifecycle ${label}' ORDER BY id DESC LIMIT 1`);
};
const setStatus = (rfqId, status) => sql(`UPDATE rfqs SET status='${status}' WHERE id=${rfqId}`);

const created = [];
try {
  /* ══ A. OPENED, NEVER QUOTED ═══════════════════════════════════════════
     The case the owner named. A credit was spent; no bid was ever made. */
  const openedRfq = makeRfq('opened');
  created.push(openedRfq);
  sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth, planAtConsumption, matchedCategory, createdAt)
       VALUES (${supplierId}, ${openedRfq}, DATE_FORMAT(UTC_DATE(), '%Y-%m'), 'probe', 'general_contracting', NOW())`);
  check(num(`SELECT COUNT(*) FROM quotations WHERE rfqId=${openedRfq} AND providerId=${supplierId}`) === 0,
    'the supplier has opened it and has NO quotation on it', `rfq #${openedRfq}`);

  /* THE CONTROL: while the request is live it IS actionable. */
  const liveState = await stateOf(openedRfq);
  check(liveState === 'opened',
    'CONTROL: while the request is open it reads OPENED, as it should', liveState);
  check(await inScope(openedRfq, 'leads'),
    'and a lead the supplier paid for is in My Leads, not the Opportunity Centre');

  /* ── opened-without-quote → WITHDRAWN ───────────────────────────────── */
  setStatus(openedRfq, 'closed');
  const withdrawn = await stateOf(openedRfq);
  check(withdrawn === 'closed',
    'WITHDRAWN: an opened-but-unquoted lead reports Request withdrawn', withdrawn);
  check(withdrawn !== 'opened',
    'and NO LONGER reports Opened over a request that cannot be answered');
  check(withdrawn !== 'lost',
    'nor Not selected - the customer withdrew it, nobody won it');

  /* ── opened-without-quote → AWARDED ─────────────────────────────────── */
  setStatus(openedRfq, 'awarded');
  const awarded = await stateOf(openedRfq);
  check(awarded === 'unquoted',
    'AWARDED: an opened-but-unquoted lead reports Did not quote', awarded);
  check(awarded !== 'opened',
    'and NO LONGER reports Opened after the request was awarded elsewhere');
  check(awarded !== 'lost',
    'AND NOT Not selected - this supplier never entered the competition (§68)');

  /* Reversible, because the state is DERIVED rather than stamped on a row. */
  setStatus(openedRfq, 'open');
  check(await stateOf(openedRfq) === 'opened',
    'reopening the request restores Opened - the state is derived, not stored');

  /* ══ B. INVITED, NEVER TOUCHED ═════════════════════════════════════════
     The worse half: this one was being OFFERED as takeable. */
  const invitedRfq = makeRfq('invited');
  created.push(invitedRfq);
  sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, invitedAt, status, createdAt)
       VALUES (${invitedRfq}, ${supplierId}, ${buyerId}, NOW(), 'invited', NOW())`);

  check(await stateOf(invitedRfq) === 'invited',
    'CONTROL: an untouched invitation on an open request reads INVITED');
  check(await inScope(invitedRfq, 'opportunities'),
    'and is offered in the Opportunity Centre, which is correct while it is open');

  setStatus(invitedRfq, 'closed');
  const invitedWithdrawn = await stateOf(invitedRfq);
  check(invitedWithdrawn === 'closed',
    'WITHDRAWN: an untouched invitation reports Request withdrawn', invitedWithdrawn);
  check(await inScope(invitedRfq, 'opportunities') === false,
    'AND LEAVES THE OPPORTUNITY CENTRE - it can no longer be taken');
  check(await inScope(invitedRfq, 'leads'),
    'appearing in My Leads instead, so it is not lost from the record');

  setStatus(invitedRfq, 'awarded');
  const invitedAwarded = await stateOf(invitedRfq);
  check(invitedAwarded === 'unquoted',
    'AWARDED: an untouched invitation reports Did not quote', invitedAwarded);
  check(await inScope(invitedRfq, 'opportunities') === false,
    'and is not offered as an opportunity either');

  /* ══ C. A DECLINED INVITATION IS THE SUPPLIER'S OWN DECISION ═══════════ */
  const declinedRfq = makeRfq('declined');
  created.push(declinedRfq);
  sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, invitedAt, status, declinedAt, createdAt)
       VALUES (${declinedRfq}, ${supplierId}, ${buyerId}, NOW(), 'declined', NOW(), NOW())`);
  setStatus(declinedRfq, 'awarded');
  const declined = await stateOf(declinedRfq);
  check(declined === 'declined',
    'a DECLINED invitation survives a later award - their own decision is not rewritten', declined);
  check(declined !== 'unquoted',
    'and is not downgraded to Did not quote, which would erase that they answered');

  /* ══ D. THE END OF THE FUNNEL IS NOT FLATTENED ═════════════════════════
     The fix must not make every concluded request look the same. */
  const quotedRfq = makeRfq('quoted');
  created.push(quotedRfq);
  /*
   * THE ENQUIRY ROW COMES FIRST, because that is the only way this state
   * arises. A supplier cannot submit a quotation without first opening the
   * enquiry or being invited, and the reachability filter says so: a
   * quotation alone does not put a request in anybody's queue.
   *
   * The probe's first version inserted the quotation on its own, and all
   * three checks below read ABSENT. Two of them failed honestly; the third -
   * "is never collapsed into Did not quote" - PASSED, because 'ABSENT' is
   * indeed not 'unquoted'. A check that a missing row can satisfy is not a
   * check, so the guard below refuses any ABSENT state outright.
   */
  sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth, planAtConsumption, matchedCategory, createdAt)
       VALUES (${supplierId}, ${quotedRfq}, DATE_FORMAT(UTC_DATE(), '%Y-%m'), 'probe', 'general_contracting', NOW())`);
  sql(`INSERT INTO quotations (rfqId, providerId, price, currency, status, revisionNumber, createdAt)
       VALUES (${quotedRfq}, ${supplierId}, 50000.00, 'EGP', 'pending', 1, NOW())`);
  check(await stateOf(quotedRfq) === 'quoted',
    'CONTROL: the quoted request reaches the supplier at all', await stateOf(quotedRfq));
  const quotationId = num(`SELECT id FROM quotations WHERE rfqId=${quotedRfq} AND providerId=${supplierId} ORDER BY id DESC LIMIT 1`);

  sql(`UPDATE quotations SET status='accepted' WHERE id=${quotationId}`);
  setStatus(quotedRfq, 'awarded');
  const won = await stateOf(quotedRfq);
  check(won === 'won', 'a WON bid still reads Won, not Did not quote', won);

  sql(`UPDATE quotations SET status='rejected' WHERE id=${quotationId}`);
  const lost = await stateOf(quotedRfq);
  check(lost === 'lost', 'a losing bid on an AWARDED request still reads Not selected', lost);
  check(lost !== 'unquoted' && lost !== 'ABSENT',
    'and is never collapsed into Did not quote - they DID quote', lost);

  sql(`UPDATE quotations SET status='pending' WHERE id=${quotationId}`);
  setStatus(quotedRfq, 'closed');
  const quotedWithdrawn = await stateOf(quotedRfq);
  check(quotedWithdrawn === 'closed',
    'and a quoted request the customer withdrew still reads Request withdrawn', quotedWithdrawn);

  /* ══ E. THE SUMMARY AND THE FILTERS AGREE WITH THE ROWS ════════════════ */
  setStatus(openedRfq, 'awarded');
  const all = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'all' });
  const rows = all.data?.rows ?? [];
  const counts = all.data?.summary ?? {};
  const unquotedRows = rows.filter(r => r.responseState === 'unquoted').length;
  check(unquotedRows > 0, 'the queue now contains Did-not-quote rows', String(unquotedRows));
  check(Number(counts.unquoted ?? -1) === unquotedRows,
    'and the summary count agrees with them', `summary ${counts.unquoted}, rows ${unquotedRows}`);

  const filtered = await query(cookie, 'rfq.queue', { page: 0, pageSize: 50, responseState: 'unquoted' });
  check(filtered.status === 200, 'the queue accepts the new state as a filter', String(filtered.message ?? ''));
  check((filtered.data?.rows ?? []).every(r => r.responseState === 'unquoted'),
    'and filtering by it returns only those rows');

  /* THE CONTROL, RESTATED. If the expression had simply started answering
     "closed" for everything, every check above would still have passed. */
  setStatus(openedRfq, 'open');
  setStatus(invitedRfq, 'open');
  check(await stateOf(openedRfq) === 'opened' && await stateOf(invitedRfq) === 'invited',
    'FINAL CONTROL: live requests are still Opened and Invited, so terminal means terminal');
  check(await inScope(invitedRfq, 'opportunities'),
    'and the reopened invitation is offered again');
} finally {
  for (const rfqId of created) {
    sql(`DELETE FROM quotations WHERE rfqId=${rfqId}`);
    sql(`DELETE FROM qualifiedEnquiries WHERE rfqId=${rfqId}`);
    sql(`DELETE FROM rfqSuppliers WHERE rfqId=${rfqId}`);
    sql(`DELETE FROM rfqs WHERE id=${rfqId}`);
  }
  const left = num(`SELECT COUNT(*) FROM rfqs WHERE title LIKE 'ZG lifecycle %'`);
  console.log(`\n(cleanup) probe requests remaining: ${left}`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

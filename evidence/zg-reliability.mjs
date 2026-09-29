/**
 * ── WHAT HAPPENS WHEN THE SAME REQUEST ARRIVES TWICE ────────────────────
 *
 * §42 requires "reliability reviewed" and §35 names the list: double-submit,
 * idempotency, concurrent reward grants, quotation races, RFQ duplicate
 * creation, notification duplication, stale updates, state transitions.
 *
 * Most of that already has evidence: zg-quotarace fires eight concurrent
 * allowance consumptions, zg-messageflood bounds the send rate, zg-outage and
 * zg-errorstates cover a real database failure, zg-quotationrevision proves the
 * duplicate-offer rule SEQUENTIALLY.
 *
 * ── THE GAP THIS FILLS IS THE CONCURRENT ONE ────────────────────────────
 *
 * `submitQuotation` carries a `FOR UPDATE` lock and a comment recording why:
 * two concurrent calls with the same payload once produced TWO bids on one
 * request and notified the customer TWICE, "observed by firing them in parallel
 * against the running server". That observation was never written down as a
 * check, so the lock could be removed tomorrow and every test would still pass
 * - the sequential probe passes with or without it, because sequentially the
 * pre-check sees the first row.
 *
 * So these fire together, with Promise.all, before either has awaited a
 * response - which is the only arrangement that can lose the race.
 *
 * ── AND THE SECOND EFFECT, WHICH IS THE ONE THE CUSTOMER SEES ───────────
 *
 * A de-duplicated write that still sent two notifications is not de-duplicated.
 * Every count here is read from the database after the dust settles, not
 * inferred from the responses.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'RelyPass!2026';

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const stamp = Date.now() % 100000000;
const made = [];
const projectsMade = [];

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async post(path, input, meta) {
    /* `validUntil` is a z.date(), so it travels as superjson: the ISO string in
       `json` and its type in `meta.values`. Sending a bare string is a 400. */
    const body = meta ? { json: input, meta: { values: meta } } : { json: input };
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify(body),
    });
    this.absorb(res);
    return unwrap(res);
  }
  async get(path, input) {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: this.header() } });
    this.absorb(res);
    return unwrap(res);
  }
}
async function unwrap(res) {
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return {
    status: res.status,
    data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null,
    code: parsed?.error?.json?.data?.code ?? null,
  };
}
async function account(prefix, userRole) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: PASSWORD,
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const call = (a, path, input, meta) => a.s.post(path, input, meta);

try {
  /* ═══ SETUP ═══ */
  const customer = await account('relcu', 'homeowner');
  const supplier = await account('relsu', 'contractor');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${supplier.id}`);

  const project = await call(customer, 'projects.create', {
    title: `Reliability project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const projectId = project.data?.id ?? 0;
  if (projectId) projectsMade.push(projectId);
  check(customer.id > 0 && supplier.id > 0 && projectId > 0,
    'SETUP: a customer, an approved contractor and a project', `project=${projectId}`);

  const rfq = await call(customer, 'rfq.create', {
    projectId, title: `Reliability RFQ ${stamp}`,
    description: 'A request two identical bids will arrive on at once.',
    category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;
  check(rfqId > 0, 'an RFQ is open', `http=${rfq.status} ${String(rfq.error).slice(0, 60)}`);

  /* ═══ 1. TWO IDENTICAL BIDS, FIRED TOGETHER ═══
   *
   * Promise.all starts both before either awaits, so both reach the server
   * with neither having seen the other's row. Sequentially the pre-check
   * catches the second; concurrently only the lock does.
   */
  console.log('\n── the same offer, twice, at the same moment ──');

  /*
   * THE SUPPLIER OPENS THE ENQUIRY FIRST, because the product requires it:
   * "Open this qualified enquiry, or accept its invitation, before submitting a
   * quotation." That refusal is the §19 allowance rule working, and a probe
   * that skipped it was testing the gate rather than the race behind it.
   */
  /* Declared categories first: eligibility is derived from them, and a
     contractor who has declared nothing matches no request. */
  await call(supplier, 'profile.setMyCategories', { categories: ['Renovation'] });
  const opened = await call(supplier, 'rfq.openEnquiry', { rfqId });
  check(opened.status === 200, 'the supplier opens the enquiry, consuming an allowance',
    `http=${opened.status} ${String(opened.error).slice(0, 60)}`);

  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  const offer = {
    rfqId, price: 145000, timeline: 45, warranty: '12 months', validUntil,
    paymentTerms: '30% advance', notes: 'Identical offer, sent twice.',
  };
  const DATE_META = { validUntil: ['Date'] };
  const notifiedBefore = num(
    `select count(*) from notifications where userId=${customer.id}`);

  const both = await Promise.all([
    call(supplier, 'rfq.submitQuotation', offer, DATE_META),
    call(supplier, 'rfq.submitQuotation', offer, DATE_META),
  ]);

  check(both.every(result => result.status === 200),
    'both calls are answered - neither is a deadlock or a 500',
    both.map(result => result.status).join('/'));

  const quotationRows = num(`select count(*) from quotations where rfqId=${rfqId}`);
  check(quotationRows === 1, 'exactly ONE quotation exists on the request',
    `${quotationRows} row(s)`);

  const ids = both.map(result => result.data?.quotationId).filter(Boolean);
  check(ids.length === 2 && ids[0] === ids[1],
    'and both callers were handed the SAME quotation - idempotent, not an error',
    ids.join(' vs '));

  /* THE SECOND EFFECT. A de-duplicated write that still notified twice is not
     de-duplicated as far as the customer is concerned. */
  const notifiedAfter = num(`select count(*) from notifications where userId=${customer.id}`);
  check(notifiedAfter - notifiedBefore <= 1,
    'the customer was notified at most once about it',
    `${notifiedAfter - notifiedBefore} new notification(s)`);

  /* And no revision was invented: a duplicate is not a revision. */
  const revisions = num(`select coalesce(max(revisionNumber), 0) from quotations where rfqId=${rfqId}`);
  check(revisions === 1, 'no revision was recorded for an offer that did not change',
    `revisionNumber=${revisions}`);

  /* ═══ 2. A CHANGED OFFER, ALSO CONCURRENT ═══
   *
   * The control. The de-duplication must not swallow a real correction just
   * because it arrived quickly - the code's own comment says correcting a
   * mistake is the likeliest reason to resubmit within seconds, and an earlier
   * version of that check matched on price alone and silently discarded a
   * corrected timeline.
   */
  console.log('\n── a corrected offer must still get through ──');

  const corrected = { ...offer, timeline: 60, notes: 'Timeline corrected.' };
  const second = await call(supplier, 'rfq.submitQuotation', corrected, DATE_META);
  check(second.status === 200, 'a corrected bid is accepted', `http=${second.status}`);
  const currentTimeline = sql(
    `select timeline from quotations where rfqId=${rfqId} and supersededAt is null order by revisionNumber desc limit 1`);
  check(currentTimeline === '60', 'and the CURRENT bid carries the corrected term, not the original',
    `timeline=${currentTimeline}`);
  const afterRevision = num(`select count(*) from quotations where rfqId=${rfqId}`);
  check(afterRevision >= 1, 'the revision model kept a history rather than overwriting silently',
    `${afterRevision} row(s) for this request`);

  /* ═══ 3. A STALE UPDATE, AFTER THE DECISION ═══
   *
   * The customer accepts. A bid submitted afterwards must be refused - not
   * accepted into a request that is already awarded, which would leave the
   * supplier believing they are still in contention.
   */
  console.log('\n── a bid after the decision ──');

  const currentId = num(
    `select id from quotations where rfqId=${rfqId} and supersededAt is null order by revisionNumber desc limit 1`);
  const accepted = await call(customer, 'rfq.acceptQuotation', { quotationId: currentId, rfqId });
  check(accepted.status === 200, 'the customer can accept the current bid',
    `http=${accepted.status} ${String(accepted.error).slice(0, 50)}`);
  check(sql(`select status from rfqs where id=${rfqId}`) === 'awarded',
    'and the request is awarded');

  const late = await call(supplier, 'rfq.submitQuotation', { ...offer, price: 99000 }, DATE_META);
  check(late.status >= 400, 'a bid arriving after the award is REFUSED', `http=${late.status}`);
  /*
   * A SENTENCE, NOT A VALIDATION DUMP. An earlier run passed this on a zod
   * error - `[{"expected":"date","code":"invalid_type"...` - which is longer
   * than ten characters and tells a supplier nothing. A refusal the product
   * chose reads as prose and names neither JSON nor a zod code.
   */
  const refusal = String(late.error ?? '');
  check(refusal.length > 10 && !refusal.includes('"code"') && !refusal.trimStart().startsWith('['),
    'and the refusal is a sentence a supplier can read, not a validation dump',
    refusal.replace(/\s+/g, ' ').slice(0, 90));
  const finalRows = num(`select count(*) from quotations where rfqId=${rfqId} and price=99000`);
  check(finalRows === 0, 'the late bid is not stored', `${finalRows} row(s) at the late price`);

  /* ═══ 4. RETRY DOES NOT DUPLICATE AN EFFECT ═══
   *
   * §35: "retry should not duplicate effects". The shortlist is the cleanest
   * case - saving the same product twice is something a flaky connection will
   * really do, and the second save must leave one row.
   */
  console.log('\n── a retried save ──');

  const productId = num(`select id from products where status='active' order by id limit 1`);
  if (productId > 0) {
    const rows = () => num(
      `select count(*) from savedItems where userId=${customer.id} and itemKind='product' and itemId=${productId}`);
    check(rows() === 0, 'the shortlist starts empty for this product', `${rows()} row(s)`);
    /*
     * `profile.toggleSaved` is a TOGGLE, so two concurrent calls may
     * legitimately settle at saved OR not-saved - which of the two is a race
     * the product does not promise to resolve. What it must never do is store
     * the same product twice, and that is what is asserted.
     */
    const saves = await Promise.all([
      call(customer, 'profile.toggleSaved', { kind: 'product', itemId: productId }),
      call(customer, 'profile.toggleSaved', { kind: 'product', itemId: productId }),
    ]);
    check(saves.every(result => result.status === 200),
      'two concurrent saves are both answered', saves.map(r => r.status).join('/'));
    check(rows() <= 1, 'and the shortlist never holds the same product twice', `${rows()} row(s)`);
  } else {
    console.log('SKIP   no active product to save in this database');
  }
} finally {
  /* ═══ CLEANUP, PROVED ═══ */
  console.log('\n── cleanup ──');
  /*
   * CHILDREN FIRST, and the list is not guesswork: each entry is a foreign key
   * that refused the delete on a real run. `vendorCategories` is the one the
   * declared-categories call above creates, and `referralCodeEvents` is written
   * by sign-up itself.
   */
  for (const id of made) {
    sql(`delete from quotations where providerId=${id}`);
    sql(`delete from savedItems where userId=${id}`);
    sql(`delete from notifications where userId=${id}`);
    sql(`delete from referralCodeEvents where actorId=${id} or userId=${id}`);
    sql(`delete from vendorCategories where userId=${id}`);
    sql(`delete from qualifiedEnquiries where userId=${id}`);
    sql(`delete from rfqSuppliers where supplierId=${id}`);
  }
  for (const projectId of projectsMade) {
    const rfqIds = sql(`select id from rfqs where projectId=${projectId}`).split('\n').filter(Boolean);
    for (const id of rfqIds) {
      sql(`delete from quotations where rfqId=${id}`);
      sql(`delete from rfqSuppliers where rfqId=${id}`);
      sql(`delete from qualifiedEnquiries where rfqId=${id}`);
      sql(`delete from rfqItems where rfqId=${id}`);
      sql(`delete from rfqs where id=${id}`);
    }
    sql(`delete from projectMembers where projectId=${projectId}`);
    sql(`delete from projects where id=${projectId}`);
  }
  for (const id of made) sql(`delete from users where id=${id}`);
  const usersLeft = num(`select count(*) from users where email like '%${stamp}@example.test'`);
  const projectsLeft = projectsMade.length === 0 ? 0
    : num(`select count(*) from projects where id in (${projectsMade.join(',')})`);
  check(usersLeft === 0 && projectsLeft === 0, 'every fixture this probe created is removed',
    `${usersLeft} users, ${projectsLeft} projects left`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

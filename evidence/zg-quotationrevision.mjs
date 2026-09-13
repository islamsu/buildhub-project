// ── LIVE: what a quotation revision actually recorded ─────────────────────
//
// QREV. The revision MODEL has worked for a long time: a later bid supersedes
// the previous version, the older row stays, and every reader filters on
// `supersededAt IS NULL`. What was never finished is the half the owner's
// backlog names - the CHANGE audit.
//
// Every field was written with `oldValue: null`, including on revision 4, so
// the trail said "price was nothing, now 145,000" where the truth was "was
// 125,000, now 145,000". That is the single question a revised bid raises.
//
// Five things a unit test cannot prove, and they are the five here:
//
//   THE TRAIL NAMES THE PREVIOUS FIGURE, read back from MySQL after two real
//     bids submitted over HTTP by a real supplier.
//
//   AN UNCHANGED FIELD PRODUCES NO ROW. `recordFieldChanges` writes only what
//     moved, so "warranty: 12 -> 12" must be absent, not present and equal.
//
//   THE PRICE IS COMPARED AS A NUMBER. The column is a decimal string and the
//     input is a number; compared raw, every revision reports a price change
//     whether or not one happened.
//
//   ONE CURRENT QUOTATION SURVIVES. The customer's comparison shows one row
//     per supplier, not a growing pile.
//
//   AND THE CUSTOMER IS NOT NOTIFIED TWICE for the same offer resubmitted.
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
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
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  async post(path, input, meta) {
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
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null, code: parsed?.error?.json?.data?.code ?? null };
}
async function account(prefix, userRole) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'QrevPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const call = (a, path, input, meta) => a.s.post(path, input, meta);
/** Field-change rows for one quotation, as field -> "old|new". */
const changes = quotationId => {
  const raw = sql(`select field, oldValue, newValue from fieldValueHistory
                   where subjectType='quotation' and subjectId=${quotationId} order by field`);
  const map = {};
  for (const line of raw.split('\n').filter(Boolean)) {
    const [field, oldValue, newValue] = line.split('\t');
    map[field] = `${oldValue}|${newValue}`;
  }
  return map;
};

try {
  const customer = await account('qrcu', 'homeowner');
  const supplier = await account('qrsu', 'contractor');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${supplier.id}`);

  const project = await call(customer, 'projects.create', {
    title: `Probe revision project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const projectId = project.data?.id ?? 0;
  if (projectId) projectsMade.push(projectId);
  check('1. SETUP: a customer, an approved contractor and a project',
    customer.id > 0 && supplier.id > 0 && projectId > 0, `project=${projectId}`);

  const rfq = await call(customer, 'rfq.create', {
    projectId, title: `Probe revision RFQ ${stamp}`,
    description: 'A request the supplier will bid on twice.',
    category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;
  check('2. an RFQ is open', rfqId > 0, `http=${rfq.status} err=${String(rfq.error).slice(0, 60)}`);

  await call(supplier, 'profile.setMyCategories', { categories: ['Renovation'] });
  const opened = await call(supplier, 'rfq.openEnquiry', { rfqId });
  check('3. the supplier opens the qualified enquiry through the real route',
    opened.status === 200, `http=${opened.status} err=${String(opened.error).slice(0, 60)}`);

  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString();

  // ── The first bid ───────────────────────────────────────────────────────
  const first = await call(supplier, 'rfq.submitQuotation', {
    rfqId, price: 125000, timeline: 30, warranty: '12 months', validUntil,
  }, { validUntil: ['Date'] });
  const firstId = first.data?.quotationId ?? 0;
  check('4. a first bid is stored', first.status === 200 && firstId > 0,
    `http=${first.status} err=${String(first.error).slice(0, 60)}`);

  const firstChanges = changes(firstId);
  check('5. A FIRST BID CONTRASTS AGAINST NULL - nothing genuinely came before it',
    firstChanges.price === 'NULL|125000', firstChanges.price);
  check('6. and its revision number is 1',
    sql(`select revisionNumber from quotations where id=${firstId}`) === '1');

  const notifiedOnce = Number(sql(
    `select count(*) from notifications where userId=${customer.id} and messageKey='notif.quotation.received'`) || 0);
  check('7. the customer was notified once', notifiedOnce === 1, `n=${notifiedOnce}`);

  // ── The same offer again: a duplicate, not a revision ────────────────────
  const duplicate = await call(supplier, 'rfq.submitQuotation', {
    rfqId, price: 125000, timeline: 30, warranty: '12 months', validUntil,
  }, { validUntil: ['Date'] });
  check('8. the SAME offer resubmitted is de-duplicated, not revised',
    duplicate.status === 200 && duplicate.data?.quotationId === firstId,
    `returned=${duplicate.data?.quotationId} first=${firstId}`);
  check('9. AND THE CUSTOMER IS NOT NOTIFIED TWICE for it',
    Number(sql(`select count(*) from notifications where userId=${customer.id} and messageKey='notif.quotation.received'`)) === 1);
  check('10. nor does it write a second change trail',
    Object.keys(changes(firstId)).length === Object.keys(firstChanges).length);

  // ── A real revision ─────────────────────────────────────────────────────
  const second = await call(supplier, 'rfq.submitQuotation', {
    rfqId, price: 145000, timeline: 45, warranty: '12 months', validUntil,
  }, { validUntil: ['Date'] });
  const secondId = second.data?.quotationId ?? 0;
  check('11. a changed bid is stored as a NEW row', second.status === 200 && secondId > 0 && secondId !== firstId,
    `id=${secondId}`);
  check('12. numbered revision 2',
    sql(`select revisionNumber from quotations where id=${secondId}`) === '2');
  check('13. and the first version is superseded, not deleted',
    sql(`select count(*) from quotations where id=${firstId} and supersededAt is not null`) === '1');

  const secondChanges = changes(secondId);
  check('14. THE TRAIL NAMES THE PREVIOUS PRICE — not "from nothing"',
    secondChanges.price === '125000|145000', String(secondChanges.price));
  check('15. and the previous timeline',
    secondChanges.timeline === '30|45', String(secondChanges.timeline));
  check('16. AN UNCHANGED FIELD PRODUCES NO ROW AT ALL',
    !('warranty' in secondChanges),
    `warranty=${secondChanges.warranty ?? 'absent'}`);
  check('17. the reason names the revision, so the trail reads without arithmetic',
    sql(`select distinct reason from fieldValueHistory where subjectType='quotation' and subjectId=${secondId}`)
      .includes('revision 2'),
    sql(`select distinct reason from fieldValueHistory where subjectType='quotation' and subjectId=${secondId}`));

  // ── A CORRECTION AT THE SAME PRICE IS STILL A REVISION ──────────────────
  //
  // This is the defect this probe found. De-duplication matched on the PRICE
  // alone, so a supplier who noticed their timeline was wrong and resubmitted
  // at the same price within the window was told `success: true` and handed
  // back the FIRST quotation. The corrected timeline was discarded and the
  // customer never saw it. Submitted immediately, inside the window, because
  // that is exactly when the old rule swallowed it.
  const third = await call(supplier, 'rfq.submitQuotation', {
    rfqId, price: 145000, timeline: 60, warranty: '12 months', validUntil,
  }, { validUntil: ['Date'] });
  const thirdId = third.data?.quotationId ?? 0;
  const thirdChanges = changes(thirdId);
  check('18. A CORRECTION AT THE SAME PRICE IS A REVISION, not a duplicate',
    thirdId !== 0 && thirdId !== secondId,
    `id=${thirdId} previous=${secondId}`);
  check('19. THE PRICE IS COMPARED AS A NUMBER: "145000.00" vs 145000 is not a change',
    !('price' in thirdChanges), `price=${thirdChanges.price ?? 'absent'}`);
  check('19b. while the field that did move is recorded',
    thirdChanges.timeline === '45|60', String(thirdChanges.timeline));
  check('19c. and it is numbered revision 3',
    sql(`select revisionNumber from quotations where id=${thirdId}`) === '3',
    sql(`select revisionNumber from quotations where id=${thirdId}`));

  // ── One current quotation ───────────────────────────────────────────────
  // A GET, because `rfq.quotations` is a QUERY. POSTing to it returned no data
  // and no error, so this check read an empty list as "no duplicates" and check
  // 22 below passed over nothing at all. The status assertion is what stops
  // that recurring: an empty comparison now fails here rather than sailing past.
  const comparison = await customer.s.get('rfq.quotations', { rfqId });
  check('20a. the customer’s comparison actually answers',
    comparison.status === 200 && Array.isArray(comparison.data) && comparison.data.length > 0,
    `http=${comparison.status} n=${(comparison.data ?? []).length} err=${String(comparison.error).slice(0, 50)}`);
  const rows = (comparison.data ?? []).filter(row => row.providerId === supplier.id);
  check('20. ONE CURRENT QUOTATION SURVIVES in the customer’s comparison',
    rows.length === 1 && rows[0].id === thirdId,
    `n=${rows.length} id=${rows[0]?.id} latest=${thirdId}`);
  check('21. and all three versions are still in the table as history',
    Number(sql(`select count(*) from quotations where rfqId=${rfqId} and providerId=${supplier.id}`)) === 3,
    sql(`select count(*) from quotations where rfqId=${rfqId} and providerId=${supplier.id}`));

  const supersededVisible = (comparison.data ?? []).some(row => row.id === firstId || row.id === secondId);
  check('22. a superseded version is NOT offered as a live bid',
    (comparison.data ?? []).length > 0 && !supersededVisible,
    `rows=${(comparison.data ?? []).length}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  // CHILDREN FOR EVERY ACCOUNT FIRST, THEN THE PARENTS. Deleting per-account
  // in one pass failed: the customer's RFQs were removed before the supplier's
  // quotations that reference them, and the foreign key refused. Ordering by
  // table rather than by user is what makes the teardown independent of which
  // account happens to be first in the list.
  for (const id of made) {
    for (const q of [
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from quotations where providerId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  for (const id of projectsMade) { try { sql(`delete from projects where id=${id}`); } catch {} }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('23. CLEANUP: every account, RFQ and quotation this probe created is gone',
    left === 0, `users=${left}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

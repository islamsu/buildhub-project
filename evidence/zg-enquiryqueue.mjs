/**
 * ── THE PROVIDER'S WORK QUEUE, AGAINST A REAL DATABASE ────────────────────
 *
 * Five things no unit test can prove, and they are the five here:
 *
 *   A PAID LEAD SURVIVES THE CUSTOMER CLOSING THE REQUEST. This is the defect
 *     that started the work, reproduced here before the assertion: open an
 *     enquiry, close the RFQ, and on the old board the row vanished while the
 *     credit stayed spent and the meter still counted it.
 *
 *   PAGING VISITS EVERY REQUEST EXACTLY ONCE, none repeated, none skipped, and
 *     the pages add up to the total the server reports.
 *
 *   A SEARCH REACHES PAST PAGE ONE. The whole point of server-side filtering:
 *     a browser filtering one page answers "nothing matches" when the match is
 *     on page two, with exactly the confidence it answers correctly.
 *
 *   THE SUMMARY AND THE FILTERS AGREE. A tile saying 3 over a filter returning
 *     5 is worse than no tile.
 *
 *   AND ANOTHER PROVIDER'S QUEUE IS THEIRS ALONE, with every refusal checked
 *     server-side rather than by hiding the page.
 */
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
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
const RFQ_COUNT = 25;   // more than one page of 20, on purpose

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
  async post(path, input) {
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify({ json: input }),
    });
    this.absorb(res); return unwrap(res);
  }
  async get(path, input) {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: this.header() } });
    this.absorb(res); return unwrap(res);
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
  const up = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'QueuePass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status} ${up.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const queueOf = (who, input = {}) => who.s.get('rfq.queue', { page: 0, pageSize: 20, ...input });

try {
  const customer = await account('qcu', 'homeowner');
  const provider = await account('qpr', 'contractor');
  const other    = await account('qot', 'contractor');
  const pending  = await account('qpe', 'contractor');   // approved for nothing
  for (const who of [provider, other]) {
    sql(`update users set onboardingStatus='approved', verified=1 where id=${who.id}`);
  }
  await provider.s.post('profile.setMyCategories', { categories: ['Renovation'] });
  await other.s.post('profile.setMyCategories', { categories: ['Renovation'] });

  const project = await customer.s.post('projects.create', {
    title: `Probe queue project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  if (project.data?.id) projectsMade.push(project.data.id);

  /**
   * THREE THROUGH THE REAL API, THE REST SEEDED.
   *
   * `rfq.create` is rate limited to three per minute, which is a control
   * working correctly and not something to route around in the product - so
   * the real path is exercised three times and the remaining fixtures are
   * inserted directly. They are scenery for the thing under test, which is the
   * QUEUE that reads them; the creation path has its own coverage elsewhere.
   */
  const rfqIds = [];
  for (let i = 0; i < 3; i++) {
    const created = await customer.s.post('rfq.create', {
      projectId: project.data?.id,
      title: `Probe queue RFQ ${stamp} number ${String(i).padStart(2, '0')}`,
      description: 'A renovation request.', category: 'Renovation', location: 'Cairo',
    });
    if (created.data?.id) rfqIds.push(created.data.id);
  }
  const throughApi = rfqIds.length;
  for (let i = 3; i < RFQ_COUNT; i++) {
    // INSERT AND READ THE ID IN ONE INVOCATION. Each `sql()` call is a separate
    // `mysql` process and therefore a separate CONNECTION, and
    // `last_insert_id()` is per connection - so asking for it in a second call
    // returns 0. Twenty-two fixtures were collected as id 0 before this was
    // found, and the assertion that every request is visited failed against a
    // product that was visiting all of them.
    const id = Number(sql(
      `insert into rfqs (requesterId, projectId, title, description, category, location, status)`
      + ` values (${customer.id}, ${project.data?.id}, 'Probe queue RFQ ${stamp} number ${String(i).padStart(2, '0')}',`
      + ` 'A renovation request.', 'Renovation', 'Cairo', 'open');`
      + ` select last_insert_id();`,
    ));
    rfqIds.push(id);
  }
  check('1a. and every seeded fixture has a real id, not a zero from a lost connection',
    rfqIds.every(id => Number.isInteger(id) && id > 0),
    `zeros=${rfqIds.filter(id => !id).length}`);
  check('1. SETUP: 25 open Renovation requests, three of them through the real API',
    throughApi === 3 && rfqIds.length === RFQ_COUNT,
    `api=${throughApi} total=${rfqIds.length}`);

  /**
   * COUNTED RELATIVE TO THIS PROBE, never against the whole database.
   *
   * The board legitimately contains any other open Renovation request that
   * exists, so an assertion of `total === 25` would be asserting that nobody
   * else has ever posted one - which is a fact about the fixture, not about
   * the queue. The first run of this probe did exactly that and reported a
   * failure the product did not have.
   */
  const mine = rows => (rows ?? []).filter(row => String(row.title).includes(String(stamp)));

  // ── THE DEFECT THAT STARTED THIS ────────────────────────────────────────
  const paidRfq = rfqIds[0];
  const opened = await provider.s.post('rfq.openEnquiry', { rfqId: paidRfq });
  check('2. the provider spends a credit on one of them',
    opened.status === 200 && Number(sql(`select count(*) from qualifiedEnquiries where userId=${provider.id}`)) === 1,
    `http=${opened.status}`);

  const closed = await customer.s.post('rfq.close', { id: paidRfq });
  check('3. and the customer then closes that request',
    closed.status === 200 && sql(`select status from rfqs where id=${paidRfq}`) === 'closed');

  // LOOKED UP BY REFERENCE, not read off page one. The paid lead is the OLDEST
  // request here and the queue is newest-first, so it sits on the last page -
  // and an assertion that only ever reads page one reports it missing from a
  // queue that contains it. Which is also exactly how a provider would find it.
  const afterClose = await queueOf(provider, { search: `#${paidRfq}` });
  const paidRow = (afterClose.data?.rows ?? []).find(row => row.rfqId === paidRfq);
  check('4. THE PAID LEAD IS STILL THERE — a receipt that vanishes is not a receipt',
    !!paidRow, `found=${!!paidRow}`);
  check('5. recorded as opened, on a closed request, and free to re-open',
    paidRow?.responseState === 'opened' && paidRow?.rfqStatus === 'closed' && paidRow?.free === true,
    `state=${paidRow?.responseState} status=${paidRow?.rfqStatus} free=${paidRow?.free}`);
  check('6. with the date the credit was spent, not just a flag',
    typeof paidRow?.openedAt === 'string' || paidRow?.openedAt instanceof Date,
    String(paidRow?.openedAt).slice(0, 24));

  const fresh0 = await queueOf(provider);
  const board = await provider.s.get('rfq.eligible');
  check('7. while the OFFER board correctly no longer offers it',
    !(board.data?.items ?? []).some(item => item.id === paidRfq)
      && typeof board.data?.total === 'number',
    `total=${board.data?.total}`);

  // ── PAGING VISITS EVERYTHING, EXACTLY ONCE ──────────────────────────────
  const firstPage = await queueOf(provider, { page: 0, pageSize: 10 });
  const total = firstPage.data?.total ?? 0;
  check('8. the server reports a REAL total, larger than one page',
    total >= RFQ_COUNT && (firstPage.data?.rows ?? []).length === 10,
    `total=${total} page=${firstPage.data?.rows?.length}`);

  const seen = [];
  for (let page = 0; page * 10 < total; page++) {
    const result = await queueOf(provider, { page, pageSize: 10 });
    for (const row of result.data?.rows ?? []) seen.push(row.rfqId);
  }
  const unique = new Set(seen);
  check('9. WALKING EVERY PAGE VISITS EVERY REQUEST EXACTLY ONCE',
    seen.length === total && unique.size === total
      && rfqIds.every(id => unique.has(id)),
    `seen=${seen.length} unique=${unique.size} total=${total}`);

  // ── A SEARCH REACHES PAST PAGE ONE ──────────────────────────────────────
  const oldest = rfqIds[0];
  const positionOfOldest = seen.indexOf(oldest);
  const byReference = await queueOf(provider, { search: `#${oldest}` });
  check('10. A SEARCH FINDS A REQUEST THAT IS NOT ON PAGE ONE',
    positionOfOldest >= 10 && byReference.data?.total === 1
      && byReference.data?.rows?.[0]?.rfqId === oldest,
    `position=${positionOfOldest} found=${byReference.data?.rows?.[0]?.rfqId}`);

  const byTitle = await queueOf(provider, { search: `${stamp} number 07` });
  check('11. and a title search matches the title, not the reference',
    byTitle.data?.total === 1 && /number 07/.test(byTitle.data?.rows?.[0]?.title ?? ''),
    `total=${byTitle.data?.total}`);

  const noMatch = await queueOf(provider, { search: `zzz-nothing-${stamp}` });
  check('12. a search with no match returns nothing, not everything',
    noMatch.data?.total === 0 && (noMatch.data?.rows ?? []).length === 0,
    `total=${noMatch.data?.total}`);

  // ── FILTERS, AND THE SUMMARY THAT MUST AGREE WITH THEM ──────────────────
  const invitedRfq = rfqIds[1];
  await customer.s.post('rfq.inviteSupplier', { rfqId: invitedRfq, supplierId: provider.id });
  const bySource = await queueOf(provider, { source: 'invitation' });
  check('13. FILTERING BY SOURCE returns exactly the invited request',
    bySource.data?.total === 1 && bySource.data?.rows?.[0]?.rfqId === invitedRfq,
    `total=${bySource.data?.total}`);

  const byState = await queueOf(provider, { responseState: 'opened' });
  const openedIds = new Set((byState.data?.rows ?? []).map(row => row.rfqId));
  check('14. FILTERING BY RESPONSE STATE returns the paid lead and the invitation',
    byState.data?.total === 2 && openedIds.has(paidRfq) && openedIds.has(invitedRfq),
    `total=${byState.data?.total}`);

  const byStatus = await queueOf(provider, { rfqStatus: 'closed' });
  check('15. FILTERING BY REQUEST STATUS finds the closed one the old board hid',
    byStatus.data?.total === 1 && byStatus.data?.rows?.[0]?.rfqId === paidRfq,
    `total=${byStatus.data?.total}`);

  const summary = fresh0.data?.summary ?? {};
  const fresh = await queueOf(provider);
  check('16. THE SUMMARY AGREES WITH THE FILTERS it claims to summarise',
    fresh.data?.summary?.opened === byState.data?.total
      && fresh.data?.summary?.total === fresh.data?.total,
    `summary.opened=${fresh.data?.summary?.opened} filter=${byState.data?.total} total=${fresh.data?.total}/${fresh.data?.summary?.total}`);
  check('17. and it counts nothing that is not real',
    Object.values(fresh.data?.summary ?? {}).every(value => Number.isInteger(value) && value >= 0)
      && (summary.quoted ?? 0) === 0,
    JSON.stringify(fresh.data?.summary));

  const categories = fresh.data?.categories ?? [];
  check('18. the category filter is offered from the data, not a restated list',
    categories.length === 1 && categories[0] === 'Renovation', categories.join(','));

  // ── ANOTHER PROVIDER'S QUEUE IS THEIRS ──────────────────────────────────
  const otherQueue = await queueOf(other);
  const otherOpened = (otherQueue.data?.rows ?? []).filter(row => row.responseState !== 'available');
  check('19. A SECOND PROVIDER SEES THE SAME BOARD but none of the first’s record',
    otherQueue.status === 200 && otherOpened.length === 0,
    `rows=${otherQueue.data?.rows?.length} nonAvailable=${otherOpened.length}`);
  check('20. and the closed request is not on their board at all',
    !(otherQueue.data?.rows ?? []).some(row => row.rfqId === paidRfq));

  // ── NEGATIVE CONTROLS ───────────────────────────────────────────────────
  const anon = new Session();
  const anonQueue = await anon.get('rfq.queue', { page: 0, pageSize: 20 });
  check('21. a signed-out caller cannot read a queue',
    anonQueue.status !== 200 && anonQueue.code === 'UNAUTHORIZED', `code=${anonQueue.code}`);
  const buyerQueue = await customer.s.get('rfq.queue', { page: 0, pageSize: 20 });
  check('22. nor a homeowner — this is a provider surface',
    buyerQueue.status !== 200 && buyerQueue.code === 'FORBIDDEN', `code=${buyerQueue.code}`);
  const pendingQueue = await pending.s.get('rfq.queue', { page: 0, pageSize: 20 });
  check('23. nor a provider whose account is not approved yet',
    pendingQueue.status !== 200 && pendingQueue.code === 'FORBIDDEN', `code=${pendingQueue.code}`);
  const oversized = await queueOf(provider, { pageSize: 5000 });
  check('24. AND A CALLER CANNOT ASK FOR EVERYTHING — the page size is bounded',
    oversized.status !== 200 || (oversized.data?.rows ?? []).length <= 100,
    `http=${oversized.status} rows=${oversized.data?.rows?.length ?? 0}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
      `delete from quotations where providerId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  try { sql(`delete from rfqs where title like 'Probe queue RFQ ${stamp}%'`); } catch {}
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  for (const id of projectsMade) { try { sql(`delete from projects where id=${id}`); } catch {} }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('25. CLEANUP: every account, request and enquiry this probe created is gone',
    left === 0, `users=${left}`);
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

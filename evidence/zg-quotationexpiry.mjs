/**
 * ── A PRICE THAT STOPPED HOLDING, AGAINST A REAL DATABASE ─────────────────
 *
 * Reproduced here before it was fixed: a quotation whose validity ended on 1
 * January was ACCEPTED in September, its status moved to `accepted`, and every
 * other bid on the request was auto-rejected around it. A supplier who writes
 * "this holds until 1 October" was bound to it in December.
 *
 *   THE ACT REFUSES IT, and refuses it as a CONFLICT rather than a crash, with
 *     a message that says what to do next.
 *
 *   NOTHING MOVES when it refuses - not the quotation, not the losing bids,
 *     not the RFQ. A refusal that half-applies is worse than one that fails.
 *
 *   EVERY READER SAYS SO: the customer's comparison, the supplier's own list,
 *     and the detail page all report it, and all three agree.
 *
 *   REJECTING ONE IS STILL ALLOWED, because clearing a stale price off the
 *     board is a reasonable thing to do.
 *
 *   AND THE DAY IS INCLUSIVE: a quotation valid until TODAY is still live.
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
      method: 'POST', headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify(body),
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
    username: u, email: `${u}@example.test`, password: 'ExpiryPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status} ${up.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}

try {
  const customer = await account('qec', 'homeowner');
  const stale    = await account('qes', 'contractor');
  const live     = await account('qel', 'contractor');
  for (const who of [stale, live]) {
    sql(`update users set onboardingStatus='approved', verified=1 where id=${who.id}`);
    await who.s.post('profile.setMyCategories', { categories: ['Renovation'] });
  }

  const project = await customer.s.post('projects.create', {
    title: `Probe expiry project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  if (project.data?.id) projectsMade.push(project.data.id);
  const rfq = await customer.s.post('rfq.create', {
    projectId: project.data?.id, title: `Probe expiry RFQ ${stamp}`,
    description: 'A renovation request.', category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;

  const inAWeek = new Date(Date.now() + 7 * 86400000);
  for (const who of [stale, live]) await who.s.post('rfq.openEnquiry', { rfqId });
  const staleBid = await stale.s.post('rfq.submitQuotation',
    { rfqId, price: 120000, timeline: 30, validUntil: inAWeek, warranty: '12 months' },
    { validUntil: ['Date'] });
  const liveBid = await live.s.post('rfq.submitQuotation',
    { rfqId, price: 145000, timeline: 45, validUntil: inAWeek, warranty: '24 months' },
    { validUntil: ['Date'] });
  const staleId = Number(sql(`select id from quotations where rfqId=${rfqId} and providerId=${stale.id}`) || 0);
  const liveId  = Number(sql(`select id from quotations where rfqId=${rfqId} and providerId=${live.id}`) || 0);
  check('1. SETUP: two live bids on one request, the cheaper one at 120,000',
    rfqId > 0 && staleId > 0 && liveId > 0 && staleBid.status === 200 && liveBid.status === 200,
    `rfq=${rfqId} stale=${staleId} live=${liveId}`);

  // ── TIME PASSES. Nothing in the product does this; the calendar does. ────
  sql(`update quotations set validUntil='2026-01-01 00:00:00' where id=${staleId}`);

  // ── THE CUSTOMER'S VIEW ─────────────────────────────────────────────────
  const comparison = await customer.s.get('rfq.quotations', { rfqId });
  const staleRow = (comparison.data ?? []).find(row => row.id === staleId);
  const liveRow  = (comparison.data ?? []).find(row => row.id === liveId);
  check('2. THE COMPARISON SAYS WHICH PRICE HAS STOPPED HOLDING',
    staleRow?.expired === true && liveRow?.expired === false,
    `stale=${staleRow?.expired} live=${liveRow?.expired}`);
  check('3. and answers the same question the ACT asks, in the same response',
    staleRow?.canAccept === false && liveRow?.canAccept === true,
    `stale=${staleRow?.canAccept} live=${liveRow?.canAccept}`);

  const detail = await customer.s.get('rfq.quotation', { id: staleId });
  check('4. THE DETAIL PAGE AGREES WITH THE LIST',
    detail.data?.expired === true && detail.data?.canAccept === false,
    `expired=${detail.data?.expired} canAccept=${detail.data?.canAccept}`);

  const supplierView = await stale.s.get('rfq.myQuotations');
  const mine = (supplierView.data ?? []).find(row => row.id === staleId);
  check('5. AND THE SUPPLIER IS TOLD TOO — they are the only one who can fix it',
    mine?.expired === true, `expired=${mine?.expired}`);

  // ── THE ACT ─────────────────────────────────────────────────────────────
  const accepted = await customer.s.post('rfq.acceptQuotation', { rfqId, quotationId: staleId });
  check('6. ACCEPTING AN EXPIRED PRICE IS REFUSED — this used to succeed',
    accepted.status !== 200 && accepted.code === 'CONFLICT', `code=${accepted.code}`);
  check('7. and the refusal says what to do about it',
    /re-confirm/i.test(String(accepted.error)), String(accepted.error).slice(0, 60));

  check('8. NOTHING MOVED — the expired bid is untouched',
    sql(`select status from quotations where id=${staleId}`) === 'pending');
  check('9. nor the other bid, which a successful accept would have auto-rejected',
    sql(`select status from quotations where id=${liveId}`) === 'pending');
  check('10. nor the request itself',
    sql(`select status from rfqs where id=${rfqId}`) === 'open');
  check('11. and nobody was told they had won',
    Number(sql(`select count(*) from notifications where userId=${stale.id} and messageKey like '%accept%'`) || 0) === 0);

  // ── WHAT STILL WORKS ────────────────────────────────────────────────────
  const rejected = await customer.s.post('rfq.rejectQuotation', { rfqId, quotationId: staleId });
  check('12. REJECTING AN EXPIRED PRICE IS STILL ALLOWED — clearing the board is reasonable',
    rejected.status === 200 && sql(`select status from quotations where id=${staleId}`) === 'rejected',
    `http=${rejected.status}`);

  const acceptedLive = await customer.s.post('rfq.acceptQuotation', { rfqId, quotationId: liveId });
  check('13. AND A LIVE PRICE IS STILL ACCEPTED — the capability is not removed from everybody',
    acceptedLive.status === 200 && sql(`select status from quotations where id=${liveId}`) === 'accepted',
    `http=${acceptedLive.status} err=${String(acceptedLive.error).slice(0, 50)}`);

  // ── THE BOUNDARY ────────────────────────────────────────────────────────
  const rfq2 = await customer.s.post('rfq.create', {
    projectId: project.data?.id, title: `Probe expiry today ${stamp}`,
    description: 'Valid until today.', category: 'Renovation', location: 'Cairo',
  });
  const rfq2Id = rfq2.data?.id ?? 0;
  await live.s.post('rfq.openEnquiry', { rfqId: rfq2Id });
  await live.s.post('rfq.submitQuotation',
    { rfqId: rfq2Id, price: 99000, timeline: 20, validUntil: new Date(), warranty: '6 months' },
    { validUntil: ['Date'] });
  const todayId = Number(sql(`select id from quotations where rfqId=${rfq2Id} and providerId=${live.id}`) || 0);
  sql(`update quotations set validUntil=curdate() where id=${todayId}`);
  const todayRow = ((await customer.s.get('rfq.quotations', { rfqId: rfq2Id })).data ?? [])[0];
  check('14. A QUOTATION VALID UNTIL TODAY IS STILL LIVE — the day is inclusive',
    todayRow?.expired === false && todayRow?.canAccept === true,
    `expired=${todayRow?.expired}`);
  const acceptToday = await customer.s.post('rfq.acceptQuotation', { rfqId: rfq2Id, quotationId: todayId });
  check('15. and the ACT agrees with that too, which is the whole point',
    acceptToday.status === 200, `http=${acceptToday.status} err=${String(acceptToday.error).slice(0, 50)}`);

  // ── NEGATIVE CONTROLS ───────────────────────────────────────────────────
  const byStranger = await stale.s.post('rfq.acceptQuotation', { rfqId, quotationId: liveId });
  check('16. a supplier cannot accept a bid on somebody else’s request',
    byStranger.status !== 200, `code=${byStranger.code}`);
  const anon = new Session();
  const anonRead = await anon.get('rfq.quotations', { rfqId });
  check('17. and a signed-out caller reads no prices at all',
    anonRead.status !== 200 && anonRead.code === 'UNAUTHORIZED', `code=${anonRead.code}`);

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
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  for (const id of projectsMade) { try { sql(`delete from projects where id=${id}`); } catch {} }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('18. CLEANUP: every account, request and quotation this probe created is gone',
    left === 0, `users=${left}`);
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

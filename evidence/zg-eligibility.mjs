// ── LIVE: the offer matches what the server would grant ───────────────────
//
// ELIG. Reported from real use on staging: a provider was shown an enabled
// "Open qualified enquiry" button, clicked it, and was told the request does
// not match any of their declared service categories.
//
// THE REFUSAL WAS CORRECT. OFFERING THE ACTION WAS NOT.
//
// Five things a unit test cannot prove, and they are the five here:
//
//   THE PREVIEW AND THE ACT AGREE, on real data, for every case that matters -
//     a matching category, a mismatched one, an invitation, a spent allowance.
//     If the preview says no and the act would have said yes, a provider loses
//     work they were entitled to.
//
//   AND THE PREVIEW COSTS NOTHING. Called on render, so if it spent a credit
//     or marked an invitation viewed, looking at a page would cost money.
//     Proven by reading the usage meter before and after.
//
//   AN INVITATION OUTRANKS THE CATEGORY GATE, which is the case most likely to
//     be broken by a preview written as a separate rule.
//
//   THE BUTTON IS STILL THERE for the people who can use it.
//
//   AND THE REASON IS A KEY, so the Arabic screen is not handed English.
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
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'EligPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const usageOf = async who => (await who.s.get('rfq.eligible')).data?.usage?.used ?? null;

try {
  const customer = await account('elcu', 'homeowner');
  const matching = await account('elma', 'contractor');   // declares Renovation
  const mismatch = await account('elmi', 'contractor');   // declares Design
  const invited  = await account('elin', 'contractor');   // declares Design, but invited
  for (const who of [matching, mismatch, invited]) {
    sql(`update users set onboardingStatus='approved', verified=1 where id=${who.id}`);
  }
  await matching.s.post('profile.setMyCategories', { categories: ['Renovation'] });
  await mismatch.s.post('profile.setMyCategories', { categories: ['Design'] });
  await invited.s.post('profile.setMyCategories', { categories: ['Design'] });
  check('1. SETUP: three approved providers with declared categories',
    matching.id > 0 && mismatch.id > 0 && invited.id > 0);

  const project = await customer.s.post('projects.create', {
    title: `Probe eligibility project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  if (project.data?.id) projectsMade.push(project.data.id);
  const rfq = await customer.s.post('rfq.create', {
    projectId: project.data?.id, title: `Probe eligibility RFQ ${stamp}`,
    description: 'A renovation request.', category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;
  check('2. an open Renovation request exists', rfqId > 0, `http=${rfq.status}`);

  // ── The preview agrees with the act ─────────────────────────────────────
  const mismatchAccess = await mismatch.s.get('rfq.responseAccess', { rfqId });
  check('3. THE MISMATCHED PROVIDER IS NOT OFFERED THE ACTION',
    mismatchAccess.status === 200 && mismatchAccess.data?.canOpen === false
      && mismatchAccess.data?.openBlockedReason === 'category_mismatch',
    `canOpen=${mismatchAccess.data?.canOpen} reason=${mismatchAccess.data?.openBlockedReason}`);

  const mismatchAct = await mismatch.s.post('rfq.openEnquiry', { rfqId });
  check('4. AND THE ACT AGREES — it would have refused, exactly as previewed',
    mismatchAct.status !== 200 && mismatchAct.code === 'FORBIDDEN'
      && /declared service categories/.test(String(mismatchAct.error)),
    `code=${mismatchAct.code}`);

  const matchingAccess = await matching.s.get('rfq.responseAccess', { rfqId });
  check('5. THE MATCHING PROVIDER IS OFFERED IT, and told it costs a credit',
    matchingAccess.data?.canOpen === true && matchingAccess.data?.openBlockedReason === null
      && matchingAccess.data?.openIsFree === false,
    `canOpen=${matchingAccess.data?.canOpen} free=${matchingAccess.data?.openIsFree}`);

  // ── The preview costs nothing ───────────────────────────────────────────
  const before = await usageOf(matching);
  for (let i = 0; i < 5; i++) await matching.s.get('rfq.responseAccess', { rfqId });
  const after = await usageOf(matching);
  check('6. THE PREVIEW COSTS NOTHING — five renders, no credit spent',
    before === after && before === 0, `before=${before} after=${after}`);

  const matchingAct = await matching.s.post('rfq.openEnquiry', { rfqId });
  check('7. and the act, when taken, IS granted as previewed',
    matchingAct.status === 200, `http=${matchingAct.status} err=${String(matchingAct.error).slice(0, 60)}`);
  check('8. spending exactly one credit', (await usageOf(matching)) === 1);

  // The SAME contradiction class as check 11, for the other way of already
  // having access: the preview must keep answering truthfully for somebody who
  // can already respond, not go quiet and report a refusal opening would not
  // produce.
  const reopened = await matching.s.get('rfq.responseAccess', { rfqId });
  check('9. A LEAD ALREADY PAID FOR reads as access, and re-opening is free',
    reopened.data?.canRespond === true && reopened.data?.canOpen === true
      && reopened.data?.openIsFree === true && reopened.data?.openBlockedReason === null,
    `canRespond=${reopened.data?.canRespond} canOpen=${reopened.data?.canOpen} free=${reopened.data?.openIsFree}`);

  // ── An invitation outranks the category gate ────────────────────────────
  const invite = await customer.s.post('rfq.inviteSupplier', { rfqId, supplierId: invited.id });
  check('10. the customer invites a provider whose category does NOT match',
    invite.status === 200, `http=${invite.status} err=${String(invite.error).slice(0, 60)}`);

  const invitedAccess = await invited.s.get('rfq.responseAccess', { rfqId });
  check('11. AN INVITATION OUTRANKS THE CATEGORY GATE — offered, and free',
    invitedAccess.data?.canOpen === true && invitedAccess.data?.openIsFree === true
      && invitedAccess.data?.openBlockedReason === null,
    `canOpen=${invitedAccess.data?.canOpen} free=${invitedAccess.data?.openIsFree}`);

  const invitedUsageBefore = await usageOf(invited);
  const invitedAct = await invited.s.post('rfq.openEnquiry', { rfqId });
  check('12. and the act agrees — granted despite the mismatch',
    invitedAct.status === 200, `http=${invitedAct.status} err=${String(invitedAct.error).slice(0, 60)}`);
  check('13. with no credit spent, as the preview promised',
    (await usageOf(invited)) === invitedUsageBefore, `used=${await usageOf(invited)}`);

  // ── A closed request is not offered ─────────────────────────────────────
  const closedRfq = await customer.s.post('rfq.create', {
    projectId: project.data?.id, title: `Probe closed RFQ ${stamp}`,
    description: 'Will be closed.', category: 'Renovation', location: 'Cairo',
  });
  const closedId = closedRfq.data?.id ?? 0;
  sql(`update rfqs set status='closed' where id=${closedId}`);
  const closedAccess = await matching.s.get('rfq.responseAccess', { rfqId: closedId });
  check('14. A CLOSED REQUEST IS NOT OFFERED — a credit on it would buy nothing',
    closedAccess.data?.canOpen === false && closedAccess.data?.openBlockedReason === 'rfq_closed',
    `canOpen=${closedAccess.data?.canOpen} reason=${closedAccess.data?.openBlockedReason}`);

  // ── The reason is a key, not a sentence ─────────────────────────────────
  const reasons = [mismatchAccess.data?.openBlockedReason, closedAccess.data?.openBlockedReason];
  check('15. EVERY REASON IS A KEY, so the Arabic screen is not handed English',
    reasons.every(reason => typeof reason === 'string' && /^[a-z_]+$/.test(reason)),
    reasons.join(','));

  // ── Negative controls ───────────────────────────────────────────────────
  const anon = new Session();
  const anonAccess = await anon.get('rfq.responseAccess', { rfqId });
  check('16. a signed-out caller cannot ask',
    anonAccess.status !== 200 && anonAccess.code === 'UNAUTHORIZED', `code=${anonAccess.code}`);
  const buyerAccess = await customer.s.get('rfq.responseAccess', { rfqId });
  check('17. nor a homeowner — this is a provider surface',
    buyerAccess.status !== 200 && buyerAccess.code === 'FORBIDDEN', `code=${buyerAccess.code}`);

  const missing = await matching.s.get('rfq.responseAccess', { rfqId: 99999999 });
  check('18. and a request that does not exist is NOT_FOUND, not a preview',
    missing.status !== 200 && missing.code === 'NOT_FOUND', `code=${missing.code}`);

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
  check('19. CLEANUP: every account, request and enquiry this probe created is gone',
    left === 0, `users=${left}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

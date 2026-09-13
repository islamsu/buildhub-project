// ── LIVE: reviews — right of reply, reporting, moderation ──────────────────
//
// REV. The unit suite pins the three service functions against doubles and the
// census pins one definition of "a publicly visible review". Five things it
// structurally cannot prove, and they are the five this probe exists for:
//
//   HIDING REALLY LEAVES THE AVERAGE. `visibleReviewFilter()` being correct is
//     a claim about a function. That `reviews.statsForUser` returns a smaller
//     count and a different average after a moderator hides a row is a claim
//     about SQL against a real database, and it is the claim the whole design
//     rests on - a hidden review that still counts is a remedy in appearance.
//
//   THE THIRD READER. `rfq.quotationsForComparison` aggregates ratings through
//     its own query. A hidden review must disappear from the homeowner's quote
//     comparison too, or the same vendor carries two different scores on two
//     screens.
//
//   THE DOOR, OVER HTTP. A stranger answering somebody else's review must get
//     the same answer as somebody answering a review that does not exist.
//
//   THE ADMIN BOUNDARY. Every moderation procedure must refuse an ordinary
//     account, whatever the client renders.
//
//   THE AUDIT. Hiding names BOTH parties - the provider whose score changed
//     and the reviewer whose words were removed. An audit naming one of them
//     answers half the question later.
//
// The review itself is written by `reviews.submit` over HTTP, so a row exists
// only because the product put it there. The project's completion is set in
// the database because BuildHub has no self-service "mark completed" path a
// probe can drive; that is stated rather than dressed up as a product step.
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
  constructor(label) { this.label = label; this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  // `meta` is superjson's type sidecar. A `z.date()` input cannot be sent as a
  // bare string - the router would reject it - so a caller passes
  // { validUntil: ['Date'] } and the value goes over the wire as ISO.
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
  return {
    status: res.status,
    data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null,
  };
}

async function account(prefix, userRole) {
  const s = new Session(prefix);
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'ReviewPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp failed for ${prefix}: http=${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session for ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id, name: u };
}

const call = (a, path, input, meta) => a.s.post(path, input, meta);
const query = (a, path, input) => a.s.get(path, input);

let reviewId = 0;
let secondReviewId = 0;
let reportId = 0;

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const owner    = await account('rvow', 'homeowner');   // writes the review
  const provider = await account('rvpr', 'contractor');  // the review is about them
  const stranger = await account('rvst', 'homeowner');   // neither party
  const admin    = await account('rvad', 'homeowner');
  sql(`update users set role='admin', adminRole='SUPPORT_ADMIN' where id=${admin.id}`);
  check('SETUP: a support administrator exists',
    sql(`select adminRole from users where id=${admin.id}`) === 'SUPPORT_ADMIN');

  const project = await call(owner, 'projects.create', {
    title: `Probe review project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const projectId = project.data?.id ?? project.data?.projectId ?? 0;
  if (!projectId) throw new Error(`project not created: ${project.status} ${project.error}`);
  projectsMade.push(projectId);
  // NO PRODUCT PATH for completion that a probe can drive; stated, not dressed up.
  sql(`update projects set status='completed' where id=${projectId}`);

  // ── 1-3. A real review, written by the product ──────────────────────────
  const submitted = await call(owner, 'reviews.submit', {
    projectId, revieweeId: provider.id, rating: 2, comment: `Probe review ${stamp}: slow to finish.`,
  });
  reviewId = Number(sql(`select id from reviews where revieweeId=${provider.id} and reviewerId=${owner.id}`) || 0);
  check('1. the owner of a completed project may review the provider',
    submitted.status === 200 && reviewId > 0, `http=${submitted.status} id=${reviewId} err=${String(submitted.error).slice(0, 60)}`);

  const stats0 = await query(stranger, 'reviews.statsForUser', { userId: provider.id });
  check('2. it counts toward the public average immediately',
    stats0.data?.reviewCount === 1 && stats0.data?.averageRating === 2,
    `count=${stats0.data?.reviewCount} avg=${stats0.data?.averageRating}`);

  const public0 = await query(stranger, 'reviews.forUser', { userId: provider.id });
  check('3. and it is readable on the provider’s public page',
    (public0.data ?? []).some(r => r.id === reviewId), `count=${(public0.data ?? []).length}`);

  // ── 4-8. The right of reply ─────────────────────────────────────────────
  const strangerReply = await call(stranger, 'reviews.respond', { reviewId, body: 'On behalf of the vendor' });
  check('4. NEGATIVE: a stranger cannot answer somebody else’s review',
    strangerReply.status !== 200, `http=${strangerReply.status} err=${String(strangerReply.error).slice(0, 40)}`);

  const ownerReply = await call(owner, 'reviews.respond', { reviewId, body: 'Actually I meant five stars' });
  check('5. NEGATIVE: the REVIEWER cannot answer their own review either',
    ownerReply.status !== 200, `http=${ownerReply.status}`);

  const ghost = await call(provider, 'reviews.respond', { reviewId: 99999999, body: 'x' });
  check('6. a review that does not exist and a review you may not touch answer the SAME way',
    ghost.error === strangerReply.error, `ghost=${String(ghost.error).slice(0, 30)} denied=${String(strangerReply.error).slice(0, 30)}`);

  const reply1 = await call(provider, 'reviews.respond', { reviewId, body: 'We returned and finished the snagging.' });
  check('7. the provider the review is ABOUT may answer it', reply1.status === 200,
    `http=${reply1.status} err=${String(reply1.error).slice(0, 60)}`);

  await call(provider, 'reviews.respond', { reviewId, body: 'Corrected reply.' });
  const replyRows = sql(`select count(*) from reviewResponses where reviewId=${reviewId}`);
  const replyBody = sql(`select body from reviewResponses where reviewId=${reviewId}`);
  check('8. a second reply EDITS the first rather than starting a thread',
    replyRows === '1' && replyBody === 'Corrected reply.', `rows=${replyRows} body=${replyBody}`);

  const withReply = await query(stranger, 'reviews.forUser', { userId: provider.id });
  check('9. the reply is published under the review it answers',
    withReply.data?.find(r => r.id === reviewId)?.responseBody === 'Corrected reply.');

  // ── 10-13. Reporting ────────────────────────────────────────────────────
  const selfReport = await call(owner, 'reviews.report', { reviewId, reason: 'abusive' });
  check('10. NEGATIVE: the reviewer cannot report their own review', selfReport.status !== 200,
    `http=${selfReport.status}`);

  const reported = await call(provider, 'reviews.report', { reviewId, reason: 'not_a_customer', detail: `probe ${stamp}` });
  reportId = Number(sql(`select id from reviewReports where reviewId=${reviewId}`) || 0);
  check('11. the provider may report a review about them', reported.status === 200 && reportId > 0,
    `http=${reported.status} id=${reportId} err=${String(reported.error).slice(0, 60)}`);

  check('12. a report opens as OPEN - nothing is decided by the act of reporting',
    sql(`select status from reviewReports where id=${reportId}`) === 'open');

  const again = await call(provider, 'reviews.report', { reviewId, reason: 'spam' });
  check('13. REPEAT-REPORTING IS NOT A LOUDER VOTE - the second is refused', again.status !== 200,
    `http=${again.status} rows=${sql(`select count(*) from reviewReports where reviewId=${reviewId}`)}`);

  // ── 14-17. The admin boundary ───────────────────────────────────────────
  for (const [name, path, input] of [
    ['admin.reviewReports', 'admin.reviewReports', undefined],
    ['admin.moderateReview', 'admin.moderateReview', { reviewId, action: 'hide', reason: 'because I said so' }],
    ['admin.resolveReviewReport', 'admin.resolveReviewReport', { reportId, status: 'upheld' }],
  ]) {
    const asUser = input === undefined
      ? await query(stranger, path)
      : await call(stranger, path, input);
    check(`14-16. NEGATIVE: ${name} refuses an ordinary account`, asUser.status !== 200,
      `http=${asUser.status}`);
  }
  check('17. and none of those attempts changed anything',
    sql(`select count(*) from reviews where id=${reviewId} and hiddenAt is not null`) === '0'
    && sql(`select status from reviewReports where id=${reportId}`) === 'open');

  // ── 18-20. Moderation, and the rule the design rests on ─────────────────
  const noReason = await call(admin, 'admin.moderateReview', { reviewId, action: 'hide' });
  check('18. HIDING WITHOUT A REASON IS REFUSED', noReason.status !== 200,
    `http=${noReason.status} err=${String(noReason.error).slice(0, 60)}`);

  const hidden = await call(admin, 'admin.moderateReview', {
    reviewId, action: 'hide', reason: 'Names a third party by phone number.',
  });
  check('19. a support administrator may hide it, with the reason recorded',
    hidden.status === 200 && sql(`select hiddenReason from reviews where id=${reviewId}`) === 'Names a third party by phone number.',
    `http=${hidden.status}`);

  check('20. WHO hid it is recorded alongside WHY',
    sql(`select hiddenBy from reviews where id=${reviewId}`) === String(admin.id));

  const stats1 = await query(stranger, 'reviews.statsForUser', { userId: provider.id });
  check('21. A HIDDEN REVIEW LEAVES THE AVERAGE - the count and the average both move',
    stats1.data?.reviewCount === 0 && stats1.data?.averageRating === null,
    `count=${stats1.data?.reviewCount} avg=${stats1.data?.averageRating}`);

  const public1 = await query(stranger, 'reviews.forUser', { userId: provider.id });
  check('22. and it is gone from the public page',
    !(public1.data ?? []).some(r => r.id === reviewId), `count=${(public1.data ?? []).length}`);

  check('23. HIDDEN, NEVER DELETED - the row and its words survive for the record',
    sql(`select count(*) from reviews where id=${reviewId}`) === '1'
    && sql(`select comment from reviews where id=${reviewId}`).includes(`Probe review ${stamp}`));

  const replyWhileHidden = await call(provider, 'reviews.respond', { reviewId, body: 'no' });
  check('24. a hidden review cannot be answered while it is being looked at',
    replyWhileHidden.status !== 200, `http=${replyWhileHidden.status}`);

  // ── 25. BOTH PARTIES are in the audit ───────────────────────────────────
  const audited = sql(`select userId from userAccountAuditEvents where action='review_hidden' order by userId`).split('\n').filter(Boolean);
  check('25. hiding names BOTH the provider whose score changed and the reviewer whose words were removed',
    audited.includes(String(provider.id)) && audited.includes(String(owner.id)),
    `userIds=${audited.join(',')}`);

  // ── 26-28. The queue, and the two separate decisions ────────────────────
  const queue = await query(admin, 'admin.reviewReports', { page: 0, pageSize: 20 });
  const row = (queue.data?.rows ?? []).find(r => r.id === reportId);
  check('26. the report is in the moderation queue, with the review’s own words',
    !!row && row.comment?.includes(`Probe review ${stamp}`), `total=${queue.data?.total}`);
  check('27. and the queue shows that the review is already hidden', row?.reviewHidden === true);

  const upheld = await call(admin, 'admin.resolveReviewReport', { reportId, status: 'upheld', note: 'agreed' });
  check('28. a report can be upheld', upheld.status === 200 && sql(`select status from reviewReports where id=${reportId}`) === 'upheld',
    `http=${upheld.status}`);

  const twice = await call(admin, 'admin.resolveReviewReport', { reportId, status: 'rejected' });
  check('29. A REPORT IS DECIDED ONCE - a second resolution is refused', twice.status !== 200,
    `http=${twice.status} status=${sql(`select status from reviewReports where id=${reportId}`)}`);

  // ── 30-31. Restoring ────────────────────────────────────────────────────
  const restored = await call(admin, 'admin.moderateReview', { reviewId, action: 'restore' });
  const stampsCleared = sql(`select concat(coalesce(hiddenAt,'-'),'|',coalesce(hiddenBy,'-'),'|',coalesce(hiddenReason,'-')) from reviews where id=${reviewId}`);
  check('30. restoring CLEARS the stamp rather than leaving fields that can disagree',
    restored.status === 200 && stampsCleared === '-|-|-', `stamps=${stampsCleared}`);

  const stats2 = await query(stranger, 'reviews.statsForUser', { userId: provider.id });
  check('31. and the review returns to the average it left',
    stats2.data?.reviewCount === 1 && stats2.data?.averageRating === 2,
    `count=${stats2.data?.reviewCount} avg=${stats2.data?.averageRating}`);

  // ── 32-35. THE THIRD READER: quote comparison ───────────────────────────
  // A hidden review must vanish from the homeowner's quote comparison too, or
  // the same vendor carries two different scores on two screens. This reader
  // had its own inline `eq(reviews.verified, true)` until this milestone, so a
  // hidden review would have gone on counting here. A census over source
  // cannot prove the SQL; this can.
  //
  // The check is written so it CANNOT pass vacuously: it asserts the
  // reputation is PRESENT before hiding and ABSENT after. An empty result
  // both times would fail check 33, not sail past it.
  const rfq = await call(owner, 'rfq.create', {
    projectId, title: `Probe RFQ ${stamp}`,
    description: 'Probe request for the quote-comparison reputation reader.',
    category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;
  check('32. an RFQ exists on the project to compare quotes on', rfqId > 0,
    `http=${rfq.status} err=${String(rfq.error).slice(0, 80)}`);

  // Compliance approval has a real admin path; it is set here directly for the
  // same reason project completion was - it is setup for this probe's subject,
  // not the subject itself, and pretending otherwise would be theatre.
  sql(`update users set onboardingStatus='approved' where id=${provider.id}`);

  // The rest of the path is the product's own: declare the matching service
  // category, open the qualified enquiry, then bid. The 403 this replaced
  // ("Open this qualified enquiry ... before submitting a quotation") is the
  // guard working, so the probe walks the real route rather than around it.
  const declared = await call(provider, 'profile.setMyCategories', { categories: ['Renovation'] });
  const opened = await call(provider, 'rfq.openEnquiry', { rfqId });
  check('33a. the provider declares the matching category and opens the enquiry',
    declared.status === 200 && opened.status === 200,
    `declare=${declared.status} open=${opened.status} err=${String(opened.error).slice(0, 70)}`);

  const bid = await call(provider, 'rfq.submitQuotation', {
    rfqId, price: 125000, timeline: 30,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
  }, { validUntil: ['Date'] });
  check('33b. the reviewed provider has a live quotation on it', bid.status === 200,
    `http=${bid.status} err=${String(bid.error).slice(0, 80)}`);

  const before = await query(owner, 'rfq.quotations', { rfqId });
  const beforeRow = (before.data ?? []).find(r => r.providerId === provider.id);
  check('34. the quote comparison shows the provider’s reputation while the review stands',
    beforeRow?.providerReviews === 1 && beforeRow?.providerRating === 2,
    `count=${beforeRow?.providerReviews} avg=${beforeRow?.providerRating} rows=${(before.data ?? []).length}`);

  await call(admin, 'admin.moderateReview', { reviewId, action: 'hide', reason: 'probe: second hide' });
  const after = await query(owner, 'rfq.quotations', { rfqId });
  const afterRow = (after.data ?? []).find(r => r.providerId === provider.id);
  check('35. HIDING REMOVES IT HERE TOO - one score for a vendor, not two',
    !!afterRow && afterRow.providerReviews === 0 && afterRow.providerRating === null,
    `count=${afterRow?.providerReviews} avg=${afterRow?.providerRating}`);
  await call(admin, 'admin.moderateReview', { reviewId, action: 'restore' });

  // ── 36. Signed out ──────────────────────────────────────────────────────
  const anon = new Session('anon');
  const anonRespond = await anon.post('reviews.respond', { reviewId, body: 'x' });
  const anonReport = await anon.post('reviews.report', { reviewId, reason: 'spam' });
  check('36. NEGATIVE: a signed-out visitor can neither answer nor report',
    anonRespond.status !== 200 && anonReport.status !== 200,
    `respond=${anonRespond.status} report=${anonReport.status}`);
} catch (error) {
  check('PROBE COMPLETED', false, String(error?.message ?? error).slice(0, 200));
} finally {
  // ── Cleanup, and proof of it ────────────────────────────────────────────
  for (const id of [reviewId, secondReviewId].filter(Boolean)) {
    for (const q of [
      `delete from reviewReports where reviewId=${id}`,
      `delete from reviewResponses where reviewId=${id}`,
      `delete from reviews where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of projectsMade) {
    for (const q of [
      `delete from quotations where rfqId in (select id from rfqs where projectId=${id})`,
      `delete from rfqs where projectId=${id}`,
      `delete from projectMembers where projectId=${id}`,
      `delete from reviews where projectId=${id}`,
      `delete from projects where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  // TWO PASSES, and the order is the point. Every FK here is RESTRICT, and the
  // owner's RFQ cannot go while the provider's quotation still points at it -
  // a single pass in account order left the owner behind on the first run.
  for (const id of made) {
    for (const q of [
      `delete from quotations where providerId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from reviewReports where reporterId=${id} or resolvedBy=${id}`,
      `delete from reviewResponses where authorId=${id}`,
      `delete from reviews where reviewerId=${id} or revieweeId=${id} or hiddenBy=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from projects where ownerId=${id} or createdBy=${id}`,
      // The enquiry path this probe now walks writes rows of its own. Every FK
      // in this schema is RESTRICT, so a missing one here leaves the user
      // behind - which is why the cleanup is asserted rather than assumed.
      `delete from quotations where providerId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from enquiryAssignments where actorId=${id} or assigneeId=${id} or vendorId=${id}`,
      `delete from vendorEntitlementOverrides where userId=${id} or actorId=${id} or revokedBy=${id}`,
      `delete from vendorProfiles where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
      `delete from rfqs where requesterId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftoverUsers = made.length ? sql(`select count(*) from users where id in (${made.join(',')})`) : '0';
  const leftoverReviews = sql(`select count(*) from reviews where comment like 'Probe review%'`);
  const leftoverReports = sql(`select count(*) from reviewReports`);
  console.log(results.join('\n'));
  console.log(`\nCLEANUP: ${leftoverUsers} probe users, ${leftoverReviews} probe reviews, ${leftoverReports} reports left behind (all must be 0)`);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 && leftoverUsers === '0' && leftoverReviews === '0' && leftoverReports === '0' ? 0 : 1);
}

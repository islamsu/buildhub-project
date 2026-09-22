/**
 * ── A PUBLIC SURFACE THAT NOW HAS A REMEDY ──────────────────────────────
 *
 * `productQuestions` had exactly three surfaces - list, ask, answer - and no
 * moderation path of any kind. A question carrying abuse, a third party's
 * phone number or a competitor's contact details was published on a supplier's
 * product page and NOBODY could remove it: not the supplier whose listing it
 * sat on, not an administrator. Reviews had a full report-and-resolve queue.
 * Questions had nothing.
 *
 * WHAT IS PROVED HERE, in a rendered browser against real rows:
 *
 *   a buyer can report a question, and a supplier's answer, SEPARATELY
 *   nobody can report their own words
 *   the report reaches the admin queue with the context a decision needs
 *   hiding the ANSWER leaves the QUESTION standing, and says so
 *   hiding the QUESTION removes the whole exchange from the listing
 *   restoring puts it back
 *   upholding a report does NOT hide - they are two decisions
 *   a supplier can correct their own answer, and the old text is KEPT
 *   a corrected answer is marked as edited, publicly
 *   nothing is ever deleted
 *
 * THE EDIT HISTORY IS THE POINT OF HALF OF THIS. An editable public answer is
 * a way to rewrite history: answer "yes, we ship to Alexandria", take the
 * order, quietly change it to "no". Every superseded version is kept and the
 * buyer who asked is told it changed.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
await assertBuild(BASE);

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9700 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(350); return true; }
    await settle(250);
  }
  return false;
}
const clickOn = selector => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'false';
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return 'true';
`;
async function signIn(email, admin = false) {
  const res = await fetch(`${BASE}/api/trpc/auth.${admin ? 'adminSignIn' : 'signIn'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
async function call(cookie, path, input) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let code = null, message = '';
  try {
    const parsed = JSON.parse(text);
    code = parsed?.error?.json?.data?.code ?? null;
    message = parsed?.error?.json?.message ?? '';
    if (res.status === 200) return { ok: true, data: parsed.result.data.json };
  } catch { /* the body itself is the finding */ }
  return { ok: false, status: res.status, code, message, body: text.slice(0, 180) };
}

function seedUser(username, role, admin = false) {
  sql(`insert into users (openId, username, email, name, role, ${admin ? 'adminRole, ' : ''}userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        '${admin ? 'admin' : 'user'}', ${admin ? "'SUPER_ADMIN', " : ''}'${role}', 'password',
        '${admin ? 'admin_created' : 'self_registered'}', 0, 'active', 'approved', 1, '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zqam%') as probe)`;
  const productIds = `(select id from (select id from products where supplierId in ${ids}) as p)`;
  const questionIds = `(select id from (select id from productQuestions where productId in ${productIds}) as q)`;
  for (const statement of [
    `delete from productQuestionReports where questionId in ${questionIds} or reporterId in ${ids}`,
    `delete from productAnswerRevisions where questionId in ${questionIds} or replacedBy in ${ids}`,
    `delete from productQuestions where productId in ${productIds} or askerId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from products where supplierId in ${ids}`,
    `delete from users where username like 'zqam%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 90)})`);
    }
  }
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const supplier = `zqamS${stamp}`, buyer = `zqamB${stamp}`, admin = `zqamA${stamp}`;
  const supplierId = seedUser(supplier, 'supplier');
  const buyerId = seedUser(buyer, 'homeowner');
  const adminId = seedUser(admin, 'admin', true);

  sql(`insert into products (supplierId, name, category, status, price, currency, unit)
       values (${supplierId}, 'Probe Marble Slab ${stamp}', 'Materials', 'active', '1200.00', 'EGP', 'm2')`);
  const productId = Number(sql(`select id from products where supplierId=${supplierId} order by id desc limit 1`));
  check(supplierId > 0 && buyerId > 0 && adminId > 0 && productId > 0,
    'SETUP: a supplier with a listed product, a buyer and an administrator',
    `product ${productId}`);

  const buyerCookie = await signIn(`${buyer}@example.test`);
  const supplierCookie = await signIn(`${supplier}@example.test`);
  const adminCookie = await signIn(`${admin}@example.test`, true);

  /* ── A QUESTION AND AN ANSWER, THROUGH THE REAL PROCEDURES ───────────── */
  await call(buyerCookie, 'marketplace.askQuestion',
    { productId, question: `Does this ship to Alexandria? ${stamp}` });
  const questionId = Number(sql(
    `select id from productQuestions where productId=${productId} order by id desc limit 1`));
  const answered = await call(supplierCookie, 'marketplace.answerQuestion',
    { questionId, answer: 'Yes, we deliver to Alexandria within a week.' });
  check(questionId > 0 && answered.ok,
    'SETUP: the buyer asks and the supplier answers', `question ${questionId}`);

  /* ── NOBODY REPORTS THEIR OWN WORDS ──────────────────────────────────── */
  const selfQuestion = await call(buyerCookie, 'marketplace.reportQuestion',
    { questionId, target: 'question', reason: 'abusive' });
  check(!selfQuestion.ok && selfQuestion.code === 'BAD_REQUEST',
    'SELF: the asker cannot report their own question',
    `${selfQuestion.code ?? 'accepted'} ${selfQuestion.message}`);
  const selfAnswer = await call(supplierCookie, 'marketplace.reportQuestion',
    { questionId, target: 'answer', reason: 'abusive' });
  check(!selfAnswer.ok && selfAnswer.code === 'BAD_REQUEST',
    'SELF: and the supplier cannot report their own answer',
    `${selfAnswer.code ?? 'accepted'} ${selfAnswer.message}`);

  /* ── BUT EACH CAN REPORT THE OTHER HALF ──────────────────────────────── */
  const reportAnswer = await call(buyerCookie, 'marketplace.reportQuestion',
    { questionId, target: 'answer', reason: 'off_platform', detail: 'Asked me to call a mobile number.' });
  check(reportAnswer.ok, 'REPORT: the buyer can report the ANSWER',
    reportAnswer.ok ? 'accepted' : `${reportAnswer.code} ${reportAnswer.message}`);
  const reportQuestion = await call(supplierCookie, 'marketplace.reportQuestion',
    { questionId, target: 'question', reason: 'competitor', detail: 'Advertising a rival.' });
  check(reportQuestion.ok, 'REPORT: and the supplier can report the QUESTION',
    reportQuestion.ok ? 'accepted' : `${reportQuestion.code} ${reportQuestion.message}`);

  /* ── ONCE EACH. A second click is not a second report. ───────────────── */
  const again = await call(buyerCookie, 'marketplace.reportQuestion',
    { questionId, target: 'answer', reason: 'spam' });
  check(!again.ok && again.code === 'CONFLICT',
    'REPORT: reporting the same thing twice is refused, so the queue is not flooded',
    `${again.code ?? 'accepted'}`);

  const reports = Number(sql(
    `select count(*) from productQuestionReports where questionId=${questionId}`));
  check(reports === 2, 'REPORT: exactly two reports were stored', `${reports}`);

  /* ── THE ADMIN QUEUE CARRIES THE CONTEXT A DECISION NEEDS ────────────── */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookies(asBrowserCookies(adminCookie));
  await page.goto(`${BASE}/admin/reviews?tab=questions`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/admin/reviews?tab=questions`);
  const queueShown = await waitFor(page, `!!document.querySelector('[data-testid="admin-question-moderation"]')`);
  check(queueShown, 'ADMIN: the reported-questions queue is reachable from the console');

  const queue = JSON.parse(await page.evaluate(`
    const rows = Array.from(document.querySelectorAll('[data-testid^="admin-question-report-"]'));
    const text = rows.map(r => r.innerText).join(' | ');
    return JSON.stringify({
      rows: rows.length,
      namesProduct: /Probe Marble Slab/.test(text),
      namesSupplier: /Probe zqamS/.test(text),
      namesReason: /Advertising a competitor|Trying to move the deal/.test(text),
      namesTarget: /The question|The answer/.test(text),
    });
  `));
  check(queue.rows >= 2, 'ADMIN: both reports are in the queue', `${queue.rows} rows`);
  check(queue.namesProduct && queue.namesSupplier && queue.namesReason && queue.namesTarget,
    'ADMIN: and each row names the product, the supplier, the reason and WHICH half',
    `product ${queue.namesProduct}, supplier ${queue.namesSupplier}, reason ${queue.namesReason}, target ${queue.namesTarget}`);

  /* ── HIDING THE ANSWER LEAVES THE QUESTION STANDING ──────────────────── */
  const hideAnswer = await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'answer', action: 'hide', reason: 'Contains a phone number.' });
  check(hideAnswer.ok, 'HIDE: an administrator can hide the answer',
    hideAnswer.ok ? 'hidden' : `${hideAnswer.code} ${hideAnswer.message}`);

  const noReason = await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'question', action: 'hide' });
  check(!noReason.ok && noReason.code === 'BAD_REQUEST',
    'HIDE: and cannot hide anything without recording WHY',
    `${noReason.code ?? 'accepted'}`);

  const publicAfterHide = await (await fetch(
    `${BASE}/api/trpc/marketplace.questions?input=${encodeURIComponent(JSON.stringify({ json: { productId } }))}`)).json();
  const rowsAfterHide = publicAfterHide?.result?.data?.json ?? [];
  const mine = rowsAfterHide.find(r => r.id === questionId);
  check(!!mine && mine.answer === null && mine.answerHidden === true,
    'PUBLIC: the answer is gone from the listing but the QUESTION still stands',
    mine ? `answer ${JSON.stringify(mine.answer)}, answerHidden ${mine.answerHidden}` : 'the question vanished too');

  await page.goto(`${BASE}/marketplace/products/${productId}`);
  await waitFor(page, `document.body.innerText.includes('Does this ship to Alexandria')`);
  await settle(800);
  const saysRemoved = await page.evaluate(`
    return String(/BuildHub removed this answer/.test(document.body.innerText));
  `);
  check(saysRemoved === 'true',
    'PUBLIC: and the page SAYS the answer was removed rather than looking ignored');

  /* ── NOTHING WAS DELETED ─────────────────────────────────────────────── */
  const stillThere = sql(`select answer is not null from productQuestions where id=${questionId}`);
  check(stillThere === '1',
    'AUDITABLE: the hidden answer is still in the database, not destroyed', `answer present: ${stillThere}`);

  /* ── RESTORING PUTS IT BACK ──────────────────────────────────────────── */
  const restore = await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'answer', action: 'restore' });
  const afterRestore = await (await fetch(
    `${BASE}/api/trpc/marketplace.questions?input=${encodeURIComponent(JSON.stringify({ json: { productId } }))}`)).json();
  const restored = (afterRestore?.result?.data?.json ?? []).find(r => r.id === questionId);
  check(restore.ok && restored?.answer && restored.answerHidden === false,
    'RESTORE: and restoring returns the answer to the listing',
    restored ? `answerHidden ${restored.answerHidden}` : 'missing');

  /* ── HIDING THE QUESTION REMOVES THE WHOLE EXCHANGE ──────────────────── */
  await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'question', action: 'hide', reason: 'Advertising a rival supplier.' });
  const afterQuestionHide = await (await fetch(
    `${BASE}/api/trpc/marketplace.questions?input=${encodeURIComponent(JSON.stringify({ json: { productId } }))}`)).json();
  const gone = (afterQuestionHide?.result?.data?.json ?? []).find(r => r.id === questionId);
  check(!gone,
    'HIDE: hiding the question takes the whole exchange off the listing',
    gone ? 'still public' : 'correctly absent');
  await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'question', action: 'restore' });

  /* ── UPHOLDING A REPORT IS A SEPARATE DECISION FROM HIDING ───────────── */
  const reportId = Number(sql(
    `select id from productQuestionReports where questionId=${questionId} and target='question' limit 1`));
  const uphold = await call(adminCookie, 'admin.resolveProductQuestionReport',
    { reportId, status: 'upheld', note: 'Fair report, but the wording stands.' });
  const hiddenAfterUphold = sql(`select hiddenAt is not null from productQuestions where id=${questionId}`);
  check(uphold.ok && hiddenAfterUphold === '0',
    'SEPARATE: upholding a report does NOT hide the content by itself',
    `upheld ${uphold.ok}, hidden ${hiddenAfterUphold}`);

  /* ── A SUPPLIER CORRECTS THEIR OWN ANSWER, AND THE OLD TEXT IS KEPT ──── */
  const edit = await call(supplierCookie, 'marketplace.editAnswer',
    { questionId, answer: 'Correction: we do not currently deliver to Alexandria.' });
  check(edit.ok, 'EDIT: a supplier can correct their own answer',
    edit.ok ? `revisions ${edit.data.revisions}` : `${edit.code} ${edit.message}`);

  const kept = sql(`select answer from productAnswerRevisions where questionId=${questionId}`);
  check(kept.includes('within a week'),
    'EDIT: and the answer it replaced is KEPT - an edit is a correction, not an erasure',
    kept.slice(0, 70));

  const strangerEdit = await call(buyerCookie, 'marketplace.editAnswer',
    { questionId, answer: 'I am not the supplier.' });
  check(!strangerEdit.ok && strangerEdit.code === 'NOT_FOUND',
    'EDIT: somebody else\'s answer is NOT_FOUND, not FORBIDDEN - no oracle',
    `${strangerEdit.code ?? 'accepted'}`);

  const buyerTold = Number(sql(
    `select count(*) from notifications where userId=${buyerId} and title like '%updated%'`));
  check(buyerTold > 0,
    'EDIT: the buyer who asked is told the answer changed',
    `${buyerTold} notification(s)`);

  await page.goto(`${BASE}/marketplace/products/${productId}`);
  await waitFor(page, `document.body.innerText.includes('Correction: we do not currently')`);
  await settle(600);
  const marked = await page.evaluate(
    `return String(!!document.querySelector('[data-testid="product-answer-edited-${questionId}"]'));`);
  check(marked === 'true',
    'EDIT: and the listing marks the answer as edited, publicly');

  /* ── A MODERATED ANSWER CANNOT BE REWRITTEN AROUND ───────────────────── */
  await call(adminCookie, 'admin.moderateProductQuestion',
    { questionId, target: 'answer', action: 'hide', reason: 'Under review.' });
  const rewrite = await call(supplierCookie, 'marketplace.editAnswer',
    { questionId, answer: 'Trying to slip past moderation.' });
  check(!rewrite.ok && rewrite.code === 'CONFLICT',
    'MODERATION HOLDS: a hidden answer cannot be edited out from under the decision',
    `${rewrite.code ?? 'accepted'}`);
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

/**
 * ── THE SCREEN THE OWNER ACTUALLY SAW ─────────────────────────────────────
 *
 * The API probe proves the preview and the act agree. It cannot prove the one
 * thing that was reported: that the BUTTON is gone. The report was a
 * screenshot - an enabled "Open qualified enquiry" control, and a refusal
 * underneath it - and the answer was "it would be better to not see it from
 * first place". So this opens the same two pages in a real browser, as the
 * same three kinds of provider, and looks.
 *
 *   THE OFFER IS ABSENT for a provider whose trade does not match, on BOTH the
 *     RFQ detail page and the dedicated respond page - not disabled, not
 *     hidden behind a tooltip. Absent.
 *
 *   AND THE REASON IS THERE INSTEAD, with the one thing they can do about it.
 *
 *   THE BUTTON IS STILL THERE for the provider who can use it, because a fix
 *     that removes the capability from everybody is not a fix.
 *
 *   AN INVITED PROVIDER GOES STRAIGHT TO THE FORM, and is told the lead costs
 *     them nothing - the case the API probe caught the server lying about.
 *
 *   IN ARABIC TOO, with no raw keys, and no horizontal overflow at 375, 768
 *     and 1440.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));

/**
 * WAIT FOR THE DECISION, NOT FOR A NUMBER OF MILLISECONDS.
 *
 * The first version of this probe slept 2.4s after each navigation and read
 * three failures that were not there: the page had simply not finished
 * answering "can this provider respond" yet, and an assertion about an ABSENT
 * button passes for free against a page that has not rendered. A fixed sleep
 * is a guess that gets shorter every time the machine gets busier.
 *
 * The respond page always ends on exactly one of four outcomes, so their
 * presence IS the readiness signal - and waiting for it is honest for the
 * negative checks too, because the page has demonstrably decided before
 * anything is asserted about what it chose not to show.
 */
const DECIDED = '!!document.querySelector(\'[data-testid="respond-enquiry-blocked"],[data-testid="respond-enquiry-gate"],[data-testid="respond-form"],[data-testid="respond-review-stage"],[data-testid="respond-closed"]\')';
const DETAIL_DECIDED = '!!document.querySelector(\'[data-testid="rfq-detail-respond"],[data-testid="rfq-detail-not-eligible"],[data-testid="rfq-detail-my-quotation"],[data-testid="rfq-detail-awaiting-approval"]\')';

async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(`return String(${expression});`);
    if (value === 'true') { await settle(250); return true; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
/**
 * Navigate AS A NAMED PERSON, prove it took, then wait for the page to have
 * DECIDED before anything is read.
 *
 * ONE COOKIE JAR, MANY TABS. CDP cookies belong to the BROWSER, not to the
 * tab: signing the invited provider in silently re-authenticated every page
 * already open, and this probe went on reading the invited provider's screen
 * while believing it was looking at the mismatched one - and reported three
 * failures the product did not have. So the identity is re-asserted on every
 * navigation AND CHECKED against the server, because a probe that can quietly
 * become somebody else proves nothing about either of them.
 */
async function visit(page, url, who, readiness = DECIDED) {
  await page.setCookies(asBrowserCookies(who.cookie));
  await page.goto(url);
  const signedIn = Number(await page.evaluate(`
    return (async () => {
      const res = await fetch('/api/trpc/auth.me', { credentials: 'include' });
      const body = await res.json();
      return String(body?.result?.data?.json?.id ?? 0);
    })();
  `));
  if (signedIn !== who.id) {
    throw new Error(`identity bleed: the page is signed in as ${signedIn}, expected ${who.id}`);
  }
  const ready = await waitFor(page, readiness);
  if (!ready) throw new Error(`page never reached a decision: ${url}`);
}

const stamp = Date.now() % 100000000;
const made = [];
const projectsMade = [];

async function call(path, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  const set = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { status: res.status, data: parsed?.result?.data?.json ?? null, cookie: set || cookie || '' };
}
async function account(prefix, userRole) {
  const u = `${prefix}${stamp}`;
  const up = await call('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'EligUiPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status}`);
  const id = Number(sql(`select id from users where username='${u}'`) || 0);
  made.push(id);
  return { cookie: up.cookie, id };
}
/** The element is ABSENT, not merely invisible - the report was about a control that existed. */
const probeDom = page => page.evaluate(`
  const t = k => document.querySelector('[data-testid="' + k + '"]');
  const txt = el => el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
  return JSON.stringify({
    offer: !!t('respond-open-enquiry'),
    blocked: !!t('respond-enquiry-blocked'),
    gate: !!t('respond-enquiry-gate'),
    form: !!t('respond-form'),
    freeLead: !!t('respond-free-lead'),
    reason: txt(t('respond-blocked-reason')),
    fix: !!t('respond-declare-categories'),
    gateText: txt(t('respond-enquiry-gate')),
    freeText: txt(t('respond-free-lead')),
  });
`);

const browser = await launchBrowser({ port: CDP_PORT });
let customer, mismatch, matching, invited, rfqId = 0;

try {
  customer = await account('euc', 'homeowner');
  mismatch = await account('eum', 'contractor');
  matching = await account('eug', 'contractor');
  invited  = await account('eui', 'contractor');
  for (const who of [mismatch, matching, invited]) {
    sql(`update users set onboardingStatus='approved', verified=1 where id=${who.id}`);
  }
  await call('profile.setMyCategories', { categories: ['Design'] }, mismatch.cookie);
  await call('profile.setMyCategories', { categories: ['Renovation'] }, matching.cookie);
  await call('profile.setMyCategories', { categories: ['Design'] }, invited.cookie);

  const project = await call('projects.create', {
    title: `Probe elig UI project ${stamp}`, type: 'renovation', location: 'Cairo',
  }, customer.cookie);
  if (project.data?.id) projectsMade.push(project.data.id);
  const rfq = await call('rfq.create', {
    projectId: project.data?.id, title: `Probe elig UI RFQ ${stamp}`,
    description: 'A renovation request.', category: 'Renovation', location: 'Cairo',
  }, customer.cookie);
  rfqId = rfq.data?.id ?? 0;
  check(rfqId > 0 && mismatch.id > 0 && matching.id > 0 && invited.id > 0,
    '1. SETUP: an open Renovation request and three approved providers', `rfq=${rfqId}`);

  // ── THE MISMATCHED PROVIDER: the exact account from the report ──────────
  const mm = await browser.newPage();
  await mm.setCookies(asBrowserCookies(mismatch.cookie));
  await mm.goto(`${BASE}/rfq/${rfqId}/respond`);
  await mm.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await visit(mm, `${BASE}/rfq/${rfqId}/respond`, mismatch);
  const mmDom = JSON.parse(await probeDom(mm));
  check(mmDom.offer === false,
    '2. THE BUTTON IS GONE — not disabled, ABSENT, on the respond page', `offer=${mmDom.offer}`);
  check(mmDom.gate === false && mmDom.form === false,
    '3. and so is the gate card that used to carry it', `gate=${mmDom.gate} form=${mmDom.form}`);
  check(mmDom.blocked === true && /service categories you have declared/i.test(mmDom.reason),
    '4. THE REASON IS THERE INSTEAD, before the click', mmDom.reason.slice(0, 62));
  check(mmDom.fix === true,
    '5. with the one thing they can actually do about it');

  await visit(mm, `${BASE}/rfq/${rfqId}`, mismatch, DETAIL_DECIDED);
  const mmDetail = JSON.parse(await mm.evaluate(`
    const t = k => document.querySelector('[data-testid="' + k + '"]');
    return JSON.stringify({
      respond: !!t('rfq-detail-respond'),
      notEligible: !!t('rfq-detail-not-eligible'),
      declare: !!t('rfq-detail-declare-categories'),
      text: t('rfq-detail-not-eligible') ? t('rfq-detail-not-eligible').innerText.replace(/\\s+/g,' ').trim() : '',
    });
  `));
  check(mmDetail.respond === false && mmDetail.notEligible === true,
    '6. AND THE SAME ON THE DETAIL PAGE — no offer, the reason in its place',
    `respond=${mmDetail.respond}`);
  check(/outside the service categories/i.test(mmDetail.text) && mmDetail.declare === true,
    '7. with the same reason and the same way out', mmDetail.text.slice(0, 58));

  // ── THE MATCHING PROVIDER: the capability is not removed from everybody ──
  const ok = await browser.newPage();
  await ok.setCookies(asBrowserCookies(matching.cookie));
  await ok.goto(`${BASE}/rfq/${rfqId}/respond`);
  await ok.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await visit(ok, `${BASE}/rfq/${rfqId}/respond`, matching);
  const okDom = JSON.parse(await probeDom(ok));
  check(okDom.offer === true && okDom.blocked === false,
    '8. THE BUTTON IS STILL THERE for the provider who can use it',
    `offer=${okDom.offer} blocked=${okDom.blocked}`);
  check(/one qualified enquiry/i.test(okDom.gateText),
    '9. and it says what the click will COST before they make it', okDom.gateText.slice(0, 62));
  check(okDom.freeLead === false,
    '10. with no "this is free" claim on a lead that is not', `free=${okDom.freeLead}`);

  // ── THE INVITED PROVIDER: the case the API probe caught the server lying about ──
  await call('rfq.inviteSupplier', { rfqId, supplierId: invited.id }, customer.cookie);
  const inv = await browser.newPage();
  await inv.setCookies(asBrowserCookies(invited.cookie));
  await inv.goto(`${BASE}/rfq/${rfqId}/respond`);
  await inv.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await visit(inv, `${BASE}/rfq/${rfqId}/respond`, invited);
  const invDom = JSON.parse(await probeDom(inv));
  check(invDom.blocked === false && invDom.form === true,
    '11. AN INVITED PROVIDER GOES STRAIGHT TO THE FORM, despite the category mismatch',
    `blocked=${invDom.blocked} form=${invDom.form}`);
  check(invDom.freeLead === true && /does not use your enquiry allowance/i.test(invDom.freeText),
    '12. and is told the lead costs them nothing', invDom.freeText.slice(0, 62));
  check(Number(sql(`select count(*) from qualifiedEnquiries where userId=${invited.id}`) || 0) === 0,
    '13. LOOKING AT THE PAGE SPENT NOTHING — no enquiry row was written');

  // ── ARABIC ──────────────────────────────────────────────────────────────
  await mm.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await visit(mm, `${BASE}/rfq/${rfqId}/respond`, mismatch);
  const arabic = JSON.parse(await mm.evaluate(`
    const el = document.querySelector('[data-testid="respond-enquiry-blocked"]');
    const text = el ? el.innerText : '';
    return JSON.stringify({
      text: text.replace(/\\s+/g, ' ').trim(),
      raw: (text.match(/[a-z]+\\.[a-zA-Z.]{3,}|category_mismatch|limit_reached|rfq_closed/g) || []),
      dir: document.documentElement.getAttribute('dir') || 'ltr',
      offer: !!document.querySelector('[data-testid="respond-open-enquiry"]'),
    });
  `));
  check(/[؀-ۿ]/.test(arabic.text) && !/service categories/i.test(arabic.text),
    '14. THE ARABIC SCREEN IS NOT HANDED ENGLISH', arabic.text.slice(0, 52));
  // Length first: an empty string contains no raw key either, and an earlier
  // run of this probe passed this check against a card that was not there.
  check(arabic.text.length > 40 && arabic.raw.length === 0,
    '15. and no raw reason key leaks through as copy',
    `chars=${arabic.text.length} raw=${arabic.raw.slice(0, 3).join(',')}`);
  check(arabic.dir === 'rtl' && arabic.offer === false,
    '16. RTL, and still no button', `dir=${arabic.dir} offer=${arabic.offer}`);

  // ── THREE WIDTHS ────────────────────────────────────────────────────────
  await mm.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  for (const width of [375, 768, 1440]) {
    await mm.setViewport({ width, height: 900 });
    await visit(mm, `${BASE}/rfq/${rfqId}/respond`, mismatch);
    const layout = JSON.parse(await mm.evaluate(`
      return JSON.stringify({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        visible: !!document.querySelector('[data-testid="respond-enquiry-blocked"]'),
      });
    `));
    check(layout.scroll <= layout.client + 1 && layout.visible,
      `17${width === 375 ? 'a' : width === 768 ? 'b' : 'c'}. readable at ${width}px with no horizontal overflow`,
      `scroll=${layout.scroll} client=${layout.client}`);
  }
} catch (error) {
  check(false, 'PROBE COMPLETED', String(error).slice(0, 200));
} finally {
  try { await browser.close(); } catch {}
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
  check(left === 0, '18. CLEANUP: every account and request this probe created is gone', `users=${left}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

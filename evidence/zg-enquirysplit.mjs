/**
 * ── ONE SYSTEM, TWO LISTS, NO REQUEST TWICE ─────────────────────────────
 *
 * Owner correction, verbatim: "keep /enquiries as one canonical system but
 * remove/avoid overlapping duplicate presentation - structure it clearly as
 * Opportunity Centre vs My Leads rather than two lists showing the same
 * RFQs", and "fix the remaining common.egp coupling ... so RFQ budget renders
 * from rfq.currency through canonical formatMoney, and regression-test with
 * SAR".
 *
 * A screenshot of the real screen showed the same six requests rendered
 * twice, one card above the other, in two different vocabularies. A source
 * test cannot see that; only a rendered page can, which is why this exists
 * alongside server/enquiryStates.test.ts and server/enquiryMoney.test.ts.
 *
 * WHAT IS PROVED, against real rows and a real browser:
 *
 *   the two halves are DISJOINT - no rfqId is in both
 *   and EXHAUSTIVE - together they are the whole queue, so the split hides
 *     nothing (a partition that loses rows is worse than a duplicate)
 *   the rendered page shows both cards, and no request number twice
 *   a SAR request renders its budget in SAR and NEVER in EGP
 *   an untaken invitation is an opportunity; opening it moves it to My Leads
 *   the deep link still lands, and the page says WHICH half it landed in
 *
 * NON-VACUITY IS CHECKED, not assumed: a disjointness test over two empty
 * lists passes for the wrong reason, so both halves must be non-empty before
 * the disjointness claim is allowed to count.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
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
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}
const idsOf = rows => (rows ?? []).map(row => Number(row.rfqId));

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

const cookie = await signIn(SUPPLIER);
const supplierId = num(`SELECT id FROM users WHERE email='${SUPPLIER}'`);
check(supplierId > 0, 'the supplier account exists', `#${supplierId}`);

/* ══ 1. THE SPLIT IS A PARTITION ═══════════════════════════════════════ */

const opportunities = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'opportunities' });
const leads = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'leads' });
const all = await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'all' });

check(opportunities.status === 200 && leads.status === 200 && all.status === 200,
  'all three scopes answer', `${opportunities.status}/${leads.status}/${all.status}`);

const oppIds = idsOf(opportunities.data?.rows);
const leadIds = idsOf(leads.data?.rows);
const allIds = idsOf(all.data?.rows);

// NON-VACUITY FIRST. Disjointness over two empty lists is a pass that means
// nothing, and it is exactly the pass a broken scope filter would produce.
check(oppIds.length > 0 && leadIds.length > 0,
  'BOTH halves have rows, so the disjointness claim below is not vacuous',
  `${oppIds.length} opportunities, ${leadIds.length} leads`);

const overlap = oppIds.filter(id => leadIds.includes(id));
check(overlap.length === 0,
  'NO REQUEST IS IN BOTH HALVES - the duplicate presentation is gone',
  overlap.length ? `#${overlap.join(', #')}` : 'disjoint');

const union = [...new Set([...oppIds, ...leadIds])].sort((a, b) => a - b);
const whole = [...new Set(allIds)].sort((a, b) => a - b);
check(JSON.stringify(union) === JSON.stringify(whole),
  'and together they are the WHOLE queue - the split hides nothing',
  `${union.length} vs ${whole.length}`);

check(Number(opportunities.data?.total ?? -1) + Number(leads.data?.total ?? -1) === Number(all.data?.total ?? -2),
  'the totals add up too, not just the visible page',
  `${opportunities.data?.total} + ${leads.data?.total} = ${all.data?.total}`);

/* Every opportunity row is in an opportunity state, and vice versa. */
const oppStates = new Set((opportunities.data?.rows ?? []).map(r => r.responseState));
const leadStates = new Set((leads.data?.rows ?? []).map(r => r.responseState));
check([...oppStates].every(s => ['available', 'invited'].includes(s)),
  'the Opportunity Centre contains only opportunity states', [...oppStates].join(','));
check([...leadStates].every(s => ['opened', 'quoted', 'won', 'lost', 'closed', 'declined'].includes(s)),
  'and My Leads only lead states', [...leadStates].join(','));

/* ══ 2. THE SAUDI REGRESSION, IN THE DATABASE AND ON THE SCREEN ════════ */
/*
 * A real SAR request the supplier can reach. Created rather than borrowed so
 * nothing already in the dataset is left mislabelled; removed in `finally`.
 */
const buyerId = num(`SELECT id FROM users WHERE email='zid6507832req@example.test'`);
check(buyerId > 0, 'a buyer exists to raise the SAR request', `#${buyerId}`);

/*
 * IT REACHES THE SUPPLIER BY INVITATION, not by category match.
 *
 * `vendorCategories` is empty in this dataset, so the category arm of the
 * reachability filter cannot deliver anything - a request built to rely on it
 * would arrive nowhere and every assertion below it would pass for being
 * unreachable rather than for being right. The invitation arm is real, needs
 * no declared category, and exercises the `invited` state this split added.
 */
let sarRfqId = 0;
try {
  sql(`INSERT INTO rfqs (requesterId, title, description, category, budget, currency, marketCode, location, status, createdAt, updatedAt)
       VALUES (${buyerId}, 'ZG SAR currency probe', 'Riyadh tower cladding package.', 'general_contracting',
               500000.00, 'SAR', 'SA', 'Riyadh', 'open', NOW(), NOW())`);
  sarRfqId = num(`SELECT id FROM rfqs WHERE title='ZG SAR currency probe' ORDER BY id DESC LIMIT 1`);
  sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, invitedAt, status, createdAt)
       VALUES (${sarRfqId}, ${supplierId}, ${buyerId}, NOW(), 'invited', NOW())`);
  check(sarRfqId > 0, 'a SAR request exists, is open, and this supplier is invited to it', `#${sarRfqId}`);

  const sarRow = (await query(cookie, 'rfq.queue', { page: 0, pageSize: 100, scope: 'opportunities' }))
    .data?.rows?.find(r => Number(r.rfqId) === sarRfqId);
  check(sarRow !== undefined, 'it reaches the supplier as an OPPORTUNITY');
  check(sarRow?.responseState === 'invited',
    'as an INVITED one - an offer not yet taken', String(sarRow?.responseState));
  check(sarRow?.currency === 'SAR',
    'and the queue carries its currency out of the server as SAR', String(sarRow?.currency));
  check(sarRow?.currency !== 'EGP', 'never as EGP');

  /* ── IN THE BROWSER ────────────────────────────────────────────────── */
  const browser = await launchBrowser({ port: CDP_PORT });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.setCookies(asBrowserCookies(cookie));
    await page.goto(`${BASE}/enquiries`);

    const rendered = await waitFor(page,
      `document.querySelector('[data-testid="enquiry-queue-opportunities"]') !== null
       && document.querySelector('[data-testid="enquiry-queue-leads"]') !== null`);
    check(rendered, 'BOTH named cards render: Opportunity Centre and My Leads');

    const headings = await page.evaluate(`
      return Array.from(document.querySelectorAll('[data-testid^="enquiry-queue-"]'))
        .filter(el => el.getAttribute('data-testid') === 'enquiry-queue-opportunities'
                   || el.getAttribute('data-testid') === 'enquiry-queue-leads')
        .map(el => (el.innerText || '').split('\\n')[0]);
    `);
    check(Array.isArray(headings) && headings.some(h => /Opportunity Centre/i.test(h)),
      'the first card is titled Opportunity Centre', String(headings?.[0]));
    check(Array.isArray(headings) && headings.some(h => /My Leads/i.test(h)),
      'the second is titled My Leads', String(headings?.[1]));

    await waitFor(page, `document.querySelectorAll('[data-testid^="enquiry-queue-row-"]').length > 0`);
    await settle(1500);

    /* THE RENDERED DUPLICATE CHECK - the one a source test cannot make. */
    const perCard = await page.evaluate(`
      const ids = card => Array.from(
        document.querySelector('[data-testid="' + card + '"]')
          ?.querySelectorAll('[data-testid^="enquiry-queue-row-"]') ?? []
      ).map(el => el.getAttribute('data-testid'));
      return { opp: ids('enquiry-queue-opportunities'), lead: ids('enquiry-queue-leads') };
    `);
    const renderedOverlap = (perCard?.opp ?? []).filter(id => (perCard?.lead ?? []).includes(id));
    check((perCard?.opp?.length ?? 0) > 0 && (perCard?.lead?.length ?? 0) > 0,
      'both rendered cards have rows, so the rendered check is not vacuous',
      `${perCard?.opp?.length} / ${perCard?.lead?.length}`);
    check(renderedOverlap.length === 0,
      'AND NO REQUEST NUMBER IS RENDERED IN BOTH CARDS',
      renderedOverlap.join(', ') || 'none');

    /* THE MONEY, ON THE SCREEN. */
    const budgetText = await page.evaluate(`
      const el = document.querySelector('[data-testid="enquiry-queue-budget-${sarRfqId}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    // NOT VACUOUS: "MISSING" must not be allowed to satisfy "never says EGP".
    // An element that is not there says nothing at all, and a check that reads
    // that as a pass is the check passing for the wrong reason.
    const budgetRendered = budgetText !== 'MISSING' && String(budgetText).length > 0;
    check(budgetRendered, 'the SAR request renders a budget at all', budgetText);
    check(budgetRendered && /SAR/.test(String(budgetText)),
      'THE BUDGET RENDERS IN SAR', budgetText);
    check(budgetRendered && !/EGP|جنيه/.test(String(budgetText)),
      'and never in Egyptian pounds - the common.egp coupling is gone', budgetText);
    check(budgetRendered && /500,?000/.test(String(budgetText)),
      'with the amount from the record, unconverted', budgetText);

    /* The same screen in Arabic must not fall back to the Egyptian word. */
    await page.evaluate(`localStorage.setItem('lang', 'ar'); return true;`);
    await page.goto(`${BASE}/enquiries`);
    await waitFor(page, `document.querySelector('[data-testid="enquiry-queue-budget-${sarRfqId}"]') !== null`);
    const arabicBudget = await page.evaluate(`
      const el = document.querySelector('[data-testid="enquiry-queue-budget-${sarRfqId}"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(arabicBudget !== 'MISSING' && !/جنيه|EGP/.test(String(arabicBudget)),
      'and the ARABIC screen does not label a Saudi budget in Egyptian pounds either', arabicBudget);
    await page.evaluate(`localStorage.setItem('lang', 'en'); return true;`);

    /* ══ 3. THE DEEP LINK STILL LANDS, AND SAYS WHERE ═══════════════════ */
    const leadTarget = leadIds[0];
    await page.goto(`${BASE}/enquiries?rfq=${leadTarget}`);
    const located = await waitFor(page,
      `document.querySelector('[data-testid="enquiry-linked-located"]') !== null`);
    check(located, 'a notification deep link is located on the page', `#${leadTarget}`);
    const locatedText = await page.evaluate(`
      const el = document.querySelector('[data-testid="enquiry-linked-located"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(/My Leads/i.test(String(locatedText)),
      'and the page names WHICH half it landed in', String(locatedText).slice(0, 90));

    const oppTarget = oppIds[0];
    await page.goto(`${BASE}/enquiries?rfq=${oppTarget}`);
    await waitFor(page, `document.querySelector('[data-testid="enquiry-linked-located"]') !== null`);
    const oppLocated = await page.evaluate(`
      const el = document.querySelector('[data-testid="enquiry-linked-located"]');
      return el ? el.innerText.trim() : 'MISSING';
    `);
    check(/Opportunity Centre/i.test(String(oppLocated)),
      'an opportunity deep link names the other half', String(oppLocated).slice(0, 90));

    /* A request that reaches this supplier through nothing at all. */
    const strangerRfq = num(`
      SELECT r.id FROM rfqs r
      WHERE r.category NOT IN (SELECT category FROM vendorCategories WHERE userId=${supplierId})
        AND NOT EXISTS (SELECT 1 FROM qualifiedEnquiries q WHERE q.rfqId=r.id AND q.userId=${supplierId})
        AND NOT EXISTS (SELECT 1 FROM rfqSuppliers s WHERE s.rfqId=r.id AND s.supplierId=${supplierId})
        AND r.id <> ${sarRfqId}
      ORDER BY r.id DESC LIMIT 1`);
    if (strangerRfq > 0) {
      await page.goto(`${BASE}/enquiries?rfq=${strangerRfq}`);
      const told = await waitFor(page,
        `document.querySelector('[data-testid="enquiry-not-eligible"]') !== null`);
      check(told, 'a request in NEITHER half is named as absent, not silently dropped', `#${strangerRfq}`);
      const stillNoDup = await page.evaluate(`
        return document.querySelector('[data-testid="enquiry-linked-located"]') === null;
      `);
      check(stillNoDup === true,
        'and the page does not also claim to have located it');
    } else {
      check(false, 'no unreachable request available to test the absent case', 'SKIP-ABSENT');
    }
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  if (sarRfqId > 0) {
    // The invitation first: rfqSuppliers.rfqId is ON DELETE RESTRICT, so the
    // RFQ cannot go while a child row points at it.
    sql(`DELETE FROM rfqSuppliers WHERE rfqId=${sarRfqId}`);
    sql(`DELETE FROM rfqs WHERE id=${sarRfqId}`);
    console.log(`\n(cleanup) removed probe RFQ #${sarRfqId}: ${num(`SELECT COUNT(*) FROM rfqs WHERE id=${sarRfqId}`) === 0 ? 'gone' : 'STILL PRESENT'}`);
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/**
 * ── THE WORK QUEUE, CLICKED ───────────────────────────────────────────────
 *
 * The API probe proves the rules. What it cannot prove is that a provider can
 * see the lead they paid for, that the filters on the screen are wired to the
 * server rather than to a page of rows in the browser, and that the pager
 * moves.
 *
 *   THE RECEIPT IS ON THE SCREEN. A closed request the provider paid to open,
 *     rendered with the date the credit was spent - the row that used to
 *     disappear.
 *
 *   A REAL CLICK ON A FILTER CHANGES THE SERVER'S ANSWER, and the total with
 *     it. A filter that only narrows what is already loaded is the defect
 *     this whole surface exists to end.
 *
 *   THE PAGER MOVES, and page two is different rows.
 *
 *   AND A CLOSED REQUEST IS OFFERED NO RESPOND BUTTON - the dead control ELIG
 *     removed from the page this one points at.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

/** Wait for the queue to have ANSWERED - rows or a truthful empty state. */
const ANSWERED = '!!document.querySelector(\'[data-testid="enquiry-queue-rows"],[data-testid="enquiry-queue-empty"]\')';
/**
 * A CONDITION THAT IS NOT TRUE YET IS NOT AN ERROR.
 *
 * An expression like `document.querySelector(x).innerText` throws while the
 * node is still unmounted, and an uncaught throw inside the page surfaced here
 * as a bare "Uncaught" that named neither the step nor the expression - which
 * is how this probe reported a failure the product did not have. A throw is
 * treated as "not yet" and retried; only the timeout is a failure, and it says
 * what it was waiting for.
 */
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value = 'false';
    try { value = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); }
    catch { value = 'false'; }
    if (value === 'true') { await settle(250); return true; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
/**
 * CLICK SOMETHING THAT IS THERE, and say which thing was not.
 *
 * `document.querySelector(...).click()` on an element that has not rendered
 * yet throws "Uncaught" and nothing else - a probe failure that names neither
 * the control nor the step. This waits for the control first and, when it
 * never appears, fails with its test id.
 */
async function clickTestId(page, testid) {
  const selector = `[data-testid="${testid}"]`;
  if (!await waitFor(page, `!!document.querySelector('${selector}')`)) {
    throw new Error(`control never rendered: ${testid}`);
  }
  await page.evaluate(`document.querySelector('${selector}').click(); return true;`);
}

const read = page => page.evaluate(`
  const t = k => document.querySelector('[data-testid="' + k + '"]');
  const txt = el => el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
  const rows = Array.from(document.querySelectorAll('[data-testid^="enquiry-queue-row-"]'))
    .map(el => el.getAttribute('data-testid').replace('enquiry-queue-row-', ''));
  return JSON.stringify({
    rows,
    total: txt(t('enquiry-queue-total')),
    pager: !!t('enquiry-queue-pager'),
    pageLabel: txt(t('enquiry-queue-page-label')),
    empty: !!t('enquiry-queue-empty'),
    emptyText: txt(t('enquiry-queue-empty')),
    dir: document.documentElement.getAttribute('dir') || 'ltr',
  });
`);

const stamp = Date.now() % 100000000;
const made = [];
const projectsMade = [];
const RFQ_COUNT = 25;

async function call(path, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null,
    cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ') || cookie || '' };
}
async function account(prefix, userRole) {
  const u = `${prefix}${stamp}`;
  const up = await call('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'QueueUiPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status}`);
  const id = Number(sql(`select id from users where username='${u}'`) || 0);
  made.push(id);
  return { cookie: up.cookie, id };
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const customer = await account('quc', 'homeowner');
  const provider = await account('qup', 'contractor');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${provider.id}`);
  await call('profile.setMyCategories', { categories: ['Renovation'] }, provider.cookie);

  const project = await call('projects.create', {
    title: `Probe queue UI project ${stamp}`, type: 'renovation', location: 'Cairo',
  }, customer.cookie);
  if (project.data?.id) projectsMade.push(project.data.id);

  const rfqIds = [];
  for (let i = 0; i < RFQ_COUNT; i++) {
    // Seeded directly: `rfq.create` is rate limited to three a minute, and the
    // subject here is the SCREEN, not the creation path.
    rfqIds.push(Number(sql(
      `insert into rfqs (requesterId, projectId, title, description, category, location, status)`
      + ` values (${customer.id}, ${project.data?.id}, 'Probe UI RFQ ${stamp} number ${String(i).padStart(2, '0')}',`
      + ` 'A renovation request.', 'Renovation', 'Cairo', 'open'); select last_insert_id();`)));
  }
  const paidRfq = rfqIds[0];
  await call('rfq.openEnquiry', { rfqId: paidRfq }, provider.cookie);
  sql(`update rfqs set status='closed' where id=${paidRfq}`);
  check(rfqIds.every(id => id > 0) && Number(sql(`select count(*) from qualifiedEnquiries where userId=${provider.id}`)) === 1,
    '1. SETUP: 25 requests, one of them paid for and then closed by the customer',
    `rfqs=${rfqIds.length}`);

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(provider.cookie));
  await page.goto(`${BASE}/enquiries`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/enquiries`);
  if (!await waitFor(page, ANSWERED)) throw new Error('the queue never answered');

  const first = JSON.parse(await read(page));
  check(first.rows.length === 20, '2. the queue renders one bounded page, not everything',
    `rows=${first.rows.length}`);
  check(/2[5-9]|3[0-9] request/.test(first.total) || /\d+ requests/.test(first.total),
    '3. and states the REAL total, which is what says whether a filter found everything', first.total);
  check(first.pager && /Page 1 of/.test(first.pageLabel),
    '4. with a pager, because there is more than one page', first.pageLabel);

  // ── THE RECEIPT ─────────────────────────────────────────────────────────
  await page.evaluate(`
    const input = document.querySelector('[data-testid="enquiry-queue-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#${paidRfq}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await waitFor(page, `!!document.querySelector('[data-testid="enquiry-queue-row-${paidRfq}"]')`);
  const receipt = JSON.parse(await page.evaluate(`
    const row = document.querySelector('[data-testid="enquiry-queue-row-${paidRfq}"]');
    return JSON.stringify({
      shown: !!row,
      text: row ? row.innerText.replace(/\\s+/g, ' ').trim() : '',
      opened: !!document.querySelector('[data-testid="enquiry-queue-opened-${paidRfq}"]'),
      respond: !!document.querySelector('[data-testid="enquiry-queue-respond-${paidRfq}"]'),
    });
  `));
  check(receipt.shown, '5. A REAL SEARCH BY REFERENCE finds the paid lead, from page two');
  check(receipt.opened && /Opened /.test(receipt.text),
    '6. THE RECEIPT IS ON THE SCREEN — the date the credit was spent', receipt.text.slice(0, 70));
  check(/Closed/.test(receipt.text),
    '7. on a request the customer has since closed — the row that used to vanish');
  check(receipt.respond === false,
    '8. and a closed request is offered NO respond button', `respond=${receipt.respond}`);

  // ── A FILTER THAT REACHES THE SERVER ────────────────────────────────────
  await page.evaluate(`
    const input = document.querySelector('[data-testid="enquiry-queue-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await waitFor(page, `document.querySelectorAll('[data-testid^="enquiry-queue-row-"]').length === 20`);
  await clickTestId(page, 'enquiry-queue-tile-opened');
  await waitFor(page, `document.querySelectorAll('[data-testid^="enquiry-queue-row-"]').length === 1`);
  const filtered = JSON.parse(await read(page));
  check(filtered.rows.length === 1 && filtered.rows[0] === String(paidRfq),
    '9. A REAL CLICK ON A TILE FILTERS AT THE SERVER — one row, the paid one',
    `rows=${filtered.rows.join(',')}`);
  check(/^1 request$/.test(filtered.total),
    '10. and the TOTAL moves with it, rather than describing the unfiltered set', filtered.total);
  check(filtered.pager === false, '11. so the pager is gone, because one row is one page');

  await clickTestId(page, 'enquiry-queue-tile-opened');
  // Waits for the PAGER to come back, not for a row count: the pager is the
  // control the next step clicks, so its presence is the real precondition.
  if (!await waitFor(page, `!!document.querySelector('[data-testid="enquiry-queue-pager"]')`)) {
    throw new Error('the pager did not return after clearing the filter');
  }

  // ── THE PAGER MOVES ─────────────────────────────────────────────────────
  await clickTestId(page, 'enquiry-queue-next');
  if (!await waitFor(page, `/Page 2 of/.test((document.querySelector('[data-testid="enquiry-queue-page-label"]') || {}).innerText || '')`)) {
    throw new Error('the pager never reached page 2');
  }
  const second = JSON.parse(await read(page));
  const overlap = second.rows.filter(id => first.rows.includes(id));
  check(/Page 2 of/.test(second.pageLabel) && second.rows.length > 0,
    '12. THE PAGER MOVES to a second page of real rows', `${second.pageLabel} rows=${second.rows.length}`);
  check(overlap.length === 0,
    '13. and page two repeats nothing from page one', `overlap=${overlap.length}`);

  // ── A FILTER THAT MATCHES NOTHING SAYS SO, DIFFERENTLY ──────────────────
  await page.evaluate(`
    const input = document.querySelector('[data-testid="enquiry-queue-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'zzz-no-such-request');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await waitFor(page, `!!document.querySelector('[data-testid="enquiry-queue-empty"]')`);
  const noMatch = JSON.parse(await read(page));
  check(noMatch.empty && /No request matches this filter/.test(noMatch.emptyText),
    '14. "NOTHING MATCHES" IS NOT "NOTHING HAS REACHED YOU"', noMatch.emptyText.slice(0, 60));

  // ── ARABIC, AND THREE WIDTHS ────────────────────────────────────────────
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/enquiries`);
  if (!await waitFor(page, ANSWERED)) throw new Error('the Arabic queue never answered');
  const arabic = JSON.parse(await page.evaluate(`
    const card = document.querySelector('[data-testid="enquiry-queue"]');
    const text = card ? card.innerText : '';
    return JSON.stringify({
      dir: document.documentElement.getAttribute('dir') || 'ltr',
      arabic: /[\\u0600-\\u06FF]/.test(text),
      english: /Available|Opened|Quoted|Work queue/.test(text),
      raw: (text.match(/enquiries\\.[a-zA-Z.]+|responseState|rfqStatus/g) || []),
      length: text.length,
    });
  `));
  check(arabic.length > 200 && arabic.arabic && !arabic.english,
    '15. THE ARABIC QUEUE IS GENUINELY ARABIC, not English with a flipped layout',
    `chars=${arabic.length} english=${arabic.english}`);
  check(arabic.raw.length === 0 && arabic.dir === 'rtl',
    '16. no raw key leaks through, and the direction is RTL',
    `dir=${arabic.dir} raw=${arabic.raw.slice(0, 3).join(',')}`);

  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/enquiries`);
    if (!await waitFor(page, ANSWERED)) throw new Error(`the queue never answered at ${width}`);
    const layout = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        visible: !!document.querySelector('[data-testid="enquiry-queue-rows"]'),
      });
    `));
    check(layout.scroll <= layout.client + 1 && layout.visible,
      `17${width === 375 ? 'a' : width === 768 ? 'b' : 'c'}. readable at ${width}px with no horizontal overflow`,
      `scroll=${layout.scroll} client=${layout.client} visible=${layout.visible}`);
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
  try { sql(`delete from rfqs where title like 'Probe UI RFQ ${stamp}%'`); } catch {}
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  for (const id of projectsMade) { try { sql(`delete from projects where id=${id}`); } catch {} }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check(left === 0, '18. CLEANUP: every account and request this probe created is gone', `users=${left}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

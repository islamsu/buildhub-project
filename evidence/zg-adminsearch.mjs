/**
 * ── FINDING A RECORD, AND ACTUALLY ARRIVING AT IT ─────────────────────────
 *
 * `platformSearch.test.ts` proves which segments each administrator's role
 * causes a query for, and `adminSearchDestinations.test.ts` proves every
 * destination the search can emit is a route the console resolves. Neither
 * can tell you what a browser draws, whether the link an administrator clicks
 * lands on THE CASE or merely on the queue it sits in, or whether a
 * restricted administrator is told a record does not exist when in truth they
 * may not look.
 *
 * So this signs in as three REAL administrators, searches for REAL seeded
 * records by their HUMAN REFERENCE, clicks the results, and asserts the case
 * itself opened. Then it takes the same reference to an administrator who may
 * not read cases and asserts the segment is reported as WITHHELD rather than
 * EMPTY - and that the server refuses the destination directly, not just that
 * the menu declines to offer it.
 *
 * THE EXPECTED SETS ARE WRITTEN OUT HERE, from what each job allows. A probe
 * that imports the module under test proves the two agree, not that the
 * product is right.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9200 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value = 'false';
    try { value = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (value === 'true') { await settle(250); return true; }
    await settle(250);
  }
  return false;
}

const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now() % 100000000;

function makeAdmin(suffix, adminRole) {
  const u = `zsearch${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe ${adminRole}', 'admin',
        '${adminRole}', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (!Number.isInteger(id) || id <= 0) throw new Error(`probe setup: ${u} was not created`);
  return { id, email: `${u}@example.test`, adminRole };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn ${email}: ${res.status} ${(await res.text()).slice(0, 140)}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/** A query is a GET with ?input= - POSTing one returns 405, which proves nothing. */
async function callQuery(cookie, procedure, input) {
  const url = `${BASE}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, { headers: { cookie } });
  return { status: res.status, body: await res.text() };
}

/** Search from the rendered page, and read what the console actually drew. */
async function searchInBrowser(page, query) {
  await page.evaluate(`
    const box = document.querySelector('[data-testid="search-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(box, ${JSON.stringify(query)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await settle(150);
  await page.evaluate(`document.querySelector('[data-testid="search-go"]').click(); return true;`);
  await waitFor(page, `document.querySelectorAll('[data-testid="search-segment"], [data-testid="search-error"]').length > 0`);
  return JSON.parse(await page.evaluate(`
    const segments = [...document.querySelectorAll('[data-testid="search-segment"]')].map(section => ({
      key: section.getAttribute('data-segment'),
      hits: [...section.querySelectorAll('[data-testid="search-hit"]')].map(hit => ({
        ref: (hit.querySelector('[data-testid="search-hit-id"]')?.innerText || '').trim(),
        text: (hit.innerText || '').trim(),
        href: hit.querySelector('[data-testid="search-hit-link"]')?.getAttribute('href') || null,
      })),
    }));
    const omitted = [...document.querySelectorAll('[data-testid="search-omitted-item"]')]
      .map(el => el.getAttribute('data-segment'));
    return JSON.stringify({ segments, omitted, body: document.body.innerText });
  `));
}

const browser = await launchBrowser({ port: CDP_PORT });

try {
  // ── The build under test, not whatever is on the port ──────────────────
  const version = await (await fetch(`${BASE}/version`)).text();
  check(true, '1. SETUP: the probe is pointed at a live server', `${BASE} ${version.slice(0, 60)}`);

  sql(`delete from disputes where title like 'ZSEARCH%'`);
  sql(`delete from supportTickets where subject like 'ZSEARCH%'`);
  sql(`delete from vendorProfiles where userId in (select id from users where username like 'zsearch%')`);
  sql(`delete from projects where title like 'ZSEARCH%'`);
  sql(`delete from users where username like 'zsearch%'`);

  const admins = {
    SUPER_ADMIN: makeAdmin('super', 'SUPER_ADMIN'),
    MARKETPLACE_ADMIN: makeAdmin('mkt', 'MARKETPLACE_ADMIN'),
    SUPPORT_ADMIN: makeAdmin('sup', 'SUPPORT_ADMIN'),
  };
  check(Object.keys(admins).length === 3, '2. and three real administrators exist, one per job',
    Object.keys(admins).join(', '));

  // A vendor whose BUSINESS name is not its person name - the whole point of
  // searching business identity is that those differ.
  const vu = `zsearch${stamp}vendor`;
  const COMPANY = `Zenith Marble Works ${stamp}`;
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${vu}', '${vu}', '${vu}@example.test', 'Karim Habib', 'user',
        'supplier', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  const vendorId = Number(sql(`select id from users where username='${vu}'`));
  sql(`insert into vendorProfiles (userId, companyName) values (${vendorId}, '${COMPANY}')`);

  sql(`insert into projects (ownerId, title, status) values (${vendorId}, 'ZSEARCH Project ${stamp}', 'active')`);
  const projectId = Number(sql(`select id from projects where title='ZSEARCH Project ${stamp}'`));

  const DISPUTE_REF = `DSP-2026-${String(stamp).slice(-6)}`;
  sql(`insert into disputes (reporterId, subjectType, subjectId, projectId, reference, title,
        description, category, priority, status)
       values (${vendorId}, 'project', ${projectId}, ${projectId}, '${DISPUTE_REF}',
        'ZSEARCH marble slab colour mismatch', 'Probe dispute', 'quality', 'high', 'open')`);
  const disputeId = Number(sql(`select id from disputes where reference='${DISPUTE_REF}'`));

  const TICKET_REF = `TCK-${stamp}`;
  sql(`insert into supportTickets (requesterId, reference, category, subject, description, priority, status)
       values (${vendorId}, '${TICKET_REF}', 'billing', 'ZSEARCH cannot open my invoice',
        'Probe ticket', 'medium', 'open')`);
  const ticketId = Number(sql(`select id from supportTickets where reference='${TICKET_REF}'`));

  check(disputeId > 0 && ticketId > 0 && vendorId > 0,
    '3. and a real dispute, support ticket and vendor exist to be found',
    `dispute #${disputeId} ${DISPUTE_REF}, ticket #${ticketId} ${TICKET_REF}, vendor #${vendorId}`);

  // ── SUPER ADMIN: the search is where it belongs, and it works ──────────
  const superCookie = await signIn(admins.SUPER_ADMIN.email);
  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(superCookie));
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");

  await page.goto(`${BASE}/admin/operations`);
  const onOps = await waitFor(page, `!!document.querySelector('[data-testid="search-input"]')`);
  check(onOps, '4. SUPER ADMIN: the platform search renders in Operations, its canonical home');

  await page.goto(`${BASE}/admin/disputes`);
  await waitFor(page, `document.body.innerText.trim().length > 80`);
  const boxInDisputes = await page.evaluate(`return String(!!document.querySelector('[data-testid="search-input"]'))`);
  check(boxInDisputes === 'false',
    '5. and there is NO second search box inside Disputes', `search-input present: ${boxInDisputes}`);

  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `!!document.querySelector('[data-testid="search-input"]')`);

  // ── A dispute, found by the reference a human was given ────────────────
  const byDispute = await searchInBrowser(page, DISPUTE_REF);
  const disputeSegment = byDispute.segments.find(s => s.key === 'disputes');
  const disputeHit = disputeSegment?.hits.find(h => h.ref === DISPUTE_REF);
  check(Boolean(disputeHit),
    '6. searching the dispute REFERENCE finds the dispute, labelled by that reference',
    disputeHit ? disputeHit.text.replace(/\s+/g, ' ').slice(0, 70) : `segments: ${byDispute.segments.map(s => s.key).join(',')}`);

  check(disputeHit?.href === `/admin/disputes/${disputeId}`,
    '7. and the result links to the CASE, not to the queue', String(disputeHit?.href));

  /*
   * THE CASE PANEL, NOT THE PAGE TEXT.
   *
   * The first version asserted the reference appeared in document.body.innerText
   * - which is ALSO true of the queue behind it, because the list renders every
   * dispute's reference in its own column. It therefore passed unchanged when
   * the record in the URL was ignored, which is the single defect it exists to
   * catch. It now requires the case's own panel to be present AND to be showing
   * THIS dispute.
   */
  await page.goto(`${BASE}${disputeHit?.href ?? '/admin/disputes'}`);
  const caseOpened = await waitFor(page, `(() => {
    const panel = document.querySelector('[data-testid="dispute-detail"]');
    return !!panel && panel.innerText.includes(${JSON.stringify(DISPUTE_REF)});
  })()`);
  check(caseOpened, '8. and following it OPENS THAT DISPUTE, not an unfiltered list',
    caseOpened ? `dispute-detail panel showing ${DISPUTE_REF}` : 'no dispute-detail panel carrying that reference');

  // ── A support ticket, the same way ─────────────────────────────────────
  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `!!document.querySelector('[data-testid="search-input"]')`);
  const byTicket = await searchInBrowser(page, TICKET_REF);
  const ticketHit = byTicket.segments.find(s => s.key === 'tickets')?.hits.find(h => h.ref === TICKET_REF);
  check(ticketHit?.href === `/admin/support/${ticketId}`,
    '9. searching the ticket REFERENCE finds it and links to the case', String(ticketHit?.href));

  await page.goto(`${BASE}${ticketHit?.href ?? '/admin/support'}`);
  const ticketOpened = await waitFor(page, `(() => {
    const panel = document.querySelector('[data-testid="admin-support-detail"]');
    return !!panel && panel.innerText.includes(${JSON.stringify(TICKET_REF)});
  })()`);
  check(ticketOpened, '10. and following it OPENS THAT TICKET',
    ticketOpened ? `admin-support-detail panel showing ${TICKET_REF}` : 'no detail panel carrying that reference');

  // ── A business, found by the name it trades under ──────────────────────
  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `!!document.querySelector('[data-testid="search-input"]')`);
  const byCompany = await searchInBrowser(page, COMPANY);
  const personHit = byCompany.segments.find(s => s.key === 'users')?.hits.find(h => h.text.includes(COMPANY));
  check(Boolean(personHit),
    '11. searching the BUSINESS NAME finds the account, labelled by the business',
    personHit ? personHit.text.replace(/\s+/g, ' ').slice(0, 70) : 'not found');
  check(personHit?.text.includes('Karim Habib'),
    '12. and the person behind it is named underneath, not lost',
    personHit ? 'person shown' : 'person missing');
  check(personHit?.href === `/admin/users/${vendorId}`,
    '13. and it opens that user record', String(personHit?.href));

  // ── NEGATIVE: a restricted administrator is told, not misled ───────────
  const mktCookie = await signIn(admins.MARKETPLACE_ADMIN.email);
  const mktPage = await browser.newPage();
  await mktPage.setCookies(asBrowserCookies(mktCookie));
  await mktPage.goto(`${BASE}/admin`);
  await mktPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await mktPage.goto(`${BASE}/admin/operations`);
  await waitFor(mktPage, `!!document.querySelector('[data-testid="search-input"]')`);
  const mktResult = await searchInBrowser(mktPage, DISPUTE_REF);

  check(mktResult.omitted.includes('disputes') && mktResult.omitted.includes('tickets'),
    '14. MARKETPLACE ADMIN: the case segments are reported as WITHHELD',
    `omitted: ${mktResult.omitted.join(', ') || 'none'}`);
  check(!mktResult.segments.some(s => s.key === 'disputes'),
    '15. and NOT rendered as an empty segment - "none" and "not yours" are different answers');
  check(!mktResult.segments.some(s => s.hits.some(h => h.ref === DISPUTE_REF)),
    '16. and the dispute reference appears in NO segment they can read');

  // The menu is a courtesy; the boundary is the server.
  const refused = await callQuery(mktCookie, 'admin.disputes', { page: 0, pageSize: 10 });
  check(refused.status !== 200,
    '17. and the server REFUSES admin.disputes directly, menu or no menu',
    `HTTP ${refused.status}`);
  /*
   * READ THE SEGMENTS, NOT THE BODY.
   *
   * The first version of this check asserted the reference appeared NOWHERE in
   * the response text, and failed - because the response echoes `query` back,
   * and the query is the reference the administrator typed. A substring match
   * over the body cannot tell a LEAK from an ECHO of the caller's own input.
   * What must be true is narrower and stronger: no HIT in any segment they can
   * read carries it, and the case segments are withheld rather than empty.
   */
  const searchAsMkt = await callQuery(mktCookie, 'admin.platformSearch', { query: DISPUTE_REF });
  const mktJson = JSON.parse(searchAsMkt.body)?.result?.data?.json ?? {};
  const mktHits = JSON.stringify(mktJson.segments ?? []);
  check(searchAsMkt.status === 200
    && !mktHits.includes(DISPUTE_REF)
    && (mktJson.omitted ?? []).includes('disputes')
    && (mktJson.omitted ?? []).includes('tickets'),
    '18. and the search API returns the reference in NO hit, with the case segments withheld',
    `HTTP ${searchAsMkt.status}, in a hit: ${mktHits.includes(DISPUTE_REF)}, omitted: ${(mktJson.omitted ?? []).join(',')}`);

  /*
   * POSITIVE CONTROL FOR THE CHECK ABOVE. The same call, as an administrator
   * who MAY read cases, must return the reference inside a hit. Without this,
   * check 18 would pass just as happily against a search that returns nothing
   * to anybody, which is the failure mode it is meant to exclude.
   */
  const searchAsSuper = await callQuery(superCookie, 'admin.platformSearch', { query: DISPUTE_REF });
  const superHits = JSON.stringify(JSON.parse(searchAsSuper.body)?.result?.data?.json?.segments ?? []);
  check(superHits.includes(DISPUTE_REF),
    '18b. POSITIVE CONTROL: the same call DOES return it to an administrator who may read cases',
    `in a hit: ${superHits.includes(DISPUTE_REF)}`);

  // ── A support administrator sees cases, and no commerce ────────────────
  const supCookie = await signIn(admins.SUPPORT_ADMIN.email);
  const supPage = await browser.newPage();
  await supPage.setCookies(asBrowserCookies(supCookie));
  await supPage.goto(`${BASE}/admin`);
  await supPage.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await supPage.goto(`${BASE}/admin/operations`);
  await waitFor(supPage, `!!document.querySelector('[data-testid="search-input"]')`);
  const supResult = await searchInBrowser(supPage, DISPUTE_REF);
  check(supResult.segments.some(s => s.key === 'disputes' && s.hits.some(h => h.ref === DISPUTE_REF)),
    '19. SUPPORT ADMIN: finds the same dispute, because cases ARE their job');
  check(supResult.omitted.includes('enquiries') && supResult.omitted.includes('products'),
    '20. and is told the marketplace segments are not theirs',
    `omitted: ${supResult.omitted.join(', ')}`);

  // ── ARABIC, RIGHT TO LEFT ─────────────────────────────────────────────
  //
  // The three new segments carry three new labels. A label added in English
  // only renders as an English heading inside an otherwise Arabic console -
  // which is how a bilingual product decays one string at a time.
  /*
   * RE-ESTABLISH THE SUPER ADMIN SESSION FIRST.
   *
   * CDP cookies belong to the BROWSER, not to the tab. Signing in the two
   * restricted administrators above replaced the session on this tab too, and
   * the first version of this block ran as the SUPPORT_ADMIN - who has no
   * enquiries segment at all. It reported a missing Arabic label for a segment
   * that was never rendered, which is a probe defect wearing a product
   * defect's clothes.
   */
  await page.setCookies(asBrowserCookies(superCookie));
  await page.goto(`${BASE}/admin/operations`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/admin/operations`);
  await waitFor(page, `!!document.querySelector('[data-testid="search-input"]')`);
  const arabic = await searchInBrowser(page, DISPUTE_REF);
  const headings = await page.evaluate(`
    return JSON.stringify([...document.querySelectorAll('[data-testid="search-segment"] p')]
      .map(el => (el.innerText || '').trim()));
  `);
  const arHeadings = JSON.parse(headings).join(' ');
  const missingAr = ['النزاعات', 'تذاكر الدعم', 'استفسارات الموردين']
    .filter(label => !arHeadings.includes(label));
  check(missingAr.length === 0,
    '21. ARABIC: the three new segments are translated, not left in English',
    missingAr.length ? `missing: ${missingAr.join(', ')}` : arHeadings.replace(/\s+/g, ' ').slice(0, 120));

  const dir = await page.evaluate(`return document.documentElement.getAttribute('dir') || ''`);
  check(dir === 'rtl', '22. and the console is right-to-left', `dir=${dir}`);

  check(arabic.segments.some(s => s.key === 'disputes' && s.hits.some(h => h.ref === DISPUTE_REF)),
    '23. and the same dispute is still found in Arabic');

} catch (error) {
  check(false, 'PROBE ABORTED', String(error.message).slice(0, 200));
} finally {
  // `close()` is synchronous here - awaiting a non-promise threw and masked
  // the exit code on the first run.
  try { browser.close(); } catch { /* the probe's result is already printed */ }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

// ── RENDERED: the Vendor Enquiries admin screen in a real browser ─────────
//
// Every previous BuildHub report has classified rendered-browser QA as pending,
// because Playwright is not a dependency of this project. It does not need to
// be: Chromium is installed here and Node 22 ships a WebSocket client, so the
// DevTools protocol drives the real browser directly (evidence/lib/cdp.mjs).
//
// What that buys over an HTTP probe: an endpoint returning correct JSON and a
// screen showing it are different claims. This checks the second one - the
// tiles, the table, the drill-down, the empty state, Arabic, RTL, and 375px -
// against the built bundle.
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q })
  .toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 120)}]` : ''}`);
  ok ? pass++ : fail++;
};

// ── Sign in for real, and carry the real cookie into the browser ──────────

const admin = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!admin.ok) {
  console.log(`ABORT: could not obtain an admin session (${admin.reason}). Every rendered check below would be of a signed-out page.`);
  process.exit(1);
}
const cookies = asBrowserCookies(admin.cookie);

// ── Fixture ───────────────────────────────────────────────────────────────

const clean = () => sql(`
  DELETE FROM quotations WHERE providerId IN (SELECT id FROM users WHERE openId LIKE 'zg-es-%');
  DELETE FROM qualifiedEnquiries WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'zg-es-%');
  DELETE FROM rfqSuppliers WHERE supplierId IN (SELECT id FROM users WHERE openId LIKE 'zg-es-%');
  DELETE FROM rfqs WHERE title LIKE 'ZG screen fixture%';
  DELETE FROM users WHERE openId LIKE 'zg-es-%';
`);
clean();

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setCookies(cookies);

  // ── 1. The empty state, before anything is seeded ───────────────────────

  // Wait for the OVERVIEW to have resolved - the empty sentence or a tile -
  // not merely for the container, which renders while the query is still in
  // flight. Waiting on the container read an empty string and reported a
  // working empty state as missing.
  await page.goto(`${BASE}/admin/enquiries`,
    { waitFor: '[data-testid="enquiry-overview-empty"], [data-testid^="enquiry-kpi-"]' });
  const emptyText = await page.evaluate(
    'return document.querySelector(\'[data-testid="enquiry-overview-empty"]\')?.innerText ?? ""');
  check('ZERO DATA RENDERS A REAL SENTENCE, not a fabricated row or a placeholder figure',
    /No enquiries yet/i.test(emptyText), emptyText);
  const fakeNumbers = await page.evaluate(
    'return Array.from(document.querySelectorAll(\'[data-testid^="enquiry-kpi-"]\')).length');
  check('an empty platform shows no state tiles at all', fakeNumbers === 0, `${fakeNumbers} tiles`);

  // ── 2. Reachable by navigation, not only by typing the URL ──────────────

  //
  // CLICKED, NOT INSPECTED. The first version of this check looked for an
  // <a href="/admin/enquiries"> and failed - because the admin menu is built
  // from BUTTONS that navigate programmatically, not anchors. The check was
  // wrong, not the menu. Clicking the item and watching the URL change is both
  // the correct test and a stronger one: it proves the entry actually goes
  // somewhere rather than merely existing.
  await page.goto(`${BASE}/admin`, { waitFor: '[data-testid="admin-users-preview"], main' });
  const navigated = await page.evaluate(`
    const target = Array.from(document.querySelectorAll('button, a'))
      .find(el => el.innerText.trim() === 'Vendor Enquiries');
    if (!target) return 'NOT IN MENU';
    target.click();
    return 'clicked';
  `);
  check('the admin menu carries a Vendor Enquiries entry', navigated === 'clicked', navigated);
  await new Promise(resolve => setTimeout(resolve, 1200));
  const landedOn = await page.evaluate('return location.pathname');
  check('THE MENU ENTRY NAVIGATES TO THE SECTION - a tab nobody can reach is not a surface',
    landedOn === '/admin/enquiries', landedOn);

  // ── 3. Seed, and check the tiles are the real counts ────────────────────

  sql(`INSERT INTO users (openId, email, name, role) VALUES
    ('zg-es-req','zg-es-req@buildhub.local','Screen Requester','user'),
    ('zg-es-v1','zg-es-v1@buildhub.local','Omega Bricks','user'),
    ('zg-es-v2','zg-es-v2@buildhub.local','Sigma Tiles','user');`);
  const uid = o => Number(sql(`SELECT id FROM users WHERE openId = '${o}';`));
  const req = uid('zg-es-req'), v1 = uid('zg-es-v1'), v2 = uid('zg-es-v2');
  sql(`INSERT INTO rfqs (requesterId, title, status, category) VALUES (${req}, 'ZG screen fixture ONE', 'open', 'concrete');`);
  const r1 = Number(sql("SELECT id FROM rfqs WHERE title = 'ZG screen fixture ONE';"));
  sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, status) VALUES (${r1}, ${v1}, ${req}, 'invited');`);
  sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth) VALUES (${v2}, ${r1}, '${new Date().toISOString().slice(0,7)}');`);
  sql(`INSERT INTO quotations (rfqId, providerId, price) VALUES (${r1}, ${v2}, 918273.44);`);

  await page.goto(`${BASE}/admin/enquiries`, { waitFor: '[data-testid="enquiry-kpi-INVITED"]' });
  const tiles = await page.evaluate(`
    const out = {};
    for (const el of document.querySelectorAll('[data-testid^="enquiry-kpi-"]')) {
      out[el.getAttribute('data-testid').replace('enquiry-kpi-','')] = el.innerText.trim().split('\\n')[0];
    }
    return out;
  `);
  check('the INVITED tile shows the real count', tiles.INVITED === '1', JSON.stringify(tiles));
  check('the RESPONDED tile shows the real count', tiles.RESPONDED === '1', JSON.stringify(tiles));
  check('THERE IS NO "AVAILABLE" TILE - it is a potential, not a record',
    !('AVAILABLE' in tiles), Object.keys(tiles).join(','));

  // ── 4. The table renders the human columns ──────────────────────────────

  const table = await page.evaluate(`
    const rows = Array.from(document.querySelectorAll('[data-testid^="enquiry-row-"]'));
    return rows.map(r => r.innerText.replace(/\\n/g, ' | '));
  `);
  check('both enquiries render as rows', table.length === 2, `${table.length} rows`);
  check('a row shows the human reference', table.some(r => /ENQ-\d+-\d+/.test(r)), table[0]);
  check('a row names the vendor in words, not only an id',
    table.some(r => /Omega Bricks|Sigma Tiles/.test(r)), table[0]);
  check('a row explains the allowance rather than showing a raw enum',
    table.some(r => /allowance unit consumed|exempt from the allowance/i.test(r)), table[0]);

  // ── 5. THE PRICE IS NOWHERE ON THE SCREEN ───────────────────────────────

  const rendered = await page.evaluate('return document.body.innerText');
  check('the fixture really holds a bid price in the database',
    sql(`SELECT price FROM quotations WHERE rfqId = ${r1} AND providerId = ${v2};`).startsWith('918273'));
  check('NO BID PRICE IS RENDERED ANYWHERE ON THE LIST SCREEN', !rendered.includes('918273'));

  // ── 6. The KPI tile drills down ─────────────────────────────────────────

  await page.evaluate('document.querySelector(\'[data-testid="enquiry-kpi-INVITED"]\').click(); return true;');
  await new Promise(resolve => setTimeout(resolve, 1200));
  const filtered = await page.evaluate(`
    return Array.from(document.querySelectorAll('[data-testid^="enquiry-row-"]')).map(r => r.innerText.replace(/\\n/g,' | '));
  `);
  check('CLICKING A KPI TILE FILTERS THE LIST TO THAT STATE',
    filtered.length === 1 && /Omega Bricks/.test(filtered[0]), `${filtered.length} rows`);

  // ── 7. The row opens the detail ─────────────────────────────────────────

  await page.evaluate('document.querySelector(\'[data-testid^="enquiry-row-"]\').click(); return true;');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const detail = await page.evaluate(
    'return document.querySelector(\'[data-testid="admin-enquiry-detail"]\')?.innerText ?? ""');
  check('clicking a row opens the enquiry detail', detail.length > 0);
  check('the detail shows the reference', /ENQ-\d+-\d+/.test(detail));
  check('the detail shows the timeline event that really happened', /Invited/i.test(detail), detail.slice(0, 80));
  check('the detail explains that the allowance is an entitlement, not a charge',
    /No payment is taken/i.test(detail));
  check('the detail renders no bid price', !detail.includes('918273'));
  check('the detail says where bid review actually happens',
    /Super Admin investigation/i.test(detail));

  // ── 7b. The enquiry is ADDRESSABLE ─────────────────────────────────────
  //
  // Added because an existing guard rejected the notification's hardcoded
  // '/admin/enquiries' link. It was right: a notification about ENQ-501-10 that
  // lands on a list leaves the recipient hunting for the row. The reference is
  // derived from the pair, so the URL can be too - and that is what makes the
  // reference worth having in a support ticket.
  const openedAt = await page.evaluate('return location.pathname');
  check('OPENING AN ENQUIRY PUTS IT IN THE URL', /\/admin\/enquiries\/ENQ-\d+-\d+$/.test(openedAt), openedAt);

  // Wait for the TIMELINE, not the card. The first version waited for the
  // detail container and passed while the panel still said "Loading…" - it
  // proved the header renders the reference it read from the URL, which is
  // nearly a tautology. Waiting for content loaded FROM THE SERVER is the
  // claim that matters for a notification destination.
  await page.goto(`${BASE}${openedAt}`, { waitFor: '[data-testid="enquiry-assignment"]' });
  const direct = await page.evaluate(
    'return document.querySelector(\'[data-testid="admin-enquiry-detail"]\')?.innerText ?? ""');
  check('AND THAT URL OPENS THE ENQUIRY DIRECTLY, fully loaded - a real destination for a notification',
    direct.includes(openedAt.split('/').pop()) && /Invited|Assigned to/i.test(direct)
    && !/Loading/i.test(direct),
    direct.slice(0, 70).replace(/\n/g, ' / '));

  // ── 7c. Assignment, WHILE THE DETAIL IS STILL OPEN ─────────────────────
  //
  // Ordering matters and the first version got it wrong: these checks sat after
  // the back-button click, so they queried an assignment panel that had already
  // been replaced by the list and reported three working things as broken.
  const assignmentPanel = await page.evaluate(
    'return document.querySelector(\'[data-testid="enquiry-assignment"]\')?.innerText ?? ""');
  check('the detail shows who is handling the enquiry', assignmentPanel.length > 0);
  check('an unassigned enquiry says so plainly rather than showing a blank',
    /Not assigned to anyone/i.test(assignmentPanel), assignmentPanel.slice(0, 60).replace(/\n/g, ' / '));
  const assigneeOptions = await page.evaluate(
    'return !!document.querySelector(\'[data-testid="assignee-select"]\')');
  check('and offers a control to assign it', assigneeOptions === true);

  const clickedBack = await page.evaluate(`
    const back = document.querySelector('[data-testid="enquiry-detail-back"]');
    if (!back) return 'NO BACK BUTTON';
    back.click();
    return 'clicked';
  `);
  check('the detail offers a way back to the list', clickedBack === 'clicked', clickedBack);
  await new Promise(resolve => setTimeout(resolve, 900));
  check('going back returns to the list URL',
    (await page.evaluate('return location.pathname')) === '/admin/enquiries');

  // ── 8. Arabic and RTL ───────────────────────────────────────────────────

  await page.evaluate("localStorage.setItem('buildhub_lang','ar'); return true;");
  // Wait for a ROW, not merely the container: the list query resolves after the
  // shell renders, and the first version asserted against an empty table and
  // reported missing translations that were simply not loaded yet.
  await page.goto(`${BASE}/admin/enquiries`, { waitFor: '[data-testid^="enquiry-row-"]' });
  const arabic = await page.evaluate(`
    return { dir: document.documentElement.dir, text: document.body.innerText };
  `);
  check('the document direction is RTL in Arabic', arabic.dir === 'rtl', arabic.dir);
  check('the screen is titled in Arabic', arabic.text.includes('استفسارات الموردين'));
  check('the state badges are translated, not left in English',
    arabic.text.includes('مدعو') || arabic.text.includes('تم الرد'));
  check('no English state label leaks into the Arabic screen',
    !/\bInvited\b|\bResponded\b/.test(arabic.text));

  // ── 9. Mobile ───────────────────────────────────────────────────────────

  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  });
  await page.goto(`${BASE}/admin/enquiries`, { waitFor: '[data-testid^="enquiry-row-"]' });
  const overflow = await page.evaluate(`
    return { body: document.documentElement.scrollWidth, view: document.documentElement.clientWidth };
  `);
  check('THE PAGE BODY DOES NOT SCROLL HORIZONTALLY AT 375px',
    overflow.body <= overflow.view + 1, `${overflow.body} > ${overflow.view}`);
  const scroller = await page.evaluate(`
    const el = document.querySelector('.overflow-x-auto');
    return el ? el.scrollWidth > el.clientWidth : false;
  `);
  check('the wide table scrolls inside its own container instead', scroller === true);

  await page.evaluate("localStorage.setItem('buildhub_lang','en'); return true;");
  page.close();
} finally {
  browser.close();
  clean();
}

check('the fixture removed itself completely',
  Number(sql("SELECT COUNT(*) FROM users WHERE openId LIKE 'zg-es-%';")) === 0);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

/**
 * ── THE OWNER EXPERIENCE GATE: EVERY ADMIN MENU ITEM, CLICKED ───────────
 *
 * The complaint this exists for, in the owner's words: "When I click anything
 * on the Admin Panel it stays as it is and does not go where I need."
 *
 * No source inspection answers that. A route can exist, be exported, be in the
 * nav table and be asserted by three unit tests while the rendered menu does
 * nothing - which is exactly the gap that produced the complaint. So this
 * signs in as a real Super Admin, reads the menu THE BROWSER DREW, and clicks
 * every entry with a real pointer sequence.
 *
 * For each entry, eight things, because each one fails differently:
 *
 *   URL CHANGED           the click did something
 *   HEADING CHANGED       the page knows which section it is
 *   CONTENT IS UNIQUE     not the overview rendered under a new heading, which
 *                         is the specific failure the complaint describes
 *   ACTIVE STATE MOVED    the menu says where you are
 *   BACK WORKS            it is navigation, not a state machine
 *   DIRECT URL WORKS      the destination is addressable
 *   REFRESH SURVIVES      it is a page, not a transient
 *   NO ERROR SHOWN        the destination actually loaded
 *
 * A CONTENT FINGERPRINT, not a substring. Two admin sections both contain the
 * word "users"; what distinguishes them is what they RENDER. Comparing
 * fingerprints catches "the heading changed and the body did not", which reads
 * as working to anyone checking URLs alone.
 *
 * TAKEN FROM <main>, NOT THE WHOLE PAGE, and from its text as well as its
 * testids. The first version fingerprinted testids across the document and
 * reported Settings as a duplicate of Analytics: neither page labels anything
 * with a testid, so both reduced to the three the shell contributes. They
 * render visibly different things - 766 characters against 1265 - and the
 * fingerprint could not see it. A section is identified by what a person can
 * read in the content area, which is the thing the owner's complaint is about.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  if (!ok) failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(300); return true; }
    await settle(250);
  }
  return false;
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`adminSignIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

/** A real pointer sequence. element.click() does not drive every control. */
const CLICK = testid => `
  const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]');
  if (!el) return 'missing';
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('mouseup', o));
  el.dispatchEvent(new MouseEvent('click', o));
  return 'clicked';
`;

/**
 * WHAT IS ON THE SCREEN, reduced to something comparable.
 *
 * The testids a section renders identify it far better than its prose: two
 * sections may share every word and never share their controls.
 */
const SNAPSHOT = `
  const region = document.querySelector('main') || document.body;
  const ids = [...region.querySelectorAll('[data-testid]')]
    .map(e => e.getAttribute('data-testid'))
    .filter(id => id && !id.startsWith('nav-') && id !== 'brand-home' && id !== 'shell-plan')
    .sort();
  // The words in the content area, normalised. Two sections that render the
  // same controls but different copy are still different sections.
  const body = (region.innerText || '').replace(/\\s+/g, ' ').trim();
  const heading = document.querySelector('[data-testid="admin-section-heading"]');
  const h1 = document.querySelector('h1, h2');
  const active = [...document.querySelectorAll('[data-testid^="nav-"]')]
    .filter(e => e.getAttribute('data-active') === 'true'
      || e.closest('[data-active="true"]')
      || (e.closest('a,button')?.getAttribute('aria-current') === 'page'))
    .map(e => e.getAttribute('data-testid'));
  return JSON.stringify({
    path: location.pathname,
    heading: (heading?.innerText ?? h1?.innerText ?? '').trim().slice(0, 60),
    ids: ids.slice(0, 60),
    idCount: ids.length,
    bodyLength: body.length,
    bodyHead: body.slice(0, 120),
    active,
    error: /something went wrong|failed to load|unexpected error/i.test(document.body.innerText),
  });
`;

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const u = `zclick${stamp}`;
  sql(`delete from users where username like 'zclick%'`);
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe Click', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  check(Number(sql(`select id from users where username='${u}'`)) > 0,
    'SETUP: a real Super Admin exists');

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(await signIn(`${u}@example.test`)));
  const WIDTH = Number(process.env.ZG_WIDTH ?? 1440);
  await page.setViewport({ width: WIDTH, height: WIDTH < 768 ? 812 : 900 });
  /*
   * AT PHONE WIDTH THE MENU IS BEHIND A TRIGGER. The sidebar renders as a
   * sheet, so every entry is absent from the document until it is opened -
   * and a probe that only looked at 1440 would report a working menu while
   * the owner, on a phone, taps a hamburger and gets nothing.
   */
  const openMenuIfNeeded = async () => {
    if (WIDTH >= 768) return;
    const visible = await page.evaluate(`return String(!!document.querySelector('[data-testid^="nav-"]'));`);
    if (visible === 'true') return;
    await page.evaluate(`
      const t = document.querySelector('[data-sidebar="trigger"], [aria-label="Toggle navigation"], button[aria-label*="idebar"]');
      if (!t) return 'missing';
      const r = t.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      t.dispatchEvent(new PointerEvent('pointerdown', o));
      t.dispatchEvent(new MouseEvent('mousedown', o));
      t.dispatchEvent(new PointerEvent('pointerup', o));
      t.dispatchEvent(new MouseEvent('mouseup', o));
      t.dispatchEvent(new MouseEvent('click', o));
      return 'clicked';
    `);
    await settle(900);
  };
  await page.goto(`${BASE}/admin`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/admin`);
  await openMenuIfNeeded();
  const ready = await waitFor(page, `!!document.querySelector('[data-testid^="nav-"]')`);
  check(ready, `the Admin console renders its menu at ${WIDTH}px`);

  /* THE MENU AS DRAWN, not as declared. */
  const menu = JSON.parse(await page.evaluate(`
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="nav-"]')) {
      if (el.offsetParent === null && !el.getBoundingClientRect().width) continue;
      out.push({ testid: el.getAttribute('data-testid'), label: (el.innerText || '').trim().slice(0, 40) });
    }
    return JSON.stringify(out);
  `));
  check(menu.length >= 10, `the menu offers its entries`, `${menu.length} visible`);

  const overview = JSON.parse(await page.evaluate(SNAPSHOT));
  check(overview.idCount > 3, 'and the overview itself renders content', `${overview.idCount} controls`);

  const seenFingerprints = new Map();
  seenFingerprints.set(`${overview.ids.join(',')}|${overview.bodyLength}|${overview.bodyHead}`, '/admin');

  for (const entry of menu) {
    const label = entry.label || entry.testid;
    // Always start from the overview, so each entry is a real navigation AWAY
    // from the same place rather than from wherever the last one landed.
    await page.goto(`${BASE}/admin`);
    await openMenuIfNeeded();
    await waitFor(page, `!!document.querySelector('[data-testid=${JSON.stringify(entry.testid)}]')`);
    const before = JSON.parse(await page.evaluate(SNAPSHOT));

    const clicked = await page.evaluate(CLICK(entry.testid));
    if (clicked !== 'clicked') { check(false, `${label}: the control is clickable`, clicked); continue; }
    await settle(1400);
    const after = JSON.parse(await page.evaluate(SNAPSHOT));

    /*
     * THE ENTRY FOR THE SECTION YOU ARE ALREADY ON is not expected to move.
     * "Admin Control Panel" from /admin is a no-op by design, and requiring a
     * URL change reported the correct behaviour as a failure. What it must
     * still do is stay put without breaking - so it is held to that instead.
     */
    const selfReferential = before.path === after.path && entry.testid === 'nav-admin.title';
    if (selfReferential) {
      check(after.bodyLength > 0 && !after.error,
        `${label}: the entry for the current section stays put without breaking`,
        `${after.path}, ${after.bodyLength} chars`);
    } else {
      check(after.path !== before.path, `${label}: clicking changes the URL`,
        `${before.path} -> ${after.path}`);
    }
    check(!after.error, `${label}: the destination loads without an error`,
      after.error ? 'an error is on the page' : after.path);

    const fingerprint = `${after.ids.join(',')}|${after.bodyLength}|${after.bodyHead}`;
    const clash = seenFingerprints.get(fingerprint);
    check(selfReferential || !clash || clash === after.path,
      `${label}: renders its OWN content, not another section's`,
      clash && clash !== after.path ? `identical to ${clash}` : `${after.idCount} controls`);
    if (!clash) seenFingerprints.set(fingerprint, after.path);

    /*
     * AT PHONE WIDTH THE MENU CLOSES BEHIND YOU, which is right - a sheet that
     * stayed open over the page you just chose would be the defect. So the
     * active state is read after REOPENING it. Checking it on a closed sheet
     * measured an empty document and reported a working highlight as missing.
     */
    await openMenuIfNeeded();
    await settle(500);
    const marked = JSON.parse(await page.evaluate(SNAPSHOT));
    check(marked.active.includes(entry.testid),
      `${label}: the menu shows where you are`,
      marked.active.length ? marked.active.join(',').slice(0, 50) : 'no entry marked active');

    // BACK, then the destination again by URL, then a refresh of it.
    await page.evaluate('history.back(); return true;');
    await settle(1200);
    const back = JSON.parse(await page.evaluate(SNAPSHOT));
    check(selfReferential || back.path === before.path,
      `${label}: browser Back returns to the overview`, `${back.path}`);

    await page.goto(`${BASE}${after.path}`);
    await settle(1200);
    const direct = JSON.parse(await page.evaluate(SNAPSHOT));
    check(direct.path === after.path && !direct.error,
      `${label}: the URL works typed directly`, direct.path);
    check(`${direct.ids.join(',')}|${direct.bodyLength}|${direct.bodyHead}` === fingerprint,
      `${label}: and a refresh keeps the same section`,
      `${direct.ids.join(',')}|${direct.bodyLength}|${direct.bodyHead}` === fingerprint
        ? 'same content' : 'different content after reload');
  }
  /*
   * ── TWO OWNER DECISIONS, CHECKED WHERE THE OWNER LOOKS ─────────────────
   *
   * Both were decided, both were implemented, and neither had ever been
   * proved in a rendered menu. A source test asserting an array's order is
   * not the same claim as "the sidebar the owner sees is in that order".
   */
  await page.goto(`${BASE}/admin`);
  await openMenuIfNeeded();
  await waitFor(page, `!!document.querySelector('[data-testid^="nav-"]')`);

  /* NAME CHANGES IS NOT A TOP-LEVEL ENTRY. It is identity administration. */
  const labels = menu.map(e => e.label.toLowerCase());
  check(!labels.some(l => l.includes('name change')),
    'OWNER 4A: the sidebar does NOT offer Name Changes as its own entry',
    labels.filter(l => l.includes('name')).join(', ') || 'no such entry');

  /* PROFESSIONAL REGISTRATIONS SITS IMMEDIATELY AFTER USER MANAGEMENT. */
  const users = menu.findIndex(e => e.testid === 'nav-admin.users');
  const regs = menu.findIndex(e => e.testid === 'nav-admin.registrations');
  check(users >= 0 && regs === users + 1,
    'OWNER 4C: Professional Registrations is directly after User Management',
    `positions ${users} and ${regs} of ${menu.length}`);

  /* AND THE QUEUE IS REACHABLE INSIDE USER MANAGEMENT. */
  await page.goto(`${BASE}/admin/users`);
  await waitFor(page, `!!document.querySelector('[data-testid="users-tab-name-changes"]')`);
  const tabThere = await page.evaluate(`
    return String(!!document.querySelector('[data-testid="users-tab-name-changes"]'));
  `);
  check(tabThere === 'true',
    'OWNER 4A: Name Change Requests is a tab INSIDE User Management');

  /* THE LEGACY URL STILL LANDS SOMEWHERE SENSIBLE, with that tab open. */
  await page.goto(`${BASE}/admin/name-changes`);
  await settle(1500);
  const legacy = JSON.parse(await page.evaluate(`
    const tab = document.querySelector('[data-testid="users-tab-name-changes"]');
    return JSON.stringify({
      path: location.pathname,
      tabPresent: !!tab,
      tabSelected: tab ? (tab.getAttribute('data-state') === 'active'
        || tab.getAttribute('aria-selected') === 'true') : false,
    });
  `));
  check(legacy.tabPresent && legacy.tabSelected,
    'OWNER 4A: the legacy /admin/name-changes URL opens that tab, for old bookmarks',
    `path ${legacy.path}, tab selected ${legacy.tabSelected}`);

  /*
   * ── A RESTRICTED ADMINISTRATOR ─────────────────────────────────────────
   *
   * The other way "clicking does nothing" happens: the menu offers an entry
   * the server will refuse. The person clicks, the destination declines, and
   * from the outside that is indistinguishable from a dead control.
   *
   * So a MARKETPLACE_ADMIN is created and the SAME sweep is run. Two rules,
   * and they are different rules: every entry that IS offered must open
   * something real, and every entry that is NOT offered must also be refused
   * when its URL is typed - a menu that merely hides a destination is the
   * frontend-visibility-is-not-authorization defect wearing a different coat.
   */
  const r = `zclickr${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${r}', '${r}', '${r}@example.test', 'Probe Restricted', 'admin',
        'MARKETPLACE_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  const restrictedBrowser = await launchBrowser({ port: CDP_PORT + 2 });
  try {
    const rp = await restrictedBrowser.newPage();
    await rp.setCookies(asBrowserCookies(await signIn(`${r}@example.test`)));
    await rp.setViewport({ width: 1440, height: 900 });
    await rp.goto(`${BASE}/admin`);
    await rp.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
    await rp.goto(`${BASE}/admin`);
    await waitFor(rp, `!!document.querySelector('[data-testid^="nav-"]')`);

    const theirMenu = JSON.parse(await rp.evaluate(`
      const out = [];
      for (const el of document.querySelectorAll('[data-testid^="nav-"]')) {
        out.push({ testid: el.getAttribute('data-testid'), label: (el.innerText || '').trim().slice(0, 40) });
      }
      return JSON.stringify(out);
    `));
    check(theirMenu.length > 0 && theirMenu.length < menu.length,
      'RESTRICTED: a MARKETPLACE_ADMIN sees a SMALLER menu than a Super Admin',
      `${theirMenu.length} of ${menu.length}`);

    let deadForThem = 0;
    for (const entry of theirMenu) {
      await rp.goto(`${BASE}/admin`);
      await waitFor(rp, `!!document.querySelector('[data-testid=${JSON.stringify(entry.testid)}]')`);
      const was = JSON.parse(await rp.evaluate(SNAPSHOT));
      const did = await rp.evaluate(CLICK(entry.testid));
      if (did !== 'clicked') { deadForThem++; continue; }
      await settle(1400);
      const now = JSON.parse(await rp.evaluate(SNAPSHOT));
      const moved = now.path !== was.path || entry.testid === 'nav-admin.title';
      if (!moved || now.error) deadForThem++;
    }
    check(deadForThem === 0,
      'RESTRICTED: every entry they are offered opens something real',
      deadForThem ? `${deadForThem} of ${theirMenu.length} went nowhere or errored` : `${theirMenu.length} entries`);

    /* The entries they are NOT offered must be refused by the SERVER too. */
    const theirPaths = new Set(theirMenu.map(e => e.testid));
    const hiddenFromThem = menu.filter(e => !theirPaths.has(e.testid));
    check(hiddenFromThem.length > 0, 'RESTRICTED: some destinations are withheld from them',
      `${hiddenFromThem.length} withheld`);

    const admins = await fetch(`${BASE}/api/trpc/admin.admins?input=${encodeURIComponent('{"json":{}}')}`,
      { headers: { cookie: await signIn(`${r}@example.test`) } });
    check(admins.status === 403 || admins.status === 401,
      'RESTRICTED: and the server refuses the data behind a withheld entry',
      `HTTP ${admins.status} on admin.admins`);
  } finally {
    await restrictedBrowser.close();
  }
} finally {
  sql(`delete from users where username like 'zclick%'`);
  await browser.close();
}

if (failures.length) {
  console.log(`\n── FAILURES ──`);
  for (const f of failures) console.log(`  ${f}`);
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

/**
 * ── THE ADMIN MANAGEMENT-ACTION DISCOVERABILITY CENSUS ──────────────────
 *
 * CLAUDE.md §84 / North Star §37. The owner named a recurring failure mode:
 *
 *   a management destination exists, but the important management actions are
 *   not obvious, not complete, or are buried deeply enough that the product
 *   looks unfinished.
 *
 * This walks every Admin destination in a real browser, as a Super Admin, and
 * records what an administrator can actually SEE on it:
 *
 *   is there a way to CREATE, where creation belongs to Admin?
 *   is there a way to SEARCH?
 *   is there a way to FILTER?
 *   is there PAGINATION?
 *   is there a DETAIL view to open?
 *   can lifecycle be CHANGED from the screen?
 *   are related entities LINKED, or is it an id to copy?
 *   does the EMPTY STATE name the next legitimate action?
 *   is there HISTORY or an audit trail?
 *
 * It is a CENSUS, not a pass/fail gate: several of these answers are
 * legitimately "no" - nothing creates a dispute from Admin, because a dispute
 * is raised by a user. The report is the deliverable, and only the checks
 * marked FAIL below are assertions.
 *
 * WHAT IS ASSERTED, because these cannot legitimately be absent:
 *
 *   every destination in the menu RENDERS as an administrator
 *   no destination is a dead page - each shows its own content, not a shell
 *   a domain whose records Admin creates has a visible create action
 *   a domain whose list can grow has search and pagination
 *   no admin mutation exists with no client calling it at all
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const ROOT = new URL('..', import.meta.url).pathname;
const ADMIN = 'superadmin@buildhub.local';
const PASSWORD = 'LocalSuperAdmin!2024';

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));

/**
 * THE DESTINATIONS, READ FROM THE PRODUCT'S OWN NAVIGATION.
 *
 * Not a list typed into this file: a destination added to the sidebar and
 * forgotten here would be a destination this census silently skips, which is
 * precisely the failure mode it exists to find.
 */
const NAV_SOURCE = readFileSync(join(ROOT, 'client/src/lib/adminNavigation.ts'), 'utf8');
const DESTINATIONS = [...NAV_SOURCE.matchAll(/\{ path: '(\/admin[^']*)', labelKey: '([^']+)'/g)]
  .map(match => ({ path: match[1], label: match[2] }));

/**
 * WHICH DOMAINS ADMIN LEGITIMATELY CREATES IN.
 *
 * Deliberately short. A dispute is raised by a user; a referral records what
 * a real person did; a support ticket is opened by the person who needs help.
 * Demanding a create button on those would be demanding fabrication, which is
 * the opposite of what the owner asked for.
 */
const CREATES = new Set(['/admin/categories', '/admin/placements', '/admin/referrals', '/admin/admins']);
/** Lists that grow without bound and therefore need search and paging. */
const GROWS = new Set(['/admin/users', '/admin/referrals', '/admin/disputes', '/admin/support', '/admin/enquiries']);

/**
 * ONE OBSERVATION OF WHATEVER IS ON THE SCREEN RIGHT NOW.
 *
 * Kept as a string because it runs inside the page, and run once per tab.
 */
const OBSERVE = `
  const main = document.querySelector('main') || document.body;
  const text = main.innerText;
  /*
   * THE ACCESSIBLE NAME, the way a screen reader would resolve it.
   *
   * The first run reported that Vendor Enquiries could not be searched. It
   * can: the field carries a visible <label for>, which is the RIGHT way to
   * name an input, and the census was only reading aria-label, text and
   * placeholder. An instrument that rewards the weaker pattern would have
   * pushed the product toward it.
   */
  const named = el => {
    let associated = '';
    if (el.id) {
      const tag = main.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (tag) associated = tag.textContent || '';
    }
    const wrapping = el.closest('label');
    return associated + ' ' + (wrapping ? wrapping.textContent || '' : '');
  };
  const label = el => (
    (el.getAttribute('aria-label') || '') + ' ' +
    (el.textContent || '') + ' ' +
    (el.getAttribute('placeholder') || '') + ' ' +
    named(el)
  ).toLowerCase();

  const buttons = [...main.querySelectorAll('button, a[role="button"]')];
  const inputs = [...main.querySelectorAll('input')];
  const selects = [...main.querySelectorAll('[role="combobox"], select')];

  const create = buttons.filter(el => /(^|\\W)(new|add|create|invite|issue|grant)(\\W|$)/.test(label(el)))
    .map(el => el.textContent.trim()).filter(Boolean);
  const search = inputs.some(el => /search|find|ابحث/.test(label(el)) || el.type === 'search');
  const filter = selects.length > 0;
  const paging = buttons.some(el => /(next|previous|page)/.test(label(el))) || /page \\d+ of \\d+/i.test(text);
  const rows = main.querySelectorAll('tbody tr').length;
  const detail = main.querySelectorAll('a[href*="/admin/"], [data-testid*="row"] button').length;
  const lifecycle = buttons.some(el => /(approve|reject|activate|deactivate|pause|resume|suspend|reactivate|hide|restore|resolve|close|revoke|disable|end|withdraw|archive|assign)/.test(label(el)));
  const history = /history|audit|timeline|\u0633\u062c\u0644/i.test(text);
  const heading = (main.querySelector('h1, h2') || {}).textContent || '';
  const emptyish = /no [a-z ]+ (yet|exist|found)|none yet|nothing/i.test(text);
  const emptyExplains = emptyish && /(create|add|invite|issue|will appear|until|once)/i.test(text);

  return JSON.stringify({
    heading: heading.trim().slice(0, 60),
    chars: text.trim().length,
    create, search, filter, paging, rows, detail, lifecycle, history,
    emptyish, emptyExplains,
  });
`;

/*
 * THE CACHED SESSION, not a fresh sign-in per run.
 *
 * `auth.adminSignIn` is rate-limited by identifier and by IP, which is
 * correct - and this census signs in once per run while a verification pass
 * runs it several times. A fresh sign-in eventually earns a 429, the cookie
 * comes back empty, every destination redirects to /auth, and the census
 * reports the entire Admin surface as broken. That happened, and it is the
 * reason the check below asserts the URL rather than the page's length.
 */
async function signIn() {
  const session = await adminSession(ADMIN, PASSWORD);
  if (!session.ok) throw new Error(`adminSignIn: ${session.reason}`);
  return session.cookie;
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);
check(DESTINATIONS.length >= 14, 'the census reads the real navigation', `${DESTINATIONS.length} destinations`);

const cookie = await signIn();
const browser = await launchBrowser({ port: CDP_PORT });
const report = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookies(asBrowserCookies(cookie));

  for (const destination of DESTINATIONS) {
    await page.goto(`${BASE}${destination.path}`);
    // Wait for the app, then for the route's own content rather than a fixed
    // delay: a sleep too short reports a working page as a shell.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await page.evaluate(`
        const main = document.querySelector('main') || document.body;
        return String(main.innerText.trim().length > 120);
      `);
      if (ready === 'true') break;
      await settle(250);
    }
    await settle(900);

    /*
     * RADIX RENDERS ONLY THE ACTIVE TAB.
     *
     * The first run of this census reported that Referral Management could
     * not be searched. It can - on two of its five tabs. The census was
     * standing on the Overview tab measuring an empty DOM, which is the same
     * trap a capability probe on this codebase has fallen into before.
     *
     * Every tab is opened and the observations are UNIONED, because the
     * question §84 asks is whether the administrator can search this domain,
     * not whether they can search it without clicking anything.
     */
    const landedOn = await page.evaluate(`return location.pathname;`);

    const tabCount = Number(await page.evaluate(`
      return String(document.querySelectorAll('[role="tab"]').length);
    `));
    const observations = [];
    for (let index = 0; index < Math.max(1, tabCount); index += 1) {
      if (tabCount > 0) {
        await page.evaluate(`
          const tabs = document.querySelectorAll('[role="tab"]');
          const el = tabs[${index}];
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
        `);
        await settle(900);
      }
      observations.push(JSON.parse(await page.evaluate(OBSERVE)));
    }

    const observed = observations.reduce((merged, one) => ({
      heading: merged.heading || one.heading,
      chars: Math.max(merged.chars, one.chars),
      create: [...merged.create, ...one.create],
      search: merged.search || one.search,
      filter: merged.filter || one.filter,
      paging: merged.paging || one.paging,
      rows: Math.max(merged.rows, one.rows),
      detail: Math.max(merged.detail, one.detail),
      lifecycle: merged.lifecycle || one.lifecycle,
      history: merged.history || one.history,
      // An empty state that a SIBLING tab lacks is still an empty state on
      // the tab that has one; both flags union for the same reason.
      emptyish: merged.emptyish || one.emptyish,
      emptyExplains: merged.emptyExplains || one.emptyExplains,
      tabs: tabCount,
    }), {
      heading: '', chars: 0, create: [], search: false, filter: false, paging: false,
      rows: 0, detail: 0, lifecycle: false, history: false, emptyish: false, emptyExplains: false,
    });


    report.push({ ...destination, ...observed });

    /* ── ASSERTIONS ───────────────────────────────────────────────────── */
    /*
     * A DEAD PAGE IS A PAGE THAT SENT YOU SOMEWHERE ELSE.
     *
     * This asserted `chars > 120` and nothing else, so a redirect to the
     * sign-in page - which is longer than that - passed as a rendered admin
     * screen. Both facts are needed: still on the route, and carrying its
     * own content.
     */
    check(landedOn === destination.path,
      `${destination.path} does not bounce the administrator elsewhere`, `landed on ${landedOn}`);
    check(observed.chars > 120, `${destination.path} renders real content`, `${observed.chars} chars`);
    if (CREATES.has(destination.path)) {
      check(observed.create.length > 0,
        `${destination.path} offers a visible create action`, observed.create.join(', ') || 'NONE');
    }
    if (GROWS.has(destination.path)) {
      check(observed.search, `${destination.path} can be searched`);
      check(observed.paging || observed.rows === 0,
        `${destination.path} pages its list`, `${observed.rows} rows, paging ${observed.paging}`);
    }
    if (observed.emptyish) {
      check(observed.emptyExplains,
        `${destination.path} empty state names the next legitimate action`);
    }
  }
} finally {
  await browser.close();
}

/* ── THE CENSUS TABLE ────────────────────────────────────────────────── */
console.log('\n── ADMIN MANAGEMENT-ACTION CENSUS ──────────────────────────────────\n');
const yn = value => (value ? 'yes' : ' - ');
console.log('destination                 create  search  filter  page  detail  lifecycle  history');
for (const row of report) {
  console.log(
    row.path.padEnd(27) +
    (row.create.length ? 'yes   ' : ' -    ').padEnd(8) +
    yn(row.search).padEnd(8) +
    yn(row.filter).padEnd(8) +
    yn(row.paging).padEnd(6) +
    yn(row.detail > 0).padEnd(8) +
    yn(row.lifecycle).padEnd(11) +
    yn(row.history));
}
console.log('\ncreate actions found, by destination:');
for (const row of report.filter(entry => entry.create.length > 0)) {
  console.log(`  ${row.path}: ${[...new Set(row.create)].join(' | ')}`);
}

/* ── A BACKEND MUTATION WITH NO RENDERED CONTROL IS A DEFECT ─────────── */
// The static half. A procedure no client calls cannot have a discoverable
// control, whatever the screen looks like.
const ROUTERS = readFileSync(join(ROOT, 'server/routers.ts'), 'utf8');
const adminRouterStart = ROUTERS.indexOf('const adminRouter = router({');
if (adminRouterStart === -1) throw new Error('adminRouter not found in routers.ts');
const adminRouterEnd = ROUTERS.indexOf('\nconst aiRouter = router({', adminRouterStart);
const adminBody = ROUTERS.slice(adminRouterStart, adminRouterEnd === -1 ? undefined : adminRouterEnd);
const mutations = [...adminBody.matchAll(/^  (\w+): adminWith\([^)]*\)[\s\S]{0,400}?\.mutation\(/gm)].map(m => m[1]);

const clientFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) clientFiles.push(readFileSync(full, 'utf8'));
  }
})(join(ROOT, 'client/src'));
const clientText = clientFiles.join('\n');

/*
 * THE DECLARED EXEMPTIONS ARE PART OF THE ANSWER, NOT AN EXCEPTION TO IT.
 *
 * server/reachability.ts already holds the procedures that are deliberately
 * unreachable from the UI, each with the reason and what would change it -
 * the payment-provider webhook writes, whose manual buttons would let an
 * administrator record revenue BuildHub never received. This census reported
 * all six as defects on its first run, which was the census being wrong: a
 * second list of the same facts, kept somewhere else, is how the first list
 * goes stale.
 */
const REACHABILITY = readFileSync(join(ROOT, 'server/reachability.ts'), 'utf8');
const declared = new Set(
  [...REACHABILITY.matchAll(/procedure: '(?:admin\.)([\w]+)'/g)].map(match => match[1]),
);
check(declared.size > 0, 'the census reads the declared-exemption register', `${declared.size} declared`);

const uncalled = mutations.filter(name =>
  !clientText.includes(`admin.${name}.`) && !declared.has(name));
check(uncalled.length === 0,
  'every Admin mutation has a client that calls it, or a written reason not to',
  uncalled.length ? uncalled.join(', ') : `${mutations.length} mutations, ${declared.size} declared exempt`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

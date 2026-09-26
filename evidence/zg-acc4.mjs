/**
 * ── ACC-4: A GENUINELY FRESH ACCOUNT, IN EVERY ROLE ─────────────────────
 *
 * §42 lists "ACC-4 fresh-account cross-role acceptance" as a release gate and
 * nothing in the repository could fail when it was not met. §76 says what it
 * means: a fresh user should not need prior knowledge of BuildHub, and for each
 * role there must be clear orientation, an obvious first action, an explained
 * empty dashboard, visible onboarding progress, no dead end, and no
 * unexplained disabled capability.
 *
 * ── WHY EVERY ACCOUNT HERE IS CREATED THROUGH auth.signUp ───────────────
 *
 * Because the thing being tested is the first five minutes. A row inserted
 * into `users` would skip the decision that shapes them: `signUp` sets a
 * professional to onboardingStatus='not_started' and verified=0, and the app
 * then sends them to /compliance rather than to a workspace. Seeding the row
 * would test a state no real account passes through.
 *
 * ── WHAT COUNTS AS A FAILURE ────────────────────────────────────────────
 *
 * Not "the page rendered". A fresh account meets an empty product, which is
 * the hardest state to do well and the one every screenshot avoids: a heading
 * that says nothing, a zero with no sentence beside it, a disabled button with
 * no reason, a raw enum where a status should be, a nav item that leads to 404.
 * Each of those is checked here as a defect, in English and in Arabic.
 *
 * Every account is deleted afterwards and the deletion is proved.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'FreshAccount!2026';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9084);

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}

/** The five roles BuildHub puts through compliance, plus the buyer. */
const PROFESSIONAL = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'];
const ALL_ROLES = ['homeowner', ...PROFESSIONAL];
/*
 * ZG_ROLES narrows the run to named roles. A full pass is six accounts, six
 * sidebar sweeps and twelve language renders - several minutes - and a
 * mutation check only needs the one role that would break. The default is
 * every role, so an unqualified run is still the whole gate.
 */
const ROLES = (process.env.ZG_ROLES ?? '').trim().length > 0
  ? process.env.ZG_ROLES.split(',').map(role => role.trim()).filter(role => ALL_ROLES.includes(role))
  : ALL_ROLES;

/** The same rule client/src/pages/AuthPage.tsx applies after a sign-up. */
const landingFor = role => (PROFESSIONAL.includes(role) ? '/compliance' : `/platform/${role}`);

const STAMP = Date.now();
const created = [];

async function signUp(role) {
  const username = `acc4${role.replace('_', '')}${STAMP}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username,
      email: `${username}@example.test`,
      password: PASSWORD,
      name: `Fresh ${role}`,
      userRole: role,
    } }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    return { ok: false, reason: body?.error?.json?.message ?? `HTTP ${res.status}` };
  }
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  const id = num(`SELECT id FROM users WHERE email='${username}@example.test'`);
  created.push(id);
  return { ok: true, cookie, id, email: `${username}@example.test` };
}

/**
 * The visible text and controls of whatever is on screen.
 *
 * `h1` is read as a list rather than a single node: two of them is its own
 * defect, and an assertion that takes the first would never say so.
 */
const READ_SCREEN = `
  const disabled = Array.from(document.querySelectorAll(
    'button[disabled],button[aria-disabled="true"],a[aria-disabled="true"],[role="button"][aria-disabled="true"]'));
  return {
    text: document.body.innerText || '',
    h1: Array.from(document.querySelectorAll('h1')).map(node => (node.textContent || '').trim()),
    dir: document.documentElement.dir,
    links: Array.from(document.querySelectorAll('a[href^="/"]'))
      .map(node => node.getAttribute('href'))
      .filter(href => href && !href.startsWith('//')),
    enabledActions: Array.from(document.querySelectorAll('a[href^="/"],button'))
      .filter(node => !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true')
      .map(node => (node.textContent || '').trim())
      .filter(text => text.length > 0 && text.length < 60),
    disabled: disabled.map(node => ({
      label: (node.textContent || '').trim().slice(0, 40),
      reason: node.getAttribute('title') || node.getAttribute('aria-label')
        || (node.getAttribute('aria-describedby')
            ? (document.getElementById(node.getAttribute('aria-describedby'))?.textContent || '').trim()
            : '')
        || (node.closest('div,form,section')?.textContent || '').trim().slice(0, 200),
    })),
  };
`;

/*
 * DEVELOPER LANGUAGE, ON A SCREEN A PERSON READS. §55 - remove raw enums and
 * implementation terminology. Each of these has been a real defect in this
 * product at least once, which is why they are named rather than approximated
 * by a generic snake_case pattern that would flag legitimate ids.
 */
const RAW_TOKENS = [
  'not_started', 'under_review', 'update_required', 'quote_on_request',
  'per_square_metre', 'project_manager', 'commercial_registration',
  'professional_license', 'undefined', 'NaN', '[object Object]', 'null,',
];

const browser = await launchBrowser({ port: CDP_PORT });
const results = [];

try {
  for (const role of ROLES) {
    console.log(`\n── ${role} ──`);
    const account = await signUp(role);
    check(account.ok, `a fresh ${role} account can be created through the real sign-up`,
      account.ok ? `#${account.id}` : account.reason);
    if (!account.ok) continue;

    /* THE STATE SIGN-UP CHOSE. A professional is unverified and unstarted; a
       buyer is approved. This is what makes the landing route what it is. */
    const stored = sql(`SELECT onboardingStatus, verified, accountSource FROM users WHERE id=${account.id}`).split('\t');
    if (PROFESSIONAL.includes(role)) {
      check(stored[0] === 'not_started' && stored[1] === '0',
        `${role} starts unverified and not yet through compliance`, stored.join(' / '));
    } else {
      check(stored[0] === 'approved', 'a buyer needs no compliance to start', stored.join(' / '));
    }
    check(stored[2] === 'self_registered', 'and is recorded as self-registered, not seeded');

    const page = await browser.newPage();
    /*
     * A DESKTOP VIEWPORT, EXPLICITLY.
     *
     * With none set, the browser defaulted to a narrow window, DashboardLayout
     * rendered its sidebar into a mobile drawer that is not mounted until it is
     * opened, and the probe found ZERO nav items on a workspace that has eight
     * - then reported "every destination resolves" over almost nothing. A
     * viewport is part of what a rendered check is a claim about.
     *
     * 375px is covered for these routes by evidence/zg-visualqa.mjs.
     */
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/`);
    await page.setCookies(asBrowserCookies(account.cookie));

    const landing = landingFor(role);
    await page.goto(`${BASE}${landing}`);
    const ready = await waitFor(page, `document.querySelectorAll('h1,h2').length > 0`);
    check(ready, `${landing} renders for a brand-new ${role}`);
    await settle(2000);
    const screen = await page.evaluate(READ_SCREEN);

    /* ── 1. ORIENTATION ── */
    check(screen.h1.length === 1, `exactly one first-level heading on ${landing}`,
      `${screen.h1.length}: ${screen.h1.join(' | ').slice(0, 70)}`);
    const heading = screen.h1[0] ?? '';
    check(heading.length > 3 && heading !== 'BuildHub',
      'and it says where the user is, not just the brand', heading.slice(0, 60));

    /* ── 2. AN OBVIOUS FIRST ACTION ── */
    check(screen.enabledActions.length > 0, 'there is at least one thing a new account can do',
      `${screen.enabledActions.length} enabled controls`);

    /* ── 3. THE EMPTINESS IS EXPLAINED ──
     *
     * THE VOCABULARY IS THE PRODUCT'S OWN. A first version guessed at phrasings
     * and reported five failures against /compliance - a page that in fact
     * ends with "Review timeline / Review updates will appear here", which is
     * a textbook explained empty state. The probe was wrong, not the page.
     *
     * "will appear here" / "ستظهر"/"سيظهر" is BuildHub's house phrasing for an
     * empty region and appears in 68 places in the client, so it is matched
     * here rather than invented.
     */
    const explained = /(will appear here|ستظهر|سيظهر|\bno \w+ yet\b|nothing yet|get started|start by|لا توجد|لم يتم|ابدأ)/i
      .test(screen.text);
    check(explained, 'the empty product explains itself rather than showing bare zeros',
      (screen.text.match(/.{0,40}(will appear here|ستظهر|سيظهر|nothing yet|get started).{0,20}/i)?.[0]
        ?? screen.text.replace(/\s+/g, ' ').slice(0, 90)));

    /* A LONE ZERO WITH NO SENTENCE is the failure mode this is about. */
    const bareZeroCount = (screen.text.match(/(^|\n)\s*0\s*(\n|$)/g) ?? []).length;
    check(bareZeroCount === 0 || explained,
      'no count stands alone with nothing telling the user what it means',
      `${bareZeroCount} bare zeros`);

    /* ── 4. ONBOARDING PROGRESS, FOR A ROLE THAT NEEDS APPROVAL ── */
    if (PROFESSIONAL.includes(role)) {
      const saysWhatNext = /(document|upload|submit|review|approv|مستند|ارفع|مراجعة|اعتماد)/i.test(screen.text);
      check(saysWhatNext, 'compliance tells a new professional what to do and what follows',
        screen.text.replace(/\s+/g, ' ').slice(0, 90));
      /* The requirements are NAMED, not typed. `commercial_registration` is a
         column value; "Commercial registration" is a sentence to a person. */
      const namesRequirement = /(Commercial registration|Engineering syndicate|Architecture license|Project management certificate|Bank account certificate|السجل التجاري|نقابة المهندسين)/i
        .test(screen.text);
      check(namesRequirement, 'and names the documents it wants in words',
        screen.text.match(/.{0,50}(registration|license|certificate).{0,20}/i)?.[0] ?? 'none found');
    }

    /* ── 5. NO DEVELOPER LANGUAGE ── */
    const leaked = RAW_TOKENS.filter(token => screen.text.includes(token));
    check(leaked.length === 0, 'no raw enum, placeholder or implementation term is shown',
      leaked.join(', ') || 'clean');

    /* ── 6. NO UNEXPLAINED DISABLED CONTROL ── */
    const unexplained = screen.disabled.filter(entry => (entry.reason ?? '').trim().length < 12);
    check(unexplained.length === 0, 'every disabled control has a reason a reader can find',
      unexplained.map(entry => entry.label || '(no label)').join(', ') || `${screen.disabled.length} disabled, all explained`);

    /* ── 7. NO DEAD END ──
     *
     * THE SIDEBAR IS BUTTONS, NOT LINKS. DashboardLayout renders each menu item
     * as a SidebarMenuButton with an onClick, so a sweep of `a[href]` found ONE
     * destination on the homeowner workspace and called that "every
     * destination offered" - a pass over almost nothing. Each nav item carries
     * `data-testid="nav-<labelKey>"`, so they are clicked instead, which is
     * also what a person does.
     *
     * Clicking checks two things a URL fetch cannot: that the item NAVIGATES at
     * all (an onClick that does nothing is a dead control), and that where it
     * lands is not the 404 page.
     */
    /*
     * THE ITEM THAT IS ALREADY CURRENT IS SKIPPED, and it is not an exception
     * grudgingly made - `workspaceHref` returns the bare `/platform/:role` for
     * the overview section on purpose, because the overview IS the page. You
     * cannot navigate to where you already are, and DashboardLayout marks that
     * item `aria-current="page"`, so the product says which one it is rather
     * than the probe guessing.
     *
     * The bug this must still catch is the one the layout's own header records:
     * four contractor entries once shared the bare workspace path, all rendered
     * active at once, and clicking any of them did nothing.
     */
    const navIds = await page.evaluate(`
      return Array.from(document.querySelectorAll('[data-testid^="nav-"]'))
        .filter(node => node.getAttribute('aria-current') !== 'page')
        .map(node => node.getAttribute('data-testid'))
        .filter(id => id && id !== 'nav-unread-notifications');
    `);
    const currentCount = await page.evaluate(`
      return document.querySelectorAll('[data-testid^="nav-"][aria-current="page"]').length;
    `);
    /* EXACTLY ONE, or the sidebar is lying about where the reader is. */
    if (navIds.length > 0) {
      check(currentCount === 1, 'exactly one sidebar item is marked as the current page',
        `${currentCount} marked current`);
    }
    const deadEnds = [];
    const inert = [];
    const hrefTargets = [...new Set(screen.links)].filter(href => !/^\/(auth|logout)/.test(href)).slice(0, 10);
    for (const id of navIds) {
      await page.goto(`${BASE}${landing}`);
      await waitFor(page, `!!document.querySelector('[data-testid="${id}"]')`);
      const before = await page.evaluate('return location.pathname + location.hash;');
      await page.evaluate(`document.querySelector('[data-testid="${id}"]').click(); return true;`);
      const moved = await waitFor(page, `(location.pathname + location.hash) !== ${JSON.stringify(before)}`, 8000);
      if (!moved) { inert.push(id); continue; }
      await settle(1200);
      const landed = await page.evaluate(
        `return { path: location.pathname, body: (document.body.innerText || '').slice(0, 400) };`);
      if (/Page Not Found|الصفحة غير موجودة/.test(landed.body)) deadEnds.push(`${id} → ${landed.path}`);
    }
    /* Plus any real anchors on the page. */
    for (const href of hrefTargets) {
      await page.goto(`${BASE}${href}`);
      await settle(1300);
      const body = await page.evaluate(`return (document.body.innerText || '').slice(0, 400);`);
      if (/Page Not Found|الصفحة غير موجودة/.test(body)) deadEnds.push(href);
    }
    /*
     * A SIDEBAR OR ANCHORS - the page must offer SOMETHING, not a specific
     * mechanism. /compliance does not use DashboardLayout: a fresh
     * professional's first screen carries the public navbar and its own links
     * rather than a workspace sidebar, which is a legitimate difference and not
     * a missing shell. Requiring the sidebar there failed all five
     * professional roles for a property none of them was meant to have.
     */
    check(navIds.length + hrefTargets.length > 0,
      `the ${role} shell offers navigation at all`,
      `${navIds.length} sidebar items, ${hrefTargets.length} links`);
    check(inert.length === 0, 'every nav item actually navigates somewhere',
      inert.join(', ') || `${navIds.length} moved`);
    check(deadEnds.length === 0, `every destination offered to a new ${role} resolves`,
      deadEnds.join(', ') || `${navIds.length + hrefTargets.length} checked`);

    results.push({ role, landing, heading, links: navIds.length + hrefTargets.length });

    /* ── 8. ARABIC ── */
    await page.goto(`${BASE}${landing}`);
    await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
    await page.goto(`${BASE}${landing}`);
    const rtl = await waitFor(page, `document.documentElement.dir === 'rtl'`);
    check(rtl, `${landing} renders right-to-left in Arabic for a new ${role}`);
    await settle(1800);
    const arabic = await page.evaluate(READ_SCREEN);
    check(/[؀-ۿ]/.test(arabic.h1[0] ?? ''), 'the Arabic heading is Arabic',
      (arabic.h1[0] ?? '').slice(0, 60));
    const arabicLeaked = RAW_TOKENS.filter(token => arabic.text.includes(token));
    check(arabicLeaked.length === 0, 'and Arabic leaks no raw enum either',
      arabicLeaked.join(', ') || 'clean');
    await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  }

  /* ── EVERY ROLE WAS ACTUALLY EXERCISED ── */
  console.log('\n── coverage ──');
  check(results.length === ROLES.length,
    ROLES.length === ALL_ROLES.length ? 'all six roles were exercised end to end' : `the ${ROLES.length} selected role(s) were exercised end to end`,
    `${results.length}/${ROLES.length}`);
  /* And their landing pages are not one page wearing six labels. */
  const headings = new Set(results.map(entry => entry.heading));
  if (ROLES.length > 1) check(headings.size >= 2, 'the roles do not all land on one identical screen',
    `${headings.size} distinct headings: ${[...headings].join(' | ').slice(0, 100)}`);
  for (const entry of results) console.log(`       ${entry.role} → ${entry.landing}  "${entry.heading}"  ${entry.links} links`);
} finally {
  await browser.close();
  for (const id of created) {
    if (!id) continue;
    /* Sign-up mints a referral code and 0057's lifecycle table records the
       event with the new account as actor, so the audit row goes first. */
    sql(`DELETE FROM referralCodeEvents WHERE actorId=${id} OR userId=${id}`);
    sql(`DELETE FROM users WHERE id=${id}`);
  }
  const left = num(`SELECT COUNT(*) FROM users WHERE email LIKE 'acc4%${STAMP}@example.test'`);
  check(left === 0, 'every account this probe created is removed', `${left} left`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

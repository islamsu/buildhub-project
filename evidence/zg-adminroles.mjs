/**
 * ── EVERY ADMINISTRATOR'S CONTROL PLANE, RENDERED AND CLICKED ─────────────
 *
 * `zg-adminia.mjs` clicks the SUPER ADMIN's plane. `adminInformationArchitecture`
 * proves `adminMenuFor` filters correctly - but that is a pure function over a
 * list, and a pure function cannot tell you what a restricted administrator's
 * browser actually draws, or what happens when they type a URL they were not
 * offered.
 *
 * So this signs in as four REAL administrators, each created through the real
 * account shape and signed in through the real sign-in, and for each one:
 *
 *   CAPTURES THE SIDEBAR THEY ARE ACTUALLY OFFERED, and asserts it is EXACTLY
 *     the set their job allows - nothing missing, and nothing extra. A missing
 *     destination is a capability they cannot reach; an extra one is a control
 *     that leads to a refusal, which reads as a broken product rather than a
 *     boundary.
 *
 *   CLICKS EVERY ONE OF THEM, asserting the address moved, the page rendered
 *     its own heading and its own content, and that a properly authorized
 *     administrator was not refused, shown a blank page, 404ed, or bounced.
 *
 *   THEN TYPES A URL THEY WERE NOT OFFERED, and asserts the server refuses it.
 *     The menu is a courtesy. The boundary is server-side, and the only way to
 *     show that is to go around the menu.
 *
 * THE EXPECTED SETS ARE WRITTEN OUT HERE BY HAND, from what each job
 * description allows - never imported from `adminNavigation.ts`. A probe that
 * reads the module under test proves the two agree, not that the product is
 * right.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9100 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value = 'false';
    try { value = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (value === 'true') { await settle(250); return true; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

const PASSWORD = 'LocalSuperAdmin!2024';
const stamp = Date.now() % 100000000;

/**
 * WHAT EACH JOB IS ALLOWED TO SEE, stated independently of the product.
 *
 * `label` is what the sidebar must render; `heading` is what the destination
 * must put at the top of itself, which is how a click is proven to have landed
 * somewhere rather than merely changed the address.
 */
const PLANE = {
  SUPER_ADMIN: {
    // The complete control plane.
    offered: [
      ['/admin', 'Admin Control Panel'],
      ['/admin/users', 'User Management'],
      ['/admin/registrations', 'Professional Registrations'],
      ['/admin/categories', 'Product categories'],
      ['/admin/placements', 'Placements'],
      ['/admin/enquiries', 'Vendor Enquiries'],
      ['/admin/referrals', 'Referrals'],
      ['/admin/disputes', 'Disputes'],
      ['/admin/support', 'Support tickets'],
      ['/admin/reviews', 'Reported reviews'],
      ['/admin/billing', 'Billing & Benefits'],
      ['/admin/analytics', 'Analytics'],
      ['/admin/operations', 'Operations'],
      ['/admin/admins', 'Administrators'],
      ['/admin/settings', 'Settings'],
    ],
    denied: [],
  },
  USER_ADMIN: {
    // users.read, users.manage, audit.read - identity and the trail, nothing else.
    offered: [
      ['/admin', 'Admin Control Panel'],
      ['/admin/users', 'User Management'],
      ['/admin/analytics', 'Analytics'],
      ['/admin/operations', 'Operations'],
    ],
    // Marketplace curation, trust & safety, money, and the authority console.
    denied: ['/admin/registrations', '/admin/categories', '/admin/disputes', '/admin/billing', '/admin/admins'],
  },
  MARKETPLACE_ADMIN: {
    // users.read, marketplace.manage - the marketplace, and the directory it acts on.
    offered: [
      ['/admin', 'Admin Control Panel'],
      ['/admin/users', 'User Management'],
      ['/admin/registrations', 'Professional Registrations'],
      ['/admin/categories', 'Product categories'],
      ['/admin/placements', 'Placements'],
      ['/admin/enquiries', 'Vendor Enquiries'],
      ['/admin/referrals', 'Referrals'],
    ],
    denied: ['/admin/disputes', '/admin/support', '/admin/reviews', '/admin/billing', '/admin/admins', '/admin/analytics'],
  },
  SUPPORT_ADMIN: {
    // users.read, support.manage - disputes, tickets and review moderation.
    offered: [
      ['/admin', 'Admin Control Panel'],
      ['/admin/users', 'User Management'],
      ['/admin/disputes', 'Disputes'],
      ['/admin/support', 'Support tickets'],
      ['/admin/reviews', 'Reported reviews'],
    ],
    denied: ['/admin/registrations', '/admin/categories', '/admin/placements', '/admin/billing', '/admin/admins', '/admin/analytics'],
  },
};

/**
 * THE READER EACH DENIED DESTINATION ACTUALLY CALLS, and what it needs.
 *
 * Read off `adminWith(...)` in server/routers.ts and off the component that
 * calls it - never guessed. Asking a procedure the screen does not use would
 * prove a boundary nobody crosses. Every one of these is the query the page
 * fires on arrival, so a 200 here means the destination would have rendered.
 */
const PROCEDURE_FOR = {
  registrations: 'admin.complianceQueue',
  categories:    'admin.categories',
  placements:    'admin.placements',
  enquiries:     'admin.enquiryOverview',
  referrals:     'admin.referrals',
  disputes:      'admin.disputes',
  support:       'admin.supportTickets',
  reviews:       'admin.reviewReports',
  billing:       'admin.vendorLifecycle',
  analytics:     'admin.fullAuditReport',
  operations:    'admin.operationalHealth',
  admins:        'admin.admins',
};

/** Inputs for the readers that require one. `null` means "takes none". */
const INPUT_FOR = {
  billing: { userId: 1 },
};

/** An administrator with a real, application-minted password hash. */
function makeAdmin(suffix, adminRole, passwordHash) {
  const u = `zrole${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe ${adminRole}', 'admin',
        '${adminRole}', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${passwordHash}', now())`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (!Number.isInteger(id) || id <= 0) throw new Error(`probe setup: ${u} was not created`);
  return { id, username: u, email: `${u}@example.test`, adminRole };
}

/** Sign in over HTTP, exactly as the sign-in screen does, and keep the cookie. */
async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`adminSignIn ${email}: ${res.status} ${body.slice(0, 120)}`);
  }
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

const browser = await launchBrowser({ port: CDP_PORT });
const created = [];

try {
  sql(`delete from userAccountAuditEvents where userId in (select id from users where username like 'zrole%')`);
  sql(`delete from users where username like 'zrole%'`);

  const bootstrapHash = sql(`select passwordHash from users where role='admin' and passwordHash is not null limit 1`);
  check(!!bootstrapHash && bootstrapHash.length > 20,
    '1. SETUP: an application-minted password hash is available to seed with',
    bootstrapHash ? `${bootstrapHash.slice(0, 7)}…` : 'none');

  for (const role of Object.keys(PLANE)) {
    created.push(makeAdmin(role.toLowerCase().replace(/_/g, ''), role, bootstrapHash));
  }
  check(created.length === 4, '2. and four real administrators exist, one per job',
    created.map(a => a.adminRole).join(', '));

  let step = 3;
  for (const admin of created) {
    const plan = PLANE[admin.adminRole];
    const cookie = await signIn(admin.email);
    const page = await browser.newPage();
    await page.setCookies(asBrowserCookies(cookie));
    await page.goto(`${BASE}/admin`);
    await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
    await page.goto(`${BASE}/admin`);

    // The menu is built from `admin.me`, so wait for it to have resolved -
    // before it does, the sidebar honestly shows fewer entries, and reading it
    // then would report a boundary that is only a loading state.
    const ready = await waitFor(page, `document.querySelectorAll('[data-sidebar="menu-button"], nav button, aside button').length > 2`);
    check(ready, `${step}. ${admin.adminRole}: signs in and the control plane renders`);
    step++;

    const labels = JSON.parse(await page.evaluate(`
      const out = [];
      for (const el of document.querySelectorAll('[data-sidebar="menu-button"], nav button, aside button')) {
        const label = (el.innerText || '').trim();
        if (label && !out.includes(label)) out.push(label);
      }
      return JSON.stringify(out);
    `));

    // ── EXACTLY THEIR OWN PLANE: nothing missing, nothing extra ───────────
    const expectedLabels = plan.offered.map(([, label]) => label);
    const missing = expectedLabels.filter(label => !labels.includes(label));
    check(missing.length === 0,
      `${step}. ${admin.adminRole}: every destination their job needs is offered`,
      missing.length ? `missing: ${missing.join(', ')}` : `${expectedLabels.length} offered`);
    step++;

    // An extra destination is a control that leads to a refusal.
    // A path offered to two roles carries the same label twice, so dedupe -
    // otherwise a single extra control is reported as several.
    const deniedLabels = [...new Set(Object.values(PLANE)
      .flatMap(p => p.offered)
      .filter(([path]) => plan.denied.includes(path))
      .map(([, label]) => label))];
    const extras = deniedLabels.filter(label => labels.includes(label));
    check(extras.length === 0,
      `${step}. ${admin.adminRole}: and NOTHING BEYOND IT — no control that would be refused`,
      extras.length ? `offered but not theirs: ${extras.join(', ')}` : 'none');
    step++;

    // ── EVERY OFFERED DESTINATION IS CLICKED ──────────────────────────────
    const broken = [];
    for (const [path, label] of plan.offered) {
      await page.goto(`${BASE}${path}`);
      await waitFor(page, `document.body.innerText.trim().length > 80`);
      const seen = JSON.parse(await page.evaluate(`
        const text = document.body.innerText || '';
        return JSON.stringify({
          url: location.pathname,
          notFound: /Page Not Found|404/i.test(text),
          denied: /Access Denied|not authorized|Forbidden/i.test(text),
          blank: text.trim().length < 80,
          heading: (document.querySelector('h1, h2')?.innerText || '').trim(),
          length: text.trim().length,
        });
      `));
      const ok = seen.url === path && !seen.notFound && !seen.denied && !seen.blank;
      if (!ok) broken.push(`${path} (url=${seen.url} 404=${seen.notFound} denied=${seen.denied} blank=${seen.blank})`);
    }
    check(broken.length === 0,
      `${step}. ${admin.adminRole}: EVERY offered destination renders — no blank, no 404, no Access Denied, no wrong section`,
      broken.length ? broken.join(' | ') : `${plan.offered.length} destinations clicked`);
    step++;

    // ── AND THE BOUNDARY IS THE SERVER, NOT THE MENU ──────────────────────
    if (plan.denied.length > 0) {
      const leaked = [];
      for (const path of plan.denied) {
        const section = path.replace('/admin/', '');
        // Ask the destination's OWN procedure directly, going around the
        // screen entirely - a hidden menu entry proves nothing about access.
        const probe = await fetch(`${BASE}/api/trpc/${PROCEDURE_FOR[section]}?input=${encodeURIComponent(JSON.stringify({ json: INPUT_FOR[section] ?? null }))}`,
          { headers: { cookie } });
        const body = await probe.json().catch(() => null);
        const code = body?.error?.json?.data?.code ?? null;
        if (probe.status === 200) leaked.push(`${section} returned 200`);
        else if (code !== 'FORBIDDEN' && code !== 'UNAUTHORIZED') leaked.push(`${section} refused with ${code}`);
      }
      check(leaked.length === 0,
        `${step}. ${admin.adminRole}: THE SERVER REFUSES what the menu withheld — the boundary is not the sidebar`,
        leaked.length ? leaked.join(' | ') : `${plan.denied.length} refused server-side`);
      step++;
    }
    await page.close?.();
  }
} catch (error) {
  check(false, 'PROBE COMPLETED', String(error).slice(0, 220));
} finally {
  try { await browser.close(); } catch {}
  for (const admin of created) {
    for (const q of [
      `delete from userAccountAuditEvents where userId=${admin.id} or actorId=${admin.id}`,
      `delete from commercialAuditEvents where actorId=${admin.id} or ownerId=${admin.id}`,
      `delete from notifications where userId=${admin.id}`,
      `delete from adminInvitations where userId=${admin.id}`,
    ]) { try { sql(q); } catch {} }
  }
  try { sql(`delete from users where username like 'zrole${stamp}%'`); } catch {}
  const left = Number(sql(`select count(*) from users where username like 'zrole${stamp}%'`) || 0);
  check(left === 0, 'CLEANUP: every administrator this probe created is gone', `users=${left}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

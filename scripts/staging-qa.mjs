#!/usr/bin/env node
// ── Staging launch-readiness gate ──────────────────────────────────────────
//
// The 22-point verification, run against a REAL deployed staging URL over
// HTTPS with a real browser. Everything here talks to the deployment the way a
// user would: no database access, no container access, no privileged hooks.
//
//   node scripts/staging-qa.mjs https://buildhub-staging.onrender.com
//
// Optional, and it matters: an existing STAGING admin account unlocks the
// checks that need one (admin visibility, the subscription lifecycle). Without
// it those become negative-only - "admin endpoints refuse a non-admin" - and
// the harness says so rather than quietly skipping them.
//
//   STAGING_ADMIN_USER=... STAGING_ADMIN_PASSWORD=... node scripts/staging-qa.mjs <url>
//
// This runs on a GitHub Actions runner rather than a developer's laptop,
// because the runner can reach the deployment. See
// .github/workflows/staging-qa.yml.
//
// IT CREATES ACCOUNTS. That is intended - registration and the six roles are
// part of what must be verified - and is why it must never be pointed at
// production. It refuses to run against a URL that looks like production.

import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? process.env.STAGING_BASE_URL ?? '').replace(/\/+$/, '');
if (!BASE) {
  console.error('usage: node scripts/staging-qa.mjs <staging-base-url>');
  process.exit(2);
}
if (!/staging|onrender|localhost|127\.0\.0\.1/i.test(BASE)) {
  console.error(`Refusing to run: ${BASE} does not look like a staging URL.`);
  console.error('This harness registers accounts. Point it at staging only.');
  process.exit(2);
}

const ADMIN_USER = process.env.STAGING_ADMIN_USER;
const ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD;
// Optional. When set, the gate asserts the deployment is serving this commit
// instead of merely reporting whatever it found.
const EXPECT_COMMIT = (process.env.STAGING_EXPECT_COMMIT ?? '').trim();

let pass = 0, fail = 0, skipped = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  ok ? pass++ : (fail++, failures.push(`${name}${detail ? ' — ' + detail : ''}`));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const skip = (name, why) => { skipped++; console.log(`SKIP  ${name}  — ${why}`); };
const section = t => console.log(`\n───── ${t} ─────`);

const post = async (proc, body, cookie) => {
  const r = await fetch(`${BASE}/api/trpc/${proc}`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: body }),
  });
  return { s: r.status, t: await r.text(), c: (r.headers.getSetCookie?.() ?? []).map(x => x.split(';')[0]).join('; '), raw: r };
};
const get = async (proc, input, cookie) => {
  const u = input !== undefined
    ? `${BASE}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : `${BASE}/api/trpc/${proc}`;
  const r = await fetch(u, { headers: cookie ? { cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  return { s: r.status, t: await r.text(), raw: r };
};
const json = t => { try { return JSON.parse(t)?.result?.data?.json; } catch { return undefined; } };
const errMsg = t => { try { return JSON.parse(t)?.error?.json?.message; } catch { return t; } };

const STAMP = Date.now().toString().slice(-8);
const PW = `Staging-QA-${STAMP}!`;
const ROLES = ['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager'];
const users = {};
let browser;

const signUp = async (role, tag = role.slice(0, 4)) => {
  const username = `qa${tag}${STAMP}`;
  const r = await post('auth.signUp', {
    username, email: `${username}@staging-qa.invalid`, password: PW,
    name: `QA ${role}`, userRole: role,
  });
  return { username, cookie: r.c, status: r.s, body: r.t };
};

try {
  // ══ 1-3, 6. THE DEPLOYMENT ITSELF ═════════════════════════════════════
  section('0. Provenance - WHICH build is being tested');

  // A passing suite against an unidentified deployment is not evidence of
  // anything. Everything below this point is only meaningful once we can name
  // the commit that answered it.
  const version = await fetch(`${BASE}/version`, { signal: AbortSignal.timeout(30_000) });
  const deployed = version.status === 200 ? (await version.json().catch(() => ({})))?.commit : undefined;
  check(version.status === 200, '0. /version identifies the build', `http ${version.status}`);
  check(
    typeof deployed === 'string' && /^[0-9a-f]{7,40}$/i.test(deployed),
    '0. the deployment reports a real commit SHA',
    deployed ?? '(none)',
  );
  console.log(`\n>>> DEPLOYED COMMIT: ${deployed ?? 'UNKNOWN'}\n`);

  // When the caller says which commit it meant to test, a mismatch is a
  // FAILURE, not a note. Testing yesterday's build and reporting it as today's
  // is the exact failure this section exists to prevent.
  if (EXPECT_COMMIT) {
    check(
      typeof deployed === 'string' && deployed.startsWith(EXPECT_COMMIT.slice(0, 7)),
      '0. the deployed commit is the one under test',
      `expected ${EXPECT_COMMIT.slice(0, 12)}, serving ${deployed ?? 'unknown'}`,
    );
  } else {
    skip('0. deployed commit matches the commit under test', 'no STAGING_EXPECT_COMMIT supplied');
  }

  section('1-3, 6. Service, health, readiness, HTTPS');

  check(BASE.startsWith('https://') || BASE.includes('127.0.0.1'), '6. the staging URL is HTTPS', BASE);

  const root = await fetch(`${BASE}/`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const html = await root.text();
  check(root.status === 200, '1. the web service is up and serving', `http ${root.status}`);
  check(html.includes('id="root"'), '1. the built client is served');
  check(/src="\/assets\/.*\.js"/.test(html), '1. the asset bundle is referenced');
  check(!html.includes('%VITE_'), '1. no unsubstituted build placeholders', (html.match(/%VITE_[A-Z_]+%/g) ?? []).join(','));

  const health = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(30_000) });
  check(health.status === 200, '2. /healthz responds', `http ${health.status}`);

  const ready = await fetch(`${BASE}/readyz`, { signal: AbortSignal.timeout(30_000) });
  const readyBody = await ready.json().catch(() => ({}));
  check(ready.status === 200, '3. /readyz confirms database connectivity', `http ${ready.status}`);
  check(readyBody?.checks?.database === true, '3. /readyz reports the database check passing', JSON.stringify(readyBody));

  if (BASE.startsWith('https://')) {
    check(Boolean(root.headers.get('strict-transport-security')), '6. HSTS is set', root.headers.get('strict-transport-security') ?? 'MISSING');
    const plain = await fetch(BASE.replace('https://', 'http://') + '/', { redirect: 'manual', signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (plain) {
      const loc = plain.headers.get('location') ?? '';
      check(plain.status >= 300 && plain.status < 400 && loc.startsWith('https://'),
        '6. plain HTTP redirects to HTTPS', `http ${plain.status} -> ${loc.slice(0, 50)}`);
    } else skip('6. plain HTTP redirect', 'HTTP port not reachable');
  }

  for (const [h, label] of [['content-security-policy','CSP'],['x-content-type-options','nosniff'],['x-frame-options','frame protection']]) {
    check(Boolean(root.headers.get(h)), `6. security header: ${label}`, (root.headers.get(h) ?? 'MISSING').slice(0, 40));
  }
  check(root.headers.get('x-powered-by') === null, '21. the server does not advertise its stack');

  // ══ 4. MIGRATIONS ═════════════════════════════════════════════════════
  section('4. Migrations');
  // Proved by exercising endpoints whose tables each migration added, rather
  // than by reading the migrations table - which is not reachable over HTTP.
  const plansProbe = await get('billing.plans');
  check(plansProbe.s === 200, '4. billing schema reachable (vendorSubscriptions)', `http ${plansProbe.s}`);
  const vendorsProbe = await get('marketplace.vendors', {});
  check(vendorsProbe.s === 200, '4. vendor directory schema reachable (vendorCategories, 0015)', `http ${vendorsProbe.s}`);

  // ══ 7, 8. REGISTRATION, LOGIN, SIX ROLES ══════════════════════════════
  section('7-8. Registration, login, all six roles');

  // Enumeration check first, before anything can exhaust the rate limiter.
  const probe = await signUp('homeowner', 'orac');
  const wrongPw = await post('auth.signIn', { identifier: probe.username, password: 'definitely-not-the-password' });
  const noSuch = await post('auth.signIn', { identifier: `ghost${STAMP}`, password: 'definitely-not-the-password' });
  check(!/Too many/.test(errMsg(wrongPw.t)) && !/Too many/.test(errMsg(noSuch.t)),
    '7. the enumeration check is testing auth, not rate limiting', errMsg(wrongPw.t));
  check(wrongPw.s === noSuch.s && errMsg(wrongPw.t) === errMsg(noSuch.t),
    '7. wrong password and unknown user are indistinguishable', `${wrongPw.s} / ${errMsg(wrongPw.t)}`);

  for (const role of ROLES) {
    const u = await signUp(role);
    users[role] = u;
    check(u.status === 200 && Boolean(u.cookie), `8. register ${role}`, `http ${u.status}`);
  }
  check(Object.values(users).every(u => u.cookie), '8. all six roles hold a session');

  const login = await post('auth.signIn', { identifier: users.homeowner.username, password: PW });
  check(login.s === 200, '7. sign in with username', `http ${login.s}`);
  const byEmail = await post('auth.signIn', { identifier: `${users.homeowner.username}@staging-qa.invalid`, password: PW });
  check(byEmail.s === 200, '7. sign in with email', `http ${byEmail.s}`);

  const sessionCookie = login.raw.headers.getSetCookie?.()?.[0] ?? '';
  if (BASE.startsWith('https://')) {
    check(/HttpOnly/i.test(sessionCookie), '21. the session cookie is HttpOnly');
    check(/Secure/i.test(sessionCookie), '21. the session cookie is Secure', sessionCookie.split(';').slice(1).join(';').trim());
  }

  const me = await get('auth.me', undefined, users.homeowner.cookie);
  check(me.s === 200 && me.t.includes(users.homeowner.username.slice(0, 6)) === false || me.s === 200,
    '7. the session authenticates', `http ${me.s}`);
  check(!me.t.includes('passwordHash') && !me.t.includes('invitationToken'),
    '21. auth.me returns no credential material');

  // ══ 5, 21. DATA ISOLATION AND EXPOSURE ════════════════════════════════
  section('5, 21. Isolation and exposure');
  const dirAll = await get('marketplace.vendors', {});
  const prodAll = await get('marketplace.list', { limit: 48 });
  const catsAll = await get('marketplace.vendorCategories', {});
  const featAll = await get('marketplace.featuredVendors', {});
  const combined = dirAll.t + prodAll.t;

  // THE STATUS CODE, ASSERTED. Everything downstream parses these bodies with
  // `json(t) ?? []`, and on a tRPC 500 that yields [] - which Array.isArray()
  // happily calls a list. So a 500 used to read as a PASS: the gate reported
  // "the product listing is database-backed" while the endpoint was failing.
  // Render's logs showed 500s on exactly these four procedures and the gate
  // said nothing, because it never once looked at the status.
  for (const [name, r] of [
    ['marketplace.list', prodAll],
    ['marketplace.vendors', dirAll],
    ['marketplace.vendorCategories', catsAll],
    ['marketplace.featuredVendors', featAll],
  ]) {
    check(r.s === 200, `11. ${name} responds without a server error`, `http ${r.s}`);
    check(!/\"error\"/.test(r.t.slice(0, 200)), `11. ${name} returns data, not a tRPC error`, r.t.slice(0, 120));
  }
  check(!/passwordHash|invitationToken|providerCustomerRef|providerSubscriptionRef/.test(combined),
    '21. no credential or provider handle in public responses');
  check(!/@(gmail|hotmail|yahoo|outlook)\.com/i.test(combined),
    '5. no real personal email addresses in public data');
  check(!/testvendor|testhomeowner|dummy_/.test(combined),
    '5. no legacy seeded/dummy accounts visible', 'staging DB looks freshly migrated');

  // ══ 11, 12. REAL DATA ONLY ════════════════════════════════════════════
  section('11-12. Marketplace and directory use real data');
  for (const invention of ['Cleopatra', 'Carrara', 'SunPower', 'Premium Ceramic Floor Tiles', 'Italian Marble Slabs']) {
    check(!combined.includes(invention), `11. no fabricated product: ${invention}`);
  }
  // Array.isArray([]) is true, so the previous version of these two checks
  // PASSED against an empty catalogue while claiming the listing was
  // "database-backed". That is a false positive of exactly the kind this gate
  // exists to prevent: it proved the endpoint returns an array, and nothing
  // else. An empty catalogue is now a SKIP - honest about knowing nothing -
  // and a populated one is checked for real.
  const prods = json(prodAll.t) ?? [];
  const dir = json(dirAll.t) ?? [];
  check(Array.isArray(prods), '11. the product endpoint answers with a list', `${prods.length} product(s)`);
  check(Array.isArray(dir), '12. the vendor endpoint answers with a list', `${dir.length} vendor(s)`);

  const dbBacked = (rows, label, fields) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      skip(label, 'the staging catalogue is empty - nothing to verify, so nothing is claimed');
      return;
    }
    const bad = rows.filter((r) => !fields.every((f) => r?.[f] !== undefined && r?.[f] !== null));
    check(bad.length === 0, label, `${rows.length} row(s), ${bad.length} missing ${fields.join('/')}`);
  };
  dbBacked(prods, '11. every product carries real database columns', ['id', 'name', 'category']);
  dbBacked(dir, '12. every directory vendor carries real database columns', ['id']);

  // Category filtering used to be asserted as `http 200`. That would have
  // passed the Slice 10 defect verbatim - `category` was accepted by the input
  // schema and then silently ignored, so every filtered request returned the
  // full catalogue with a cheerful 200. Assert the FILTER, not the status.
  const filtered = await get('marketplace.list', { category: 'Materials', limit: 48 });
  check(filtered.s === 200, '11. the filtered listing responds', `http ${filtered.s}`);
  const filteredRows = json(filtered.t) ?? [];
  if (!Array.isArray(prods) || prods.length === 0) {
    skip('11. category filtering actually filters', 'the staging catalogue is empty - a filter over nothing proves nothing');
  } else {
    const offCategory = filteredRows.filter((r) => r?.category && r.category !== 'Materials');
    check(
      offCategory.length === 0,
      '11. category filtering actually filters, server-side',
      `${filteredRows.length} row(s) returned, ${offCategory.length} outside "Materials"`,
    );
    const nonsense = await get('marketplace.list', { category: 'NoSuchCategory-' + STAMP, limit: 48 });
    const nonsenseRows = json(nonsense.t) ?? [];
    check(
      Array.isArray(nonsenseRows) && nonsenseRows.length === 0,
      '11. an unmatched category returns nothing, rather than everything',
      `${nonsenseRows.length} row(s)`,
    );
  }

  // ══ 16. BILLING AND PRICING HONESTY ═══════════════════════════════════
  section('16. Billing and pricing');
  const plans = json(plansProbe.t);
  check(plans?.plans?.length === 3, '16. three plans in the catalogue', String(plans?.plans?.length));
  check(plans?.plans?.find(p => p.id === 'professional')?.standard?.month === 499, '16. professional is EGP 499/month');
  check(plans?.plans?.find(p => p.id === 'premium')?.standard?.month === 999, '16. premium is EGP 999/month');
  check(plans?.checkoutAvailable === false, '16. checkout is honestly reported unavailable');
  for (const key of ['portfolioLevel', 'promotionalCapability', 'branchLimit', 'teamMemberLimit', 'visibilityLevel']) {
    check(plans?.entitlementAvailability?.[key] === false, `16. unbuilt entitlement not advertised: ${key}`);
  }
  check(plans?.entitlementAvailability?.qualifiedEnquiriesPerMonth === true, '16. enforced entitlements ARE advertised');

  // ══ 9. PASSWORD RESET ═════════════════════════════════════════════════
  section('9. Password reset / email');
  const caps = json((await get('auth.capabilities')).t);
  console.log(`INFO  capabilities: ${JSON.stringify(caps)}`);
  if (caps?.passwordReset) {
    const reset = await post('auth.requestPasswordReset', { email: `${users.homeowner.username}@staging-qa.invalid` });
    check(reset.s === 200, '9. a reset request is accepted', `http ${reset.s}`);
    const unknown = await post('auth.requestPasswordReset', { email: `nobody${STAMP}@staging-qa.invalid` });
    check(unknown.s === 200, '9. an unknown address returns the same success — no account oracle');
    console.log('INFO  9. delivery itself must be confirmed in the staging mailbox — SMTP is configured');
  } else {
    skip('9. password reset', 'auth.capabilities reports it unavailable — SMTP_HOST unset or credentials failed to verify at boot');
  }

  // ══ 10. UPLOADS ═══════════════════════════════════════════════════════
  section('10. Object storage uploads');
  const b64 = b => Buffer.from(b).toString('base64');
  const PNG = b64([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, ...Array(200).fill(0)]);
  const SVG = b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const HTMLF = b64(Buffer.from('<!doctype html><script>alert(document.cookie)</script>'));

  const svgTry = await post('profile.uploadAvatar', { fileName: 'a.svg', contentType: 'image/svg+xml', base64: SVG }, users.contractor.cookie);
  check(svgTry.t.includes('not accepted'), '10. SVG upload refused', `http ${svgTry.s}`);
  const svgAsPng = await post('profile.uploadAvatar', { fileName: 'a.png', contentType: 'image/png', base64: SVG }, users.contractor.cookie);
  check(svgAsPng.t.includes('not a readable image'), '10. SVG relabelled as PNG refused');
  const htmlAsPng = await post('profile.uploadAvatar', { fileName: 'a.png', contentType: 'image/png', base64: HTMLF }, users.contractor.cookie);
  check(htmlAsPng.t.includes('not a readable image'), '10. HTML relabelled as PNG refused');

  const realPng = await post('profile.uploadAvatar', { fileName: 'a.png', contentType: 'image/png', base64: PNG }, users.contractor.cookie);
  const storageConfigured = realPng.s === 200;
  if (storageConfigured) {
    const url = json(realPng.t)?.url ?? '';
    check(Boolean(url), '10. a genuine PNG uploads and returns a URL', url.slice(0, 60));
    const fetched = await fetch(`${BASE}${url}`, { headers: { cookie: users.contractor.cookie }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    check(fetched.ok, '10. the uploaded file is retrievable by its owner', `http ${fetched.status}`);
    const anon = await fetch(`${BASE}${url}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    check(anon.status === 401 || anon.status === 403, '10/21. the storage proxy refuses anonymous callers', `http ${anon.status}`);
  } else {
    check(!realPng.t.includes('not a readable image') && !realPng.t.includes('not accepted'),
      '10. a genuine PNG passes the TYPE check', 'storage backend not configured — upload failed later');
    skip('10. end-to-end upload to the staging bucket', `S3_* not configured: ${errMsg(realPng.t)?.slice(0, 70)}`);
  }

  // ══ 13, 14. RFQ, TARGETING, QUOTATIONS ════════════════════════════════
  section('13-14. RFQ, enquiry limits, quotations');
  const rfq = await post('rfq.create', {
    title: `QA RFQ ${STAMP}`, description: 'staging launch gate', category: 'Materials',
    location: 'Cairo', budget: 555111,
  }, users.homeowner.cookie);
  const rfqId = json(rfq.t)?.id;
  check(typeof rfqId === 'number', '13. a homeowner can post an RFQ', String(rfqId));

  const anonRfq = await get('rfq.list');
  check(anonRfq.s === 401 || anonRfq.t.includes('UNAUTHORIZED'), '21. rfq.list refuses anonymous callers', `http ${anonRfq.s}`);
  check(!anonRfq.t.includes('555111'), "21. the homeowner's budget does not reach anonymous callers");

  const usage = await get('billing.myEnquiryUsage', undefined, users.contractor.cookie);
  check(usage.s === 200, '13. the qualified-enquiry counter is readable', `http ${usage.s}`);
  const u0 = json(usage.t);
  check(u0 && typeof u0.used === 'number', '13. enquiry usage reports a real count', JSON.stringify(u0));

  const unapprovedQuote = await post('rfq.submitQuotation', { rfqId, price: 1000, timeline: 7 }, users.contractor.cookie);
  check(unapprovedQuote.s !== 200, '14. an UNAPPROVED provider cannot quote', `http ${unapprovedQuote.s}`);
  // The approved-provider half runs in the admin section below, because
  // approving a vendor requires an admin. It is skipped THERE when no admin is
  // supplied, so it is not announced twice.

  // ══ 15. MESSAGING AND NOTIFICATIONS ═══════════════════════════════════
  section('15. Messaging and notifications');
  const meHome = json((await get('auth.me', undefined, users.homeowner.cookie)).t);
  const meContractor = json((await get('auth.me', undefined, users.contractor.cookie)).t);
  if (meHome?.id && meContractor?.id) {
    const msg = await post('messages.send', { receiverId: meContractor.id, content: `QA hello ${STAMP}`, type: 'text' }, users.homeowner.cookie);
    check(msg.s === 200, '15. a message is sent', `http ${msg.s}`);
    const inbox = await get('messages.list', { otherUserId: meHome.id }, users.contractor.cookie);
    check(inbox.t.includes(`QA hello ${STAMP}`), '15. the recipient sees it');
    const third = await get('messages.list', { otherUserId: meHome.id }, users.engineer.cookie);
    check(!third.t.includes(`QA hello ${STAMP}`), '15/21. a third party does NOT see that conversation');
  } else check(false, '15. could not resolve user ids for messaging');
  check((await get('notifications.list', undefined, users.contractor.cookie)).s === 200, '15. notifications load');
  check((await get('notifications.unreadCount', undefined, users.contractor.cookie)).s === 200, '15. unread count loads');

  // ══ 18. ADMIN AUTHORIZATION ═══════════════════════════════════════════
  section('17-18. Admin authorization and the billing lifecycle');
  for (const proc of ['admin.users', 'admin.commercialKpis', 'admin.productAnalytics']) {
    const anon = await get(proc, {});
    check(anon.s === 401 || anon.t.includes('UNAUTHORIZED'), `18. anonymous refused: ${proc}`, `http ${anon.s}`);
    const nonAdmin = await get(proc, {}, users.homeowner.cookie);
    check(nonAdmin.s === 403 || nonAdmin.t.includes('FORBIDDEN'), `18. non-admin refused: ${proc}`, `http ${nonAdmin.s}`);
  }

  if (ADMIN_USER && ADMIN_PASSWORD) {
    const adminLogin = await post('auth.signIn', { identifier: ADMIN_USER, password: ADMIN_PASSWORD });
    if (adminLogin.s !== 200) {
      check(false, '18. the supplied staging admin can sign in', `http ${adminLogin.s}`);
    } else {
      const admin = adminLogin.c;
      check(true, '18. the staging admin signed in');
      const kpis = await get('admin.commercialKpis', { includeDummy: false }, admin);
      const k = json(kpis.t);
      check(kpis.s === 200, '18. commercial KPIs load for an admin', `http ${kpis.s}`);
      check(k?.mrr === 0 || typeof k?.mrr === 'number', '18. MRR is a real number', `MRR=${k?.mrr}`);
      check(k?.arpv === null || typeof k?.arpv === 'number', '16. ARPV is null when there is no basis, never a fake zero', `ARPV=${k?.arpv}`);
      check(!kpis.t.includes('providerCustomerRef'), '18/21. admin billing exposes no provider handle');

      const contractorId = json((await get('auth.me', undefined, users.contractor.cookie)).t)?.id;
      if (contractorId) {
        await post('admin.updateApplicantStatus', { userId: contractorId, status: 'approved' }, admin);
        const q = await post('rfq.submitQuotation', { rfqId, price: 9000, timeline: 14 }, users.contractor.cookie);
        check(q.s === 200, '14. an APPROVED provider can submit a quotation', `http ${q.s}`);
        const stranger = await post('rfq.acceptQuotation', { quotationId: 1, rfqId }, users.engineer.cookie);
        check(stranger.s !== 200, '14. a stranger cannot accept a quotation on another RFQ', `http ${stranger.s}`);

        const trial = await post('admin.startVendorTrial', { userId: contractorId, plan: 'professional', interval: 'month' }, admin);
        check(trial.s === 200, '17. an admin can start a trial', `http ${trial.s}`);
        const life = json((await get('billing.myLifecycle', undefined, users.contractor.cookie)).t);
        check(life?.lifecycleState === 'TRIALING', '17. the vendor sees TRIALING', life?.lifecycleState);
        const cancel = await post('billing.cancelSubscription', undefined, users.contractor.cookie);
        check(cancel.s === 200, '17. cancellation is accepted', `http ${cancel.s}`);
        const afterCancel = json((await get('billing.myLifecycle', undefined, users.contractor.cookie)).t);
        check(afterCancel?.cancelAtPeriodEnd === true, '17. cancellation is scheduled, access retained', String(afterCancel?.lifecycleState));
        const resume = await post('billing.resumeSubscription', undefined, users.contractor.cookie);
        check(resume.s === 200, '17. resume is accepted', `http ${resume.s}`);
        const afterResume = json((await get('billing.myLifecycle', undefined, users.contractor.cookie)).t);
        check(afterResume?.cancelAtPeriodEnd === false, '17. resume clears the cancellation');
        const again = await post('billing.cancelSubscription', undefined, users.contractor.cookie);
        check(again.s === 200, '17. repeating a transition is an idempotent success, not an error', `http ${again.s}`);
      }
    }
  } else {
    skip('17. subscription lifecycle (trial, cancel, resume)', 'no STAGING_ADMIN_USER/PASSWORD supplied');
    skip('18. admin billing visibility', 'no STAGING_ADMIN_USER/PASSWORD supplied');
    skip('14. approved-provider quotation flow', 'needs an admin to approve the vendor');
  }

  // ══ 19, 20. BROWSER: LANGUAGES AND VIEWPORTS ══════════════════════════
  section('19-20. Arabic/English, mobile/desktop');
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const appErrors = [];
  const thirdPartyFailures = new Set();
  const ROUTES = ['/', '/pricing', '/marketplace', '/marketplace/products', '/marketplace/vendors', '/auth'];

  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile375', { width: 375, height: 800 }]]) {
    for (const lang of ['en', 'ar']) {
      const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
      const page = await ctx.newPage();
      // Classified by ORIGIN, not by message text. Chromium reports a failed
      // subresource as a bare "Failed to load resource: net::ERR_..." with no
      // URL in the message, so filtering on text cannot tell a third-party
      // font CDN apart from a broken application asset. requestfailed carries
      // the URL, so first-party failures are counted and third-party ones are
      // reported separately rather than silently dropped.
      page.on('requestfailed', r => {
        const url = r.url();
        if (url.startsWith(BASE)) appErrors.push(`${label}/${lang} ${r.failure()?.errorText} ${url.replace(BASE, '')}`);
        else thirdPartyFailures.add(new URL(url).host);
      });
      page.on('console', m => {
        if (m.type() !== 'error') return;
        const origin = m.location()?.url ?? '';
        // A console error attributable to a third-party host is that host's
        // problem; one with no origin at all is application JavaScript.
        if (origin && !origin.startsWith(BASE)) return;
        if (/Failed to load resource/.test(m.text())) return; // covered by requestfailed above
        appErrors.push(`${label}/${lang} ${m.text().slice(0, 90)}`);
      });
      await page.addInitScript(l => localStorage.setItem('buildhub_lang', l), lang);

      for (const route of ROUTES) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(400);
        const body = await page.locator('body').innerText().catch(() => '');
        check(page.url().includes(route) || route === '/', `20. ${label}/${lang} ${route}: reachable`, page.url().replace(BASE, ''));
        check(body.length > 40, `20. ${label}/${lang} ${route}: renders content`, `${body.length} chars`);
        if (route === '/') {
          check(await page.getAttribute('html', 'lang') === lang, `19. ${label}/${lang}: html lang correct`);
          check(await page.getAttribute('html', 'dir') === (lang === 'ar' ? 'rtl' : 'ltr'), `19. ${label}/${lang}: direction correct`);
        }
        if (viewport.width === 375) {
          const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(ov <= 1, `20. ${label}/${lang} ${route}: no horizontal overflow`, `${ov}px`);
        }
      }
      await ctx.close();
    }
  }
  check(appErrors.length === 0, '20. no first-party request or console errors on any public route', appErrors.slice(0, 3).join(' | '));
  if (thirdPartyFailures.size) {
    console.log(`INFO  third-party hosts that failed to load: ${Array.from(thirdPartyFailures).join(', ')}`);
    console.log('INFO  these are not application defects, but confirm they are expected for this environment');
  }

  // Arabic pricing must render localised numerals.
  const ctxAr = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
  const pAr = await ctxAr.newPage();
  await pAr.addInitScript(() => localStorage.setItem('buildhub_lang', 'ar'));
  await pAr.goto(`${BASE}/pricing`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  const arText = await pAr.locator('body').innerText().catch(() => '');
  check(/[٠-٩]/.test(arText), '19. Arabic pricing renders Arabic-Indic numerals');
  await ctxAr.close();

  // ══ 21. NOTHING SENSITIVE IN THE DELIVERED PAGE ═══════════════════════
  section('21. Secret exposure');
  for (const secret of ['JWT_SECRET', 'DATABASE_URL', 'SMTP_PASSWORD', 'S3_SECRET', 'mysql://', 'BEGIN PRIVATE KEY']) {
    check(!html.includes(secret), `21. the delivered page contains no ${secret}`);
  }
  const boom = await get('marketplace.get', { id: 'not-a-number' });
  check(!boom.t.includes('/app/') && !boom.t.includes('node_modules') && !boom.t.includes('at Object.'),
    '21. errors carry no stack trace or filesystem path');

} catch (error) {
  fail++;
  failures.push(`harness: ${error instanceof Error ? error.message : String(error)}`);
  console.log(`FAIL  harness — ${error instanceof Error ? error.stack?.split('\n').slice(0, 3).join(' | ') : String(error)}`);
} finally {
  if (browser) await browser.close();
  console.log(`\n${pass}/${pass + fail} checks passed, ${skipped} skipped, against ${BASE}`);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  if (skipped) console.log('\nSkipped checks are NOT passes. See the SKIP lines above for what each one needs.');
  process.exit(fail === 0 ? 0 : 1);
}

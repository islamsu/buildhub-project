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

// Opt-in. The knowledge-priority acceptance suite makes SIX extra paid
// provider requests, so a routine gate run must not pay for it. Section 29
// runs only when this is explicitly turned on for an acceptance run.
const AI_KNOWLEDGE_SUITE = (process.env.STAGING_AI_KNOWLEDGE_SUITE ?? '').trim() === 'true';

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

/**
 * ONE administrator sign-in per run, reused everywhere.
 *
 * The gate used to call auth.adminSignIn from sections 23, 25, 18 and 26, plus
 * a browser form sign-in - five attempts against the SAME identifier every run.
 * `authLimiters.identifierSustained` allows ten per fifteen minutes, so two
 * back-to-back runs were fine and three were not: run #25 collapsed with
 * `http 429` and 41 downstream failures that looked like a broken admin UI and
 * were nothing of the kind.
 *
 * The limiter was right; the harness was greedy. Signing in once and sharing the
 * cookie takes a run from five attempts to two - this one and the deliberate
 * browser-form sign-in in section 26, which has to be a real form submission
 * because proving the form works is the point of it.
 *
 * Cached rather than re-requested, so a section that runs after a rotation still
 * gets the same Super Admin session; nothing in the gate changes that account.
 */
let adminSessionCookie;
let adminSignInStatus;
const superAdminCookie = async () => {
  if (adminSessionCookie === undefined) {
    const r = await post('auth.adminSignIn', { identifier: ADMIN_USER, password: ADMIN_PASSWORD });
    adminSignInStatus = r.s;
    adminSessionCookie = r.s === 200 ? r.c : null;
  }
  return adminSessionCookie;
};

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

  // ══ 24. ABUSE CONTROLS ON AUTHENTICATED CONTENT ═══════════════════════
  //
  // Sign-in was rate limited; what an account could DO once signed in was not,
  // so one authenticated caller could flood the RFQ feed or fill the bucket.
  // The limits are unit-tested, but "wired in the source" and "enforced by the
  // running deployment" are different claims - a build that tree-shook the call
  // or a stale image would pass the first and fail the second.
  //
  // Probed with a DEDICATED throwaway account so the budget it burns belongs to
  // nobody else: the other sections upload and post as the shared personas, and
  // a shared limiter would make this check order-dependent.
  section('24. Rate limits on authenticated content');
  const abuser = await signUp('homeowner', 'rate');
  if (!abuser.cookie) {
    skip('24. authenticated content rate limits', 'the probe account could not be created');
  } else {
    // Upload burst is 10/min. Fire 12 refusable payloads: the type check
    // rejects each one anyway, so nothing reaches storage, and what we are
    // measuring is whether the LIMIT arrives before the type check stops
    // mattering.
    let uploadLimited = 0;
    let uploadAttempts = 0;
    for (let i = 0; i < 12; i++) {
      const r = await post('profile.uploadAvatar', { fileName: `x${i}.png`, contentType: 'image/png', base64: HTMLF }, abuser.cookie);
      uploadAttempts++;
      if (r.s === 429 || r.t.includes('Too many requests')) { uploadLimited++; break; }
    }
    check(uploadLimited > 0, '24. upload flooding is refused', `limited after ${uploadAttempts} attempts (burst allows 10/min)`);

    // RFQ burst is 3/min. The first few succeed and are real rows - acceptable
    // on staging, and they carry the QA stamp so they are identifiable.
    let rfqLimited = 0;
    let rfqCreated = 0;
    for (let i = 0; i < 6; i++) {
      const r = await post('rfq.create', {
        title: `QA rate-limit probe ${STAMP} #${i}`, description: 'abuse-control probe', category: 'Materials',
        location: 'Cairo',
      }, abuser.cookie);
      if (r.s === 429 || r.t.includes('Too many requests')) { rfqLimited++; break; }
      if (r.s === 200) rfqCreated++;
    }
    check(rfqLimited > 0, '24. RFQ flooding is refused', `${rfqCreated} accepted, then limited (burst allows 3/min)`);
    check(rfqCreated > 0, '24. the limit does not block legitimate posting', `${rfqCreated} accepted before the limit`);
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

  // ══ 23. THE ADMINISTRATOR DOOR ════════════════════════════════════════
  //
  // Everything here is verifiable WITHOUT an administrator credential, which
  // matters because staging has none unless ADMIN_BOOTSTRAP_* is set. What can
  // be proved from outside is that the door exists, that it is a different door
  // from /auth, and that it refuses everyone who is not an administrator.
  //
  // Signing a real Super Admin in is a separate claim, and it is SKIPPED rather
  // than assumed - see the skip below.
  section('23. Administrator authentication');

  // The SPA serves index.html for every route, so a 200 here proves the route
  // is served, not that the page renders. The rendering claim is the browser
  // check further down, which asserts the admin form is actually present.
  const adminLoginPage = await fetch(`${BASE}/admin/login`).catch(() => null);
  check(adminLoginPage?.status === 200, '23. /admin/login is served', `http ${adminLoginPage?.status}`);

  // A real customer account, at the administrator door.
  const customerAtAdminDoor = await post('auth.adminSignIn', {
    identifier: users.homeowner.username, password: PW,
  });
  check(customerAtAdminDoor.s !== 200, '23. a customer CANNOT sign in at the administrator door', `http ${customerAtAdminDoor.s}`);

  // ...and the refusal must be indistinguishable from an account that does not
  // exist, or the endpoint becomes an oracle for which accounts are admins.
  const ghostAtAdminDoor = await post('auth.adminSignIn', {
    identifier: `nosuch${Date.now()}`, password: 'whatever-this-is-wrong',
  });
  const customerMessage = json(customerAtAdminDoor.t)?.message ?? customerAtAdminDoor.t;
  const ghostMessage = json(ghostAtAdminDoor.t)?.message ?? ghostAtAdminDoor.t;
  check(
    customerAtAdminDoor.s === ghostAtAdminDoor.s && customerMessage === ghostMessage,
    '23. that refusal is INDISTINGUISHABLE from an unknown account',
    `${customerAtAdminDoor.s} vs ${ghostAtAdminDoor.s}`,
  );

  // The administrator management surface, from a normal customer session.
  for (const proc of ['admin.me', 'admin.admins']) {
    const anon = await get(proc, {});
    check(anon.s === 401 || anon.t.includes('UNAUTHORIZED'), `22. anonymous refused: ${proc}`, `http ${anon.s}`);
    const customer = await get(proc, {}, users.homeowner.cookie);
    check(customer.s === 403 || customer.t.includes('FORBIDDEN'), `22. a customer is refused: ${proc}`, `http ${customer.s}`);
  }
  const customerCreate = await post('admin.createAdmin', {
    name: 'Should Not Exist', email: `nope${Date.now()}@example.test`,
    username: `nope${Date.now()}`.slice(0, 18), adminRole: 'SUPER_ADMIN',
  }, users.homeowner.cookie);
  check(customerCreate.s !== 200, '23. a customer cannot create an administrator', `http ${customerCreate.s}`);

  // Redeeming an invitation with a token nobody issued.
  const forgedInvite = await post('auth.completeAdminInvitation', {
    token: 'f'.repeat(43), password: 'a-long-enough-password',
  });
  check(forgedInvite.s !== 200, '23. a forged administrator invitation is refused', `http ${forgedInvite.s}`);

  if (ADMIN_USER && ADMIN_PASSWORD) {
    const supered = await superAdminCookie();
    check(adminSignInStatus === 200, '23. the supplied staging administrator signs in at /admin/login', `http ${adminSignInStatus}`);
    if (supered) {
      const me = await get('admin.me', undefined, supered);
      const m = json(me.t);
      check(me.s === 200 && typeof m?.adminRole === 'string', '23. admin.me reports a role', `role=${m?.adminRole}`);
      check(Array.isArray(m?.permissions) && m.permissions.length > 0, '23. and a non-empty permission set', `${m?.permissions?.length} permissions`);
      check(!me.t.includes('passwordHash') && !me.t.includes('scrypt$'), '23/21. admin.me carries no credential material');
    }
  } else {
    skip('23. a real administrator signs in and loads the admin surface',
         'no STAGING_ADMIN_USER/PASSWORD supplied - set ADMIN_BOOTSTRAP_* on the service, then these secrets');
  }

  // ══ 25. SUB-ADMIN LIFECYCLE ═══════════════════════════════════════════
  //
  // Everything section 23 proves is NEGATIVE: the administrator door refuses
  // customers, anonymous callers and forged tokens. That leaves the entire
  // positive path unproven on live staging - creating an administrator,
  // redeeming the invitation, choosing a role, and each role being confined to
  // its own permissions. Those are the operations that actually grant authority,
  // so they are the ones worth proving against a running deployment.
  //
  // ONE sub-admin account per run, rotated through all four specialist roles
  // rather than four accounts created and abandoned. That covers role selection
  // AND role change, and leaves staging one identifiable, deactivated row
  // instead of four.
  //
  // NOTHING SECRET IS EVER PRINTED. The invitation token and the sub-admin
  // password exist only as local constants; every check below reports a status
  // code, a role name or a boolean. `check` prints its detail argument, so no
  // detail argument anywhere in this section is derived from either value.
  section('25. Sub-admin lifecycle: invitation, acceptance, roles, boundaries');

  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    for (const name of [
      '25. a Super Admin reaches the administrators page',
      '25. a Super Admin can invite a sub-administrator',
      '25. the invitation is single-use',
      '25. each administrator role is confined to its own permissions',
      '25. a sub-administrator cannot elevate itself',
    ]) skip(name, 'no STAGING_ADMIN_USER/PASSWORD supplied - set ADMIN_BOOTSTRAP_* on the service, then these secrets');
  } else {
    const SUPER_COOKIE = await superAdminCookie();
    if (!SUPER_COOKIE) {
      check(false, '25. the Super Admin session is available', `sign-in http ${adminSignInStatus}`);
    } else {
      const SUPER = SUPER_COOKIE;

      // ── A. The administrators page, from a Super Admin session ──────────
      const adminsPage = await get('admin.admins', undefined, SUPER);
      const adminRows = json(adminsPage.t);
      check(adminsPage.s === 200, '25. a Super Admin reaches the administrators page', `http ${adminsPage.s}`);
      check(Array.isArray(adminRows) && adminRows.length > 0,
        '25. the administrators page lists at least the bootstrapped Super Admin', `${adminRows?.length} row(s)`);
      check(!/passwordHash|scrypt\$|tokenHash/.test(adminsPage.t),
        '25/21. the administrators page carries no credential material');

      // ── B. Invite a sub-administrator ───────────────────────────────────
      const subUser = `qasub${STAMP}`;
      const subPassword = `Sub-Admin-QA-${STAMP}!`;
      const created = await post('admin.createAdmin', {
        name: `QA Sub Admin ${STAMP}`,
        email: `qasub${STAMP}@staging-qa.invalid`,
        username: subUser,
        adminRole: 'USER_ADMIN',
      }, SUPER);
      const createdBody = json(created.t);
      check(created.s === 200, '25. a Super Admin can invite a sub-administrator', `http ${created.s}`);

      const subId = createdBody?.userId;
      // Held locally, never printed. Every check below reports only shape.
      const inviteLink = createdBody?.invitationLink ?? '';
      const token = inviteLink.split('token=')[1] ?? '';
      check(inviteLink.startsWith('/admin/accept-invitation?token='),
        '25. the invitation link is returned once, to the inviter only');
      check(token.length >= 40, '25. the invitation token is long enough to be unguessable',
        `${token.length} characters`);
      const ttlHours = createdBody?.expiresAt
        ? Math.round((new Date(createdBody.expiresAt) - Date.now()) / 3_600_000) : -1;
      check(ttlHours > 0 && ttlHours <= 48, '25. the invitation expires within 48 hours', `~${ttlHours}h`);

      if (created.s === 200 && subId && token) {
        // ── C. Invitation metadata must not carry the credential ──────────
        const invs = await get('admin.adminInvitations', { userId: subId }, SUPER);
        check(invs.s === 200, '25. a Super Admin can audit outstanding invitations', `http ${invs.s}`);
        check(!invs.t.includes(token) && !/tokenHash/.test(invs.t),
          '25/21. the invitation audit exposes neither the raw token nor its hash');
        check(json(invs.t)?.[0]?.usedAt === null, '25. the invitation is recorded as unused before redemption');

        // A customer must not reach the invitation audit at all.
        const customerInvs = await get('admin.adminInvitations', { userId: subId }, users.homeowner.cookie);
        check(customerInvs.s === 403 || customerInvs.t.includes('FORBIDDEN'),
          '25. a customer cannot read administrator invitations', `http ${customerInvs.s}`);

        // ── D. Redeem, then prove it cannot be redeemed twice ─────────────
        const accepted = await post('auth.completeAdminInvitation', { token, password: subPassword });
        check(accepted.s === 200, '25. the invitee redeems the invitation and sets a password', `http ${accepted.s}`);
        const replay = await post('auth.completeAdminInvitation', { token, password: `Replayed-${STAMP}!` });
        check(replay.s !== 200, '25. the invitation is single-use', `replay http ${replay.s}`);

        const afterUse = await get('admin.adminInvitations', { userId: subId }, SUPER);
        check(typeof json(afterUse.t)?.[0]?.usedAt === 'string',
          '25. redemption is recorded, so a used invitation is auditable');

        // ── E. The sub-administrator signs in at the administrator door ───
        const subLogin = await post('auth.adminSignIn', { identifier: subUser, password: subPassword });
        check(subLogin.s === 200, '25. the new sub-administrator signs in at /admin/login', `http ${subLogin.s}`);
        const SUB = subLogin.c;

        // ── F. Role coverage and permission boundaries ────────────────────
        //
        // Each pair is DISCRIMINATING: the permitted endpoint needs a permission
        // only this role holds, and the forbidden one needs a permission it does
        // not. `admin.users` is deliberately NOT used as a permitted probe -
        // every role holds users.read, so it would pass for all four and prove
        // nothing about the role.
        const matrix = [
          { role: 'USER_ADMIN',        allow: ['admin.fullAuditReport', 'audit.read'],        deny: ['admin.commercialKpis', 'billing.read'] },
          { role: 'MARKETPLACE_ADMIN', allow: ['admin.complianceQueue', 'marketplace.manage'], deny: ['admin.fullAuditReport', 'audit.read'] },
          { role: 'SUPPORT_ADMIN',     allow: ['admin.disputes', 'support.manage'],            deny: ['admin.complianceQueue', 'marketplace.manage'] },
          { role: 'BILLING_ADMIN',     allow: ['admin.commercialKpis', 'billing.read'],        deny: ['admin.disputes', 'support.manage'] },
        ];

        for (const { role, allow, deny } of matrix) {
          if (role !== 'USER_ADMIN') {
            const rotated = await post('admin.setAdminRole', { userId: subId, adminRole: role }, SUPER);
            check(rotated.s === 200, `25. a Super Admin assigns ${role}`, `http ${rotated.s}`);

            // THE PROPERTY THAT MATTERS, and it is not "the session dies".
            //
            // A first draft of this section asserted that the target's existing
            // cookie stops working after a role change. It ran against live
            // staging and failed three times - correctly, because that is not
            // how BuildHub works and never was. setAdminRole updates the row and
            // writes an audit event; it does not touch sessionsInvalidBefore
            // (only deactivation, session revocation and password reset do).
            //
            // That is sound, because authenticateRequest re-reads the user row
            // from the database on EVERY request, so ctx.user.adminRole is
            // always live. The session survives; the AUTHORITY changes at once.
            // Demoting somebody should narrow what they can do, not log them out
            // mid-task.
            //
            // So the assertion is the security property itself: on the SAME
            // cookie, the new role is in force immediately and the endpoint the
            // PREVIOUS role could reach is now refused. This is what would catch
            // a regression that cached the role in the token - the failure mode
            // where a demoted administrator keeps their old powers until the JWT
            // expires, which here could be up to a year.
            const carried = await get('admin.me', undefined, SUB);
            check(carried.s === 200 && json(carried.t)?.adminRole === role,
              `25. the existing session carries ${role} immediately, with no re-login`,
              `http ${carried.s}, role=${json(carried.t)?.adminRole}`);
          }

          const me = await get('admin.me', undefined, SUB);
          const mine = json(me.t);
          check(mine?.adminRole === role, `25. admin.me reports ${role}`, `role=${mine?.adminRole}`);
          check(Array.isArray(mine?.permissions) && mine.permissions.includes(allow[1]),
            `25. ${role} holds ${allow[1]}`);
          check(Array.isArray(mine?.permissions) && !mine.permissions.includes(deny[1]),
            `25. ${role} does NOT hold ${deny[1]}`);

          const permitted = await get(allow[0], allow[0] === 'admin.complianceQueue' ? {} : undefined, SUB);
          check(permitted.s === 200, `25. ${role} may call ${allow[0]}`, `http ${permitted.s}`);

          // The matrix is CHAINED: each role's permitted probe is exactly the
          // next role's forbidden one. So on every rotation after the first,
          // this same call is also the demotion check - the endpoint the
          // previous role could reach, refused on the very same cookie.
          const forbidden = await get(deny[0], deny[0] === 'admin.complianceQueue' ? {} : undefined, SUB);
          check(forbidden.s === 403 || forbidden.t.includes('FORBIDDEN'),
            `25. ${role} is REFUSED ${deny[0]}`, `http ${forbidden.s}`);

          // Super-Admin-only surface, refused for every specialist role.
          const mgmt = await get('admin.admins', undefined, SUB);
          check(mgmt.s === 403 || mgmt.t.includes('FORBIDDEN'),
            `25. ${role} cannot reach the administrators page`, `http ${mgmt.s}`);

          // Self-elevation, the operation that would make every boundary above
          // pointless if it worked.
          const elevate = await post('admin.setAdminRole', { userId: subId, adminRole: 'SUPER_ADMIN' }, SUB);
          check(elevate.s !== 200, `25. ${role} cannot elevate itself to SUPER_ADMIN`, `http ${elevate.s}`);
          // The status code alone is weak evidence: this call is refused by the
          // permission gate AND by setAdminRole's own self-target check, so a
          // non-200 proves only that something said no. What matters is that
          // the authority did not actually move, so read it back.
          const stillScoped = json((await get('admin.me', undefined, SUB)).t);
          check(stillScoped?.adminRole === role,
            `25. ${role} still holds exactly ${role} after attempting to elevate`,
            `role=${stillScoped?.adminRole}`);
        }

        // ── G. Cleanup, which is itself an assertion ──────────────────────
        const deactivated = await post('admin.setAdminActive', { userId: subId, active: false }, SUPER);
        check(deactivated.s === 200, '25. the QA sub-administrator is deactivated after the run', `http ${deactivated.s}`);
        const deadLogin = await post('auth.adminSignIn', { identifier: subUser, password: subPassword });
        check(deadLogin.s !== 200, '25. a deactivated administrator can no longer sign in', `http ${deadLogin.s}`);
      }
    }
  }

  // ══ 18. ADMIN AUTHORIZATION ═══════════════════════════════════════════
  section('17-18. Admin authorization and the billing lifecycle');
  for (const proc of ['admin.users', 'admin.commercialKpis', 'admin.productAnalytics']) {
    const anon = await get(proc, {});
    check(anon.s === 401 || anon.t.includes('UNAUTHORIZED'), `18. anonymous refused: ${proc}`, `http ${anon.s}`);
    const nonAdmin = await get(proc, {}, users.homeowner.cookie);
    check(nonAdmin.s === 403 || nonAdmin.t.includes('FORBIDDEN'), `18. non-admin refused: ${proc}`, `http ${nonAdmin.s}`);
  }

  if (ADMIN_USER && ADMIN_PASSWORD) {
    const adminCookie = await superAdminCookie();
    if (!adminCookie) {
      check(false, '18. an administrator session is available', `sign-in http ${adminSignInStatus}`);
    } else {
      const admin = adminCookie;
      check(true, '18. the staging admin session is in force');
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

  // ══ 26. AUTHENTICATED ADMIN UI, IN A REAL BROWSER ═════════════════════
  //
  // Sections 23 and 25 drive the admin API. Everything they prove is about
  // tRPC responses. The rendered admin SPA behind authentication had never been
  // opened by anything, which is a different claim: a screen can be broken,
  // blank, or leaking while every endpoint behind it answers correctly.
  //
  // So this signs in through the FORM, navigates like a person, and reads what
  // is actually on screen. It also watches first-party console errors and failed
  // requests for the authenticated routes, which the public browser pass above
  // cannot reach.
  //
  // NOTHING SECRET IS PRINTED. The password is typed into a field and the token
  // is only ever compared against captured output; no check detail is derived
  // from either.
  section('26. Authenticated admin UI (browser)');

  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    for (const name of [
      '26. the Super Admin signs in through the browser form',
      '26. the Admin Control Panel renders its statistics and navigation',
      '26. /admin/admins renders the administrator table',
      '26. a sub-administrator is refused /admin/admins in the browser',
    ]) skip(name, 'no STAGING_ADMIN_USER/PASSWORD supplied');
  } else {
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
    const ap = await adminCtx.newPage();
    const adminErrors = [];
    const consoleText = [];
    ap.on('requestfailed', r => {
      if (r.url().startsWith(BASE)) adminErrors.push(`${r.failure()?.errorText} ${r.url().replace(BASE, '')}`);
    });
    ap.on('console', m => {
      consoleText.push(m.text());
      if (m.type() !== 'error') return;
      const origin = m.location()?.url ?? '';
      if (origin && !origin.startsWith(BASE)) return;
      if (/Failed to load resource/.test(m.text())) return;
      adminErrors.push(m.text().slice(0, 90));
    });

    // ── A. The administrator door, as a person meets it ────────────────
    await ap.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    const loginText = await ap.locator('body').innerText().catch(() => '');
    check(loginText.includes('Administrator sign-in'), '26. /admin/login renders the administrator sign-in form');
    check(loginText.includes('Customer accounts sign in at /auth'),
      '26. the door tells staff it is not the customer door');

    await ap.fill('input[placeholder="Username or email"]', ADMIN_USER);
    await ap.fill('input[type="password"]', ADMIN_PASSWORD);
    await ap.click('button:has-text("Sign in")');
    await ap.waitForURL(/\/admin$/, { timeout: 30_000 }).catch(() => {});
    await ap.waitForTimeout(2_000);
    check(/\/admin$/.test(ap.url()), '26. the Super Admin signs in through the browser form',
      ap.url().replace(BASE, ''));

    // ── B. The Admin Control Panel, as rendered ────────────────────────
    const dash = await ap.locator('body').innerText().catch(() => '');
    check(!dash.includes('Access Denied'), '26. the authenticated Super Admin is NOT shown Access Denied');
    for (const stat of ['Total Users', 'Active Projects', 'Products Listed', 'Open Disputes']) {
      check(dash.includes(stat), `26. the dashboard renders the "${stat}" statistic`);
    }
    for (const tab of ['Users', 'Compliance', 'Analytics', 'Vendor billing', 'Disputes', 'Fraud Detection', 'Settings']) {
      check(dash.includes(tab), `26. the dashboard navigation offers "${tab}"`);
    }
    check(dash.includes('User Management by Group'), '26. the Users tab renders the user-management surface');
    check(!/scrypt\$|passwordHash|tokenHash/.test(dash),
      '26/21. the rendered dashboard carries no credential material');

    // ── C. /admin/admins, as rendered ──────────────────────────────────
    await ap.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    await ap.waitForTimeout(1_500);
    const adminsText = await ap.locator('body').innerText().catch(() => '');
    check(adminsText.includes('Administrators'), '26. /admin/admins renders the administrator table');
    check(!adminsText.includes('Super Admin only'),
      '26. a real Super Admin is not shown the Super-Admin-only refusal');
    // CASE-INSENSITIVE, and that is the point rather than laziness. The header
    // row carries Tailwind's `uppercase`, and innerText returns RENDERED text,
    // so the DOM says "Username" while the browser reports "USERNAME". A
    // case-sensitive includes() reported four missing columns that are present
    // and correct - a harness bug that would have read as a UI defect.
    const adminsUpper = adminsText.toUpperCase();
    for (const column of ['Name', 'Username', 'Email', 'Role', 'Status', 'Created', 'Last login', 'Actions']) {
      check(adminsUpper.includes(column.toUpperCase()),
        `26. the administrator table shows the "${column}" column`);
    }
    check(adminsText.includes('Super Admin'), '26. the bootstrapped administrator displays its role');
    check(adminsText.includes('Active'), '26. the bootstrapped administrator displays its status');
    check(adminsText.includes('Invite administrator'), '26. the "Invite administrator" control is visible');
    check(!/scrypt\$|passwordHash|tokenHash/.test(adminsText),
      '26/21. the administrator table renders no credential material');

    // The invitation modal and its role selector.
    await ap.click('button:has-text("Invite administrator")').catch(() => {});
    await ap.waitForTimeout(800);
    const modal = await ap.locator('body').innerText().catch(() => '');
    check(modal.includes('Invite an administrator'), '26. the invitation modal opens');
    // Asserted as PLACEHOLDER ATTRIBUTES, not as text. These fields carry no
    // visible label - the prompt is the placeholder - and a placeholder is never
    // part of innerText. Reading them from the DOM is the only way to prove the
    // form asks for them; the first draft looked for body text and reported
    // three fields missing that were on screen the whole time.
    for (const field of ['Full name', 'Username', 'Email']) {
      const count = await ap.locator(`input[placeholder="${field}"]`).count().catch(() => 0);
      check(count === 1, `26. the invitation form asks for "${field}"`, `${count} field(s)`);
    }
    check(modal.includes('Create and issue link'), '26. the invitation form offers to issue a one-time link');
    check(modal.includes('They receive a one-time link and choose their own password'),
      '26. the form states the Super Admin will never see the password');

    // The role selector, and that it offers exactly the five real roles.
    //
    // SCOPED TO THE DIALOG. Every row of the administrator table behind the
    // modal renders its own role Select, so a bare button[role="combobox"]
    // matches several and Playwright's strict mode refuses to click any of
    // them - which cost a 30-second timeout and six failures that looked like
    // a missing selector rather than an ambiguous one. The options themselves
    // are portalled outside the dialog, so they are queried globally.
    await ap.locator('[role="dialog"] button[role="combobox"]').first().click().catch(() => {});
    await ap.waitForTimeout(800);
    const roleOptions = await ap.locator('[role="option"]').allInnerTexts().catch(() => []);
    check(roleOptions.length === 5, '26. the role selector renders every administrator role',
      `${roleOptions.length} option(s)`);
    for (const label of ['Super Admin', 'User Admin', 'Marketplace Admin', 'Support Admin', 'Billing Admin']) {
      check(roleOptions.some(o => o.trim() === label), `26. the role selector offers "${label}"`);
    }
    await ap.keyboard.press('Escape').catch(() => {});
    await ap.keyboard.press('Escape').catch(() => {});

    // ── D. A QA sub-administrator, in the browser ──────────────────────
    //
    // Its own identity, separate from section 25's, so the two cannot interfere
    // whichever order they run in.
    const su2c = await superAdminCookie();
    const uiUser = `qaui${STAMP}`;
    const uiPassword = `Sub-Admin-UI-${STAMP}!`;
    const madeUi = await post('admin.createAdmin', {
      name: `QA UI Sub Admin ${STAMP}`,
      email: `qaui${STAMP}@staging-qa.invalid`,
      username: uiUser,
      adminRole: 'SUPPORT_ADMIN',
    }, su2c);
    const uiId = json(madeUi.t)?.userId;
    const uiToken = (json(madeUi.t)?.invitationLink ?? '').split('token=')[1] ?? '';
    check(madeUi.s === 200 && Boolean(uiId), '26. a QA sub-administrator is created for the UI pass', `http ${madeUi.s}`);

    if (uiId && uiToken) {
      const redeemed = await post('auth.completeAdminInvitation', { token: uiToken, password: uiPassword });
      check(redeemed.s === 200, '26. the QA sub-administrator redeems its invitation', `http ${redeemed.s}`);

      // Sign in through the FORM, as that administrator would.
      const subCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
      const sp = await subCtx.newPage();
      const subErrors = [];
      sp.on('requestfailed', r => { if (r.url().startsWith(BASE)) subErrors.push(r.url().replace(BASE, '')); });
      sp.on('console', m => {
        consoleText.push(m.text());
        if (m.type() !== 'error') return;
        const origin = m.location()?.url ?? '';
        if (origin && !origin.startsWith(BASE)) return;
        if (/Failed to load resource/.test(m.text())) return;
        subErrors.push(m.text().slice(0, 90));
      });

      await sp.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await sp.fill('input[placeholder="Username or email"]', uiUser);
      await sp.fill('input[type="password"]', uiPassword);
      await sp.click('button:has-text("Sign in")');
      await sp.waitForURL(/\/admin$/, { timeout: 30_000 }).catch(() => {});
      await sp.waitForTimeout(2_000);
      check(/\/admin$/.test(sp.url()), '26. the sub-administrator signs in through the browser form',
        sp.url().replace(BASE, ''));
      const subDash = await sp.locator('body').innerText().catch(() => '');
      check(!subDash.includes('Access Denied'),
        '26. a SUPPORT_ADMIN reaches the admin surface rather than Access Denied');

      // Direct navigation to a Super-Admin-only URL, typed rather than clicked.
      await sp.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await sp.waitForTimeout(1_500);
      const refused = await sp.locator('body').innerText().catch(() => '');
      check(refused.includes('Super Admin only'),
        '26. a sub-administrator is refused /admin/admins in the browser');
      check(!refused.includes('Invite administrator'),
        '26. the sub-administrator is not offered the invite control');

      // A role change must reach the BROWSER too, on the same session.
      const promoted = await post('admin.setAdminRole', { userId: uiId, adminRole: 'SUPER_ADMIN' }, su2c);
      check(promoted.s === 200, '26. a Super Admin promotes the QA sub-administrator', `http ${promoted.s}`);
      await sp.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await sp.waitForTimeout(1_500);
      const nowAllowed = await sp.locator('body').innerText().catch(() => '');
      check(nowAllowed.includes('Administrators') && !nowAllowed.includes('Super Admin only'),
        '26. the promotion reaches the existing browser session with no re-login');

      const demoted = await post('admin.setAdminRole', { userId: uiId, adminRole: 'BILLING_ADMIN' }, su2c);
      check(demoted.s === 200, '26. a Super Admin demotes the QA sub-administrator', `http ${demoted.s}`);
      await sp.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await sp.waitForTimeout(1_500);
      const refusedAgain = await sp.locator('body').innerText().catch(() => '');
      check(refusedAgain.includes('Super Admin only'),
        '26. the demotion reaches the browser immediately - access is withdrawn, not deferred');

      check(subErrors.length === 0, '26. no first-party console or request errors on the sub-admin surface',
        subErrors.slice(0, 3).join(' | '));

      // ── E. Cleanup, asserted rather than assumed ────────────────────
      const off = await post('admin.setAdminActive', { userId: uiId, active: false }, su2c);
      check(off.s === 200, '26. the QA UI sub-administrator is deactivated', `http ${off.s}`);
      await sp.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await sp.fill('input[placeholder="Username or email"]', uiUser);
      await sp.fill('input[type="password"]', uiPassword);
      await sp.click('button:has-text("Sign in")');
      await sp.waitForTimeout(2_500);
      check(!/\/admin$/.test(sp.url()),
        '26. the deactivated administrator cannot sign in through the browser', sp.url().replace(BASE, ''));
      await subCtx.close();
    }

    // ── F. Nothing secret reached the console ──────────────────────────
    const consoleBlob = consoleText.join('\n');
    check(!consoleBlob.includes(uiPassword) && !consoleBlob.includes(ADMIN_PASSWORD),
      '26/21. no administrator password appears in browser console output');
    check(uiToken.length === 0 || !consoleBlob.includes(uiToken),
      '26/21. no raw invitation token appears in browser console output');
    check(adminErrors.length === 0, '26. no first-party console or request errors on the admin surface',
      adminErrors.slice(0, 3).join(' | '));
    await adminCtx.close();
  }

  // ══ 21. NOTHING SENSITIVE IN THE DELIVERED PAGE ═══════════════════════
  // ── 27. AI Assistant ─────────────────────────────────────────────────────
  //
  // COST CONTROL, stated explicitly because it is a design decision and not an
  // oversight: this run makes AT MOST ONE PAID PROVIDER REQUEST, and it is made
  // in section 28 THROUGH THE BROWSER, IN ARABIC.
  //
  // That placement is the whole trick. The proof required is
  // BuildHub -> OpenAI -> real response -> BuildHub -> browser, and a request
  // submitted through the chat UI travels that entire path in one go: Playwright
  // captures the ai.chat HTTP response on the way back, so the same single
  // request yields the status, the returned payload AND the rendered answer. An
  // API call here plus a browser call there would prove the same thing twice and
  // cost twice.
  //
  // Arabic rather than English because Arabic is the harder case and the
  // provider path is language-agnostic: right-to-left layout, a non-Latin
  // script through the composer, and an answer that has to come back in the
  // language it was asked in. Proving the hard case proves the shared path.
  // The English surface is still asserted, free, in its own context.
  //
  // So this section spends nothing. It asserts what is free: the page, what the
  // deployment declares about itself, and the anonymous refusal.
  //
  // All eight tools on /ai - Cost Estimator, Quantity Surveyor, Material
  // Advisor, Project Manager, Risk Detector, Procurement, Maintenance, General
  // Consultant - are the same `trpc.ai.chat` mutation with a different opening
  // prompt, so one request proves the provider integration for all eight.
  //
  // SKIP vs FAIL:
  //   OPENAI_API_KEY absent  -> aiAssistant:false, and the provider round trip
  //                             SKIPS in section 28, naming what it needs
  //   OPENAI_API_KEY present -> any provider failure is a FAILURE. A configured
  //                             provider returning 401/429/500/timeout/empty
  //                             must never be softened into a skip.
  section('27. AI Assistant');

  const aiPage = await fetch(`${BASE}/ai`, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  check(aiPage.status === 200, '27. the AI Assistant page is reachable', `http ${aiPage.status}`);

  const aiCaps = json((await get('auth.capabilities')).t);
  const aiConfigured = aiCaps?.aiAssistant === true;
  check(typeof aiCaps?.aiAssistant === 'boolean',
    '27. the deployment declares whether AI is available', `aiAssistant: ${aiCaps?.aiAssistant}`);
  console.log(`INFO  27. aiAssistant capability: ${aiCaps?.aiAssistant}`);

  // Free: anonymous use must be refused, and refused with the login message
  // rather than the generic internal one - if this ever returns the generic
  // message it means the request got past auth and died in the provider path.
  const aiAnon = await post('ai.chat', { messages: [{ role: 'user', content: 'ping' }] });
  const anonMsg = errMsg(aiAnon.t) ?? '';
  check(aiAnon.s === 401, '27. anonymous AI use is refused', `http ${aiAnon.s}`);
  check(/10001/.test(anonMsg), '27. the refusal is an auth refusal, not a masked internal error', anonMsg.slice(0, 60));

  if (!aiConfigured) {
    // Free: an unconfigured deployment refuses without contacting anyone, so
    // this costs nothing and still proves the refusal is deliberate.
    const aiUnconf = await post('ai.chat', { messages: [{ role: 'user', content: 'ping' }] }, users.homeowner?.cookie);
    let unconfCode = '';
    try { unconfCode = JSON.parse(aiUnconf.t)?.error?.json?.data?.code ?? ''; } catch { /* not an error envelope */ }
    const unconfMsg = errMsg(aiUnconf.t) ?? '';
    check(aiUnconf.s === 503 && unconfCode === 'SERVICE_UNAVAILABLE',
      '27. an unconfigured deployment refuses deliberately, not with a masked internal error',
      `http ${aiUnconf.s} ${unconfCode || 'no code'}`);
    check(unconfMsg !== 'Something went wrong. Please try again.',
      '27. the caller is told the feature is unavailable, not that something broke', unconfMsg.slice(0, 70));
    for (const leak of ['OPENAI_API_KEY', 'BUILT_IN_FORGE', 'api.openai.com', 'forge.manus.im', 'Bearer ', 'at Object.', 'node_modules']) {
      check(!unconfMsg.includes(leak), `27/21. the AI error exposes no ${leak.trim()}`);
    }
  }

  // ── 28. AI Assistant in a real browser ───────────────────────────────────
  //
  // Section 27 proves the page and the refusals. A screen can still be broken,
  // blank or leaking while the endpoint behind it answers correctly - which is
  // exactly how this feature shipped: /ai rendered perfectly and nothing on it
  // worked.
  //
  // This section carries the RUN'S ONE PAID REQUEST when AI is configured: a
  // real construction question typed into the real composer, submitted through
  // the real UI, with the ai.chat response captured off the wire and the
  // answer asserted on screen.
  section('28. AI Assistant in a real browser');

  const aiCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
  // ai.chat is a protectedProcedure, so an anonymous browser could only ever
  // prove the login wall. The session cookie from section 8 is injected
  // directly rather than driving the sign-in form again, which keeps this
  // section clear of the per-identifier auth rate limit.
  if (users.homeowner?.cookie) {
    const [name, ...rest] = users.homeowner.cookie.split('=');
    await aiCtx.addCookies([{
      name: name.trim(), value: rest.join('='), domain: new URL(BASE).hostname,
      path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'None',
    }]);
  }
  const aiPageB = await aiCtx.newPage();
  const aiErrors = [];
  aiPageB.on('console', m => { if (m.type() === 'error' && !/favicon|third-party/i.test(m.text())) aiErrors.push(m.text()); });
  aiPageB.on('requestfailed', r => { if (r.url().startsWith(BASE)) aiErrors.push(`request failed: ${new URL(r.url()).pathname}`); });

  // COUNTED, not captured. The English surface must cost nothing: merely
  // loading /ai must not fire an AI request, and the run's single paid call
  // belongs to the Arabic context below. This counter turns "one request per
  // run" from a claim in a comment into something the run itself checks.
  let englishAiRequests = 0;
  aiPageB.on('response', r => {
    if (r.url().includes('/api/trpc/ai.chat')) englishAiRequests++;
  });

  try {
    await aiPageB.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await aiPageB.waitForTimeout(2500);
    const aiText = await aiPageB.locator('body').innerText();

    check(/AI|الذكاء/i.test(aiText), '28. the AI Assistant page renders', aiText.slice(0, 50).replace(/\n/g, ' '));

    for (const tool of ['Cost Estimator', 'Quantity Surveyor', 'Material Advisor', 'Project Manager', 'Risk Detector', 'Procurement', 'Maintenance', 'General Consultant']) {
      check(aiText.toLowerCase().includes(tool.toLowerCase()), `28. the "${tool}" tool is offered`);
    }

    const bannerShown = /not available|unavailable|غير متاح/i.test(aiText);
    const disabledCards = await aiPageB.locator('[aria-disabled="true"]').count();
    const composerEn = aiPageB.locator('textarea').first();
    const dirEn = await aiPageB.evaluate(() => document.documentElement.getAttribute('dir'));

    if (aiConfigured) {
      check(!bannerShown, '28. no unavailable banner is shown on a configured deployment');
      check(disabledCards === 0, '28. all eight tool cards are enabled', `${disabledCards} disabled`);
      check(await composerEn.isEnabled(), '28. the message composer accepts input');
      check(dirEn !== 'rtl', '28. the English surface is left-to-right', `dir=${dirEn}`);
    } else {
      skip('28. a real OpenAI request answers a real question',
        'OPENAI_API_KEY is not configured on this deployment - the provider round trip is NOT proven. Set OPENAI_API_KEY (and optionally OPENAI_MODEL, default gpt-5.6-luna).');
      check(bannerShown, '28. the honest unavailable banner is shown when AI is unconfigured');
      check(disabledCards === 8, '28. all eight tool cards are inert rather than clickable', `${disabledCards} inert`);
      check(await composerEn.isDisabled(), '28. the message composer refuses input');
    }

    // ══ ARABIC, and where the run's ONE PAID REQUEST is spent ═══════════════
    //
    // Its own context: the language is set before first paint via
    // addInitScript, with the same session cookie, because ai.chat is a
    // protectedProcedure.
    //
    // The key is `buildhub_lang` - LanguageContext reads exactly that - and the
    // layout assertion is dir=rtl, never "some Arabic characters are present".
    // An earlier draft wrote the wrong key and asserted the latter: the page
    // stayed in English and the check passed anyway, because the navbar's
    // language toggle is itself labelled العربية. A check that passes on the
    // control that would SWITCH the language proves nothing about the page.
    const arCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: BASE.includes('127.0.0.1') });
    if (users.homeowner?.cookie) {
      const [arName, ...arRest] = users.homeowner.cookie.split('=');
      await arCtx.addCookies([{
        name: arName.trim(), value: arRest.join('='), domain: new URL(BASE).hostname,
        path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'None',
      }]);
    }
    const arPage = await arCtx.newPage();
    const arErrors = [];
    arPage.on('console', m => { if (m.type() === 'error' && !/favicon|third-party/i.test(m.text())) arErrors.push(m.text()); });
    arPage.on('requestfailed', r => { if (r.url().startsWith(BASE)) arErrors.push(`request failed: ${new URL(r.url()).pathname}`); });

    let arHttpStatus = 0;
    let arPayload = '';
    const arBodyRead = [];
    arPage.on('response', r => {
      if (!r.url().includes('/api/trpc/ai.chat')) return;
      arHttpStatus = r.status();
      // Push the PROMISE and await it after the exchange settles. Awaiting
      // inside the handler races the page's own consumption of the body.
      arBodyRead.push(r.text().then(t => { arPayload = t; }).catch(() => {}));
    });

    try {
      await arPage.addInitScript(() => localStorage.setItem('buildhub_lang', 'ar'));
      await arPage.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await arPage.waitForTimeout(2500);

      const dirBefore = await arPage.evaluate(() => document.documentElement.getAttribute('dir'));
      const langBefore = await arPage.evaluate(() => document.documentElement.getAttribute('lang'));
      check(dirBefore === 'rtl', '28. the AI page switches to right-to-left in Arabic', `dir=${dirBefore}`);
      check(langBefore === 'ar', '28. the document language is Arabic', `lang=${langBefore}`);
      const arBodyBefore = await arPage.locator('body').innerText();
      check(/[؀-ۿ]/.test(arBodyBefore), '28. the AI page renders Arabic text');

      if (!aiConfigured) {
        check(/غير متاح/.test(arBodyBefore), '28. the unavailable notice is translated into Arabic');
      } else {
        // ══ THE ONE PAID REQUEST ═══════════════════════════════════════════
        // A genuine Arabic construction question, typed into the real composer.
        const AR_QUESTION = 'أريد تقديرًا مبدئيًا لتكلفة تشطيب شقة بمساحة 120 متر مربع. ما المعلومات التي تحتاجها مني لإعطائي تقديرًا أدق؟';
        const arComposer = arPage.locator('textarea').first();
        check(await arComposer.isEnabled(), '28. the Arabic composer accepts input');
        await arComposer.fill(AR_QUESTION);
        await arComposer.press('Enter');

        const t0 = Date.now();
        await arPage.waitForResponse(r => r.url().includes('/api/trpc/ai.chat'), { timeout: 120_000 }).catch(() => {});
        const elapsed = Date.now() - t0;
        await arPage.waitForTimeout(3000);
        await Promise.all(arBodyRead);

        // The browser uses httpBatchLink (client/src/main.tsx), so its response
        // body is a tRPC BATCH ARRAY - [{ result: … }] - not the bare object the
        // harness's own post() receives. Handle both shapes.
        const arEnvelope = (() => {
          try {
            const parsed = JSON.parse(arPayload);
            return Array.isArray(parsed) ? parsed[0] : parsed;
          } catch { return undefined; }
        })();
        const arContent = arEnvelope?.result?.data?.json?.content ?? '';
        const arCode = arEnvelope?.error?.json?.data?.code ?? '';
        const arMsg = arEnvelope?.error?.json?.message ?? '';

        console.log(`INFO  28. ai.chat (Arabic, browser) -> http ${arHttpStatus}${arCode ? ` ${arCode}` : ''} in ${elapsed}ms`);
        console.log(`INFO  28. Arabic answer length: ${arContent.length} chars`);
        if (arHttpStatus !== 200) {
          console.log(`INFO  28. refusal message: ${arMsg || '(none captured)'}`);
          console.log(`INFO  28. refused by: ${/Too many AI requests/i.test(arMsg) ? "BuildHub's own AI rate limiter" : 'the provider path'}`);
        }

        check(arHttpStatus === 200, '28. the Arabic AI request succeeds against the configured provider',
          `http ${arHttpStatus}${arCode ? ` ${arCode}` : ''} in ${elapsed}ms${arHttpStatus !== 200 ? ` — ${arMsg.slice(0, 90)}` : ''}`);
        check(arContent.trim().length > 0, '28. BuildHub returns a non-empty Arabic answer',
          arContent ? `${arContent.trim().slice(0, 60)}…` : `no content; ${arCode || 'no code'}`);

        // The ANSWER must be Arabic, not merely the page around it.
        const arabicChars = (arContent.match(/[؀-ۿ]/g) ?? []).length;
        check(arabicChars > 20, '28. the answer itself is written in Arabic', `${arabicChars} Arabic characters in the answer`);

        // Not the echo. The answer must differ from the question that was typed.
        check(arContent.trim() !== AR_QUESTION, '28. the answer is not the question echoed back');

        // Rendered, proved from the DOM and independent of the envelope parse.
        const arBodyAfter = await arPage.locator('body').innerText();
        const grewBy = arBodyAfter.length - arBodyBefore.length - AR_QUESTION.length;
        check(grewBy > 20, '28. the Arabic answer appears on screen, beyond the question that was typed',
          `${grewBy} chars beyond the ${AR_QUESTION.length}-char question`);
        const arRendered = arContent.trim().slice(0, 24);
        check(arRendered.length > 0 && arBodyAfter.includes(arRendered),
          '28. the rendered Arabic answer is the one the server returned',
          arRendered ? 'server text found on screen' : 'payload not parsed - the DOM check above is the standalone proof');
        check(!/Something went wrong/i.test(arBodyAfter), '28. the Arabic page shows no generic failure message');
        check(!/not available on this deployment|غير متاح/i.test(arBodyAfter), '28. the Arabic page shows no unavailable message');

        // Layout must survive the answer - an RTL page that flips to LTR when
        // content arrives is a broken Arabic experience, not a working one.
        const dirAfter = await arPage.evaluate(() => document.documentElement.getAttribute('dir'));
        check(dirAfter === 'rtl', '28. the page is still right-to-left after the answer renders', `dir=${dirAfter}`);

        for (const leak of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer ', 'sk-proj', 'at Object.', 'node_modules']) {
          check(!arPayload.includes(leak), `28/13. the Arabic AI response payload contains no ${leak.trim()}`);
        }
      }

      const arDelivered = await arPage.content();
      for (const leak of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer ']) {
        check(!arDelivered.includes(leak), `28/13. the delivered Arabic AI page contains no ${leak.trim()}`);
      }
      check(!/\bsk-[A-Za-z0-9]{20,}/.test(arDelivered), '28/13. the delivered Arabic AI page contains no API-key-shaped string');
      check(!arErrors.some(e => /sk-[A-Za-z0-9]{20,}|OPENAI_API_KEY/i.test(e)), '28/13. no credential appears in Arabic browser console output');
      check(arErrors.length === 0, '28. no first-party console or request errors on the Arabic AI page',
        arErrors.slice(0, 2).join(' | ').slice(0, 300));
    } finally {
      await arCtx.close();
    }

    check(englishAiRequests === 0, '28. loading the AI page costs nothing - no request until one is sent',
      `${englishAiRequests} ai.chat request(s) on the English surface`);

    const delivered = await aiPageB.content();
    for (const leak of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer ']) {
      check(!delivered.includes(leak), `28/13. the delivered AI page contains no ${leak.trim()}`);
    }
    // A key SHAPE, not the bare "sk-" substring. Tailwind emits mask-image
    // custom properties that minify to fragments like "sk-image-conic-from-pos",
    // so a substring check reports a credential leak on a page that has none -
    // and a false alarm on this exact check is how a real one gets ignored.
    check(!/\bsk-[A-Za-z0-9]{20,}/.test(delivered), '28/13. the delivered AI page contains no API-key-shaped string');
    check(!aiErrors.some(e => /sk-[A-Za-z0-9]{20,}|OPENAI_API_KEY/i.test(e)), '28/13. no credential appears in browser console output');
    check(aiErrors.length === 0, '28. no first-party console or request errors on the AI page',
      aiErrors.slice(0, 2).join(' | ').slice(0, 300));
  } finally {
    await aiCtx.close();
  }

  // ── 29. BuildHub knowledge priority (OPT-IN, SIX PAID REQUESTS) ──────────
  //
  // Off unless STAGING_AI_KNOWLEDGE_SUITE=true, because these are the only
  // checks in the gate that cost more than one provider call.
  //
  // HOW THIS PROVES GROUNDING RATHER THAN VIBES. "The model seems to know
  // BuildHub" is not evidence. Each BuildHub question here has an answer
  // containing a NUMBER that exists only in BuildHub's own source - the
  // Professional price, the free plan's monthly enquiry allowance, the trial
  // length. A model answering from general knowledge cannot produce 499 EGP;
  // if it appears, the briefing demonstrably reached the model and was used.
  if (AI_KNOWLEDGE_SUITE) {
    section('29. BuildHub knowledge priority (live)');

    const ask = async (question, lang) => {
      const t0 = Date.now();
      const r = await post('ai.chat', { messages: [{ role: 'user', content: question }], lang }, users.homeowner?.cookie);
      const answer = json(r.t)?.content ?? '';
      let code = '';
      try { code = JSON.parse(r.t)?.error?.json?.data?.code ?? ''; } catch { /* success envelope */ }
      return { s: r.s, answer, code, ms: Date.now() - t0 };
    };
    const arabic = text => (text.match(/[؀-ۿ]/g) ?? []).length;

    // 1. A normal construction question - the general-expertise path.
    const q1 = await ask('What is a reasonable concrete cover for reinforcement in a foundation exposed to soil?', 'en');
    console.log(`INFO  29.1 general construction -> http ${q1.s} in ${q1.ms}ms, ${q1.answer.length} chars`);
    check(q1.s === 200 && q1.answer.length > 40, '29.1 a general construction question gets a real expert answer',
      q1.answer ? `${q1.answer.slice(0, 60)}…` : `http ${q1.s} ${q1.code}`);

    // 2. A BuildHub question whose answer is in BuildHub's own source.
    const q2 = await ask('On BuildHub, how many qualified enquiries per month does the free vendor plan include?', 'en');
    console.log(`INFO  29.2 BuildHub fact -> http ${q2.s} in ${q2.ms}ms`);
    check(q2.s === 200 && /\b5\b/.test(q2.answer),
      '29.2 a BuildHub fact is answered from BuildHub content (the free plan allowance)',
      q2.answer ? `${q2.answer.slice(0, 90)}…` : `http ${q2.s} ${q2.code}`);

    // 3. The tricky one: a generic marketplace assumption, contradicted.
    const q3 = await ask('Most construction marketplaces charge the customer a fee to post a request for quotation. Does BuildHub charge customers to submit an RFQ?', 'en');
    console.log(`INFO  29.3 tricky conflict -> http ${q3.s} in ${q3.ms}ms`);
    check(q3.s === 200 && /free|no charge|does not charge|no fee/i.test(q3.answer),
      '29.3 BuildHub content beats the generic marketplace assumption',
      q3.answer ? `${q3.answer.slice(0, 110)}…` : `http ${q3.s} ${q3.code}`);

    // 4. Something BuildHub genuinely does not publish. The assistant must say
    //    so rather than invent a policy.
    const q4 = await ask('What is BuildHub\'s refund policy if a vendor cancels a subscription halfway through a paid month?', 'en');
    console.log(`INFO  29.4 not covered -> http ${q4.s} in ${q4.ms}ms`);
    check(q4.s === 200 && /not specify|does not specify|not specified|no published|not stated|does not state|not published/i.test(q4.answer),
      '29.4 an unpublished point is acknowledged, not invented',
      q4.answer ? `${q4.answer.slice(0, 110)}…` : `http ${q4.s} ${q4.code}`);
    check(q4.s === 200 && !/refund policy is|BuildHub refunds/i.test(q4.answer),
      '29.4 no BuildHub refund policy is fabricated');

    // 5 and 6. THE SAME BuildHub question in both languages. Same source, same
    //    number, different answer language - which is the whole requirement.
    //
    // The expected price is read from the DEPLOYMENT's own billing.plans, not
    // from this repository. So the assertion is "the assistant's answer agrees
    // with what this staging build actually serves on its pricing page" - which
    // is the claim worth making, and it cannot pass by coincidence: a model
    // answering from general knowledge has no way to produce this number.
    const planDoc = json((await get('billing.plans')).t);
    const professional = (planDoc?.plans ?? []).find(plan => plan.id === 'professional');
    const PRICE = String(professional?.standard?.month ?? '');
    console.log(`INFO  29. professional monthly price served by this deployment: ${PRICE || 'unknown'} ${planDoc?.currency ?? ''}`);
    check(PRICE.length > 0, '29. the deployment publishes a Professional monthly price to check the answer against', PRICE);
    const q5 = await ask('كم تبلغ تكلفة خطة Professional الشهرية على BuildHub؟', 'ar');
    console.log(`INFO  29.5 Arabic BuildHub fact -> http ${q5.s} in ${q5.ms}ms, ${arabic(q5.answer)} Arabic chars`);
    check(q5.s === 200 && q5.answer.includes(PRICE),
      `29.5 the Arabic answer carries BuildHub's own price (${PRICE} EGP)`,
      q5.answer ? `${q5.answer.slice(0, 90)}…` : `http ${q5.s} ${q5.code}`);
    check(q5.s === 200 && arabic(q5.answer) > 20, '29.5 the Arabic question is answered in Arabic',
      `${arabic(q5.answer)} Arabic characters`);

    const q6 = await ask('How much does the Professional plan cost per month on BuildHub?', 'en');
    console.log(`INFO  29.6 English BuildHub fact -> http ${q6.s} in ${q6.ms}ms, ${arabic(q6.answer)} Arabic chars`);
    check(q6.s === 200 && q6.answer.includes(PRICE),
      `29.6 the English answer carries the SAME BuildHub price (${PRICE} EGP)`,
      q6.answer ? `${q6.answer.slice(0, 90)}…` : `http ${q6.s} ${q6.code}`);
    check(q6.s === 200 && arabic(q6.answer) === 0, '29.6 the English question is answered in English',
      `${arabic(q6.answer)} Arabic characters`);

    // The knowledge source did not change with the language. That is the claim.
    check(q5.answer.includes(PRICE) && q6.answer.includes(PRICE),
      '29. the same authoritative fact reaches both languages - only the wording changes');

    for (const leak of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer ', 'JWT_SECRET', 'DATABASE_URL', 'SUPER_ADMIN', 'passwordHash']) {
      const all = [q1, q2, q3, q4, q5, q6].map(q => q.answer).join(' ');
      check(!all.includes(leak), `29/13. no AI answer exposes ${leak.trim()}`);
    }
  } else {
    skip('29. BuildHub knowledge priority (live)',
      'opt-in: this suite makes six extra paid provider requests. Dispatch with ai_knowledge_suite=true to run it.');
  }

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

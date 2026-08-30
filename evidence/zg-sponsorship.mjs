// ── LIVE: sponsored placement, both routes, and what must NOT appear ───────
//
// The rule only a real database can prove: `liveSponsorshipFilter` is a WHERE
// clause, so an expired or revoked grant vanishing from the directory cannot
// be tested against a table-keyed double. Here it is exercised for real.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
async function freshContext() {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await c.route('**/*', r => {
    const h = new URL(r.request().url()).hostname;
    return (h === '127.0.0.1' || h === 'localhost') ? r.continue() : r.abort();
  });
  return c;
}

const stamp = Date.now() % 100000000;
const made = [];
const CATEGORY = 'Materials';

async function go(p, u, width) {
  if (width) await p.setViewportSize({ width, height: 900 });
  await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(900);
}

async function account(prefix) {
  const p = await (await freshContext()).newPage();
  await go(p, '/auth');
  await (await p.locator('button.p-4.rounded-xl').all())[0].click();
  const u = `${prefix}${stamp}`;
  await p.getByPlaceholder(/username|اسم/i).fill(u);
  await p.locator('input[type="email"]').fill(`${u}@example.test`);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill('SponsorPass!2026'); await pw.nth(1).fill('SponsorPass!2026');
  await p.getByRole('button', { name: /create account|إنشاء/i }).last().click();
  await p.waitForTimeout(2600);
  const me = await p.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  if (!me?.id) throw new Error(`registration failed for ${prefix}`);
  made.push(me.id);
  return { p, id: me.id, username: u };
}

const call = (page, path, input) => page.evaluate(async ([pa, i]) => {
  const res = await fetch(`/api/trpc/${pa}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: i }),
  });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: res.status, data: j?.result?.data?.json ?? null, error: j?.error?.json?.message ?? null };
}, [path, input]);

const query = (page, path, input) => page.evaluate(async ([pa, i]) => {
  const qs = i === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: i }))}`;
  const res = await fetch(`/api/trpc/${pa}${qs}`, { credentials: 'include' });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: res.status, data: j?.result?.data?.json ?? null, error: j?.error?.json?.message ?? null };
}, [path, input]);

const sponsoredIds = r => (r.data ?? []).map(v => v.id);

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const vendor = await account('spvd');
  // verified=0 deliberately: signUp sets `verified: !professional`, so an
  // account registered through the homeowner picker arrives verified. Leaving
  // it would make the "sponsorship is not verification" check measure a
  // homeowner's verification rather than a supplier's.
  sql(`update users set userRole='supplier', onboardingStatus='approved', verified=0 where id=${vendor.id}`);
  const rival = await account('sprv');
  sql(`update users set userRole='supplier', onboardingStatus='approved', verified=0 where id=${rival.id}`);
  const pending = await account('sppd');
  sql(`update users set userRole='supplier', onboardingStatus='under_review' where id=${pending.id}`);

  const marketAdmin = await account('spma');
  sql(`update users set role='admin', adminRole='MARKETPLACE_ADMIN', userRole='admin' where id=${marketAdmin.id}`);
  const billingAdmin = await account('spba');
  sql(`update users set role='admin', adminRole='BILLING_ADMIN', userRole='admin' where id=${billingAdmin.id}`);

  for (const a of [vendor, rival, pending, marketAdmin, billingAdmin]) await go(a.p, '/');
  for (const a of [vendor, rival]) await call(a.p, 'profile.setMyCategories', { categories: [CATEGORY] });

  // ── 1. Nothing is sponsored until somebody grants it ────────────────────
  const before = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('NO FABRICATION: nobody is sponsored before any grant exists',
    !sponsoredIds(before).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(before))}`);

  // ── 2. Who may grant ────────────────────────────────────────────────────
  const byVendor = await call(vendor.p, 'admin.grantSponsorship', {
    vendorId: vendor.id, category: CATEGORY, reason: 'Sponsoring myself',
  });
  check('a vendor cannot grant themselves a sponsored slot', byVendor.status !== 200, `http=${byVendor.status}`);

  const byBilling = await call(billingAdmin.p, 'admin.grantSponsorship', {
    vendorId: vendor.id, category: CATEGORY, reason: 'Billing admin attempt',
  });
  check('BILLING_ADMIN lacks marketplace.manage and is REFUSED',
    byBilling.status !== 200, `http=${byBilling.status} err=${String(byBilling.error).slice(0, 40)}`);

  const verifiedBeforeGrant = sql(`select verified from users where id=${vendor.id}`);
  const granted = await call(marketAdmin.p, 'admin.grantSponsorship', {
    vendorId: vendor.id, category: CATEGORY, reason: 'Launch partner agreement',
  });
  check('MARKETPLACE_ADMIN holds marketplace.manage and MAY grant',
    granted.status === 200 && granted.data?.outcome === 'granted',
    `http=${granted.status} err=${String(granted.error).slice(0, 50)}`);

  const sponsorshipId = granted.data?.sponsorshipId
    ?? Number(sql(`select id from vendorSponsorships where vendorId=${vendor.id} order by id desc limit 1`));

  check('DATABASE: the grant records the category, granter and reason',
    sql(`select concat(category,'|',grantedBy,'|',grantedReason) from vendorSponsorships where id=${sponsorshipId}`)
      === `${CATEGORY}|${marketAdmin.id}|Launch partner agreement`);
  check('AUDIT: an account audit event names the administrative action',
    sql(`select action from userAccountAuditEvents where userId=${vendor.id} order by id desc limit 1`) === 'sponsorship_granted');

  const rejectPending = await call(marketAdmin.p, 'admin.grantSponsorship', {
    vendorId: pending.id, category: CATEGORY, reason: 'Not approved yet',
  });
  check('an UNAPPROVED provider cannot be sponsored',
    rejectPending.status !== 200, String(rejectPending.error).slice(0, 50));
  check('DATABASE: and no row was created for them',
    sql(`select count(*) from vendorSponsorships where vendorId=${pending.id}`) === '0');

  const dup = await call(marketAdmin.p, 'admin.grantSponsorship', {
    vendorId: vendor.id, category: CATEGORY, reason: 'Second grant',
  });
  check('a SECOND live grant in the same category is refused - one arrangement, not two slots',
    dup.status !== 200, String(dup.error).slice(0, 55));
  check('DATABASE: still exactly one row',
    sql(`select count(*) from vendorSponsorships where vendorId=${vendor.id} and category='${CATEGORY}'`) === '1');

  const farFuture = await call(marketAdmin.p, 'admin.grantSponsorship', {
    vendorId: rival.id, category: CATEGORY, reason: 'Beyond the epoch',
    endsAt: new Date('2099-01-01T00:00:00Z').toISOString(),
  });
  check('a date beyond the 2038 epoch limit is refused with a SENTENCE, not a 500',
    farFuture.status === 400 && /before 2038/i.test(String(farFuture.error)),
    `http=${farFuture.status} err=${String(farFuture.error).slice(0, 60)}`);
  check('DATABASE: and no row was written for it',
    sql(`select count(*) from vendorSponsorships where vendorId=${rival.id}`) === '0');

  // ── 3. The grant reaches the directory ──────────────────────────────────
  const afterGrant = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('THE GRANTED VENDOR NOW APPEARS in the sponsored strip',
    sponsoredIds(afterGrant).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(afterGrant))}`);
  check('and is labelled as an ADMIN GRANT, not as a plan entitlement',
    (afterGrant.data ?? []).find(v => v.id === vendor.id)?.sponsorshipSource === 'granted',
    `source=${(afterGrant.data ?? []).find(v => v.id === vendor.id)?.sponsorshipSource}`);
  check('an unsponsored rival does NOT appear in the strip',
    !sponsoredIds(afterGrant).includes(rival.id));

  const otherCategory = await query(vendor.p, 'marketplace.sponsoredVendors', { category: 'Plumbing' });
  check('CATEGORY SCOPED: the grant does not leak into a different category',
    !sponsoredIds(otherCategory).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(otherCategory))}`);

  // BEFORE and AFTER, not an absolute: the question is whether the GRANT
  // changed it, which an absolute assertion cannot distinguish from the
  // account having arrived that way.
  check('SPONSORSHIP IS NOT VERIFICATION: the grant did not change verified',
    verifiedBeforeGrant === sql(`select verified from users where id=${vendor.id}`)
      && sql(`select verified from users where id=${vendor.id}`) === '0',
    `before=${verifiedBeforeGrant} after=${sql(`select verified from users where id=${vendor.id}`)}`);
  check('SPONSORSHIP IS NOT A RATING: the grant did not change reviewCount',
    sql(`select reviewCount from users where id=${vendor.id}`) === '0');

  // ── 4. THE LIVENESS FILTER, against a real WHERE clause ─────────────────
  // Expire the grant by moving its window into the past. Nothing sweeps this
  // table, so if the filter is right it disappears on the very next read.
  sql(`update vendorSponsorships set startsAt='2026-01-01 00:00:00', endsAt='2026-01-02 00:00:00' where id=${sponsorshipId}`);
  const afterExpiry = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('AN EXPIRED GRANT DISAPPEARS with no sweep having run',
    !sponsoredIds(afterExpiry).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(afterExpiry))}`);

  // A future-dated grant is not live yet either.
  // 2037, not 2099: `timestamp` cannot hold a date past the 2038 epoch limit,
  // and the point here is a FUTURE-DATED grant, not a driver error.
  sql(`update vendorSponsorships set startsAt='2037-01-01 00:00:00', endsAt=NULL where id=${sponsorshipId}`);
  const afterFuture = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('A FUTURE-DATED GRANT is not live yet',
    !sponsoredIds(afterFuture).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(afterFuture))}`);

  // Back to live for the revocation test.
  sql(`update vendorSponsorships set startsAt='2026-01-01 00:00:00', endsAt=NULL where id=${sponsorshipId}`);
  const relive = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('POSITIVE CONTROL: restoring the window brings it back - the probe is measuring something',
    sponsoredIds(relive).includes(vendor.id));

  // ── 5. Revocation ───────────────────────────────────────────────────────
  const revoked = await call(marketAdmin.p, 'admin.revokeSponsorship', { sponsorshipId, reason: 'Agreement ended' });
  check('the administrator can revoke', revoked.status === 200, `http=${revoked.status} err=${revoked.error ?? '-'}`);
  check('DATABASE: SOFT revoke - the row survives for the audit',
    sql(`select count(*) from vendorSponsorships where id=${sponsorshipId}`) === '1');
  check('DATABASE: and records who revoked it',
    sql(`select revokedBy from vendorSponsorships where id=${sponsorshipId}`) === String(marketAdmin.id));

  const afterRevoke = await query(vendor.p, 'marketplace.sponsoredVendors', { category: CATEGORY });
  check('A REVOKED GRANT DISAPPEARS from the directory',
    !sponsoredIds(afterRevoke).includes(vendor.id), `ids=${JSON.stringify(sponsoredIds(afterRevoke))}`);

  const revokeTwice = await call(marketAdmin.p, 'admin.revokeSponsorship', { sponsorshipId });
  check('revoking twice is refused rather than re-stamping the decision',
    revokeTwice.status !== 200, `http=${revokeTwice.status}`);

  // ── 6. The Super Admin record answers the whole question ────────────────
  const listing = await query(marketAdmin.p, 'admin.sponsorships');
  const mine = (listing.data ?? []).find(r => r.id === sponsorshipId);
  check('the admin record still LISTS the revoked grant - that is what auditable means', !!mine);
  check('and marks it not live', mine?.live === false, `live=${mine?.live}`);
  check('and names the vendor, category, period and reason',
    mine?.category === CATEGORY && mine?.grantedReason === 'Launch partner agreement' && !!mine?.vendorName,
    `vendor=${mine?.vendorName} cat=${mine?.category}`);
  check('the admin record carries no credential',
    !/password|token|secret|hash/i.test(JSON.stringify(listing.data ?? [])), 'no credential');

  const listByBilling = await query(billingAdmin.p, 'admin.sponsorships');
  check('BILLING_ADMIN cannot read the sponsorship record either', listByBilling.status !== 200,
    `http=${listByBilling.status}`);

  // ── 7. The strip on the real page ───────────────────────────────────────
  // Re-grant so there is something to render.
  const regrant = await call(marketAdmin.p, 'admin.grantSponsorship', {
    vendorId: vendor.id, category: CATEGORY, reason: 'Renewed for the page probe',
  });
  check('SETUP: re-granted for the page test', regrant.status === 200, `http=${regrant.status}`);

  const visitor = await (await freshContext()).newPage();
  await go(visitor, `/marketplace/vendors?category=${encodeURIComponent(CATEGORY)}`);
  // The page may need the category chosen through its own control.
  const catSelect = visitor.locator('select, [role="combobox"]').first();
  if (await catSelect.count()) {
    await catSelect.click().catch(() => {});
    await visitor.waitForTimeout(500);
    const opt = visitor.getByRole('option', { name: new RegExp(CATEGORY, 'i') }).first();
    if (await opt.count()) { await opt.click().catch(() => {}); await visitor.waitForTimeout(2000); }
  }
  const pageText = await visitor.evaluate(() => document.body.innerText);
  check('LIVE UI: the sponsored section renders on the vendors directory',
    /sponsored/i.test(pageText), pageText.split('\n').filter(l => /sponsored/i.test(l)).slice(0, 1).join('').slice(0, 50) || 'no sponsored heading');

  // Responsive: the strip must survive the three widths the brief names.
  for (const width of [375, 768, 1440]) {
    await go(visitor, `/marketplace/vendors?category=${encodeURIComponent(CATEGORY)}`, width);
    const overflow = await visitor.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    check(`RESPONSIVE ${width}px: the directory does not scroll horizontally`, !overflow);
  }

  // Arabic.
  await visitor.evaluate(() => localStorage.setItem('buildhub_lang', 'ar'));
  await go(visitor, `/marketplace/vendors?category=${encodeURIComponent(CATEGORY)}`, 1440);
  const dir = await visitor.evaluate(() => document.documentElement.getAttribute('dir')
    ?? getComputedStyle(document.body).direction);
  check('ARABIC: the directory renders right-to-left', dir === 'rtl', `dir=${dir}`);

  // ── 8. Product listings must NOT inherit the sponsored treatment ────────
  await visitor.evaluate(() => localStorage.setItem('buildhub_lang', 'en'));
  await go(visitor, '/marketplace', 1440);
  const marketText = await visitor.evaluate(() => document.body.innerText);
  check('PRODUCTS DO NOT INHERIT IT: no sponsored vendor strip on the product marketplace',
    !/sponsored vendors/i.test(marketText), 'no vendor strip on products');

  await visitor.close();

} catch (error) {
  check('the probe ran to completion', false, String(error.message).split('\n')[0].slice(0, 140));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from vendorSponsorships where vendorId=${id} or grantedBy=${id} or revokedBy=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from vendorProfiles where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  await b.close();
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

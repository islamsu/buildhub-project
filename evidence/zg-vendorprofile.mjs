// ── LIVE: the vendor company profile and its contact tiers ─────────────────
//
// THREE RULES CAN ONLY BE PROVEN HERE. They live in WHERE clauses, and the
// unit double answers by table without interpreting conditions - a test there
// would pass with any of them deleted. All three are about CROSS-CUSTOMER
// leakage, which is why they get a real database:
//
//   a quotation unlocks contact only for the customer whose RFQ it was
//   a project membership only for the customer who owns that project
//   a REMOVED member's access ends with their membership
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
const madeRfqs = [];

async function go(p, u) {
  await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(800);
}

async function account(prefix) {
  const p = await (await freshContext()).newPage();
  await go(p, '/auth');
  await (await p.locator('button.p-4.rounded-xl').all())[0].click();
  const u = `${prefix}${stamp}`;
  await p.getByPlaceholder(/username|اسم/i).fill(u);
  await p.locator('input[type="email"]').fill(`${u}@example.test`);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill('VendorPass!2026'); await pw.nth(1).fill('VendorPass!2026');
  await p.getByRole('button', { name: /create account|إنشاء/i }).last().click();
  await p.waitForTimeout(2600);
  const me = await p.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  if (!me?.id) throw new Error(`registration failed for ${prefix}`);
  made.push(me.id);
  return { p, id: me.id };
}

const call = (page, path, input) => page.evaluate(async ([pa, i]) => {
  const res = await fetch(`/api/trpc/${pa}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: i }),
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

const CONTACT_SECRETS = ['Mona Farid', 'mona.contact@example.test', '01099887766', '14 Corniche El Nil'];

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const vendor = await account('vpsu');
  sql(`update users set userRole='supplier', onboardingStatus='approved' where id=${vendor.id}`);

  // The customer this vendor WILL quote for.
  const buyer = await account('vpbu');
  sql(`update users set userRole='homeowner' where id=${buyer.id}`);

  // A DIFFERENT customer, with their own RFQ. The vendor never quotes for them.
  const other = await account('vpot');
  sql(`update users set userRole='homeowner' where id=${other.id}`);

  const admin = await account('vpad');
  sql(`update users set role='admin', adminRole='SUPER_ADMIN', userRole='admin' where id=${admin.id}`);

  for (const a of [vendor, buyer, other, admin]) await go(a.p, '/');

  // ── 1. The vendor fills in their own company profile ────────────────────
  const saved = await call(vendor.p, 'profile.saveMyCompanyProfile', {
    companyName: 'Nile Steel Works', companyDescription: 'Structural steel since 1998.',
    primaryContactName: 'Mona Farid', primaryContactPosition: 'Commercial Director',
    primaryContactEmail: 'mona.contact@example.test', primaryContactMobile: '01099887766',
    addressLine: '14 Corniche El Nil', city: 'Giza', country: 'Egypt',
    website: 'https://nilesteel.example.test', registrationNumber: 'CR-99887766',
  });
  check('the vendor can save their company profile', saved.status === 200,
    `http=${saved.status} err=${String(saved.error).slice(0, 60)}`);
  check('DATABASE: exactly one profile row, on the vendor\'s own account',
    sql(`select count(*) from vendorProfiles where userId=${vendor.id}`) === '1');
  check('DATABASE: the company name persisted',
    sql(`select companyName from vendorProfiles where userId=${vendor.id}`) === 'Nile Steel Works');

  const resaved = await call(vendor.p, 'profile.saveMyCompanyProfile', { companyName: 'Nile Steel Works LLC' });
  check('saving again UPDATES rather than creating a second row',
    sql(`select count(*) from vendorProfiles where userId=${vendor.id}`) === '1' && resaved.status === 200);
  check('DATABASE: the update landed',
    sql(`select companyName from vendorProfiles where userId=${vendor.id}`) === 'Nile Steel Works LLC');

  const cleared = await call(vendor.p, 'profile.saveMyCompanyProfile', { website: '' });
  check('an emptied field is CLEARED to NULL, not stored as an empty string',
    sql(`select ifnull(website,'NULL') from vendorProfiles where userId=${vendor.id}`) === 'NULL',
    `website=${sql(`select ifnull(website,'NULL') from vendorProfiles where userId=${vendor.id}`)} http=${cleared.status}`);
  await call(vendor.p, 'profile.saveMyCompanyProfile', { website: 'https://nilesteel.example.test' });

  // ── 2. A STRANGER sees the company but not the person ───────────────────
  const strangerView = await query(other.p, 'profile.getPublic', { userId: vendor.id });
  check('a stranger can see the company block', strangerView.data?.company?.companyName === 'Nile Steel Works LLC',
    `company=${strangerView.data?.company?.companyName}`);
  check('a stranger gets NO contact block', strangerView.data?.primaryContact === null,
    `primaryContact=${JSON.stringify(strangerView.data?.primaryContact)}`);
  check('and the response says WHY, so the page can explain rather than show a blank',
    strangerView.data?.contactAccess === 'none', `access=${strangerView.data?.contactAccess}`);
  check('NO CONTACT VALUE anywhere in the stranger\'s payload',
    !CONTACT_SECRETS.some(v => JSON.stringify(strangerView.data ?? {}).includes(v)), 'no leak');
  check('a stranger does not receive the registration number',
    !JSON.stringify(strangerView.data ?? {}).includes('CR-99887766'));

  // ── 3. THE QUOTATION RULE, against a real WHERE clause ──────────────────
  await call(vendor.p, 'profile.setMyCategories', { categories: ['Materials'] });

  const buyerRfq = await call(buyer.p, 'rfq.create', {
    title: `Steel for slab ${stamp}`, description: 'Vendor profile probe',
    category: 'Materials', quantity: 10, unit: 'tonne', location: 'Cairo',
  });
  const buyerRfqId = buyerRfq.data?.id ?? Number(sql(`select id from rfqs where requesterId=${buyer.id} order by id desc limit 1`));
  madeRfqs.push(buyerRfqId);

  // A SECOND RFQ, owned by the OTHER customer. The vendor never quotes on it.
  const otherRfq = await call(other.p, 'rfq.create', {
    title: `Unrelated request ${stamp}`, description: 'Negative control',
    category: 'Materials', quantity: 5, unit: 'tonne', location: 'Cairo',
  });
  const otherRfqId = otherRfq.data?.id ?? Number(sql(`select id from rfqs where requesterId=${other.id} order by id desc limit 1`));
  madeRfqs.push(otherRfqId);

  const beforeQuote = await query(buyer.p, 'profile.getPublic', { userId: vendor.id });
  check('SETUP: the buyer cannot see contact BEFORE the vendor quotes',
    beforeQuote.data?.contactAccess === 'none', `access=${beforeQuote.data?.contactAccess}`);

  await call(vendor.p, 'rfq.openEnquiry', { rfqId: buyerRfqId });
  const quoted = await call(vendor.p, 'rfq.submitQuotation', {
    rfqId: buyerRfqId, price: 90000, timeline: 21, notes: 'Vendor profile probe quotation',
  });
  check('the vendor quotes on the BUYER\'s RFQ', quoted.status === 200,
    `http=${quoted.status} err=${String(quoted.error).slice(0, 60)}`);

  const afterQuote = await query(buyer.p, 'profile.getPublic', { userId: vendor.id });
  check('THE BUYER NOW SEES THE CONTACT BLOCK - the vendor engaged',
    afterQuote.data?.contactAccess === 'quoted' && afterQuote.data?.primaryContact !== null,
    `access=${afterQuote.data?.contactAccess}`);
  check('and it is the real contact the vendor nominated',
    afterQuote.data?.primaryContact?.primaryContactName === 'Mona Farid',
    `name=${afterQuote.data?.primaryContact?.primaryContactName}`);
  check('the buyer still does NOT get the registration number',
    !JSON.stringify(afterQuote.data ?? {}).includes('CR-99887766'));

  // THE CROSS-CUSTOMER NEGATIVE CONTROL. This is the rule the unit double
  // could not test: one quotation must not unlock the vendor for EVERY
  // customer, only for the one whose RFQ was quoted on.
  const otherAfterQuote = await query(other.p, 'profile.getPublic', { userId: vendor.id });
  check('CROSS-CUSTOMER: the OTHER customer still sees nothing, though the vendor quoted for somebody',
    otherAfterQuote.data?.contactAccess === 'none' && otherAfterQuote.data?.primaryContact === null,
    `access=${otherAfterQuote.data?.contactAccess}`);
  check('CROSS-CUSTOMER: and no contact value reaches them',
    !CONTACT_SECRETS.some(v => JSON.stringify(otherAfterQuote.data ?? {}).includes(v)), 'no leak');

  // ── 4. THE PROJECT-MEMBERSHIP RULE, and removal ─────────────────────────
  const project = await call(other.p, 'projects.create', {
    title: `Vendor profile project ${stamp}`, description: 'Membership probe',
    budget: 400000, location: 'Cairo', category: 'residential',
  });
  const projectId = project.data?.id ?? Number(sql(`select id from projects where ownerId=${other.id} order by id desc limit 1`));

  await call(other.p, 'projects.addMember', { projectId, userId: vendor.id, projectRole: 'supplier' });
  check('SETUP: the vendor is on the other customer\'s project',
    sql(`select projectRole from projectMembers where projectId=${projectId} and userId=${vendor.id}`) === 'supplier');

  const viaProject = await query(other.p, 'profile.getPublic', { userId: vendor.id });
  check('PROJECT MEMBERSHIP unlocks the contact block for the project OWNER',
    viaProject.data?.contactAccess === 'project' && viaProject.data?.primaryContact !== null,
    `access=${viaProject.data?.contactAccess}`);

  // The buyer owns NO project with this vendor - their access must still come
  // from the quotation, never from somebody else's project.
  const buyerStill = await query(buyer.p, 'profile.getPublic', { userId: vendor.id });
  check('CROSS-CUSTOMER: another customer\'s project does not unlock the vendor for the buyer',
    buyerStill.data?.contactAccess === 'quoted', `access=${buyerStill.data?.contactAccess}`);

  // REMOVAL. The rule that only a real WHERE clause can prove.
  await call(other.p, 'projects.removeMember', { projectId, userId: vendor.id });
  check('SETUP: the vendor was removed from the project',
    sql(`select ifnull(removedAt,'NULL') from projectMembers where projectId=${projectId} and userId=${vendor.id}`) !== 'NULL');

  const afterRemoval = await query(other.p, 'profile.getPublic', { userId: vendor.id });
  check('REMOVED MEMBER: contact access ENDS with the membership',
    afterRemoval.data?.contactAccess === 'none' && afterRemoval.data?.primaryContact === null,
    `access=${afterRemoval.data?.contactAccess}`);
  check('REMOVED MEMBER: and no contact value survives in the payload',
    !CONTACT_SECRETS.some(v => JSON.stringify(afterRemoval.data ?? {}).includes(v)), 'no leak');

  // ── 5. Super Admin's wider view, with no credential ─────────────────────
  const adminView = await query(admin.p, 'profile.getPublic', { userId: vendor.id });
  check('SUPER ADMIN sees the contact block', adminView.data?.contactAccess === 'admin'
    && adminView.data?.primaryContact !== null, `access=${adminView.data?.contactAccess}`);
  check('SUPER ADMIN sees the registration number, for investigation',
    adminView.data?.registrationNumber === 'CR-99887766', `reg=${adminView.data?.registrationNumber}`);
  check('but NO credential of any kind reaches even Super Admin',
    !/passwordHash|scrypt\$|passwordResetToken|invitationToken|sessionsInvalidBefore/i
      .test(JSON.stringify(adminView.data ?? {})), 'no credential');

  // ── 6. Nobody edits anybody else's profile ──────────────────────────────
  const beforeHijack = sql(`select companyName from vendorProfiles where userId=${vendor.id}`);
  const hijack = await call(other.p, 'profile.saveMyCompanyProfile', {
    companyName: 'Hijacked', userId: vendor.id,
  });
  check('a customer calling saveMyCompanyProfile cannot touch the vendor\'s row',
    sql(`select companyName from vendorProfiles where userId=${vendor.id}`) === beforeHijack,
    `still=${sql(`select companyName from vendorProfiles where userId=${vendor.id}`)} http=${hijack.status}`);

  // ── 7. The page itself ──────────────────────────────────────────────────
  await go(buyer.p, `/vendor/${vendor.id}`);
  const buyerText = await buyer.p.evaluate(() => document.body.innerText);
  check('LIVE UI: the buyer\'s page shows the company', /Nile Steel Works/.test(buyerText));
  check('LIVE UI: and the primary contact, because they earned it',
    await buyer.p.locator('[data-testid="vendor-primary-contact"]').count() > 0);
  check('LIVE UI: the contact name renders', /Mona Farid/.test(buyerText));

  await go(other.p, `/vendor/${vendor.id}`);
  const otherText = await other.p.evaluate(() => document.body.innerText);
  check('LIVE UI: the stranger sees the company', /Nile Steel Works/.test(otherText));
  check('LIVE UI: but the contact block is absent',
    await other.p.locator('[data-testid="vendor-primary-contact"]').count() === 0);
  check('LIVE UI: and the page EXPLAINS why rather than showing a blank',
    await other.p.locator('[data-testid="vendor-contact-locked"]').count() > 0);
  check('LIVE UI: no contact value is in the stranger\'s rendered page',
    !CONTACT_SECRETS.some(v => otherText.includes(v)), 'no leak on screen');

  // Arabic, same page, same rule.
  await other.p.evaluate(() => localStorage.setItem('buildhub_lang', 'ar'));
  await go(other.p, `/vendor/${vendor.id}`);
  const arText = await other.p.evaluate(() => document.body.innerText);
  check('LIVE AR: the locked explanation renders in Arabic',
    /بيانات جهة الاتصال/.test(arText),
    arText.split('\n').filter(l => /جهة الاتصال/.test(l)).slice(0, 1).join(' ').slice(0, 60) || 'no Arabic line');

  // ── 8. THE VENDOR'S OWN FORM, driven for real ───────────────────────────
  await vendor.p.evaluate(() => localStorage.setItem('buildhub_lang', 'en'));
  await go(vendor.p, '/settings');
  check('LIVE UI: the company form is on the vendor\'s settings page',
    await vendor.p.locator('[data-testid="vendor-company-form"]').count() > 0);

  const nameInput = vendor.p.locator('[data-testid="company-companyName"]');
  check('LIVE UI: the form is pre-filled from the database, not blank',
    (await nameInput.inputValue()) === 'Nile Steel Works LLC',
    `value=${await nameInput.inputValue()}`);

  await nameInput.fill('Nile Steel Works International');
  await vendor.p.locator('[data-testid="company-save"]').click();
  await vendor.p.waitForTimeout(2000);
  check('LIVE UI -> DATABASE: typing and saving actually changed the row',
    sql(`select companyName from vendorProfiles where userId=${vendor.id}`) === 'Nile Steel Works International',
    sql(`select companyName from vendorProfiles where userId=${vendor.id}`));
  check('LIVE UI: the screen confirms the save',
    await vendor.p.locator('[data-testid="company-saved"]').count() > 0);

  const formText = await vendor.p.evaluate(() => document.body.innerText);
  check('LIVE UI: the form TELLS the vendor the contact block is not public',
    /NOT public/i.test(formText), 'visibility stated on the form');
  check('LIVE UI: and that the registration number is admin-only',
    /Administrators only/i.test(formText), 'registration visibility stated');

} catch (error) {
  check('the probe ran to completion', false, String(error.message).split('\n')[0].slice(0, 140));
} finally {
  for (const id of madeRfqs) {
    for (const q of [
      `delete from qualifiedEnquiries where rfqId=${id}`,
      `delete from rfqSuppliers where rfqId=${id}`,
      `delete from quotations where rfqId=${id}`,
      `delete from rfqs where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
      `delete from quotations where providerId=${id}`,
      `delete from rfqs where requesterId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from projectMembers where userId=${id} or assignedBy=${id} or removedBy=${id}`,
      `delete from projects where ownerId=${id} or createdBy=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from vendorProfiles where userId=${id}`,
      `delete from vendorSponsorships where vendorId=${id} or grantedBy=${id} or revokedBy=${id}`,
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

// ── LIVE: Super Admin manual plan / membership change ───────────────────────
//
// A green unit suite proves the code does what the doubles were told to
// expect. This drives the real browser against the real MariaDB, and every
// positive assertion below is checked against the DATABASE rather than
// against a toast, because a toast is what the frontend believes.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();
const esc = s => String(s).replace(/'/g, "''");

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

// ONE BROWSER CONTEXT PER ACCOUNT, not one shared context.
//
// The first version of this probe shared a context and died on the second
// registration with "Cannot read properties of undefined": /auth redirects an
// already-authenticated session away from the signup form, so there were no
// role buttons to click. A shared cookie jar is also the wrong instrument for
// a permission test - five roles sharing one session cannot demonstrate that
// each is refused on its own.
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

async function newPage() { return (await freshContext()).newPage(); }
async function go(p, u) {
  await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(900);
}

/** Register a real account through the real form, and return its id. */
async function register(p, prefix) {
  await go(p, '/auth');
  await (await p.locator('button.p-4.rounded-xl').all())[0].click();
  const u = `${prefix}${stamp}`;
  await p.getByPlaceholder(/username|اسم المستخدم/i).fill(u);
  await p.locator('input[type="email"]').fill(`${u}@example.test`);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill('JourneyPass!2026'); await pw.nth(1).fill('JourneyPass!2026');
  await p.getByRole('button', { name: /create account|إنشاء/i }).last().click();
  await p.waitForTimeout(2600);
  const me = await p.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  if (!me?.id) throw new Error(`registration failed for ${prefix} - no auth.me id`);
  made.push(me.id);
  return me.id;
}

/** Call the mutation from inside an authenticated page, as the browser does. */
async function callChange(p, input) {
  return p.evaluate(async body => {
    const res = await fetch('/api/trpc/admin.setVendorPlanManually', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: body }),
    });
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    return { status: res.status, data: parsed?.result?.data?.json ?? null, error: parsed?.error?.json?.message ?? null };
  }, input);
}

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const adminPage = await newPage();
  const adminId = await register(adminPage, 'sapc');
  sql(`update users set role='admin', adminRole='SUPER_ADMIN', userRole='admin' where id=${adminId}`);

  const vendorPage = await newPage();
  const vendorId = await register(vendorPage, 'svpc');
  sql(`update users set userRole='supplier', onboardingStatus='approved' where id=${vendorId}`);

  const homeownerPage = await newPage();
  const homeownerId = await register(homeownerPage, 'shpc');
  sql(`update users set userRole='homeowner' where id=${homeownerId}`);

  const billingPage = await newPage();
  const billingAdminId = await register(billingPage, 'sbpc');
  sql(`update users set role='admin', adminRole='BILLING_ADMIN', userRole='admin' where id=${billingAdminId}`);

  const supportPage = await newPage();
  const supportAdminId = await register(supportPage, 'sspc');
  sql(`update users set role='admin', adminRole='SUPPORT_ADMIN', userRole='admin' where id=${supportAdminId}`);

  // Sessions carry the role from the token; re-load so ctx.user is the admin.
  for (const p of [adminPage, billingPage, supportPage, vendorPage, homeownerPage]) await go(p, '/');

  const planOf = id => sql(`select plan from vendorSubscriptions where userId=${id}`) || '(no row)';
  const statusOf = id => sql(`select status from vendorSubscriptions where userId=${id}`) || '(no row)';

  // ── 1. GRANT: a vendor on FREE is given premium ─────────────────────────
  const before = planOf(vendorId);
  check('vendor starts without a paid plan', before === '(no row)' || before === 'free', `plan=${before}`);

  const grant = await callChange(adminPage, {
    userId: vendorId, plan: 'premium', interval: 'month', reason: 'Bank transfer settled off-platform',
  });
  check('Super Admin grant accepted', grant.status === 200 && grant.data?.outcome === 'applied',
    `http=${grant.status} outcome=${grant.data?.outcome} err=${grant.error ?? '-'}`);
  check('DATABASE: the plan is premium', planOf(vendorId) === 'premium', `plan=${planOf(vendorId)}`);
  check('DATABASE: the subscription is active', statusOf(vendorId) === 'active', `status=${statusOf(vendorId)}`);

  const priced = sql(`select priceAmount from vendorSubscriptions where userId=${vendorId}`);
  check('DATABASE: priceAmount is 0.00, not the catalogue price - nobody paid for a grant',
    Number(priced) === 0, `priceAmount=${priced}`);

  const trialSpent = sql(`select ifnull(trialStartedAt,'NULL') from vendorSubscriptions where userId=${vendorId}`);
  check('DATABASE: the vendor still has their one lifetime trial', trialSpent === 'NULL', `trialStartedAt=${trialSpent}`);

  // ── 2. The three audit records ──────────────────────────────────────────
  const billingEvent = sql(`select action from billingEvents where userId=${vendorId} order by id desc limit 1`);
  check('AUDIT: billingEvents records the manual change', billingEvent === 'plan_changed_manually', `action=${billingEvent}`);

  const note = sql(`select note from billingEvents where userId=${vendorId} order by id desc limit 1`);
  check('AUDIT: the reason is in billing history', note.includes('Bank transfer settled off-platform'), `note=${note.slice(0, 60)}`);

  const accountEvent = sql(`select concat(action,'|',ifnull(actorId,'-'),'|',ifnull(note,'')) from userAccountAuditEvents where userId=${vendorId} order by id desc limit 1`);
  check('AUDIT: userAccountAuditEvents names the actor and the reason',
    accountEvent.startsWith('plan_changed_manually|') && accountEvent.includes(String(adminId)) && accountEvent.includes('Bank transfer'),
    accountEvent.slice(0, 70));

  const valueRow = sql(`select concat(field,'|',ifnull(oldValue,'-'),'->',ifnull(newValue,'-'),'|',ifnull(reason,'-')) from fieldValueHistory where subjectType='subscription' and subjectId=${vendorId} order by id desc limit 1`);
  check('AUDIT: fieldValueHistory records old -> new with the reason',
    valueRow.startsWith('plan|free->premium|') && valueRow.includes('Bank transfer'), valueRow.slice(0, 70));

  // ── 3. The notification, in the vendor's own language ───────────────────
  const notif = sql(`select concat(ifnull(messageKey,'-'),'|',ifnull(link,'-'),'|',ifnull(messageParams,'-')) from notifications where userId=${vendorId} order by id desc limit 1`);
  check('NOTIFY: the vendor was told, worded as an upgrade', notif.startsWith('notif.billing.plan.upgraded|'), notif.slice(0, 60));
  check('NOTIFY: it deep-links to Plan & Billing, not the top of settings', notif.includes('/settings#settings-billing'), notif.slice(0, 80));
  check('NOTIFY: the plan is named by KEY, so the reader\'s language decides',
    notif.includes('billing.plan.premium'), notif.slice(0, 110));
  check('NOTIFY: no plan name is baked into the stored row as the only source',
    notif.includes('planKey'), notif.slice(0, 110));

  // The vendor's own screen, in Arabic, renders it translated.
  //
  // /messages, Notifications tab - there is no /notifications route, and a
  // probe that navigates to one gets a 200 from the SPA shell and reads an
  // empty page. Verified against App.tsx rather than assumed.
  async function readNotifications(lang) {
    await vendorPage.evaluate(l => localStorage.setItem('buildhub_lang', l), lang);
    await go(vendorPage, '/messages');
    const tab = vendorPage.locator('[role="tab"]').filter({ hasText: /notification|الإشعارات/i }).first();
    if (await tab.count()) { await tab.click(); await vendorPage.waitForTimeout(1500); }
    return vendorPage.evaluate(() => document.body.innerText);
  }

  const arabicText = await readNotifications('ar');
  check('LIVE AR: the vendor reads the notification in Arabic, plan name included',
    /بريميوم/.test(arabicText) && /باقت/.test(arabicText),
    arabicText.split('\n').filter(l => /بريميوم|باقت/.test(l)).slice(0, 1).join(' ').slice(0, 70) || 'no Arabic plan line');

  const englishText = await readNotifications('en');
  check('LIVE EN: the same row reads in English for an English reader',
    /Premium/.test(englishText) && /upgrad/i.test(englishText),
    englishText.split('\n').filter(l => /Premium|upgrad/i.test(l)).slice(0, 1).join(' ').slice(0, 70) || 'no English plan line');

  // ── 4. Usage is preserved across a plan change ──────────────────────────
  const notifCountBefore = Number(sql(`select count(*) from notifications where userId=${vendorId}`));
  const usageBefore = sql(`select count(*) from qualifiedEnquiries where userId=${vendorId}`);

  const change = await callChange(adminPage, {
    userId: vendorId, plan: 'professional', reason: 'Downgrade agreed with the vendor',
  });
  check('a paid vendor can be moved between paid plans', change.status === 200 && change.data?.outcome === 'applied',
    `outcome=${change.data?.outcome} err=${change.error ?? '-'}`);
  check('DATABASE: the plan is professional', planOf(vendorId) === 'professional', `plan=${planOf(vendorId)}`);

  const usageAfter = sql(`select count(*) from qualifiedEnquiries where userId=${vendorId}`);
  check('USAGE PRESERVED: no consumed enquiry was revoked or reset',
    usageBefore === usageAfter, `before=${usageBefore} after=${usageAfter}`);

  const historyRows = Number(sql(`select count(*) from billingEvents where userId=${vendorId}`));
  check('HISTORY PRESERVED: both changes are in the trail, nothing overwritten',
    historyRows >= 2, `billingEvents=${historyRows}`);

  const downNotif = sql(`select messageKey from notifications where userId=${vendorId} order by id desc limit 1`);
  check('NOTIFY: worded as a downgrade this time, not as an upgrade',
    downNotif === 'notif.billing.plan.downgraded', `key=${downNotif}`);

  // ── 5. Selecting the SAME plan tells nobody ─────────────────────────────
  const countBeforeNoop = Number(sql(`select count(*) from notifications where userId=${vendorId}`));
  const auditBeforeNoop = Number(sql(`select count(*) from userAccountAuditEvents where userId=${vendorId}`));

  const noop = await callChange(adminPage, {
    userId: vendorId, plan: 'professional', reason: 'Selecting the plan they already have',
  });
  check('selecting the current plan reports NO CHANGE, not success',
    noop.status === 200 && noop.data?.outcome === 'noop', `outcome=${noop.data?.outcome}`);
  check('NO-OP: the vendor is NOT notified about a change that did not happen',
    Number(sql(`select count(*) from notifications where userId=${vendorId}`)) === countBeforeNoop,
    `before=${countBeforeNoop} after=${sql(`select count(*) from notifications where userId=${vendorId}`)}`);
  check('NO-OP: no audit event is written for a change that did not happen',
    Number(sql(`select count(*) from userAccountAuditEvents where userId=${vendorId}`)) === auditBeforeNoop,
    `before=${auditBeforeNoop}`);
  check('NO-OP: the notified flag is false', noop.data?.notified === false, `notified=${noop.data?.notified}`);

  // ── 6. FREE while paid is a SCHEDULED end, never a revocation ───────────
  const toFree = await callChange(adminPage, {
    userId: vendorId, plan: 'free', reason: 'Vendor is leaving the platform',
  });
  check('selecting FREE while paid is accepted', toFree.status === 200 && toFree.data?.outcome === 'applied',
    `outcome=${toFree.data?.outcome} err=${toFree.error ?? '-'}`);
  check('DATABASE: the paid plan is NOT wiped - the vendor keeps what they paid for',
    planOf(vendorId) === 'professional', `plan=${planOf(vendorId)}`);
  check('DATABASE: it is set not to renew',
    sql(`select cancelAtPeriodEnd from vendorSubscriptions where userId=${vendorId}`) === '1',
    `cancelAtPeriodEnd=${sql(`select cancelAtPeriodEnd from vendorSubscriptions where userId=${vendorId}`)}`);
  check('NOTIFY: the vendor is told it will not RENEW, not that it changed today',
    sql(`select messageKey from notifications where userId=${vendorId} order by id desc limit 1`) === 'notif.billing.plan.scheduled',
    sql(`select messageKey from notifications where userId=${vendorId} order by id desc limit 1`));

  // ── 7. The permission boundary, exercised live ──────────────────────────
  const targetPlanBefore = planOf(vendorId);

  const byBilling = await callChange(billingPage, { userId: vendorId, plan: 'premium', reason: 'Billing admin change' });
  check('BILLING_ADMIN holds billing.manage and IS allowed',
    byBilling.status === 200 && byBilling.data?.outcome === 'applied', `http=${byBilling.status} err=${byBilling.error ?? '-'}`);

  const bySupport = await callChange(supportPage, { userId: vendorId, plan: 'free', reason: 'Support admin attempt' });
  check('SUPPORT_ADMIN is REFUSED by the server, not by a hidden button',
    bySupport.status !== 200 && bySupport.data === null, `http=${bySupport.status} err=${String(bySupport.error).slice(0, 40)}`);

  const byVendor = await callChange(vendorPage, { userId: vendorId, plan: 'premium', reason: 'Granting myself a plan' });
  check('the VENDOR cannot grant themselves a plan',
    byVendor.status !== 200 && byVendor.data === null, `http=${byVendor.status}`);

  const byHomeowner = await callChange(homeownerPage, { userId: vendorId, plan: 'premium', reason: 'Homeowner attempt' });
  check('a HOMEOWNER cannot change anyone\'s plan',
    byHomeowner.status !== 200 && byHomeowner.data === null, `http=${byHomeowner.status}`);

  const anonPage = await (await freshContext()).newPage();
  // Must actually LOAD the site first: a page still on about:blank has no
  // origin, so a relative fetch cannot be resolved and the call fails for a
  // reason that has nothing to do with authorization. A refusal has to be the
  // server's, and it cannot be the server's if the request never left.
  await go(anonPage, '/');
  const anonMe = await anonPage.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  check('the anonymous probe really is signed out', anonMe === null, `auth.me=${JSON.stringify(anonMe)}`);
  const byAnon = await callChange(anonPage, { userId: vendorId, plan: 'premium', reason: 'Anonymous attempt' });
  check('an ANONYMOUS caller cannot change a plan',
    byAnon.status !== 200 && byAnon.data === null, `http=${byAnon.status}`);
  await anonPage.close();

  check('DATABASE: not one refused call moved the plan',
    planOf(vendorId) === 'premium', `plan=${planOf(vendorId)} (premium is the BILLING_ADMIN change, which was allowed)`);

  // ── 8. A reason is genuinely required ───────────────────────────────────
  const noReason = await callChange(adminPage, { userId: vendorId, plan: 'free', reason: '   ' });
  check('an empty reason is REFUSED', noReason.status !== 200 && noReason.data === null, `http=${noReason.status}`);

  // ── 9. A homeowner cannot be given a vendor plan ────────────────────────
  const atHomeowner = await callChange(adminPage, { userId: homeownerId, plan: 'premium', reason: 'Wrong target' });
  check('a HOMEOWNER target is refused - no plan they could never consume is created',
    atHomeowner.status !== 200 && /provider accounts only/i.test(String(atHomeowner.error)),
    String(atHomeowner.error).slice(0, 50));
  check('DATABASE: no subscription row was created for the homeowner',
    (sql(`select count(*) from vendorSubscriptions where userId=${homeownerId}`)) === '0',
    `rows=${sql(`select count(*) from vendorSubscriptions where userId=${homeownerId}`)}`);

  // ── 10. The control is on the real admin screen ─────────────────────────
  await go(adminPage, '/admin');
  // The tab reads "Vendor billing", not "Billing" - an anchored exact-match
  // regex found nothing and the probe then timed out filling a field that was
  // never on screen. Read off the live tab list rather than assumed.
  const billingTab = adminPage.locator('[role="tab"]').filter({ hasText: /Billing|الفوترة/i }).first();
  check('LIVE UI: the Vendor billing tab exists', await billingTab.count() > 0,
    JSON.stringify(await adminPage.locator('[role="tab"]').allInnerTexts()));
  await billingTab.click();
  await adminPage.waitForTimeout(1500);
  await adminPage.locator('#admin-billing-user').fill(String(vendorId));
  await adminPage.getByRole('button', { name: /look up|بحث/i }).first().click();
  await adminPage.waitForTimeout(2000);

  const panelVisible = await adminPage.locator('[data-testid="admin-manual-plan"]').count();
  check('LIVE UI: the manual plan control is on the Super Admin billing screen', panelVisible > 0, `found=${panelVisible}`);

  const submitDisabled = await adminPage.locator('[data-testid="manual-plan-submit"]').isDisabled().catch(() => null);
  check('LIVE UI: the Apply button is disabled until a reason is typed', submitDisabled === true, `disabled=${submitDisabled}`);

  await adminPage.locator('[data-testid="manual-plan-reason"]').fill('Applied through the real admin screen');
  const nowEnabled = await adminPage.locator('[data-testid="manual-plan-submit"]').isDisabled();
  check('LIVE UI: typing a reason enables it', nowEnabled === false, `disabled=${nowEnabled}`);

  await adminPage.locator('[data-testid="manual-plan-select"]').selectOption('professional');
  await adminPage.locator('[data-testid="manual-plan-submit"]').click();
  await adminPage.waitForTimeout(2500);

  const uiResult = await adminPage.locator('[data-testid="manual-plan-result"]').innerText().catch(() => '');
  check('LIVE UI: the screen reports the outcome', /Changed to professional/i.test(uiResult), uiResult.slice(0, 70));
  check('LIVE UI -> DATABASE: the click actually moved the plan',
    planOf(vendorId) === 'professional', `plan=${planOf(vendorId)}`);
  check('LIVE UI: the reason typed into the form reached the audit trail',
    sql(`select note from billingEvents where userId=${vendorId} order by id desc limit 1`).includes('Applied through the real admin screen'),
    sql(`select note from billingEvents where userId=${vendorId} order by id desc limit 1`).slice(0, 60));

  const historyText = await adminPage.evaluate(() => document.body.innerText);
  check('LIVE UI: the reason is visible in the billing history table',
    historyText.includes('Applied through the real admin screen'), 'reason rendered in history');

  // ── 11. A support admin does not even see the control ───────────────────
  await go(supportPage, '/admin');
  const supportSees = await supportPage.locator('[data-testid="admin-manual-plan"]').count();
  check('LIVE UI: SUPPORT_ADMIN is not shown the control (server already refused it too)',
    supportSees === 0, `found=${supportSees}`);

} catch (error) {
  check('the probe ran to completion', false, String(error.message).split('\n')[0].slice(0, 120));
} finally {
  // ── Teardown: child rows first, and idempotent, so this can run again ───
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or subjectId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
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

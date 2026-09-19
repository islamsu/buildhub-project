/**
 * ── THE WITHDRAWAL, AS A SUPPLIER ACTUALLY DOES IT ──────────────────────
 *
 * zg-withdrawal.mjs proves the rule against the database by calling the
 * function. That leaves the half a supplier experiences unproven: whether the
 * control is on the page, whether it is offered to the right person, and
 * whether pressing it changes anything.
 *
 * A procedure nobody can reach is not a feature. So this signs in as the
 * supplier who bid, opens their own quotation, and uses the control.
 *
 * AND AS THE CUSTOMER, who must not be offered it at all - the panel is the
 * supplier's own exit, and rejecting is the customer's separate verb.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9800 + (process.pid % 90)));
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(250); return true; }
    await settle(250);
  }
  return false;
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zwu%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from fieldValueHistory where actorId in ${ids} or ownerId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from quotations where rfqId in ${rfqIds}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zwu%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

function makeUser(name, userRole) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${name}', '${name}', '${name}@example.test', 'Probe ${name}', 'user',
        '${userRole}', 'password', 'self_registered', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  return Number(sql(`select id from users where username='${name}'`));
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  cleanUp();
  const buyer = makeUser(`zwuB${stamp}`, 'homeowner');
  const supplier = makeUser(`zwuS${stamp}`, 'supplier');
  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyer}, 'Withdrawal UI probe', 'Materials', 'open')`);
  const rfqId = Number(sql(`select id from rfqs where requesterId=${buyer} order by id desc limit 1`));
  sql(`insert into quotations (rfqId, providerId, price, currency, validUntil, status)
       values (${rfqId}, ${supplier}, 4200, 'EGP', date_add(now(), interval 30 day), 'pending')`);
  const quotationId = Number(sql(`select id from quotations where rfqId=${rfqId} order by id desc limit 1`));
  check(quotationId > 0, 'SETUP: a supplier has a pending bid', `quotation ${quotationId}`);

  const supplierPage = await browser.newPage();
  await supplierPage.setCookies(asBrowserCookies(await signIn(`${supplier}@example.test`.replace(String(supplier), `zwuS${stamp}`))));
  await supplierPage.setViewport({ width: 1280, height: 900 });
  await supplierPage.goto(`${BASE}/quotations/${quotationId}`);
  const loaded = await waitFor(supplierPage, `!!document.querySelector('[data-testid="quotation-detail-status"]')`);
  check(loaded, 'the supplier can open their own quotation');

  const panel = await supplierPage.evaluate(`
    const p = document.querySelector('[data-testid="quotation-withdraw-panel"]');
    const b = document.querySelector('[data-testid="quotation-withdraw"]');
    return JSON.stringify({ panel: !!p, button: !!b, disabled: b ? b.disabled : null,
      text: b ? b.innerText.trim() : '' });
  `);
  const seen = JSON.parse(panel);
  check(seen.panel && seen.button, 'and is offered the control on it', seen.text);
  check(seen.disabled === false, 'and it is live while the bid is pending', `disabled=${seen.disabled}`);

  /*
   * A LABEL DESCRIBES THE DESTINATION IT OPENS. "Withdraw quotation" must not
   * open a dispute, which is the other control in the same column.
   */
  await supplierPage.evaluate(`document.querySelector('[data-testid="quotation-withdraw"]').click(); return true;`);
  const opened = await waitFor(supplierPage, `!!document.querySelector('[data-testid="quotation-withdraw-confirm"]')`);
  check(opened, 'pressing it asks for confirmation rather than acting at once');

  const dialogText = await supplierPage.evaluate(`
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.slice(0, 200).split(String.fromCharCode(10)).join(' | ') : '';
  `);
  check(/withdraw/i.test(dialogText) && !/dispute/i.test(dialogText),
    'and the dialog is about withdrawing, not about disputes', dialogText.slice(0, 70));

  await supplierPage.evaluate(`
    const t = document.querySelector('[data-testid="quotation-withdraw-reason"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, 'Capacity went to another job');
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await supplierPage.evaluate(`document.querySelector('[data-testid="quotation-withdraw-confirm"]').click(); return true;`);

  const settled = await waitFor(supplierPage, `!document.querySelector('[data-testid="quotation-withdraw-confirm"]')`);
  check(settled, 'confirming closes the dialog');

  const stored = sql(`select status from quotations where id=${quotationId}`);
  check(stored === 'withdrawn', 'AND THE BID IS WITHDRAWN IN THE DATABASE', stored);

  const note = sql(`select detail from commercialAuditEvents
                    where subjectType='quotation' and subjectId=${quotationId}
                    and action='quotation_withdrawn' order by id desc limit 1`);
  check(note.includes('Capacity went to another job'),
    'with the reason the supplier typed, not an empty one', note || 'no row');

  await supplierPage.goto(`${BASE}/quotations/${quotationId}`);
  await waitFor(supplierPage, `!!document.querySelector('[data-testid="quotation-withdraw"]')`);
  const after = JSON.parse(await supplierPage.evaluate(`
    const b = document.querySelector('[data-testid="quotation-withdraw"]');
    const s = document.querySelector('[data-testid="quotation-detail-status"]');
    return JSON.stringify({ disabled: b ? b.disabled : null, status: s ? s.innerText.trim() : '' });
  `));
  check(after.disabled === true, 'and the control will not fire twice', `disabled=${after.disabled}`);
  check(/withdrawn/i.test(after.status), 'and the page says so', after.status);

  // ── The customer is not offered it ──────────────────────────────────────
  const buyerBrowser = await launchBrowser({ port: CDP_PORT + 1 });
  try {
    const buyerPage = await buyerBrowser.newPage();
    await buyerPage.setCookies(asBrowserCookies(await signIn(`zwuB${stamp}@example.test`)));
    await buyerPage.setViewport({ width: 1280, height: 900 });
    await buyerPage.goto(`${BASE}/quotations/${quotationId}`);
    const buyerLoaded = await waitFor(buyerPage, `!!document.querySelector('[data-testid="quotation-detail-status"]')`);
    check(buyerLoaded, 'POSITIVE: the customer can open the same quotation');
    const offered = await buyerPage.evaluate(`
      return String(!!document.querySelector('[data-testid="quotation-withdraw-panel"]'));
    `);
    check(offered === 'false', 'NEGATIVE: and is NOT offered the withdraw control', `panel present: ${offered}`);
  } finally {
    await buyerBrowser.close();
  }
} finally {
  cleanUp();
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

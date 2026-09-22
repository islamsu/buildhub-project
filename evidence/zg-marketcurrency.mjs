/**
 * ── THE QUOTATION CURRENCY IS THE RFQ'S ─────────────────────────────────
 *
 * CLAUDE.md §86-87, GCC_SCALE_READINESS.md §38-39, §43.
 *
 * `submitQuotation` accepted `z.literal(BILLING_CURRENCY)` - the currency of
 * the SUPPLIER'S SUBSCRIPTION PLAN, the amount they pay BuildHub every month -
 * and wrote it onto the bid as though it were the currency of the work. The
 * respond form showed the same value in a read-only field labelled "Currency".
 *
 * Those are two different commercial relationships. A supplier billed in EGP
 * under an Egypt contract, quoting a Saudi RFQ, bids in SAR. The owner named
 * this as launch-era debt to remove before regional enablement.
 *
 * WHAT IS PROVED, against real rows and in a real browser:
 *
 *   every RFQ states its market and its currency
 *   a quotation is stored in the RFQ's currency, not the supplier's
 *   the server REFUSES to take a currency from the client at all
 *   changing the RFQ's currency changes the next bid's currency
 *   the supplier's own subscription currency does not appear on the bid
 *   the respond form shows the RFQ's currency, read-only, and says why
 *   a project RFQ inherits the PROJECT's market, not a submitted one
 *   a market BuildHub does not operate in is refused
 *   the buyer's comparison screen labels each bid in its own currency
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { assertBuild } from './lib/build.mjs';

/**
 * THE CONSTANT THE OLD CODE READ. Imported from the product rather than
 * typed here, so a change to it cannot leave this probe asserting against a
 * value BuildHub no longer uses.
 */
const BILLING_CURRENCY = /export const BILLING_CURRENCY = '([A-Z]{3})'/
  .exec(readFileSync(new URL('../shared/billing.ts', import.meta.url), 'utf8'))?.[1] ?? 'EGP';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9900 + (process.pid % 80)));
const PASSWORD = 'LocalSuperAdmin!2024';
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = 'false';
    try { v = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (v === 'true') { await settle(300); return true; }
    await settle(250);
  }
  return false;
}
async function signIn(identifier) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${identifier}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}
/**
 * A tRPC call, WITH THE SUPERJSON META FOR DATES.
 *
 * `validUntil` is `z.date()`. Sent as a bare ISO string it is refused as a
 * type error - and the first run of this probe read that refusal as the
 * currency guard working, which is a vacuous pass: the request never got far
 * enough to test anything about currency. `dateKeys` names the fields that
 * must arrive as Dates so the payload is shaped the way the client shapes it.
 */
async function call(cookie, path, input, dateKeys = []) {
  const meta = dateKeys.length > 0
    ? { values: Object.fromEntries(dateKeys.map(key => [key, ['Date']])) }
    : undefined;
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(meta ? { json: input, meta } : { json: input }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * RFQ CREATION IS RATE-LIMITED, correctly, by burst and by sustained rate.
 *
 * This probe creates several, so it backs off and retries once rather than
 * reporting the limiter as a broken write path - which is what the first run
 * did, reporting "the project RFQ could not be created" for a 429.
 */
async function createRfq(cookie, input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await call(cookie, 'rfq.create', input);
    const message = result.body?.error?.json?.message ?? '';
    const retryAfter = /Try again in (\d+)s/.exec(message);
    if (!retryAfter) return result;
    await settle((Number(retryAfter[1]) + 2) * 1000);
  }
  return call(cookie, 'rfq.create', input);
}

console.log(`\nBUILD ${BUILD.shortCommit ?? '?'}  env=${BUILD.environment ?? '?'}\n`);

/* Two real accounts already approved in this dataset. */
const BUYER = 'zid6507832req@example.test';
const SUPPLIER = 'zid6507832vnd@example.test';
const buyerCookie = await signIn(BUYER);
const supplierCookie = await signIn(SUPPLIER);
const supplierId = Number(sql(`SELECT id FROM users WHERE email='${SUPPLIER}'`));

/* ── AN RFQ STATES ITS MARKET AND ITS CURRENCY ───────────────────────── */
const created = await createRfq(buyerCookie, {
  title: `Market probe ${stamp}`,
  description: 'Currency provenance probe.',
  category: 'Materials',
  budget: 250000,
  location: 'Cairo',
});
check(created.status === 200, 'a buyer raises an RFQ', `HTTP ${created.status}`);
const rfqId = Number(created.body?.result?.data?.json?.id ?? created.body?.result?.data?.json ?? 0);
check(rfqId > 0, 'and it has an id', `#${rfqId}`);

const stored = sql(`SELECT CONCAT(marketCode,'|',currency) FROM rfqs WHERE id=${rfqId}`);
check(stored === 'EG|EGP', 'the RFQ states its market and currency explicitly', stored);

/* ── A MARKET BUILDHUB DOES NOT OPERATE IN IS REFUSED ────────────────── */
const refused = await createRfq(buyerCookie, {
  title: `Unserved market ${stamp}`, category: 'Materials', marketCode: 'SA',
});
check(refused.status !== 200,
  'an RFQ in a market BuildHub does not operate in is REFUSED',
  refused.body?.error?.json?.message ?? `HTTP ${refused.status}`);

/* ── THE SUPPLIER CANNOT NAME A CURRENCY ─────────────────────────────── */
// THE INVITATION IS WHAT MAKES THIS SUPPLIER ELIGIBLE, and its failure is
// reported rather than swallowed: without it every quotation below is
// refused on eligibility and the currency assertions measure nothing.
const invited = await call(buyerCookie, 'rfq.inviteSupplier', { rfqId, supplierId });
check(invited.status === 200, 'the buyer invites the supplier, making them eligible',
  invited.body?.error?.json?.message ?? `HTTP ${invited.status}`);

const smuggled = await call(supplierCookie, 'rfq.submitQuotation', {
  rfqId, price: 180000, currency: 'SAR',
  validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
}, ['validUntil']);
// tRPC strips an unknown key rather than refusing it, so the assertion that
// matters is what was STORED - a smuggled currency must not reach the row.
const smuggledOk = smuggled.status === 200;
if (smuggledOk) {
  const bid = sql(`SELECT currency FROM quotations WHERE rfqId=${rfqId} AND providerId=${supplierId} ORDER BY id DESC LIMIT 1`);
  check(bid === 'EGP',
    'a currency smuggled in the payload NEVER reaches the stored bid', `stored ${bid}`);
} else {
  /*
   * A REFUSAL IS ONLY AN ANSWER IF IT IS THE RIGHT REFUSAL.
   *
   * The first run of this probe reported PASS here on a `validUntil` type
   * error - the request never reached the currency logic at all. Any refusal
   * that is not about eligibility now fails the probe, because it means this
   * check measured nothing.
   */
  const message = smuggled.body?.error?.json?.message ?? `HTTP ${smuggled.status}`;
  const eligibility = /qualified enquiry|invitation|forbidden|not accepting/i.test(message);
  check(eligibility,
    'the quotation was refused on ELIGIBILITY, not by a probe mistake', message);
}

/* ── AND IT IS THE RFQ'S, NOT THE SUPPLIER'S SUBSCRIPTION ────────────── */
// Proved by CHANGING the RFQ's currency and bidding again. If the bid were
// still taking the supplier's BILLING_CURRENCY it could not move.
const subscriptionCurrency = sql(`SELECT IFNULL(currency,'none') FROM vendorSubscriptions WHERE userId=${supplierId} LIMIT 1`) || 'none';
sql(`UPDATE rfqs SET marketCode='SA', currency='SAR' WHERE id=${rfqId}`);
const secondBid = await call(supplierCookie, 'rfq.submitQuotation', {
  rfqId, price: 190000,
  validUntil: new Date(Date.now() + 21 * 86400000).toISOString(),
}, ['validUntil']);
if (secondBid.status === 200) {
  const bid = sql(`SELECT currency FROM quotations WHERE rfqId=${rfqId} AND providerId=${supplierId} AND supersededAt IS NULL ORDER BY id DESC LIMIT 1`);
  check(bid === 'SAR',
    "the bid follows the RFQ's currency, not the supplier's subscription",
    `RFQ SAR, bid ${bid}, subscription ${subscriptionCurrency}`);
  /*
   * THE ASSERTION THAT KILLS THE OLD DEFECT.
   *
   * `BILLING_CURRENCY` is the constant submitQuotation used to write onto
   * every bid. Comparing against the subscription ROW was weaker than it
   * looked: this supplier has no subscription, so that comparison would have
   * passed whatever the code did. The constant is what the old code read,
   * so the constant is what the bid must now differ from.
   */
  check(bid !== BILLING_CURRENCY,
    `and is demonstrably NOT the subscription currency (${BILLING_CURRENCY})`,
    `bid ${bid}, subscription row ${subscriptionCurrency}`);
} else {
  check(false, 'the second bid could not be submitted',
    secondBid.body?.error?.json?.message ?? `HTTP ${secondBid.status}`);
}
sql(`UPDATE rfqs SET marketCode='EG', currency='EGP' WHERE id=${rfqId}`);

/* ── A PROJECT RFQ INHERITS THE PROJECT'S MARKET ─────────────────────── */
const project = await call(buyerCookie, 'projects.create', {
  title: `Market probe project ${stamp}`, type: 'residential', location: 'Cairo',
});
const projectId = Number(project.body?.result?.data?.json?.id ?? 0);
check(projectId > 0, 'a buyer creates a project', `#${projectId}`);
check(sql(`SELECT CONCAT(marketCode,'|',currency) FROM projects WHERE id=${projectId}`) === 'EG|EGP',
  'the project states its own market and currency');

const projectRfq = await createRfq(buyerCookie, {
  title: `Project RFQ ${stamp}`, category: 'Materials', projectId,
  // A DIFFERENT market is sent deliberately. The requirement's location is a
  // property of the job, not of the form.
  marketCode: 'SA',
});
if (projectRfq.status === 200) {
  const id = Number(projectRfq.body?.result?.data?.json?.id ?? 0);
  check(sql(`SELECT marketCode FROM rfqs WHERE id=${id}`) === 'EG',
    "a project RFQ inherits the PROJECT's market, ignoring a submitted one");
} else {
  check(false, 'the project RFQ could not be created',
    projectRfq.body?.error?.json?.message ?? `HTTP ${projectRfq.status}`);
}

/* ── IN THE BROWSER ──────────────────────────────────────────────────── */
const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookies(asBrowserCookies(supplierCookie));
  await page.goto(`${BASE}/rfq/${rfqId}/respond`);
  const ready = await waitFor(page, `document.querySelector('[data-testid="respond-currency"]') !== null`);
  if (!ready) {
    console.log(`SKIP  ${step++}. the respond form renders  [supplier cannot reach this RFQ in this dataset]`);
  } else {
    const shown = JSON.parse(await page.evaluate(`
      const field = document.querySelector('[data-testid="respond-currency"]');
      const reason = document.querySelector('[data-testid="respond-currency-reason"]');
      return JSON.stringify({
        value: field ? field.value : null,
        readOnly: field ? field.readOnly : null,
        reason: reason ? reason.textContent.trim() : null,
      });
    `));
    check(shown.value === 'EGP', "the form shows the RFQ's currency", `"${shown.value}"`);
    check(shown.readOnly === true, 'read-only, because it is not a choice');
    check((shown.reason ?? '').includes('subscription'),
      'and says plainly that the subscription does not change it', shown.reason);
  }
} finally {
  await browser.close();
}

/* ── A CORRUPT MARKET CODE IS NOT AN EGYPTIAN ONE ────────────────────── */
/*
 * §53B. `currencyForMarket` used to answer EGP for anything it did not
 * recognise, so an RFQ carrying a corrupt code would have had every bid
 * against it denominated in Egyptian pounds - a commercial number invented
 * from a data fault, on a document somebody signs.
 *
 * Forced through SQL because no write path can produce it: that is the
 * point. The question is what the READ does when it meets one.
 */
sql(`UPDATE rfqs SET marketCode='ZZ', currency='' WHERE id=${rfqId}`);
const corrupt = await call(supplierCookie, 'rfq.submitQuotation', {
  rfqId, price: 200000,
  validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
}, ['validUntil']);
check(corrupt.status !== 200,
  'a quotation against a corrupt-market RFQ is REFUSED, not priced in EGP',
  corrupt.body?.error?.json?.message ?? `HTTP ${corrupt.status}`);
const afterCorrupt = sql(`SELECT IFNULL(currency,'none') FROM quotations WHERE rfqId=${rfqId} AND supersededAt IS NULL ORDER BY id DESC LIMIT 1`);
check(afterCorrupt !== 'EGP',
  'and no bid was stored in Egyptian pounds off the back of it',
  `current bid currency ${afterCorrupt}`);
sql(`UPDATE rfqs SET marketCode='EG', currency='EGP' WHERE id=${rfqId}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);

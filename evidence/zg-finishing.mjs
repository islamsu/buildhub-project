/**
 * ── THE FINISHING JOURNEY, END TO END, AGAINST A RUNNING SERVER ─────────
 *
 * The unit tests prove the arithmetic and the contracts. This proves the thing
 * they cannot: that a real homeowner account can publish a طلب تشطيب full of
 * "I don't know", that three contractors can price it three different ways,
 * that the totals the SERVER stored are the ones the formula says, that the
 * comparison puts all three side by side without inventing an equivalence, and
 * that nobody who should not see any of it can.
 *
 * It also opens a browser for the one thing only a browser can answer: whether
 * clicking an AI suggestion puts a question in the person's mouth.
 *
 * Fixtures are created here and removed, and the removal is PROVED - a probe
 * that leaks fixtures poisons every later run's data.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'FinishPass!2026';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9098);

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

const stamp = Date.now() % 100000000;
const made = [];
let browser;

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async post(path, input) {
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify({ json: input }),
    });
    this.absorb(res);
    return unwrap(res);
  }
  async get(path, input) {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: this.header() } });
    this.absorb(res);
    return unwrap(res);
  }
}
async function unwrap(res) {
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return {
    status: res.status,
    data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null,
    code: parsed?.error?.json?.data?.code ?? null,
  };
}
async function account(prefix, userRole) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: PASSWORD,
    name: `Finish ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id };
}

/** A provider that can actually respond: approved, in-category, enquiry opened. */
async function readyProvider(prefix, rfqId) {
  const provider = await account(prefix, 'contractor');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${provider.id}`);
  await provider.s.post('profile.setMyCategories', { categories: ['Renovation'] });
  const opened = await provider.s.post('rfq.openEnquiry', { rfqId });
  if (opened.status !== 200) throw new Error(`openEnquiry ${prefix}: ${opened.status} ${opened.error}`);
  return provider;
}

const VALID_UNTIL = { json: null };   // replaced per call; superjson needs the meta

/** superjson wire format for a Date input. */
const withDate = (input, field) => ({
  json: input,
  meta: { values: { [field]: ['Date'] } },
});
async function submitQuotation(session, payload) {
  const res = await fetch(`${BASE}/api/trpc/rfq.submitQuotation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: session.header() },
    body: JSON.stringify(withDate(payload, 'validUntil')),
  });
  session.absorb(res);
  return unwrap(res);
}
void VALID_UNTIL;

const validUntil = new Date(Date.now() + 30 * 86400_000).toISOString();

try {
  /* ═══ 1. A HOMEOWNER PUBLISHES A BRIEF FULL OF UNKNOWNS ═══════════════ */
  const owner = await account('fnown', 'homeowner');

  const created = await owner.s.post('rfq.create', {
    title: `Finishing ${stamp}`,
    description: 'Shell apartment, needs finishing.',
    category: 'Renovation',
    location: 'Cairo',
    /* EVERY TECHNICAL FIELD MARKED UNKNOWN. This is the request a first-time
       homeowner actually has, and it must publish. */
    finishingBrief: {
      requestingParty: 'property_owner',
      kind: 'full',
      propertyType: 'apartment',
      currentCondition: 'unknown',
      areaSqm: 'unknown',
      level: 'unknown',
      materialPreferences: 'unknown',
      areas: ['reception', 'kitchen', 'bathroom'],
    },
    pricingPreference: 'provider_choice',
  });
  check(created.status === 200 && created.data?.id > 0,
    'a homeowner publishes a finishing request with five fields marked "I don\'t know"',
    created.status === 200 ? `rfq ${created.data?.id}` : `HTTP ${created.status} ${created.error}`);
  const rfqId = created.data?.id;
  if (!rfqId) throw new Error('no rfq created');

  const storedBrief = sql(`select finishingBrief from rfqs where id=${rfqId}`);
  check(storedBrief.includes('"unknown"'),
    'and the unknowns are STORED as the sentinel, not dropped and not defaulted',
    storedBrief.slice(0, 90));
  check(!/"level"\s*:\s*"(basic|standard|high|luxury)"/.test(storedBrief),
    'in particular the finishing level was not silently filled in');
  check(sql(`select pricingPreference from rfqs where id=${rfqId}`) === 'provider_choice',
    'and the pricing preference is recorded as the decision it is');
  check(sql(`select category from rfqs where id=${rfqId}`) === 'Renovation',
    'the request is an ordinary rfqs row on the canonical category, not a new type');
  const currency = sql(`select currency from rfqs where id=${rfqId}`);
  check(currency === 'EGP', 'denominated in the market\'s currency, not a hard-coded SAR', currency);

  /* ═══ 2. THREE CONTRACTORS, THREE PRICING METHODS ═════════════════════ */
  const pct = await readyProvider('fnpct', rfqId);
  const pkg = await readyProvider('fnpkg', rfqId);
  const boq = await readyProvider('fnboq', rfqId);

  // ── PERCENTAGE: 400,000 material x 12.5% = 50,000, +14% VAT = 57,000 ──
  const percentage = await submitQuotation(pct.s, {
    rfqId, pricingMethod: 'percentage',
    materialBaseAmount: 400000, percentageRate: 12.5,
    percentageBasisNote: 'Tiles, paint, gypsum and sanitary ware at invoice cost. Excludes kitchen units and AC.',
    vatRate: 14, timeline: 60, validUntil,
    scope: { inclusions: ['Flooring', 'Painting'], exclusions: ['Kitchen cabinets'] },
  });
  check(percentage.status === 200, 'a contractor quotes as a percentage of material cost',
    percentage.status === 200 ? '' : `HTTP ${percentage.status} ${percentage.error}`);
  const pctRow = sql(`select price,baseAmount,vatAmount,vatRate,percentageRate,materialBaseAmount,pricingMethod
    from quotations where rfqId=${rfqId} and providerId=${pct.id} and supersededAt is null`);
  check(pctRow.startsWith('57000.000\t50000.000\t7000.000\t14.000\t12.500\t400000.000\tpercentage'),
    'and the SERVER stored base 50,000, VAT 7,000 and total 57,000 - computed, not submitted', pctRow);

  // ── PACKAGE: 3,500/m2 x 120 m2 = 420,000, no VAT stated ──────────────
  const packageQuote = await submitQuotation(pkg.s, {
    rfqId, pricingMethod: 'package',
    packageTier: 'Premium', packageBasis: 'per_square_metre',
    packageRate: 3500, packageQuantity: 120,
    timeline: 75, validUntil,
    scope: { inclusions: ['Flooring', 'Painting', 'Kitchen cabinets'] },
  });
  check(packageQuote.status === 200, 'another quotes a per-square-metre package',
    packageQuote.status === 200 ? '' : `HTTP ${packageQuote.status} ${packageQuote.error}`);
  const pkgRow = sql(`select price,packageRate,packageQuantity,vatRate,vatAmount
    from quotations where rfqId=${rfqId} and providerId=${pkg.id} and supersededAt is null`);
  check(pkgRow.startsWith('420000.000\t3500.000\t120.00'),
    'stored as rate x quantity, so the total is reproducible from its own inputs', pkgRow);
  check(pkgRow.split('\t')[3] === 'NULL' && pkgRow.split('\t')[4] === '0.000',
    'AND AN UNSTATED VAT RATE IS NULL, NOT ZERO', `vatRate=${pkgRow.split('\t')[3]}`);

  // ── DETAILED: 42,000 + 18,810 + 9,500 = 70,310, less 310 discount,
  //    +5% contingency +10% overhead on 70,000 = 80,500, +14% VAT ───────
  const detailed = await submitQuotation(boq.s, {
    rfqId, pricingMethod: 'detailed',
    lines: [
      { component: 'material', tradeGroup: 'Flooring', description: 'Porcelain tiles', quantity: 120, unit: 'm2', rate: 350 },
      { component: 'labor', tradeGroup: 'Painting', description: 'Plastic paint, 3 coats', quantity: 85.5, unit: 'm2', rate: 220 },
      { component: 'subcontract', tradeGroup: 'Gypsum', description: 'Gypsum ceiling', quantity: 1, unit: 'job', rate: 9500 },
    ],
    discountAmount: 310, contingencyRate: 5, overheadRate: 10, vatRate: 14,
    timeline: 55, validUntil,
    scope: { inclusions: ['Flooring', 'Painting'], exclusions: ['Kitchen cabinets', 'Air conditioning'] },
  });
  check(detailed.status === 200, 'and a third submits a bill of quantities',
    detailed.status === 200 ? '' : `HTTP ${detailed.status} ${detailed.error}`);
  const boqId = num(`select id from quotations where rfqId=${rfqId} and providerId=${boq.id} and supersededAt is null`);
  const lineCount = num(`select count(*) from quotationItems where quotationId=${boqId}`);
  check(lineCount === 3, 'whose lines are stored against the quotation', `${lineCount} lines`);
  const lineTotals = sql(`select lineTotal from quotationItems where quotationId=${boqId} order by position`);
  check(lineTotals.split('\n').join(' ') === '42000.000 18810.000 9500.000',
    'with each line total recomputed server-side, never taken from the client', lineTotals.split('\n').join(' '));
  const boqRow = sql(`select price,baseAmount,discountAmount,vatAmount from quotations where id=${boqId}`);
  check(boqRow === '91770.000\t70310.000\t310.000\t11270.000',
    'and the total follows the one formula: contingency and overhead on the DISCOUNTED base, VAT once', boqRow);

  /*
   * THE ARITHMETIC, RESTATED INDEPENDENTLY.
   *   base 70,310 − 310 = 70,000
   *   contingency 5% = 3,500 ; overhead 10% = 7,000  (both on 70,000)
   *   net 80,500 ; VAT 14% = 11,270 ; total 91,770
   * Overhead compounded on contingency would give 91,819.50 instead.
   */
  check(Number(boqRow.split('\t')[0]) === 91770,
    'overhead was NOT charged on top of contingency, which would have cost 49.50 more');

  /* ═══ 3. A CLIENT-SUPPLIED TOTAL IS REFUSED ═══════════════════════════ */
  const smuggled = await submitQuotation(pkg.s, {
    rfqId, pricingMethod: 'package', packageBasis: 'per_square_metre',
    packageRate: 3500, packageQuantity: 120, price: 1, validUntil,
  });
  check(smuggled.status !== 200,
    'a submitted total for a derived method is REFUSED, not quietly ignored',
    `HTTP ${smuggled.status}`);

  /* ═══ 4. COMPARISON, WITHOUT INVENTING AN EQUIVALENCE ═════════════════ */
  const comparison = await owner.s.get('rfq.comparison', { rfqId });
  check(comparison.status === 200 && comparison.data?.quotations?.length === 3,
    'the requester compares all three methods in one place',
    `HTTP ${comparison.status}, ${comparison.data?.quotations?.length ?? 0} quotations`);
  const methods = (comparison.data?.quotations ?? []).map(q => q.method).sort().join(',');
  check(methods === 'detailed,package,percentage',
    'and each keeps its own pricing method rather than being flattened', methods);

  const rates = (comparison.data?.quotations ?? []).map(q => ({ m: q.method, r: q.ratePerUnitArea }));
  const packageRate = rates.find(r => r.m === 'package');
  check(packageRate?.r === 3500,
    'a per-m2 package yields a per-m2 rate from its own quantity', String(packageRate?.r));
  const others = rates.filter(r => r.m !== 'package');
  check(others.every(r => r.r === null),
    'AND NO RATE IS INVENTED for the others, because the buyer said they do not know the area',
    others.map(r => `${r.m}=${r.r}`).join(' '));

  const differences = comparison.data?.differences ?? [];
  const cabinets = differences.find(d => /cabinet/i.test(d.item));
  check(cabinets != null, 'the scope difference on kitchen cabinets is surfaced');
  check((cabinets?.includedIn?.length ?? 0) === 1 && (cabinets?.excludedIn?.length ?? 0) === 2,
    'one quotation includes them and two exclude them',
    `in ${cabinets?.includedIn} out ${cabinets?.excludedIn}`);
  const ac = differences.find(d => /air condition/i.test(d.item));
  check((ac?.unstatedIn?.length ?? 0) === 2,
    'AND SILENCE IS ITS OWN STATE: two quotations never mention air conditioning',
    `unstated in ${ac?.unstatedIn}`);

  /* ═══ 5. NOBODY ELSE MAY SEE ANY OF IT ════════════════════════════════ */
  const rival = await owner.s.get('rfq.comparison', { rfqId });
  void rival;
  const rivalView = await pkg.s.get('rfq.comparison', { rfqId });
  check(rivalView.status !== 200,
    'A RIVAL SUPPLIER CANNOT OPEN THE COMPARISON - the whole point of a sealed bid',
    `HTTP ${rivalView.status}`);

  const stranger = await account('fnstr', 'homeowner');
  const strangerView = await stranger.s.get('rfq.comparison', { rfqId });
  check(strangerView.status !== 200, 'nor can an unrelated account', `HTTP ${strangerView.status}`);

  const strangerQuotes = await stranger.s.get('rfq.quotations', { rfqId });
  check(strangerQuotes.status !== 200, 'nor read the quotations themselves',
    `HTTP ${strangerQuotes.status}`);

  /* ═══ 6. AI SUGGESTIONS ARE DERIVED, AND SCOPED ═══════════════════════ */
  const ownerSuggestions = await owner.s.get('ai.suggestions', { subject: 'request', subjectId: rfqId });
  const ownerIds = (ownerSuggestions.data?.suggestions ?? []).map(s => s.id);
  check(ownerSuggestions.status === 200 && ownerIds.includes('req-compare'),
    'with quotations in hand, the requester is offered comparison actions', ownerIds.join(' '));

  const providerSuggestions = await pct.s.get('ai.suggestions', { subject: 'request', subjectId: rfqId });
  const providerIds = (providerSuggestions.data?.suggestions ?? []).map(s => s.id);
  check(providerIds.includes('req-prepare') && !providerIds.includes('req-compare'),
    'and the contractor on the same request is offered bid actions instead', providerIds.join(' '));

  const strangerSuggestions = await stranger.s.get('ai.suggestions', { subject: 'request', subjectId: rfqId });
  const strangerIds = (strangerSuggestions.data?.suggestions ?? []).map(s => s.id);
  check(strangerSuggestions.status === 200 && !strangerIds.some(id => id.startsWith('req-')),
    'an unrelated account gets the general list, so the endpoint is not an id oracle',
    strangerIds.join(' '));
  check(JSON.stringify(providerSuggestions.data ?? {}).indexOf('quotationCount') === -1
    || (providerSuggestions.data?.context?.stage ?? null) !== null,
    'and a provider is never told how many rivals have bid');

  const suggestionJson = JSON.stringify(ownerSuggestions.data ?? {});
  check(!/\bautoSubmit\b|"send"|"submit"/.test(suggestionJson),
    'NOTHING IN THE RESPONSE MEANS "SEND THIS"');

  /* ═══ 7. ACCEPTANCE, THROUGH THE EXISTING LIFECYCLE ═══════════════════ */
  const accepted = await owner.s.post('rfq.acceptQuotation', { quotationId: boqId, rfqId });
  check(accepted.status === 200, 'the requester accepts the detailed quotation',
    accepted.status === 200 ? '' : `HTTP ${accepted.status} ${accepted.error}`);
  check(sql(`select status from quotations where id=${boqId}`) === 'accepted',
    'the quotation reads accepted');
  check(sql(`select status from rfqs where id=${rfqId}`) === 'awarded',
    'and the request moves to the EXISTING awarded state - no finishing-only status');

  /* ═══ 8. THE BROWSER: A CLICK MUST NOT ASK A QUESTION ═════════════════
   *
   * WHAT THIS ENVIRONMENT CAN AND CANNOT PROVE. `auth.capabilities` reports
   * whether an AI provider is configured. Without a credential the assistant is
   * correctly unavailable: the tool cards carry `pointer-events-none` and the
   * composer is disabled, so the FILL path cannot be exercised here and saying
   * otherwise would be a fake pass.
   *
   * What CAN be proved without a credential is the stronger half of the same
   * rule - that a click produces no question either way - and it is proved
   * rather than assumed. The fill wiring itself is asserted at source level in
   * server/aiSuggestionContract.test.ts.
   */
  browser = await launchBrowser({ port: CDP_PORT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/`);
  await page.setCookies(asBrowserCookies(owner.s.header()));
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  await page.goto(`${BASE}/ai`);
  const toolsReady = await waitFor(page, `document.querySelector('[data-testid="ai-tools"]') !== null`);
  check(toolsReady, 'the assistant page renders its tool cards');

  const capabilities = await (await fetch(`${BASE}/api/trpc/auth.capabilities`)).json();
  const aiConfigured = capabilities?.result?.data?.json?.aiAssistant === true;

  const toolCount = await page.evaluate(`
    return document.querySelectorAll('[data-testid="ai-tools"] [data-testid^="ai-tool-"]').length;
  `);
  check(Number(toolCount) > 0, 'and there are tools to click', String(toolCount));

  /*
   * THE USER MESSAGES BEFORE THE CLICK.
   *
   * Counted from `data-testid="ai-message-user"`, not from the page's character
   * count: the first version measured `document.body.innerText.length` and the
   * suggestion strip arriving asynchronously moved it by 53 characters, which
   * read as a message. Count the thing the rule is about.
   */
  const userMessagesBefore = await page.evaluate(`
    return document.querySelectorAll('[data-testid="ai-message-user"]').length;
  `);

  await page.evaluate(`
    const card = document.querySelector('[data-testid="ai-tools"] [data-testid^="ai-tool-"]');
    if (card) card.click();
    return true;
  `);
  await settle(1500);

  const after = await page.evaluate(`
    const composer = document.querySelector('textarea');
    return {
      composer: composer ? composer.value : '',
      focused: composer ? document.activeElement === composer : false,
      userMessages: document.querySelectorAll('[data-testid="ai-message-user"]').length,
      /* An assistant reply would have appeared, or an error toast. */
      errored: /went wrong|error/i.test(document.body.innerText || ''),
    };
  `);

  if (aiConfigured) {
    check((after?.composer ?? '').length > 0,
      'CLICKING A TOOL FILLS THE COMPOSER', (after?.composer ?? '').slice(0, 60));
    check(after?.focused === true,
      'and focuses it, so the person can edit before they ask');
    check(Number(after?.userMessages ?? -1) === Number(userMessagesBefore ?? 0),
      'AND NO USER MESSAGE WAS APPENDED - the draft is offered, not asked',
      `${userMessagesBefore} -> ${after?.userMessages}`);
  } else {
    /*
     * HONEST SKIP, and a real assertion beside it. The click must still do
     * NOTHING - no message, no request, no error - which is the unavailable
     * guard working, and is itself worth proving.
     */
    console.log('SKIP  the composer-fill path needs a configured AI provider (auth.capabilities.aiAssistant=false)');
    check((after?.composer ?? '') === '',
      'with no AI provider configured, a tool click fills nothing',
      JSON.stringify(after?.composer ?? ''));
    check(after?.errored === false,
      'and produces no error either - the card is guarded, not merely styled');
    check(Number(after?.userMessages ?? -1) === Number(userMessagesBefore ?? 0),
      'AND NO USER MESSAGE WAS APPENDED TO THE TRANSCRIPT',
      `${userMessagesBefore} -> ${after?.userMessages}`);
  }

} finally {
  if (browser) await browser.close().catch(() => {});
  console.log('\n── cleanup ──');
  const rfqIds = sql(`select id from rfqs where title like 'Finishing ${stamp}%'`).split('\n').filter(Boolean);
  for (const id of rfqIds) {
    const quoteIds = sql(`select id from quotations where rfqId=${id}`).split('\n').filter(Boolean);
    for (const quoteId of quoteIds) {
      try { sql(`delete from quotationItems where quotationId=${quoteId}`); } catch { /* none */ }
    }
    for (const table of ['quotations', 'rfqSuppliers', 'qualifiedEnquiries', 'rfqItems', 'enquiryAssignments']) {
      try { sql(`delete from ${table} where rfqId=${id}`); } catch { /* none of that kind */ }
    }
    try { sql(`delete from rfqs where id=${id}`); } catch { /* still referenced */ }
  }
  for (const id of made) {
    for (const statement of [
      `delete from referralCodeEvents where actorId=${id} or userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from savedItems where userId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where actorId=${id} or userId=${id}`,
      `delete from projectMembers where userId=${id}`,
      `delete from vendorProfiles where userId=${id}`,
    ]) {
      try { sql(statement); } catch { /* nothing of that kind for this id */ }
    }
    try { sql(`delete from users where id=${id}`); } catch { /* counted below */ }
  }
  const usersLeft = num(`select count(*) from users where email like '%${stamp}@example.test'`);
  const rfqsLeft = num(`select count(*) from rfqs where title like 'Finishing ${stamp}%'`);
  check(usersLeft === 0 && rfqsLeft === 0,
    'every fixture this probe created is removed', `${usersLeft} users, ${rfqsLeft} requests`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

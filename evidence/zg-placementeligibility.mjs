/**
 * ── DOES A PLACEMENT EVER OUTRANK PUBLIC ELIGIBILITY? ─────────────────────
 *
 * The owner's rule, which this exists to test rather than to assume:
 *
 *   PUBLICLY RENDERABLE PLACEMENT
 *     = ACTIVE PLACEMENT
 *     AND TARGET EXISTS
 *     AND TARGET IS CURRENTLY PUBLICLY ELIGIBLE
 *     AND VIEWER MAY SEE TARGET
 *
 * ── WHY THIS FILE EXISTS AND zg-masterplacement.mjs WAS NOT ENOUGH ────────
 *
 * That probe reported a DELISTED product rendering through a live Sponsored
 * placement. It was wrong, and wrong in a way worth recording: it delisted by
 * `update products set active=0`, and `active` is the LEGACY boolean that
 * server/productLifecycle.ts writes from `status` and nobody reads. `status`
 * stayed 'active', so the row it built was publicly eligible and the
 * marketplace was right to render it. No application path can produce that
 * row - the probe manufactured a state the product cannot reach.
 *
 * That is exactly the trap §8 of the directive names: a test that satisfies
 * itself with an unsupported lifecycle transition. So every state here is
 * reached the way the product reaches it - `transitionProduct` for a product,
 * `admin.setUserFrozen`'s own write for a seller - and the states that the
 * application REFUSES are asserted as refusals instead of forced.
 *
 * Both the positive and the negative control matter. A negative that passes
 * because the setup silently failed proves nothing, so each negative is
 * preceded by the positive on the same row.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
await assertBuild(BASE);
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`,
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

/** SQL that is expected to be REFUSED. Returns the database's reason. */
const sqlExpectError = q => {
  try { sql(q); return null; }
  catch (error) {
    const text = error?.stderr ? Buffer.from(error.stderr).toString() : String(error);
    return text.replace(/\s+/g, ' ').trim();
  }
};

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const query = async (path, input) => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json ?? null, error: body?.error?.json?.message ?? null };
};

const stamp = Date.now() % 100000000;
const made = { users: [], products: [], placements: [] };
const esc = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

function mkSupplier(suffix, over = {}) {
  const u = `pe${stamp}${suffix}`;
  const row = {
    openId: `probe-${u}`, username: u, email: `${u}@example.test`,
    name: `Eligibility Co ${suffix}`, userRole: 'supplier',
    onboardingStatus: 'approved', accountStatus: 'active',
    isDummy: 0, deactivatedAt: null, ...over,
  };
  sql(`insert into users (${Object.keys(row).join(',')}) values (${Object.values(row).map(esc).join(',')})`);
  const id = Number(sql(`select id from users where username='${u}'`));
  const back = sql(`select username from users where id=${id}`);
  if (!Number.isInteger(id) || id <= 0 || back !== u) {
    throw new Error(`probe setup: created ${u} but id ${id} holds "${back}"`);
  }
  made.users.push(id);
  return id;
}

/** A product in a REAL creatable status. `status` is the authority; `active`
    is the derived legacy boolean, written to match so the row is consistent
    with what the application would have written. */
function mkProduct(supplierId, name, category, status = 'active') {
  sql(`insert into products (supplierId, name, category, price, currency, unit, status, active, featured)
       values (${supplierId}, ${esc(name)}, ${esc(category)}, '18500.00', 'EGP', 'tonne',
               ${esc(status)}, ${status === 'active' ? 1 : 0}, 0)`);
  const id = Number(sql(`select id from products where name=${esc(name)}`));
  made.products.push(id);
  return id;
}

function book(over = {}) {
  const row = {
    vendorId: null, productId: null, category: 'GLOBAL', kind: 'sponsored',
    source: 'PAID_SPONSORSHIP', package: 'PREMIER', surface: 'MASTER_DISCOVERY',
    entityType: 'PRODUCT', priority: 0,
    startsAt: '2020-01-01 00:00:00', endsAt: null, revokedAt: null, ...over,
  };
  sql(`insert into vendorSponsorships (${Object.keys(row).join(',')}) values (${Object.values(row).map(esc).join(',')})`);
  const id = Number(sql(`select max(id) from vendorSponsorships`));
  made.placements.push(id);
  return id;
}

/**
 * The lifecycle move, through the module that OWNS it - never a raw UPDATE.
 *
 * See evidence/lib/transition-product.ts for why this is a separate file and
 * why a raw `update products set ...` would invalidate every case below.
 */
function transition(productId, supplierId, to) {
  try {
    const out = execSync(
      `pnpm exec tsx evidence/lib/transition-product.ts ${productId} ${supplierId} ${to}`,
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    const line = out.split('\n').find(l => /^(OK|REFUSED)/.test(l));
    /* A harness failure must not read as a product refusal. */
    return line ?? `HARNESS no OK/REFUSED line in: ${out.trim().slice(0, 200)}`;
  } catch (error) {
    const stderr = error?.stderr ? Buffer.from(error.stderr).toString().trim() : String(error);
    return `HARNESS ${stderr.slice(0, 250)}`;
  }
}

try {
  /* ══ CASE A / B / C: SPONSORED PRODUCT, PRODUCT LIFECYCLE ═══════════════ */
  const supplierA = mkSupplier('a');
  const productA = mkProduct(supplierA, `Eligible Rebar ${stamp}`, 'Materials');
  book({ productId: productA });

  const liveA = await query('marketplace.masterProduct', {});
  check('A. eligible product + active Sponsored placement renders',
    liveA.data?.id === productA, `got=${liveA.data?.id} want=${productA}`);

  /* The real supplier action: withdraw from sale. `transitionProduct` permits
     active -> inactive even with a live placement, so this is reachable. */
  const offSale = transition(productA, supplierA, 'inactive');
  check('B. setup: the application permits active -> inactive',
    offSale.startsWith('OK'), offSale.slice(0, 90));
  check('B. setup: status is the authority and it moved',
    sql(`select status from products where id=${productA}`) === 'inactive',
    sql(`select concat(status,'/',active) from products where id=${productA}`));
  check('B. setup: the placement is still live',
    Number(sql(`select count(*) from vendorSponsorships where productId=${productA} and revokedAt is null`)) === 1);

  const delistedA = await query('marketplace.masterProduct', {});
  check('B. OFF-SALE product does NOT render through its live Sponsored placement',
    delistedA.data === null, JSON.stringify(delistedA.data));

  /* And the placement record survives - §3: stop rendering without deleting. */
  check('B. the placement record is NOT destroyed to achieve that',
    Number(sql(`select count(*) from vendorSponsorships where productId=${productA}`)) === 1);

  const back = transition(productA, supplierA, 'active');
  check('C. setup: the application permits inactive -> active again',
    back.startsWith('OK'), back.slice(0, 90));
  const republished = await query('marketplace.masterProduct', {});
  check('C. republished product renders again with no duplicated state',
    republished.data?.id === productA, `got=${republished.data?.id}`);

  /* ARCHIVED is refused while a placement is live - asserted as the refusal
     it is, rather than forced with SQL to make a test go green. */
  const archiveAttempt = transition(productA, supplierA, 'archived');
  check('C. archiving a product with a live placement is REFUSED, not silent',
    archiveAttempt.startsWith('REFUSED CONFLICT'), archiveAttempt.slice(0, 110));

  /* ══ CASE E: MISSING TARGET ════════════════════════════════════════════ */
  const supplierE = mkSupplier('e');
  const productE = mkProduct(supplierE, `Vanishing Rebar ${stamp}`, 'Cement');
  const placementE = book({ productId: productE, category: 'Cement', surface: 'TYPE_CATEGORY_SPOTLIGHT' });
  const liveE = await query('marketplace.spotlightProducts', { category: 'Cement' });
  check('E. setup: the spotlight product renders first',
    Array.isArray(liveE.data) && liveE.data.some(p => p.id === productE),
    JSON.stringify(liveE.data?.map(p => p.id)));

  /* TWO INDEPENDENT GUARDS HOLD THIS, and it is worth saying which, because
     this check alone does not distinguish them: livePlacementRows skips a row
     whose target id is null, AND the eligibility lookup cannot match a null id
     so the emit loop drops it. Removing either one leaves the outcome correct
     here - proven by mutation - so server/placementEligibility.test.ts pins
     each guard separately and this asserts only the end-to-end result. */
  sql(`update vendorSponsorships set productId=NULL where id=${placementE}`);
  const nullTarget = await query('marketplace.spotlightProducts', { category: 'Cement' });
  check('E. a placement whose target id is NULL renders nothing',
    Array.isArray(nullTarget.data) && !nullTarget.data.some(p => p?.id === productE),
    JSON.stringify(nullTarget.data));

  /* AND THE STRONGER FACT: a placement CANNOT point at a product that does
     not exist, because the schema will not let it. That is a better guarantee
     than a filter, so it is asserted as the refusal it is rather than forced
     with SQL and then "handled". */
  const ghost = sqlExpectError(`update vendorSponsorships set productId=999999999 where id=${placementE}`);
  check('E. the database REFUSES a placement pointing at a non-existent product',
    ghost !== null && /foreign key|cannot add or update/i.test(ghost), (ghost ?? 'accepted!').slice(0, 110));

  const restrict = sql(`select DELETE_RULE from information_schema.REFERENTIAL_CONSTRAINTS
    where CONSTRAINT_SCHEMA='${DB}' and CONSTRAINT_NAME='vendorSponsorships_productId_products_id_fk'`);
  check('E. and a product holding a placement cannot be deleted out from under it',
    restrict === 'RESTRICT', `ON DELETE ${restrict}`);

  /* ══ CASE D: THE SELLER, NOT THE PRODUCT ══════════════════════════════
     The product stays perfectly eligible. The BUSINESS behind it is
     suspended - a real administrative action (admin.setUserFrozen writes
     exactly this). A marketplace that has withdrawn a seller must not go on
     promoting their catalogue. */
  const supplierD = mkSupplier('d');
  const sponsoredD = mkProduct(supplierD, `Sponsored Tile ${stamp}`, 'Tiles');
  const featuredD = mkProduct(supplierD, `Featured Tile ${stamp}`, 'Tiles');
  sql(`update products set featured=1 where id=${featuredD}`);
  book({ productId: sponsoredD, category: 'Tiles', surface: 'TYPE_CATEGORY_SPOTLIGHT' });

  const beforeFreeze = await query('marketplace.spotlightProducts', { category: 'Tiles' });
  check('D. setup: the Sponsored product renders while the seller is active',
    Array.isArray(beforeFreeze.data) && beforeFreeze.data.some(p => p.id === sponsoredD),
    JSON.stringify(beforeFreeze.data?.map(p => p.id)));
  const featuredBefore = await query('marketplace.featuredProducts', { category: 'Tiles' });
  check('D. setup: the Featured product renders while the seller is active',
    Array.isArray(featuredBefore.data) && featuredBefore.data.some(p => p.id === featuredD),
    JSON.stringify(featuredBefore.data?.map(p => p.id)));

  // What admin.setUserFrozen writes, exactly.
  sql(`update users set accountStatus='frozen', frozenAt=now(),
       frozenReason='Suspended by an administrator' where id=${supplierD}`);
  check('D. setup: the products themselves are still publicly eligible',
    sql(`select group_concat(status) from products where id in (${sponsoredD},${featuredD})`) === 'active,active',
    sql(`select group_concat(status) from products where id in (${sponsoredD},${featuredD})`));

  const sponsoredAfter = await query('marketplace.spotlightProducts', { category: 'Tiles' });
  check('D. SPONSORED: a suspended seller stops being promoted',
    Array.isArray(sponsoredAfter.data) && !sponsoredAfter.data.some(p => p.id === sponsoredD),
    JSON.stringify(sponsoredAfter.data?.map(p => p.id)));

  const featuredAfter = await query('marketplace.featuredProducts', { category: 'Tiles' });
  check('D. FEATURED: a suspended seller stops being promoted',
    Array.isArray(featuredAfter.data) && !featuredAfter.data.some(p => p.id === featuredD),
    JSON.stringify(featuredAfter.data?.map(p => p.id)));

  /* ══ CASE F: PROVIDER PLACEMENT, SAME QUESTION ════════════════════════ */
  const providerF = mkSupplier('f', { userRole: 'contractor' });
  book({ vendorId: providerF, entityType: 'PROVIDER', category: 'GLOBAL', surface: 'MASTER_DISCOVERY' });
  const providerLive = await query('marketplace.masterProvider', {});
  check('F. setup: an eligible provider holds the Master slot',
    providerLive.data?.id === providerF, `got=${providerLive.data?.id} want=${providerF}`);

  sql(`update users set onboardingStatus='rejected' where id=${providerF}`);
  const providerRejected = await query('marketplace.masterProvider', {});
  check('F. a provider who loses approval stops holding the Master slot',
    providerRejected.data === null, JSON.stringify(providerRejected.data));

  sql(`update users set onboardingStatus='approved', deactivatedAt=now() where id=${providerF}`);
  const providerGone = await query('marketplace.masterProvider', {});
  check('F. a deactivated provider stops holding the Master slot',
    providerGone.data === null, JSON.stringify(providerGone.data));

  /* ══ FAIL CLOSED, AND SAY NOTHING ═════════════════════════════════════
     §4: the public response must not explain WHY a placement is empty. */
  const quiet = JSON.stringify(sponsoredAfter.data ?? '') + JSON.stringify(featuredAfter.data ?? '');
  check('the public response leaks no eligibility reason',
    !/frozen|suspend|reject|deactivat|archiv|inactive|draft/i.test(quiet), quiet.slice(0, 120));
} finally {
  /* Teardown, children first. Reported rather than swallowed: rows left
     behind would make the NEXT run's negatives pass for the wrong reason. */
  for (const table of [
    ['vendorSponsorships', made.placements],
    ['products', made.products],
    ['users', made.users],
  ]) {
    const [name, ids] = table;
    if (ids.length === 0) continue;
    try {
      sql(`delete from ${name} where id in (${ids.join(',')})`);
      const left = Number(sql(`select count(*) from ${name} where id in (${ids.join(',')})`));
      if (left > 0) console.log(`CLEANUP  ${name} left ${left} rows behind`);
    } catch (e) { console.log(`CLEANUP  ${name} failed: ${String(e).slice(0, 120)}`); }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

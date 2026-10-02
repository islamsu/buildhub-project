/**
 * ── THE MATRIX: PRODUCT STATE × SELLER STANDING, ON EVERY PUBLIC SURFACE ──
 *
 * One rule decides whether a visitor may see a product:
 *
 *   PUBLIC MARKETPLACE PRODUCT ELIGIBILITY
 *     = product publicly eligible AND seller publicly eligible
 *
 * and promotion composes it rather than competing with it. This proves the
 * rule holds on each surface that answers a visitor, by asking the real HTTP
 * endpoints against a real database and reading the rows that come back.
 *
 * ── WHY A LIVE MATRIX AND NOT MORE SOURCE ASSERTIONS ──────────────────────
 *
 * Because the defect this closes was invisible to source assertions twice. The
 * surfaces all imported a correctly-named predicate; what differed was WHICH
 * predicate, and in one case whether a join was INNER - a detail no amount of
 * "does this file mention the filter" could see. The only honest question is
 * what the endpoint returns, so that is what this asks.
 *
 * Every row of the matrix carries its own positive control: the state is set,
 * the surface is read, the state is restored, and the surface is read again.
 * A negative that passes because the fixture never existed proves nothing.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
await assertBuild(BASE);
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`,
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const query = async (path, input) => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`);
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    data: body?.result?.data?.json ?? null,
    code: body?.error?.json?.data?.code ?? null,
    message: body?.error?.json?.message ?? null,
  };
};

const stamp = Date.now() % 100000000;
const made = { users: [], products: [], placements: [] };
const esc = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const CAT = 'Materials';
/* The canonical taxonomy id, because `categoryUsage` groups by `categoryId`.
   The first version of this probe set only the legacy `category` TEXT, so the
   fixture contributed to no category at all and every category-count check
   compared null to null and "passed" by reading nothing. */
const CAT_ID = Number(sql(`select id from productCategories where nameEn=${"'" + 'Materials' + "'"} limit 1`));
if (!Number.isInteger(CAT_ID) || CAT_ID <= 0) throw new Error('probe setup: no canonical Materials category');

function mkSupplier(suffix, over = {}) {
  const u = `pm${stamp}${suffix}`;
  const row = {
    openId: `probe-${u}`, username: u, email: `${u}@example.test`,
    name: `Matrix Co ${suffix}`, userRole: 'supplier',
    onboardingStatus: 'approved', accountStatus: 'active',
    isDummy: 0, deactivatedAt: null, verified: 1, ...over,
  };
  sql(`insert into users (${Object.keys(row).join(',')}) values (${Object.values(row).map(esc).join(',')})`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (!Number.isInteger(id) || id <= 0 || sql(`select username from users where id=${id}`) !== u) {
    throw new Error(`probe setup: ${u} resolved to id ${id}`);
  }
  made.users.push(id);
  return id;
}

/** `status` is the authority; `active` is the derived legacy boolean. */
function mkProduct(supplierId, name, status = 'active', featured = 0) {
  sql(`insert into products (supplierId, name, category, categoryId, price, currency, unit, status, active, featured)
       values (${supplierId}, ${esc(name)}, ${esc(CAT)}, ${CAT_ID}, '4200.00', 'EGP', 'bag',
               ${esc(status)}, ${status === 'active' ? 1 : 0}, ${featured})`);
  const id = Number(sql(`select id from products where name=${esc(name)}`));
  made.products.push(id);
  return id;
}

function book(productId) {
  const row = {
    vendorId: null, productId, category: CAT, kind: 'sponsored',
    source: 'PAID_SPONSORSHIP', package: 'PREMIER',
    surface: 'TYPE_CATEGORY_SPOTLIGHT', entityType: 'PRODUCT', priority: 0,
    startsAt: '2020-01-01 00:00:00', endsAt: null, revokedAt: null,
  };
  sql(`insert into vendorSponsorships (${Object.keys(row).join(',')}) values (${Object.values(row).map(esc).join(',')})`);
  const id = Number(sql(`select max(id) from vendorSponsorships`));
  made.placements.push(id);
  return id;
}

/** Every public surface, for one product id, in one pass. */
async function surfaces(productId, supplierId) {
  const [list, search, byVendor, detail, featured, sponsored, stats, cats, showcase] = await Promise.all([
    query('marketplace.list', { category: CAT, limit: 100 }),
    /* THE STAMP ALONE. `containsTerm` builds a contiguous `%term%`, so
       "Matrix <stamp>" cannot match "Matrix Cement <stamp>" - the first
       version of this probe searched for a string the fixture never contained
       and reported the product missing from search on every row. */
    query('marketplace.list', { search: String(stamp), limit: 100 }),
    query('marketplace.vendorProducts', { vendorId: supplierId, limit: 60 }),
    query('marketplace.get', { id: productId }),
    query('marketplace.featuredProducts', { category: CAT }),
    query('marketplace.spotlightProducts', { category: CAT }),
    query('marketplace.platformStats', undefined),
    query('marketplace.categories', { view: 'public', withCounts: true }),
    query('vendorProfile.showcase', { userId: supplierId }),
  ]);
  const has = r => Array.isArray(r.data) && r.data.some(x => Number(x?.id) === productId);
  /* `{ categories: [...] }`, not a bare array - the first version tested
     Array.isArray on the envelope, so catRow was always null and three
     category-count assertions compared null to null. */
  const catList = Array.isArray(cats.data?.categories) ? cats.data.categories : [];
  const catRow = catList.find(c => Number(c?.id) === CAT_ID) ?? null;
  /*
   * THE PUBLIC PRODUCT TOTAL, COUNTED THE WAY THE ENDPOINT COUNTS IT.
   *
   * `marketplace.platformStats` caches for 60 seconds on purpose - it is
   * public and unauthenticated - and exposes no HTTP reset. Reading it after
   * each state change returns the same cached number, so the first version of
   * this probe reported a count that "never dropped" and blamed the product.
   *
   * So the per-row count assertions use SQL with the canonical predicate, and
   * the endpoint is checked ONCE against that same SQL below. That proves what
   * §18 actually asks - counts and rows share one authority - without
   * pretending the cache is not there. The cache does mean the headline number
   * can lag a suspension by up to a minute; that is the existing design of a
   * public endpoint, not a disagreement about the rule.
   */
  const liveCount = Number(sql(`
    select count(*) from products
    where products.status = 'active'
      and products.supplierId in (
        select id from users
        where userRole in ('supplier','contractor','engineer','architect','project_manager')
          and accountStatus = 'active' and deactivatedAt is null
          and onboardingStatus = 'approved' and isDummy = 0)`));
  return {
    list: has(list), search: has(search), byVendor: has(byVendor),
    detail: detail.data !== null && Number(detail.data?.id) === productId,
    detailCode: detail.code,
    featured: has(featured), sponsored: has(sponsored),
    showcase: Array.isArray(showcase.data)
      && showcase.data.some(c => Number(c?.id) === productId && c?.kind === 'product'),
    productCount: liveCount,
    endpointCount: Number(stats.data?.publicProducts ?? -1),
    categoryCount: catRow ? Number(catRow.listedProducts ?? -1) : null,
  };
}

const row = (label, s) =>
  `${label}: list=${s.list} search=${s.search} vendor=${s.byVendor} detail=${s.detail}`
  + ` featured=${s.featured} sponsored=${s.sponsored} count=${s.productCount}`;

try {
  /* ══ THE FIXTURE ══════════════════════════════════════════════════════
     One seller, one product that is Featured AND Sponsored at once, so each
     row of the matrix reads all three surfaces off the same object and they
     cannot disagree by accident. */
  const seller = mkSupplier('a');
  const productId = mkProduct(seller, `Matrix Cement ${stamp}`, 'active', 1);
  book(productId);

  /* ── ROW 1: eligible product, eligible seller → everywhere ─────────── */
  const base = await surfaces(productId, seller);
  check('1. eligible + eligible: public catalogue', base.list, row('', base));
  check('1. eligible + eligible: search', base.search);
  check('1. eligible + eligible: public vendor products', base.byVendor);
  check('1. eligible + eligible: product detail', base.detail);
  check('1. eligible + eligible: Featured', base.featured);
  check('1. eligible + eligible: Sponsored', base.sponsored);
  check('1. eligible + eligible: counted in the public product total',
    base.productCount > 0, `canonical count=${base.productCount}`);

  /*
   * §18, AND THE CACHE IS PART OF THE TRUTH HERE.
   *
   * `marketplace.platformStats` caches for 60 seconds - deliberately, because
   * it is public and unauthenticated - and exposes no HTTP reset. So the
   * endpoint and a count taken right now legitimately disagree for up to a
   * minute after any change, and an earlier version of this check compared
   * them immediately and reported `endpoint=29 canonical=30`: the rule was
   * right and the clock was wrong.
   *
   * Polling past the cache window makes it deterministic and keeps the real
   * behaviour on the record rather than hidden behind a retry. What is being
   * proved is that the endpoint counts with the SAME authority as the rows -
   * eventually, within its stated staleness - not that it is instantaneous.
   */
  let endpointCount = base.endpointCount;
  const deadline = Date.now() + 75_000;
  while (endpointCount !== base.productCount && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000));
    const again = await query('marketplace.platformStats', undefined);
    endpointCount = Number(again.data?.publicProducts ?? -1);
  }
  check('1. §18 the public endpoint counts with the SAME authority as the rows',
    endpointCount === base.productCount,
    `endpoint=${endpointCount} canonical=${base.productCount} (60s cache)`);
  const baseCount = base.productCount;
  const baseCatCount = base.categoryCount;

  /* ── ROW 2: OFF-SALE product, eligible seller → nowhere ────────────── */
  sql(`update products set status='inactive', active=0 where id=${productId}`);
  const offSale = await surfaces(productId, seller);
  check('2. off-sale + eligible: absent from the catalogue', !offSale.list, row('', offSale));
  check('2. off-sale + eligible: absent from search', !offSale.search);
  check('2. off-sale + eligible: absent from public vendor products', !offSale.byVendor);
  check('2. off-sale + eligible: detail is the canonical NOT_FOUND',
    !offSale.detail && offSale.detailCode === 'NOT_FOUND', String(offSale.detailCode));
  check('2. off-sale + eligible: absent from Featured', !offSale.featured);
  check('2. off-sale + eligible: absent from Sponsored', !offSale.sponsored);
  check('2. off-sale + eligible: the public count dropped by exactly one',
    offSale.productCount === baseCount - 1, `${baseCount} -> ${offSale.productCount}`);
  sql(`update products set status='active', active=1 where id=${productId}`);

  /* ── ROWS 3-5: eligible product, seller ineligible three ways ──────── */
  const ineligible = [
    ['3. suspended', `update users set accountStatus='frozen', frozenAt=now() where id=${seller}`,
      `update users set accountStatus='active', frozenAt=null where id=${seller}`],
    ['4. deactivated', `update users set deactivatedAt=now() where id=${seller}`,
      `update users set deactivatedAt=null where id=${seller}`],
    ['5. unapproved', `update users set onboardingStatus='rejected' where id=${seller}`,
      `update users set onboardingStatus='approved' where id=${seller}`],
  ];
  for (const [label, apply, undo] of ineligible) {
    sql(apply);
    const s = await surfaces(productId, seller);
    check(`${label}: the PRODUCT is still legitimately active`,
      sql(`select status from products where id=${productId}`) === 'active',
      'lifecycle untouched - §2');
    check(`${label}: absent from the public catalogue`, !s.list, row('', s));
    check(`${label}: absent from search`, !s.search);
    check(`${label}: absent from public vendor products`, !s.byVendor);
    check(`${label}: detail is the canonical NOT_FOUND`,
      !s.detail && s.detailCode === 'NOT_FOUND', String(s.detailCode));
    check(`${label}: absent from Featured`, !s.featured);
    check(`${label}: absent from Sponsored`, !s.sponsored);
    check(`${label}: the public count dropped by exactly one`,
      s.productCount === baseCount - 1, `${baseCount} -> ${s.productCount}`);
    check(`${label}: the public CATEGORY count dropped too - rows and counts agree`,
      s.categoryCount === baseCatCount - 1, `${baseCatCount} -> ${s.categoryCount}`);
    /* §13: no oracle. The refusal must not say which dimension failed. */
    const leak = `${s.detailCode ?? ''}`;
    check(`${label}: the refusal names no reason`,
      !/frozen|suspend|reject|deactivat|approv|seller|supplier/i.test(leak), leak);
    sql(undo);
  }

  /* ── ROW 6: RESTORED seller → back, with no lifecycle rewrite ──────── */
  const restored = await surfaces(productId, seller);
  check('6. restored seller: back in the public catalogue', restored.list, row('', restored));
  check('6. restored seller: back in search', restored.search);
  check('6. restored seller: back in public vendor products', restored.byVendor);
  check('6. restored seller: detail answers again', restored.detail);
  check('6. restored seller: Featured follows its own independent state',
    restored.featured && Number(sql(`select featured from products where id=${productId}`)) === 1);
  check('6. restored seller: Sponsored follows its own independent state',
    restored.sponsored && Number(sql(
      `select count(*) from vendorSponsorships where productId=${productId} and revokedAt is null`)) === 1);
  check('6. restored seller: the count is back where it started',
    restored.productCount === baseCount, `${restored.productCount} vs ${baseCount}`);
  check('6. AND NOTHING REWROTE THE PRODUCT TO GET HERE - §2, §11',
    sql(`select concat(status,'/',active,'/',ifnull(archivedAt,'-')) from products where id=${productId}`)
      === 'active/1/-',
    sql(`select concat(status,'/',active,'/',ifnull(archivedAt,'-')) from products where id=${productId}`));

  /* ── THE SUBSET INVARIANT, MEASURED - §10 ─────────────────────────────
     Sponsored ⊆ eligible and Featured ⊆ eligible. Asserted over the real
     catalogue rather than over the fixture, so a promoted row that the
     catalogue does not carry shows up whoever put it there. */
  {
    const [list, featured, sponsored] = await Promise.all([
      query('marketplace.list', { limit: 100 }),
      query('marketplace.featuredProducts', {}),
      query('marketplace.spotlightProducts', { category: CAT }),
    ]);
    const catalogue = new Set((list.data ?? []).map(p => Number(p.id)));
    const strays = kind => (kind.data ?? []).map(p => Number(p.id)).filter(id => !catalogue.has(id));
    check('§10 Featured is a SUBSET of public marketplace eligibility',
      strays(featured).length === 0, `strays: ${strays(featured).join(',') || 'none'}`);
    check('§10 Sponsored is a SUBSET of public marketplace eligibility',
      strays(sponsored).length === 0, `strays: ${strays(sponsored).join(',') || 'none'}`);
  }

  /* ── §12: TRANSACTIONAL HISTORY IS A DIFFERENT CONCERN ────────────────
     Proven structurally rather than by narrative: RFQ lines carry their own
     copy of everything and release the product on delete, quotation lines
     hold no product reference at all, and no quotation or RFQ read joins
     products. Suspending a seller therefore cannot reach them. */
  {
    const rfqItemCols = sql(`select group_concat(column_name order by ordinal_position)
      from information_schema.columns where table_schema='${DB}' and table_name='rfqItems'`);
    for (const col of ['name', 'quantity', 'unit', 'specifications', 'unitPriceSnapshot']) {
      check(`§12 rfqItems keeps its own ${col}, independent of the product`,
        rfqItemCols.includes(col), col);
    }
    const rfqRule = sql(`select DELETE_RULE from information_schema.REFERENTIAL_CONSTRAINTS
      where CONSTRAINT_SCHEMA='${DB}' and TABLE_NAME='rfqItems'
        and CONSTRAINT_NAME like '%productId%'`);
    check('§12 an RFQ line survives its product being removed', rfqRule === 'SET NULL', rfqRule);
    const quotationItemCols = sql(`select group_concat(column_name) from information_schema.columns
      where table_schema='${DB}' and table_name='quotationItems'`);
    check('§12 quotation lines hold no product reference at all',
      !/productId/i.test(quotationItemCols), quotationItemCols.slice(0, 80));
  }

  /* ── §14: NO MARKET ELIGIBILITY ENTERED PRODUCT DISCOVERY ─────────── */
  {
    const markets = sql(`show columns from products like 'market%'`);
    check('§14 product discovery gained no market dimension',
      markets === '', markets || 'no market column on products');
  }
} finally {
  for (const [table, ids] of [
    ['vendorSponsorships', made.placements],
    ['products', made.products],
    ['users', made.users],
  ]) {
    if (ids.length === 0) continue;
    try {
      sql(`delete from ${table} where id in (${ids.join(',')})`);
      const left = Number(sql(`select count(*) from ${table} where id in (${ids.join(',')})`));
      if (left > 0) console.log(`CLEANUP  ${table} left ${left} rows behind`);
    } catch (e) { console.log(`CLEANUP  ${table} failed: ${String(e).slice(0, 140)}`); }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

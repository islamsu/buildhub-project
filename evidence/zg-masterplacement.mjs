// ── LIVE: Master Discovery, against a real MariaDB and a real HTTP server ──
//
// The unit tests drive the query builder against a fake driver. That proves the
// WHERE clause is built; it cannot prove the schema has the columns, that the
// SQL is valid MariaDB, or that an expired placement really stops appearing
// when the clock passes it. Four of those five facts were false when this file
// was written - migrations 0037-0040 had never applied anywhere - and only a
// live probe could have said so.
//
// Every positive control asserts the DATABASE, and every negative control is a
// row that EXISTS and must still not be rendered.
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

const query = async (path, input) => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json ?? null, error: body?.error?.json?.message ?? null };
};

const stamp = Date.now() % 100000000;
const made = { users: [], products: [], placements: [] };

const mkProvider = (suffix, over = {}) => {
  const u = `mp${stamp}${suffix}`;
  const row = {
    // `openId` is NOT NULL with no default - the identity key every account
    // carries. Omitting it made the insert fail, which the probe reported as
    // its own failure rather than as a platform defect. That is the correct
    // direction: a probe that cannot set up is a broken probe, not a finding.
    openId: `probe-${u}`,
    username: u, email: `${u}@example.test`, name: `Master Co ${suffix}`,
    userRole: 'contractor', onboardingStatus: 'approved', accountStatus: 'active',
    isDummy: 0, deactivatedAt: null, ...over,
  };
  const cols = Object.keys(row).join(',');
  const vals = Object.values(row).map(v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`).join(',');
  sql(`insert into users (${cols}) values (${vals})`);
  const id = Number(sql(`select id from users where username='${u}'`));
  // Verify the instrument: a lookup that silently returns the wrong row would
  // have the probe mutating - and later deleting - somebody else's account.
  const back = sql(`select username from users where id=${id}`);
  if (!Number.isInteger(id) || id <= 0 || back !== u) {
    throw new Error(`probe setup: created user ${u} but id ${id} holds "${back}"`);
  }
  made.users.push(id);
  return id;
};

const book = (over = {}) => {
  const row = {
    vendorId: null, productId: null, category: 'GLOBAL', kind: 'sponsored',
    source: 'PAID_SPONSORSHIP', package: 'PREMIER', surface: 'MASTER_DISCOVERY',
    entityType: 'PROVIDER', priority: 0,
    startsAt: '2020-01-01 00:00:00', endsAt: null, revokedAt: null, ...over,
  };
  const cols = Object.keys(row).join(',');
  const vals = Object.values(row).map(v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`).join(',');
  sql(`insert into vendorSponsorships (${cols}) values (${vals})`);
  const id = Number(sql(`select last_insert_id()`));
  made.placements.push(id);
  return id;
};

try {
  // A PREVIOUS RUN THAT DIED MID-WAY LEAVES ROWS, and the empty-state check
  // below would then see a stale advertiser and report a defect that is really
  // this probe's own litter. Purge the probe's own namespace first - matched on
  // the `mp`/`Probe Rebar` prefixes, so nothing outside it is touched.
  sql(`delete from vendorSponsorships where vendorId in (select id from users where username like 'mp%')
       or productId in (select id from products where name like 'Probe Rebar %')`);
  sql(`delete from products where name like 'Probe Rebar %'`);
  sql(`delete from users where username like 'mp%'`);

  // ── SETUP, asserted rather than assumed ────────────────────────────────
  const cols = sql(`select group_concat(column_name) from information_schema.columns
                    where table_schema='${DB}' and table_name='vendorSponsorships'`);
  check('SETUP: the placement columns exist in the real schema',
    ['source', 'package', 'surface', 'entityType', 'productId'].every(c => cols.includes(c)), cols);

  const before = await query('marketplace.masterProvider', {});
  check('EMPTY STATE: no booking returns null, not an error and not a placeholder',
    before.status === 200 && before.data === null, `status=${before.status} data=${JSON.stringify(before.data)}`);

  // ── POSITIVE: a live, eligible, paid Master provider renders ───────────
  const winner = mkProvider('a');
  book({ vendorId: winner });
  const live = await query('marketplace.masterProvider', {});
  check('POSITIVE: a live paid Master provider is returned',
    live.data?.id === winner, `got=${live.data?.id} want=${winner}`);
  check('POSITIVE: a paid source is labelled SPONSORED',
    live.data?.label === 'SPONSORED', String(live.data?.label));
  check('POSITIVE: the card carries the vendor real name from the users row',
    live.data?.name === `Master Co a`, String(live.data?.name));

  // No fabricated reputation: this account has no verified reviews.
  check('NO FABRICATION: a provider with no reviews has a null rating, not a number',
    live.data?.averageRating === null && live.data?.reviewCount === 0,
    `rating=${live.data?.averageRating} count=${live.data?.reviewCount}`);
  check('NO LEAK: the public payload carries no commercial record',
    live.data != null && !('grantedBy' in live.data) && !('grantedReason' in live.data)
      && !('startsAt' in live.data) && !('endsAt' in live.data) && !('priority' in live.data),
    Object.keys(live.data ?? {}).join(','));

  // ── NEGATIVE: the row exists and is still not rendered ─────────────────
  sql(`update users set accountStatus='frozen' where id=${winner}`);
  const suspended = await query('marketplace.masterProvider', {});
  check('NEGATIVE: a SUSPENDED provider disappears though the paid booking is live',
    suspended.data === null, JSON.stringify(suspended.data));
  sql(`update users set accountStatus='active' where id=${winner}`);

  sql(`update users set onboardingStatus='under_review' where id=${winner}`);
  const unapproved = await query('marketplace.masterProvider', {});
  check('NEGATIVE: an UNDER_REVIEW (unapproved) provider does not render',
    unapproved.data === null, JSON.stringify(unapproved.data));
  sql(`update users set onboardingStatus='approved' where id=${winner}`);

  sql(`update users set deactivatedAt=now() where id=${winner}`);
  const deactivated = await query('marketplace.masterProvider', {});
  check('NEGATIVE: a DEACTIVATED provider does not render',
    deactivated.data === null, JSON.stringify(deactivated.data));
  sql(`update users set deactivatedAt=null where id=${winner}`);

  // Back to visible, so the next negatives are about the placement itself.
  const restored = await query('marketplace.masterProvider', {});
  check('CONTROL: restoring eligibility brings the same provider back',
    restored.data?.id === winner, `got=${restored.data?.id}`);

  // ── TIME: scheduled, expired, revoked ──────────────────────────────────
  sql(`update vendorSponsorships set revokedAt=now() where vendorId=${winner}`);
  const revoked = await query('marketplace.masterProvider', {});
  check('TIME: a REVOKED placement stops rendering immediately',
    revoked.data === null, JSON.stringify(revoked.data));
  sql(`update vendorSponsorships set revokedAt=null where vendorId=${winner}`);

  sql(`update vendorSponsorships set endsAt='2021-01-01 00:00:00' where vendorId=${winner}`);
  const expired = await query('marketplace.masterProvider', {});
  check('TIME: an EXPIRED placement stops rendering with nothing having to sweep it',
    expired.data === null, JSON.stringify(expired.data));

  sql(`update vendorSponsorships set endsAt=null, startsAt='2037-01-01 00:00:00' where vendorId=${winner}`);
  const scheduled = await query('marketplace.masterProvider', {});
  check('TIME: a SCHEDULED placement is not visible early',
    scheduled.data === null, JSON.stringify(scheduled.data));
  sql(`update vendorSponsorships set startsAt='2020-01-01 00:00:00' where vendorId=${winner}`);

  // ── SCOPE: relevance is not for sale ───────────────────────────────────
  const lighting = mkProvider('b');
  book({ vendorId: lighting, category: 'Lighting' });

  const inLighting = await query('marketplace.masterProvider', { category: 'Lighting' });
  check('SCOPE: the Lighting Master appears under Lighting',
    inLighting.data?.id === lighting, `got=${inLighting.data?.id} want=${lighting}`);

  const inTiles = await query('marketplace.masterProvider', { category: 'Tiles' });
  check('SCOPE: the Lighting Master does NOT appear under Tiles',
    inTiles.data === null, JSON.stringify(inTiles.data));

  const globalSlot = await query('marketplace.masterProvider', {});
  check('SCOPE: a category Master does not fill the platform-wide slot',
    globalSlot.data?.id === winner, `got=${globalSlot.data?.id} want=${winner}`);
  check('SCOPE: the platform-wide Master does not leak into a category view',
    inLighting.data?.id !== winner, `lighting=${inLighting.data?.id} global=${winner}`);

  // ── CAPACITY: one is one ───────────────────────────────────────────────
  const second = mkProvider('c');
  book({ vendorId: second, priority: 5 });
  const contested = await query('marketplace.masterProvider', {});
  check('CAPACITY: two live global Masters still yield exactly ONE rendered provider',
    contested.data?.id === winner, `got=${contested.data?.id} want=${winner} (lower priority wins)`);

  // ── LABEL: source decides the word ─────────────────────────────────────
  sql(`update vendorSponsorships set source='REFERRAL_REWARD' where vendorId=${winner}`);
  const referral = await query('marketplace.masterProvider', {});
  check('LABEL: a referral reward is FEATURED, never Sponsored',
    referral.data?.label === 'FEATURED', String(referral.data?.label));

  sql(`update vendorSponsorships set source='ADMIN_EDITORIAL' where vendorId=${winner}`);
  const editorial = await query('marketplace.masterProvider', {});
  check('LABEL: an editorial pick is FEATURED',
    editorial.data?.label === 'FEATURED', String(editorial.data?.label));

  sql(`update vendorSponsorships set source='PAID_SPONSORSHIP' where vendorId=${winner}`);
  const paid = await query('marketplace.masterProvider', {});
  check('LABEL: paid placement is SPONSORED',
    paid.data?.label === 'SPONSORED', String(paid.data?.label));

  // ── PRODUCTS: the same rules, on the other entity type ─────────────────
  const supplier = mkProvider('d', { userRole: 'supplier' });
  sql(`insert into products (supplierId, name, category, price, currency, unit, active)
       values (${supplier}, 'Probe Rebar ${stamp}', 'Materials', '18500.00', 'EGP', 'tonne', 1)`);
  const productId = Number(sql(`select id from products where name='Probe Rebar ${stamp}'`));
  made.products.push(productId);
  book({ entityType: 'PRODUCT', productId, vendorId: null });

  const liveProduct = await query('marketplace.masterProduct', {});
  check('PRODUCT POSITIVE: a live Master product is returned',
    liveProduct.data?.id === productId, `got=${liveProduct.data?.id} want=${productId}`);
  check('PRODUCT POSITIVE: the card names the real seller',
    liveProduct.data?.supplierName === 'Master Co d', String(liveProduct.data?.supplierName));
  check('PRODUCT POSITIVE: the real catalogue price travels, not a placeholder',
    liveProduct.data?.price === '18500.00' && liveProduct.data?.unit === 'tonne',
    `${liveProduct.data?.price} / ${liveProduct.data?.unit}`);

  sql(`update products set active=0 where id=${productId}`);
  const delisted = await query('marketplace.masterProduct', {});
  check('PRODUCT NEGATIVE: a DELISTED product does not render though the booking is live',
    delisted.data === null, JSON.stringify(delisted.data));
  sql(`update products set active=1 where id=${productId}`);

  // The gate this join exists for: the product is fine, the SELLER is not.
  sql(`update users set accountStatus='frozen' where id=${supplier}`);
  const badSeller = await query('marketplace.masterProduct', {});
  check('PRODUCT NEGATIVE: an active product of a SUSPENDED supplier does not render',
    badSeller.data === null, JSON.stringify(badSeller.data));
  sql(`update users set accountStatus='active' where id=${supplier}`);

  const backAgain = await query('marketplace.masterProduct', {});
  check('PRODUCT CONTROL: restoring the supplier brings the product back',
    backAgain.data?.id === productId, `got=${backAgain.data?.id}`);

  // ── ENTITY TYPE ISOLATION ──────────────────────────────────────────────
  check('ISOLATION: the provider slot never returns a product',
    (await query('marketplace.masterProvider', {})).data?.id === winner, 'provider slot unchanged');
  const productCategory = await query('marketplace.masterProduct', { category: 'Lighting' });
  check('ISOLATION: a PROVIDER booking in Lighting does not fill the PRODUCT slot',
    productCategory.data === null, JSON.stringify(productCategory.data));

} catch (error) {
  check('THE PROBE ITSELF RAN TO COMPLETION', false, String(error && error.message).slice(0, 200));
} finally {
  // Clean up in FK-safe order, matching on THIS RUN's prefix rather than on
  // remembered ids - and never letting a cleanup problem throw away the
  // results the probe just produced. A cleanup failure is reported as itself.
  const tidy = (label, statement) => {
    try { sql(statement); } catch (error) {
      results.push(`CLEANUP  ${label} left rows behind: ${String(error && error.message).slice(0, 120)}`);
    }
  };
  tidy('placements', `delete from vendorSponsorships where vendorId in
      (select id from users where username like 'mp${stamp}%')
      or productId in (select id from products where name like 'Probe Rebar ${stamp}%')`);
  tidy('products', `delete from products where name like 'Probe Rebar ${stamp}%'`);
  tidy('users', `delete from users where username like 'mp${stamp}%'`);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

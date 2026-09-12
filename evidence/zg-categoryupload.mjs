// ── LIVE: the canonical category taxonomy, against a real MariaDB and a real
//    HTTP server ─────────────────────────────────────────────────────────────
//
// THE REPORTED FAILURE. Bulk Product Upload refused "Waterproofing" and
// "Pools" across dozens of rows of a real supplier catalogue. Root-causing it
// found something larger than the report: FOUR unrelated category vocabularies,
// none of them administrable, and one of them - the marketplace filter - OFFERED
// "Waterproofing" and "Pools" while the write path validated against a different
// list of nineteen that did not contain them. The product was telling the
// supplier two different things about itself.
//
// WHY THIS FILE EXISTS AND server/categoryService.test.ts DOES NOT SUFFICE.
// The unit suite drives the resolver against an index built from the seed. That
// proves the matching rules. It cannot prove that the migration applied, that
// the seed reached a real database, that `products.categoryId` accepts the
// value, that the FK holds, or that a status change made in the database is
// visible to the next upload WITHOUT A DEPLOYMENT - which is the whole claim of
// "one canonical taxonomy". Every positive control below asserts the DATABASE.
//
// Every negative control is a value that EXISTS somewhere and must still be
// refused: a near-miss spelling that must not be fuzzily accepted, a hidden
// category that must be named as hidden rather than as unknown, a genuinely
// ambiguous name that must be refused rather than guessed, and a categoryId
// column smuggled into the file that must not be able to choose the category.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

/**
 * One SQL statement, collapsed to a single line first: a multi-line -e argument
 * makes the MariaDB client print a "PAGER set to stdout" banner ahead of the
 * result, which silently turns every Number(sql(...)) into NaN.
 */
const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`,
).toString()
  .split('\n')
  .filter(line => !/^PAGER set to/.test(line))
  .join('\n')
  .trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const query = async (path, input, cookie) => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json ?? null, error: body?.error?.json?.message ?? null };
};

const mutate = async (path, input, cookie) => {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    data: body?.result?.data?.json ?? null,
    error: body?.error?.json?.message ?? null,
    cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; '),
  };
};

const stamp = Date.now() % 100000000;
const made = { users: [], categories: [], aliases: [] };

/**
 * A supplier created through the REAL signup path, then approved.
 *
 * Not inserted straight into `users`: the account has to carry whatever signup
 * actually writes, or the probe proves the taxonomy works for an account shape
 * the product never produces. Approval is the one step done in SQL, because
 * compliance approval is a different subsystem and not what is under test.
 */
async function supplier(suffix) {
  const username = `cat${stamp}${suffix}`;
  const signed = await mutate('auth.signUp', {
    username, email: `${username}@example.test`, password: 'ProbeSupplier!2024',
    name: `Category Probe ${suffix}`, userRole: 'supplier',
  });
  if (signed.status !== 200) throw new Error(`probe setup: signUp failed (${signed.status}) ${signed.error}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  // Verify the instrument. A lookup returning the wrong row would have the
  // probe reading - and later deleting - somebody else's catalogue.
  const back = sql(`select username from users where id=${id}`);
  if (!Number.isInteger(id) || id <= 0 || back !== username) {
    throw new Error(`probe setup: created ${username} but id ${id} holds "${back}"`);
  }
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  made.users.push(id);
  return { id, username, cookie: signed.cookie };
}

const csv = rows => ['name,nameAr,category,brand,price,stock,unit,deliveryDays,description', ...rows].join('\n') + '\n';

const upload = (cookie, text, dryRun = false) => mutate('marketplace.importProducts', { csv: text, dryRun }, cookie);

/** Products this probe's suppliers own, by category id. Never a global count. */
const owned = ids => Number(sql(`select count(*) from products where supplierId in (${ids.join(',')})`));

// ── run ────────────────────────────────────────────────────────────────────
const WATERPROOFING = Number(sql(`select id from productCategories where slug='waterproofing'`));
const POOLS = Number(sql(`select id from productCategories where slug='pools'`));
const MARBLE = Number(sql(`select id from productCategories where slug='marble'`));
const GRANITE = Number(sql(`select id from productCategories where slug='granite'`));

check('the taxonomy reached the real database',
  [WATERPROOFING, POOLS, MARBLE, GRANITE].every(id => Number.isInteger(id) && id > 0),
  `waterproofing=${WATERPROOFING} pools=${POOLS} marble=${MARBLE} granite=${GRANITE}`);
check('"Pools" is an ALIAS of a canonically-named category, not a duplicate row',
  sql(`select c.nameEn from productCategoryAliases a join productCategories c on c.id=a.categoryId where a.normalized='pools'`) === 'Swimming Pool Equipment');

const A = await supplier('a');
const B = await supplier('b');

// ── 1. THE REPORTED CASE, dry run ──────────────────────────────────────────
// Four spellings a real spreadsheet contains: the canonical name, the alias,
// a lowercase cell, and one with the whitespace Excel leaves behind.
const reported = csv([
  `Bitumen Membrane 4mm ${stamp},لفائف بيتومين,Waterproofing,Sika,850,40,roll,5,SBS modified`,
  `Pool Pump 1.5HP ${stamp},مضخة حمام سباحة,Pools,Hayward,12500,8,piece,10,`,
  `Cementitious Slurry ${stamp},مونة عزل أسمنتية,waterproofing,Fosroc,600,120,bag,3,`,
  `Pool Chlorinator ${stamp},جهاز كلور,"  Pools  ",Astral,9800,5,piece,14,`,
]);
const preview = await upload(A.cookie, reported, true);
check('REPORTED CASE: the dry run accepts Waterproofing and Pools',
  preview.status === 200 && preview.data?.errorCount === 0,
  `status=${preview.status} errorCount=${preview.data?.errorCount} first=${preview.data?.errors?.[0]?.message ?? ''}`);
check('REPORTED CASE: all four rows parsed', preview.data?.totalRows === 4, `${preview.data?.totalRows}`);
check('REPORTED CASE: no category issues to group', (preview.data?.categoryIssues ?? []).length === 0);
const resolvedMap = new Map((preview.data?.resolvedCategories ?? []).map(r => [r.supplied, r.resolved]));
check('the preview shows "Pools" resolving to its canonical name BEFORE anything is written',
  resolvedMap.get('Pools') === 'Swimming Pool Equipment', JSON.stringify([...resolvedMap]));
check('the preview shows Waterproofing resolving to itself',
  resolvedMap.get('Waterproofing') === 'Waterproofing');
check('a dry run writes nothing', preview.data?.imported === 0 && owned([A.id]) === 0);

// ── 2. THE REPORTED CASE, committed ────────────────────────────────────────
const committed = await upload(A.cookie, reported, false);
check('REPORTED CASE: the import commits', committed.status === 200 && committed.data?.imported === 4,
  `status=${committed.status} imported=${committed.data?.imported} err=${committed.error ?? ''}`);
check('DATABASE: four products persisted for this supplier', owned([A.id]) === 4);
check('DATABASE: the Waterproofing rows carry the canonical id, not free text',
  Number(sql(`select count(*) from products where supplierId=${A.id} and categoryId=${WATERPROOFING} and category='Waterproofing'`)) === 2);
check('DATABASE: a row typed as "Pools" is stored under Swimming Pool Equipment',
  Number(sql(`select count(*) from products where supplierId=${A.id} and categoryId=${POOLS} and category='Swimming Pool Equipment'`)) === 2);
check('DATABASE: no imported row was left without a category link',
  Number(sql(`select count(*) from products where supplierId=${A.id} and categoryId is null`)) === 0);

// ── 3. SINGLE-PRODUCT PARITY, the standing invariant ───────────────────────
// The two write paths must reach the SAME stored result for the same input.
// This is the invariant that, once broken, produced the reported failure.
const single = await mutate('marketplace.create', {
  name: `Single Waterproofing ${stamp}`, category: 'Waterproofing', price: 900, unit: 'roll',
}, A.cookie);
check('PARITY: single product listing accepts Waterproofing', single.status === 200, single.error ?? '');
const singlePools = await mutate('marketplace.create', {
  name: `Single Pools ${stamp}`, category: 'Pools', price: 4200, unit: 'piece',
}, A.cookie);
check('PARITY: single product listing accepts the alias "Pools"', singlePools.status === 200, singlePools.error ?? '');
check('PARITY: the single-product path stores exactly what bulk stored',
  sql(`select concat(categoryId,'|',category) from products where id=${singlePools.data?.id}`) === `${POOLS}|Swimming Pool Equipment`,
  sql(`select concat(categoryId,'|',category) from products where id=${singlePools.data?.id ?? 0}`));

// ── 3b. THE EDIT PATH IS THE THIRD WRITE PATH ─────────────────────────────
// Add and Bulk were reconciled; Edit was still free text with no resolution and
// never touched `categoryId`. A product created as Waterproofing could be
// edited to any string at all while its link still pointed at Waterproofing -
// the row saying two different things about itself, which is the reported
// defect reached through a different door.
const editable = single.data?.id;
const moved = await mutate('marketplace.updateProduct', { id: editable, category: 'Pools' }, A.cookie);
check('EDIT: changing a category resolves through the same resolver', moved.status === 200, moved.error ?? '');
check('EDIT: and the LINK moves with the name, never left behind',
  sql(`select concat(categoryId,'|',category) from products where id=${editable}`) === `${POOLS}|Swimming Pool Equipment`,
  sql(`select concat(categoryId,'|',category) from products where id=${editable}`));
const badEdit = await mutate('marketplace.updateProduct', { id: editable, category: 'Not A Category At All' }, A.cookie);
check('EDIT: free text is refused rather than stored', badEdit.status !== 200, `status=${badEdit.status}`);
check('EDIT: and the refused edit left the row exactly as it was',
  sql(`select concat(categoryId,'|',category) from products where id=${editable}`) === `${POOLS}|Swimming Pool Equipment`);

// ── 4. NEGATIVE: a near miss must NOT be fuzzily accepted ──────────────────
const typo = await upload(A.cookie, csv([`Typo Row ${stamp},,Watrproofing,X,10,1,piece,2,`]), true);
check('NEGATIVE: "Watrproofing" is refused, not silently filed under Waterproofing',
  typo.data?.errorCount === 1 && typo.data?.categoryIssues?.[0]?.reason === 'UNKNOWN',
  `${typo.data?.categoryIssues?.[0]?.reason}`);
check('NEGATIVE: but the refusal OFFERS the near match for a person to choose',
  (typo.data?.categoryIssues?.[0]?.suggestions ?? []).includes('Waterproofing'),
  JSON.stringify(typo.data?.categoryIssues?.[0]?.suggestions ?? []));

// ── 5. NEGATIVE: hidden is not unknown, AND propagation without deployment ──
// The status change is made in the database and the very next upload must see
// it - no restart, no redeploy. That is the claim "one canonical taxonomy"
// makes, and it is only testable live.
sql(`update productCategories set status='hidden' where id=${WATERPROOFING}`);
const hidden = await upload(A.cookie, csv([`Hidden Row ${stamp},,Waterproofing,X,10,1,piece,2,`]), true);
sql(`update productCategories set status='active' where id=${WATERPROOFING}`);
const hiddenIssue = hidden.data?.categoryIssues?.[0];
check('PROPAGATION: hiding a category takes effect on the next upload, with no deployment',
  hidden.data?.errorCount === 1, `errorCount=${hidden.data?.errorCount}`);
check('ERROR QUALITY: a hidden category is reported as INACTIVE, not UNKNOWN',
  hiddenIssue?.reason === 'INACTIVE', `${hiddenIssue?.reason}`);
check('ERROR QUALITY: and the message does not send the supplier hunting for a typo',
  typeof hiddenIssue?.message === 'string'
  && hiddenIssue.message.includes('not currently available for new listings')
  && !hiddenIssue.message.includes('is not a BuildHub category'),
  hiddenIssue?.message ?? '');
check('PROPAGATION: reactivating restores it immediately',
  (await upload(A.cookie, csv([`Restored Row ${stamp},,Waterproofing,X,10,1,piece,2,`]), true)).data?.errorCount === 0);

// ── 6. PROPAGATION: a category added today is usable today ─────────────────
sql(`insert into productCategories (slug,nameEn,nameAr,scope,status,sortOrder) values ('zgprobe${stamp}','Probe Insulation ${stamp}','عزل تجريبي',' PRODUCT','active',900)`.replace("' PRODUCT'", "'PRODUCT'"));
const NEWCAT = Number(sql(`select id from productCategories where slug='zgprobe${stamp}'`));
made.categories.push(NEWCAT);
const fresh = await upload(B.cookie, csv([`Fresh Category Row ${stamp},,Probe Insulation ${stamp},X,10,1,piece,2,`]), false);
check('PROPAGATION: a category created in the taxonomy is listable against with no deployment',
  fresh.status === 200 && fresh.data?.imported === 1, `${fresh.status} ${fresh.error ?? ''} imported=${fresh.data?.imported}`);
check('DATABASE: and the product links to the new category row',
  Number(sql(`select count(*) from products where supplierId=${B.id} and categoryId=${NEWCAT}`)) === 1);

// ── 7. GROUPED ERRORS: fifty rows of one mistake is ONE problem ────────────
const many = csv(Array.from({ length: 30 }, (_, i) => `Bulk Bad ${stamp} ${i},,Watrproofing,X,10,1,piece,2,`));
const grouped = await upload(B.cookie, many, true);
check('a file with 30 identical category mistakes reports ONE grouped issue',
  (grouped.data?.categoryIssues ?? []).length === 1, `${(grouped.data?.categoryIssues ?? []).length}`);
check('and the grouped issue names every affected line',
  grouped.data?.categoryIssues?.[0]?.lines?.length === 30,
  `${grouped.data?.categoryIssues?.[0]?.lines?.length}`);
check('while the per-row errors are still there for an error export',
  grouped.data?.errorCount === 30, `${grouped.data?.errorCount}`);

// ── 8. VALIDATION FIRST: one bad row persists NOTHING ──────────────────────
const beforeMixed = owned([B.id]);
const mixed = await upload(B.cookie, csv([
  `Mixed Good A ${stamp},,Waterproofing,X,10,1,piece,2,`,
  `Mixed Good B ${stamp},,Pools,X,10,1,piece,2,`,
  `Mixed Bad ${stamp},,Watrproofing,X,10,1,piece,2,`,
]), false);
check('VALIDATION FIRST: a file with one bad row imports nothing at all',
  mixed.data?.imported === 0 && owned([B.id]) === beforeMixed,
  `imported=${mixed.data?.imported} count ${beforeMixed} -> ${owned([B.id])}`);

// ── 9. THE FILE CANNOT CHOOSE THE CATEGORY ────────────────────────────────
// A categoryId column in the upload must be inert. The category is decided by
// resolving the `category` cell server-side, never by a number the file names.
const smuggled = 'name,category,categoryId,unit\n'
  + `Smuggled ${stamp},Waterproofing,${POOLS},piece\n`;
const smuggledResult = await upload(B.cookie, smuggled, false);
check('a categoryId column in the file is ignored', smuggledResult.data?.imported === 1, smuggledResult.error ?? '');
check('SECURITY: the stored category follows the resolved name, not the file column',
  sql(`select categoryId from products where supplierId=${B.id} and name='Smuggled ${stamp}'`) === String(WATERPROOFING),
  `stored=${sql(`select categoryId from products where supplierId=${B.id} and name='Smuggled ${stamp}'`)} file said ${POOLS}`);

// ── 10. AMBIGUITY IS REFUSED, NEVER GUESSED ───────────────────────────────
// "Marble & Granite" was one string in the legacy list and is deliberately NOT
// registered as an alias: Marble and Granite are two real categories at two
// real price points, and picking one would file a supplier's stock wrongly
// without telling anybody.
const legacyPair = await upload(B.cookie, csv([`Slab ${stamp},,Marble & Granite,X,10,1,piece,2,`]), true);
check('the legacy "Marble & Granite" is refused rather than assigned to either',
  legacyPair.data?.errorCount === 1
  && sql(`select count(*) from products where supplierId=${B.id} and categoryId in (${MARBLE},${GRANITE})`) === '0',
  `${legacyPair.data?.categoryIssues?.[0]?.reason}`);

// A genuine collision, planted: an alias claiming a name another category
// already answers to. The resolver must refuse and say which two, rather than
// taking whichever row the database returned first.
sql(`insert into productCategoryAliases (categoryId,alias,normalized) values (${MARBLE},'Granite','granite')`);
made.aliases.push(sql(`select id from productCategoryAliases where normalized='granite'`));
const ambiguous = await upload(B.cookie, csv([`Ambiguous ${stamp},,Granite,X,10,1,piece,2,`]), true);
const ambiguousIssue = ambiguous.data?.categoryIssues?.[0];
check('AMBIGUOUS: two categories claiming one name is refused, not resolved by row order',
  ambiguousIssue?.reason === 'AMBIGUOUS', `${ambiguousIssue?.reason}`);
check('AMBIGUOUS: and the message names both candidates',
  typeof ambiguousIssue?.message === 'string'
  && ambiguousIssue.message.includes('Marble') && ambiguousIssue.message.includes('Granite'),
  ambiguousIssue?.message ?? '');
sql(`delete from productCategoryAliases where normalized='granite' and categoryId=${MARBLE}`);
made.aliases = [];
check('and removing the collision restores a clean resolution immediately',
  (await upload(B.cookie, csv([`Clean Granite ${stamp},,Granite,X,10,1,piece,2,`]), true)).data?.errorCount === 0);

// ── 11. THE BROWSE LIST AND THE WRITE PATH AGREE ──────────────────────────
// The latent defect that was larger than the report: the marketplace filter
// offered category names the write path had never heard of, so a shopper
// clicking one could never find a product - nothing could be listed under it.
const names = await query('marketplace.categoryNames');
const listable = await query('marketplace.categories', { view: 'listable' });
const listableNames = new Set((listable.data?.categories ?? []).map(c => c.nameEn));
check('the browse list is served from the taxonomy and is not empty',
  Array.isArray(names.data) && names.data.length >= 30, `${names.data?.length}`);
check('the browse list offers Waterproofing and Pools\' canonical name',
  names.data?.includes('Waterproofing') && names.data?.includes('Swimming Pool Equipment'));
check('EVERY name the browse filter offers is a name a supplier may list against',
  (names.data ?? []).every(name => listableNames.has(name)),
  (names.data ?? []).filter(name => !listableNames.has(name)).join(', ') || 'no orphans');

// ── cleanup, then prove the cleanup ───────────────────────────────────────
sql(`delete from products where supplierId in (${made.users.join(',')})`);
sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
sql(`delete from users where id in (${made.users.join(',')})`);
if (made.categories.length > 0) sql(`delete from productCategories where id in (${made.categories.join(',')})`);
check('CLEANUP: every row this probe planted is gone',
  owned(made.users) === 0
  && Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from productCategories where slug='zgprobe${stamp}'`)) === 0
  && Number(sql(`select count(*) from productCategoryAliases where normalized='granite'`)) === 0);
check('CLEANUP: the taxonomy is back exactly as it was found',
  Number(sql(`select count(*) from productCategories`)) === 35
  && sql(`select status from productCategories where id=${WATERPROOFING}`) === 'active');

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);

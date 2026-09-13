// ── LIVE: administering the taxonomy, against a real MariaDB and a real server ──
//
// zg-categoryupload.mjs proves the resolver is correct and zg-categoryui.mjs
// proves a supplier can read the result. This proves the OTHER half of the
// category mandate: that an administrator can change the taxonomy, that the
// change reaches suppliers with no deployment, that the wrong administrator
// cannot, and that none of it ever moves a product.
//
// THE LIFECYCLE IT WALKS, END TO END, WITH REAL SESSIONS:
//
//   a marketplace administrator creates a category
//     -> a supplier bulk-uploads into it immediately, no restart
//   the administrator hides it while products are in it
//     -> new listings are refused with the INACTIVE message
//     -> the existing products are UNTOUCHED - same categoryId, same name
//   the administrator reactivates it
//     -> listing works again, and nothing was recategorised in the meantime
//
// EVERY NEGATIVE CONTROL IS A REAL SESSION BEING REFUSED, never an absent one.
// A probe that "proves" a guard using an unauthenticated request has proved
// that sign-in works. Each attacker below signs in first, and the probe refuses
// to run the attack at all until that is confirmed.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';

/**
 * THE QUERY GOES IN ON STDIN, NOT AS -e.
 *
 * A scrypt hash looks like `scrypt$21d$...`, and execSync runs its command
 * through a shell: inside the double quotes an -e argument needs, `$21d`
 * expands to nothing. The seeded administrator then had a mangled hash, every
 * sign-in failed, and the probe aborted - correctly, because the alternative is
 * a suite of "ATTACK BLOCKED" passes that only prove nobody was signed in.
 */
const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

/** A signed-in HTTP session with its own cookie jar. */
function session(initialCookie = '') {
  let cookie = initialCookie;
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    const all = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of all) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, data: json?.result?.data?.json ?? null, error: json?.error?.json?.message ?? null };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i) };
}

const stamp = Date.now() % 100000000;
const made = { users: [], categories: [], aliases: [] };
const SLUG = `zgcat${stamp}`;

/** An administrator with a real, application-produced password hash. */
function makeAdmin(suffix, adminRole, passwordHash) {
  const u = `zgca${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe ${suffix}', 'admin',
        '${adminRole}', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${passwordHash}', now())`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (sql(`select username from users where id=${id}`) !== u) throw new Error(`probe setup: wrong row for ${u}`);
  made.users.push(id);
  return { id, username: u, email: `${u}@example.test` };
}

async function supplier() {
  const username = `zgcs${stamp}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeSupplier!2024',
      name: 'Taxonomy Probe Supplier', userRole: 'supplier',
    } }),
  });
  if (res.status !== 200) throw new Error(`probe setup: supplier signUp failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong supplier row');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  made.users.push(id);
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { id, session: session(cookie) };
}

const csv = rows => ['name,nameAr,category,brand,price,stock,unit,deliveryDays,description', ...rows].join('\n') + '\n';

try {
  /**
   * The hash of the BOOTSTRAP administrator specifically, not "any admin".
   *
   * An unpinned `limit 1` returns whichever admin row the engine felt like -
   * including one left behind by another probe, whose password is not the one
   * below. Every sign-in would then fail, and every "ATTACK BLOCKED" check
   * would pass on a 401 meaning "you are not signed in" rather than "the guard
   * refused you". This probe hit exactly that and aborted, which is the
   * behaviour to keep; pinning the row is the fix.
   */
  const hash = sql(`select passwordHash from users where username='superadmin' and role='admin'`);
  check('SETUP: an application-produced password hash is available to seed with',
    !!hash && hash.length > 20, hash ? `${hash.slice(0, 7)}…` : 'none');
  if (!hash) throw new Error('probe setup: no seedable hash');

  const marketAdmin = makeAdmin('mk', 'MARKETPLACE_ADMIN', hash);
  const supportAdmin = makeAdmin('sp', 'SUPPORT_ADMIN', hash);

  const admin = session();
  const signedIn = await admin.mutate('auth.adminSignIn', { identifier: marketAdmin.email, password: PASSWORD });
  const who = await admin.query('admin.me', undefined);
  check('SETUP: the marketplace administrator is genuinely signed in',
    signedIn.status === 200 && who.data?.adminRole === 'MARKETPLACE_ADMIN',
    `signIn=${signedIn.status} me=${who.data?.adminRole ?? who.error}`);
  // A negative control run against a session that does not exist proves that
  // sign-in works, not that a guard refused anybody.
  if (who.data?.adminRole !== 'MARKETPLACE_ADMIN') throw new Error('probe setup: attacker session not established');

  const vendor = await supplier();

  // ── RBAC: the wrong administrator, really signed in, is refused ─────────
  const support = session();
  const supportSignIn = await support.mutate('auth.adminSignIn', { identifier: supportAdmin.email, password: PASSWORD });
  const supportMe = await support.query('admin.me', undefined);
  check('SETUP: the support administrator is genuinely signed in too',
    supportSignIn.status === 200 && supportMe.data?.adminRole === 'SUPPORT_ADMIN',
    `${supportSignIn.status} ${supportMe.data?.adminRole ?? supportMe.error}`);
  if (supportMe.data?.adminRole !== 'SUPPORT_ADMIN') throw new Error('probe setup: support session not established');

  const supportRead = await support.query('admin.categories', undefined);
  // Asserted on the STATUS and on the absence of data, not on the wording. The
  // first version matched the message text and failed against a perfectly good
  // 403 that happens to say "You do not have required permission" - a probe
  // asserting a product's prose rather than its behaviour.
  check('RBAC: a SUPPORT_ADMIN cannot read the taxonomy administration view',
    supportRead.status === 403 && supportRead.data === null,
    `${supportRead.status} ${supportRead.error ?? ''}`);
  const supportWrite = await support.mutate('admin.createCategory', {
    slug: `${SLUG}-support`, nameEn: 'Support Made This', nameAr: 'اختبار', scope: 'PRODUCT',
  });
  check('RBAC: and cannot create one',
    supportWrite.status !== 200 && Number(sql(`select count(*) from productCategories where slug='${SLUG}-support'`)) === 0,
    `${supportWrite.status} ${supportWrite.error ?? ''}`);

  // A SUPPLIER is a real signed-in user with no admin role at all.
  const vendorAttack = await vendor.session.mutate('admin.createCategory', {
    slug: `${SLUG}-vendor`, nameEn: 'Vendor Made This', nameAr: 'اختبار', scope: 'PRODUCT',
  });
  check('RBAC: an ordinary signed-in supplier cannot create a category',
    vendorAttack.status !== 200 && Number(sql(`select count(*) from productCategories where slug='${SLUG}-vendor'`)) === 0,
    `${vendorAttack.status} ${vendorAttack.error ?? ''}`);
  const vendorHide = await vendor.session.mutate('admin.setCategoryStatus', { id: 1, status: 'archived' });
  check('RBAC: nor archive one',
    vendorHide.status !== 200 && sql(`select status from productCategories where id=1`) === 'active',
    `${vendorHide.status} ${vendorHide.error ?? ''}`);

  // ── CREATE, and it is usable immediately ───────────────────────────────
  const created = await admin.mutate('admin.createCategory', {
    slug: SLUG, nameEn: `Probe Insulation ${stamp}`, nameAr: `عزل تجريبي ${stamp}`,
    scope: 'PRODUCT', sortOrder: 900,
  });
  check('an administrator creates a category through the product',
    created.status === 200 && Number(created.data?.id) > 0, `${created.status} ${created.error ?? ''}`);
  const NEW_ID = Number(sql(`select id from productCategories where slug='${SLUG}'`));
  made.categories.push(NEW_ID);
  check('DATABASE: the row exists, active, with both names',
    sql(`select concat(status,'|',scope) from productCategories where id=${NEW_ID}`) === 'active|PRODUCT'
    && sql(`select nameAr from productCategories where id=${NEW_ID}`).includes('عزل'),
    sql(`select concat(status,'|',scope,'|',nameAr) from productCategories where id=${NEW_ID}`));
  check('AUDIT: creation recorded the actor',
    Number(sql(`select count(*) from commercialAuditEvents where subjectType='category' and subjectId=${NEW_ID}
                and action='category_created' and actorId=${marketAdmin.id}`)) === 1);

  // NO DEPLOYMENT. The supplier's very next upload sees it.
  const uploadNew = await vendor.session.mutate('marketplace.importProducts', {
    csv: csv([`Probe Product A ${stamp},,Probe Insulation ${stamp},X,100,5,piece,3,`]), dryRun: false,
  });
  check('PROPAGATION: a supplier lists into the new category with no restart',
    uploadNew.status === 200 && uploadNew.data?.imported === 1,
    `${uploadNew.status} ${uploadNew.error ?? ''} imported=${uploadNew.data?.imported}`);
  check('DATABASE: and the product carries the new category id',
    Number(sql(`select count(*) from products where supplierId=${vendor.id} and categoryId=${NEW_ID}`)) === 1);

  // ── REAL usage counts, never invented ──────────────────────────────────
  const listed = await admin.query('admin.categories', undefined);
  const row = (listed.data?.categories ?? []).find(c => c.slug === SLUG);
  check('the admin view reports the REAL product count', row?.productCount === 1, `${row?.productCount}`);
  const untouched = (listed.data?.categories ?? []).find(c => c.slug === 'roofing');
  check('and a category with no products reports zero, not a placeholder',
    untouched?.productCount === Number(sql(`select count(*) from products p join productCategories c on c.id=p.categoryId where c.slug='roofing'`)),
    `${untouched?.productCount}`);

  // ── ALIAS: one alias, one category ─────────────────────────────────────
  const alias = await admin.mutate('admin.addCategoryAlias', { categoryId: NEW_ID, alias: `ProbeIns${stamp}` });
  check('an administrator adds an alias', alias.status === 200, alias.error ?? '');
  made.aliases.push(Number(sql(`select id from productCategoryAliases where categoryId=${NEW_ID} limit 1`)));
  const uploadAlias = await vendor.session.mutate('marketplace.importProducts', {
    csv: csv([`Probe Product B ${stamp},,ProbeIns${stamp},X,100,5,piece,3,`]), dryRun: true,
  });
  check('PROPAGATION: the alias resolves on the very next upload',
    uploadAlias.data?.errorCount === 0, `${uploadAlias.data?.errorCount} ${uploadAlias.data?.categoryIssues?.[0]?.message ?? ''}`);
  const clash = await admin.mutate('admin.addCategoryAlias', { categoryId: NEW_ID, alias: 'Waterproofing' });
  check('an alias that another CATEGORY answers to is refused at the point of choosing it',
    clash.status !== 200 && /already means/i.test(clash.error ?? ''), clash.error ?? '');

  // ── RENAME is a label change, and nothing else ─────────────────────────
  const beforeRename = sql(`select group_concat(concat(id,':',categoryId) order by id) from products where supplierId=${vendor.id}`);
  const renamed = await admin.mutate('admin.updateCategory', { id: NEW_ID, nameEn: `Probe Insulation Renamed ${stamp}` });
  check('an administrator renames a category', renamed.status === 200, renamed.error ?? '');
  check('LIFECYCLE: renaming moves NO product - every link is where it was',
    sql(`select group_concat(concat(id,':',categoryId) order by id) from products where supplierId=${vendor.id}`) === beforeRename,
    beforeRename);
  check('LIFECYCLE: and the slug is unchanged, so links and stored references still resolve',
    sql(`select slug from productCategories where id=${NEW_ID}`) === SLUG);
  check('AUDIT: the rename recorded OLD -> NEW with the actor',
    Number(sql(`select count(*) from fieldValueHistory where subjectType='category' and subjectId=${NEW_ID}
                and field='nameEn' and oldValue='Probe Insulation ${stamp}' and actorId=${marketAdmin.id}`)) === 1,
    sql(`select concat(field,':',oldValue,'->',newValue) from fieldValueHistory where subjectType='category' and subjectId=${NEW_ID}`));

  // ── HIDE, with the dependency check ────────────────────────────────────
  const stale = await admin.mutate('admin.setCategoryStatus', { id: NEW_ID, status: 'hidden', expectedProductCount: 99 });
  check('hiding is REFUSED when the product count has moved since the screen read it',
    stale.status !== 200 && /not 99/.test(stale.error ?? '') && sql(`select status from productCategories where id=${NEW_ID}`) === 'active',
    stale.error ?? '');

  const beforeHide = sql(`select group_concat(concat(id,':',categoryId,':',category) order by id) from products where supplierId=${vendor.id}`);
  const hidden = await admin.mutate('admin.setCategoryStatus', { id: NEW_ID, status: 'hidden', expectedProductCount: 1 });
  check('hiding succeeds when the count matches what was shown', hidden.status === 200, hidden.error ?? '');
  check('LIFECYCLE: the existing product is UNTOUCHED - same link, same stored name',
    sql(`select group_concat(concat(id,':',categoryId,':',category) order by id) from products where supplierId=${vendor.id}`) === beforeHide,
    beforeHide);

  const blockedUpload = await vendor.session.mutate('marketplace.importProducts', {
    csv: csv([`Probe Product C ${stamp},,Probe Insulation Renamed ${stamp},X,100,5,piece,3,`]), dryRun: true,
  });
  check('PROPAGATION: a NEW listing in the hidden category is refused immediately',
    blockedUpload.data?.errorCount === 1, `${blockedUpload.data?.errorCount}`);
  check('ERROR QUALITY: as INACTIVE, not as "not a BuildHub category"',
    blockedUpload.data?.categoryIssues?.[0]?.reason === 'INACTIVE'
    && !/is not a BuildHub category/.test(blockedUpload.data?.categoryIssues?.[0]?.message ?? ''),
    blockedUpload.data?.categoryIssues?.[0]?.message ?? '');
  check('and the hidden category leaves the supplier\'s listable set',
    !((await vendor.session.query('marketplace.categories', { view: 'listable' })).data?.categories ?? [])
      .some(c => c.slug === SLUG));

  // ── REACTIVATE ─────────────────────────────────────────────────────────
  const restored = await admin.mutate('admin.setCategoryStatus', { id: NEW_ID, status: 'active', expectedProductCount: 1 });
  check('an administrator reactivates it', restored.status === 200, restored.error ?? '');
  const afterRestore = await vendor.session.mutate('marketplace.importProducts', {
    csv: csv([`Probe Product D ${stamp},,Probe Insulation Renamed ${stamp},X,100,5,piece,3,`]), dryRun: true,
  });
  check('PROPAGATION: listing works again on the very next upload, with no restart',
    afterRestore.data?.errorCount === 0, `${afterRestore.data?.errorCount}`);
  check('AUDIT: both status changes are recorded, with the dependency count as context',
    Number(sql(`select count(*) from fieldValueHistory where subjectType='category' and subjectId=${NEW_ID} and field='status'`)) === 2
    && sql(`select reason from fieldValueHistory where subjectType='category' and subjectId=${NEW_ID} and field='status' limit 1`).includes('1 product'),
    sql(`select group_concat(concat(oldValue,'->',newValue)) from fieldValueHistory where subjectType='category' and subjectId=${NEW_ID} and field='status'`));

  // ── THERE IS NO DELETE ─────────────────────────────────────────────────
  const deleteAttempt = await admin.mutate('admin.deleteCategory', { id: NEW_ID });
  check('there is no delete endpoint at all - not one that refuses politely',
    deleteAttempt.status === 404 || /no procedure|not found/i.test(deleteAttempt.error ?? ''),
    `${deleteAttempt.status} ${deleteAttempt.error ?? ''}`);
  check('and the category is still there',
    Number(sql(`select count(*) from productCategories where id=${NEW_ID}`)) === 1);

  // ── DUPLICATES ARE REFUSED BEFORE THEY BECOME A SUPPLIER'S PROBLEM ─────
  const dupe = await admin.mutate('admin.createCategory', {
    slug: `${SLUG}-dupe`, nameEn: 'Waterproofing', nameAr: 'عزل مختلف', scope: 'PRODUCT',
  });
  check('a second category claiming an existing name is refused',
    dupe.status !== 200 && /already used by/i.test(dupe.error ?? ''), dupe.error ?? '');
  check('and nothing was written',
    Number(sql(`select count(*) from productCategories where slug='${SLUG}-dupe'`)) === 0);

  const badSlug = await admin.mutate('admin.createCategory', {
    slug: 'Not A Slug', nameEn: `X ${stamp}`, nameAr: 'س', scope: 'PRODUCT',
  });
  check('a malformed slug is refused', badSlug.status !== 200, `${badSlug.status}`);
} finally {
  // Cleanup, in dependency order: the FK from products is RESTRICT.
  if (made.users.length > 0) {
    sql(`delete from products where supplierId in (${made.users.join(',')})`);
    sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
  }
  if (made.categories.length > 0) {
    sql(`delete from productCategoryAliases where categoryId in (${made.categories.join(',')})`);
    sql(`delete from fieldValueHistory where subjectType='category' and subjectId in (${made.categories.join(',')})`);
    sql(`delete from commercialAuditEvents where subjectType='category' and subjectId in (${made.categories.join(',')})`);
    sql(`delete from productCategories where id in (${made.categories.join(',')})`);
  }
  if (made.users.length > 0) sql(`delete from users where id in (${made.users.join(',')})`);
}

check('CLEANUP: every row this probe planted is gone',
  Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0
  && Number(sql(`select count(*) from productCategories where slug like 'zgcat%'`)) === 0);
check('CLEANUP: the taxonomy is back exactly as it was found',
  Number(sql(`select count(*) from productCategories`)) === 35
  && Number(sql(`select count(*) from productCategories where status<>'active'`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);

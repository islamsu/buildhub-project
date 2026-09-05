// ── LIVE: the administration lists that used to stop at 250 ────────────────
//
// THE DEFECT, four times over. `admin.products`, `admin.projects`,
// `admin.placements` and `admin.vendorNameChanges` each read `.limit(250)`,
// each returned a bare array, and each had a client that FILTERED THE RESULT IN
// THE BROWSER. A search for a product on row 251 answered "no matching
// products" - with exactly the confidence of a correct answer, and no total on
// the screen to hint otherwise.
//
// Everything below runs against real MariaDB, because two things exist only in
// SQL: the joins the search reaches through (a product searched by its
// SUPPLIER'S name), and the count that has to be filtered the same way the page
// is. A fake cannot fail either.
//
// It also proves the LIKE escaping is real: a search for "%" must find the rows
// containing a percent sign, not every row in the table.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

function session(initial = '') {
  let cookie = initial;
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    for (const raw of (res.headers.getSetCookie?.() ?? [])) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return {
      status: res.status, data: json?.result?.data?.json ?? null,
      error: json?.error?.json?.message ?? null,
      code: json?.error?.json?.data?.code ?? null,
    };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i), cookie: () => cookie };
}

const stamp = Date.now() % 100000000;
const made = { users: [], products: [] };
const admin = session();

/** A list read that fails LOUDLY, naming the server's own reason. */
async function list(procedure, input, what) {
  const res = await admin.query(procedure, input);
  if (res.status !== 200 || !res.data) {
    throw new Error(`${procedure} (${what}) -> ${res.status}: ${res.error ?? 'no body'}`);
  }
  return res.data;
}

try {
  const signedIn = await admin.mutate('auth.adminSignIn', {
    identifier: 'superadmin@buildhub.local', password: 'LocalSuperAdmin!2024',
  });
  if (signedIn.status !== 200) throw new Error(`probe setup: admin sign-in ${signedIn.status}`);

  // ── A SUPPLIER AND THIRTY PRODUCTS, so paging has something to page ──────
  const username = `zgal${stamp}`;
  const signUp = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeUser!2024',
      name: `ZG Supplier ${stamp}`, userRole: 'supplier',
    } }),
  });
  if (signUp.status !== 200) throw new Error(`probe setup: signUp ${signUp.status}`);
  const supplierId = Number(sql(`select id from users where username='${username}'`));
  made.users.push(supplierId);

  /*
   * Products are inserted directly: this probe is about the READ path, and the
   * write path has its own coverage. Thirty of them, plus two whose names carry
   * a LIKE wildcard, which is what the escaping test needs.
   */
  const values = [];
  for (let i = 1; i <= 30; i++) {
    values.push(`('ZG widget ${stamp} ${String(i).padStart(2, '0')}', 'Materials', ${supplierId}, 1, 100)`);
  }
  values.push(`('ZG 100% pure ${stamp}', 'Materials', ${supplierId}, 1, 100)`);
  values.push(`('ZG under_score ${stamp}', 'Materials', ${supplierId}, 1, 100)`);
  sql(`insert into products (name, category, supplierId, active, price) values ${values.join(',')}`);
  const productIds = sql(`select id from products where supplierId=${supplierId}`).split('\n').filter(Boolean);
  made.products.push(...productIds);
  check('the probe planted 32 products under one supplier',
    productIds.length === 32, `${productIds.length}`);

  // ── PAGING IS REAL ──────────────────────────────────────────────────────
  const page0 = await list('admin.products', { page: 0, pageSize: 10, search: `ZG widget ${stamp}` }, 'page 0');
  const page1 = await list('admin.products', { page: 1, pageSize: 10, search: `ZG widget ${stamp}` }, 'page 1');
  check('a page is bounded by its size', page0.rows.length === 10, `${page0.rows.length}`);
  check('and the total counts every match, not the page',
    Number(page0.total) === 30, `total=${page0.total}`);
  const overlap = page0.rows.filter(row => page1.rows.some(other => other.id === row.id));
  check('the second page is different rows - nothing shown twice or skipped',
    overlap.length === 0 && page1.rows.length === 10, `${overlap.length} overlapping`);
  const page3 = await list('admin.products', { page: 3, pageSize: 10, search: `ZG widget ${stamp}` }, 'past the end');
  check('a page past the end is empty rather than an error, and the total still stands',
    page3.rows.length === 0 && Number(page3.total) === 30, `total=${page3.total}`);

  /*
   * THE PAGE SIZE IS CLAMPED SERVER-SIDE. A caller who can name their own page
   * size can ask for the whole table, which is the read this milestone removes.
   */
  const huge = await admin.query('admin.products', { page: 0, pageSize: 100000 });
  check('a caller cannot ask for the whole table',
    huge.status !== 200 || Number(huge.data?.pageSize ?? 0) <= 100,
    huge.status === 200 ? `pageSize=${huge.data.pageSize}` : `${huge.status}`);

  // ── THE SEARCH REACHES THROUGH THE JOIN ─────────────────────────────────
  const bySupplier = await list('admin.products', { page: 0, pageSize: 25, search: `ZG Supplier ${stamp}` }, 'by supplier');
  check('a product is findable by its SUPPLIER\'s name - the search reaches the join',
    Number(bySupplier.total) === 32, `total=${bySupplier.total}`);
  check('and the count agrees with the rows the page returned',
    bySupplier.rows.length === Math.min(25, Number(bySupplier.total)),
    `${bySupplier.rows.length} rows of ${bySupplier.total}`);

  // ── LIKE WILDCARDS ARE ESCAPED ──────────────────────────────────────────
  const percent = await list('admin.products', { page: 0, pageSize: 25, search: '100%' }, 'percent');
  check('searching "100%" finds the product NAMED that, not every row',
    Number(percent.total) >= 1 && Number(percent.total) < 32
    && percent.rows.every(row => String(row.name).includes('100%')),
    `total=${percent.total}`);
  const underscore = await list('admin.products', { page: 0, pageSize: 25, search: 'under_score' }, 'underscore');
  check('and "under_score" does not match "underXscore"',
    underscore.rows.every(row => String(row.name).includes('under_score')),
    `total=${underscore.total}`);

  const nothing = await list('admin.products', { page: 0, pageSize: 25, search: `no-such-thing-${stamp}` }, 'no match');
  check('a search that matches nothing says zero rather than erroring',
    Number(nothing.total) === 0 && nothing.rows.length === 0);

  // ── EVERY OTHER CONVERTED LIST ANSWERS ──────────────────────────────────
  for (const [procedure, label] of [
    ['admin.projects', 'projects'],
    ['admin.placements', 'placements'],
    ['admin.vendorNameChanges', 'name changes'],
    ['admin.marketplaceProducts', 'the featured catalogue'],
    ['admin.referralCampaigns', 'referral campaigns'],
  ]) {
    const page = await list(procedure, { page: 0, pageSize: 10 }, label);
    check(`${label} answers with a page and a real total`,
      Array.isArray(page.rows) && typeof page.total === 'number' && page.pageSize === 10,
      `total=${page.total} rows=${page.rows.length}`);
    const searched = await list(procedure, { page: 0, pageSize: 10, search: `zzz-${stamp}` }, `${label} search`);
    check(`${label} runs its search in the query, and finds nothing for nonsense`,
      Number(searched.total) === 0, `total=${searched.total}`);
  }

  // The marketplace catalogue must see the planted products, since the whole
  // point of paging it was that a product past row 200 could not be featured.
  const catalogue = await list('admin.marketplaceProducts', {
    page: 0, pageSize: 25, search: `ZG widget ${stamp}`,
  }, 'catalogue by name');
  check('a product is reachable in the featured catalogue by search, not only by luck',
    Number(catalogue.total) === 30, `total=${catalogue.total}`);

  // ── AN UNRECOGNISED FILTER VALUE IS DROPPED, NOT PASSED THROUGH ─────────
  const bogus = await list('admin.projects', { page: 0, pageSize: 10, status: 'not-a-status' }, 'bogus status');
  const unfiltered = await list('admin.projects', { page: 0, pageSize: 10 }, 'unfiltered');
  check('an unrecognised status filter shows everything rather than emptying the list',
    Number(bogus.total) === Number(unfiltered.total),
    `${bogus.total} vs ${unfiltered.total}`);

  // ── AND A NON-ADMIN STILL CANNOT READ ANY OF IT ─────────────────────────
  /*
   * APPROVED FIRST, through the real admin path. An unapproved supplier is not
   * a provider as far as the RFQ feed is concerned and is scoped to their own
   * requests - which is correct, and which made the board assertion below read
   * zero against seven real RFQs until the approval was added. The scope rule
   * was right; the probe had not put its supplier on the right side of it.
   */
  const approved = await admin.mutate('admin.updateApplicantStatus', {
    userId: supplierId, status: 'approved', note: 'probe',
  });
  if (approved.status !== 200) throw new Error(`probe setup: approve ${approved.error}`);

  const outsider = session();
  const signIn = await outsider.mutate('auth.signIn', {
    identifier: `${username}@example.test`, password: 'ProbeUser!2024',
  });
  check('the probe supplier can sign in, approved', signIn.status === 200, signIn.error ?? '');

  // ── THE USER-FACING LISTS PAGE TOO ──────────────────────────────────────
  /*
   * ASSERTED WITH ROWS IN IT.
   *
   * The first version read the board as the ADMINISTRATOR, who is not a
   * provider - so it is scoped to their own requests, of which there are none,
   * and `total === 0` satisfied a check about pagination without exercising
   * any. A count of zero passes almost any assertion.
   */
  const rfqCount = Number(sql('select count(*) from rfqs'));
  const board = await outsider.query('rfq.list', { page: 0, pageSize: 5 });
  check('the RFQ board answers a PROVIDER with a page and the real total',
    board.status === 200 && Number(board.data?.total) === rfqCount
    && board.data.rows.length === Math.min(5, rfqCount),
    `total=${board.data?.total} of ${rfqCount}, rows=${board.data?.rows?.length}`);
  if (rfqCount > 5) {
    const second = await outsider.query('rfq.list', { page: 1, pageSize: 5 });
    const same = second.data.rows.filter(row => board.data.rows.some(other => other.id === row.id));
    check('and its second page is different requests', same.length === 0, `${same.length} repeated`);
  }
  check('the board never carries the requester\'s attachments',
    board.data.rows.every(row => !('attachments' in row)));

  const directory = await admin.query('projects.directory', { page: 0, pageSize: 10 });
  check('the project directory refuses an administrator, who is not an approved provider',
    directory.status !== 200 && directory.code === 'FORBIDDEN',
    `${directory.status} ${directory.code ?? ''}`);
  for (const procedure of ['admin.products', 'admin.projects', 'admin.placements', 'admin.vendorNameChanges']) {
    const refused = await outsider.query(procedure, { page: 0, pageSize: 10 });
    check(`a supplier cannot read ${procedure}`,
      refused.status !== 200 && refused.data === null, `${refused.status} ${refused.code ?? ''}`);
  }
} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  const failures = [];
  const attempt = statement => {
    try { sql(statement); } catch (error) { failures.push(String(error.message).split('\n').pop()); }
  };
  if (made.products.length > 0) {
    const ids = made.products.join(',');
    attempt(`delete from commercialAuditEvents where subjectType='product' and subjectId in (${ids})`);
    attempt(`delete from productQuestions where productId in (${ids})`);
    attempt(`delete from vendorSponsorships where productId in (${ids})`);
    attempt(`delete from products where id in (${ids})`);
  }
  if (made.users.length > 0) {
    const ids = made.users.join(',');
    attempt(`delete from commercialAuditEvents where ownerId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from fieldValueHistory where ownerId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from registrationReviewEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from vendorCategories where userId in (${ids})`);
    attempt(`delete from vendorEntitlementOverrides where userId in (${ids})`);
    attempt(`delete from vendorSubscriptions where userId in (${ids})`);
    attempt(`delete from notifications where userId in (${ids})`);
    attempt(`delete from userAccountAuditEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from analyticsEvents where userId in (${ids})`);
    attempt(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    attempt(`delete from users where id in (${ids})`);
  }
  if (failures.length > 0) check(`CLEANUP: ${failures.length} statement(s) failed`, false, failures.slice(0, 3).join(' | '));
}

check('CLEANUP: every row this probe planted is gone',
  (made.users.length === 0 || Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0)
  && (made.products.length === 0 || Number(sql(`select count(*) from products where id in (${made.products.join(',')})`)) === 0));

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);

// ── LIVE: the Vendor Enquiries list ───────────────────────────────────────
//
// Filtering, sorting, paging, searching and privacy, against a real server and
// a real database. Four things are proved that a unit test cannot:
//
//   1. The state FILTER and the state BADGE agree, because both come from the
//      generated ladder running inside MariaDB.
//   2. Paging is real: pages do not overlap, and together they are the whole
//      result set - the failure mode of an unstable ORDER BY.
//   3. NO QUOTATION PRICE reaches the response, asserted against a fixture that
//      really has one in the database.
//   4. THE PAGE COSTS A BOUNDED NUMBER OF QUERIES. Measured with MariaDB's own
//      general log, not asserted from reading the source: a twenty-row page
//      that issues forty-one queries looks identical in the response.
import { execSync } from 'node:child_process';
import { adminSession } from './lib/session.mjs';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q })
  .toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();
const adminSql = q => execSync('mysql -u root -N -B', { input: q }).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

// The input is `{}` and not `null`: the procedure's schema is `.optional()`,
// the convention every other optional-input procedure in this router follows,
// and a real tRPC client omits the input rather than sending null. Sending null
// is a 400 from zod, which is correct - the first version of this probe did it
// and read the 400 as a broken endpoint.
const list = async (input, cookie) => {
  const url = `${BASE}/api/trpc/admin.enquiryList?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, body };
};

async function signIn(identifier, password) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password } }),
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { ok: res.status === 200, cookie: cookies.map(c => c.split(';')[0]).join('; ') };
}

// ── Authorization ─────────────────────────────────────────────────────────

check('anonymous caller is refused the list', (await list({})).status === 401);

const admin = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!admin.ok) {
  console.log('ABORT: bootstrap Super Admin sign-in failed; every check below would be vacuous.');
  process.exit(1);
}

const supportEmail = 'zg-list-support@buildhub.local';
sql(`DELETE FROM users WHERE email = '${supportEmail}';`);
const hash = sql('SELECT passwordHash FROM users WHERE id = 1;');
sql(`INSERT INTO users (openId, email, name, role, adminRole, accountStatus, passwordHash, isDummy)
     VALUES ('zg-list-support', '${supportEmail}', 'Probe Support', 'admin', 'SUPPORT_ADMIN', 'active', '${hash}', 0);`);
const support = await adminSession(supportEmail, 'LocalSuperAdmin!2024');
check('the SUPPORT_ADMIN probe account signs in', support.ok);
check('SUPPORT_ADMIN is refused the list server-side',
  (await list({}, support.cookie)).status === 403);

// ── The empty platform ────────────────────────────────────────────────────

const preexisting = Number(sql('SELECT COUNT(*) FROM rfqSuppliers;'))
  + Number(sql('SELECT COUNT(*) FROM qualifiedEnquiries;')) + Number(sql('SELECT COUNT(*) FROM quotations;'));
if (preexisting === 0) {
  const empty = await list({}, admin.cookie);
  check('an empty platform returns an empty page, not an error',
    empty.status === 200 && Array.isArray(empty.data?.rows) && empty.data.rows.length === 0
    && empty.data.total === 0, `HTTP ${empty.status}`);
} else {
  check('empty-platform check was applicable', false, `${preexisting} rows already present`);
}

// ── The fixture ───────────────────────────────────────────────────────────

const clean = () => sql(`
  DELETE FROM quotations WHERE providerId IN (SELECT id FROM users WHERE openId LIKE 'zg-el-%');
  DELETE FROM qualifiedEnquiries WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'zg-el-%');
  DELETE FROM rfqSuppliers WHERE supplierId IN (SELECT id FROM users WHERE openId LIKE 'zg-el-%');
  DELETE FROM rfqs WHERE title LIKE 'ZG list fixture%';
  DELETE FROM users WHERE openId LIKE 'zg-el-%';
`);
clean();
sql(`INSERT INTO users (openId, email, name, role) VALUES
  ('zg-el-req','zg-el-req@buildhub.local','Fixture Requester','user'),
  ('zg-el-v1','zg-el-v1@buildhub.local','Alpha Concrete','user'),
  ('zg-el-v2','zg-el-v2@buildhub.local','Beta Steel','user'),
  ('zg-el-v3','zg-el-v3@buildhub.local','Gamma Glass','user');`);
const uid = o => Number(sql(`SELECT id FROM users WHERE openId = '${o}';`));
const req = uid('zg-el-req'), v1 = uid('zg-el-v1'), v2 = uid('zg-el-v2'), v3 = uid('zg-el-v3');

sql(`INSERT INTO rfqs (requesterId, title, status, category) VALUES
  (${req}, 'ZG list fixture ONE', 'open', 'concrete'),
  (${req}, 'ZG list fixture TWO', 'open', 'steel'),
  (${req}, 'ZG list fixture THREE', 'closed', 'glass');`);
const rid = t => Number(sql(`SELECT id FROM rfqs WHERE title = 'ZG list fixture ${t}';`));
const r1 = rid('ONE'), r2 = rid('TWO'), r3 = rid('THREE');

const month = new Date().toISOString().slice(0, 7);
// Expected states written out by hand from the rules, as before.
const FIXTURE = [
  [r1, v1, 'invited',  false, false, 'INVITED'],
  [r1, v2, 'viewed',   false, false, 'VIEWED'],
  [r1, v3, 'declined', false, false, 'DECLINED'],
  [r2, v1, null,       true,  false, 'OPENED'],
  [r2, v2, null,       true,  true,  'RESPONDED'],
  [r3, v3, 'invited',  false, false, 'CLOSED'],
];
for (const [rfqId, vendorId, invitation, credit, quotation] of FIXTURE) {
  if (invitation) sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, status) VALUES (${rfqId}, ${vendorId}, ${req}, '${invitation}');`);
  if (credit)     sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth) VALUES (${vendorId}, ${rfqId}, '${month}');`);
  // A REAL, DISTINCTIVE PRICE. If it ever appears in a response the check below
  // will find it; a round number could be a coincidence.
  if (quotation)  sql(`INSERT INTO quotations (rfqId, providerId, price) VALUES (${rfqId}, ${vendorId}, 738291.55);`);
}

// ── The page ──────────────────────────────────────────────────────────────

const all = await list({}, admin.cookie);
check('the seeded list returns every pair', all.data?.total === FIXTURE.length,
  `total ${all.data?.total} of ${FIXTURE.length}`);
check('each row carries a human reference in the ENQ- form',
  all.data?.rows?.every(r => /^ENQ-\d+-\d+$/.test(r.reference)),
  all.data?.rows?.[0]?.reference);
check('each row names the RFQ and the vendor in words, not only ids',
  all.data?.rows?.every(r => typeof r.rfqTitle === 'string' && typeof r.vendorName === 'string'));

// The badge must match the hand-written expectation for every fixture row.
const byRef = new Map((all.data?.rows ?? []).map(r => [r.reference, r]));
let stateMismatch = '';
for (const [rfqId, vendorId, , , , expected] of FIXTURE) {
  const row = byRef.get(`ENQ-${rfqId}-${vendorId}`);
  if (row?.state !== expected) stateMismatch += ` ENQ-${rfqId}-${vendorId}: want ${expected} got ${row?.state};`;
}
check('every row shows the state the rules say it has', stateMismatch === '', stateMismatch.trim());

// ── Filtering ─────────────────────────────────────────────────────────────

for (const state of ['INVITED', 'VIEWED', 'DECLINED', 'OPENED', 'RESPONDED', 'CLOSED']) {
  const expected = FIXTURE.filter(f => f[5] === state).length;
  const filtered = await list({ state }, admin.cookie);
  check(`filtering by ${state} returns exactly its rows`,
    filtered.data?.total === expected && filtered.data?.rows?.every(r => r.state === state),
    `total ${filtered.data?.total}, expected ${expected}`);
}

const byVendor = await list({ vendorId: v1 }, admin.cookie);
check('filtering by vendor returns only that vendor',
  byVendor.data?.total === 2 && byVendor.data.rows.every(r => r.vendorId === v1),
  `total ${byVendor.data?.total}`);

const byRfqStatus = await list({ rfqStatus: 'closed' }, admin.cookie);
check('filtering by RFQ status returns only enquiries on closed RFQs',
  byRfqStatus.data?.total === 1 && byRfqStatus.data.rows[0].rfqId === r3,
  `total ${byRfqStatus.data?.total}`);

// ── Searching ─────────────────────────────────────────────────────────────

const byName = await list({ search: 'Beta' }, admin.cookie);
check('searching a vendor name finds that vendor\'s enquiries',
  byName.data?.total === 2 && byName.data.rows.every(r => r.vendorId === v2),
  `total ${byName.data?.total}`);

const byTitle = await list({ search: 'fixture THREE' }, admin.cookie);
check('searching an RFQ title finds that RFQ\'s enquiries',
  byTitle.data?.total === 1 && byTitle.data.rows[0].rfqId === r3);

const byReference = await list({ search: `ENQ-${r1}-${v2}` }, admin.cookie);
check('PASTING A REFERENCE FINDS EXACTLY THE ENQUIRY IT NAMES',
  byReference.data?.total === 1 && byReference.data.rows[0].reference === `ENQ-${r1}-${v2}`,
  `total ${byReference.data?.total}`);

const byRfqNumber = await list({ search: `RFQ #${r1}` }, admin.cookie);
check('pasting "RFQ #<id>" finds that RFQ\'s enquiries',
  byRfqNumber.data?.total === 3 && byRfqNumber.data.rows.every(r => r.rfqId === r1),
  `total ${byRfqNumber.data?.total}`);

const noMatch = await list({ search: 'zzz-nothing-matches-this' }, admin.cookie);
check('a search that matches nothing returns an honest empty page',
  noMatch.status === 200 && noMatch.data?.total === 0 && noMatch.data.rows.length === 0);

// ── Paging and ordering ───────────────────────────────────────────────────

const page1 = await list({ limit: 2, offset: 0, sort: 'rfq', direction: 'asc' }, admin.cookie);
const page2 = await list({ limit: 2, offset: 2, sort: 'rfq', direction: 'asc' }, admin.cookie);
const page3 = await list({ limit: 2, offset: 4, sort: 'rfq', direction: 'asc' }, admin.cookie);
const seen = [...page1.data.rows, ...page2.data.rows, ...page3.data.rows].map(r => r.reference);
check('a page reports the FULL total, not the page size',
  page1.data?.total === FIXTURE.length, `total ${page1.data?.total}`);
check('paging returns each enquiry exactly once across the pages',
  seen.length === FIXTURE.length && new Set(seen).size === FIXTURE.length,
  `${seen.length} rows, ${new Set(seen).size} distinct`);

const asc = await list({ sort: 'rfq', direction: 'asc' }, admin.cookie);
const desc = await list({ sort: 'rfq', direction: 'desc' }, admin.cookie);
check('sorting reverses the order rather than being ignored',
  asc.data.rows[0].rfqId <= asc.data.rows.at(-1).rfqId
  && desc.data.rows[0].rfqId >= desc.data.rows.at(-1).rfqId
  && asc.data.rows[0].reference !== desc.data.rows[0].reference);

const overLimit = await list({ limit: 5000 }, admin.cookie);
check('an oversized limit is rejected rather than served',
  overLimit.status === 400, `HTTP ${overLimit.status}`);

// ── Privacy ───────────────────────────────────────────────────────────────

const storedPrice = sql(`SELECT price FROM quotations WHERE rfqId = ${r2} AND providerId = ${v2};`);
check('the fixture really has a quotation price in the database',
  storedPrice.startsWith('738291'), storedPrice);
const payload = JSON.stringify(all.data);
check('NO QUOTATION PRICE APPEARS IN THE LIST RESPONSE',
  !payload.includes('738291') && !/\bprice\b/i.test(payload));
check('the list still says WHETHER the vendor answered',
  byRef.get(`ENQ-${r2}-${v2}`)?.state === 'RESPONDED');
check('no password hash or session identifier reaches the response',
  !/passwordHash|openId|scrypt\$/.test(payload));

// ── Cost ──────────────────────────────────────────────────────────────────

adminSql("SET GLOBAL log_output='TABLE'; TRUNCATE TABLE mysql.general_log; SET GLOBAL general_log=ON;");
await list({ limit: 100 }, admin.cookie);
adminSql('SET GLOBAL general_log=OFF;');
// Only the statements touching the enquiry tables count; the session lookup and
// the connection handshake are not what N+1 would show up in.
const enquiryQueries = Number(adminSql(
  "SELECT COUNT(*) FROM mysql.general_log WHERE command_type='Query'"
  + " AND (CONVERT(argument USING utf8mb4) LIKE '%rfqSuppliers%'"
  + " OR CONVERT(argument USING utf8mb4) LIKE '%qualifiedEnquiries%');",
));
check('THE WHOLE PAGE COSTS TWO QUERIES, NOT ONE PER ROW',
  enquiryQueries === 2, `${enquiryQueries} queries for ${FIXTURE.length} rows`);

// ── Cleanup ───────────────────────────────────────────────────────────────
clean();
sql(`DELETE FROM users WHERE email = '${supportEmail}';`);
adminSql('TRUNCATE TABLE mysql.general_log;');
const leftover = Number(sql("SELECT COUNT(*) FROM users WHERE openId LIKE 'zg-el-%';"));
check('the fixture removed itself completely', leftover === 0, `${leftover} left`);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

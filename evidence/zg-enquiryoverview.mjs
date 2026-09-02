// ── LIVE: does the Vendor Enquiries overview count REAL rows, correctly? ───
//
// Three things are proved here, in this order, because the third is worthless
// without the first two:
//
//   1. AUTHORIZATION IS SERVER-SIDE. The counts are refused to an anonymous
//      caller and to an administrator whose role does not carry
//      marketplace.manage - refused by the server, not hidden by a screen.
//   2. AN EMPTY PLATFORM COUNTS ZERO, and says so as real zeroes across every
//      state rather than as an absent or partial object.
//   3. A SEEDED PLATFORM COUNTS EXACTLY WHAT WAS SEEDED. The expected state of
//      every fixture row is written out BY HAND below, not computed by calling
//      deriveEnquiryState - a comparison against the code under test proves
//      only that it agrees with itself.
//
// The fixture is inserted as rows because these are evidence rows for a
// verification run, not product data: nothing here is shown to a user, and it
// is all removed at the end. The counts under test are the platform's own.
import { execSync } from 'node:child_process';
import { adminSession } from './lib/session.mjs';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

// SQL over STDIN: a shell-quoted -e argument silently corrupts anything
// containing $, which is how an earlier probe reported four vacuous passes.
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q })
  .toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

async function call(path, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}?input=${encodeURIComponent('{"json":null}')}`,
    { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signIn(identifier, password) {
  const res = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier, password } }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { ok: res.status === 200, cookie: setCookie.map(c => c.split(';')[0]).join('; ') };
}

// ── 1. Authorization ──────────────────────────────────────────────────────

const anon = await call('admin.enquiryOverview');
check('anonymous caller is refused the counts', anon.status === 401,
  `HTTP ${anon.status}`);

const admin = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
// THE GATE. Everything below is meaningless if this sign-in did not happen -
// an unauthenticated 401 would otherwise read as a successful denial.
if (!admin.ok) {
  console.log('ABORT: could not sign in as the bootstrap Super Admin. Every check below would be vacuous.');
  process.exit(1);
}

// A SUPPORT_ADMIN holds support.manage and not marketplace.manage. Created
// directly because the point is the permission check, not the invitation flow.
const supportEmail = 'zg-support-probe@buildhub.local';
sql(`DELETE FROM users WHERE email = '${supportEmail}';`);
const hash = sql("SELECT passwordHash FROM users WHERE id = 1;");
sql(`INSERT INTO users (openId, email, name, role, adminRole, accountStatus, passwordHash, isDummy)
     VALUES ('zg-support-probe', '${supportEmail}', 'Probe Support Admin', 'admin', 'SUPPORT_ADMIN', 'active', '${hash}', 0);`);
const support = await adminSession(supportEmail, 'LocalSuperAdmin!2024');
check('the SUPPORT_ADMIN probe account can sign in at all', support.ok);
const supportCall = await call('admin.enquiryOverview', support.cookie);
check('SUPPORT_ADMIN is refused - marketplace.manage is checked server-side',
  supportCall.status === 403, `HTTP ${supportCall.status}`);

// ── 2. The empty platform ─────────────────────────────────────────────────

const EXPECTED_STATES = ['AVAILABLE','INVITED','VIEWED','OPENED','RESPONDED','DECLINED','CLOSED'];
const beforeRows = Number(sql('SELECT COUNT(*) FROM rfqSuppliers;'))
  + Number(sql('SELECT COUNT(*) FROM qualifiedEnquiries;'))
  + Number(sql('SELECT COUNT(*) FROM quotations;'));
if (beforeRows === 0) {
  const empty = await call('admin.enquiryOverview', admin.cookie);
  const data = empty.body?.result?.data?.json;
  check('an empty platform returns a real object, not an error', empty.status === 200 && !!data,
    `HTTP ${empty.status}`);
  check('every state is present as an explicit zero, not omitted',
    !!data && EXPECTED_STATES.every(s => data.byState?.[s] === 0),
    data ? JSON.stringify(data.byState) : 'no data');
  check('the totals are zero', !!data && data.total === 0 && data.vendors === 0 && data.rfqs === 0);
  check('AVAILABLE is declared as excluded from the counts',
    !!data && Array.isArray(data.excludedFromCounts) && data.excludedFromCounts.includes('AVAILABLE'));
} else {
  check('empty-platform checks were applicable', false, `${beforeRows} pre-existing rows`);
}

// ── 3. The seeded platform, with expectations written by hand ─────────────

// One requester, four vendors, three RFQs in the three real statuses.
sql(`
  DELETE FROM quotations WHERE providerId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM qualifiedEnquiries WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM rfqSuppliers WHERE supplierId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM rfqs WHERE title LIKE 'ZG overview fixture%';
  DELETE FROM users WHERE openId LIKE 'zg-eo-%';
  -- users.role holds only 'user' or 'admin'; a vendor is distinguished
  -- elsewhere, and the overview counts pairs rather than filtering on role, so
  -- plain accounts are the right fixture.
  INSERT INTO users (openId, email, name, role) VALUES
    ('zg-eo-req', 'zg-eo-req@buildhub.local', 'Fixture Requester', 'user'),
    ('zg-eo-v1',  'zg-eo-v1@buildhub.local',  'Fixture Vendor 1',  'user'),
    ('zg-eo-v2',  'zg-eo-v2@buildhub.local',  'Fixture Vendor 2',  'user'),
    ('zg-eo-v3',  'zg-eo-v3@buildhub.local',  'Fixture Vendor 3',  'user'),
    ('zg-eo-v4',  'zg-eo-v4@buildhub.local',  'Fixture Vendor 4',  'user'),
    ('zg-eo-v5',  'zg-eo-v5@buildhub.local',  'Fixture Vendor 5',  'user');
`);
const id = openId => Number(sql(`SELECT id FROM users WHERE openId = '${openId}';`));
const req = id('zg-eo-req');
const [v1, v2, v3, v4, v5] = ['zg-eo-v1', 'zg-eo-v2', 'zg-eo-v3', 'zg-eo-v4', 'zg-eo-v5'].map(id);

sql(`INSERT INTO rfqs (requesterId, title, status) VALUES
  (${req}, 'ZG overview fixture OPEN', 'open'),
  (${req}, 'ZG overview fixture CLOSED', 'closed'),
  (${req}, 'ZG overview fixture AWARDED', 'awarded');`);
const rfq = t => Number(sql(`SELECT id FROM rfqs WHERE title = 'ZG overview fixture ${t}';`));
const [rOpen, rClosed, rAwarded] = ['OPEN', 'CLOSED', 'AWARDED'].map(rfq);

/**
 * THE FIXTURE, and what each row MUST count as. Written out deliberately, one
 * line at a time, by reading the rules - never by asking the code.
 */
const FIXTURE = [
  // rfq,      vendor, invitation,  credit, quotation, expected
  [rOpen,    v1, 'invited',   false, false, 'INVITED'],
  [rOpen,    v2, 'viewed',    false, false, 'VIEWED'],
  [rOpen,    v3, 'declined',  false, false, 'DECLINED'],
  [rOpen,    v4, null,        true,  false, 'OPENED'],
  [rClosed,  v1, 'invited',   false, false, 'CLOSED'],   // the RFQ ended it
  [rClosed,  v2, null,        true,  false, 'CLOSED'],   // opened, but no longer actionable
  [rClosed,  v3, 'declined',  false, false, 'DECLINED'], // the vendor's own decision outlives it
  [rOpen,    v5, 'responded', false, false, 'OPENED'],   // invitation exemption: no credit row is expected
  [rAwarded, v1, null,        true,  true,  'RESPONDED'],// answered: outranks the closed RFQ
  //
  // THIS ROW WAS WRITTEN AS 'OPENED' FIRST, AND THE PROBE DISAGREED.
  // The code was right and the hand expectation was wrong: the terminal-RFQ
  // rung sits ABOVE the invitation rungs, so an awarded RFQ closes an enquiry
  // that produced no quotation, whatever the invitation says. That is the
  // documented precedence and the intended one - the vendor cannot act.
  //
  // The combination is also unreachable in production: markInvitationResponded
  // is called only from the quotation-submit path (routers.ts), so a 'responded'
  // invitation always has a quotation beside it in real data. It is kept as a
  // fixture precisely because it is the corner the two rungs compete over.
  [rAwarded, v2, 'responded', false, false, 'CLOSED'],
];

const month = new Date().toISOString().slice(0, 7);
for (const [rfqId, vendorId, invitation, credit, quotation] of FIXTURE) {
  if (invitation) sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, status) VALUES (${rfqId}, ${vendorId}, ${req}, '${invitation}');`);
  if (credit)     sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth) VALUES (${vendorId}, ${rfqId}, '${month}');`);
  if (quotation)  sql(`INSERT INTO quotations (rfqId, providerId, price) VALUES (${rfqId}, ${vendorId}, 1000.00);`);
}

const expected = Object.fromEntries(EXPECTED_STATES.map(s => [s, 0]));
for (const row of FIXTURE) expected[row[5]] += 1;

const seeded = await call('admin.enquiryOverview', admin.cookie);
const got = seeded.body?.result?.data?.json;
check('the seeded overview returns data', seeded.status === 200 && !!got, `HTTP ${seeded.status}`);
for (const state of EXPECTED_STATES) {
  check(`${state} counts ${expected[state]}`, got?.byState?.[state] === expected[state],
    `got ${got?.byState?.[state]}`);
}
check('the total equals the number of seeded pairs', got?.total === FIXTURE.length,
  `got ${got?.total} of ${FIXTURE.length}`);
check('AVAILABLE is never counted, because it is not a record',
  got?.byState?.AVAILABLE === 0);
check('distinct vendors counted correctly', got?.vendors === 5, `got ${got?.vendors}`);
check('distinct RFQs counted correctly', got?.rfqs === 3, `got ${got?.rfqs}`);
check('consumed allowance units equals the qualifiedEnquiries rows',
  got?.consumedAllowanceUnits === FIXTURE.filter(f => f[3]).length,
  `got ${got?.consumedAllowanceUnits}`);

// A vendor holding TWO quotations on one RFQ must still be ONE enquiry. This is
// the row-multiplication bug the EXISTS clauses exist to prevent, and it would
// otherwise inflate every count on the page.
sql(`INSERT INTO quotations (rfqId, providerId, price) VALUES (${rAwarded}, ${v1}, 2000.00);`);
const doubled = await call('admin.enquiryOverview', admin.cookie);
const after = doubled.body?.result?.data?.json;
check('A SECOND QUOTATION ON THE SAME PAIR DOES NOT DOUBLE-COUNT IT',
  after?.total === FIXTURE.length && after?.byState?.RESPONDED === expected.RESPONDED,
  `total ${after?.total}, RESPONDED ${after?.byState?.RESPONDED}`);

// The counts must disclose nothing about WHO. A landing view that leaks vendor
// identity has moved the authorization problem rather than solved it.
const payload = JSON.stringify(after ?? {});
check('the overview payload carries no vendor or RFQ identity',
  !/zg-eo-|Fixture Vendor|buildhub\.local/.test(payload));

// ── Cleanup ───────────────────────────────────────────────────────────────
sql(`
  DELETE FROM quotations WHERE providerId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM qualifiedEnquiries WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM rfqSuppliers WHERE supplierId IN (SELECT id FROM users WHERE openId LIKE 'zg-eo-%');
  DELETE FROM rfqs WHERE title LIKE 'ZG overview fixture%';
  DELETE FROM users WHERE openId LIKE 'zg-eo-%';
  DELETE FROM users WHERE email = '${supportEmail}';
`);
const leftover = Number(sql("SELECT COUNT(*) FROM users WHERE openId LIKE 'zg-eo-%' OR email = '" + supportEmail + "';"));
check('the fixture removed itself completely', leftover === 0, `${leftover} rows left`);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

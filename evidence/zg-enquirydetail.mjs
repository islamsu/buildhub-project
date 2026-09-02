// ── LIVE: one enquiry, in full ────────────────────────────────────────────
//
// The detail page is where the privacy boundary actually bites. BuildHub had
// already decided that bid contents are superAdminProcedure territory
// (admin.rfqInvestigation, "every competing bid's price"), so a
// marketplace.manage detail page that carried a price would be a second door to
// the reach the platform reserved for a Super Admin.
//
// So this probe does not merely check that a price is absent from the response.
// It proves the price EXISTS in the database, proves the Super Admin surface
// really does return it, and proves the enquiry detail does not - which is the
// difference between a deliberate boundary and an empty column.
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q })
  .toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const get = async (path, input, cookie) => {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
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

const admin = await signIn('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!admin.ok) { console.log('ABORT: bootstrap sign-in failed; every check would be vacuous.'); process.exit(1); }

check('anonymous caller is refused the detail',
  (await get('admin.enquiryDetail', { reference: 'ENQ-1-1' })).status === 401);

// ── Fixture ───────────────────────────────────────────────────────────────

const clean = () => sql(`
  DELETE FROM quotations WHERE providerId IN (SELECT id FROM users WHERE openId LIKE 'zg-ed-%');
  DELETE FROM qualifiedEnquiries WHERE userId IN (SELECT id FROM users WHERE openId LIKE 'zg-ed-%');
  DELETE FROM rfqSuppliers WHERE supplierId IN (SELECT id FROM users WHERE openId LIKE 'zg-ed-%');
  DELETE FROM rfqs WHERE title LIKE 'ZG detail fixture%';
  DELETE FROM users WHERE openId LIKE 'zg-ed-%';
`);
clean();
sql(`INSERT INTO users (openId, email, name, role) VALUES
  ('zg-ed-req','zg-ed-req@buildhub.local','Detail Requester','user'),
  ('zg-ed-v1','zg-ed-v1@buildhub.local','Delta Cement','user');`);
const uid = o => Number(sql(`SELECT id FROM users WHERE openId = '${o}';`));
const req = uid('zg-ed-req'), v1 = uid('zg-ed-v1');
sql(`INSERT INTO rfqs (requesterId, title, status, category) VALUES (${req}, 'ZG detail fixture ONE', 'open', 'concrete');`);
const r1 = Number(sql("SELECT id FROM rfqs WHERE title = 'ZG detail fixture ONE';"));

// A full history: invited, viewed, consumed an allowance unit, then answered.
sql(`INSERT INTO rfqSuppliers (rfqId, supplierId, invitedBy, status, viewedAt, respondedAt)
     VALUES (${r1}, ${v1}, ${req}, 'responded', NOW(), NOW());`);
sql(`INSERT INTO qualifiedEnquiries (userId, rfqId, yearMonth) VALUES (${v1}, ${r1}, '${new Date().toISOString().slice(0,7)}');`);
sql(`INSERT INTO quotations (rfqId, providerId, price) VALUES (${r1}, ${v1}, 654321.99);`);

const reference = `ENQ-${r1}-${v1}`;

// ── The detail ────────────────────────────────────────────────────────────

const byRef = await get('admin.enquiryDetail', { reference }, admin.cookie);
check('a pasted reference resolves to the enquiry', byRef.status === 200 && byRef.data?.enquiry?.reference === reference,
  `HTTP ${byRef.status}`);

const byPair = await get('admin.enquiryDetail', { rfqId: r1, vendorId: v1 }, admin.cookie);
check('the pair resolves to the same enquiry', byPair.data?.enquiry?.reference === reference);

check('the state is RESPONDED, derived from the quotation', byRef.data?.enquiry?.state === 'RESPONDED',
  byRef.data?.enquiry?.state);
check('the RFQ is named in words', byRef.data?.rfq?.title === 'ZG detail fixture ONE');
check('the requester is named', byRef.data?.rfq?.requesterName === 'Detail Requester');
check('the vendor is named', byRef.data?.vendor?.name === 'Delta Cement');

// ── The timeline ──────────────────────────────────────────────────────────

const events = (byRef.data?.timeline ?? []).map(e => e.event);
check('the timeline carries every event that really happened',
  ['INVITED', 'VIEWED', 'ALLOWANCE_CONSUMED', 'RESPONDED'].every(e => events.includes(e)),
  events.join(','));
check('the timeline invents nothing - no DECLINED on an enquiry that was answered',
  !events.includes('DECLINED'));
check('the timeline is ordered oldest first',
  (byRef.data?.timeline ?? []).every((e, i, all) => i === 0 || new Date(all[i - 1].at) <= new Date(e.at)));
check('the consumption event says allowance, not payment',
  /allowance/i.test(byRef.data?.timeline?.find(e => e.event === 'ALLOWANCE_CONSUMED')?.detail ?? '')
  && /No payment/i.test(byRef.data?.timeline?.find(e => e.event === 'ALLOWANCE_CONSUMED')?.detail ?? ''));

// ── Entitlement from the centralized engine ───────────────────────────────

const entitlement = byRef.data?.entitlement;
check('the vendor entitlement is reported', !!entitlement && typeof entitlement.used === 'number',
  JSON.stringify(entitlement));
const consumedRows = Number(sql(`SELECT COUNT(*) FROM qualifiedEnquiries WHERE userId = ${v1} AND yearMonth = '${new Date().toISOString().slice(0,7)}';`));
check('used matches the real consumption rows for the month',
  entitlement?.used === consumedRows, `engine ${entitlement?.used}, database ${consumedRows}`);
check('the entitlement period is named, so the figure is not floating',
  typeof entitlement?.periodKey === 'string' && /^\d{4}-\d{2}$/.test(entitlement.periodKey),
  entitlement?.periodKey);

// ── The privacy boundary ──────────────────────────────────────────────────

const storedPrice = sql(`SELECT price FROM quotations WHERE rfqId = ${r1} AND providerId = ${v1};`);
check('the fixture really holds a bid price in the database', storedPrice.startsWith('654321'), storedPrice);

const payload = JSON.stringify(byRef.data);
check('THE ENQUIRY DETAIL CARRIES NO BID PRICE', !payload.includes('654321'));
check('nor any other quotation content', !/paymentTerms|commercialTerms|warranty|attachments/i.test(payload));
check('the RFQ budget is not carried either', !/budget/i.test(payload));
check('no password hash or session identifier reaches the response',
  !/passwordHash|openId|scrypt\$/.test(payload));

// THE CONTROL that makes the three checks above mean something: the surface
// the platform DID authorise for bid contents still returns the price. Without
// this, "no price" could simply mean the fixture never had one.
const investigation = await get('admin.rfqInvestigation', { rfqId: r1 }, admin.cookie);
check('the Super Admin investigation surface DOES return the bid, as designed',
  investigation.status === 200 && JSON.stringify(investigation.data).includes('654321'),
  `HTTP ${investigation.status}`);

// ── Honest absence ────────────────────────────────────────────────────────

const missing = await get('admin.enquiryDetail', { rfqId: r1, vendorId: 99999999 }, admin.cookie);
check('a pair with no history is NOT FOUND, not an empty shell', missing.status === 404,
  `HTTP ${missing.status}`);
const malformed = await get('admin.enquiryDetail', { reference: 'not-a-reference' }, admin.cookie);
check('a malformed reference is refused rather than guessed at', malformed.status === 400,
  `HTTP ${malformed.status}`);

// ── Cleanup ───────────────────────────────────────────────────────────────
clean();
check('the fixture removed itself completely',
  Number(sql("SELECT COUNT(*) FROM users WHERE openId LIKE 'zg-ed-%';")) === 0);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

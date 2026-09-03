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
import { adminSession } from './lib/session.mjs';

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

const admin = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!admin.ok) { console.log('ABORT: bootstrap sign-in failed; every check would be vacuous.'); process.exit(1); }

check('anonymous caller is refused the detail',
  (await get('admin.enquiryDetail', { reference: 'ENQ-1-1' })).status === 401);

// ── Fixture ───────────────────────────────────────────────────────────────

const clean = () => sql(`
  DELETE FROM enquiryAssignments WHERE rfqId IN (SELECT id FROM rfqs WHERE title LIKE 'ZG detail fixture%');
  DELETE FROM notifications WHERE messageKey = 'notif.enquiry.assigned';
  DELETE FROM adminNotes WHERE subjectId IN (SELECT id FROM users WHERE openId LIKE 'zg-ed-%')
     OR subjectId IN (SELECT id FROM rfqs WHERE title LIKE 'ZG detail fixture%');
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

// ── Internal notes (§12) ──────────────────────────────────────────────────
//
// The interesting part is not that a note saves. It is that reading and writing
// notes ON A PERSON still needs the user-directory permission, so the enquiry
// screen cannot become a second door to them - the same rule as the bid price.

const post = async (path, input, cookie) => {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.result?.data?.json, body };
};

const savedRfqNote = await post('admin.addEnquiryNote',
  { scope: 'rfq', rfqId: r1, vendorId: v1, note: 'ZG probe: chased the vendor by phone.' }, admin.cookie);
check('a note can be filed against the request', savedRfqNote.status === 200 && savedRfqNote.data?.success === true,
  `HTTP ${savedRfqNote.status}`);
const noteRow = sql(`SELECT subjectType, subjectId FROM adminNotes WHERE id = ${savedRfqNote.data?.noteId ?? 0};`);
check('IT IS STORED AGAINST THE RFQ ITSELF, not a made-up enquiry id',
  noteRow === `rfq\t${r1}`, noteRow);

const savedVendorNote = await post('admin.addEnquiryNote',
  { scope: 'vendor', rfqId: r1, vendorId: v1, note: 'ZG probe: vendor asked about allowance.' }, admin.cookie);
check('a note can be filed against the vendor', savedVendorNote.status === 200);
const vendorRow = sql(`SELECT subjectType, subjectId FROM adminNotes WHERE id = ${savedVendorNote.data?.noteId ?? 0};`);
check("A VENDOR NOTE IS STORED AS subjectType 'user', so a person's notes stay in ONE place",
  vendorRow === `user\t${v1}`, vendorRow);

const readNotes = await get('admin.enquiryNotes', { rfqId: r1, vendorId: v1 }, admin.cookie);
check('both notes come back for a Super Admin',
  readNotes.data?.rfq?.length === 1 && readNotes.data?.vendor?.length === 1
  && readNotes.data?.vendorNotesVisible === true,
  JSON.stringify({ rfq: readNotes.data?.rfq?.length, vendor: readNotes.data?.vendor?.length }));
check('a note carries its author and time, not just text',
  typeof readNotes.data?.rfq?.[0]?.authorName === 'string' && !!readNotes.data?.rfq?.[0]?.createdAt);

const missingSubject = await post('admin.addEnquiryNote',
  { scope: 'rfq', rfqId: 99999999, vendorId: v1, note: 'against a typo' }, admin.cookie);
check('a note against a subject that does not exist is REFUSED, not filed where nobody finds it',
  missingSubject.status === 404, `HTTP ${missingSubject.status}`);

// A MARKETPLACE_ADMIN holds marketplace.manage and NOT users.read/users.manage.
const marketplaceEmail = 'zg-ed-marketplace@buildhub.local';
sql(`DELETE FROM users WHERE email = '${marketplaceEmail}';`);
const adminHash = sql('SELECT passwordHash FROM users WHERE id = 1;');
sql(`INSERT INTO users (openId, email, name, role, adminRole, accountStatus, passwordHash, isDummy)
     VALUES ('zg-ed-marketplace', '${marketplaceEmail}', 'Probe Marketplace Admin', 'admin', 'MARKETPLACE_ADMIN', 'active', '${adminHash}', 0);`);
const marketplace = await adminSession(marketplaceEmail, 'LocalSuperAdmin!2024');
check('the MARKETPLACE_ADMIN probe account has a session', marketplace.ok, marketplace.reason ?? '');

if (marketplace.ok) {
  const limited = await get('admin.enquiryNotes', { rfqId: r1, vendorId: v1 }, marketplace.cookie);
  check('a marketplace admin CAN read the RFQ notes', limited.data?.rfq?.length === 1);

  //
  // WHAT THIS PROBE EXPECTED, AND WHY IT WAS WRONG.
  //
  // It asserted that a MARKETPLACE_ADMIN cannot read notes on a person. The
  // endpoint returned them, and the endpoint was right: the permission map in
  // shared/adminRoles.ts gives MARKETPLACE_ADMIN ['users.read',
  // 'marketplace.manage'] - as it does every non-super role. So READING a
  // person's notes is legitimately within this role's authority, and the
  // vendorNotesVisible=false branch is unreachable for every role that exists
  // today.
  //
  // The guard is KEPT rather than deleted, because it fails closed on a
  // permission that a future role might not carry, and because deleting it
  // would mean such a role silently gets a person's notes. It is exercised
  // directly by a unit test, which can supply a role the product does not have.
  //
  // What IS reachable, and what actually matters, is the write boundary below.
  check('reading a person\'s notes is within the role\'s real authority (users.read)',
    limited.data?.vendorNotesVisible === true && limited.data?.vendor?.length === 1,
    JSON.stringify({ visible: limited.data?.vendorNotesVisible, count: limited.data?.vendor?.length }));

  const blocked = await post('admin.addEnquiryNote',
    { scope: 'vendor', rfqId: r1, vendorId: v1, note: 'should not be written' }, marketplace.cookie);
  check('BUT WRITING ONE IS REFUSED - users.manage is not in this role',
    blocked.status === 403, `HTTP ${blocked.status}`);
  const stillTwo = Number(sql(`SELECT COUNT(*) FROM adminNotes WHERE subjectType = 'user' AND subjectId = ${v1};`));
  check('and nothing was written despite the attempt', stillTwo === 1, `${stillTwo} vendor notes`);
}

// ── Assignment and its notification (§13/§14) ─────────────────────────────
//
// An assignment is the one piece of enquiry state that is NOT derived - nothing
// in the domain records which administrator is working an enquiry - so it has a
// table, append-only. What is checked here is that the table really is
// append-only, that an ineligible assignee is refused, and that the notified
// person gets a TRANSLATABLE message rather than a stored English sentence.

const admins = await get('admin.assignableAdmins', {}, admin.cookie);
check('the assignable list contains the signed-in Super Admin',
  Array.isArray(admins.data) && admins.data.some(person => person.id === 1),
  `${admins.data?.length ?? 0} assignable`);

// A deactivated administrator must not be offered: a queue assigned to someone
// who cannot sign in is a queue nobody is working.
const frozenEmail = 'zg-ed-frozen@buildhub.local';
sql(`DELETE FROM users WHERE email = '${frozenEmail}';`);
sql(`INSERT INTO users (openId, email, name, role, adminRole, accountStatus, passwordHash, isDummy, deactivatedAt)
     VALUES ('zg-ed-frozen', '${frozenEmail}', 'Deactivated Admin', 'admin', 'SUPPORT_ADMIN', 'active', '${adminHash}', 0, NOW());`);
const frozenId = Number(sql(`SELECT id FROM users WHERE email = '${frozenEmail}';`));
const afterFrozen = await get('admin.assignableAdmins', {}, admin.cookie);
check('A DEACTIVATED ADMINISTRATOR IS NOT OFFERED AS AN ASSIGNEE',
  !afterFrozen.data?.some(person => person.id === frozenId));
const refused = await post('admin.assignEnquiry',
  { rfqId: r1, vendorId: v1, assigneeId: frozenId }, admin.cookie);
check('and assigning to them is refused server-side, not merely hidden',
  refused.status === 400, `HTTP ${refused.status}`);
check('nothing was written by the refused attempt',
  Number(sql(`SELECT COUNT(*) FROM enquiryAssignments WHERE rfqId = ${r1};`)) === 0);

const assigned = await post('admin.assignEnquiry', { rfqId: r1, vendorId: v1, assigneeId: 1 }, admin.cookie);
check('an enquiry can be assigned to a real administrator', assigned.status === 200 && assigned.data?.success === true,
  `HTTP ${assigned.status}`);
check('the assignment is stored', Number(sql(`SELECT COUNT(*) FROM enquiryAssignments WHERE rfqId = ${r1} AND assigneeId = 1;`)) === 1);
check('the assignee is told', assigned.data?.notified === true);

const notified = sql(`SELECT messageKey FROM notifications WHERE userId = 1 ORDER BY id DESC LIMIT 1;`);
check('THE NOTIFICATION CARRIES A messageKey, so the sentence is translated not stored in English',
  notified === 'notif.enquiry.assigned', notified);
const notifiedBody = sql(`SELECT messageParams FROM notifications WHERE userId = 1 ORDER BY id DESC LIMIT 1;`);
check('and its params name the enquiry by reference', notifiedBody.includes(`ENQ-${r1}-${v1}`), notifiedBody);
check('the notification carries no email address or credential',
  !/@buildhub\.local|scrypt\$/.test(notifiedBody), notifiedBody);

const detailAssigned = await get('admin.enquiryDetail', { reference }, admin.cookie);
check('the detail reports the current assignee', detailAssigned.data?.assignment?.assigneeId === 1);

const again = await post('admin.assignEnquiry', { rfqId: r1, vendorId: v1, assigneeId: 1 }, admin.cookie);
check('RE-ASSIGNING TO THE SAME PERSON WRITES NOTHING and notifies nobody',
  again.data?.notified === false
  && Number(sql(`SELECT COUNT(*) FROM enquiryAssignments WHERE rfqId = ${r1};`)) === 1);

const released = await post('admin.assignEnquiry', { rfqId: r1, vendorId: v1, assigneeId: null }, admin.cookie);
check('unassigning succeeds', released.status === 200);
check('UNASSIGNING APPENDS A ROW rather than deleting the history',
  Number(sql(`SELECT COUNT(*) FROM enquiryAssignments WHERE rfqId = ${r1};`)) === 2,
  sql(`SELECT COUNT(*) FROM enquiryAssignments WHERE rfqId = ${r1};`));
check('and nobody is notified of an unassignment', released.data?.notified === false);

const detailReleased = await get('admin.enquiryDetail', { reference }, admin.cookie);
check('the detail now shows no assignee', detailReleased.data?.assignment === null);
check('but still records THAT it was released, with a time',
  !!detailReleased.data?.lastAssignmentEvent?.at && detailReleased.data.lastAssignmentEvent.assigneeId === null);

const assignMissing = await post('admin.assignEnquiry',
  { rfqId: 99999999, vendorId: v1, assigneeId: 1 }, admin.cookie);
check('assigning a pair that is not an enquiry is refused', assignMissing.status === 404,
  `HTTP ${assignMissing.status}`);

const listWithAssignee = await get('admin.enquiryList', { rfqId: r1 }, admin.cookie);
check('the list reports the assignee per row (unassigned here, honestly)',
  listWithAssignee.data?.rows?.[0]?.assigneeId === null
  && 'assigneeName' in (listWithAssignee.data?.rows?.[0] ?? {}));

// ── Honest absence ────────────────────────────────────────────────────────

const missing = await get('admin.enquiryDetail', { rfqId: r1, vendorId: 99999999 }, admin.cookie);
check('a pair with no history is NOT FOUND, not an empty shell', missing.status === 404,
  `HTTP ${missing.status}`);
const malformed = await get('admin.enquiryDetail', { reference: 'not-a-reference' }, admin.cookie);
check('a malformed reference is refused rather than guessed at', malformed.status === 400,
  `HTTP ${malformed.status}`);

// ── Cleanup ───────────────────────────────────────────────────────────────
clean();
sql("DELETE FROM users WHERE email IN ('zg-ed-marketplace@buildhub.local', 'zg-ed-frozen@buildhub.local');");
check('the fixture removed itself completely',
  Number(sql("SELECT COUNT(*) FROM users WHERE openId LIKE 'zg-ed-%';")) === 0);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

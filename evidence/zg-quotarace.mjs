/**
 * ── THE ALLOWANCE HOLDS WHEN EIGHT REQUESTS ARRIVE AT ONCE ───────────────
 *
 * A qualified enquiry is the thing a supplier pays for. The rule is that a
 * plan grants N of them a month and the N+1th is refused, and the product
 * enforces it with a range lock inside a transaction - SELECT ... FOR UPDATE
 * over that vendor's rows for the month, then the insert.
 *
 * Every existing test of this reads the SOURCE. One of them asserts the string
 * ".for('update')" appears in the function. That is worth having and it is not
 * the same claim: a lock taken over the wrong rows, or released before the
 * insert, or defeated by the isolation level, looks identical in a grep. The
 * only way to know a lock works is to make two transactions want it.
 *
 * So this runs the real function against the real database, eight times at
 * once, on eight different requests so that nothing is deduplicated by the
 * unique index. A vendor on the free plan may open five. Exactly five have to
 * be granted, and the meter has to read five afterwards.
 *
 * RUN AGAINST THE MODULE, not over HTTP, deliberately. The race lives in the
 * database transaction; putting a session and a router in front of it would
 * add two things that cannot fail in an interesting way and make the timing
 * harder to line up.
 */
import { execSync } from 'node:child_process';
import { openQualifiedEnquiry, getEnquiryUsage } from '../server/billing/enquiries.ts';

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const CATEGORY = 'Materials';
const ALLOWANCE = 5;      // the free plan's qualifiedEnquiriesPerMonth
const ATTEMPTS = 8;
const stamp = Date.now().toString(36);

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zrace%') as probe)`;
  for (const statement of [
    `delete from qualifiedEnquiries where userId in ${ids}`,
    `delete from vendorCategories where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from users where username like 'zrace%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

function makeUser(name, role, userRole) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${name}', '${name}', '${name}@example.test', 'Probe ${name}', '${role}',
        '${userRole}', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  return Number(sql(`select id from users where username='${name}'`));
}

try {
  cleanUp();
  const vendorId = makeUser(`zraceV${stamp}`, 'user', 'supplier');
  const buyerId = makeUser(`zraceB${stamp}`, 'user', 'homeowner');
  sql(`insert into vendorCategories (userId, category) values (${vendorId}, '${CATEGORY}')`);
  check(vendorId > 0 && buyerId > 0, 'SETUP: a supplier who works in ' + CATEGORY, `vendor ${vendorId}`);

  const values = Array.from({ length: ATTEMPTS }, (_, i) =>
    `(${buyerId}, 'Race request ${i}', '${CATEGORY}', 'open')`).join(',');
  sql(`insert into rfqs (requesterId, title, category, status) values ${values}`);
  const rfqIds = sql(`select id from rfqs where requesterId=${buyerId} order by id`).split('\n').map(Number);
  check(rfqIds.length === ATTEMPTS, `and ${ATTEMPTS} separate open requests they are eligible for`,
    `ids ${rfqIds[0]}..${rfqIds[rfqIds.length - 1]}`);

  const startingAllowance = (await getEnquiryUsage(vendorId)).allowance;
  check(startingAllowance === ALLOWANCE,
    'and an allowance this probe knows the size of', `${startingAllowance} a month`);

  /*
   * FIRED TOGETHER. Promise.all starts all eight before any of them awaits a
   * database round trip, which is what makes them contend for the same lock.
   * Issuing them in a loop with an await would test nothing.
   */
  const results = await Promise.all(rfqIds.map(id => openQualifiedEnquiry(vendorId, id)
    .then(r => r.outcome, error => `threw:${String(error).slice(0, 60)}`)));

  const granted = results.filter(r => r === 'granted').length;
  const refused = results.filter(r => r === 'limit_reached').length;
  const threw = results.filter(r => typeof r === 'string' && r.startsWith('threw:'));

  check(threw.length === 0, 'none of the eight fails with an error',
    threw.length ? threw[0] : 'all eight answered');

  check(granted === ALLOWANCE, `exactly ${ALLOWANCE} are granted, not more`,
    `${granted} granted, ${refused} refused, ${results.length - granted - refused} other`);

  check(refused === ATTEMPTS - ALLOWANCE, 'and the rest are refused for the right reason',
    `${refused} reported limit_reached`);

  /*
   * THE METER, read back from the database rather than from the return values.
   * A function that reports five grants while writing eight rows has failed at
   * the only thing that matters here.
   */
  const stored = Number(sql(`select count(*) from qualifiedEnquiries where userId=${vendorId}`));
  check(stored === ALLOWANCE, 'and the database holds exactly that many', `${stored} rows`);

  const usage = await getEnquiryUsage(vendorId);
  check(usage.used === ALLOWANCE && usage.limitReached === true,
    'and the vendor is told their allowance is spent',
    `used ${usage.used} of ${usage.allowance}, limitReached ${usage.limitReached}`);

  // ── The ninth, on its own, is still refused ────────────────────────────
  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyerId}, 'Race request late', '${CATEGORY}', 'open')`);
  const lateId = Number(sql(`select id from rfqs where requesterId=${buyerId} order by id desc limit 1`));
  const late = await openQualifiedEnquiry(vendorId, lateId);
  check(late.outcome === 'limit_reached', 'a later request, with no race at all, is refused too',
    String(late.outcome));

  const afterLate = Number(sql(`select count(*) from qualifiedEnquiries where userId=${vendorId}`));
  check(afterLate === ALLOWANCE, 'and wrote nothing', `${afterLate} rows`);

  /*
   * THE POSITIVE CONTROL. Everything above is satisfied by a product that
   * refuses everything, so one of the spent credits is released and the next
   * request must then be granted. Without this, "exactly five" and "always
   * zero" are the same result to this probe.
   */
  sql(`delete from qualifiedEnquiries where userId=${vendorId} order by id desc limit 1`);
  const afterRelease = await openQualifiedEnquiry(vendorId, lateId);
  check(afterRelease.outcome === 'granted',
    'POSITIVE: with one credit back, the same request is granted',
    String(afterRelease.outcome));
} finally {
  cleanUp();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

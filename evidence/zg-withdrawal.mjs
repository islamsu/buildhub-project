/**
 * ── A SUPPLIER TAKING THEIR PRICE BACK ──────────────────────────────────
 *
 * A supplier could not withdraw a bid. The three states a quotation had were
 * all the customer's decision - pending, accepted, rejected - so a firm whose
 * costs moved could only revise to a number nobody would accept, which leaves
 * a price on the board the customer may still hold them to.
 *
 * What is proved here, against the real database, is the whole rule and not
 * just the happy path:
 *
 *   the author can, while it is pending
 *   nobody else can, and is not told the quotation exists
 *   an accepted one cannot be withdrawn - that is a dispute
 *   a withdrawn one cannot be accepted afterwards
 *   and accepting somebody else's bid does not re-label it "rejected"
 *
 * That last one is the reason this exists as a probe rather than a unit test.
 * The acceptance cascade sets every OTHER quotation on the request to
 * rejected, and a withdrawn bid swept into that would tell a supplier their
 * own withdrawal was "not selected" - a decision the customer never made,
 * with a losing-bid notification to match.
 */
import { execSync } from 'node:child_process';
import { withdrawQuotationSecure } from '../server/quotationWithdrawal.ts';
import { acceptQuotationSecure } from '../server/quotationWorkflow.ts';

const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const failed = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const stamp = Date.now().toString(36);

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zwd%') as probe)`;
  const rfqIds = `(select id from (select id from rfqs where requesterId in ${ids}) as r)`;
  for (const statement of [
    `delete from fieldValueHistory where actorId in ${ids} or ownerId in ${ids}`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from analyticsEvents where userId in ${ids}`,
    `delete from quotations where rfqId in ${rfqIds}`,
    `delete from rfqs where requesterId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zwd%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

function makeUser(name, userRole) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-${name}', '${name}', '${name}@example.test', 'Probe ${name}', 'user',
        '${userRole}', 'password', 'self_registered', 0, 'active', 'approved', 1)`);
  return Number(sql(`select id from users where username='${name}'`));
}

const bid = (rfqId, providerId, price) => {
  sql(`insert into quotations (rfqId, providerId, price, currency, validUntil, status)
       values (${rfqId}, ${providerId}, ${price}, 'EGP', date_add(now(), interval 30 day), 'pending')`);
  return Number(sql(`select id from quotations where rfqId=${rfqId} and providerId=${providerId} order by id desc limit 1`));
};
const statusOf = id => sql(`select status from quotations where id=${id}`);

try {
  cleanUp();
  const buyer = makeUser(`zwdB${stamp}`, 'homeowner');
  const supplierA = makeUser(`zwdA${stamp}`, 'supplier');
  const supplierB = makeUser(`zwdC${stamp}`, 'supplier');
  check(buyer > 0 && supplierA > 0 && supplierB > 0,
    'SETUP: a customer and two suppliers', `${buyer}, ${supplierA}, ${supplierB}`);

  sql(`insert into rfqs (requesterId, title, category, status)
       values (${buyer}, 'Withdrawal probe request', 'Materials', 'open')`);
  const rfqId = Number(sql(`select id from rfqs where requesterId=${buyer} order by id desc limit 1`));
  const bidA = bid(rfqId, supplierA, 1000);
  const bidB = bid(rfqId, supplierB, 1200);
  check(rfqId > 0 && bidA > 0 && bidB > 0, 'and two live bids on one open request',
    `rfq ${rfqId}, bids ${bidA} and ${bidB}`);

  // ── Nobody else may withdraw it ─────────────────────────────────────────
  const byStranger = await failed(() => withdrawQuotationSecure(bidA, supplierB, null));
  check(byStranger !== null, 'NEGATIVE: another supplier cannot withdraw it',
    byStranger ? String(byStranger.message).slice(0, 60) : 'it succeeded');
  check(byStranger !== null && /not found/i.test(byStranger.message),
    'and is told it does not exist, not that it is forbidden',
    byStranger ? byStranger.message : '');
  check(statusOf(bidA) === 'pending', 'and the bid is untouched', statusOf(bidA));

  const byCustomer = await failed(() => withdrawQuotationSecure(bidA, buyer, null));
  check(byCustomer !== null, 'NEGATIVE: the customer cannot withdraw it either',
    byCustomer ? String(byCustomer.message).slice(0, 50) : 'it succeeded');

  // ── The author can ──────────────────────────────────────────────────────
  const result = await withdrawQuotationSecure(bidA, supplierA, 'Material costs moved');
  check(statusOf(bidA) === 'withdrawn', 'POSITIVE: the supplier who bid can withdraw it', statusOf(bidA));
  check(result.rfqId === rfqId, 'and is told which request it was on', `rfq ${result.rfqId}`);

  const audit = sql(`select concat_ws('|', action, actorId, ownerId, detail) from commercialAuditEvents
                     where subjectType='quotation' and subjectId=${bidA} order by id desc limit 1`);
  check(audit.startsWith(`quotation_withdrawn|${supplierA}|${supplierA}`),
    'and the commercial trail records who and why', audit || 'no row');

  const history = sql(`select concat_ws('|', oldValue, newValue, actorId, reason) from fieldValueHistory
                       where subjectType='quotation' and subjectId=${bidA} order by id desc limit 1`);
  check(history.startsWith('pending|withdrawn|' + supplierA),
    'and the field history holds the old value and the new one', history || 'no row');

  const told = Number(sql(`select count(*) from notifications where userId=${buyer}`));
  check(told > 0, 'and the customer is told', `${told} notification(s)`);

  // ── It cannot be withdrawn twice, or accepted afterwards ────────────────
  const again = await failed(() => withdrawQuotationSecure(bidA, supplierA, null));
  check(again !== null, 'NEGATIVE: it cannot be withdrawn twice',
    again ? String(again.message).slice(0, 60) : 'it succeeded');

  const acceptWithdrawn = await failed(() => acceptQuotationSecure(rfqId, bidA, buyer));
  check(acceptWithdrawn !== null, 'NEGATIVE: a withdrawn bid cannot then be accepted',
    acceptWithdrawn ? String(acceptWithdrawn.message).slice(0, 60) : 'it succeeded');
  check(statusOf(bidA) === 'withdrawn', 'and it stays withdrawn', statusOf(bidA));

  // ── THE CASCADE. Accepting the other bid must leave it alone ────────────
  await acceptQuotationSecure(rfqId, bidB, buyer);
  check(statusOf(bidB) === 'accepted', 'POSITIVE: the remaining bid can still be accepted', statusOf(bidB));
  check(statusOf(bidA) === 'withdrawn',
    'and the withdrawn one is NOT swept into "rejected" by the award', statusOf(bidA));

  const falseRejection = sql(`select count(*) from fieldValueHistory
                              where subjectType='quotation' and subjectId=${bidA} and newValue='rejected'`);
  check(Number(falseRejection) === 0,
    'and no history row claims the customer rejected it', `${falseRejection} such rows`);

  // ── An accepted bid is an agreement, not a thing to walk away from ──────
  const afterAccept = await failed(() => withdrawQuotationSecure(bidB, supplierB, null));
  check(afterAccept !== null && /dispute/i.test(afterAccept.message),
    'NEGATIVE: an accepted quotation is a dispute, not a withdrawal',
    afterAccept ? afterAccept.message.slice(0, 70) : 'it succeeded');
  check(statusOf(bidB) === 'accepted', 'and it stays accepted', statusOf(bidB));
} finally {
  cleanUp();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

/**
 * ── WHAT IS WRONG WITH THE DATA RIGHT NOW (Part 49) ────────────────────────
 *
 * Every check here answers a question an operator would actually ask before a
 * launch, and every answer is a COUNT OF REAL ROWS. Nothing is scored,
 * weighted, averaged into a "health percentage" or turned into a grade. A
 * data-quality screen that reports 94% has told the reader nothing they can
 * act on and has invented the 94.
 *
 * THREE RULES THIS FILE EXISTS TO HOLD:
 *
 *   IDS, NEVER VALUES. A sample is a list of record ids and nothing else. The
 *   read is `audit.read`, which USER_ADMIN holds, and a duplicate-email check
 *   that returned the addresses would be a way to enumerate account emails
 *   through a screen that is not the user directory. The administrator can look
 *   the id up wherever they are already entitled to.
 *
 *   ZERO IS ZERO, NOT "HEALTHY". Each check reports its count. The renderer is
 *   forbidden from turning 0 into a green tick, because "no rows matched" and
 *   "this question was asked and the answer is fine" are the same sentence only
 *   when the query is right, and the point of showing the count is that the
 *   reader can tell.
 *
 *   SEEDED QA DATA IS NOT A DEFECT. `includeDummy` defaults to false, the same
 *   convention analyticsSummary and commercialKpis already use. A screen that
 *   counts the QA fixtures as broken records is worse than no screen, because
 *   the operator learns to ignore it.
 *
 * The counts are exact - a COUNT(*) over the same predicate that produces the
 * sample, not the length of a truncated page.
 */

import { sql, type SQL } from 'drizzle-orm';
import { getComplianceRequirements } from '../../shared/compliance';
import { getDb } from '../db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** How many example ids travel with a check. The COUNT is always the full one. */
export const SAMPLE_LIMIT = 20;

/**
 * How bad is it? Deliberately three plain words rather than a number, because
 * a number invites arithmetic across unrelated checks and there is no honest
 * way to add "two duplicate accounts" to "nine stale bids".
 */
export type Severity = 'high' | 'medium' | 'low';

/** What the sampled ids are ids OF, so the console can link to the record. */
export type CheckSubject = 'user' | 'rfq' | 'quotation' | 'product' | 'notification' | 'history';

export type DataQualityCheck = {
  key: string;
  severity: Severity;
  subject: CheckSubject;
  count: number;
  sampleIds: number[];
};

/**
 * Run one predicate twice: once counted, once sampled.
 *
 * `rows` must be a complete SELECT producing a single column named `id`. Both
 * queries wrap the SAME fragment, so the count can never describe a different
 * population from the sample - which is the failure mode of every
 * "showing 20 of ~340" panel that computes the two separately.
 */
async function countAndSample(db: Db, rows: SQL): Promise<{ count: number; sampleIds: number[] }> {
  const [countRows] = await db.execute<{ c: number }>(sql`select count(*) as c from (${rows}) as q`);
  const [sampleRows] = await db.execute<{ id: number }>(
    sql`select id from (${rows}) as q order by id desc limit ${SAMPLE_LIMIT}`,
  );
  const first = (countRows as unknown as { c: number | string }[])[0];
  return {
    count: Number(first?.c ?? 0),
    sampleIds: (sampleRows as unknown as { id: number | string }[]).map(row => Number(row.id)),
  };
}

/**
 * "and this row's owner is not a QA persona", or nothing at all.
 *
 * Written as a fragment rather than a boolean flag threaded through every query
 * so that a check which forgets it is visibly missing the clause rather than
 * silently defaulting to including QA data.
 */
export function notDummy(alias: string, includeDummy: boolean): SQL {
  return includeDummy ? sql`` : sql`and ${sql.raw(alias)}.isDummy = 0`;
}

type CheckDefinition = {
  key: string;
  severity: Severity;
  subject: CheckSubject;
  run: (db: Db, includeDummy: boolean) => Promise<{ count: number; sampleIds: number[] }>;
};

/**
 * A provider is approved to trade but a document the platform REQUIRES of their
 * role has never been approved.
 *
 * Computed in TypeScript rather than SQL on purpose: the requirement list lives
 * in shared/compliance.ts and differs per role, and encoding it a second time
 * in a query is how the two drift apart. `getComplianceRequirements` is the
 * same function the compliance queue and the applicant screen use, so this
 * check cannot disagree with what the reviewer was shown.
 */
const approvedProviderMissingDocument: CheckDefinition = {
  key: 'approved_provider_missing_required_document',
  severity: 'high',
  subject: 'user',
  run: async (db, includeDummy) => {
    const [providerRows] = await db.execute<{ id: number; userRole: string }>(sql`
      select u.id as id, u.userRole as userRole
      from users u
      where u.onboardingStatus = 'approved'
        and u.userRole in ('contractor', 'engineer', 'architect', 'supplier', 'project_manager')
        ${notDummy('u', includeDummy)}
    `);
    const providers = providerRows as unknown as { id: number | string; userRole: string }[];
    if (providers.length === 0) return { count: 0, sampleIds: [] };

    const [documentRows] = await db.execute<{ userId: number; documentType: string }>(sql`
      select d.userId as userId, d.documentType as documentType
      from registrationDocuments d
      where d.status = 'approved'
    `);
    const approvedTypes = new Map<number, Set<string>>();
    for (const row of documentRows as unknown as { userId: number | string; documentType: string }[]) {
      const key = Number(row.userId);
      if (!approvedTypes.has(key)) approvedTypes.set(key, new Set());
      approvedTypes.get(key)!.add(row.documentType);
    }

    const offending = providers
      .filter(provider => {
        const held = approvedTypes.get(Number(provider.id)) ?? new Set<string>();
        return getComplianceRequirements(provider.userRole)
          .filter(requirement => requirement.required)
          .some(requirement => !held.has(requirement.type));
      })
      .map(provider => Number(provider.id));

    return {
      count: offending.length,
      sampleIds: offending.sort((a, b) => b - a).slice(0, SAMPLE_LIMIT),
    };
  },
};

/** A predicate expressed directly as SQL, which is most of them. */
function sqlCheck(
  key: string,
  severity: Severity,
  subject: CheckSubject,
  rows: (includeDummy: boolean) => SQL,
): CheckDefinition {
  return { key, severity, subject, run: (db, includeDummy) => countAndSample(db, rows(includeDummy)) };
}

/**
 * THE CHECKS. Each one is a question with an owner and a fix, not a metric.
 */
const CHECKS: CheckDefinition[] = [
  approvedProviderMissingDocument,

  // Still accepting bids after the date the customer said they needed it by.
  // Suppliers are spending their monthly allowance on it.
  sqlCheck('rfq_open_past_deadline', 'medium', 'rfq', includeDummy => sql`
    select r.id as id
    from rfqs r
    join users u on u.id = r.requesterId
    where r.status = 'open'
      and r.deadline is not null
      and r.deadline < now()
      ${notDummy('u', includeDummy)}
  `),

  // A bid left saying "pending" on a request that has already been awarded or
  // closed. The supplier's own dashboard tells them they are still in the
  // running; nobody is going to read their bid.
  sqlCheck('quotation_pending_on_settled_rfq', 'medium', 'quotation', includeDummy => sql`
    select q.id as id
    from quotations q
    join rfqs r on r.id = q.rfqId
    join users u on u.id = q.providerId
    where q.status = 'pending'
      and r.status in ('closed', 'awarded')
      ${notDummy('u', includeDummy)}
  `),

  // A notification whose deep link points at a record that is not there. The
  // recipient clicks it and lands on an error - which is exactly the failure
  // the deep-link work was meant to eliminate, so it is worth counting rather
  // than assuming.
  //
  // The four link shapes below are the four this product actually emits, each
  // matched with an anchored pattern so a link carrying a query string is not
  // silently cast to a wrong id. `/compliance` carries no id and needs no check.
  //
  // NO LITERAL `?` APPEARS IN THIS QUERY, and that is not a style choice.
  // mysql2 prepares statements by substituting `?`, so a question mark inside a
  // regex string is consumed as a bind placeholder and the real parameters
  // shift by one - which is how `limit ?` at the end of this fragment became a
  // syntax error the first time it was written. `/messages?to=N` is therefore
  // matched with LIKE plus a numeric test on the tail rather than a pattern
  // containing the character.
  sqlCheck('notification_link_target_missing', 'high', 'notification', includeDummy => sql`
    select n.id as id
    from notifications n
    join users u on u.id = n.userId
    where (
        (n.link rlike '^/rfq/[0-9]+$'
          and not exists (select 1 from rfqs r where r.id = cast(substring(n.link, 6) as unsigned)))
     or (n.link rlike '^/quotations/[0-9]+$'
          and not exists (select 1 from quotations q where q.id = cast(substring(n.link, 13) as unsigned)))
     or (n.link rlike '^/marketplace/products/[0-9]+$'
          and not exists (select 1 from products p where p.id = cast(substring(n.link, 23) as unsigned)))
     or (n.link like '/messages%to=%'
          and substring_index(n.link, 'to=', -1) rlike '^[0-9]+$'
          and not exists (select 1 from users t where t.id = cast(substring_index(n.link, 'to=', -1) as unsigned)))
      )
      ${notDummy('u', includeDummy)}
  `),

  // fieldValueHistory.subjectId is deliberately NOT a foreign key - the history
  // has to be able to outlive the record it describes - so nothing in the
  // database enforces that the subject exists. This is the only thing that can
  // notice when it stops existing, which is precisely why it is here.
  sqlCheck('history_subject_missing', 'low', 'history', includeDummy => sql`
    select h.id as id
    from fieldValueHistory h
    left join users u on u.id = h.ownerId
    where (
        (h.subjectType = 'rfq' and not exists (select 1 from rfqs r where r.id = h.subjectId))
     or (h.subjectType = 'quotation' and not exists (select 1 from quotations q where q.id = h.subjectId))
     or (h.subjectType = 'product' and not exists (select 1 from products p where p.id = h.subjectId))
     or (h.subjectType = 'user' and not exists (select 1 from users hu where hu.id = h.subjectId))
     or (h.subjectType = 'subscription' and not exists (select 1 from vendorSubscriptions s where s.id = h.subjectId))
      )
      ${includeDummy ? sql`` : sql`and (u.id is null or u.isDummy = 0)`}
  `),

  // Two accounts holding the same email address. BuildHub signs people in by
  // email, so this is an authentication question, not a tidiness one.
  //
  // `users.email` CARRIES A UNIQUE INDEX, so this is not a check for something
  // the database already forbids - and it is not vacuous either. The index
  // compares the stored bytes: ' dupe@example.test' and 'dupe@example.test'
  // both insert cleanly (verified against MariaDB 10.11, not assumed), and this
  // check normalises with trim() and lower() so it finds exactly the pairs the
  // index lets through. It is also the guard that survives if the constraint
  // is ever dropped in a migration.
  sqlCheck('duplicate_account_email', 'high', 'user', includeDummy => sql`
    select u.id as id
    from users u
    join (
      select lower(trim(email)) as normalised
      from users
      where email is not null and trim(email) <> ''
        ${notDummy('users', includeDummy)}
      group by lower(trim(email))
      having count(*) > 1
    ) d on lower(trim(u.email)) = d.normalised
    where u.email is not null
      ${notDummy('u', includeDummy)}
  `),

  // Two accounts on one phone number. Not automatically wrong - a firm and its
  // owner can share a line - which is why this is reported rather than blocked,
  // and why it is 'medium'.
  sqlCheck('duplicate_account_phone', 'medium', 'user', includeDummy => sql`
    select u.id as id
    from users u
    join (
      select trim(phone) as normalised
      from users
      where phone is not null and trim(phone) <> ''
        ${notDummy('users', includeDummy)}
      group by trim(phone)
      having count(*) > 1
    ) d on trim(u.phone) = d.normalised
    where u.phone is not null
      ${notDummy('u', includeDummy)}
  `),

  // On sale in the catalogue with no price a buyer can see.
  sqlCheck('active_product_without_price', 'medium', 'product', includeDummy => sql`
    select p.id as id
    from products p
    join users u on u.id = p.supplierId
    where p.active = 1
      and (p.price is null or p.price <= 0)
      ${notDummy('u', includeDummy)}
  `),

  // A supplier account that was approved and then frozen, still holding live
  // catalogue listings. The listings stay visible; the seller cannot answer.
  sqlCheck('active_product_of_frozen_supplier', 'high', 'product', includeDummy => sql`
    select p.id as id
    from products p
    join users u on u.id = p.supplierId
    where p.active = 1
      and u.accountStatus = 'frozen'
      ${notDummy('u', includeDummy)}
  `),
];

/** The keys this module reports, in order. Exported so a test can pin the set. */
export const DATA_QUALITY_CHECK_KEYS = CHECKS.map(check => check.key);

/**
 * Run every check.
 *
 * A check that throws is reported as a check that threw - `count: null` - and
 * never as zero. Silently turning a broken query into "nothing wrong here" is
 * the one outcome this screen must not be capable of.
 */
export type DataQualityResult = Omit<DataQualityCheck, 'count'> & { count: number | null };

export async function runDataQualityChecks(
  db: Db,
  includeDummy: boolean,
): Promise<DataQualityResult[]> {
  const results: DataQualityResult[] = [];
  for (const check of CHECKS) {
    try {
      const outcome = await check.run(db, includeDummy);
      results.push({
        key: check.key,
        severity: check.severity,
        subject: check.subject,
        count: outcome.count,
        sampleIds: outcome.sampleIds,
      });
    } catch (error) {
      console.error(`[dataQuality] ${check.key} failed:`, error);
      results.push({ key: check.key, severity: check.severity, subject: check.subject, count: null, sampleIds: [] });
    }
  }
  return results;
}

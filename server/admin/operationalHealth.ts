/**
 * ── IS THIS DEPLOYMENT ACTUALLY WORKING? (Part 50) ─────────────────────────
 *
 * An operational health screen is the easiest place in a product to lie, and
 * the lies are all the same lie: a green tick with nothing behind it. So this
 * module reports four kinds of fact and refuses to report anything else.
 *
 *   WHAT BUILD IS THIS. `buildCommit()` - the SAME function `/version` serves,
 *   not a second copy - so the console and the staging gate can never disagree
 *   about which commit is running.
 *
 *   IS THE DATABASE THERE. A real `select 1`, timed, behind a timeout. Not a
 *   cached flag, not "the last request succeeded".
 *
 *   WHICH DEPENDENCIES ARE CONFIGURED - as BOOLEANS AND NOTHING ELSE. Never a
 *   host, a bucket, a region, a key, a URL, a username or a driver error
 *   string. SMTP and object storage are genuinely unset on this project's
 *   staging environment, and a screen that rendered them green would be exactly
 *   the fabricated assurance this whole audit exists to prevent. Unset reads as
 *   NOT CONFIGURED, which is a true and useful statement.
 *
 *   HOW MUCH IS IN THERE AND WHAT IS PILING UP. Row counts and backlog counts,
 *   each a COUNT(*) of real rows.
 *
 * WHAT IS DELIBERATELY ABSENT, and is stated as absent on the screen rather
 * than omitted quietly: uptime, error rate, request latency, throughput, queue
 * depth, cache hit rate. BuildHub persists none of them. Every one of those
 * numbers would have to be invented, and an invented operational metric is
 * worse than a missing one - a missing number sends someone to look, and a
 * plausible fabricated number stops them looking.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { buildCommit } from '../_core/health';
import { isMailerConfigured } from '../_core/mailer';
import { isObjectStorageConfigured } from '../_core/objectStorage';
import { isAiConfigured } from '../_core/ai';
import { getDb } from '../db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Same cap as the readiness probe: a hung connection must not hang the page. */
const DB_PROBE_TIMEOUT_MS = 2_000;

export type DependencyState = {
  key: 'smtp' | 'objectStorage' | 'ai';
  /**
   * Configured or not. A BOOLEAN, never the value. Whoever reads this screen
   * cannot learn the SMTP host, the bucket name or one character of a key from
   * it - see the module comment; this is the field that guarantee lives in.
   */
  configured: boolean;
  /**
   * What stops working when it is false. Plain, and true - "password reset
   * cannot send" rather than "degraded".
   */
  affects: string;
};

export type OperationalHealth = {
  commit: string;
  database: { reachable: boolean; probeMs: number | null };
  migrations: { recorded: number | null; expected: number | null; atHead: boolean | null };
  dependencies: DependencyState[];
  volumes: Record<string, number>;
  backlogs: Record<string, number>;
  /** The questions this screen does NOT answer, named so nobody assumes it does. */
  notMeasured: string[];
};

/**
 * WHAT THIS SCREEN CANNOT TELL YOU.
 *
 * Rendered on the page. Listing the gaps is the honest alternative to filling
 * them with numbers that would have to be made up.
 */
export const NOT_MEASURED = [
  'uptime',
  'request_error_rate',
  'request_latency',
  'throughput',
  'background_queue_depth',
] as const;

async function probeDatabase(db: Db): Promise<{ reachable: boolean; probeMs: number | null }> {
  const started = Date.now();
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('database probe timed out')), DB_PROBE_TIMEOUT_MS),
      ),
    ]);
    return { reachable: true, probeMs: Date.now() - started };
  } catch (error) {
    // Logged for the operator, never returned: a driver error carries the host
    // and sometimes the credentials.
    console.error('[operationalHealth] database probe failed:', error);
    return { reachable: false, probeMs: null };
  }
}

/**
 * How many migrations this build EXPECTS, read from drizzle's journal.
 *
 * The journal ships in the deployed image (the Dockerfile copies `drizzle/`),
 * so this is answerable at runtime. When it is not - an unusual layout, a
 * trimmed image - the answer is null and the screen says "unknown", because a
 * fabricated expectation would turn a healthy deployment into a false alarm or,
 * worse, an unhealthy one into a green tick.
 */
export function readExpectedMigrationCount(): number | null {
  try {
    const raw = readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8');
    const parsed = JSON.parse(raw) as { entries?: unknown[] };
    return Array.isArray(parsed.entries) ? parsed.entries.length : null;
  } catch {
    return null;
  }
}

/**
 * Is this database at the migration head?
 *
 * `recorded: null` means drizzle's bookkeeping table is not present at all -
 * a schema built by applying SQL directly, which is what several of this
 * project's local verification databases are. That is reported as "not
 * recorded", NOT as zero and NOT as behind: claiming a deployment is behind
 * when the evidence is simply absent would send someone to run a migration
 * that is already applied.
 *
 * `atHead` is null whenever either side is unknown. It is never defaulted to
 * true, which is the direction that would hide a half-migrated deployment.
 */
async function readMigrationState(db: Db, expected: number | null): Promise<OperationalHealth['migrations']> {
  try {
    const [present] = await db.execute<{ c: number }>(sql`
      select count(*) as c from information_schema.tables
      where table_schema = database() and table_name = '__drizzle_migrations'
    `);
    const exists = Number((present as unknown as { c: number | string }[])[0]?.c ?? 0) > 0;
    if (!exists) return { recorded: null, expected, atHead: null };

    const [rows] = await db.execute<{ c: number }>(sql`select count(*) as c from \`__drizzle_migrations\``);
    const recorded = Number((rows as unknown as { c: number | string }[])[0]?.c ?? 0);
    return { recorded, expected, atHead: expected === null ? null : recorded >= expected };
  } catch (error) {
    console.error('[operationalHealth] migration state unreadable:', error);
    return { recorded: null, expected, atHead: null };
  }
}

/**
 * Every count in one round trip.
 *
 * Scalar subqueries rather than nine separate queries: this screen is opened
 * during an incident, and nine sequential COUNT(*)s against a struggling
 * database is a page that takes ten seconds to tell you the database is slow.
 */
async function readCounts(db: Db): Promise<{ volumes: Record<string, number>; backlogs: Record<string, number> }> {
  const [rows] = await db.execute(sql`
    select
      (select count(*) from users)                                             as users_,
      (select count(*) from rfqs)                                              as rfqs_,
      (select count(*) from quotations)                                        as quotations_,
      (select count(*) from products)                                          as products_,
      (select count(*) from projects)                                          as projects_,
      (select count(*) from notifications where \`read\` = 0)                    as unreadNotifications,
      (select count(*) from disputes where status in ('open', 'investigating')) as openDisputes,
      (select count(*) from users where onboardingStatus = 'under_review')      as complianceQueue,
      (select count(*) from quotations where status = 'pending')               as pendingQuotations,
      (select count(*) from users where accountStatus = 'frozen')              as frozenAccounts
  `);
  const row = (rows as unknown as Record<string, number | string>[])[0] ?? {};
  const number = (key: string) => Number(row[key] ?? 0);
  return {
    volumes: {
      users: number('users_'),
      rfqs: number('rfqs_'),
      quotations: number('quotations_'),
      products: number('products_'),
      projects: number('projects_'),
    },
    backlogs: {
      unreadNotifications: number('unreadNotifications'),
      openDisputes: number('openDisputes'),
      complianceQueue: number('complianceQueue'),
      pendingQuotations: number('pendingQuotations'),
      frozenAccounts: number('frozenAccounts'),
    },
  };
}

export async function readOperationalHealth(db: Db): Promise<OperationalHealth> {
  const database = await probeDatabase(db);
  const expected = readExpectedMigrationCount();

  // Nothing below can run against an unreachable database, and returning
  // zeroes would read as "the platform is empty" rather than "we could not
  // ask". So the counts are skipped and the reachability flag carries the news.
  const [migrations, counts] = database.reachable
    ? await Promise.all([readMigrationState(db, expected), readCounts(db)])
    : [{ recorded: null, expected, atHead: null }, { volumes: {}, backlogs: {} }];

  return {
    commit: buildCommit(),
    database,
    migrations,
    dependencies: [
      { key: 'smtp', configured: isMailerConfigured(), affects: 'password reset and outbound email' },
      { key: 'objectStorage', configured: isObjectStorageConfigured(), affects: 'document upload, attachments and product images' },
      { key: 'ai', configured: isAiConfigured(), affects: 'the AI assistant' },
    ],
    volumes: counts.volumes,
    backlogs: counts.backlogs,
    notMeasured: [...NOT_MEASURED],
  };
}

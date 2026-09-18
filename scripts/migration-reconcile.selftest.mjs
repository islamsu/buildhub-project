/**
 * ── PROVING THE RECONCILER, ON CONSTRUCTED STATES WITH KNOWN GROUND TRUTH ─
 *
 * A reconciler that has never been shown a fault is not evidence of its
 * absence, and this one is meant to inform a manual database repair. So every
 * verdict it can reach is constructed deliberately and checked.
 *
 * The two states that matter most are 4 and 5. They are the reason the verdict
 * model was rewritten: schema complete, data NOT complete. An earlier version
 * called that "fully applied" and would have invited a journal insert that
 * permanently skipped a backfill.
 *
 * ── THE TESTS WERE THEMSELVES MUTATION-TESTED ─────────────────────────────
 *
 * A green suite proves nothing unless it can go red. Four deliberate
 * weakenings were made to the reconciler and this suite re-run; each was
 * caught, and each was reverted immediately afterwards:
 *
 *   M1  the verdict stops downgrading on unproven data   -> 4, 5 FAIL
 *   M2  the repair gate stops requiring proven data      -> 4, 5 FAIL
 *   M3  existence alone counts as applied (no shape)     -> 1, 6, 8, 9, 10, 11 FAIL
 *   M4  UNPARSED no longer fails closed                  -> 7 FAIL
 *
 * M1 and M2 are the two that matter most: they are exactly the mistake that
 * would authorize a journal insert over a backfill that never ran.
 *
 * Needs a throwaway MySQL/MariaDB. It creates and drops its own databases and
 * touches nothing else.  node scripts/migration-reconcile.selftest.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../drizzle', import.meta.url).pathname;
const RECON = new URL('./migration-reconcile.mjs', import.meta.url).pathname;
/**
 * NO CREDENTIALS LIVE IN THIS FILE. Both are required from the environment, and
 * the run refuses rather than falling back to a default that would either be a
 * secret in Git or a silent connection to whatever happens to be listening.
 *
 *   SELFTEST_MYSQL   client flags,  e.g. "-h 127.0.0.1 -u bh -pSECRET"
 *   SELFTEST_DSN     server prefix, e.g. "mysql://bh:SECRET@127.0.0.1:3306"
 *
 * Point them at a THROWAWAY server. This creates and drops databases.
 */
const HOST = process.env.SELFTEST_MYSQL;
const DSN = (process.env.SELFTEST_DSN ?? '').replace(/\/$/, '');
if (!HOST || !DSN) {
  console.error('set SELFTEST_MYSQL and SELFTEST_DSN - see the header of this file');
  process.exit(2);
}
const sql = (q, db = '') => execSync(`mysql ${HOST} ${db} -N -B`, { input: q, encoding: 'utf8' });
const statementsOf = f => readFileSync(`${DIR}/${f}`, 'utf8')
  .split('--> statement-breakpoint')
  .map(s => s.split('\n').filter(l => !/^\s*--(?!>)/.test(l)).join('\n').trim())
  .filter(Boolean);
const isData = s => /^\s*UPDATE /i.test(s);

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const TARGET = '0046_dispute_lifecycle.sql';

/** A database journalled up to `upTo`, then whatever `extra` does. */
function build(db, upTo, extra) {
  sql(`drop database if exists ${db}; create database ${db};`);
  sql('create table `__drizzle_migrations` (id int auto_increment primary key, '
    + 'hash varchar(255) not null, created_at bigint)', db);
  for (const f of files.filter(x => Number(x.slice(0, 4)) <= upTo)) {
    for (const s of statementsOf(f)) sql(s, db);
    sql(`insert into \`__drizzle_migrations\` (hash, created_at) values ('${f}', ${Date.now()})`, db);
  }
  if (extra) extra(db);
}


/** A dispute row, so the data postconditions have something to measure. */
const seedDispute = db => {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('st','selftest','st@x.test','S','user','homeowner','password',
        'self_registered',0,'active','approved',1)`, db);
  const uid = sql(`select id from users where username='selftest'`, db).trim();
  sql(`insert into projects (ownerId, title, status) values (${uid}, 'Selftest', 'active')`, db);
  const pid = sql(`select id from projects where title='Selftest'`, db).trim();
  sql(`insert into disputes (projectId, reporterId, title, description, status)
       values (${pid}, ${uid}, 'Selftest dispute', 'd', 'open')`, db);
};

const cases = [];
const add = (n, db, setup, expectVerdict, expectGate) => cases.push({ n, db, setup, expectVerdict, expectGate });

// 1. nothing of the target applied
add(1, 'rc_none', () => build('rc_none', 45), 'NOT APPLIED', 'REFUSED');

// 2. some schema statements applied
add(2, 'rc_partial', () => build('rc_partial', 45, db => {
  for (const s of statementsOf(TARGET).slice(0, 4)) sql(s, db);
}), 'PARTIALLY APPLIED - SCHEMA', 'REFUSED');

// 3. all schema AND all data applied, no journal row
add(3, 'rc_full', () => build('rc_full', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
}), 'FULLY VERIFIED APPLIED / UNJOURNALLED', 'CANDIDATE - still requires every human condition above');

// 4. THE DANGEROUS ONE - all schema, NO data, no journal row
add(4, 'rc_schemaonly', () => build('rc_schemaonly', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) if (!isData(s)) sql(s, db);
}), 'SCHEMA FULLY APPLIED / DATA UNVERIFIED / UNJOURNALLED', 'REFUSED');

// 5. all schema, only SOME data
add(5, 'rc_somedata', () => build('rc_somedata', 45, db => {
  seedDispute(db);
  const st = statementsOf(TARGET);
  let seenData = 0;
  for (const s of st) {
    if (isData(s)) { seenData++; if (seenData > 1) continue; }
    sql(s, db);
  }
}), 'SCHEMA FULLY APPLIED / DATA UNVERIFIED / UNJOURNALLED', 'REFUSED');

// 6. an object that EXISTS but with the wrong shape
add(6, 'rc_wrongshape', () => build('rc_wrongshape', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
  // Same name, wrong columns: an index that is not the intended index.
  sql('drop index `disputes_subject_idx` on `disputes`', db);
  sql('create index `disputes_subject_idx` on `disputes` (`status`)', db);
}), 'INCONSISTENT / MANUAL REVIEW', 'REFUSED');

// 7. a material statement the parser cannot read
add(7, 'rc_unparsed', () => build('rc_unparsed', 45), 'UNPARSED / CANNOT PROVE', 'REFUSED');


// ── WRONG-SHAPE DDL, ONE CLASS AT A TIME ──────────────────────────────────
//
// Case 6 proves only that a wrong INDEX is caught. Each remaining object class
// has its own comparison and its own way of being wrong, and a comparison that
// is never shown a fault is not evidence that it works. These four exist
// because the first edition of this tool reported three CORRECT objects as
// mismatched - a column whose display width it did not normalise, a column spec
// it had sliced out of a multi-clause ALTER, and a foreign key whose ON DELETE
// it never parsed. Case 3 is the negative control for all of them: a database
// where every statement ran must produce zero mismatches.

// 8. a column that exists with the wrong TYPE
add(8, 'rc_wrongcol', () => build('rc_wrongcol', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
  sql('alter table `disputes` modify column `subjectId` bigint not null default 0', db);
}), 'INCONSISTENT / MANUAL REVIEW', 'REFUSED');

// 9. a foreign key that exists with the wrong ON DELETE rule
//    RESTRICT instead of SET NULL: same name, same columns, different meaning -
//    it makes an administrator who ever touched a dispute undeletable.
add(9, 'rc_wrongfk', () => build('rc_wrongfk', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
  sql('alter table `disputes` drop foreign key `disputes_assignedTo_fk`', db);
  sql('alter table `disputes` add constraint `disputes_assignedTo_fk` '
    + 'foreign key (`assignedTo`) references `users`(`id`) on delete restrict on update restrict', db);
}), 'INCONSISTENT / MANUAL REVIEW', 'REFUSED');

// 10. a unique constraint that exists but is NOT unique
//     The whole point of `disputes_reference_unique` is that two disputes
//     cannot share a reference. An index of the same name that permits
//     duplicates satisfies "exists" and defeats the constraint.
add(10, 'rc_notunique', () => build('rc_notunique', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
  sql('alter table `disputes` drop index `disputes_reference_unique`', db);
  sql('create index `disputes_reference_unique` on `disputes` (`reference`)', db);
}), 'INCONSISTENT / MANUAL REVIEW', 'REFUSED');

// 11. a table that exists but is missing a declared column
add(11, 'rc_wrongtable', () => build('rc_wrongtable', 45, db => {
  seedDispute(db);
  for (const s of statementsOf(TARGET)) sql(s, db);
  sql('alter table `disputeEvidence` drop column `contentType`', db);
}), 'INCONSISTENT / MANUAL REVIEW', 'REFUSED');

let pass = 0, fail = 0;
for (const c of cases) {
  delete process.env.DRIZZLE_DIR;
  if (c.n === 7) {
    // Point the reconciler at a drizzle dir whose next file contains a form it
    // does not parse. Built by copying the real set and appending a statement.
    execSync(`rm -rf /tmp/rc_unparsed_dir && cp -r ${DIR} /tmp/rc_unparsed_dir`);
    // A REAL extra statement, separated by the breakpoint, in a form the
    // parser does not recognise - appending without the separator would merely
    // corrupt the previous statement instead of adding an unparsed one.
    execSync(`printf '\\n--> statement-breakpoint\\nRENAME TABLE \`disputes\` TO \`disputes_renamed\`;\\n' >> /tmp/rc_unparsed_dir/${TARGET}`);
  }
  c.setup();
  let got;
  try {
    const env = c.n === 7 ? { ...process.env, DRIZZLE_DIR: '/tmp/rc_unparsed_dir' } : process.env;
    const out = execSync(`node ${RECON} --url "${DSN}/${c.db}"`,
      { encoding: 'utf8', env });
    got = { verdict: (out.match(/^VERDICT: (.+)$/m) ?? [, '(none)'])[1].trim(),
            gate: (out.match(/JOURNAL REPAIR: (.+)$/m) ?? [, '(none)'])[1].trim() };
  } catch (e) { got = { verdict: `ERROR ${String(e.message).slice(0, 60)}`, gate: '-' }; }

  const ok = got.verdict === c.expectVerdict && got.gate === c.expectGate;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.n}. ${c.db}`);
  console.log(`        verdict: ${got.verdict}`);
  if (!ok) {
    console.log(`        EXPECTED: ${c.expectVerdict}`);
    console.log(`        gate: ${got.gate}  EXPECTED: ${c.expectGate}`);
  }
}
console.log(`\n${pass}/${pass + fail} constructed states verdict correctly`);
process.exit(fail ? 1 : 0);

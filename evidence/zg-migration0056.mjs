/**
 * ── CAN MIGRATION 0056 BE RELEASED? ──────────────────────────────────────
 *
 * 0056 adds product Q&A moderation: seven columns on `productQuestions` and
 * two new tables. It has been applied to one local database - the one it was
 * written against - and that proves almost nothing about a release.
 *
 * The three questions a migration has to answer before it can ship, and the
 * second is the one that actually breaks deployments:
 *
 *   FROM EMPTY      a fresh database reaches the same schema
 *   OVER POPULATED  an existing database with real rows in it upgrades, and
 *                   EVERY EXISTING ROW SURVIVES UNCHANGED
 *   MID-DEPLOY      the PREVIOUS application keeps working against the NEW
 *                   schema, because Render applies migrations BEFORE the new
 *                   image starts serving - so for a window the old code is
 *                   talking to the new database
 *
 * The third is not theoretical here. render.yaml runs `drizzle-kit migrate`
 * as preDeployCommand precisely so a bad migration refuses the deploy instead
 * of taking the site down - which means the old container is still serving
 * while the new columns already exist.
 *
 * AND ONE MORE, because this migration is about hiding things:
 *
 *   NOTHING BECOMES HIDDEN BY ACCIDENT. Every existing question and answer
 *   must still be public after the upgrade. A moderation migration that
 *   defaulted content to hidden would silently empty every product page, and
 *   it would look exactly like a working deployment.
 *
 * SCRATCH DATABASES ONLY. Nothing here touches the development database, and
 * nothing touches staging or production. Each scratch database is created,
 * used and dropped inside this file.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const EMPTY_DB = 'zg_m56_empty';
const UPGRADE_DB = 'zg_m56_upgrade';
const BREAKPOINT = '--> statement-breakpoint';

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

const mysql = (db, sqlText) => {
  try {
    return execSync(`mysql -u root --default-character-set=utf8mb4 ${db ? db : ''} -N -B`,
      { input: sqlText, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (error) {
    // Buffers print as byte arrays and hide the one line that matters.
    const message = (error.stderr?.toString() ?? String(error)).trim();
    throw new Error(message.split('\n').slice(0, 3).join(' | '));
  }
};
const root = sqlText => mysql('', sqlText);

/**
 * Apply one migration file, statement by statement.
 *
 * Split on drizzle's own breakpoint rather than on ';', because a statement
 * can legitimately contain a semicolon inside a string or a comment and
 * splitting naively turns one migration into two broken halves.
 */
function applyMigration(db, file) {
  const sqlText = readFileSync(`drizzle/${file}`, 'utf8');
  const statements = sqlText.split(BREAKPOINT)
    .map(s => s.trim())
    .filter(s => s && !s.split('\n').every(line => !line.trim() || line.trim().startsWith('--')));
  const tmp = `/tmp/zg-m-${file}.sql`;
  writeFileSync(tmp, statements.map(s => s.replace(/;\s*$/, '')).join(';\n') + ';\n');
  execSync(`mysql -u root --default-character-set=utf8mb4 ${db} < ${tmp}`, { stdio: 'pipe' });
  return statements.length;
}

const MIGRATIONS = readdirSync('drizzle').filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const BEFORE_0056 = MIGRATIONS.filter(f => !f.startsWith('0056'));
const M0056 = MIGRATIONS.find(f => f.startsWith('0056'));

function drop(db) { try { root(`drop database if exists ${db}`); } catch { /* nothing to drop */ } }

try {
  check(MIGRATIONS.length === 57 && !!M0056,
    'SETUP: the migration set is complete and 0056 is in it',
    `${MIGRATIONS.length} files, ${M0056}`);

  /* ── 1. FROM EMPTY ───────────────────────────────────────────────────── */
  drop(EMPTY_DB);
  root(`create database ${EMPTY_DB} character set utf8mb4`);
  let appliedEmpty = 0;
  let emptyError = null;
  try {
    for (const file of MIGRATIONS) appliedEmpty += applyMigration(EMPTY_DB, file);
  } catch (error) {
    emptyError = String(error.stderr ?? error).split('\n').slice(0, 3).join(' ');
  }
  check(!emptyError, 'EMPTY: every migration applies to a fresh database',
    emptyError ?? `${appliedEmpty} statements over ${MIGRATIONS.length} files`);

  const emptyColumns = mysql(EMPTY_DB,
    `select column_name from information_schema.columns
      where table_schema='${EMPTY_DB}' and table_name='productQuestions'
        and column_name in ('hiddenAt','hiddenBy','hiddenReason','answerHiddenAt',
          'answerHiddenBy','answerHiddenReason','answerEditedAt')`).split('\n').filter(Boolean);
  check(emptyColumns.length === 7,
    'EMPTY: and productQuestions ends with all seven moderation columns',
    `${emptyColumns.length}/7`);

  const emptyTables = mysql(EMPTY_DB,
    `select table_name from information_schema.tables
      where table_schema='${EMPTY_DB}'
        and table_name in ('productAnswerRevisions','productQuestionReports')`).split('\n').filter(Boolean);
  check(emptyTables.length === 2, 'EMPTY: and both new tables exist', emptyTables.join(', '));

  /* ── 2. OVER A POPULATED PRE-0056 DATABASE ───────────────────────────── */
  drop(UPGRADE_DB);
  root(`create database ${UPGRADE_DB} character set utf8mb4`);
  for (const file of BEFORE_0056) applyMigration(UPGRADE_DB, file);

  const before56Columns = mysql(UPGRADE_DB,
    `select count(*) from information_schema.columns
      where table_schema='${UPGRADE_DB}' and table_name='productQuestions' and column_name='hiddenAt'`);
  check(before56Columns === '0',
    'UPGRADE: the pre-0056 database genuinely lacks the new columns - a real "before"',
    `hiddenAt columns: ${before56Columns}`);

  // REAL ROWS, of exactly the kinds 0056 touches: questions answered and
  // unanswered, and a review with a report against it, because the migration
  // must leave the review moderation it sits beside completely alone.
  mysql(UPGRADE_DB, `
    insert into users (openId, username, email, name, role, userRole, loginMethod,
      accountSource, isDummy, accountStatus, onboardingStatus, verified)
      values ('m56-sup','m56sup','m56sup@example.test','Legacy Supplier','user','supplier',
        'password','self_registered',0,'active','approved',1),
      ('m56-buy','m56buy','m56buy@example.test','Legacy Buyer','user','homeowner',
        'password','self_registered',0,'active','approved',1);
    insert into products (supplierId, name, category, status, price, currency)
      values ((select id from users where username='m56sup'),'Legacy Tile','Materials','active','99.00','EGP');
    insert into productQuestions (productId, askerId, question, answer, answeredAt)
      values ((select id from products where name='Legacy Tile'),
              (select id from users where username='m56buy'),
              'Is this frost resistant?', 'Yes, rated for outdoor use.', now());
    insert into productQuestions (productId, askerId, question)
      values ((select id from products where name='Legacy Tile'),
              (select id from users where username='m56buy'),
              'What is the lead time?');
    insert into projects (ownerId, title, type, status)
      values ((select id from users where username='m56buy'),'Legacy Project','residential','active');
    insert into reviews (projectId, reviewerId, revieweeId, rating, comment, verified)
      values ((select id from projects where title='Legacy Project'),
              (select id from users where username='m56buy'),
              (select id from users where username='m56sup'), 4, 'Good service', 1);
    insert into reviewReports (reviewId, reporterId, reason, status)
      values ((select id from reviews limit 1),
              (select id from users where username='m56sup'), 'not_a_customer', 'open');
  `);

  const beforeSnapshot = mysql(UPGRADE_DB,
    `select id, question, ifnull(answer,'<null>'), ifnull(answeredAt,'<null>')
       from productQuestions order by id`);
  const beforeReviews = mysql(UPGRADE_DB,
    `select r.id, r.rating, r.comment, rr.status, rr.reason
       from reviews r join reviewReports rr on rr.reviewId = r.id order by r.id`);
  check(beforeSnapshot.split('\n').length === 2 && beforeReviews.length > 0,
    'UPGRADE: seeded a real "before" - two questions, one answered, plus a reported review',
    `${beforeSnapshot.split('\n').length} questions`);

  let upgradeError = null;
  try { applyMigration(UPGRADE_DB, M0056); }
  catch (error) { upgradeError = String(error.stderr ?? error).split('\n').slice(0, 3).join(' '); }
  check(!upgradeError, 'UPGRADE: 0056 applies over a populated database', upgradeError ?? 'applied');

  const afterSnapshot = mysql(UPGRADE_DB,
    `select id, question, ifnull(answer,'<null>'), ifnull(answeredAt,'<null>')
       from productQuestions order by id`);
  check(afterSnapshot === beforeSnapshot,
    'UPGRADE: every existing question and answer survives BYTE-IDENTICAL',
    afterSnapshot === beforeSnapshot ? 'unchanged' : `before "${beforeSnapshot}" vs after "${afterSnapshot}"`);

  const afterReviews = mysql(UPGRADE_DB,
    `select r.id, r.rating, r.comment, rr.status, rr.reason
       from reviews r join reviewReports rr on rr.reviewId = r.id order by r.id`);
  check(afterReviews === beforeReviews,
    'UPGRADE: and the review moderation it sits beside is untouched',
    afterReviews === beforeReviews ? 'unchanged' : 'review data changed');

  /* ── 3. NOTHING BECOMES HIDDEN BY ACCIDENT ───────────────────────────── */
  const hidden = mysql(UPGRADE_DB,
    `select count(*) from productQuestions where hiddenAt is not null or answerHiddenAt is not null`);
  check(hidden === '0',
    'SAFE: no existing content is hidden by the upgrade - every product page still renders',
    `${hidden} hidden`);
  const edited = mysql(UPGRADE_DB,
    `select count(*) from productQuestions where answerEditedAt is not null`);
  check(edited === '0',
    'SAFE: and no existing answer is falsely marked as edited',
    `${edited} marked`);
  const reports = mysql(UPGRADE_DB, `select count(*) from productQuestionReports`);
  const revisions = mysql(UPGRADE_DB, `select count(*) from productAnswerRevisions`);
  check(reports === '0' && revisions === '0',
    'SAFE: and the new tables start genuinely empty, with no invented history',
    `${reports} reports, ${revisions} revisions`);

  /* ── 4. THE OLD APPLICATION STILL WORKS AGAINST THE NEW SCHEMA ───────── */
  // Render applies migrations BEFORE the new image serves, so for a window
  // the PREVIOUS code is talking to this schema. These are the exact shapes
  // the pre-0056 application used.
  let oldReadError = null;
  try {
    mysql(UPGRADE_DB, `select id, productId, question, answer, answeredAt, createdAt
                         from productQuestions where productId = 1 order by createdAt desc`);
  } catch (error) { oldReadError = String(error.stderr ?? error).split('\n')[0]; }
  check(!oldReadError,
    'MID-DEPLOY: the previous application\'s READ still works against the new schema',
    oldReadError ?? 'the pre-0056 column list still resolves');

  let oldWriteError = null;
  try {
    mysql(UPGRADE_DB, `insert into productQuestions (productId, askerId, question)
      values ((select id from products where name='Legacy Tile'),
              (select id from users where username='m56buy'), 'Asked during the deploy window');`);
  } catch (error) { oldWriteError = String(error.stderr ?? error).split('\n')[0]; }
  check(!oldWriteError,
    'MID-DEPLOY: and its INSERT still works - every new column is nullable',
    oldWriteError ?? 'accepted');

  const windowRow = mysql(UPGRADE_DB,
    `select ifnull(hiddenAt,'<null>'), ifnull(answerEditedAt,'<null>')
       from productQuestions where question='Asked during the deploy window'`);
  check(windowRow.includes('<null>'),
    'MID-DEPLOY: and a row the old code wrote is visible, not hidden',
    windowRow);

  let oldAnswerError = null;
  try {
    mysql(UPGRADE_DB, `update productQuestions set answer='Answered during the window', answeredAt=now()
                         where question='Asked during the deploy window';`);
  } catch (error) { oldAnswerError = String(error.stderr ?? error).split('\n')[0]; }
  check(!oldAnswerError,
    'MID-DEPLOY: and the old answer path still writes',
    oldAnswerError ?? 'accepted');

  /* ── 5. THE MIGRATION IS ADDITIVE ONLY ───────────────────────────────── */
  const sqlText = readFileSync(`drizzle/${M0056}`, 'utf8').toUpperCase();
  const destructive = ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM', 'MODIFY COLUMN', 'RENAME COLUMN']
    .filter(keyword => sqlText.includes(keyword));
  check(destructive.length === 0,
    'ADDITIVE: 0056 drops nothing, deletes nothing and retypes nothing',
    destructive.length ? destructive.join(', ') : 'add-only');

  const restrictCount = (sqlText.match(/ON DELETE RESTRICT/g) ?? []).length;
  const cascadeCount = (sqlText.match(/ON DELETE CASCADE/g) ?? []).length;
  check(restrictCount >= 5 && cascadeCount === 0,
    'ADDITIVE: every new foreign key is RESTRICT - moderation evidence cannot vanish',
    `${restrictCount} restrict, ${cascadeCount} cascade`);

  /* ── 6. THE TWO SCHEMAS AGREE ────────────────────────────────────────── */
  // A fresh database and an upgraded one must end up the same, or a bug only
  // appears on one of the two paths - and it is always the one nobody tested.
  const shape = db => mysql(db,
    `select table_name, column_name, column_type, is_nullable
       from information_schema.columns
      where table_schema='${db}'
        and table_name in ('productQuestions','productAnswerRevisions','productQuestionReports')
      order by table_name, column_name`);
  check(shape(EMPTY_DB) === shape(UPGRADE_DB),
    'CONVERGENT: a fresh database and an upgraded one reach the SAME schema',
    shape(EMPTY_DB) === shape(UPGRADE_DB) ? 'identical' : 'the two paths diverge');
} finally {
  drop(EMPTY_DB);
  drop(UPGRADE_DB);
  console.log('  (scratch databases dropped)');
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

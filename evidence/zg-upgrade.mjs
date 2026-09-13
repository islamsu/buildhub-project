/**
 * ── THE SEEDED UPGRADE: THIS BRANCH'S MIGRATIONS ONTO A DATABASE WITH DATA ──
 *
 * CI proves the migration set applies FROM EMPTY. That is the easy direction,
 * and it is not the one that happens on merge: staging and production already
 * hold rows, and a migration that is fine against nothing can still fail -
 * or silently destroy - against real data. A NOT NULL column with no default
 * on a populated table, a narrowed enum that an existing row violates, a
 * unique index over values that are already duplicated: every one of those
 * passes from empty and fails on merge night.
 *
 * So this builds a database at MAIN's migration state (0000-0041, byte
 * identical to main), puts REAL rows in the tables this branch's twelve
 * migrations touch, applies 0042-0053, and then asserts BOTH that every
 * migration applied AND that the pre-existing rows are still there with their
 * values unchanged. Survival is the point; "it did not throw" is not.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const DB = 'buildhub_upgrade';
const DIR = '/home/user/buildhub-project/drizzle';
const mysql = (q, db = DB) =>
  execSync(`mysql -h 127.0.0.1 -u bh -pbhlocal ${db} -N -B`, { input: q, encoding: 'utf8' }).trim();

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

/** Apply one migration file the way drizzle does: split on the breakpoint. */
function apply(file) {
  const raw = readFileSync(`${DIR}/${file}`, 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    // Strip SQL comments but NEVER the breakpoint marker itself.
    .map(s => s.split('\n').filter(line => !/^\s*--(?!>)/.test(line)).join('\n').trim())
    .filter(Boolean);
  for (const statement of statements) mysql(statement);
  return statements.length;
}

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const before = files.filter(f => Number(f.slice(0, 4)) <= 41);
const branch = files.filter(f => Number(f.slice(0, 4)) >= 42);

execSync(`mysql -h 127.0.0.1 -u bh -pbhlocal -N -B`, {
  input: `drop database if exists ${DB}; create database ${DB};`, encoding: 'utf8' });

// ── 1. MAIN'S STATE ────────────────────────────────────────────────────────
let statements = 0;
for (const f of before) statements += apply(f);
const tablesAtMain = Number(mysql(
  `select count(*) from information_schema.tables where table_schema='${DB}'`));
check(tablesAtMain > 40, `a database at MAIN's migration state exists`,
  `${before.length} migrations, ${statements} statements, ${tablesAtMain} tables`);

// ── 2. REAL ROWS IN THE TABLES THE BRANCH TOUCHES ──────────────────────────
// Named so the assertions can find them again by value, not by position.
mysql(`
  insert into users (openId, username, email, name, role, userRole, loginMethod,
    accountSource, isDummy, accountStatus, onboardingStatus, verified)
  values ('up-owner','upgradeowner','owner@upgrade.test','Upgrade Owner','user','homeowner',
    'password','self_registered',0,'active','approved',1),
   ('up-vendor','upgradevendor','vendor@upgrade.test','Upgrade Vendor','user','supplier',
    'password','self_registered',0,'active','approved',1);
`);
const ownerId = Number(mysql(`select id from users where username='upgradeowner'`));
const vendorId = Number(mysql(`select id from users where username='upgradevendor'`));

mysql(`insert into projects (ownerId, title, description, status, budget)
       values (${ownerId}, 'Upgrade Villa', 'A project that predates the upgrade', 'active', '250000')`);
const projectId = Number(mysql(`select id from projects where title='Upgrade Villa'`));

mysql(`insert into products (supplierId, name, description, category, price, unit, stock)
       values (${vendorId}, 'Upgrade Cement', 'A product that predates the upgrade',
               'Building Materials', '19.50', 'bag', 400)`);
const productId = Number(mysql(`select id from products where name='Upgrade Cement'`));

const seeded = { ownerId, vendorId, projectId, productId };
check(Object.values(seeded).every(v => Number.isInteger(v) && v > 0),
  'and it holds real rows a migration could break', JSON.stringify(seeded));

// ── 3. THE UPGRADE ─────────────────────────────────────────────────────────
const applied = [];
const failures = [];
for (const f of branch) {
  try { applied.push(`${f}:${apply(f)}`); }
  catch (e) { failures.push(`${f}: ${String(e.message).split('\n').find(l => l.includes('ERROR')) ?? e.message}`); }
}
check(failures.length === 0,
  `every one of this branch's ${branch.length} migrations applies to a POPULATED database`,
  failures.length ? failures.join(' | ') : applied.join(' '));

// ── 4. THE ROWS THAT WERE ALREADY THERE ────────────────────────────────────
const survived = [
  ['the homeowner', `select name from users where id=${ownerId}`, 'Upgrade Owner'],
  ['the vendor', `select name from users where id=${vendorId}`, 'Upgrade Vendor'],
  ['their project', `select title from projects where id=${projectId}`, 'Upgrade Villa'],
  ['its budget', `select budget from projects where id=${projectId}`, '250000.00'],
  ['the product', `select name from products where id=${productId}`, 'Upgrade Cement'],
  ['its price', `select price from products where id=${productId}`, '19.50'],
  ['its category', `select category from products where id=${productId}`, 'Building Materials'],
];
const lost = [];
for (const [what, query, expected] of survived) {
  let got = '';
  try { got = mysql(query); } catch (e) { got = `ERROR ${e.message.slice(0, 60)}`; }
  if (got !== expected) lost.push(`${what}: expected ${expected}, got ${got || '(gone)'}`);
}
check(lost.length === 0, 'and every pre-existing row survived with its values intact',
  lost.length ? lost.join(' | ') : `${survived.length} values unchanged`);

// ── 5. THE UPGRADE REALLY HAPPENED ─────────────────────────────────────────
// Otherwise "nothing broke" would also be true of a migration set that did
// nothing at all.
const tablesAfter = Number(mysql(
  `select count(*) from information_schema.tables where table_schema='${DB}'`));
check(tablesAfter > tablesAtMain, 'and the schema actually moved forward',
  `${tablesAtMain} tables at main -> ${tablesAfter} after the upgrade`);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

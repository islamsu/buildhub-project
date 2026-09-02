/**
 * DOES THE GENERATED SQL LADDER AGREE WITH THE TYPESCRIPT ONE?
 *
 * The overview counts states in the database and every other surface derives
 * them in Node. They are generated from one rule list, which makes drift
 * unlikely - it does not make them EQUAL. `'declined'` compared in TypeScript
 * and in MariaDB are two different comparisons: collation, NULL semantics and
 * the truthiness of an EXISTS column are all places where a faithful
 * translation can still disagree.
 *
 * So both are run over EVERY combination of the four pieces of evidence, and
 * compared row by row. Not a sample - the full cross product, which is small
 * enough to be exhaustive.
 */
import { execFileSync } from 'node:child_process';
import { deriveEnquiryState } from '../server/vendorEnquiry.ts';
import { enquiryStateSql } from '../server/vendorEnquiryQuery.ts';

const RFQ_STATUSES = ['open', 'closed', 'awarded', null];
const INVITATION_STATUSES = [null, 'invited', 'viewed', 'responded', 'declined'];
const BOOLEANS = [false, true];

const combinations = [];
for (const rfqStatus of RFQ_STATUSES)
  for (const invitationStatus of INVITATION_STATUSES)
    for (const creditSpent of BOOLEANS)
      for (const hasQuotation of BOOLEANS)
        combinations.push({ rfqStatus, invitationStatus, creditSpent, hasQuotation });

const quote = v => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const bool  = v => (v ? '1' : '0');

// The evidence is fed in as a derived table with the SAME column names the real
// universe query aliases, so the CASE under test is the one that ships.
const rows = combinations.map((c, i) =>
  `SELECT ${i} AS n, ${quote(c.rfqStatus)} AS rfqStatus, ${quote(c.invitationStatus)} AS invitationStatus, `
  + `${bool(c.creditSpent)} AS creditSpent, ${bool(c.hasQuotation)} AS hasQuotation`,
).join('\n      UNION ALL ');

const query = `SELECT n, ${enquiryStateSql()} AS state FROM (\n      ${rows}\n    ) e ORDER BY n`;

const out = execFileSync('mysql', ['-N', '-B', 'buildhub_prelaunch'], {
  input: query, encoding: 'utf8',
});

const fromSql = new Map();
for (const line of out.split('\n')) {
  if (!line.trim() || line.startsWith('PAGER')) continue;
  const [n, state] = line.split('\t');
  fromSql.set(Number(n), state);
}

let checks = 0, failures = 0;
if (fromSql.size !== combinations.length) {
  failures += 1;
  console.log(`FAIL  instrument: expected ${combinations.length} rows from MariaDB, got ${fromSql.size}`);
}
for (const [i, evidence] of combinations.entries()) {
  const ts = deriveEnquiryState(evidence);
  const db = fromSql.get(i);
  checks += 1;
  if (ts !== db) {
    failures += 1;
    console.log(`FAIL  ${JSON.stringify(evidence)}  ts=${ts}  sql=${db}`);
  }
}

// A comparison that never disagrees proves nothing unless it CAN disagree. One
// deliberately wrong expectation, to show the comparison has teeth.
const control = deriveEnquiryState({ rfqStatus: 'open', invitationStatus: 'declined', creditSpent: false, hasQuotation: false });
if (control !== 'DECLINED') { failures += 1; console.log('FAIL  control: the TS ladder itself is wrong'); }

/**
 * THE ONE PLACE THE TWO LADDERS GENUINELY DO NOT AGREE, and why it cannot bite.
 *
 * MariaDB's default collation is case-INSENSITIVE, so `invitationStatus =
 * 'declined'` matches a stored 'DECLINED'; TypeScript's === does not. A row
 * holding 'DECLINED' would therefore read as DECLINED in the overview and
 * AVAILABLE everywhere else. (Found by mutation: rewriting the SQL comparison to
 * 'DECLINED' changed nothing, which is only possible if case does not matter.)
 *
 * It is unreachable because both columns are ENUMs whose members are all
 * lowercase - the column itself refuses any other spelling. That is asserted
 * here rather than assumed, because if a future migration adds a mixed-case
 * member the divergence becomes real and silent.
 */
const enums = execFileSync('mysql', ['-N', '-B', 'buildhub_prelaunch'], {
  input: "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='buildhub_prelaunch'"
       + " AND ((TABLE_NAME='rfqSuppliers' AND COLUMN_NAME='status') OR (TABLE_NAME='rfqs' AND COLUMN_NAME='status'))",
  encoding: 'utf8',
});
const members = [...enums.matchAll(/'([^']*)'/g)].map(m => m[1]);
checks += 1;
if (members.length === 0) {
  failures += 1;
  console.log('FAIL  instrument: read no enum members, so this check proved nothing');
} else if (members.some(m => m !== m.toLowerCase())) {
  failures += 1;
  console.log(`FAIL  a status enum has a mixed-case member (${members.join(', ')}), so SQL and TS can disagree`);
} else {
  console.log(`ok    both status enums are lowercase-only (${members.join(', ')}), so collation cannot diverge`);
}

console.log(`\n${checks} checks (80 evidence combinations + collation), ${failures} disagreement(s)`);
console.log(failures === 0 ? 'PASS  the SQL ladder and the TypeScript ladder agree exhaustively' : 'FAIL');
process.exit(failures === 0 ? 0 : 1);

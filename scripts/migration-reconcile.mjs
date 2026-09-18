/**
 * ── MIGRATION RECONCILER — READ ONLY, EVIDENCE SUPPORT, NOT AUTHORITY ─────
 *
 * Answers, against a live database: which migration file the runner is blocked
 * on, which of its statements have already executed, and how schema, data and
 * the drizzle journal compare.
 *
 * IT ISSUES NO DDL AND NO DML. Every query is a SELECT against
 * information_schema or the journal table.
 *
 * ── WHY THE VERDICT MODEL IS SHAPED THIS WAY ──────────────────────────────
 *
 * An earlier version reported "FULLY APPLIED BUT UNJOURNALLED" whenever every
 * SCHEMA statement was present. That was too strong, and dangerously so.
 *
 * A migration has two kinds of effect. DDL creates structure, and its presence
 * is decidable from information_schema. DATA statements transform existing
 * rows, and their presence is NOT decidable from structure at all. A migration
 * can therefore have every column, index and table in place while a backfill
 * never ran — and inserting a journal row in that state tells drizzle the
 * migration is complete and PERMANENTLY SKIPS the data transformation. The
 * rows stay wrong forever, and nothing ever looks at that file again.
 *
 * So schema completion and data completion are reported separately, and
 * nothing here certifies a migration as fully applied unless the data effects
 * were actually PROVEN.
 *
 * ── WHY DATA POSTCONDITIONS ARE NOT JUST THE SET EXPRESSION ───────────────
 *
 * The obvious check - re-evaluate the migration's SET expression and see if it
 * still holds - is wrong, because it converts a one-time historical
 * transformation into a permanent business invariant. `products.status` was
 * derived from `active` once, in 2026; an administrator archiving a product
 * next week legitimately breaks that equality and means nothing about whether
 * the migration ran. Each backfill is therefore classified by whether its
 * effect is STILL provable from current state, and the ones that are not are
 * reported as UNVERIFIED rather than guessed at.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const PROJECT = process.env.PROJECT_DIR ?? new URL('..', import.meta.url).pathname;
const { createConnection } = createRequire(`${PROJECT}/package.json`)('mysql2/promise');

const arg = process.argv.indexOf('--url');
const URL_ = arg > -1 ? process.argv[arg + 1] : process.env.DATABASE_URL;
const DIR = process.env.DRIZZLE_DIR ?? `${PROJECT}/drizzle`;
if (!URL_) { console.error('need --url or DATABASE_URL'); process.exit(2); }

const VERDICT = {
  JOURNALLED_AND_CONSISTENT: 'JOURNALLED AND CONSISTENT',
  NOT_APPLIED: 'NOT APPLIED',
  PARTIAL_SCHEMA: 'PARTIALLY APPLIED - SCHEMA',
  SCHEMA_DATA_UNVERIFIED: 'SCHEMA FULLY APPLIED / DATA UNVERIFIED / UNJOURNALLED',
  FULLY_VERIFIED: 'FULLY VERIFIED APPLIED / UNJOURNALLED',
  INCONSISTENT: 'INCONSISTENT / MANUAL REVIEW',
  UNPARSED: 'UNPARSED / CANNOT PROVE',
};

function statementsOf(file) {
  return readFileSync(`${DIR}/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map(s => s.split('\n').filter(l => !/^\s*--(?!>)/.test(l)).join('\n').trim())
    .filter(Boolean);
}

const ident = '`?([A-Za-z0-9_]+)`?';
const bident = '`([A-Za-z0-9_]+)`';
const cols = s => [...s.matchAll(/`([A-Za-z0-9_]+)`/g)].map(m => m[1]);
const norm = s => s.replace(/\s+/g, ' ').trim();

/**
 * Split a comma-separated list at the TOP LEVEL only.
 *
 * One ALTER TABLE carries many clauses, and the commas that separate them look
 * exactly like the commas inside `enum('project','rfq','quotation')` or
 * `REFERENCES users(id)`. A naive split turns one statement into nonsense
 * claims - the first edition of this tool read `subjectType`'s spec as
 * "enum(...) NOT NULL DEFAULT 'project', ADD COLUMN `subjectId` int NOT NULL"
 * and reported a correct column as the wrong shape. Depth and quotes are
 * tracked so the split happens only where a clause really ends.
 */
function splitTop(s) {
  const out = [];
  let buf = '', depth = 0, quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += s[++i] ?? ''; continue; }
      if (ch === quote) { if (s[i + 1] === quote) buf += s[++i]; else quote = null; }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * The server's reported type and the migration's declared type, made
 * comparable.
 *
 * MySQL reports a DISPLAY WIDTH the migration never writes - `int` comes back
 * as `int(11)` - and that width constrains nothing. Normalising it away is not
 * a relaxation: `bigint` still differs from `int` by name, and every width that
 * DOES constrain storage (varchar, decimal, char) is left exactly as written.
 * `boolean` is MySQL's own spelling of `tinyint(1)`.
 */
function normType(t) {
  let s = norm(String(t ?? '')).toLowerCase();
  s = s.replace(/^(?:boolean|bool)\b/, 'tinyint');
  s = s.replace(/^(tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)/, '$1');
  s = s.replace(/^integer\b/, 'int');
  return s.replace(/\s*,\s*/g, ',');
}

/** Defaults, made comparable: quotes stripped, the now() spellings unified. */
function normDefault(d) {
  if (d === null || d === undefined) return null;
  let s = norm(String(d));
  if (/^\(.*\)$/.test(s) && /now|current_timestamp/i.test(s)) s = s.slice(1, -1).trim();
  if (/^(now\(\)|current_timestamp(\(\))?)$/i.test(s)) return 'CURRENT_TIMESTAMP';
  if (/^'(?:[^']|'')*'$/.test(s)) s = s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** RESTRICT and NO ACTION are the same rule; MySQL reports them interchangeably. */
const normRule = r => {
  const s = String(r ?? '').toUpperCase().trim();
  return s === 'NO ACTION' ? 'RESTRICT' : s;
};


/**
 * ── DATA POSTCONDITIONS ───────────────────────────────────────────────────
 *
 * Keyed by a normalised fingerprint of the UPDATE. Each is classified:
 *
 *   A  the effect is STILL provable from current state
 *   B  provable only with an additional scoping condition, and possibly
 *      vacuous if no candidate rows exist
 *   C  not reliably provable - later legitimate writes are indistinguishable
 *      from the migration never having run
 *
 * A class C backfill can never be certified here. That is the honest answer,
 * not a gap to be closed by guessing.
 */
const DATA_POSTCONDITIONS = [
  {
    match: /UPDATE `disputes` SET `subjectId` = `projectId`/i,
    label: '0046 backfill disputes.subjectId from projectId',
    class: 'B',
    why: 'subjectId is NOT NULL DEFAULT 0, so an un-backfilled project dispute '
       + 'keeps 0. Scoped to subjectType=project rows that HAVE a projectId, '
       + 'which excludes later polymorphic disputes that legitimately point '
       + 'elsewhere. Vacuous when no such rows exist.',
    check: async (q, schema) => {
      const [{ candidates }] = await q(
        'select count(*) as candidates from `disputes` where `projectId` is not null '
        + "and `subjectType` = 'project'");
      if (Number(candidates) === 0) {
        return { proven: false, vacuous: true, detail: 'no candidate rows - proves nothing either way' };
      }
      const [{ unbackfilled }] = await q(
        'select count(*) as unbackfilled from `disputes` where `projectId` is not null '
        + "and `subjectType` = 'project' and `subjectId` = 0");
      return Number(unbackfilled) === 0
        ? { proven: true, vacuous: false, detail: `${candidates} candidate row(s), none left at subjectId=0` }
        : { proven: false, vacuous: false, detail: `${unbackfilled} of ${candidates} row(s) still at subjectId=0 - BACKFILL DID NOT COMPLETE` };
    },
  },
  {
    match: /UPDATE `disputes` SET `reference` =/i,
    label: '0046 backfill disputes.reference',
    class: 'A',
    why: 'reference is varchar(32) NULL, so an un-backfilled row keeps NULL. '
       + 'Any NULL reference means the backfill did not complete. Vacuous only '
       + 'when the table is empty.',
    check: async q => {
      const [{ total }] = await q('select count(*) as total from `disputes`');
      if (Number(total) === 0) return { proven: false, vacuous: true, detail: 'disputes table is empty' };
      const [{ nulls }] = await q('select count(*) as nulls from `disputes` where `reference` is null');
      return Number(nulls) === 0
        ? { proven: true, vacuous: false, detail: `${total} row(s), no NULL reference` }
        : { proven: false, vacuous: false, detail: `${nulls} of ${total} row(s) have NULL reference - BACKFILL DID NOT COMPLETE` };
    },
  },
  {
    match: /UPDATE `products` SET `status` =/i,
    label: '0049 backfill products.status from active',
    class: 'C',
    why: 'status is NOT NULL DEFAULT \'active\', so ADD COLUMN alone already '
       + 'gives every row a value - there is no un-backfilled sentinel to look '
       + 'for. Re-deriving status from `active` would convert a one-time '
       + 'transformation into a permanent invariant, and product status '
       + 'legitimately changes afterwards (draft, archived, an admin toggle). '
       + 'NOT PROVABLE from current state.',
    check: async () => ({ proven: false, vacuous: false, detail: 'class C - no sound read-only postcondition exists' }),
  },
];

/**
 * Every claim a statement makes, as a LIST.
 *
 * A statement is not a claim. `ALTER TABLE disputes ADD COLUMN a ..., ADD
 * COLUMN b ..., ADD CONSTRAINT c ...` makes three separate, separately
 * checkable claims, and MySQL applies the whole statement or none of it. They
 * are reported individually so a partially applied file names the exact object
 * that is missing rather than a statement number.
 *
 * Anything not recognised returns a single `unparsed` claim, which the verdict
 * treats as fatal. That is deliberate - see the UNPARSED verdict.
 */
function claimsOf(sql) {
  const one = norm(sql).replace(/;\s*$/, '');
  let m;
  if ((m = one.match(new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${ident} \\((.*)\\)$`, 'i')))) {
    return [{ kind: 'table', table: m[1], columns: tableColumns(m[2]).map(c => c.column) }];
  }
  if ((m = one.match(new RegExp(`^CREATE (UNIQUE )?INDEX ${ident} ON ${ident} ?\\((.*)\\)$`, 'i'))))
    return [{ kind: 'index', unique: Boolean(m[1]), index: m[2], table: m[3], columns: cols(m[4]) }];
  if (/^UPDATE /i.test(one)) return [{ kind: 'data', sql: one }];
  if ((m = one.match(new RegExp(`^ALTER TABLE ${ident} (.+)$`, 'i')))) {
    const table = m[1];
    return splitTop(m[2]).map(clause => alterClaim(table, clause));
  }
  return [{ kind: 'unparsed' }];
}

/** The column declarations inside a CREATE TABLE body, with their specs. */
function tableColumns(body) {
  return splitTop(body)
    .map(d => d.match(new RegExp(`^${bident} (.+)$`, 'i')))
    .filter(Boolean)
    .map(m => ({ column: m[1], spec: m[2] }));
}

function alterClaim(table, clause) {
  let m;
  if ((m = clause.match(new RegExp(
    `^ADD CONSTRAINT ${ident} FOREIGN KEY ?\\(([^)]*)\\) REFERENCES ${ident} ?\\(([^)]*)\\)(.*)$`, 'i')))) {
    // The tail is group 5. It used to be read as group 4 - the referenced
    // column list - so ON DELETE was NEVER seen and every foreign key fell back
    // to the RESTRICT default, reporting a correct SET NULL key as wrong.
    const tail = m[5] ?? '';
    const rule = re => normRule((tail.match(re) ?? [, 'RESTRICT'])[1]);
    return {
      kind: 'fk', table, name: m[1], columns: cols(m[2]), refTable: m[3], refColumns: cols(m[4]),
      onDelete: rule(/ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION|SET DEFAULT)/i),
      onUpdate: rule(/ON UPDATE (CASCADE|SET NULL|RESTRICT|NO ACTION|SET DEFAULT)/i),
    };
  }
  if ((m = clause.match(new RegExp(`^ADD CONSTRAINT ${ident} UNIQUE ?\\(([^)]*)\\)`, 'i'))))
    return { kind: 'uniqueConstraint', table, name: m[1], columns: cols(m[2]) };
  if ((m = clause.match(new RegExp(`^ADD CONSTRAINT ${ident}\\b`, 'i'))))
    return { kind: 'constraint', table, name: m[1] };
  // The column name must be BACKTICKED here. Without that, `ADD INDEX `x` (...)`
  // parses as a column called INDEX.
  if ((m = clause.match(new RegExp(`^ADD (?:COLUMN )?${bident} (.+)$`, 'i'))))
    return { kind: 'column', table, column: m[1], spec: m[2], modify: false };
  if ((m = clause.match(new RegExp(`^MODIFY (?:COLUMN )?${bident} (.+)$`, 'i'))))
    return { kind: 'column', table, column: m[1], spec: m[2], modify: true };
  return { kind: 'unparsed' };
}

const SPEC_KEYWORD = /^(NOT NULL|NULL|DEFAULT|COMMENT|AFTER|FIRST|COLLATE|CHARACTER SET|CHARSET|AUTO_INCREMENT|UNIQUE|PRIMARY KEY|GENERATED|ON UPDATE|REFERENCES|INVISIBLE|STORED|VIRTUAL)\b/i;

/**
 * Type, nullability and default as the migration declares them.
 *
 * The type ends at the first spec keyword AT PAREN DEPTH ZERO. Splitting on a
 * keyword alternation instead would cut inside `enum('a','not null')` and
 * misread the type, so depth is tracked here too.
 */
function specShape(spec) {
  const s = String(spec).replace(/[;,]\s*$/, '').trim();
  let depth = 0, quote = null, cut = s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && /\s/.test(ch) && SPEC_KEYWORD.test(s.slice(i + 1))) { cut = i; break; }
  }
  const rest = s.slice(cut);
  const dm = rest.match(/DEFAULT\s+('(?:[^']|'')*'|\(\s*[A-Za-z0-9_]+\s*\(\s*\)\s*\)|[A-Za-z0-9_]+\s*\(\s*\)|[A-Za-z0-9_.+-]+)/i);
  return {
    type: normType(s.slice(0, cut)),
    nullable: !/\bNOT NULL\b/i.test(rest),
    dflt: dm ? normDefault(dm[1]) : null,
  };
}

/**
 * What each column looked like BEFORE this file ran, from the migrations that
 * precede it.
 *
 * MODIFY COLUMN needs this. An ADD COLUMN that has not run leaves no column, so
 * absence proves it. A MODIFY that has not run leaves the column there in its
 * OLD shape, which is indistinguishable from a botched modify unless the old
 * shape is known. With it, the three cases separate cleanly:
 *   shape == target  APPLIED
 *   shape == prior   MISSING (this statement has not run)
 *   neither          MISMATCH (the database agrees with no version of this file)
 */
function priorShapes(filesBefore) {
  const map = new Map();
  for (const f of filesBefore) {
    for (const sql of statementsOf(f)) {
      const one = norm(sql).replace(/;\s*$/, '');
      const t = one.match(new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${ident} \\((.*)\\)$`, 'i'));
      if (t) {
        for (const c of tableColumns(t[2])) map.set(`${t[1]}.${c.column}`, specShape(c.spec));
        continue;
      }
      for (const c of claimsOf(sql)) {
        if (c.kind === 'column') map.set(`${c.table}.${c.column}`, specShape(c.spec));
      }
    }
  }
  return map;
}

const db = await createConnection(URL_);
const [[{ db: schema }]] = await db.query('select database() as db');
const q = async (sql, args) => (await db.query(sql, args))[0];

let journalRows = [], journalTable = true;
try { journalRows = await q('select id, hash, created_at from `__drizzle_migrations` order by id'); }
catch { journalTable = false; }

const meta = JSON.parse(readFileSync(`${DIR}/meta/_journal.json`, 'utf8'));
const files = meta.entries.map(e => `${e.tag}.sql`);

const line = '='.repeat(78);
console.log(line);
console.log(`DATABASE            ${schema}`);
console.log(`journal table       ${journalTable ? 'present' : 'ABSENT'}`);
console.log(`rows applied        ${journalRows.length}`);
console.log(`files on disk       ${files.length}`);
console.log(`expected latest     ${files[files.length - 1]}`);
console.log(`applied latest      ${journalRows.length ? (files[journalRows.length - 1] ?? '(beyond journal)') : '(none)'}`);
console.log(line);

const notes = [];
if (journalRows.length > files.length) notes.push('more journal rows than migration files - this checkout is behind the database');

const nextIndex = journalRows.length;
if (nextIndex >= files.length) {
  console.log(`\nVERDICT: ${VERDICT.JOURNALLED_AND_CONSISTENT}`);
  console.log('Every migration on disk is journalled. A deploy failure here is not a');
  console.log('migration failure - read the deploy log.');
  console.log('\nJOURNAL REPAIR: NOT APPLICABLE - nothing is unjournalled.');
  await db.end(); process.exit(0);
}

const file = files[nextIndex];
console.log(`\nNEXT FILE THE RUNNER ATTEMPTS: ${file}\n`);
console.log('SCHEMA STATEMENTS');

const tableCols = async t => (await q(
  'select column_name, column_type, is_nullable, column_default from information_schema.columns where table_schema=? and table_name=?',
  [schema, t]));
const indexCols = async (t, i) => (await q(
  'select column_name, non_unique, seq_in_index from information_schema.statistics where table_schema=? and table_name=? and index_name=? order by seq_in_index',
  [schema, t, i]));
const fkInfo = async (t, n) => (await q(
  'select column_name, referenced_table_name, referenced_column_name, ordinal_position from information_schema.key_column_usage where table_schema=? and table_name=? and constraint_name=? order by ordinal_position',
  [schema, t, n]));
const fkRules = async n => (await q(
  'select delete_rule, update_rule from information_schema.referential_constraints where constraint_schema=? and constraint_name=?',
  [schema, n]));

const statements = statementsOf(file);
const priors = priorShapes(files.slice(0, nextIndex));
const tally = { APPLIED: 0, MISSING: 0, MISMATCH: 0, DATA: 0, UNPARSED: 0 };
const dataStatements = [];

/** Type, nullability and (when the migration declares one) default. */
const shapeDiff = (got, want) => {
  const bad = [];
  if (got.type !== want.type) bad.push(`type ${got.type} != ${want.type}`);
  if (got.nullable !== want.nullable) bad.push(`nullable ${got.nullable} != ${want.nullable}`);
  // A spec with no DEFAULT clause does not assert the absence of one, so an
  // undeclared default is not compared. A DECLARED default that differs is.
  if (want.dflt !== null && got.dflt !== want.dflt) bad.push(`default ${got.dflt} != ${want.dflt}`);
  return bad;
};

async function evaluate(c, label) {
  if (c.kind === 'table') {
    const have = await tableCols(c.table);
    if (have.length === 0) return { state: 'MISSING', detail: `table ${c.table}` };
    const names = new Set(have.map(r => r.column_name));
    const absent = c.columns.filter(x => !names.has(x));
    return absent.length === 0
      ? { state: 'APPLIED', detail: `table ${c.table} (${c.columns.length} declared columns present)` }
      : { state: 'MISMATCH', detail: `table ${c.table} EXISTS but is missing ${absent.join(', ')} - not the intended table` };
  }

  if (c.kind === 'column') {
    const have = (await tableCols(c.table)).find(r => r.column_name === c.column);
    const want = specShape(c.spec);
    if (!have) {
      return { state: 'MISSING', detail: `${c.table}.${c.column}`
        + (c.modify ? ' - the column does not exist at all, so this MODIFY cannot have run' : '') };
    }
    const got = {
      type: normType(have.column_type),
      nullable: have.is_nullable === 'YES',
      dflt: normDefault(have.column_default),
    };
    const bad = shapeDiff(got, want);
    if (bad.length === 0) return { state: 'APPLIED', detail: `${c.table}.${c.column}` };
    if (c.modify) {
      // A MODIFY that has not run leaves the column in its PRE-migration shape.
      // That is MISSING, not MISMATCH - the difference decides whether the file
      // is merely unfinished or the database disagrees with it.
      const prior = priors.get(`${c.table}.${c.column}`);
      if (prior && shapeDiff(got, prior).length === 0) {
        return { state: 'MISSING', detail: `${c.table}.${c.column} - still the pre-migration shape (${prior.type}) - this MODIFY has not run` };
      }
      return { state: 'MISMATCH', detail: `${c.table}.${c.column} - matches neither this migration nor the shape before it: ${bad.join('; ')}` };
    }
    return { state: 'MISMATCH', detail: `${c.table}.${c.column} - ${bad.join('; ')}` };
  }

  if (c.kind === 'index') {
    const have = await indexCols(c.table, c.index);
    if (have.length === 0) return { state: 'MISSING', detail: `${c.table}.${c.index}` };
    const gotCols = have.map(r => r.column_name);
    const gotUnique = Number(have[0].non_unique) === 0;
    const bad = [];
    if (gotCols.join(',') !== c.columns.join(',')) bad.push(`columns (${gotCols}) != (${c.columns})`);
    if (gotUnique !== c.unique) bad.push(`unique ${gotUnique} != ${c.unique}`);
    return bad.length === 0
      ? { state: 'APPLIED', detail: `${c.table}.${c.index}` }
      : { state: 'MISMATCH', detail: `${c.table}.${c.index} - ${bad.join('; ')}` };
  }

  if (c.kind === 'fk') {
    const have = await fkInfo(c.table, c.name);
    if (have.length === 0) return { state: 'MISSING', detail: `${c.table}.${c.name}` };
    const rules = (await fkRules(c.name))[0] ?? {};
    const bad = [];
    if (have.map(r => r.column_name).join(',') !== c.columns.join(',')) bad.push('source columns differ');
    if (have[0].referenced_table_name !== c.refTable) bad.push(`references ${have[0].referenced_table_name} != ${c.refTable}`);
    if (have.map(r => r.referenced_column_name).join(',') !== c.refColumns.join(',')) bad.push('referenced columns differ');
    if (normRule(rules.delete_rule) !== c.onDelete) bad.push(`ON DELETE ${rules.delete_rule} != ${c.onDelete}`);
    if (normRule(rules.update_rule) !== c.onUpdate) bad.push(`ON UPDATE ${rules.update_rule} != ${c.onUpdate}`);
    return bad.length === 0
      ? { state: 'APPLIED', detail: `${c.table}.${c.name}` }
      : { state: 'MISMATCH', detail: `${c.table}.${c.name} - ${bad.join('; ')}` };
  }

  if (c.kind === 'uniqueConstraint') {
    const have = await indexCols(c.table, c.name);
    if (have.length === 0) return { state: 'MISSING', detail: `${c.table}.${c.name}` };
    const gotCols = have.map(r => r.column_name);
    const gotUnique = Number(have[0].non_unique) === 0;
    const bad = [];
    if (!gotUnique) bad.push('exists but is NOT unique');
    if (gotCols.join(',') !== c.columns.join(',')) bad.push(`columns (${gotCols}) != (${c.columns})`);
    return bad.length === 0
      ? { state: 'APPLIED', detail: `${c.table}.${c.name}` }
      : { state: 'MISMATCH', detail: `${c.table}.${c.name} - ${bad.join('; ')}` };
  }

  if (c.kind === 'constraint') {
    const have = await q(
      'select 1 from information_schema.table_constraints where table_schema=? and table_name=? and constraint_name=?',
      [schema, c.table, c.name]);
    return { state: have.length ? 'APPLIED' : 'MISSING', detail: `${c.table}.${c.name}` };
  }

  if (c.kind === 'data') {
    const known = DATA_POSTCONDITIONS.find(p => p.match.test(c.sql));
    dataStatements.push({ index: label, sql: c.sql, known });
    return { state: 'DATA',
      detail: known ? `${known.label} (class ${known.class})` : 'UNREGISTERED backfill - no postcondition defined' };
  }

  return { state: 'UNPARSED', detail: 'cannot parse - this tool will not certify what it does not understand' };
}

for (const [i, sql] of statements.entries()) {
  const claims = claimsOf(sql);
  for (const [j, c] of claims.entries()) {
    // One statement, many claims: MySQL applies an ALTER TABLE whole or not at
    // all, but each clause is separately checkable and separately named.
    const label = `${i + 1}${claims.length > 1 ? String.fromCharCode(97 + j) : ''}`;
    const { state, detail } = await evaluate(c, label);
    tally[state]++;
    if (state === 'UNPARSED') notes.push(`statement ${label} could not be parsed`);
    console.log(`  ${label.padStart(4)}. ${state.padEnd(9)} ${detail}`);
  }
}

console.log(`\n  schema: applied=${tally.APPLIED} missing=${tally.MISSING} `
  + `mismatch=${tally.MISMATCH} | data=${tally.DATA} unparsed=${tally.UNPARSED}`);

// ── DATA EFFECTS, REPORTED SEPARATELY AND NEVER ASSUMED ───────────────────
let dataProven = 0, dataUnproven = 0;
if (dataStatements.length) {
  console.log('\nDATA STATEMENTS');
  for (const d of dataStatements) {
    if (!d.known) {
      dataUnproven++;
      console.log(`  ${String(d.index).padStart(2)}. UNVERIFIED  no postcondition registered for this backfill`);
      notes.push(`statement ${d.index} is an unregistered backfill`);
      continue;
    }
    let r;
    try { r = await d.known.check(q, schema); }
    catch (e) { r = { proven: false, vacuous: false, detail: `check failed: ${String(e.message).slice(0, 60)}` }; }
    const label = r.proven ? 'PROVEN' : r.vacuous ? 'VACUOUS' : 'UNVERIFIED';
    if (r.proven) dataProven++; else dataUnproven++;
    console.log(`  ${String(d.index).padStart(2)}. ${label.padEnd(11)} ${d.known.label} [class ${d.known.class}]`);
    console.log(`      ${r.detail}`);
    if (!r.proven) console.log(`      why: ${d.known.why}`);
  }
  console.log(`\n  data: proven=${dataProven} unproven=${dataUnproven}`);
}

// ── VERDICT ───────────────────────────────────────────────────────────────
const schemaTotal = tally.APPLIED + tally.MISSING + tally.MISMATCH;
let verdict;
if (tally.MISMATCH > 0) verdict = VERDICT.INCONSISTENT;
else if (tally.UNPARSED > 0) verdict = VERDICT.UNPARSED;
else if (tally.APPLIED === 0 && schemaTotal > 0) verdict = VERDICT.NOT_APPLIED;
else if (tally.MISSING > 0) verdict = VERDICT.PARTIAL_SCHEMA;
else if (dataUnproven > 0) verdict = VERDICT.SCHEMA_DATA_UNVERIFIED;
else verdict = VERDICT.FULLY_VERIFIED;

console.log(`\n${line}`);
console.log(`VERDICT: ${verdict}`);
const explain = {
  [VERDICT.INCONSISTENT]: 'An object exists with the WRONG SHAPE. That is not "applied" - it is a\n'
    + 'database that disagrees with the migration. Manual review before anything else.',
  [VERDICT.UNPARSED]: 'A statement could not be parsed, so its effect cannot be proven. This tool\n'
    + 'fails closed: it will not certify a file it does not fully understand.',
  [VERDICT.NOT_APPLIED]: 'None of this file has executed. No repair is indicated - the deploy failed\n'
    + 'for some other reason. Read the deploy log.',
  [VERDICT.PARTIAL_SCHEMA]: 'Some statements executed and others did not. A plain re-run will stop on the\n'
    + 'first APPLIED statement. Choose the recovery deliberately from the list above.',
  [VERDICT.SCHEMA_DATA_UNVERIFIED]: 'Every schema effect is present, but at least one DATA effect is NOT proven.\n'
    + 'DO NOT JOURNAL. Journalling here would tell drizzle the migration is complete\n'
    + 'and permanently skip a backfill that may never have run.',
  [VERDICT.FULLY_VERIFIED]: 'Every schema effect is present AND every data effect was proven from current\n'
    + 'state. This is the only verdict under which journal repair is even a candidate.',
};
console.log(explain[verdict] ?? '');

// ── THE JOURNAL REPAIR GATE ───────────────────────────────────────────────
const gate = [
  ['the exact next migration file is established', true, file],
  ['every schema postcondition matches', tally.MISSING === 0 && tally.MISMATCH === 0],
  ['every data effect is proven', dataStatements.length === 0 || dataUnproven === 0],
  ['no material UNPARSED statement remains', tally.UNPARSED === 0],
  ['no cross-check anomalies', notes.length === 0, notes.join('; ')],
];
console.log(`\n${line}`);
console.log('JOURNAL REPAIR GATE');
for (const [label, ok, extra] of gate) {
  console.log(`  [${ok ? 'x' : ' '}] ${label}${extra ? `  (${extra})` : ''}`);
}
const machineOk = gate.every(([, ok]) => ok);
console.log('\n  Conditions this tool CANNOT check, and which are also required:');
console.log('    [ ] the expected migration hash is known and matches drizzle\'s scheme');
console.log('    [ ] journal ordering / created_at semantics are understood');
console.log('    [ ] a human has reviewed this complete output');
console.log('    [ ] a staging backup exists');
console.log('    [ ] the owner has authorized the manual database operation');
console.log(`\n  MACHINE-CHECKABLE CONDITIONS: ${machineOk ? 'ALL MET' : 'NOT MET'}`);
console.log(`  JOURNAL REPAIR: ${machineOk ? 'CANDIDATE - still requires every human condition above' : 'REFUSED'}`);
console.log(line);
console.log('\nThis tool wrote nothing. Every query above was a SELECT.');
console.log('It is evidence support, not authority to act.');
await db.end();

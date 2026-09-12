/**
 * THE USER DIRECTORY, AGAINST THE DATABASE.
 *
 * Every count and every page is checked against a straight SQL answer, not
 * against the previous version of itself. The defect being fixed was a hard
 * `limit(250)` with the screen filtering, grouping, sorting and paging over
 * whatever came back - so past 250 accounts the tiles reported a sample as a
 * population and a search for a real user said there was no such user.
 *
 * The paging checks below deliberately walk EVERY page and assert the union is
 * the whole set with no duplicates, because an unstable sort shows one account
 * twice and hides another, and a spot check of page 1 would never see it.
 */
import { adminSession } from './lib/session.mjs';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
let pass = 0, fail = 0;
const check = (ok, name, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const sql = query => execFileSync('mysql', ['-h127.0.0.1', '-ubh', '-pbhlocal', '-N', '-B', '-e', query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const s = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
if (!s.ok) { console.error('SIGN-IN FAILED:', s.reason); process.exit(1); }

const directory = async input => {
  const url = `${BASE}/api/trpc/admin.users?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const r = await fetch(url, { headers: { cookie: s.cookie } });
  const body = await r.json().catch(() => null);
  return { status: r.status, data: body?.result?.data?.json };
};

// ── counts, against SQL ──────────────────────────────────────────────────
const dbTotal = Number(sql('select count(*) from buildhub_prelaunch.users;'));
const dbDummy = Number(sql('select count(*) from buildhub_prelaunch.users where isDummy=1;'));
const dbByRole = Object.fromEntries(
  sql('select coalesce(userRole, role), count(*) from buildhub_prelaunch.users group by coalesce(userRole, role);')
    .split('\n').filter(Boolean).map(line => { const [k, v] = line.split('\t'); return [k, Number(v)]; }),
);

const first = await directory({ group: 'all', sort: 'newest', page: 0, pageSize: 10 });
check(first.status === 200, 'the directory answers an administrator', `http ${first.status}`);
check(first.data?.counts?.all === dbTotal, 'the total count matches the database',
  `api ${first.data?.counts?.all} vs sql ${dbTotal}`);
check(first.data?.counts?.dummy === dbDummy, 'the dummy count matches the database',
  `api ${first.data?.counts?.dummy} vs sql ${dbDummy}`);
check(first.data?.counts?.real === dbTotal - dbDummy, 'and real is the difference, not a separate guess');

for (const [role, expected] of Object.entries(dbByRole)) {
  check(first.data?.counts?.byRole?.[role] === expected,
    `the ${role} tile matches the database`, `api ${first.data?.counts?.byRole?.[role]} vs sql ${expected}`);
}

// ── the page is a page, and the total is the whole filtered set ──────────
check(Array.isArray(first.data?.rows) && first.data.rows.length === Math.min(10, dbTotal),
  'a page returns exactly its page size', `${first.data?.rows?.length} rows`);
check(first.data?.total === dbTotal, 'the unfiltered total is every account, not the page length',
  `${first.data?.total}`);

// ── EVERY page, unioned: no duplicates, nothing lost ─────────────────────
const seen = new Set();
let duplicates = 0;
const pageCount = Math.ceil(dbTotal / 10);
for (let page = 0; page < pageCount; page += 1) {
  const result = await directory({ group: 'all', sort: 'newest', page, pageSize: 10 });
  for (const row of result.data?.rows ?? []) {
    if (seen.has(row.id)) duplicates += 1;
    seen.add(row.id);
  }
}
check(duplicates === 0, 'walking every page shows no account twice', `${duplicates} duplicate(s)`);
check(seen.size === dbTotal, 'and loses none of them', `${seen.size} of ${dbTotal}`);

// ── group filter ─────────────────────────────────────────────────────────
const suppliers = await directory({ group: 'supplier', sort: 'newest', page: 0, pageSize: 100 });
check(suppliers.data?.total === (dbByRole.supplier ?? 0), 'filtering by group totals that group',
  `api ${suppliers.data?.total} vs sql ${dbByRole.supplier ?? 0}`);
check((suppliers.data?.rows ?? []).every(r => (r.userRole ?? r.role) === 'supplier'),
  'and every row in it really is one');
check(suppliers.data?.counts?.all === dbTotal,
  'while the tiles still describe the whole platform, not the filter',
  `${suppliers.data?.counts?.all}`);

// ── search happens in the database, and is wildcard-safe ─────────────────
const oneUser = sql("select email from buildhub_prelaunch.users where email is not null order by id desc limit 1;");
const found = await directory({ search: oneUser, group: 'all', sort: 'newest', page: 0, pageSize: 10 });
check(found.data?.total >= 1 && (found.data?.rows ?? []).some(r => r.email === oneUser),
  'searching an exact email finds that account', `${found.data?.total} match(es)`);

const wildcard = await directory({ search: '%', group: 'all', sort: 'newest', page: 0, pageSize: 10 });
check(wildcard.data?.total === 0, 'a bare % is searched for literally, not treated as match-everything',
  `${wildcard.data?.total} match(es)`);

const nonsense = await directory({ search: 'zzz-no-such-user-zzz', group: 'all', sort: 'newest', page: 0, pageSize: 10 });
check(nonsense.data?.total === 0 && (nonsense.data?.rows ?? []).length === 0,
  'a search with no matches is a real empty result');

// ── no credential material ever leaves ───────────────────────────────────
const raw = JSON.stringify(first.data ?? {});
check(!/passwordHash|tokenHash|scrypt\$/.test(raw), 'no credential material is in the payload');

// ── the bound: an administrator cannot ask for the whole table ───────────
const oversized = await directory({ group: 'all', sort: 'newest', page: 0, pageSize: 5000 });
check(oversized.status === 400, 'an unbounded page size is refused', `http ${oversized.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

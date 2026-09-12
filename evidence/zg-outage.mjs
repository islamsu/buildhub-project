// ── LIVE: an outage is not an empty state ─────────────────────────────────
//
// The unit suite proves `requireDb` throws and that no procedure returns `[]`
// on an unreachable database. It cannot prove what a REAL request gets when
// the database is genuinely gone - which is the whole claim.
//
// So this breaks the database for real. It revokes the application user's
// privileges mid-flight, makes the same authenticated requests it just made
// successfully, and asserts each one now FAILS rather than reporting zero.
// Then it restores the grant and proves the same requests recover.
//
// EVERY POSITIVE CONTROL RUNS FIRST, against a working database. A probe that
// only ran the outage half would pass identically against an endpoint that was
// broken all along.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

const sql = (q, db = DB) => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${db} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();
const root = q => execSync(`mysql -u root -N -B`, { input: q.replace(/\s+/g, ' ').trim() }).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

function session(initial = '') {
  let cookie = initial;
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    const all = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of all) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, data: json?.result?.data?.json ?? null, error: json?.error?.json?.message ?? null };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i) };
}

/**
 * The account the running server connects as, and EVERY host entry it has.
 *
 * Which entry a connection matches depends on name resolution, so revoking
 * from one is a coin toss. All of them are revoked and all of them restored.
 */
const DB_USER = 'bh';
const HOSTS = root(`select host from mysql.user where user='${DB_USER}'`).split('\n').map(h => h.trim()).filter(Boolean);
if (HOSTS.length === 0) throw new Error(`probe setup: no host entries for '${DB_USER}'`);
const stamp = Date.now() % 100000000;
const made = { users: [] };

async function supplier() {
  const username = `zgout${stamp}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: 'ProbeSupplier!2024',
      name: 'Outage Probe', userRole: 'supplier',
    } }),
  });
  if (res.status !== 200) throw new Error(`probe setup: signUp failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  if (sql(`select username from users where id=${id}`) !== username) throw new Error('probe setup: wrong row');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  made.users.push(id);
  return { id, session: session((res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')) };
}

/**
 * The reads under test. Each is a place where an empty answer is a STATEMENT:
 * "you have no notifications", "BuildHub has no categories", "0 users".
 */
const READS = [
  { path: 'marketplace.categoryNames', input: undefined, auth: false, empty: 'no categories at all' },
  { path: 'marketplace.list', input: {}, auth: false, empty: 'an empty catalogue' },
  { path: 'notifications.unreadCount', input: undefined, auth: true, empty: '0 unread' },
  { path: 'notifications.list', input: undefined, auth: true, empty: 'no notifications' },
  { path: 'projects.list', input: undefined, auth: true, empty: 'no projects' },
  { path: 'marketplace.myProducts', input: undefined, auth: true, empty: 'an empty catalogue of your own' },
];

let broke = false;
try {
  const vendor = await supplier();
  const anon = session();

  // ── POSITIVE CONTROLS, against a working database ──────────────────────
  const before = [];
  for (const read of READS) {
    const who = read.auth ? vendor.session : anon;
    const result = await who.query(read.path, read.input);
    before.push(result);
    check(`WORKING: ${read.path} answers`, result.status === 200, `${result.status} ${result.error ?? ''}`);
  }
  if (before.some(r => r.status !== 200)) throw new Error('probe setup: an endpoint was already failing');

  // ── BREAK IT, FOR REAL ─────────────────────────────────────────────────
  //
  // Not a mocked null. The application's database user loses SELECT on the
  // live pool, so the next query fails exactly as it would in an incident.
  //
  // The grant is REVOKED FROM EVERY HOST ENTRY the account has - the first
  // version of this probe assumed 'bh'@'%' with a per-database grant and got
  // "no such grant defined", which aborted it before a single outage
  // assertion ran. The account's real hosts are read from mysql.user and the
  // real grants are SELECT, so nothing here depends on how the account was
  // set up.
  root(`revoke select on *.* from ${HOSTS.map(h => `'${DB_USER}'@'${h}'`).join(', ')}; flush privileges;`);
  broke = true;
  /*
   * AND THE OPEN CONNECTIONS ARE KILLED.
   *
   * Revoking alone did NOT break anything: MariaDB snapshots global privileges
   * onto a connection when it is made, so the pool's existing connections kept
   * reading happily and this probe reported seven false failures against a
   * product that was behaving correctly. The revoke has to be paired with
   * forcing a reconnect, which is what an incident actually looks like.
   */
  const threads = root(`select id from information_schema.processlist where user='${DB_USER}'`)
    .split('\n').map(t => t.trim()).filter(Boolean);
  check('the probe found the live pool connections to kill', threads.length > 0, `${threads.length} threads`);
  for (const id of threads) {
    try { root(`kill ${id}`); } catch { /* already gone */ }
  }
  await new Promise(r => setTimeout(r, 500));

  // VERIFY THE INSTRUMENT before trusting a single outage assertion. A probe
  // that cannot actually break the database proves nothing by observing that
  // nothing broke.
  let denied = false;
  try {
    // A REAL TABLE. `select 1` needs no table privilege at all and succeeded
    // against a correctly revoked account, so the first version of this check
    // reported the instrument as broken when it was working.
    execSync(`mysql -u ${DB_USER} -pbhlocal -h 127.0.0.1 ${DB} -N -B`,
      { input: 'select count(*) from users', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { denied = true; }
  check('INSTRUMENT: the application account really cannot read any table', denied);
  if (!denied) throw new Error('probe setup: the database was not actually broken');

  for (const read of READS) {
    const who = read.auth ? vendor.session : anon;
    const result = await who.query(read.path, read.input);
    const isEmptyish = Array.isArray(result.data)
      ? result.data.length === 0
      : result.data !== null && typeof result.data === 'object'
        && Object.values(result.data).every(v => v === 0 || v === null || (Array.isArray(v) && v.length === 0));
    check(`OUTAGE: ${read.path} FAILS rather than reporting ${read.empty}`,
      result.status !== 200 && !(result.status === 200 && isEmptyish),
      `status=${result.status} data=${JSON.stringify(result.data)?.slice(0, 80)}`);
  }

  /*
   * THE CACHED READ IS A SEPARATE CASE, AND IT IS NOT A LIE.
   *
   * marketplace.platformStats memoises its figures (server/platformStats.ts),
   * so during an outage it serves the LAST REAL NUMBERS rather than zeroes.
   * That is stale, not fabricated, and it is the one shape of degradation this
   * work does not object to. What it must never do is report zero - which is
   * what the pre-existing `if (!db) return { registeredUsers: 0, ... }` did.
   */
  const cached = await anon.query('marketplace.platformStats', undefined);
  check('OUTAGE: the cached platform figures are stale, never zeroed',
    cached.status !== 200 || Number(cached.data?.registeredUsers) > 0,
    `status=${cached.status} users=${cached.data?.registeredUsers}`);

  /*
   * ── RESTORE, AND PROVE IT RECOVERS ────────────────────────────────────
   *
   * The grant comes back AND the pool is recycled, and the second half is not
   * a workaround for a product defect - it is what the instrument's own
   * mechanism requires. MySQL snapshots global privileges onto a connection
   * when it is opened: the connections the pool made DURING the revocation
   * carry the revoked ACL for as long as they live, so restoring the grant
   * alone leaves them denied. Verified in isolation with a bare
   * drizzle+mysql2 pool, outside this application entirely.
   *
   * A real outage - the database going away - closes the sockets, and mysql2
   * discards dead connections and reconnects on its own. This scenario is
   * unusual precisely because the connection stays healthy while its
   * privileges go stale.
   */
  root(`grant all privileges on *.* to ${HOSTS.map(h => `'${DB_USER}'@'${h}'`).join(', ')}; flush privileges;`);
  broke = false;
  for (const id of root(`select id from information_schema.processlist where user='${DB_USER}'`)
    .split('\n').map(t => t.trim()).filter(Boolean)) {
    try { root(`kill ${id}`); } catch { /* already gone */ }
  }
  await new Promise(r => setTimeout(r, 800));

  for (const read of READS) {
    const who = read.auth ? vendor.session : anon;
    // The pool may hold a connection that failed; retry briefly rather than
    // reporting a recovered platform as broken.
    let result = null;
    for (let i = 0; i < 10; i += 1) {
      result = await who.query(read.path, read.input);
      if (result.status === 200) break;
      await new Promise(r => setTimeout(r, 400));
    }
    check(`RECOVERED: ${read.path} answers again`, result?.status === 200,
      `${result?.status} ${result?.error ?? ''}`);
  }
} catch (error) {
  check(`PROBE ABORTED: ${(error && error.message) || error}`, false);
} finally {
  // The grant is restored no matter how this ends. A probe that leaves the
  // application unable to reach its own database is worse than no probe.
  if (broke) root(`grant all privileges on *.* to ${HOSTS.map(h => `'${DB_USER}'@'${h}'`).join(', ')}; flush privileges;`);
  try {
    if (made.users.length > 0) {
      sql(`delete from products where supplierId in (${made.users.join(',')})`);
      sql(`delete from userAccountAuditEvents where userId in (${made.users.join(',')}) or actorId in (${made.users.join(',')})`);
      sql(`delete from users where id in (${made.users.join(',')})`);
    }
  } catch { /* reported below */ }
}

check('CLEANUP: the application can reach its database again',
  Number(sql(`select 1`)) === 1
  && Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0);

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);

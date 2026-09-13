// ── LIVE: the account audit trail ─────────────────────────────────────────
//
// AUD. The unit suite pins the predicates against doubles. Six things it
// structurally cannot prove, and they are the six this probe exists for:
//
//   THE REPORT NO LONGER STOPS AT 1,000. Proven by writing more events than
//     the old cap and reading the real total back from the live query.
//
//   AND THE PAGES COVER ALL OF THEM, exactly once - walked end to end against
//     MySQL, with no row repeated across a boundary.
//
//   A SEARCH OVER A NAME FINDS EVENTS THE PAGE CANNOT SHOW. Before, a search
//     ran in the browser over a truncated set and answered "no such event"
//     with the same confidence it answered correctly.
//
//   THE COUNT AND THE ROWS AGREE under that search, which is the invariant
//     adminList exists to make unbreakable - and only a real join can show it.
//
//   AN EVENT ABOUT A DELETED ACCOUNT SURVIVES. The id columns are nullable on
//     purpose; an inner join would drop exactly that history.
//
//   AND THE PERMISSIONS HOLD: audit.read for the platform report, users.read
//     for one account, and neither for a signed-out caller.
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const stamp = Date.now() % 100000000;
/**
 * A TOKEN ONLY THE SEEDED EVENTS CARRY.
 *
 * The first run searched on the bare stamp and reported 1,204 where 1,200 were
 * expected. The product was right: the three probe ACCOUNTS are named with the
 * same stamp, so their own signup events matched the search too. The probe was
 * asking a looser question than it was checking - fixed here rather than by
 * loosening the assertion to match.
 */
const TAG = `audtag${stamp}`;
const made = [];
let eventsWritten = 0;

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  async post(path, input) {
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify({ json: input }),
    });
    this.absorb(res); return unwrap(res);
  }
  async get(path, input) {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: this.header() } });
    this.absorb(res); return unwrap(res);
  }
}
async function unwrap(res) {
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null, code: parsed?.error?.json?.data?.code ?? null };
}
async function account(prefix) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'AudPass!2026',
    name: `Probe ${prefix}`, userRole: 'homeowner',
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}

try {
  const admin = await account('audm');
  const subject = await account('auds');
  const stranger = await account('audx');
  sql(`update users set role='admin', adminRole='SUPER_ADMIN' where id=${admin.id}`);
  const superAdmin = new Session();
  const signIn = await superAdmin.post('auth.adminSignIn', {
    identifier: `audm${stamp}@example.test`, password: 'AudPass!2026',
  });
  check('1. SETUP: a Super Admin signs in through the real admin path',
    signIn.status === 200, `http=${signIn.status} err=${String(signIn.error).slice(0, 60)}`);

  // ── More events than the old cap ────────────────────────────────────────
  //
  // Written in SQL: the point under test is how they are READ, and driving
  // 1,200 real admin mutations would be a test of something else entirely.
  // Said plainly rather than dressed up as a product step.
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    const action = i % 3 === 0 ? 'probe_frozen' : i % 3 === 1 ? 'probe_unfrozen' : 'probe_noted';
    rows.push(`(${subject.id}, ${admin.id}, '${action}', 'probe', '${TAG} event ${i}')`);
  }
  sql(`insert into userAccountAuditEvents (userId, actorId, action, source, note) values ${rows.join(',')}`);
  eventsWritten = 1200;
  const stored = Number(sql(`select count(*) from userAccountAuditEvents where note like '${TAG}%'`));
  check('2. SETUP: 1,200 events exist — more than the old cap of 1,000', stored === 1200, `n=${stored}`);

  // ── The report no longer stops at 1,000 ─────────────────────────────────
  const page0 = await superAdmin.get('admin.fullAuditReport', { page: 0, pageSize: 100, search: TAG });
  check('3. THE REPORT NO LONGER STOPS AT 1,000: the real total is reported',
    page0.status === 200 && page0.data?.total === 1200,
    `http=${page0.status} total=${page0.data?.total} err=${String(page0.error).slice(0, 60)}`);
  check('4. and a page is a page, not the whole thing',
    (page0.data?.rows ?? []).length === 100, `n=${(page0.data?.rows ?? []).length}`);

  // ── The pages cover all of them, exactly once ───────────────────────────
  const seen = new Set();
  for (let p = 0; p < 20; p++) {
    const page = await superAdmin.get('admin.fullAuditReport', { page: p, pageSize: 100, search: TAG });
    for (const row of page.data?.rows ?? []) seen.add(row.id);
    if (seen.size >= (page.data?.total ?? 0)) break;
  }
  check('5. AND THE PAGES COVER ALL 1,200, EXACTLY ONCE', seen.size === 1200, `distinct=${seen.size}`);

  // ── A search finds what a truncated set could not ───────────────────────
  const deep = await superAdmin.get('admin.fullAuditReport', { search: `${TAG} event 1150` });
  check('6. A SEARCH FINDS AN EVENT PAST THE OLD CUT — row 1,151 of 1,200',
    deep.status === 200 && deep.data?.total === 1
      && String(deep.data?.rows?.[0]?.note).includes(`${TAG} event 1150`),
    `total=${deep.data?.total}`);

  const byName = await superAdmin.get('admin.fullAuditReport', { search: 'Probe auds' });
  check('7. and a search over the SUBJECT’S NAME reaches across the join',
    byName.status === 200 && byName.data?.total >= 1200, `total=${byName.data?.total}`);
  check('8. THE COUNT AND THE ROWS AGREE under that search',
    (byName.data?.rows ?? []).length === Math.min(25, byName.data?.total ?? 0),
    `rows=${(byName.data?.rows ?? []).length} total=${byName.data?.total}`);

  const byActor = await superAdmin.get('admin.fullAuditReport', { search: 'Probe audm' });
  check('9. and a search over the ACTOR’S name works too - "Mona" means the person either way',
    byActor.status === 200 && (byActor.data?.total ?? 0) >= 1200, `total=${byActor.data?.total}`);

  // ── The action filter is exact ──────────────────────────────────────────
  const frozen = await superAdmin.get('admin.fullAuditReport', { action: 'probe_frozen', search: TAG });
  check('10. AN ACTION IS MATCHED EXACTLY: probe_frozen does not catch probe_unfrozen',
    frozen.data?.total === 400, `total=${frozen.data?.total} (expected 400 of 1200)`);

  const options = await superAdmin.get('admin.auditFilterOptions');
  check('11. the filter options are read FROM THE DATA',
    (options.data?.actions ?? []).includes('probe_frozen')
      && (options.data?.sources ?? []).includes('probe'),
    `actions=${(options.data?.actions ?? []).length}`);

  // ── Identities, not ids ─────────────────────────────────────────────────
  const first = page0.data?.rows?.[0];
  check('12. a row names the SUBJECT and the ACTOR, never a bare id',
    first?.userName === 'Probe auds' && first?.actorName === 'Probe audm',
    `user=${first?.userName} actor=${first?.actorName}`);
  check('13. and carries the account facts the export needs',
    typeof first?.accountType === 'string' && typeof first?.invitationStatus === 'string',
    `${first?.accountType} / ${first?.role} / ${first?.invitationStatus}`);

  // ── An event about a deleted account survives ───────────────────────────
  sql(`insert into userAccountAuditEvents (userId, actorId, action, source, note) values (null, null, 'probe_orphan', 'system', '${TAG} orphan')`);
  const orphan = await superAdmin.get('admin.fullAuditReport', { search: `${TAG} orphan` });
  const orphanRow = orphan.data?.rows?.[0];
  check('14. AN EVENT WITH NO SUBJECT AND NO ACTOR STILL APPEARS — an inner join would drop it',
    orphan.data?.total === 1 && orphanRow?.userId === null, `total=${orphan.data?.total}`);
  check('15. and an actorless event reads "System", not a blank column',
    orphanRow?.actorName === 'System', String(orphanRow?.actorName));

  // ── One account's own trail ─────────────────────────────────────────────
  const own = await superAdmin.get('admin.accountAudit', { userId: subject.id, pageSize: 50 });
  check('16. ONE ACCOUNT’S TRAIL IS PAGED TOO, with its real total',
    own.status === 200 && own.data?.total >= 1200 && (own.data?.rows ?? []).length === 50,
    `total=${own.data?.total} rows=${(own.data?.rows ?? []).length}`);
  check('17. and contains only that account’s events',
    (own.data?.rows ?? []).every(row => row.userId === subject.id));

  // ── Negative controls ───────────────────────────────────────────────────
  const huge = await superAdmin.get('admin.fullAuditReport', { pageSize: 100000 });
  check('18. an unbounded page is refused by the schema',
    huge.status !== 200 && huge.code === 'BAD_REQUEST', `code=${huge.code}`);

  const byUser = await stranger.s.get('admin.fullAuditReport', {});
  check('19. AN ORDINARY ACCOUNT CANNOT READ THE PLATFORM AUDIT',
    byUser.status !== 200 && byUser.code === 'FORBIDDEN', `code=${byUser.code}`);
  const ownByUser = await stranger.s.get('admin.accountAudit', { userId: subject.id });
  check('20. nor one account’s trail', ownByUser.status !== 200 && ownByUser.code === 'FORBIDDEN',
    `code=${ownByUser.code}`);

  const anon = new Session();
  const anonRead = await anon.get('admin.fullAuditReport', {});
  check('21. and a signed-out caller certainly cannot',
    anonRead.status !== 200 && anonRead.code === 'UNAUTHORIZED', `code=${anonRead.code}`);

  // ── No secret ever reaches the response ─────────────────────────────────
  const body = JSON.stringify(page0.data ?? {});
  check('22. NO CREDENTIAL COLUMN APPEARS IN THE RESPONSE',
    !/passwordHash|invitationToken|openId/.test(body));

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  try { sql(`delete from userAccountAuditEvents where note like '${TAG}%'`); } catch {}
  for (const id of made) {
    for (const q of [
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from notifications where userId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  const leftEvents = Number(sql(`select count(*) from userAccountAuditEvents where note like '${TAG}%'`) || 0);
  check('23. CLEANUP: every account and all 1,200 probe events are gone',
    left === 0 && leftEvents === 0, `users=${left} events=${leftEvents}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

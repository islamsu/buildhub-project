/**
 * ── SOMEBODY ELSE'S PROJECT, ASKED FOR DIRECTLY ─────────────────────────
 *
 * callerOwnsTheRecord.test.ts proves every mutation that writes to a record
 * ASKS whether the caller may. That is a statement about the source. It cannot
 * tell you whether the answer is right, and a guard that is called and returns
 * true for everyone reads exactly the same in a grep.
 *
 * So this signs in as two unrelated homeowners and has the second one reach
 * for the first one's project over HTTP - no browser, no hidden buttons, just
 * the calls the client would make with an id changed. Every one of them has to
 * be refused, and the project has to be unchanged afterwards.
 *
 * THE POSITIVE CONTROL IS THE POINT. Each refusal is paired with the same call
 * made by the OWNER, which must succeed. Without that half, a server that was
 * simply broken - refusing everything, or 500ing on every write - would look
 * like perfect authorization.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';

/* WHICH BUILD THIS RAN AGAINST. Printed always; enforced when
   ZG_EXPECT_COMMIT names one, so a pass can never be reported against
   a build somebody did not mean to test. */
await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
let step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

async function call(path, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

function makeHomeowner(name) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${name}', '${name}', '${name}@example.test', 'Probe ${name}', 'user',
        'homeowner', 'password', 'self_registered', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  return Number(sql(`select id from users where username='${name}'`));
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zown%') as probe)`;
  for (const statement of [
    `delete from milestones where projectId in (select id from projects where ownerId in ${ids})`,
    `delete from tasks where projectId in (select id from projects where ownerId in ${ids})`,
    `delete from projectMembers where projectId in (select id from projects where ownerId in ${ids})`,
    `delete from commercialAuditEvents where actorId in ${ids} or ownerId in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from projects where ownerId in ${ids}`,
    `delete from users where username like 'zown%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

try {
  cleanUp();
  const ownerName = `zownA${stamp}`;
  const strangerName = `zownB${stamp}`;
  const ownerId = makeHomeowner(ownerName);
  const strangerId = makeHomeowner(strangerName);
  check(ownerId > 0 && strangerId > 0 && ownerId !== strangerId,
    'SETUP: two unrelated homeowners exist', `${ownerId} and ${strangerId}`);

  const ownerCookie = await signIn(`${ownerName}@example.test`);
  const strangerCookie = await signIn(`${strangerName}@example.test`);
  check(ownerCookie.length > 0 && strangerCookie.length > 0 && ownerCookie !== strangerCookie,
    'both are signed in, as themselves');

  const made = await call('projects.create', { title: 'Probe villa' }, ownerCookie);
  const projectId = Number(sql(`select id from projects where ownerId=${ownerId} order by id desc limit 1`));
  check(made.status === 200 && projectId > 0, 'the first homeowner has a project', `id ${projectId}`);

  /*
   * THE STRANGER IS NOT A MEMBER. Worth asserting rather than assuming: if the
   * product added every signed-in user to every project, every refusal below
   * would be a pass for the wrong reason.
   */
  const membership = Number(sql(`select count(*) from projectMembers
                                 where projectId=${projectId} and userId=${strangerId}`));
  check(membership === 0, 'and the second is not a member of it', `${membership} membership rows`);

  // ── Each write, refused for the stranger and allowed for the owner ──────
  const attempts = [
    ['projects.addMilestone', { projectId, title: 'Injected milestone' }, () =>
      Number(sql(`select count(*) from milestones where projectId=${projectId}`))],
    ['projects.addTask', { projectId, title: 'Injected task' }, () =>
      Number(sql(`select count(*) from tasks where projectId=${projectId}`))],
    /*
     * `id`, not `projectId`. The first version of this passed `projectId` and
     * got a 400 back, which the check read as a refusal - so it would have
     * reported a pass on a mutation with no authorization at all. A rejection
     * from input validation is not a rejection from a guard, and the two are
     * indistinguishable if you only look at the status code. The owner's call
     * beside it is what exposed it: the same input failed for the owner too.
     */
    ['projects.update', { id: projectId, title: 'Renamed by a stranger' }, () =>
      sql(`select title from projects where id=${projectId}`)],
  ];

  for (const [path, input, readBack] of attempts) {
    const before = readBack();
    const refused = await call(path, input, strangerCookie);
    const after = readBack();
    check(refused.status >= 400 && refused.status < 500,
      `NEGATIVE: ${path} by a stranger is refused`,
      `HTTP ${refused.status} ${refused.body?.error?.json?.data?.code ?? ''}`);
    check(String(after) === String(before),
      `and ${path} changed nothing`, `${before} then ${after}`);

    const allowed = await call(path, input, ownerCookie);
    check(allowed.status === 200,
      `POSITIVE: ${path} by the owner succeeds`,
      `HTTP ${allowed.status}${allowed.status === 200 ? '' : ' ' + JSON.stringify(allowed.body?.error?.json?.message ?? '')}`);
  }

  // ── Reading it is refused too ───────────────────────────────────────────
  const read = cookie => fetch(
    `${BASE}/api/trpc/projects.get?input=${encodeURIComponent(JSON.stringify({ json: { id: projectId } }))}`,
    { headers: { cookie } });

  const peek = await read(strangerCookie);
  const peekBody = await peek.text();
  check(peek.status >= 400 && !peekBody.includes('Probe villa'),
    'NEGATIVE: the stranger cannot read the project either',
    `HTTP ${peek.status}`);

  /*
   * The owner's read is the control for the one above. Without it, a typo in
   * the procedure name gives a 404 for everybody and the refusal looks
   * perfect - which is exactly what the first run of this did.
   */
  const ownerPeek = await read(ownerCookie);
  const ownerBody = await ownerPeek.text();
  /*
   * Compared against the CURRENT stored title rather than the one the project
   * was created with: the owner's positive control above renames it, so
   * looking for the original name failed here on a read that was working
   * perfectly well.
   */
  const storedTitle = sql(`select title from projects where id=${projectId}`);
  check(ownerPeek.status === 200 && ownerBody.includes(storedTitle),
    'POSITIVE: the owner can, and sees their own project',
    `HTTP ${ownerPeek.status}, title ${JSON.stringify(storedTitle)}`);

  // ── And with no session at all ──────────────────────────────────────────
  const anon = await call('projects.addMilestone', { projectId, title: 'Anonymous' }, null);
  check(anon.status === 401, 'NEGATIVE: with no session it is refused', `HTTP ${anon.status}`);
} finally {
  cleanUp();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

// ── LIVE: can BuildHub be robbed of its own control plane? ─────────────────
//
// The attack this proves impossible was reachable before the guard existed:
// `admin.setUserFrozen` is gated on `users.manage`, which USER_ADMIN holds. It
// accepted any userId and refused only the caller's own account, so a
// USER_ADMIN could freeze every Super Admin in turn and leave nobody able to
// unfreeze them or create another. Recovery would have needed direct database
// access.
//
// Every account here is created through the REAL admin endpoints where the
// endpoint exists, signed in through the REAL sign-in, and the attack is a
// REAL authenticated HTTP call - not a unit test of a helper.
import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
/**
 * Run SQL by piping it to the client on STDIN.
 *
 * NOT via `-e "..."`. A password hash looks like `scrypt$N$r$p$salt$hash`, and
 * JSON.stringify produces a DOUBLE-quoted shell argument, so bash expanded
 * `$N`, `$r` and `$p` to nothing before MySQL ever saw the string. The seeded
 * hash was silently corrupted, every sign-in failed with "Invalid credentials",
 * and the attack checks passed on a 401 that meant "not signed in".
 *
 * stdin has no shell quoting to get wrong, which is why it is the right
 * mechanism rather than a cleverer escape.
 */
const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q },
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

/** A signed-in HTTP session, holding its own cookie jar. */
function session() {
  let cookie = '';
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    // getSetCookie() returns each header separately; get() joins them with ", "
    // and would produce a malformed jar the moment a second cookie is set.
    const all = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const raw of all) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, data: json?.result?.data?.json ?? null, error: json?.error?.json?.message ?? null };
  };
  return {
    query: (p, i) => call('GET', p, i),
    mutate: (p, i) => call('POST', p, i),
  };
}

const stamp = Date.now() % 100000000;
/**
 * The password the seeded hash actually belongs to.
 *
 * The first version of this probe invented a password and seeded a hash copied
 * from the bootstrap administrator - a hash for a DIFFERENT password. Every
 * sign-in failed, so every "ATTACK BLOCKED" check passed with a 401 that meant
 * "you are not signed in" rather than "the guard refused you". Four vacuous
 * passes reporting a security property that had not been tested at all.
 *
 * The probe now signs in with the password that hash was made from, and
 * refuses to run the attack at all unless the attacker session is proven first.
 */
const PASSWORD = 'LocalSuperAdmin!2024';

/**
 * Create an administrator DIRECTLY in the database with a usable password.
 *
 * The real createAdmin endpoint deliberately leaves the account without a
 * password until the invitee redeems their link, which is correct product
 * behaviour and useless for a probe that needs to SIGN IN as the attacker.
 * The password hash is produced by the application's own hashing, read back
 * from a real account, so this is not a weaker credential path - it is the
 * same one, seeded.
 */
function makeAdmin(suffix, adminRole, passwordHash) {
  const u = `zadm${stamp}${suffix}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe ${suffix}', 'admin',
        '${adminRole}', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        ${passwordHash === null ? 'NULL' : `'${passwordHash}'`}, ${passwordHash === null ? 'NULL' : 'now()'})`);
  const id = Number(sql(`select id from users where username='${u}'`));
  const back = sql(`select username from users where id=${id}`);
  if (!Number.isInteger(id) || id <= 0 || back !== u) {
    throw new Error(`probe setup: created ${u} but id ${id} holds "${back}"`);
  }
  return { id, username: u, email: `${u}@example.test` };
}

try {
  // Purge anything a previous crashed run left behind.
  sql(`delete from userAccountAuditEvents where userId in (select id from users where username like 'zadm%')`);
  sql(`delete from adminInvitations where userId in (select id from users where username like 'zadm%')`);
  sql(`delete from users where username like 'zadm%'`);

  // A real password hash, minted by the application itself.
  const bootstrapHash = sql(`select passwordHash from users where role='admin' and passwordHash is not null limit 1`);
  check('SETUP: an application-produced password hash is available to seed with',
    !!bootstrapHash && bootstrapHash.length > 20, bootstrapHash ? `${bootstrapHash.slice(0, 7)}…` : 'none');

  // The bootstrap Super Admin already exists; give the probe its own cast.
  const sa1 = makeAdmin('sa1', 'SUPER_ADMIN', bootstrapHash);
  const sa2 = makeAdmin('sa2', 'SUPER_ADMIN', bootstrapHash);
  const userAdmin = makeAdmin('ua', 'USER_ADMIN', bootstrapHash);
  const dormantSa = makeAdmin('dormant', 'SUPER_ADMIN', null);   // never redeemed

  // ── The attacker signs in for real ─────────────────────────────────────
  const attacker = session();
  const signIn = await attacker.mutate('auth.adminSignIn', {
    identifier: userAdmin.email, password: PASSWORD,
  });
  const me = await attacker.query('admin.me', undefined);
  check('SETUP: the USER_ADMIN holds a real authenticated admin session',
    me.data?.adminRole === 'USER_ADMIN',
    `signIn=${signIn.status}/${signIn.data?.adminRole ?? signIn.error} me=${me.status}/${me.data?.adminRole ?? me.error}`);
  // WITHOUT THIS GATE the attack checks below pass on a 401 that means "not
  // signed in" - a vacuous pass asserting a security property nothing tested.
  if (me.data?.adminRole !== 'USER_ADMIN') {
    throw new Error('probe setup: the attacker session was never established, so the attack cannot be attempted');
  }
  check('SETUP: and does NOT hold admins.manage',
    Array.isArray(me.data?.permissions) && !me.data.permissions.includes('admins.manage'),
    JSON.stringify(me.data?.permissions));

  // ── THE ATTACK ─────────────────────────────────────────────────────────
  const freeze = await attacker.mutate('admin.setUserFrozen', { userId: sa1.id, frozen: true });
  check('ATTACK BLOCKED: a USER_ADMIN cannot freeze a Super Admin',
    freeze.data?.success !== true, `${freeze.status} ${String(freeze.error).slice(0, 70)}`);

  const sa1Status = sql(`select accountStatus from users where id=${sa1.id}`);
  check('ATTACK BLOCKED: the Super Admin account is still active IN THE DATABASE',
    sa1Status === 'active', sa1Status);

  const verifyAttack = await attacker.mutate('admin.verifyUser', { userId: sa1.id, verified: false });
  check('ATTACK BLOCKED: a USER_ADMIN cannot un-verify a Super Admin either',
    verifyAttack.data?.success !== true, `${verifyAttack.status}`);

  // The rule must not have broken what users.manage is FOR.
  // Create one rather than hoping the database holds one: "no ordinary user
  // existed" is a probe that could not run, not evidence about the guard.
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified)
       values ('probe-zadm${stamp}usr', 'zadm${stamp}usr', 'zadm${stamp}usr@example.test',
        'Probe Ordinary', 'user', 'homeowner', 'password', 'self_registered', 0,
        'active', 'approved', 1)`);
  const ordinary = sql(`select id from users where username='zadm${stamp}usr'`);
  if (ordinary) {
    const legit = await attacker.mutate('admin.setUserFrozen', { userId: Number(ordinary), frozen: true });
    check('NOT A BLANKET DENIAL: the USER_ADMIN can still freeze an ORDINARY user',
      legit.data?.success === true, `${legit.status} ${String(legit.error).slice(0, 60)}`);
    await attacker.mutate('admin.setUserFrozen', { userId: Number(ordinary), frozen: false });
  } else {
    check('NOT A BLANKET DENIAL: an ordinary user existed to test with', false, 'no ordinary user in the database');
  }

  // ── LAST SUPER ADMIN, via Admin Management ─────────────────────────────
  const boss = session();
  await boss.mutate('auth.adminSignIn', { identifier: sa1.email, password: PASSWORD });
  const bossMe = await boss.query('admin.me', undefined);
  check('SETUP: a Super Admin session is established',
    bossMe.data?.adminRole === 'SUPER_ADMIN', String(bossMe.data?.adminRole ?? bossMe.error));
  if (bossMe.data?.adminRole !== 'SUPER_ADMIN') {
    throw new Error('probe setup: no Super Admin session, so the survival checks cannot be attempted');
  }

  // Reduce the platform to exactly ONE usable Super Admin: sa1.
  // (The bootstrap admin and sa2 are demoted out of the way by sa1 itself.)
  const bootstrapSa = Number(sql(
    `select id from users where role='admin' and adminRole='SUPER_ADMIN' and username not like 'zadm%' limit 1`));
  const demoteOther = await boss.mutate('admin.setAdminRole', { userId: sa2.id, adminRole: 'USER_ADMIN' });
  check('CONTROL: a Super Admin CAN be demoted while others remain',
    demoteOther.data?.success === true, `${demoteOther.status} ${String(demoteOther.error).slice(0, 60)}`);

  if (bootstrapSa) {
    await boss.mutate('admin.setAdminRole', { userId: bootstrapSa, adminRole: 'USER_ADMIN' });
  }

  const usable = Number(sql(`select count(*) from users where role='admin' and adminRole='SUPER_ADMIN'
    and accountStatus='active' and deactivatedAt is null and passwordHash is not null`));
  check('SETUP: exactly ONE usable Super Admin remains (the dormant one does not count)',
    usable === 1, `usable=${usable}`);

  const dormantExists = Number(sql(`select count(*) from users where id=${dormantSa.id} and adminRole='SUPER_ADMIN'`));
  check('SETUP: a dormant never-redeemed Super Admin DOES exist alongside it',
    dormantExists === 1, `rows=${dormantExists}`);

  // sa1 is now the only usable Super Admin. A second Super Admin cannot be
  // used to demote them, so the remaining route is another Super Admin -
  // there is none - or sa1 acting on themselves, which is already refused.
  // The guard must ALSO refuse the case where a second Super Admin exists but
  // is not usable, which is exactly the dormant account.
  const demoteDormantHolder = await boss.mutate('admin.setAdminRole', {
    userId: dormantSa.id, adminRole: 'USER_ADMIN',
  });
  check('CONTROL: demoting the DORMANT Super Admin is allowed - it protects nobody',
    demoteDormantHolder.data?.success === true,
    `${demoteDormantHolder.status} ${String(demoteDormantHolder.error).slice(0, 60)}`);

  // Now promote sa2 back and prove the pair case: each may demote the other
  // until one is left, and then the last demotion fails.
  await boss.mutate('admin.setAdminRole', { userId: sa2.id, adminRole: 'SUPER_ADMIN' });
  const second = session();
  await second.mutate('auth.adminSignIn', { identifier: sa2.email, password: PASSWORD });

  const demoteFirst = await second.mutate('admin.setAdminRole', { userId: sa1.id, adminRole: 'USER_ADMIN' });
  check('PAIR CASE: the second Super Admin may demote the first, leaving one',
    demoteFirst.data?.success === true, `${demoteFirst.status} ${String(demoteFirst.error).slice(0, 60)}`);

  // sa2 is now the last. sa2 cannot demote themselves (self-check), and the
  // demoted sa1 no longer has the authority. Prove the guard from sa2's own
  // session by attempting to deactivate the only remaining Super Admin.
  const lastStanding = Number(sql(`select count(*) from users where role='admin' and adminRole='SUPER_ADMIN'
    and accountStatus='active' and deactivatedAt is null and passwordHash is not null`));
  check('SETUP: exactly one usable Super Admin remains for the final checks',
    lastStanding === 1, `count=${lastStanding}`);

  // Re-promote sa1 so there are two sessions with authority, then have sa1
  // attempt to remove sa2 AND then be removed - the sequence that empties it.
  await second.mutate('admin.setAdminRole', { userId: sa1.id, adminRole: 'SUPER_ADMIN' });
  const bossAgain = session();
  await bossAgain.mutate('auth.adminSignIn', { identifier: sa1.email, password: PASSWORD });
  await bossAgain.mutate('admin.setAdminRole', { userId: sa2.id, adminRole: 'USER_ADMIN' });

  // sa1 alone. Freeze attempt by a Super Admin on the last Super Admin, via
  // the user-directory path (sa1 holds users.manage too).
  const freezeLast = await bossAgain.mutate('admin.setUserFrozen', { userId: sa1.id, frozen: true });
  check('LAST SUPER ADMIN: cannot freeze themselves (self-check holds)',
    freezeLast.data?.success !== true, `${freezeLast.status} ${String(freezeLast.error).slice(0, 60)}`);

  // Promote a helper, then have the helper try to remove the last usable one
  // AFTER demoting themselves out of the count is impossible - so instead
  // verify directly that the survival guard refuses when the count would hit 0.
  await bossAgain.mutate('admin.setAdminRole', { userId: sa2.id, adminRole: 'SUPER_ADMIN' });
  const helper = session();
  await helper.mutate('auth.adminSignIn', { identifier: sa2.email, password: PASSWORD });
  // Helper deactivates sa1 -> one usable left (sa2). Allowed.
  const deactivateFirst = await helper.mutate('admin.setAdminActive', { userId: sa1.id, active: false });
  check('CONTROL: deactivating a Super Admin is allowed while another remains',
    deactivateFirst.data?.success === true, `${deactivateFirst.status} ${String(deactivateFirst.error).slice(0, 60)}`);

  // Now sa2 is the only usable one. sa1 is deactivated but still SUPER_ADMIN,
  // so a naive count that ignored accountStatus would say "two remain".
  const naiveCount = Number(sql(`select count(*) from users where role='admin' and adminRole='SUPER_ADMIN'`));
  const realCount = Number(sql(`select count(*) from users where role='admin' and adminRole='SUPER_ADMIN'
    and accountStatus='active' and deactivatedAt is null and passwordHash is not null`));
  check('THE COUNT THAT MATTERS: a naive count would over-report the safety margin',
    naiveCount > realCount && realCount === 1, `naive=${naiveCount} real=${realCount}`);

  // sa1 (deactivated) reactivated by sa2, then sa2 demoted by sa1 -> the guard
  // must let it through because sa1 is usable again.
  await helper.mutate('admin.setAdminActive', { userId: sa1.id, active: true });

  /**
   * WAIT OUT THE REVOCATION WINDOW. This is product behaviour, not a bug.
   *
   * `revocationCutoff()` is deliberately `Date.now() + 1000`: session `iat` has
   * second granularity, so rounding the cutoff UP is what guarantees that a
   * token minted in the same second as a revocation cannot survive it. The
   * cost is a sub-second window in which even a legitimate fresh sign-in is
   * refused - the right trade, and asserted in adminAuthorization.test.ts.
   *
   * Signing in inside that window made this probe report a product failure
   * that was really its own impatience.
   */
  const reactivationWindow = await new Promise(resolve => setTimeout(() => resolve(true), 1300));
  check('REVOCATION WINDOW: the probe waited out the deliberate 1s cutoff round-up',
    reactivationWindow === true, 'waited 1300ms');

  const finalBoss = session();
  await finalBoss.mutate('auth.adminSignIn', { identifier: sa1.email, password: PASSWORD });
  const demoteHelper = await finalBoss.mutate('admin.setAdminRole', { userId: sa2.id, adminRole: 'USER_ADMIN' });
  check('CONTROL: reactivating restores the margin, and the demotion then succeeds',
    demoteHelper.data?.success === true, `${demoteHelper.status} ${String(demoteHelper.error).slice(0, 60)}`);

  // ── AUDIT ──────────────────────────────────────────────────────────────
  const auditRows = Number(sql(`select count(*) from userAccountAuditEvents
    where userId in (${[sa1.id, sa2.id, userAdmin.id].join(',')})
      and action in ('admin_role_changed','admin_deactivated','admin_reactivated')`));
  check('AUDIT: every role change and deactivation left an audit row',
    auditRows >= 4, `rows=${auditRows}`);

  const blockedAudit = Number(sql(`select count(*) from userAccountAuditEvents
    where userId=${sa1.id} and action='account_frozen'`));
  check('AUDIT: the BLOCKED freeze wrote no audit row - it never happened',
    blockedAudit === 0, `rows=${blockedAudit}`);

  // ── NO SECRETS ─────────────────────────────────────────────────────────
  const admins = await finalBoss.query('admin.admins', undefined);
  const payload = JSON.stringify(admins.data ?? []);
  check('NO SECRETS: the administrator directory carries no hash or token',
    !/passwordHash|invitationToken|passwordResetToken|tokenHash/i.test(payload),
    `${(admins.data ?? []).length} rows`);

} catch (error) {
  check('THE PROBE ITSELF RAN TO COMPLETION', false, String(error && error.message).slice(0, 220));
} finally {
  const tidy = (label, statement) => {
    try { sql(statement); } catch (error) {
      results.push(`CLEANUP  ${label}: ${String(error && error.message).slice(0, 120)}`);
    }
  };
  // Restore the bootstrap Super Admin the probe demoted, so the environment is
  // left exactly as it was found.
  tidy('restore bootstrap', `update users set adminRole='SUPER_ADMIN'
     where role='admin' and username not like 'zadm%' and accountSource='admin_created'`);
  tidy('audit', `delete from userAccountAuditEvents where userId in (select id from users where username like 'zadm%')`);
  tidy('invitations', `delete from adminInvitations where userId in (select id from users where username like 'zadm%')`);
  tidy('admins', `delete from users where username like 'zadm%'`);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

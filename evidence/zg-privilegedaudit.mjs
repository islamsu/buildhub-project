/**
 * ── A PRIVILEGED ACTION SAYS WHO DID IT ──────────────────────────────────
 *
 * privilegedActionAudit.test.ts sweeps the router and asserts every
 * admin-gated mutation that writes to the database has an audit surface. That
 * is a statement about the SHAPE of the code. This is the other half: two of
 * those mutations are actually performed against a running server, and the
 * trail is read back afterwards.
 *
 * Both were silent until now, and they were silent in different ways:
 *
 *   setSupportTicketPriority  took no session at all, so there was no actor to
 *                             record even in principle - a ticket could be
 *                             moved down the queue leaving nothing behind.
 *   updateSetting             wrote `updatedBy` onto the row, which answers
 *                             "who touched this last" and cannot answer "who
 *                             closed registration, and for how long", because
 *                             each change overwrites the one before it.
 *
 * The old value is asserted as well as the new one. "Set to low" does not say
 * what it was moved down from, and a trail that cannot answer that is not much
 * use to whoever is reading it six weeks later.
 */
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};

async function call(path, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  return { status: res.status, body: await res.json() };
}

/*
 * TEARDOWN ORDERED BY THE FOREIGN KEYS, not by convenience.
 *
 * adminSettings.updatedBy is `notNull` and `onDelete: restrict`, so the moment
 * the probe administrator changes a setting the account cannot be deleted and
 * cannot be nulled out either. The setting row it wrote goes first. Worth
 * saying plainly because it is a property of the product, not of the probe:
 * an administrator who has ever changed a platform setting cannot be removed,
 * which is the thing commercialAuditEvents explicitly refused to do - "RESTRICT
 * here would make a user undeletable by virtue of having done work".
 */
function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zaud%') as probe)`;
  for (const statement of [
    `delete from adminSettings where updatedBy in ${ids}`,
    `delete from userAccountAuditEvents where actorId in ${ids} or userId in ${ids}`,
    `delete from users where username like 'zaud%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

let step = 1;
try {
  cleanUp();
  const u = `zaud${stamp}`;
  sql(`insert into users (openId, username, email, name, role, adminRole, userRole,
        loginMethod, accountSource, isDummy, accountStatus, onboardingStatus, verified,
        passwordHash, passwordSetAt)
       values ('probe-${u}', '${u}', '${u}@example.test', 'Probe Audit', 'admin',
        'SUPER_ADMIN', 'admin', 'password', 'admin_created', 0, 'active', 'approved', 1,
        '${HASH}', now())`);
  const adminId = Number(sql(`select id from users where username='${u}'`));
  check(adminId > 0, `${step}. SETUP: a real administrator exists`, `id ${adminId}`);
  step++;

  const signIn = await fetch(`${BASE}/api/trpc/auth.adminSignIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: `${u}@example.test`, password: PASSWORD } }),
  });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  check(signIn.status === 200 && cookie.length > 0, `${step}. the administrator is signed in`);
  step++;

  // ── A PLATFORM SETTING ──────────────────────────────────────────────────
  /*
   * SEEDED TO A KNOWN VALUE FIRST, so the change measured below has an old
   * value this probe can state exactly.
   *
   * The first version read the stored value, found no row, and expected the
   * trail to say "(unset) -> true". It said "false -> true", and the server
   * was right: with no row stored the EFFECTIVE current value is the default,
   * and recording the default is what lets somebody reconstruct the switch.
   * The expectation was wrong, not the product - so the probe now creates the
   * starting state instead of guessing it.
   */
  await call('admin.updateSetting', { key: 'maintenanceMode', value: 'false' }, cookie);
  sql(`delete from userAccountAuditEvents where action='platform_setting_changed' and actorId=${adminId}`);
  const before = 'false';
  const target = 'true';
  const set = await call('admin.updateSetting', { key: 'maintenanceMode', value: target }, cookie);
  check(set.status === 200, `${step}. SETTING: maintenance mode is changed`, `${before} -> ${target}`);
  step++;

  const settingRow = sql(`select concat_ws('|', action, ifnull(userId,'NULL'), actorId, note)
                          from userAccountAuditEvents
                          where action='platform_setting_changed' and actorId=${adminId}
                          order by id desc limit 1`);
  check(settingRow.startsWith('platform_setting_changed|NULL|' + adminId),
    `${step}. and the trail names the administrator, with no account as its subject`,
    settingRow || 'no row');
  step++;

  check(settingRow.includes(`maintenanceMode: ${before} -> ${target}`),
    `${step}. and records what it was as well as what it became`,
    settingRow.split('|').slice(3).join('|') || 'no note');
  step++;

  /*
   * CHANGED BACK, and the second row proves the trail is a HISTORY rather than
   * a current-state column. `updatedBy` could never have shown both.
   */
  await call('admin.updateSetting', { key: 'maintenanceMode', value: before }, cookie);
  const settingCount = Number(sql(`select count(*) from userAccountAuditEvents
                                   where action='platform_setting_changed' and actorId=${adminId}`));
  check(settingCount === 2, `${step}. and both changes survive, not just the last one`, `${settingCount} rows`);
  step++;

  // ── A SUPPORT TICKET'S PRIORITY ─────────────────────────────────────────
  const ticket = sql(`select concat_ws('|', id, requesterId, priority, ifnull(reference,''))
                      from supportTickets order by id limit 1`);
  if (!ticket) {
    check(false, `${step}. TICKET: a support ticket exists to reprioritise`, 'none in the database');
  } else {
    const [ticketId, requesterId, priorRaw] = ticket.split('|');
    const next = priorRaw === 'high' ? 'low' : 'high';
    const moved = await call('admin.setSupportTicketPriority',
      { ticketId: Number(ticketId), priority: next }, cookie);
    check(moved.status === 200, `${step}. TICKET: the priority is changed`, `${priorRaw} -> ${next}`);
    step++;

    const stored = sql(`select priority from supportTickets where id=${ticketId}`);
    check(stored === next, `${step}. and the ticket actually moved`, `stored ${stored}`);
    step++;

    const row = sql(`select concat_ws('|', action, userId, actorId, note)
                     from userAccountAuditEvents
                     where action='support_ticket_priority_changed' and actorId=${adminId}
                     order by id desc limit 1`);
    check(row.startsWith(`support_ticket_priority_changed|${requesterId}|${adminId}`),
      `${step}. and the trail names the actor AND the requester it is about`, row || 'no row');
    step++;

    check(row.includes(`${priorRaw} -> ${next}`),
      `${step}. and records the priority it was moved from`, row.split('|').slice(3).join('|') || 'no note');
    step++;

    // Put it back, and prove a no-op writes nothing - a trail full of
    // "changed from medium to medium" is a trail nobody reads.
    await call('admin.setSupportTicketPriority', { ticketId: Number(ticketId), priority: priorRaw }, cookie);
    const beforeNoop = Number(sql(`select count(*) from userAccountAuditEvents
                                   where action='support_ticket_priority_changed' and actorId=${adminId}`));
    await call('admin.setSupportTicketPriority', { ticketId: Number(ticketId), priority: priorRaw }, cookie);
    const afterNoop = Number(sql(`select count(*) from userAccountAuditEvents
                                  where action='support_ticket_priority_changed' and actorId=${adminId}`));
    check(afterNoop === beforeNoop, `${step}. and setting the same priority again records nothing`,
      `${beforeNoop} then ${afterNoop}`);
    step++;
  }

  // ── THE NEGATIVE CONTROL ────────────────────────────────────────────────
  const anon = await call('admin.updateSetting', { key: 'maintenanceMode', value: 'true' }, null);
  check(anon.status === 401, `${step}. NEGATIVE: with no session the setting is refused`, `HTTP ${anon.status}`);
  step++;

  const anonStored = sql(`select value from adminSettings where settingKey='maintenanceMode'`) || '(unset)';
  check(anonStored !== 'true' || before === 'true',
    `${step}. and the refused call changed nothing`, `value ${anonStored}`);
  step++;
} finally {
  /*
   * ORDERED BY THE FOREIGN KEYS, not by convenience. The probe administrator
   * is referenced by adminSettings.updatedBy the moment it changes a setting,
   * so deleting the account first fails with a constraint error - which, on
   * the first run, took the whole probe down in its own teardown after every
   * check had already been made. The reference is cleared, then the trail,
   * then the account.
   */
  cleanUp();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

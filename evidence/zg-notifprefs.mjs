// ── LIVE: notification preferences ────────────────────────────────────────
//
// NOTIF. The unit suite pins the gate against doubles and the census pins every
// message key to a category. Six things it structurally cannot prove, and they
// are the six this probe exists for:
//
//   THE SWITCH ACTUALLY STOPS THE ROW. `deliveryDecision` returning false is a
//     claim about a function. That no `notifications` row appears in MySQL
//     after a real user sends a real message to a muted recipient is a claim
//     about the whole path, and it is the only claim that matters.
//
//   AND ONLY THE MUTED ONE. A second recipient, identical in every way except
//     that they muted nothing, must still receive it. A gate that silences the
//     category platform-wide would pass every "it was suppressed" assertion.
//
//   MANDATORY SURVIVES A ROW IN THE TABLE. The suppression is written STRAIGHT
//     INTO THE DATABASE here, bypassing the procedure that refuses it - which
//     is the only way to test the second of the two checks. A compliance
//     decision must still arrive.
//
//   THE REFUSAL IS THE SERVER'S. Switching off a mandatory category over HTTP,
//     with no screen involved, must come back FORBIDDEN and write nothing.
//
//   RE-ENABLING UPDATES, NEVER DUPLICATES. The unique index says it must; this
//     proves the code path never attempts it.
//
//   AND NOBODY ELSE'S PREFERENCES ARE REACHABLE. `setPreference` takes no
//     userId, so a caller who sends one changes their own row and not the
//     one they named.
//
// Everything is driven over HTTP by real accounts through the product's own
// paths. The two exceptions are stated where they occur rather than dressed up:
// compliance status is set in SQL because approving an applicant is setup for
// this probe, not its subject, and the mandatory suppression row is written in
// SQL precisely because no product path will write it.
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
const made = [];

class Session {
  constructor(label) { this.label = label; this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  async post(path, input, meta) {
    const body = meta ? { json: input, meta: { values: meta } } : { json: input };
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify(body),
    });
    this.absorb(res);
    return unwrap(res);
  }
  async get(path, input) {
    const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: this.header() } });
    this.absorb(res);
    return unwrap(res);
  }
}

async function unwrap(res) {
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return {
    status: res.status,
    data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null,
    code: parsed?.error?.json?.data?.code ?? null,
  };
}

async function account(prefix, userRole) {
  const s = new Session(prefix);
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'NotifPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp failed for ${prefix}: http=${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session for ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id, name: u };
}

const call = (a, path, input, meta) => a.s.post(path, input, meta);
const query = (a, path, input) => a.s.get(path, input);

/** Notifications for one user carrying one key, counted in MySQL. */
const notifCount = (userId, key) =>
  Number(sql(`select count(*) from notifications where userId=${userId} and messageKey='${key}'`) || 0);
const prefRows = userId =>
  sql(`select category, enabled from notificationPreferences where userId=${userId} order by category`)
    .split('\n').filter(Boolean).map(line => line.split('\t'));

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const sender  = await account('npsn', 'homeowner');   // writes the messages
  const muted   = await account('npmu', 'contractor');  // switches messages off
  const control = await account('npct', 'contractor');  // identical, switches nothing
  const admin   = await account('npad', 'homeowner');

  check('1. SETUP: three real accounts exist, created through auth.signUp',
    sender.id > 0 && muted.id > 0 && control.id > 0,
    `sender=${sender.id} muted=${muted.id} control=${control.id}`);

  check('2. SETUP: none of them has a stored preference - absence is the default',
    prefRows(muted.id).length === 0 && prefRows(control.id).length === 0);

  // ── The list a user is shown ────────────────────────────────────────────
  const initial = await query(muted, 'notifications.preferences');
  const rows = initial.data ?? [];
  check('3. every category is listed, not only the stored exceptions',
    initial.status === 200 && rows.length === 14, `http=${initial.status} n=${rows.length}`);
  check('4. and every one of them is ON for an account that has chosen nothing',
    rows.length > 0 && rows.every(row => row.enabled === true));

  const mandatory = rows.filter(row => row.mandatory).map(row => row.category).sort();
  check('5. the five mandatory categories are flagged as such',
    JSON.stringify(mandatory) === JSON.stringify(['account', 'billing', 'compliance', 'disputes', 'moderation']),
    mandatory.join(','));

  // ── The baseline: the notification arrives at all ───────────────────────
  const first = await call(sender, 'messages.send', { receiverId: muted.id, content: `probe one ${stamp}` });
  const firstControl = await call(sender, 'messages.send', { receiverId: control.id, content: `probe one ${stamp}` });
  check('6. BASELINE: a real message notifies the recipient',
    first.status === 200 && notifCount(muted.id, 'notif.message.received') === 1,
    `http=${first.status} n=${notifCount(muted.id, 'notif.message.received')}`);
  check('7. BASELINE: and the control account too',
    firstControl.status === 200 && notifCount(control.id, 'notif.message.received') === 1);

  // ── Switching it off ────────────────────────────────────────────────────
  const off = await call(muted, 'notifications.setPreference', { category: 'messages', enabled: false });
  check('8. the recipient switches Messages off', off.status === 200 && off.data?.enabled === false,
    `http=${off.status} err=${String(off.error).slice(0, 60)}`);

  const stored = prefRows(muted.id);
  check('9. exactly one row is stored, for that category, switched off',
    stored.length === 1 && stored[0][0] === 'messages' && stored[0][1] === '0',
    JSON.stringify(stored));

  const second = await call(sender, 'messages.send', { receiverId: muted.id, content: `probe two ${stamp}` });
  const secondControl = await call(sender, 'messages.send', { receiverId: control.id, content: `probe two ${stamp}` });
  check('10. THE SWITCH STOPS THE ROW: no second notification is written',
    second.status === 200 && notifCount(muted.id, 'notif.message.received') === 1,
    `send=${second.status} n=${notifCount(muted.id, 'notif.message.received')}`);
  check('11. the message itself still arrived - the preference mutes the notice, not the product',
    Number(sql(`select count(*) from messages where receiverId=${muted.id} and senderId=${sender.id}`)) === 2,
    sql(`select count(*) from messages where receiverId=${muted.id} and senderId=${sender.id}`));
  check('12. AND ONLY THE MUTED ONE: the control account still receives it',
    secondControl.status === 200 && notifCount(control.id, 'notif.message.received') === 2,
    `n=${notifCount(control.id, 'notif.message.received')}`);

  const afterOff = await query(muted, 'notifications.preferences');
  check('13. the screen reports Messages as off, and everything else as on',
    (afterOff.data ?? []).find(row => row.category === 'messages')?.enabled === false &&
    (afterOff.data ?? []).filter(row => row.category !== 'messages').every(row => row.enabled === true));

  // ── Switching it back on ────────────────────────────────────────────────
  const on = await call(muted, 'notifications.setPreference', { category: 'messages', enabled: true });
  const reStored = prefRows(muted.id);
  check('14. re-enabling UPDATES the row rather than adding a second',
    on.status === 200 && reStored.length === 1 && reStored[0][1] === '1', JSON.stringify(reStored));

  const third = await call(sender, 'messages.send', { receiverId: muted.id, content: `probe three ${stamp}` });
  check('15. and the notification comes back',
    third.status === 200 && notifCount(muted.id, 'notif.message.received') === 2,
    `n=${notifCount(muted.id, 'notif.message.received')}`);

  // ── Mandatory, over HTTP ────────────────────────────────────────────────
  let refusals = 0, wrongCode = [];
  for (const category of ['account', 'billing', 'compliance', 'disputes', 'moderation']) {
    const attempt = await call(muted, 'notifications.setPreference', { category, enabled: false });
    if (attempt.status !== 200) refusals++;
    if (attempt.code !== 'FORBIDDEN') wrongCode.push(`${category}:${attempt.code}`);
  }
  check('16. EVERY mandatory category is refused over HTTP, with no screen involved', refusals === 5, `${refusals}/5`);
  check('17. and the refusal is FORBIDDEN, not a 500', wrongCode.length === 0, wrongCode.join(','));
  check('18. nothing was written for any of them',
    prefRows(muted.id).length === 1 && prefRows(muted.id)[0][0] === 'messages',
    JSON.stringify(prefRows(muted.id)));

  const bogus = await call(muted, 'notifications.setPreference', { category: 'everything', enabled: false });
  check('19. a category outside the vocabulary is a BAD_REQUEST, not a silent no-op',
    bogus.status !== 200 && bogus.code === 'BAD_REQUEST', `http=${bogus.status} code=${bogus.code}`);

  // ── The second check: a suppression row that arrived by another route ───
  //
  // Written straight into the table, bypassing the procedure that refuses it.
  // This is the ONLY way to exercise the delivery-side mandatory check, and it
  // is the scenario that matters: a row reaching the database by any means at
  // all must not stop a registration decision.
  sql(`insert into notificationPreferences (userId, category, enabled) values (${muted.id}, 'compliance', 0)`);
  check('20. SETUP: a forbidden suppression row now exists in the table',
    prefRows(muted.id).some(row => row[0] === 'compliance' && row[1] === '0'));

  // MARKETPLACE_ADMIN, because `admin.updateApplicantStatus` is gated on
  // `marketplace.manage` and a USER_ADMIN does not hold it - the first run of
  // this probe named a procedure that does not exist and then a role that
  // could not call it, and both were the probe being wrong rather than the
  // product.
  sql(`update users set role='admin', adminRole='MARKETPLACE_ADMIN' where id=${admin.id}`);
  sql(`update users set onboardingStatus='under_review' where id=${muted.id}`);
  const decision = await call(admin, 'admin.updateApplicantStatus', { userId: muted.id, status: 'approved' });
  check('21. MANDATORY SURVIVES IT: the compliance decision is delivered anyway',
    decision.status === 200 && notifCount(muted.id, 'notif.compliance.applicant.approved') === 1,
    `http=${decision.status} err=${String(decision.error).slice(0, 60)} n=${notifCount(muted.id, 'notif.compliance.applicant.approved')}`);

  const withBadRow = await query(muted, 'notifications.preferences');
  check('22. and the screen reports compliance as ON, matching what BuildHub actually does',
    (withBadRow.data ?? []).find(row => row.category === 'compliance')?.enabled === true);

  // ── Nobody else's preferences ───────────────────────────────────────────
  const tamper = await call(control, 'notifications.setPreference',
    { userId: muted.id, category: 'product_qa', enabled: false });
  check('23. a userId sent by the caller is ignored: the CALLER’s row changes',
    tamper.status === 200 &&
    prefRows(control.id).some(row => row[0] === 'product_qa' && row[1] === '0'),
    JSON.stringify(prefRows(control.id)));
  check('24. and the named account is untouched',
    !prefRows(muted.id).some(row => row[0] === 'product_qa'),
    JSON.stringify(prefRows(muted.id)));

  const anonymous = new Session('anon');
  const anonRead = await anonymous.get('notifications.preferences');
  const anonWrite = await anonymous.post('notifications.setPreference', { category: 'messages', enabled: false });
  check('25. a signed-out caller cannot read preferences', anonRead.status !== 200 && anonRead.code === 'UNAUTHORIZED',
    `http=${anonRead.status} code=${anonRead.code}`);
  check('26. nor write them', anonWrite.status !== 200 && anonWrite.code === 'UNAUTHORIZED',
    `http=${anonWrite.status} code=${anonWrite.code}`);

  // ── The table's own guarantee ───────────────────────────────────────────
  let duplicate = 'accepted';
  try {
    sql(`insert into notificationPreferences (userId, category, enabled) values (${control.id}, 'product_qa', 1)`);
  } catch { duplicate = 'refused'; }
  check('27. the database itself refuses a second row for the same user and category',
    duplicate === 'refused', duplicate);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  // ── Cleanup, and proof of it ────────────────────────────────────────────
  for (const id of made) {
    try { sql(`delete from notificationPreferences where userId=${id}`); } catch {}
    try { sql(`delete from notifications where userId=${id}`); } catch {}
    try { sql(`delete from messages where senderId=${id} or receiverId=${id}`); } catch {}
    try { sql(`delete from userAccountAuditEvents where userId=${id} or actorId=${id}`); } catch {}
    // The compliance decision in check 21 writes one of these, and its foreign
    // key blocks the delete below. A probe that leaves rows behind is a probe
    // whose next run starts from a different database than this one did.
    try { sql(`delete from registrationReviewEvents where userId=${id} or actorId=${id}`); } catch {}
    try { sql(`delete from commercialAuditEvents where actorId=${id}`); } catch {}
    try { sql(`delete from users where id=${id}`); } catch {}
  }
  const leftover = made.length === 0 ? 0 : Number(sql(
    `select count(*) from users where id in (${made.join(',')})`) || 0);
  const leftoverPrefs = made.length === 0 ? 0 : Number(sql(
    `select count(*) from notificationPreferences where userId in (${made.join(',')})`) || 0);
  check('28. CLEANUP: every account and preference row this probe created is gone',
    leftover === 0 && leftoverPrefs === 0, `users=${leftover} prefs=${leftoverPrefs}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

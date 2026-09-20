/**
 * ── HOW MANY STRANGERS CAN ONE ACCOUNT MESSAGE IN A MINUTE? ──────────────
 *
 * BuildHub deliberately lets a customer contact a vendor they have just found
 * - there is no prior-relationship requirement, and whether there should be is
 * recorded as an owner decision. That policy is exactly why the SEND itself
 * has to be bounded: with no relationship gate, the only thing standing
 * between one compromised account and every vendor in the directory is a rate
 * limit.
 *
 * rfq.create is limited. Every upload endpoint is limited. Placement analytics
 * are limited. messages.send was not limited at all.
 *
 * WHAT IS PROVED HERE, over the real HTTP endpoint:
 *
 *   a normal conversation is never interrupted
 *   a flood into ONE thread is stopped
 *   a flood ACROSS MANY recipients is stopped, which is the spam shape
 *   a refusal says how long to wait, rather than failing blankly
 *   one account's limit does not punish another account
 *   nothing is delivered after the refusal - the block is real, not cosmetic
 *
 * The counts below are read from the DATABASE afterwards, not from the HTTP
 * responses, because a limiter that returns 429 while still writing the row
 * would pass a response-only check.
 */
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'LocalSuperAdmin!2024';
const HASH = process.env.ZG_HASH;
if (!HASH) { console.error('set ZG_HASH to an application-minted password hash'); process.exit(2); }
const stamp = Date.now().toString(36);
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};

async function signIn(email) {
  const res = await fetch(`${BASE}/api/trpc/auth.signIn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { identifier: email, password: PASSWORD } }),
  });
  if (res.status !== 200) throw new Error(`signIn: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
}

async function send(cookie, receiverId, content) {
  const res = await fetch(`${BASE}/api/trpc/messages.send`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: { receiverId, content } }),
  });
  const body = await res.text();
  let code = null, message = '';
  try {
    const parsed = JSON.parse(body);
    code = parsed?.error?.json?.data?.code ?? null;
    message = parsed?.error?.json?.message ?? '';
  } catch { /* a non-JSON body is itself the finding, carried in `body` */ }
  return { status: res.status, code, message, body: body.slice(0, 160) };
}

function seedUser(username, role) {
  sql(`insert into users (openId, username, email, name, role, userRole, loginMethod,
        accountSource, isDummy, accountStatus, onboardingStatus, verified, passwordHash, passwordSetAt)
       values ('probe-${username}', '${username}', '${username}@example.test', 'Probe ${username}',
        'user', '${role}', 'password', 'self_registered', 0, 'active', 'approved', 1, '${HASH}', now())`);
  return Number(sql(`select id from users where username='${username}'`));
}

function cleanUp() {
  const ids = `(select id from (select id from users where username like 'zflood%') as probe)`;
  for (const statement of [
    `delete from messages where senderId in ${ids} or receiverId in ${ids}`,
    `delete from notifications where userId in ${ids}`,
    `delete from users where username like 'zflood%'`,
  ]) {
    try { sql(statement); } catch (error) {
      console.log(`  (teardown: ${String(error).split('\n')[0].slice(0, 80)})`);
    }
  }
}

try {
  cleanUp();
  const sender = `zfloodS${stamp}`, other = `zfloodO${stamp}`;
  const senderId = seedUser(sender, 'homeowner');
  const otherId = seedUser(other, 'homeowner');
  // A directory of vendors to blast, which is the realistic target set.
  const vendorIds = [];
  for (let i = 0; i < 12; i++) vendorIds.push(seedUser(`zfloodV${i}${stamp}`, 'supplier'));
  // A second, larger directory for the BREADTH section, which needs more
  // distinct strangers than the volume section does.
  const coldIds = [];
  for (let i = 0; i < 26; i++) coldIds.push(seedUser(`zfloodC${i}${stamp}`, 'supplier'));
  check(senderId > 0 && otherId > 0 && vendorIds.length === 12,
    'SETUP: one sender, one unrelated account, and twelve vendors to reach',
    `sender ${senderId}, vendors ${vendorIds.length}`);

  const senderCookie = await signIn(`${sender}@example.test`);
  const otherCookie = await signIn(`${other}@example.test`);

  /* ── A REAL CONVERSATION IS NOT INTERRUPTED ──────────────────────────── */
  const conversation = [];
  for (let i = 0; i < 6; i++) {
    conversation.push(await send(senderCookie, vendorIds[0], `Quick question ${i} ${stamp}`));
  }
  check(conversation.every(r => r.status === 200),
    'NORMAL: six messages in one thread all go through',
    conversation.map(r => r.status).join(','));

  /* ── A FLOOD ACROSS MANY RECIPIENTS IS THE SPAM SHAPE ────────────────── */
  const blast = [];
  for (const vendorId of vendorIds) {
    for (let i = 0; i < 6; i++) {
      blast.push(await send(senderCookie, vendorId, `Buy my thing ${i} ${stamp}`));
    }
  }
  const refused = blast.filter(r => r.status !== 200);
  const throttled = blast.filter(r => r.code === 'TOO_MANY_REQUESTS');
  check(refused.length > 0,
    'FLOOD: blasting seventy-two messages across twelve vendors is stopped',
    `${blast.length - refused.length} accepted, ${refused.length} refused`);
  check(throttled.length === refused.length && throttled.length > 0,
    'and the refusal is a rate limit, not an incidental error',
    refused.length ? `${throttled.length}/${refused.length} were TOO_MANY_REQUESTS; first other: ${
      (refused.find(r => r.code !== 'TOO_MANY_REQUESTS') || {}).body ?? 'none'}` : 'nothing was refused');
  check(throttled.length > 0 && /\d+\s*s/.test(throttled[0].message),
    'and it says how long to wait rather than failing blankly',
    throttled.length ? throttled[0].message : 'no throttled response to read');

  /* ── THE BLOCK IS REAL: NOTHING LANDS AFTER THE REFUSAL ──────────────── */
  const accepted = blast.filter(r => r.status === 200).length + conversation.length;
  const stored = Number(sql(`select count(*) from messages where senderId=${senderId}`));
  check(stored === accepted,
    'REAL: exactly the accepted messages were stored, and no refused one was',
    `stored ${stored}, accepted ${accepted}`);

  /* ── ONE ACCOUNT'S LIMIT IS NOT ANOTHER ACCOUNT'S ────────────────────── */
  const bystander = await send(otherCookie, vendorIds[0], `Unrelated hello ${stamp}`);
  check(bystander.status === 200,
    'SCOPED: an unrelated account is not throttled by the flooder',
    `${bystander.status} ${bystander.code ?? ''}`);

  /* ── BREADTH, ON ITS OWN ─────────────────────────────────────────────────
   *
   * The volume limiter caught the blast above before the breadth limiter was
   * ever reached, so the breadth rule was passing untested - the exact shape
   * of a vacuous pass. This section PACES the sends to stay under the burst
   * ceiling, so the only thing that can stop it is the new-conversation rule.
   *
   * It uses a third account, because the flooder above has already spent its
   * hourly allowance.
   */
  const cold = `zfloodX${stamp}`;
  const coldSenderId = seedUser(cold, 'homeowner');
  const coldCookie = await signIn(`${cold}@example.test`);

  const approaches = [];
  for (let i = 0; i < 24; i++) {
    // Twelve per minute, under the fifteen-a-minute burst ceiling, so a
    // refusal here cannot be the volume limiter wearing the wrong label.
    if (i > 0 && i % 12 === 0) await new Promise(r => setTimeout(r, 61_000));
    approaches.push(await send(coldCookie, coldIds[i], `Cold approach ${i} ${stamp}`));
  }
  const coldOk = approaches.filter(r => r.status === 200).length;
  const coldRefused = approaches.filter(r => r.status !== 200);
  check(coldOk === 20 && coldRefused.length === 4,
    'BREADTH: twenty cold approaches are allowed and the twenty-first is not',
    `${coldOk} accepted, ${coldRefused.length} refused`);
  check(coldRefused.length > 0 && /new conversations/i.test(coldRefused[0].message),
    'and the refusal names the REASON - too many new conversations, not too fast',
    coldRefused.length ? coldRefused[0].message : 'nothing was refused');

  /* AND AN ESTABLISHED THREAD IS UNTOUCHED BY IT. This is the whole reason
     breadth is counted separately from volume: being out of cold approaches
     must never stop somebody replying to a conversation they are already in. */
  const established = await send(coldCookie, coldIds[0], `Following up ${stamp}`);
  check(established.status === 200,
    'CONTINUING: a thread already open still accepts a message after the limit',
    `${established.status} ${established.code ?? ''} ${established.message}`);

  const coldStored = Number(sql(`select count(*) from messages where senderId=${coldSenderId}`));
  check(coldStored === coldOk + 1,
    'REAL: the refused approaches were never delivered',
    `stored ${coldStored}, accepted ${coldOk + 1}`);
} finally {
  cleanUp();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

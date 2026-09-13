// ── LIVE: messaging read state and bounded reads ──────────────────────────
//
// MSG. The unit suite pins the predicates against doubles. Six things it
// structurally cannot prove, and they are the six this probe exists for:
//
//   THE BADGE GOES DOWN. `messages.read` had no writer at all, so a
//     conversation's unread count could only ever grow: a supplier who read
//     and answered every message still carried it. Proven by reading the count
//     back from the real sidebar query before and after.
//
//   AND ONLY THE THREAD YOU OPENED. Reading one correspondent must not clear
//     another's badge.
//
//   A READ RECEIPT CANNOT BE FORGED. Calling markThreadRead as the SENDER must
//     not mark the messages you sent as read on the recipient's behalf - their
//     badge must be untouched, which only a second account can show.
//
//   THE THREAD PAGES. More messages than a page, paged by id, with the older
//     page reachable and no line repeated or skipped.
//
//   THE SIDEBAR IS BOUNDED AND ORDERED by the most recent message.
//
//   AND THE INBOX DUMP IS GONE: `list` without a thread is refused by the
//     schema rather than returning everything.
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
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.header() },
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
    username: u, email: `${u}@example.test`, password: 'MsgPass!2026',
    name: `Probe ${prefix}`, userRole: 'homeowner',
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const unreadFor = (conversations, peerId) =>
  (conversations ?? []).find(row => row.id === peerId)?.unread ?? null;

try {
  const alice = await account('mgal');
  const bob   = await account('mgbo');
  const carol = await account('mgca');
  check('1. SETUP: three real accounts', alice.id > 0 && bob.id > 0 && carol.id > 0);

  // ── Bob and Carol each write to Alice ───────────────────────────────────
  for (let i = 1; i <= 3; i++) {
    await bob.s.post('messages.send', { receiverId: alice.id, content: `bob ${i} ${stamp}` });
  }
  await carol.s.post('messages.send', { receiverId: alice.id, content: `carol 1 ${stamp}` });

  const before = await alice.s.get('messages.conversations');
  check('2. the sidebar answers, with both correspondents',
    before.status === 200 && (before.data ?? []).length === 2,
    `http=${before.status} n=${(before.data ?? []).length}`);
  check('3. THE UNREAD COUNT IS REAL: three from Bob, one from Carol',
    unreadFor(before.data, bob.id) === 3 && unreadFor(before.data, carol.id) === 1,
    `bob=${unreadFor(before.data, bob.id)} carol=${unreadFor(before.data, carol.id)}`);
  check('4. ordered by the most recent message - Carol wrote last',
    (before.data ?? [])[0]?.id === carol.id, `first=${(before.data ?? [])[0]?.id}`);
  check('5. and carries a DATE, not a server-formatted string',
    typeof (before.data ?? [])[0]?.lastMessageAt === 'string'
      && !Number.isNaN(Date.parse((before.data ?? [])[0].lastMessageAt)),
    String((before.data ?? [])[0]?.lastMessageAt).slice(0, 30));

  const unreadBadge = await alice.s.get('messages.unreadCount');
  check('6. the whole-inbox badge agrees: four unread',
    unreadBadge.data?.count === 4, `count=${unreadBadge.data?.count}`);

  // ── Alice reads Bob's thread ────────────────────────────────────────────
  const marked = await alice.s.post('messages.markThreadRead', { otherUserId: bob.id });
  check('7. THE BADGE GOES DOWN: marking Bob’s thread read moves three rows',
    marked.status === 200 && marked.data?.marked === 3,
    `http=${marked.status} marked=${marked.data?.marked}`);

  const after = await alice.s.get('messages.conversations');
  check('8. Bob’s badge is cleared',
    unreadFor(after.data, bob.id) === 0, `bob=${unreadFor(after.data, bob.id)}`);
  check('9. AND ONLY THE THREAD SHE OPENED: Carol’s is untouched',
    unreadFor(after.data, carol.id) === 1, `carol=${unreadFor(after.data, carol.id)}`);
  check('10. the inbox badge follows',
    (await alice.s.get('messages.unreadCount')).data?.count === 1);

  const again = await alice.s.post('messages.markThreadRead', { otherUserId: bob.id });
  check('11. marking an already-read thread moves nothing, and says so',
    again.status === 200 && again.data?.marked === 0, `marked=${again.data?.marked}`);

  // ── A read receipt cannot be forged ─────────────────────────────────────
  await alice.s.post('messages.send', { receiverId: carol.id, content: `alice to carol ${stamp}` });
  const carolBefore = unreadFor((await carol.s.get('messages.conversations')).data, alice.id);
  const forge = await alice.s.post('messages.markThreadRead', { otherUserId: carol.id });
  const carolAfter = unreadFor((await carol.s.get('messages.conversations')).data, alice.id);
  check('12. A READ RECEIPT CANNOT BE FORGED: Alice marking her own thread read',
    forge.status === 200 && carolBefore === 1 && carolAfter === 1,
    `carol before=${carolBefore} after=${carolAfter}`);
  check('13. and it cleared only what CAROL had sent HER',
    forge.data?.marked === 1, `marked=${forge.data?.marked}`);

  // ── The thread pages ────────────────────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    await bob.s.post('messages.send', { receiverId: alice.id, content: `page ${i} ${stamp}` });
  }
  const page1 = await alice.s.get('messages.list', { otherUserId: bob.id, limit: 5 });
  check('14. a thread returns ONE PAGE, oldest-first within it',
    page1.status === 200 && (page1.data?.messages ?? []).length === 5
      && page1.data.messages[0].id < page1.data.messages[4].id,
    `n=${(page1.data?.messages ?? []).length}`);
  check('15. and says there is more, with a cursor',
    page1.data?.hasMore === true && typeof page1.data?.nextBefore === 'number',
    `hasMore=${page1.data?.hasMore} before=${page1.data?.nextBefore}`);

  const page2 = await alice.s.get('messages.list', { otherUserId: bob.id, limit: 5, before: page1.data.nextBefore });
  const ids1 = (page1.data.messages ?? []).map(m => m.id);
  const ids2 = (page2.data?.messages ?? []).map(m => m.id);
  check('16. THE OLDER PAGE IS DIFFERENT, and older',
    ids2.length === 5 && Math.max(...ids2) < Math.min(...ids1),
    `page1=${Math.min(...ids1)}..${Math.max(...ids1)} page2=${Math.min(...ids2)}..${Math.max(...ids2)}`);
  check('17. with NO line repeated between the two pages',
    ids2.every(id => !ids1.includes(id)));

  const walked = new Set();
  let cursor = undefined, guard = 0;
  while (guard++ < 20) {
    const page = await alice.s.get('messages.list', { otherUserId: bob.id, limit: 5, before: cursor });
    for (const row of page.data?.messages ?? []) walked.add(row.id);
    if (!page.data?.hasMore) break;
    cursor = page.data.nextBefore;
  }
  const total = Number(sql(`select count(*) from messages where (senderId=${alice.id} and receiverId=${bob.id}) or (senderId=${bob.id} and receiverId=${alice.id})`));
  check('18. WALKING EVERY PAGE VISITS EVERY MESSAGE EXACTLY ONCE',
    walked.size === total && total === 15, `walked=${walked.size} total=${total}`);

  // ── The negative controls ───────────────────────────────────────────────
  const dump = await alice.s.get('messages.list', {});
  check('19. THE WHOLE-INBOX DUMP IS GONE: a thread is required',
    dump.status !== 200 && dump.code === 'BAD_REQUEST', `http=${dump.status} code=${dump.code}`);

  const huge = await alice.s.get('messages.list', { otherUserId: bob.id, limit: 100000 });
  check('20. and an unbounded page is refused by the schema',
    huge.status !== 200 && huge.code === 'BAD_REQUEST', `code=${huge.code}`);

  const anon = new Session();
  const anonRead = await anon.post('messages.markThreadRead', { otherUserId: alice.id });
  check('21. a signed-out caller cannot mark anything read',
    anonRead.status !== 200 && anonRead.code === 'UNAUTHORIZED', `code=${anonRead.code}`);
  const anonList = await anon.get('messages.conversations');
  check('22. nor read a sidebar', anonList.status !== 200 && anonList.code === 'UNAUTHORIZED');

  const spy = await carol.s.get('messages.list', { otherUserId: bob.id });
  check('23. CAROL SEES NOTHING OF ALICE AND BOB’S THREAD',
    spy.status === 200 && (spy.data?.messages ?? []).length === 0,
    `n=${(spy.data?.messages ?? []).length}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from messages where senderId=${id} or receiverId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('24. CLEANUP: every account and message this probe created is gone', left === 0, `users=${left}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

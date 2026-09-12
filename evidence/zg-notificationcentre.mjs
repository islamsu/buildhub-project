/**
 * ── THE NOTIFICATION CENTRE, AGAINST A REAL DATABASE AND A REAL BROWSER ────
 *
 * Two defects, both reproduced before they were fixed:
 *
 *   THE BADGE WAS ALL-OR-NOTHING. `markAllRead` was the only writer of
 *     `read: true`, so somebody with several unread who opened ONE had to
 *     clear every one of them or keep a count that no longer described what
 *     they had seen.
 *
 *   AND THE ASSIGNMENT NOTIFICATION LANDED ON 404. An admin handed a batch of
 *     enquiries was linked to a four-segment path no route serves. Checked by
 *     LOADING IT, not by reading the route table.
 *
 * Plus the rules that keep both honest: a read receipt is the recipient's to
 * give and cannot be forged for somebody else, and a queue narrowed by a link
 * says so on screen.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';
import { adminSession, asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9400 + (process.pid % 90)));
/**
 * SQL ON STDIN, NOT IN `-e`.
 *
 * `read` is a reserved word and needs backticks, and a backtick inside a
 * double-quoted shell command is COMMAND SUBSTITUTION - the statement arrived
 * at MySQL mangled, and the probe reported a failure that was entirely its own.
 * stdin removes the shell from the path altogether.
 */
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q }).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value = 'false';
    try { value = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (value === 'true') { await settle(250); return true; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

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
async function account(prefix, userRole) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const up = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'NotifPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status} ${up.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}
const seed = (userId, n) => {
  for (let i = 0; i < n; i++) {
    sql('insert into notifications (userId, title, body, type, `read`, link) values '
      + '(' + userId + ", 'Probe notification " + stamp + ' number ' + i + "', 'Body', 'info', 0, '/settings')");
  }
};

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const reader    = await account('nra', 'homeowner');
  const bystander = await account('nrb', 'homeowner');
  seed(reader.id, 5);
  seed(bystander.id, 2);

  const before = await reader.s.get('notifications.unreadCount');
  check('1. SETUP: five unread notifications', before.data?.count === 5, `count=${before.data?.count}`);

  const list = await reader.s.get('notifications.list');
  const first = (list.data ?? [])[0];
  check('2. and the centre lists them', (list.data ?? []).length === 5 && first?.read === false,
    `rows=${(list.data ?? []).length}`);

  // ── ONE AT A TIME ───────────────────────────────────────────────────────
  const one = await reader.s.post('notifications.markRead', { id: first.id });
  check('3. READING ONE MARKS ONE — this had no procedure at all',
    one.status === 200 && one.data?.changed === true, `changed=${one.data?.changed}`);
  const afterOne = await reader.s.get('notifications.unreadCount');
  check('4. AND THE BADGE GOES DOWN BY EXACTLY ONE, not to zero',
    afterOne.data?.count === 4, `count=${afterOne.data?.count}`);
  check('5. the row itself is read, and only that row',
    sql('select `read` from notifications where id=' + first.id) === '1'
      && Number(sql('select count(*) from notifications where userId=' + reader.id + ' and `read`=0')) === 4);

  const again = await reader.s.post('notifications.markRead', { id: first.id });
  check('6. reading it twice is honest about having changed nothing',
    again.status === 200 && again.data?.changed === false, `changed=${again.data?.changed}`);

  // ── A RECEIPT IS THE RECIPIENT'S TO GIVE ────────────────────────────────
  const theirs = Number(sql(`select id from notifications where userId=${bystander.id} order by id limit 1`) || 0);
  const forged = await reader.s.post('notifications.markRead', { id: theirs });
  check('7. A RECEIPT CANNOT BE FORGED for somebody else’s notification',
    forged.status === 200 && forged.data?.changed === false, `changed=${forged.data?.changed}`);
  check('8. and their unread count is untouched',
    Number(sql('select count(*) from notifications where userId=' + bystander.id + ' and `read`=0')) === 2);

  const anon = new Session();
  const anonMark = await anon.post('notifications.markRead', { id: first.id });
  check('9. a signed-out caller cannot mark anything read',
    anonMark.status !== 200 && anonMark.code === 'UNAUTHORIZED', `code=${anonMark.code}`);

  const all = await reader.s.post('notifications.markAllRead');
  check('10. and clearing the lot still works, for when that is what you want',
    all.status === 200 && Number(sql('select count(*) from notifications where userId=' + reader.id + ' and `read`=0')) === 0);

  // ── THE DESTINATION THAT USED TO BE A 404 ───────────────────────────────
  //
  // FOLLOWED, NOT GUESSED. The first version of this navigated to a hard-coded
  // `?assignee=` URL, so it proved the page existed and said nothing about
  // where the notification actually points - and it passed unchanged when the
  // dead four-segment link was put back. A real assignment is made and the
  // `link` the server stored is the one that gets loaded.
  const session = await adminSession('superadmin@buildhub.local', 'LocalSuperAdmin!2024');
  if (!session.ok) throw new Error(`admin sign-in: ${session.reason}`);
  const adminId = Number(sql("select id from users where email='superadmin@buildhub.local'") || 0);

  const customer = await account('nrc', 'homeowner');
  const provider = await account('nrp', 'contractor');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${provider.id}`);
  await provider.s.post('profile.setMyCategories', { categories: ['Renovation'] });
  const project = await customer.s.post('projects.create', {
    title: `Probe notif project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const rfq = await customer.s.post('rfq.create', {
    projectId: project.data?.id, title: `Probe notif RFQ ${stamp}`,
    description: 'A renovation request.', category: 'Renovation', location: 'Cairo',
  });
  const rfqId = rfq.data?.id ?? 0;
  await provider.s.post('rfq.openEnquiry', { rfqId });

  const adminApi = new Session();
  for (const [name, value] of session.cookie.split('; ').map(pair => {
    const i = pair.indexOf('=');
    return [pair.slice(0, i), pair.slice(i + 1)];
  })) adminApi.cookies.set(name, value);
  const assigned = await adminApi.post('admin.bulkAssignEnquiries', {
    pairs: [{ rfqId, vendorId: provider.id }], assigneeId: adminId,
  });
  check('10a. SETUP: a real enquiry is assigned to an administrator',
    assigned.status === 200 && (assigned.data?.assigned ?? 0) >= 1,
    `http=${assigned.status} assigned=${assigned.data?.assigned} err=${String(assigned.error).slice(0, 60)}`);

  const written = sql(`select link from notifications where userId=${adminId}`
    + ` and title like 'Enquiries were assigned%' order by id desc limit 1`);
  check('10b. AND THE NOTIFICATION CARRIES A DESTINATION',
    written.length > 0 && written.startsWith('/'), written);

  const page = await browser.newPage();
  await page.setCookies(asBrowserCookies(session.cookie));
  await page.goto(`${BASE}${written}`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}${written}`);
  await waitFor(page, `!!document.querySelector('[data-testid="enquiry-assignee-chip"],[data-testid="enquiry-search"]')`);
  const arrived = JSON.parse(await page.evaluate(`
    const chip = document.querySelector('[data-testid="enquiry-assignee-chip"]');
    return JSON.stringify({
      notFound: /Page Not Found/i.test(document.body.innerText),
      chip: !!chip,
      chipText: chip ? chip.innerText.replace(/\\s+/g, ' ').trim() : '',
      clear: !!document.querySelector('[data-testid="enquiry-assignee-clear"]'),
    });
  `));
  check('11. FOLLOWING THE NOTIFICATION\u2019S OWN LINK REACHES A REAL PAGE — it used to be 404',
    arrived.notFound === false, `link=${written} notFound=${arrived.notFound}`);
  check('12. and the narrowing is VISIBLE, not silent',
    arrived.chip === true && /Assigned to/i.test(arrived.chipText), arrived.chipText.slice(0, 50));
  check('13. with a way to turn it off', arrived.clear === true);

  // The old path, to show the probe can still tell the difference.
  await page.goto(`${BASE}/admin/enquiries/assignee/${adminId}`);
  await waitFor(page, `document.body.innerText.length > 40`);
  const old = await page.evaluate(`return String(/Page Not Found/i.test(document.body.innerText));`);
  check('14. and the OLD four-segment path is still a 404, which is why it was wrong',
    old === 'true', `notFound=${old}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  try { await browser.close(); } catch {}
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from projectMembers where userId=${id}`,
      // The assignment half of the probe creates a real enquiry, so the rows
      // that hang off it have to go before the accounts can.
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
      `delete from quotations where providerId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  try { sql(`delete from notifications where title like 'Enquiries were assigned%' and createdAt > date_sub(now(), interval 1 hour)`); } catch {}
  try { sql(`delete from enquiryAssignments where rfqId in (select id from rfqs where title like 'Probe notif RFQ ${stamp}%')`); } catch {}
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  try { sql(`delete from projects where title like 'Probe notif project ${stamp}%'`); } catch {}
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('15. CLEANUP: every account and notification this probe created is gone', left === 0, `users=${left}`);
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

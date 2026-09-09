// ── LIVE: support tickets, end to end and adversarially ────────────────────
//
// PM-A5. The unit suite proves the MATRIX (shared/projectAccess.ts) and the
// membership resolver in isolation. Three things it structurally cannot prove,
// and they are the three this probe exists for:
//
// The unit suite pins the vocabulary, the state machine and the access door
// against doubles. Four things it structurally cannot prove, and they are the
// four this probe exists for:
//
//   THE DOOR AGAINST A REAL DATABASE. A stranger asking for someone else's
//     ticket must get the same answer as somebody asking for a ticket that was
//     never created. A fake returning a fixed row cannot demonstrate that the
//     two are indistinguishable over HTTP.
//
//   THE STATE MACHINE AS THE ROUTER APPLIES IT. `canTransitionSupport` being
//     correct is a different claim from the endpoint refusing the move.
//
//   THE REPLY RULE'S EFFECT ON A ROW. "Answering returns it to the queue" is a
//     claim about what the status column says afterwards.
//
//   THE PERMISSION BOUNDARY. Every admin procedure must refuse an ordinary
//     account, and the internal notes must be unreachable from any surface a
//     requester can call.
//
// Accounts are created through the product's own auth.signUp over HTTP with a
// real session cookie each. Nothing is inserted into supportTickets directly,
// so a row exists only if the product put it there.
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

/**
 * NO BROWSER, DELIBERATELY.
 *
 * Every claim below is about what the SERVER does with an authenticated
 * request: who may read the team, who may change it, and what the database
 * holds afterwards. A rendered page proves none of that - the whole point of
 * checks 14, 15 and 17 is that hiding a button is not an access control - so
 * driving a browser here would add a dependency and a class of flake without
 * strengthening a single assertion.
 *
 * Accounts are still created by the product's own `auth.signUp`, over HTTP,
 * with a real session cookie carried per account. Nothing is inserted into
 * projectMembers directly; a row exists only if the product put it there.
 */
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
  async post(path, input) {
    const res = await fetch(`${BASE}/api/trpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.header() },
      body: JSON.stringify({ json: input }),
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
  };
}

async function account(prefix, userRole) {
  const s = new Session(prefix);
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'TeamPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp failed for ${prefix}: http=${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session for ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id, name: u };
}

const call = (a, path, input) => a.s.post(path, input);
const query = (a, path, input) => a.s.get(path, input);


let ticketId = 0;
let otherTicketId = 0;

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const customer = await account('stcu', 'homeowner');
  const stranger = await account('stst', 'homeowner');

  // A real support administrator, promoted through the database because
  // BuildHub deliberately has no self-service path to an admin role.
  const agent = await account('stag', 'homeowner');
  sql(`update users set role='admin', adminRole='SUPPORT_ADMIN' where id=${agent.id}`);
  const agentRole = sql(`select adminRole from users where id=${agent.id}`);
  check('SETUP: a support administrator exists', agentRole === 'SUPPORT_ADMIN', `role=${agentRole}`);

  // ── 1-4. Raising a ticket ───────────────────────────────────────────────
  const created = await call(customer, 'support.createTicket', {
    category: 'technical', subject: `Probe ticket ${stamp}`,
    description: 'The probe could not do the thing it was trying to do.',
  });
  ticketId = created.data?.id ?? 0;
  check('1. any signed-in account may raise a ticket', created.status === 200 && ticketId > 0,
    `http=${created.status} id=${ticketId} err=${String(created.error).slice(0, 60)}`);

  const dbRow = sql(`select status, priority, reference from supportTickets where id=${ticketId}`).split('\t');
  check('2. it starts open, at the DEFAULT priority the customer did not choose',
    dbRow[0] === 'open' && dbRow[1] === 'medium', `status=${dbRow[0]} priority=${dbRow[1]}`);
  check('3. a human reference was stored, not just an id',
    /^SUP-\d{4}-\d{6}$/.test(dbRow[2] ?? ''), `reference=${dbRow[2]}`);

  const mine = await query(customer, 'support.myTickets');
  check('4. it appears in the customer’s own list',
    (mine.data ?? []).some(t => t.id === ticketId), `count=${(mine.data ?? []).length}`);

  // ── 5-8. The door, against a real database ──────────────────────────────
  const strangerRead = await query(stranger, 'support.ticket', { ticketId });
  check('5. NEGATIVE: a stranger cannot read it', strangerRead.status !== 200, `http=${strangerRead.status}`);

  const absent = await query(stranger, 'support.ticket', { ticketId: 999999 });
  check('6. and a ticket that never existed answers IDENTICALLY - so ids cannot be enumerated',
    strangerRead.status === absent.status && strangerRead.error === absent.error,
    `other=${strangerRead.status}/${strangerRead.error} absent=${absent.status}/${absent.error}`);

  const strangerReply = await call(stranger, 'support.reply', { ticketId, body: 'let me in' });
  check('7. NEGATIVE: a stranger cannot reply to it', strangerReply.status !== 200, `http=${strangerReply.status}`);

  const strangerList = await query(stranger, 'support.myTickets');
  check('8. NEGATIVE: and it is not in THEIR list',
    !(strangerList.data ?? []).some(t => t.id === ticketId), `count=${(strangerList.data ?? []).length}`);

  // ── 9-12. The permission boundary ───────────────────────────────────────
  const customerQueue = await query(customer, 'admin.supportTickets', { page: 0, pageSize: 20, assignee: 'all' });
  check('9. NEGATIVE: an ordinary account cannot read the support QUEUE',
    customerQueue.status !== 200, `http=${customerQueue.status}`);
  const customerNotes = await query(customer, 'admin.supportTicketNotes', { ticketId });
  check('10. NEGATIVE: nor the INTERNAL notes on their own ticket',
    customerNotes.status !== 200, `http=${customerNotes.status}`);
  const customerAssign = await call(customer, 'admin.assignSupportTicket', { ticketId, assigneeId: null });
  check('11. NEGATIVE: nor assign it', customerAssign.status !== 200, `http=${customerAssign.status}`);
  const customerResolve = await call(customer, 'admin.transitionSupportTicket', { ticketId, to: 'closed' });
  check('12. NEGATIVE: nor close it', customerResolve.status !== 200, `http=${customerResolve.status}`);

  // ── 13-16. Staff work it ────────────────────────────────────────────────
  const queue = await query(agent, 'admin.supportTickets', { page: 0, pageSize: 20, assignee: 'all' });
  check('13. the support agent sees the queue, with a real total',
    queue.status === 200 && typeof queue.data?.total === 'number', `http=${queue.status} total=${queue.data?.total}`);
  check('14. the queue names the PERSON, not a raw id',
    (queue.data?.rows ?? []).every(r => r.requesterName !== undefined),
    `rows=${(queue.data?.rows ?? []).length}`);

  const byReference = await query(agent, 'admin.supportTickets', { page: 0, pageSize: 20, assignee: 'all', search: dbRow[2] });
  check('15. searching by the reference finds exactly that ticket',
    (byReference.data?.rows ?? []).length === 1 && byReference.data.rows[0].id === ticketId,
    `rows=${(byReference.data?.rows ?? []).length}`);

  const assigned = await call(agent, 'admin.assignSupportTicket', { ticketId, assigneeId: agent.id });
  const assignedTo = sql(`select assignedTo from supportTickets where id=${ticketId}`);
  check('16. assignment is real in the database',
    assigned.status === 200 && assignedTo === String(agent.id), `http=${assigned.status} assignedTo=${assignedTo}`);

  // ── 17-19. Assigning to someone who cannot work it ──────────────────────
  const badAssign = await call(agent, 'admin.assignSupportTicket', { ticketId, assigneeId: customer.id });
  check('17. NEGATIVE: a ticket cannot be assigned to somebody without support.manage',
    badAssign.status !== 200, `http=${badAssign.status}`);
  const stillAgent = sql(`select assignedTo from supportTickets where id=${ticketId}`);
  check('18. and the refused assignment changed NOTHING', stillAgent === String(agent.id), `assignedTo=${stillAgent}`);

  // ── 19-24. The state machine, as the router applies it ──────────────────
  const requestInfo = await call(agent, 'admin.transitionSupportTicket', { ticketId, to: 'awaiting_user', reason: 'need the order number' });
  const awaiting = sql(`select status from supportTickets where id=${ticketId}`);
  check('19. request-information is a real STATUS, not a note',
    requestInfo.status === 200 && awaiting === 'awaiting_user', `http=${requestInfo.status} status=${awaiting}`);

  const historyRows = sql(`select count(*) from supportTicketStatusHistory where ticketId=${ticketId}`);
  check('20. the move wrote history', Number(historyRows) >= 1, `rows=${historyRows}`);

  const customerReply = await call(customer, 'support.reply', { ticketId, body: 'Here is the order number.' });
  const afterReply = sql(`select status from supportTickets where id=${ticketId}`);
  check('21. the customer answering returns it to the QUEUE automatically',
    customerReply.status === 200 && afterReply === 'in_progress', `http=${customerReply.status} status=${afterReply}`);

  const resolveNoNotes = await call(agent, 'admin.transitionSupportTicket', { ticketId, to: 'resolved' });
  check('22. NEGATIVE: resolving with no record of what was done is refused',
    resolveNoNotes.status !== 200, `http=${resolveNoNotes.status}`);

  const resolved = await call(agent, 'admin.transitionSupportTicket', { ticketId, to: 'resolved', resolutionNotes: 'Reset the thing.' });
  const resolvedRow = sql(`select status, resolutionNotes is not null, resolvedBy from supportTickets where id=${ticketId}`).split('\t');
  check('23. resolving records WHAT WAS DONE and by whom',
    resolved.status === 200 && resolvedRow[0] === 'resolved' && resolvedRow[1] === '1' && resolvedRow[2] === String(agent.id),
    `status=${resolvedRow[0]} notes=${resolvedRow[1]} by=${resolvedRow[2]}`);

  const reopen = await call(customer, 'support.reply', { ticketId, body: 'That did not fix it.' });
  const reopened = sql(`select status from supportTickets where id=${ticketId}`);
  check('24. a dissatisfied customer REOPENS it by replying',
    reopen.status === 200 && reopened === 'in_progress', `http=${reopen.status} status=${reopened}`);

  // ── 25-27. Closed is terminal, and means it ─────────────────────────────
  await call(agent, 'admin.transitionSupportTicket', { ticketId, to: 'closed' });
  const closedRow = sql(`select status, closedBy is not null from supportTickets where id=${ticketId}`).split('\t');
  check('25. closing records who closed it', closedRow[0] === 'closed' && closedRow[1] === '1',
    `status=${closedRow[0]} closedBy=${closedRow[1]}`);

  const replyToClosed = await call(customer, 'support.reply', { ticketId, body: 'still broken' });
  check('26. NEGATIVE: a reply does not resurrect a closed ticket',
    replyToClosed.status !== 200, `http=${replyToClosed.status}`);

  const reopenClosed = await call(agent, 'admin.transitionSupportTicket', { ticketId, to: 'open' });
  check('27. NEGATIVE: not even an administrator can move a closed ticket',
    reopenClosed.status !== 200, `http=${reopenClosed.status}`);

  // ── 28-30. Internal notes stay internal ─────────────────────────────────
  const note = await call(agent, 'admin.addSupportTicketNote', { ticketId, note: 'PROBE-INTERNAL-SECRET' });
  check('28. staff can write an internal note', note.status === 200, `http=${note.status}`);
  const noteRows = sql(`select count(*) from adminNotes where subjectType='support_ticket' and subjectId=${ticketId}`);
  check('29. it is stored against the ticket in the SHARED notes table', noteRows === '1', `rows=${noteRows}`);

  const customerDetail = await query(customer, 'support.ticket', { ticketId });
  check('30. NEGATIVE: the note appears NOWHERE in what the customer can read',
    !JSON.stringify(customerDetail.data ?? {}).includes('PROBE-INTERNAL-SECRET'), 'searched the whole payload');

  // ── 31-32. One customer's ticket is not another's ───────────────────────
  const second = await call(stranger, 'support.createTicket', {
    category: 'billing', subject: `Second probe ${stamp}`,
    description: 'A different customer with a different question entirely.',
  });
  otherTicketId = second.data?.id ?? 0;
  const strangerList2 = await query(stranger, 'support.myTickets');
  check('31. the second customer sees only their own',
    (strangerList2.data ?? []).length === 1 && strangerList2.data[0].id === otherTicketId,
    `count=${(strangerList2.data ?? []).length}`);
  const crossRead = await query(customer, 'support.ticket', { ticketId: otherTicketId });
  check('32. NEGATIVE: and the first customer cannot read it', crossRead.status !== 200, `http=${crossRead.status}`);

} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  for (const id of [ticketId, otherTicketId]) {
    if (!id) continue;
    for (const q of [
      `delete from adminNotes where subjectType='support_ticket' and subjectId=${id}`,
      `delete from supportTicketStatusHistory where ticketId=${id}`,
      `delete from supportTicketMessages where ticketId=${id}`,
      `delete from supportTicketAttachments where ticketId=${id}`,
      `delete from supportTickets where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from adminNotes where authorId=${id}`,
      `delete from supportTicketStatusHistory where actorId=${id}`,
      `delete from supportTicketMessages where authorId=${id}`,
      `delete from supportTickets where requesterId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftoverUsers = made.length ? sql(`select count(*) from users where id in (${made.join(',')})`) : '0';
  const leftoverTickets = sql(`select count(*) from supportTickets where subject like 'Probe ticket%' or subject like 'Second probe%'`);
  console.log(results.join('\n'));
  console.log(`\nCLEANUP: ${leftoverUsers} probe users, ${leftoverTickets} probe tickets left behind (both must be 0)`);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 && leftoverUsers === '0' && leftoverTickets === '0' ? 0 : 1);
}

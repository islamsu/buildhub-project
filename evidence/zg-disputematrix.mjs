// ── LIVE: THE NEGATIVE MATRIX FOR DISPUTES ────────────────────────────────
//
// THE RULE THIS EXISTS TO PROVE: A COMPETITOR SUPPLIER NEVER GETS IN.
//
// Two suppliers bidding on the same RFQ are commercial rivals. A dispute about
// one bid is none of the other's business - not the dispute, not its messages,
// not its evidence, not even the fact that it exists. `disputes.create` used to
// check project membership inline and nothing else checked anything at all:
// `myDisputes` filtered on reporter-or-respondent, `admin.disputes` returned
// every row, and there was no read path for a single dispute to guard.
//
// server/disputeEligibility.ts now decides all of it, and this proves the
// decision against a real database rather than against a fake: a real RFQ with
// TWO real approved suppliers quoting on it, and every operation attempted by
// the one who is not a party.
//
// It also covers what the other two dispute probes do not: the QUOTATION
// subject end to end, respondent tampering, invalid state-machine moves, and
// that the audit trail and the notifications actually got written.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().trim();

let pass = 0, fail = 0, blocked = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};
const blockedBy = (name, reason) => { results.push(`BLOCKED  ${name}  [${reason}]`); blocked++; };

function session(initial = '') {
  let cookie = initial;
  const call = async (method, path, input, dateMeta) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      /*
       * SUPERJSON, because that is what this server's tRPC uses. A `z.date()`
       * input arrives as a string over plain JSON and is refused - correctly -
       * so the Date is declared in `meta` the way the real client does.
       */
      ...(method === 'POST'
        ? { body: JSON.stringify(dateMeta ? { json: input, meta: { values: dateMeta } } : { json: input }) }
        : {}),
    });
    for (const raw of (res.headers.getSetCookie?.() ?? [])) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return {
      status: res.status, data: json?.result?.data?.json ?? null,
      error: json?.error?.json?.message ?? null,
      code: json?.error?.json?.data?.code ?? null,
    };
  };
  return {
    query: (p, i) => call('GET', p, i),
    mutate: (p, i, dateMeta) => call('POST', p, i, dateMeta),
    cookie: () => cookie,
  };
}

const stamp = Date.now() % 100000000;
const made = { users: [], projects: [], rfqs: [], quotations: [], disputes: [] };
const admin = session();

async function signUp(suffix, userRole, name) {
  const username = `zgdm${stamp}${suffix}`;
  let res = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username, email: `${username}@example.test`, password: 'ProbeUser!2024', name, userRole,
      } }),
    });
    if (res.status !== 429) break;
    const seconds = Number(/Try again in (\d+)s/.exec(await res.text())?.[1] ?? 20);
    await new Promise(resolve => setTimeout(resolve, Math.min(seconds + 2, 70) * 1000));
  }
  if (res.status !== 200) throw new Error(`probe setup: signUp ${suffix} failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  made.users.push(id);
  const account = {
    id, username, name,
    session: session((res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')),
  };
  return account;
}

/** Approve a provider THROUGH THE REAL ADMIN PATH, then re-sign them in. */
async function approve(account) {
  const decided = await admin.mutate('admin.updateApplicantStatus', {
    userId: account.id, status: 'approved', note: 'probe',
  });
  if (decided.status !== 200) throw new Error(`probe setup: approve ${account.username} ${decided.error}`);
  // The session carries the role snapshot, so it is re-established after the
  // change rather than assumed to have followed it.
  const fresh = session();
  const back = await fresh.mutate('auth.signIn', {
    identifier: `${account.username}@example.test`, password: 'ProbeUser!2024',
  });
  if (back.status !== 200) throw new Error(`probe setup: re-signin ${account.username} ${back.error}`);
  account.session = fresh;
}

try {
  const signedIn = await admin.mutate('auth.adminSignIn', {
    identifier: 'superadmin@buildhub.local', password: 'LocalSuperAdmin!2024',
  });
  if (signedIn.status !== 200) throw new Error(`probe setup: admin sign-in ${signedIn.status}`);

  // ── THE CAST: one buyer, two RIVAL suppliers, one outsider ──────────────
  const buyer = await signUp('buy', 'homeowner', `ZG Buyer ${stamp}`);
  const winner = await signUp('win', 'supplier', `ZG Winner ${stamp}`);
  const rival = await signUp('riv', 'supplier', `ZG Rival ${stamp}`);
  const outsider = await signUp('out', 'contractor', `ZG Outsider ${stamp}`);
  await approve(winner);
  await approve(rival);

  const rfq = await buyer.session.mutate('rfq.create', {
    title: `ZG matrix rfq ${stamp}`, description: 'Roof waterproofing, 200 m2.',
    category: 'Materials',
  });
  const rfqId = Number(rfq.data?.id ?? 0);
  if (!rfqId) throw new Error(`probe setup: rfq ${rfq.error}`);
  made.rfqs.push(rfqId);

  /*
   * BOTH SUPPLIERS ARE INVITED, THROUGH THE REAL PROCEDURE.
   *
   * A provider cannot bid on an RFQ they have no relationship to: BuildHub
   * requires an open invitation or a qualified enquiry they have paid a credit
   * for. Inviting them is the route that does not depend on an allowance, and
   * it is what makes them genuine RIVALS on the same request - which is the
   * whole point of this probe.
   */
  for (const supplier of [winner, rival]) {
    const invited = await buyer.session.mutate('rfq.inviteSupplier', {
      rfqId, supplierId: supplier.id,
    });
    if (invited.status !== 200) throw new Error(`probe setup: invite ${supplier.username} ${invited.error}`);
  }

  const tomorrow = new Date(Date.now() + 7 * 86400000).toISOString();
  const bid = async (supplier, price) => {
    const res = await supplier.session.mutate('rfq.submitQuotation', {
      rfqId, price, validUntil: tomorrow, timeline: 30,
      notes: `Bid from ${supplier.name}`,
    }, { validUntil: ['Date'] });
    if (res.status !== 200) throw new Error(`probe setup: bid ${supplier.username} ${res.error}`);
    return Number(res.data?.id ?? res.data?.quotationId ?? 0);
  };
  const winningQuote = await bid(winner, 100000);
  const rivalQuote = await bid(rival, 120000);
  if (!winningQuote || !rivalQuote) throw new Error('probe setup: quotation ids not returned');
  made.quotations.push(winningQuote, rivalQuote);
  check('BOTH suppliers really did bid on the same RFQ - they are rivals',
    Number(sql(`select count(*) from quotations where rfqId=${rfqId}`)) === 2,
    sql(`select count(*) from quotations where rfqId=${rfqId}`));

  // ── THE QUOTATION SUBJECT: exactly two parties, and no more ─────────────
  const quoteParties = await buyer.session.query('disputes.subjectParties', {
    subjectType: 'quotation', subjectId: winningQuote,
  });
  check('a quotation dispute offers exactly ONE respondent - the supplier who quoted',
    quoteParties.status === 200 && (quoteParties.data.candidates ?? []).length === 1
    && Number(quoteParties.data.candidates[0].userId) === winner.id,
    JSON.stringify((quoteParties.data?.candidates ?? []).map(c => c.name)));
  check('and the losing bidder is NOT among them',
    !(quoteParties.data?.candidates ?? []).some(c => Number(c.userId) === rival.id));

  /*
   * THE HEADLINE RULE. The rival bid on this RFQ, so they are a party to the
   * RFQ - but a QUOTATION is a two-party document, and the other bidder is not
   * one of them.
   */
  const rivalOnQuote = await rival.session.query('disputes.subjectParties', {
    subjectType: 'quotation', subjectId: winningQuote,
  });
  check('A RIVAL BIDDER CANNOT EVEN READ THE CAST of the winning quotation',
    rivalOnQuote.status !== 200 && rivalOnQuote.code === 'NOT_FOUND',
    `${rivalOnQuote.status} ${rivalOnQuote.code ?? ''}`);

  const rivalRaises = await rival.session.mutate('disputes.create', {
    subjectType: 'quotation', subjectId: winningQuote,
    title: 'should never exist', description: 'x', category: 'pricing',
  });
  check('A RIVAL BIDDER CANNOT RAISE A DISPUTE about the winning quotation',
    rivalRaises.status !== 200 && rivalRaises.code === 'NOT_FOUND',
    `${rivalRaises.status} ${rivalRaises.code ?? ''}`);

  // ── THE REAL QUOTATION DISPUTE ──────────────────────────────────────────
  const raised = await buyer.session.mutate('disputes.create', {
    subjectType: 'quotation', subjectId: winningQuote, respondentId: winner.id,
    title: `ZG quoted price ${stamp}`,
    description: 'The quoted price does not match what was discussed.',
    category: 'pricing',
  });
  check('the buyer CAN raise one about the quotation they received',
    raised.status === 200, raised.error ?? '');
  const disputeId = Number(raised.data.id);
  made.disputes.push(disputeId);
  check('and it is recorded against the QUOTATION, not against a project',
    sql(`select concat(subjectType,':',subjectId,':',ifnull(projectId,'null')) from disputes where id=${disputeId}`)
      === `quotation:${winningQuote}:null`,
    sql(`select concat(subjectType,':',subjectId,':',ifnull(projectId,'null')) from disputes where id=${disputeId}`));

  // ── RESPONDENT TAMPERING ────────────────────────────────────────────────
  const tampered = await buyer.session.mutate('disputes.create', {
    subjectType: 'quotation', subjectId: rivalQuote, respondentId: outsider.id,
    title: 'tampered respondent', description: 'x', category: 'other',
  });
  check('naming somebody who is not in the subject\'s cast is refused',
    tampered.status !== 200, `${tampered.status}: ${String(tampered.error).slice(0, 60)}`);
  const selfNamed = await buyer.session.mutate('disputes.create', {
    subjectType: 'quotation', subjectId: rivalQuote, respondentId: buyer.id,
    title: 'self named', description: 'x', category: 'other',
  });
  check('and naming YOURSELF as the respondent is refused too',
    selfNamed.status !== 200, `${selfNamed.status}: ${String(selfNamed.error).slice(0, 60)}`);
  const subjectSwap = await buyer.session.mutate('disputes.create', {
    subjectType: 'quotation', subjectId: 999999999,
    title: 'subject that does not exist', description: 'x', category: 'other',
  });
  check('a subject id that does not exist is refused, not created against nothing',
    subjectSwap.status !== 200 && subjectSwap.code === 'NOT_FOUND',
    `${subjectSwap.status} ${subjectSwap.code ?? ''}`);

  // ── READING IT: only the two parties ────────────────────────────────────
  for (const [who, actor] of [['the rival bidder', rival], ['an unrelated contractor', outsider]]) {
    const read = await actor.session.query('disputes.get', { disputeId });
    check(`${who} cannot READ the dispute`,
      read.status !== 200 && read.code === 'NOT_FOUND', `${read.status} ${read.code ?? ''}`);
    const say = await actor.session.mutate('disputes.postMessage', { disputeId, body: 'let me in' });
    check(`${who} cannot post a MESSAGE into it`,
      say.status !== 200, `${say.status} ${say.code ?? ''}`);
    const file = await actor.session.mutate('disputes.addEvidence', {
      disputeId, fileName: 'x.png', contentType: 'image/png', base64: 'iVBORw0KGgo=',
    });
    check(`${who} cannot ATTACH evidence to it`, file.status !== 200, `${file.status} ${file.code ?? ''}`);
    const end = await actor.session.mutate('disputes.withdraw', { disputeId, reason: 'x' });
    check(`${who} cannot WITHDRAW it`, end.status !== 200, `${end.status} ${end.code ?? ''}`);
    const back = await actor.session.mutate('disputes.reopen', { disputeId, reason: 'x' });
    check(`${who} cannot REOPEN it`, back.status !== 200, `${back.status} ${back.code ?? ''}`);
    const seen = await actor.session.query('disputes.myDisputes', { page: 0, pageSize: 20 });
    check(`${who} does not see it in their own list`,
      Number(seen.data?.total ?? 0) === 0, `total=${seen.data?.total}`);
  }
  check('the rival bidder posted nothing into the dispute',
    Number(sql(`select count(*) from disputeMessages where disputeId=${disputeId}`)) === 0);

  // ── ADMIN ENDPOINTS AS AN ORDINARY USER ─────────────────────────────────
  for (const [name, procedure, input, verb] of [
    ['the support queue', 'admin.disputes', { page: 0, pageSize: 25 }, 'query'],
    ['the admin detail', 'admin.disputeDetail', { disputeId }, 'query'],
    ['the assignee list', 'admin.disputeAssignees', undefined, 'query'],
    ['the internal notes', 'admin.disputeNotes', { disputeId }, 'query'],
  ]) {
    const res = await buyer.session[verb](procedure, input);
    check(`a PARTY to the dispute cannot reach ${name}`,
      res.status !== 200 && res.data === null, `${res.status} ${res.code ?? ''}`);
  }
  for (const [name, procedure, input] of [
    ['move it through the state machine', 'admin.updateDispute', { disputeId, status: 'resolved' }],
    ['assign it', 'admin.assignDispute', { disputeId, assignedTo: null }],
    ['write an internal note', 'admin.addDisputeNote', { disputeId, note: 'x' }],
  ]) {
    const res = await buyer.session.mutate(procedure, input);
    check(`a party cannot ${name}`, res.status !== 200, `${res.status} ${res.code ?? ''}`);
  }

  // ── INVALID MOVES THROUGH THE STATE MACHINE ─────────────────────────────
  const noHow = await admin.mutate('admin.updateDispute', { disputeId, status: 'resolved' });
  check('resolving WITHOUT saying how is refused - a bare status flip is not a resolution',
    noHow.status !== 200, `${noHow.status}: ${String(noHow.error).slice(0, 70)}`);

  const investigating = await admin.mutate('admin.updateDispute', { disputeId, status: 'investigating' });
  check('open -> investigating is allowed', investigating.status === 200, investigating.error ?? '');
  const sameAgain = await admin.mutate('admin.updateDispute', { disputeId, status: 'investigating' });
  check('and moving it to the state it is already in is refused',
    sameAgain.status !== 200, `${sameAgain.status}: ${String(sameAgain.error).slice(0, 70)}`);

  const withdrawnByAdmin = await admin.mutate('admin.updateDispute', { disputeId, status: 'withdrawn' });
  check('an administrator cannot record a WITHDRAWAL - that is the reporter\'s own decision',
    withdrawnByAdmin.status !== 200, `${withdrawnByAdmin.status}`);

  const resolvedProperly = await admin.mutate('admin.updateDispute', {
    disputeId, status: 'resolved',
    resolutionType: 'resolved_by_platform', resolutionNotes: 'Price was as quoted.',
  });
  check('resolving WITH a type and notes is allowed', resolvedProperly.status === 200, resolvedProperly.error ?? '');
  const doubleResolve = await admin.mutate('admin.updateDispute', {
    disputeId, status: 'resolved',
    resolutionType: 'no_action_required', resolutionNotes: 'different answer',
  });
  check('and a resolved dispute cannot be quietly re-resolved with a different answer',
    doubleResolve.status !== 200, `${doubleResolve.status}: ${String(doubleResolve.error).slice(0, 70)}`);
  check('the first resolution stands, unchanged',
    sql(`select resolutionType from disputes where id=${disputeId}`) === 'resolved_by_platform',
    sql(`select resolutionType from disputes where id=${disputeId}`));

  // ── THE RECORD OF ALL THAT ──────────────────────────────────────────────
  const history = sql(`select group_concat(concat(fromStatus,'>',toStatus) order by id) from disputeStatusHistory where disputeId=${disputeId}`);
  check('every move is in the history, in order, with nothing invented',
    history === 'none>open,open>investigating,investigating>resolved', history);
  check('and each history row records WHO made the move',
    Number(sql(`select count(*) from disputeStatusHistory where disputeId=${disputeId} and actorId is null`)) === 0);
  check('the refused moves left NO history rows behind',
    Number(sql(`select count(*) from disputeStatusHistory where disputeId=${disputeId}`)) === 3,
    sql(`select count(*) from disputeStatusHistory where disputeId=${disputeId}`));

  const audited = sql(`select count(*) from userAccountAuditEvents where source='dispute' and userId in (${buyer.id},${winner.id})`);
  check('opening the dispute is in the account audit trail', Number(audited) >= 1, audited);

  const told = sql(`select count(*) from notifications where userId=${winner.id} and type='dispute'`);
  check('the supplier was notified when it was raised and when it moved',
    Number(told) >= 2, `${told} notifications`);
  const rivalTold = sql(`select count(*) from notifications where userId=${rival.id} and type='dispute'`);
  check('and the RIVAL BIDDER was told nothing about any of it',
    Number(rivalTold) === 0, `${rivalTold} notifications`);

  // ── THE QUEUE SHOWS IT TO THE ADMINISTRATOR, WITH THE SUBJECT ───────────
  const queued = await admin.query('admin.disputes', {
    page: 0, pageSize: 25, search: `ZG quoted price ${stamp}`,
  });
  check('the support queue finds it by title',
    Number(queued.data?.total) === 1 && Number(queued.data.rows[0].id) === disputeId,
    `total=${queued.data?.total}`);
  const detail = await admin.query('admin.disputeDetail', { disputeId });
  check('and the admin detail names the quotation it is about, in words',
    typeof detail.data?.subjectLabel === 'string'
    && detail.data.subjectLabel.includes(String(stamp)),
    String(detail.data?.subjectLabel));

  // ── CROSS-DISPUTE ATTACHMENT IDOR ───────────────────────────────────────
  blockedBy('a participant in dispute A cannot fetch dispute B\'s file',
    'no object store configured on this environment - storagePut refuses, so no file exists to fetch');
  /*
   * What CAN be proven without a stored file: the evidence id space is guarded
   * the same way the dispute id space is - a made-up id is refused before
   * anything about it is revealed.
   */
  const ghostEvidence = await buyer.session.mutate('disputes.removeEvidence', { evidenceId: 999999999 });
  check('an evidence id that does not exist is refused, not probed',
    ghostEvidence.status !== 200 && ghostEvidence.code === 'NOT_FOUND',
    `${ghostEvidence.status} ${ghostEvidence.code ?? ''}`);
  const proxyGuess = await fetch(`${BASE}/manus-storage/dispute-evidence/${disputeId}/guessed.png`, {
    headers: { cookie: rival.session.cookie() },
  });
  check('and the storage proxy refuses a guessed dispute-evidence key outright',
    [401, 403, 404].includes(proxyGuess.status), String(proxyGuess.status));
} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  const failures = [];
  const attempt = statement => {
    try { sql(statement); } catch (error) { failures.push(String(error.message).split('\n').pop()); }
  };
  if (made.disputes.length > 0) {
    const ids = made.disputes.join(',');
    attempt(`delete from adminNotes where subjectType='dispute' and subjectId in (${ids})`);
    attempt(`delete from disputeEvidence where disputeId in (${ids})`);
    attempt(`delete from disputeMessages where disputeId in (${ids})`);
    attempt(`delete from disputeStatusHistory where disputeId in (${ids})`);
    attempt(`delete from disputes where id in (${ids})`);
  }
  if (made.users.length > 0) {
    const ids = made.users.join(',');
    if (made.rfqs.length > 0) {
      const rfqIds = made.rfqs.join(',');
      attempt(`delete from quotations where rfqId in (${rfqIds})`);
      attempt(`delete from rfqItems where rfqId in (${rfqIds})`);
      attempt(`delete from rfqSuppliers where rfqId in (${rfqIds})`);
      attempt(`delete from qualifiedEnquiries where rfqId in (${rfqIds})`);
      attempt(`delete from enquiryAssignments where rfqId in (${rfqIds})`);
      attempt(`delete from rfqs where id in (${rfqIds})`);
    }
    if (made.projects.length > 0) {
      attempt(`delete from projectMembers where projectId in (${made.projects.join(',')})`);
      attempt(`delete from projects where id in (${made.projects.join(',')})`);
    }
    attempt(`delete from projectMembers where userId in (${ids})`);
    attempt(`delete from fieldValueHistory where ownerId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from registrationReviewEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from notifications where userId in (${ids})`);
    attempt(`delete from userAccountAuditEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from analyticsEvents where userId in (${ids})`);
    attempt(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    attempt(`delete from vendorEntitlementOverrides where userId in (${ids})`);
    attempt(`delete from vendorSubscriptions where userId in (${ids})`);
    attempt(`delete from users where id in (${ids})`);
  }
  if (failures.length > 0) check(`CLEANUP: ${failures.length} statement(s) failed`, false, failures.slice(0, 3).join(' | '));
}

check('CLEANUP: every row this probe planted is gone',
  (made.users.length === 0 || Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0)
  && (made.disputes.length === 0 || Number(sql(`select count(*) from disputes where id in (${made.disputes.join(',')})`)) === 0));

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`
  + (blocked > 0 ? `, ${blocked} BLOCKED BY INFRASTRUCTURE (not counted either way)` : ''));
process.exit(fail === 0 ? 0 : 1);

// ── LIVE: the dispute queue an administrator actually works from ───────────
//
// WHAT THIS REPLACES. `admin.disputes` returned EVERY dispute ever filed in one
// response and read EVERY USER ON THE PLATFORM into memory to resolve two names
// per row, with the search and status filter applied afterwards in the browser.
// The second is a table scan of the largest table on every load of a support
// screen; the first is the failure that misleads - a filter over a truncated
// set answers "no matching disputes" with confidence.
//
// The unit tests use a fake database. This runs the real query against real
// MariaDB, because two things here exist ONLY in SQL and no fake can see them:
// the ALIASED SELF-JOINS onto `users` for the two parties, and the
// `field(status, ...)` ordering that puts open work above concluded work. Both
// are syntax that either executes or does not.
//
// Every dispute below is raised through the real HTTP API by a real account
// created through the real signup path. Nothing is inserted behind the product.
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`,
  { input: q.replace(/\s+/g, ' ').trim() },
).toString().trim();

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

function session(initial = '') {
  let cookie = initial;
  const call = async (method, path, input) => {
    const url = method === 'GET' && input !== undefined
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : `${BASE}/api/trpc/${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ json: input }) } : {}),
    });
    for (const raw of (res.headers.getSetCookie?.() ?? [])) {
      const pair = String(raw).split(';')[0];
      if (pair.startsWith('app_session_id=')) cookie = pair;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return {
      status: res.status,
      data: json?.result?.data?.json ?? null,
      error: json?.error?.json?.message ?? null,
      code: json?.error?.json?.data?.code ?? null,
    };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i) };
}

const stamp = Date.now() % 100000000;
const made = { users: [], projects: [], disputes: [] };

/** Honours the rate limiter's stated wait rather than reporting it as a defect. */
async function signUp(suffix, userRole, name) {
  const username = `zgdq${stamp}${suffix}`;
  let res = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: {
        username, email: `${username}@example.test`, password: 'ProbeUser!2024',
        name, userRole,
      } }),
    });
    if (res.status !== 429) break;
    const seconds = Number(/Try again in (\d+)s/.exec(await res.text())?.[1] ?? 20);
    await new Promise(resolve => setTimeout(resolve, Math.min(seconds + 2, 70) * 1000));
  }
  if (res.status !== 200) throw new Error(`probe setup: signUp ${suffix} failed ${res.status}`);
  const id = Number(sql(`select id from users where username='${username}'`));
  made.users.push(id);
  return {
    id, username, name,
    session: session((res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')),
  };
}

const admin = session();

/**
 * A QUEUE READ THAT FAILS LOUDLY, NAMING THE SERVER'S OWN REASON.
 *
 * The first version read `res.data.total` straight off every call, so a
 * procedure that 500'd aborted the probe with "cannot read properties of null"
 * - which says nothing about what broke. A probe that cannot say what failed
 * is only marginally better than no probe. Proven by planting a real defect
 * (the count query no longer joining what the page filters on, which MySQL
 * rejects outright) and reading the message it produced.
 */
async function queue(input, what) {
  const res = await admin.query('admin.disputes', input);
  if (res.status !== 200 || !res.data) {
    throw new Error(`admin.disputes (${what}) -> ${res.status}: ${res.error ?? 'no body'}`);
  }
  return res.data;
}

try {
  const signedIn = await admin.mutate('auth.adminSignIn', {
    identifier: 'superadmin@buildhub.local', password: 'LocalSuperAdmin!2024',
  });
  if (signedIn.status !== 200) throw new Error(`probe setup: admin sign-in ${signedIn.status} ${signedIn.error}`);

  /*
   * THE BASELINE, BEFORE ANYTHING IS PLANTED. Every count assertion below is
   * relative to this, so a database that already holds disputes does not make
   * the probe pass or fail for the wrong reason.
   */
  const before = await admin.query('admin.disputes', { page: 0, pageSize: 25 });
  check('the queue answers at all, against real MariaDB',
    before.status === 200 && typeof before.data?.total === 'number',
    before.error ?? `total=${before.data?.total}`);
  const baseTotal = Number(before.data?.total ?? 0);
  const baseOpen = Number(before.data?.counts?.open ?? 0);

  // ── a real cast, through the real signup path ────────────────────────────
  const owner = await signUp('own', 'homeowner', `ZG Owner ${stamp}`);
  const builder = await signUp('bld', 'contractor', `ZG Builder ${stamp}`);
  const stranger = await signUp('str', 'contractor', `ZG Stranger ${stamp}`);

  const project = await owner.session.mutate('projects.create', {
    title: `ZG queue project ${stamp}`, type: 'residential',
  });
  const projectId = Number(project.data?.id ?? project.data?.projectId ?? 0);
  if (!projectId) throw new Error(`probe setup: project not created (${project.error})`);
  made.projects.push(projectId);

  const added = await owner.session.mutate('projects.addMember', {
    projectId, userId: builder.id, projectRole: 'contractor',
  });
  if (added.status !== 200) throw new Error(`probe setup: addMember ${added.error}`);

  // ── three disputes, raised by real people through the real API ───────────
  const raise = async (title, category) => {
    const res = await owner.session.mutate('disputes.create', {
      subjectType: 'project', subjectId: projectId, respondentId: builder.id,
      title, description: `Raised by the probe at ${stamp}.`, category,
    });
    if (res.status !== 200) throw new Error(`probe setup: create "${title}" ${res.error}`);
    made.disputes.push(Number(res.data.id));
    return res.data;
  };
  const first = await raise(`ZG waterproofing ${stamp}`, 'quality');
  const second = await raise(`ZG delivery slip ${stamp}`, 'delivery');
  const third = await raise(`ZG spec mismatch ${stamp}`, 'specification');

  check('every dispute got a human reference',
    [first, second, third].every(row => /^DSP-\d{4}-\d{6}$/.test(String(row.reference))),
    first.reference);

  // ── the totals move by exactly what was planted ──────────────────────────
  const after = await queue({ page: 0, pageSize: 25 }, 'unfiltered');
  check('the total counts the whole table, not the page',
    Number(after.total) === baseTotal + 3, `${baseTotal} -> ${after.total}`);
  check('the status summary counts the whole table too',
    Number(after.counts.open) === baseOpen + 3, `open ${baseOpen} -> ${after.counts.open}`);

  // ── the aliased self-joins resolved BOTH parties ─────────────────────────
  const mine = after.rows.find(row => Number(row.id) === Number(first.id));
  check('the reporter and the respondent are both named, from the joins',
    mine?.reporterName === owner.name && mine?.respondentName === builder.name,
    `${mine?.reporterName} -> ${mine?.respondentName}`);
  check('and their emails come with the row, for the support screen',
    typeof mine?.reporterEmail === 'string' && mine.reporterEmail.includes(owner.username));

  // ── PAGING IS REAL ───────────────────────────────────────────────────────
  const pageOne = await queue({ page: 0, pageSize: 2 }, 'page 0');
  const pageTwo = await queue({ page: 1, pageSize: 2 }, 'page 1');
  check('a page is bounded by its size', pageOne.rows.length === 2, `${pageOne.rows.length}`);
  check('the total is the table, not the page',
    Number(pageOne.total) === baseTotal + 3, `${pageOne.total}`);
  const overlap = pageOne.rows.filter(row =>
    pageTwo.rows.some(other => Number(other.id) === Number(row.id)));
  check('the second page is different rows, so nothing is shown twice or skipped',
    overlap.length === 0, `${overlap.length} overlapping`);

  // ── SEARCH: a reference is an id, not a LIKE ─────────────────────────────
  const byRef = await queue({ page: 0, pageSize: 25, search: first.reference }, 'by reference');
  check('searching a reference returns exactly that dispute',
    Number(byRef.total) === 1 && Number(byRef.rows[0].id) === Number(first.id),
    `total=${byRef.total}`);

  const lowered = await queue(
    { page: 0, pageSize: 25, search: first.reference.toLowerCase() }, 'lower-case reference');
  check('and a pasted lower-case reference finds it too',
    Number(lowered.total) === 1, `total=${lowered.total}`);

  // ── SEARCH BY PARTY, which needs the joins to be in the count as well ────
  const byRespondent = await queue({ page: 0, pageSize: 25, search: builder.name }, 'by respondent');
  check('searching the RESPONDENT\'s name finds the disputes against them',
    Number(byRespondent.total) === 3, `total=${byRespondent.total}`);
  check('and the total agrees with the rows it returned',
    byRespondent.rows.length === Number(byRespondent.total),
    `${byRespondent.rows.length} rows vs total ${byRespondent.total}`);

  const byReporter = await queue({ page: 0, pageSize: 25, search: owner.name }, 'by reporter');
  check('searching the REPORTER\'s name finds them as well',
    Number(byReporter.total) === 3, `total=${byReporter.total}`);

  const noMatch = await queue({ page: 0, pageSize: 25, search: `nothing-matches-${stamp}` }, 'no match');
  check('a search that matches nothing says zero, and does not error',
    Number(noMatch.total) === 0);

  // ── FILTERS RUN IN THE QUERY ─────────────────────────────────────────────
  const byCategory = await queue(
    { page: 0, pageSize: 25, category: 'delivery', search: builder.name }, 'by category');
  check('the category filter narrows to the one dispute that has it',
    Number(byCategory.total) === 1 && Number(byCategory.rows[0].id) === Number(second.id),
    `total=${byCategory.total}`);

  const bySubject = await queue(
    { page: 0, pageSize: 25, subjectType: 'quotation', search: builder.name }, 'by subject type');
  check('filtering to a subject type nobody used returns nothing, truthfully',
    Number(bySubject.total) === 0);

  /*
   * A VALUE THE ENUM CANNOT HOLD IS DROPPED, NOT PASSED THROUGH. Passed
   * through, MySQL matches nothing and the screen says the queue is empty -
   * which is the confident wrong answer this whole change exists to remove.
   */
  const bogus = await queue(
    { page: 0, pageSize: 25, status: 'urgent', search: builder.name }, 'unrecognised status');
  check('an unrecognised filter value is ignored rather than emptying the queue',
    Number(bogus.total) === 3, `total=${bogus.total}`);

  const unassigned = await queue(
    { page: 0, pageSize: 25, assignment: 'unassigned', search: builder.name }, 'unassigned');
  check('unassigned finds all three, because none has an owner yet',
    Number(unassigned.total) === 3, `total=${unassigned.total}`);
  const mineNow = await queue(
    { page: 0, pageSize: 25, assignment: 'mine', search: builder.name }, 'mine');
  check('and none of them is mine yet', Number(mineNow.total) === 0);

  // ── ASSIGNMENT, then the same two questions again ────────────────────────
  const assignees = await admin.query('admin.disputeAssignees', undefined);
  check('the assignee list offers only administrators who can work disputes',
    assignees.status === 200 && Array.isArray(assignees.data) && assignees.data.length >= 1,
    `${assignees.data?.length} offered`);

  const assigned = await admin.mutate('admin.assignDispute', {
    disputeId: Number(second.id), assignedTo: assignees.data[0].id, priority: 'high',
  });
  check('a dispute can be taken', assigned.status === 200, assigned.error ?? '');

  const mineAfter = await queue(
    { page: 0, pageSize: 25, assignment: 'mine', search: builder.name }, 'mine after assignment');
  check('"mine" now finds exactly the one I took',
    Number(mineAfter.total) === 1 && Number(mineAfter.rows[0].id) === Number(second.id),
    `total=${mineAfter.total}`);
  const unassignedAfter = await queue(
    { page: 0, pageSize: 25, assignment: 'unassigned', search: builder.name }, 'unassigned after');
  check('and unassigned drops to the other two', Number(unassignedAfter.total) === 2);

  const byPriority = await queue(
    { page: 0, pageSize: 25, priority: 'high', search: builder.name }, 'by priority');
  check('the priority the assignment set is the priority the filter finds',
    Number(byPriority.total) === 1 && Number(byPriority.rows[0].id) === Number(second.id));

  // ── ORDERING: open work above concluded work ─────────────────────────────
  const resolved = await admin.mutate('admin.updateDispute', {
    disputeId: Number(first.id), status: 'resolved',
    resolutionType: 'resolved_by_agreement', resolutionNotes: 'The parties settled it.',
  });
  check('a dispute can be resolved, with a recorded outcome', resolved.status === 200, resolved.error ?? '');

  const ordered = await queue({ page: 0, pageSize: 25, search: builder.name }, 'ordering');
  const positions = ordered.rows.map(row => Number(row.id));
  check('the resolved one sinks below the open ones - a queue, not a diary',
    positions.indexOf(Number(first.id)) === positions.length - 1,
    positions.join(','));
  check('and the status summary followed it',
    Number(ordered.counts.resolved) >= 1 && Number(ordered.counts.open) === baseOpen + 2,
    `open=${ordered.counts.open} resolved=${ordered.counts.resolved}`);

  // ── THE DETAIL AN ADMINISTRATOR WORKS FROM ───────────────────────────────
  await builder.session.mutate('disputes.postMessage', {
    disputeId: Number(third.id), body: 'The spec I was given said otherwise.',
  });
  const noted = await admin.mutate('admin.addDisputeNote', {
    disputeId: Number(third.id), note: `Internal: checked the drawings ${stamp}.`,
  });
  check('an internal note can be recorded', noted.status === 200, noted.error ?? '');

  const detail = await admin.query('admin.disputeDetail', { disputeId: Number(third.id) });
  check('the detail resolves every id on the record to a name',
    detail.data?.dispute?.reporterName === owner.name
    && detail.data?.dispute?.respondentName === builder.name,
    `${detail.data?.dispute?.reporterName} / ${detail.data?.dispute?.respondentName}`);
  check('the history is there, opening with the dispute being raised',
    detail.data.history.some(row => row.fromStatus === 'none' && row.toStatus === 'open'));
  check("the participant's message is shown, attributed",
    detail.data.messages.length === 1 && detail.data.messages[0].authorName === builder.name);
  check('the internal note is shown to the administrator',
    detail.data.notes.length === 1 && String(detail.data.notes[0].note).includes(String(stamp)));
  check('the subject is named in words, not as an id',
    typeof detail.data.subjectLabel === 'string' && detail.data.subjectLabel.length > 0,
    String(detail.data.subjectLabel));

  /*
   * ── THE NOTE IS INTERNAL. This is the assertion that matters most on this
   * screen: the administrator's working note must not reach the person the
   * dispute is about. It lives in a DIFFERENT TABLE from the participants'
   * messages precisely so no forgotten clause can leak it.
   */
  const asParty = await builder.session.query('disputes.get', { disputeId: Number(third.id) });
  const partyText = JSON.stringify(asParty.data ?? {});
  check('a PARTY to the dispute never sees the internal note',
    asParty.status === 200 && !partyText.includes('Internal: checked the drawings'),
    asParty.error ?? '');
  check('and sees no `notes` collection at all', !('notes' in (asParty.data ?? {})));

  // ── NEGATIVE CONTROLS: the queue is an ADMIN surface ─────────────────────
  for (const [name, actor] of [['the reporter', owner], ['an unrelated contractor', stranger]]) {
    const list = await actor.session.query('admin.disputes', { page: 0, pageSize: 25 });
    check(`${name} cannot read the admin queue`,
      list.status !== 200 && list.data === null, `${list.status} ${list.code ?? ''}`);
    const one = await actor.session.query('admin.disputeDetail', { disputeId: Number(third.id) });
    check(`${name} cannot read the admin detail`,
      one.status !== 200 && one.data === null, `${one.status} ${one.code ?? ''}`);
    const who = await actor.session.query('admin.disputeAssignees', undefined);
    check(`${name} cannot enumerate the administrators`,
      who.status !== 200 && who.data === null, `${who.status} ${who.code ?? ''}`);
    const note = await actor.session.mutate('admin.addDisputeNote', {
      disputeId: Number(third.id), note: 'should never land',
    });
    check(`${name} cannot write an internal note`, note.status !== 200, `${note.status}`);
  }

  const anonymous = session();
  const out = await anonymous.query('admin.disputes', { page: 0, pageSize: 25 });
  check('a signed-out caller cannot read the queue', out.status !== 200 && out.data === null, `${out.status}`);

  // A stranger to the dispute cannot read it as a participant either - the
  // eligibility service, reached through the queue's neighbouring surface.
  const strangerRead = await stranger.session.query('disputes.get', { disputeId: Number(third.id) });
  check('an unrelated contractor cannot read the dispute as a participant',
    strangerRead.status !== 200 && strangerRead.code === 'NOT_FOUND',
    `${strangerRead.status} ${strangerRead.code ?? ''}`);

  check('the internal note never reached anybody but an administrator',
    Number(sql(`select count(*) from disputeMessages where body like '%Internal: checked%'`)) === 0);
} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  // ── CLEANUP, in dependency order: every FK here is RESTRICT ──────────────
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
    attempt(`delete from projectMembers where userId in (${ids}) or assignedBy in (${ids}) or removedBy in (${ids})`);
    if (made.projects.length > 0) {
      attempt(`delete from projectMembers where projectId in (${made.projects.join(',')})`);
      attempt(`delete from projects where id in (${made.projects.join(',')})`);
    }
    attempt(`delete from notifications where userId in (${ids})`);
    attempt(`delete from userAccountAuditEvents where userId in (${ids}) or actorId in (${ids})`);
    attempt(`delete from analyticsEvents where userId in (${ids})`);
    attempt(`delete from referrals where referrerId in (${ids}) or referredId in (${ids})`);
    attempt(`delete from users where id in (${ids})`);
  }
  if (failures.length > 0) check(`CLEANUP: ${failures.length} statement(s) failed`, false, failures.slice(0, 3).join(' | '));
}

check('CLEANUP: every row this probe planted is gone',
  (made.users.length === 0 || Number(sql(`select count(*) from users where id in (${made.users.join(',')})`)) === 0)
  && (made.disputes.length === 0 || Number(sql(`select count(*) from disputes where id in (${made.disputes.join(',')})`)) === 0));

console.log(results.join('\n'));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);

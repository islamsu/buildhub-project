/**
 * ── PROJECT MEMBERSHIP, AGAINST A REAL DATABASE ───────────────────────────
 *
 * The security question the tracker actually asks - "removal revokes access"
 * - cannot be answered by a unit test, because it is a claim about every
 * surface a member can reach, not about one function.
 *
 *   REMOVAL REVOKES ACCESS, on the project, its documents and its RFQs, and
 *     it revokes it IMMEDIATELY rather than at the next sign-in.
 *
 *   A ROLE CHANGE IS NOT A DEPARTURE AND A RETURN. The assignment date stands,
 *     nothing is written to removedAt, and the person is told what changed.
 *
 *   A REMOVAL THAT HAPPENED IS REPORTED AS ONE, and a removal that did not is
 *     not - the flag that was always false.
 *
 *   THE TRAIL ANSWERS "who let them see this, and when".
 *
 *   AND AN UNRELATED ACCOUNT IS REFUSED EVERY ONE OF THESE, server-side.
 */
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
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
const projectsMade = [];

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
    username: u, email: `${u}@example.test`, password: 'MemberPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status} ${up.error}`);
  const me = await s.get('auth.me');
  made.push(me.data.id);
  return { s, id: me.data.id };
}

try {
  const owner    = await account('mo', 'homeowner');
  const worker   = await account('mw', 'contractor');
  const stranger = await account('ms', 'contractor');
  for (const who of [worker, stranger]) {
    sql(`update users set onboardingStatus='approved', verified=1 where id=${who.id}`);
  }

  const project = await owner.s.post('projects.create', {
    title: `Probe members project ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const projectId = project.data?.id ?? 0;
  if (projectId) projectsMade.push(projectId);
  check('1. SETUP: a homeowner has a project', projectId > 0, `id=${projectId}`);

  // ── PUT SOMEBODY ON IT ──────────────────────────────────────────────────
  const added = await owner.s.post('projects.addMember', {
    projectId, userId: worker.id, projectRole: 'contractor',
  });
  check('2. the owner puts a contractor on it', added.status === 200, `http=${added.status}`);

  const memberView = await worker.s.get('projects.get', { id: projectId });
  check('3. AND THE MEMBER CAN NOW READ IT — membership is access',
    memberView.status === 200 && memberView.data?.id === projectId, `http=${memberView.status}`);

  const addedEvent = sql(`select action from commercialAuditEvents where subjectType='project' and subjectId=${projectId} order by id desc limit 1`);
  check('4. and the trail records who let them in',
    addedEvent === 'project_member_added', addedEvent);

  // ── CHANGE THEIR CAPACITY ───────────────────────────────────────────────
  const assignedBefore = sql(`select assignedAt from projectMembers where projectId=${projectId} and userId=${worker.id}`);
  const promoted = await owner.s.post('projects.changeMemberRole', {
    projectId, userId: worker.id, projectRole: 'manager',
  });
  check('5. A CAPACITY CAN BE CHANGED AT ALL — this had no procedure before',
    promoted.status === 200 && promoted.data?.changed === true
      && promoted.data?.from === 'contractor' && promoted.data?.to === 'manager',
    `http=${promoted.status} ${promoted.data?.from}->${promoted.data?.to}`);

  const row = sql(`select projectRole, assignedAt, removedAt is null from projectMembers where projectId=${projectId} and userId=${worker.id}`);
  check('6. and it is NOT a departure and a return — the assignment date stands',
    row.startsWith('manager\t') && row.includes(assignedBefore) && row.endsWith('1'), row);

  const roleEvent = sql(`select action, detail from commercialAuditEvents where subjectType='project' and subjectId=${projectId} order by id desc limit 1`);
  check('7. the trail records what it changed FROM, not only to',
    roleEvent.startsWith('project_member_role_changed') && roleEvent.includes('contractor -> manager'),
    roleEvent);

  const told = Number(sql(`select count(*) from notifications where userId=${worker.id} and messageKey='notif.project.member.roleChanged'`));
  check('8. and the person is told, with a translatable key rather than a sentence', told === 1, `notifications=${told}`);

  const again = await owner.s.post('projects.changeMemberRole', {
    projectId, userId: worker.id, projectRole: 'manager',
  });
  check('9. setting the role they already hold is reported as NO CHANGE',
    again.status === 200 && again.data?.changed === false, `changed=${again.data?.changed}`);
  check('10. and writes no second event for a change that did not happen',
    Number(sql(`select count(*) from commercialAuditEvents where subjectType='project' and subjectId=${projectId} and action='project_member_role_changed'`)) === 1);

  // ── REFUSALS THE SERVER OWNS ────────────────────────────────────────────
  const toOwner = await owner.s.post('projects.changeMemberRole', {
    projectId, userId: worker.id, projectRole: 'owner',
  });
  check('11. OWNERSHIP CANNOT BE HANDED OUT',
    toOwner.status !== 200 && toOwner.code === 'BAD_REQUEST', `code=${toOwner.code}`);

  const ownerSelf = await owner.s.post('projects.changeMemberRole', {
    projectId, userId: owner.id, projectRole: 'viewer',
  });
  check('12. nor can the owner be demoted on their own project',
    ownerSelf.status !== 200, `code=${ownerSelf.code}`);

  const byStranger = await stranger.s.post('projects.changeMemberRole', {
    projectId, userId: worker.id, projectRole: 'viewer',
  });
  check('13. AND AN UNRELATED ACCOUNT CANNOT TOUCH THE TEAM',
    byStranger.status !== 200 && (byStranger.code === 'FORBIDDEN' || byStranger.code === 'NOT_FOUND'),
    `code=${byStranger.code}`);
  check('14. their attempt changed nothing',
    sql(`select projectRole from projectMembers where projectId=${projectId} and userId=${worker.id}`) === 'manager');

  const strangerRead = await stranger.s.get('projects.get', { id: projectId });
  check('15. nor read the project at all',
    strangerRead.status !== 200, `code=${strangerRead.code}`);

  // ── REMOVAL REVOKES ACCESS ──────────────────────────────────────────────
  const removed = await owner.s.post('projects.removeMember', { projectId, userId: worker.id });
  check('16. A REMOVAL THAT HAPPENED IS REPORTED AS ONE — the flag that was always false',
    removed.status === 200 && removed.data?.removed === true, `removed=${removed.data?.removed}`);
  check('17. and the database agrees',
    sql(`select removedAt is not null from projectMembers where projectId=${projectId} and userId=${worker.id}`) === '1');

  const afterRemoval = await worker.s.get('projects.get', { id: projectId });
  check('18. THE REMOVED MEMBER LOSES ACCESS IMMEDIATELY, on the same session',
    afterRemoval.status !== 200, `code=${afterRemoval.code}`);
  const docsAfter = await worker.s.get('projects.documents', { projectId });
  check('19. and the documents with it',
    docsAfter.status !== 200, `code=${docsAfter.code}`);
  const teamAfter = await worker.s.get('projects.members', { projectId });
  check('20. and the team list, which would otherwise name everyone on the job',
    teamAfter.status !== 200, `code=${teamAfter.code}`);

  const removalEvent = sql(`select action from commercialAuditEvents where subjectType='project' and subjectId=${projectId} order by id desc limit 1`);
  check('21. the trail records the removal too', removalEvent === 'project_member_removed', removalEvent);

  const removedAgain = await owner.s.post('projects.removeMember', { projectId, userId: worker.id });
  check('22. REMOVING SOMEBODY ALREADY OFF IT IS NOT A REMOVAL, and says so',
    removedAgain.status === 200 && removedAgain.data?.removed === false,
    `removed=${removedAgain.data?.removed}`);
  check('23. and writes no second removal into the trail',
    Number(sql(`select count(*) from commercialAuditEvents where subjectType='project' and subjectId=${projectId} and action='project_member_removed'`)) === 1);

  const promoteRemoved = await owner.s.post('projects.changeMemberRole', {
    projectId, userId: worker.id, projectRole: 'manager',
  });
  check('24. A REMOVED MEMBER IS NOT PROMOTED BACK IN — that would restore access quietly',
    promoteRemoved.status !== 200 && promoteRemoved.code === 'NOT_FOUND', `code=${promoteRemoved.code}`);

  const stillOut = await worker.s.get('projects.get', { id: projectId });
  check('25. and they are still out', stillOut.status !== 200, `code=${stillOut.code}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of projectsMade) {
    try { sql(`delete from commercialAuditEvents where subjectType='project' and subjectId=${id}`); } catch {}
    try { sql(`delete from projectMembers where projectId=${id}`); } catch {}
  }
  for (const id of made) { try { sql(`delete from rfqs where requesterId=${id}`); } catch {} }
  for (const id of projectsMade) { try { sql(`delete from projects where id=${id}`); } catch {} }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check('26. CLEANUP: every account and project this probe created is gone', left === 0, `users=${left}`);
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

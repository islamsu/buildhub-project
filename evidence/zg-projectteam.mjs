// ── LIVE: the project team, and the capability matrix it enforces ───────────
//
// PM-A5. The unit suite proves the MATRIX (shared/projectAccess.ts) and the
// membership resolver in isolation. Three things it structurally cannot prove,
// and they are the three this probe exists for:
//
//   THE SOFT REMOVAL. `removeMember` sets `removedAt` rather than deleting,
//     and every read filters on `isNull(removedAt)`. That filter lives in a
//     WHERE clause; a fake that returns a fixed array cannot tell a working
//     filter from a missing one. It is only testable where the WHERE is real.
//
//   THE CAPABILITY MATRIX AS THE SERVER APPLIES IT. `capabilitiesFor` being
//     correct is not the same claim as the router refusing a contractor who
//     tries to manage the team. One is a pure function, the other is a
//     request that must come back 403.
//
//   THE NON-MEMBER. Someone with no row at all must not read the project.
//     That is the whole security content of membership, and it is an absence
//     the unit double cannot represent.
//
// Every account is registered through the real form and every call goes over
// HTTP as that account. Nothing is seeded straight into projectMembers, so a
// row only exists if the product put it there.
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

let projectId = 0;
let otherProjectId = 0;

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const owner = await account('ptow', 'homeowner');

  const manager = await account('ptpm', 'project_manager');
  sql(`update users set onboardingStatus='approved' where id=${manager.id}`);

  const contractor = await account('ptct', 'contractor');
  sql(`update users set onboardingStatus='approved' where id=${contractor.id}`);

  const viewer = await account('ptvw', 'homeowner');

  // NEVER added to the project. The negative control that matters most.
  const stranger = await account('ptst', 'contractor');
  sql(`update users set onboardingStatus='approved' where id=${stranger.id}`);

  // A second owner with their own project, for the cross-project check.
  const rival = await account('ptrv', 'homeowner');

  // ── The project ─────────────────────────────────────────────────────────
  const created = await call(owner, 'projects.create', {
    title: `Team probe ${stamp}`, description: 'Live project-team probe', budget: 400000,
    location: 'Cairo', category: 'residential',
  });
  projectId = created.data?.id ?? Number(sql(`select id from projects where ownerId=${owner.id} order by id desc limit 1`));
  check('SETUP: the owner created a project', Number.isInteger(projectId) && projectId > 0, `projectId=${projectId}`);

  const rivalCreated = await call(rival, 'projects.create', {
    title: `Rival probe ${stamp}`, description: 'A project the cast is not on', budget: 100000,
    location: 'Giza', category: 'residential',
  });
  otherProjectId = rivalCreated.data?.id ?? Number(sql(`select id from projects where ownerId=${rival.id} order by id desc limit 1`));
  check('SETUP: a second, unrelated project exists', otherProjectId > 0 && otherProjectId !== projectId,
    `otherProjectId=${otherProjectId}`);

  // ── 1-4. The owner's own view ───────────────────────────────────────────
  const ownerView = await query(owner, 'projects.members', { projectId });
  check('1. the owner can read the team', ownerView.status === 200, `http=${ownerView.status}`);
  check('2. the owner is recorded as the owner, not merely as the creator',
    ownerView.data?.myProjectRole === 'owner', `role=${ownerView.data?.myProjectRole}`);
  check('3. the owner holds every capability, from the matrix rather than a literal',
    ['read', 'report', 'finance', 'manage', 'commercial'].every(c => (ownerView.data?.myCapabilities ?? []).includes(c)),
    `caps=${JSON.stringify(ownerView.data?.myCapabilities)}`);
  check('4. the team list names a person, not a raw id',
    (ownerView.data?.members ?? []).every(m => typeof m.name === 'string' && m.name.length > 0),
    `members=${(ownerView.data?.members ?? []).length}`);

  // ── 5-8. Adding members, and what the database actually holds ───────────
  const addManager = await call(owner, 'projects.addMember', { projectId, userId: manager.id, projectRole: 'manager' });
  check('5. the owner can add a manager', addManager.status === 200, `http=${addManager.status} err=${String(addManager.error).slice(0, 60)}`);
  const managerRow = sql(`select projectRole from projectMembers where projectId=${projectId} and userId=${manager.id} and removedAt is null`);
  check('6. the manager row is real in the database', managerRow === 'manager', `role=${managerRow}`);

  const addContractor = await call(owner, 'projects.addMember', { projectId, userId: contractor.id, projectRole: 'contractor' });
  check('7. the owner can add a contractor', addContractor.status === 200, `http=${addContractor.status}`);
  const addViewer = await call(owner, 'projects.addMember', { projectId, userId: viewer.id, projectRole: 'viewer' });
  check('8. the owner can add a viewer', addViewer.status === 200, `http=${addViewer.status}`);

  // ── 9-10. Ownership is not assignable ───────────────────────────────────
  const assignOwner = await call(owner, 'projects.addMember', { projectId, userId: stranger.id, projectRole: 'owner' });
  check('9. NEGATIVE: ownership cannot be handed out through addMember',
    assignOwner.status !== 200, `http=${assignOwner.status}`);
  const strangerRows = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${stranger.id}`);
  check('10. the refused assignment wrote NOTHING - a refusal that still inserts is not a refusal',
    strangerRows === '0', `rows=${strangerRows}`);

  // ── 11-14. The matrix, as the SERVER applies it ─────────────────────────
  const managerView = await query(manager, 'projects.members', { projectId });
  check('11. the manager reads the team and is told they may manage',
    managerView.status === 200 && (managerView.data?.myCapabilities ?? []).includes('manage'),
    `caps=${JSON.stringify(managerView.data?.myCapabilities)}`);

  const contractorView = await query(contractor, 'projects.members', { projectId });
  check('12. the contractor can READ the team', contractorView.status === 200, `http=${contractorView.status}`);
  check('13. the contractor is NOT told they may manage',
    !(contractorView.data?.myCapabilities ?? []).includes('manage'),
    `caps=${JSON.stringify(contractorView.data?.myCapabilities)}`);

  // The claim that matters: not what the payload says, but what the server does.
  const contractorAdds = await call(contractor, 'projects.addMember', { projectId, userId: stranger.id, projectRole: 'viewer' });
  check('14. NEGATIVE: the contractor CANNOT add a member - hiding the button is not the control',
    contractorAdds.status !== 200, `http=${contractorAdds.status}`);

  const viewerAdds = await call(viewer, 'projects.addMember', { projectId, userId: stranger.id, projectRole: 'viewer' });
  check('15. NEGATIVE: the viewer cannot add a member either', viewerAdds.status !== 200, `http=${viewerAdds.status}`);

  // ── 16-17. The non-member ───────────────────────────────────────────────
  const strangerRead = await query(stranger, 'projects.members', { projectId });
  check('16. NEGATIVE: a non-member cannot read the team at all', strangerRead.status !== 200, `http=${strangerRead.status}`);
  const strangerSelfAdd = await call(stranger, 'projects.addMember', { projectId, userId: stranger.id, projectRole: 'manager' });
  check('17. NEGATIVE: a non-member cannot add THEMSELVES', strangerSelfAdd.status !== 200, `http=${strangerSelfAdd.status}`);

  // ── 18-19. Cross-project isolation ──────────────────────────────────────
  const crossRead = await query(manager, 'projects.members', { projectId: otherProjectId });
  check('18. NEGATIVE: managing project A grants nothing on project B',
    crossRead.status !== 200, `http=${crossRead.status}`);
  const crossAdd = await call(manager, 'projects.addMember', { projectId: otherProjectId, userId: manager.id, projectRole: 'manager' });
  check('19. NEGATIVE: nor can they add themselves to project B', crossAdd.status !== 200, `http=${crossAdd.status}`);

  // ── 20-23. THE SOFT REMOVAL, which is why this probe is live ────────────
  const removeContractor = await call(owner, 'projects.removeMember', { projectId, userId: contractor.id });
  check('20. the owner can remove the contractor', removeContractor.status === 200, `http=${removeContractor.status}`);

  const stillThere = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${contractor.id}`);
  const removedAt = sql(`select removedAt is not null from projectMembers where projectId=${projectId} and userId=${contractor.id}`);
  check('21. removal is SOFT - the row survives so the history survives with it',
    stillThere === '1', `rows=${stillThere}`);
  check('22. and it is stamped removed rather than merely orphaned', removedAt === '1', `removedAt set=${removedAt}`);

  const removedRead = await query(contractor, 'projects.members', { projectId });
  check('23. NEGATIVE: the removed contractor immediately loses access - the WHERE clause is real',
    removedRead.status !== 200, `http=${removedRead.status}`);

  // ── 24-25. Re-adding, and the owner who cannot be removed ───────────────
  const readd = await call(owner, 'projects.addMember', { projectId, userId: contractor.id, projectRole: 'engineer' });
  check('24. a removed member can be brought back, in a new role', readd.status === 200, `http=${readd.status}`);
  const liveRows = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${contractor.id} and removedAt is null`);
  const liveRole = sql(`select projectRole from projectMembers where projectId=${projectId} and userId=${contractor.id} and removedAt is null`);
  check('25. re-adding reactivates ONE row rather than stacking a duplicate',
    liveRows === '1' && liveRole === 'engineer', `live=${liveRows} role=${liveRole}`);

  const removeOwner = await call(owner, 'projects.removeMember', { projectId, userId: owner.id });
  check('26. NEGATIVE: the owner cannot be removed from their own project',
    removeOwner.status !== 200, `http=${removeOwner.status}`);
  const ownerStillLive = sql(`select count(*) from projectMembers where projectId=${projectId} and userId=${owner.id} and removedAt is null`);
  check('27. and the owner is still on the team afterwards', ownerStillLive === '1', `rows=${ownerStillLive}`);

  // ── 28. Zero fabrication ────────────────────────────────────────────────
  const finalView = await query(owner, 'projects.members', { projectId });
  const dbLive = Number(sql(`select count(*) from projectMembers where projectId=${projectId}`));
  check('28. the team the API returns is exactly the team the database holds',
    (finalView.data?.members ?? []).length === dbLive,
    `api=${(finalView.data?.members ?? []).length} db=${dbLive}`);

} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  for (const id of [projectId, otherProjectId]) {
    if (!id) continue;
    for (const q of [
      `delete from projectMembers where projectId=${id}`,
      `delete from rfqs where projectId=${id}`,
      `delete from projects where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from projectMembers where userId=${id} or assignedBy=${id} or removedBy=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from rfqs where requesterId=${id}`,
      `delete from projects where ownerId=${id} or createdBy=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from commercialAuditEvents where actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftoverUsers = made.length ? sql(`select count(*) from users where id in (${made.join(',')})`) : '0';
  console.log(results.join('\n'));
  console.log(`\nCLEANUP: ${leftoverUsers} probe users left behind (must be 0)`);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 && leftoverUsers === '0' ? 0 : 1);
}

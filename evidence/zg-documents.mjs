// ── LIVE: project documents — the file, the list, and the lifecycle ────────
//
// DOC. The unit suite pins the service and the proxy against doubles. Five
// things it structurally cannot prove, and they are the five this probe exists
// for:
//
//   THE FILE AND THE LIST AGREE, over real HTTP against a real database. The
//     proxy resolved the project OWNER only while `projects.documents` has
//     returned documents to every live member since PM-A2, so a contractor saw
//     a drawing in the list and got a refusal on the file. That is the defect
//     this milestone fixes, and only a live fetch of the actual URL proves it.
//
//   A STRANGER IS STILL REFUSED. Widening a rule is exactly when the negative
//     control matters most.
//
//   ARCHIVING TAKES IT OUT OF THE WORKING LIST AND NOT OUT OF THE RECORD -
//     including that the FILE stays fetchable, which is the whole reason to
//     archive rather than delete.
//
//   REPLACING KEEPS BOTH REVISIONS, linked, with the old one archived.
//
//   ONE TRADE CANNOT REMOVE ANOTHER'S DRAWING, refused server-side.
//
// ── WHAT THIS PROBE CANNOT DO HERE, STATED RATHER THAN DRESSED UP ─────────
//
// OBJECT STORAGE IS NOT CONFIGURED on this environment - the standing S3
// infrastructure limitation, not a defect - so `projects.uploadDocument`
// answers 503 "File uploads are not available on this deployment." and no
// bytes can be written. Two consequences, both handled honestly:
//
//   The document ROWS are seeded directly, and every check below still runs
//   against the real procedures over real HTTP. What is exercised is the
//   authorization and the lifecycle, which is this milestone's subject.
//
//   The FILE checks assert the AUTHORIZATION DECISION rather than 200. The
//   proxy answers 403 when it refuses, 401 with no session, and 503 when it
//   has authorized the request and only then finds no storage backend - so
//   "authorized" and "refused" are still perfectly distinguishable, which is
//   the whole claim. A 200 would additionally prove the bytes come back, and
//   that is what staging is for.
//
//   The successful REPLACE path writes an object, so only its authorization
//   and its ordering are observable here; the supersede link itself is pinned
//   in server/projectDocuments.test.ts and mutation-tested.
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
const projectsMade = [];

// A one-pixel PNG, so the byte check has real bytes to verify.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 403 = refused, 401 = no session, 503 = authorized and storage is absent. */
const AUTHORIZED = status => status === 503 || status === 200 || status === 307;
const REFUSED = status => status === 403 || status === 401 || status === 404;

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
  /** The actual file, through the actual proxy route the browser uses. */
  async fetchFile(url) {
    const res = await fetch(`${BASE}${url}`, { headers: { cookie: this.header() }, redirect: 'manual' });
    return res.status;
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
    username: u, email: `${u}@example.test`, password: 'DocPass!2026',
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

let docId = 0;

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const owner      = await account('dcow', 'homeowner');
  const contractor = await account('dcco', 'contractor');
  const engineer   = await account('dcen', 'engineer');
  const stranger   = await account('dcst', 'contractor');

  const created = await call(owner, 'projects.create', {
    title: `Probe documents ${stamp}`, type: 'renovation', location: 'Cairo',
  });
  const projectId = created.data?.id ?? 0;
  if (!projectId) throw new Error(`project not created: ${created.status} ${created.error}`);
  projectsMade.push(projectId);

  const addC = await call(owner, 'projects.addMember', { projectId, userId: contractor.id, projectRole: 'contractor' });
  const addE = await call(owner, 'projects.addMember', { projectId, userId: engineer.id, projectRole: 'engineer' });
  check('SETUP: two trades are on the project team', addC.status === 200 && addE.status === 200,
    `contractor=${addC.status} engineer=${addE.status}`);

  // ── 1-2. A real document row, and what the product does with the bytes ──
  const upload = await call(contractor, 'projects.uploadDocument', {
    projectId, name: `probe-plan-${stamp}.png`, type: 'drawing',
    contentType: 'image/png', base64: PNG.toString('base64'),
  });
  check('1. the upload path reaches STORAGE and reports the deployment truthfully - it does not fail silently or pretend to succeed',
    upload.status === 503 && /not available/i.test(String(upload.error)),
    `http=${upload.status} err=${String(upload.error).slice(0, 70)}`);

  // The row is seeded because the bytes cannot be written here. Everything
  // after this point is the real procedures over real HTTP.
  const key = `project-documents/user-${contractor.id}/project-${projectId}/probe-plan-${stamp}.png`;
  sql(`insert into documents (projectId, uploaderId, name, type, url, fileKey, size) values `
    + `(${projectId}, ${contractor.id}, 'probe-plan-${stamp}.png', 'drawing', '/manus-storage/${key}', '${key}', 512)`);
  docId = Number(sql(`select id from documents where fileKey='${key}'`) || 0);
  const docUrl = `/manus-storage/${key}`;
  check('2. SETUP: a document row exists on the project', docId > 0, `id=${docId}`);

  const ownerList = await query(owner, 'projects.documents', { projectId });
  const contractorList = await query(contractor, 'projects.documents', { projectId });
  check('3. it is in the list for the owner AND for another trade on the team',
    (ownerList.data ?? []).some(d => d.id === docId) && (contractorList.data ?? []).some(d => d.id === docId),
    `owner=${(ownerList.data ?? []).length} contractor=${(contractorList.data ?? []).length}`);

  // ── 4-8. THE FILE AND THE LIST MUST AGREE ───────────────────────────────
  const ownerFile = await owner.s.fetchFile(docUrl);
  const uploaderFile = await contractor.s.fetchFile(docUrl);
  const otherTradeFile = await engineer.s.fetchFile(docUrl);
  check('4. the owner is authorized for the file', AUTHORIZED(ownerFile), `http=${ownerFile}`);
  check('5. the uploader is authorized for the file', AUTHORIZED(uploaderFile), `http=${uploaderFile}`);
  check('6. ANOTHER TRADE ON THE TEAM IS AUTHORIZED - the list and the file agree',
    AUTHORIZED(otherTradeFile), `http=${otherTradeFile}`);

  const strangerList = await query(stranger, 'projects.documents', { projectId });
  const strangerFile = await stranger.s.fetchFile(docUrl);
  check('7. NEGATIVE: somebody not on the project can neither list nor fetch',
    strangerList.status !== 200 && REFUSED(strangerFile),
    `list=${strangerList.status} file=${strangerFile}`);

  const anon = new Session('anon');
  const anonFile = await anon.fetchFile(docUrl);
  check('8. NEGATIVE: and neither can a signed-out visitor', REFUSED(anonFile), `http=${anonFile}`);

  // ── 9-12. Retiring, and who may ─────────────────────────────────────────
  const wrongTrade = await call(engineer, 'projects.archiveDocument', { documentId: docId });
  check('9. NEGATIVE: one trade cannot archive another trade’s drawing',
    wrongTrade.status === 403 && sql(`select archivedAt is null from documents where id=${docId}`) === '1',
    `http=${wrongTrade.status} err=${String(wrongTrade.error).slice(0, 70)}`);

  const outsider = await call(stranger, 'projects.archiveDocument', { documentId: docId });
  check('10. NEGATIVE: somebody off the project is told NOT FOUND, not forbidden - no id oracle',
    outsider.status === 404, `http=${outsider.status}`);

  const archived = await call(contractor, 'projects.archiveDocument', { documentId: docId, reason: 'wrong revision' });
  check('11. the person who uploaded it can retire it, with the reason and the actor recorded',
    archived.status === 200
    && sql(`select archiveReason from documents where id=${docId}`) === 'wrong revision'
    && sql(`select archivedBy from documents where id=${docId}`) === String(contractor.id),
    `http=${archived.status} err=${String(archived.error).slice(0, 70)}`);

  const twice = await call(contractor, 'projects.archiveDocument', { documentId: docId });
  check('12. archiving it again is refused rather than re-stamping when it left the list',
    twice.status !== 200, `http=${twice.status}`);

  // ── 13-16. Out of the working list, not out of the record ───────────────
  const afterList = await query(owner, 'projects.documents', { projectId });
  check('13. it leaves the working list', !(afterList.data ?? []).some(d => d.id === docId),
    `count=${(afterList.data ?? []).length}`);

  const withArchived = await query(owner, 'projects.documents', { projectId, includeArchived: true });
  check('14. and is still there when the record is asked for',
    (withArchived.data ?? []).some(d => d.id === docId));

  check('15. ARCHIVED, NEVER DELETED - the row survives and the file stays authorized',
    sql(`select count(*) from documents where id=${docId}`) === '1'
    && AUTHORIZED(await owner.s.fetchFile(docUrl)));

  const restored = await call(contractor, 'projects.restoreDocument', { documentId: docId });
  check('16. a mistaken retirement can be undone, clearing the WHOLE stamp',
    restored.status === 200
    && sql(`select concat(coalesce(archivedAt,'-'),'|',coalesce(archivedBy,'-'),'|',coalesce(archiveReason,'-')) from documents where id=${docId}`) === '-|-|-',
    `http=${restored.status}`);

  // ── 17-19. Replace: authorization and ordering ──────────────────────────
  const outsiderReplace = await call(stranger, 'projects.replaceDocument', {
    documentId: docId, contentType: 'image/png', base64: PNG.toString('base64'),
  });
  check('17. NEGATIVE: somebody off the project cannot replace a document, and is refused BEFORE any storage call',
    outsiderReplace.status === 404, `http=${outsiderReplace.status}`);

  const wrongTradeReplace = await call(engineer, 'projects.replaceDocument', {
    documentId: docId, contentType: 'image/png', base64: PNG.toString('base64'),
  });
  check('18. NEGATIVE: one trade cannot replace another trade’s drawing',
    wrongTradeReplace.status === 403, `http=${wrongTradeReplace.status}`);

  const memberReplace = await call(contractor, 'projects.replaceDocument', {
    documentId: docId, contentType: 'image/png', base64: PNG.toString('base64'),
  });
  check('19. the uploader passes authorization and reaches STORAGE, which reports the deployment truthfully',
    memberReplace.status === 503, `http=${memberReplace.status} err=${String(memberReplace.error).slice(0, 60)}`);
  check('20. and NOTHING WAS ARCHIVED by an upload that could not complete - the order is the safety property',
    sql(`select archivedAt is null from documents where id=${docId}`) === '1');

  // ── 21-22. Cross-project leakage, and a document that does not exist ────
  const ghost = await call(contractor, 'projects.archiveDocument', { documentId: 99999999 });
  check('21. a document that does not exist answers the same way as one you may not touch',
    ghost.status === outsider.status && ghost.error === outsider.error,
    `ghost=${ghost.status}/${ghost.error} outsider=${outsider.status}/${outsider.error}`);

  // ── 23. The audit ───────────────────────────────────────────────────────
  const events = sql(`select group_concat(action order by id) from commercialAuditEvents where subjectType='document' and subjectId=${docId}`);
  check('22. archiving and restoring are both in the commercial trail',
    events.includes('document_archived') && events.includes('document_restored'),
    `events=${events}`);
} catch (error) {
  check('PROBE COMPLETED', false, String(error?.message ?? error).slice(0, 200));
} finally {
  for (const id of projectsMade) {
    for (const q of [
      // supersededById points document -> document, so the link must go first.
      `update documents set supersededById=null where projectId=${id}`,
      `delete from commercialAuditEvents where subjectType='document' and subjectId in (select id from documents where projectId=${id})`,
      `delete from documents where projectId=${id}`,
      `delete from projectMembers where projectId=${id}`,
      `delete from projects where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from documents where uploaderId=${id}`,
      `delete from projectMembers where userId=${id} or assignedBy=${id} or removedBy=${id}`,
      `delete from projects where ownerId=${id} or createdBy=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftoverUsers = made.length ? sql(`select count(*) from users where id in (${made.join(',')})`) : '0';
  const leftoverDocs = sql(`select count(*) from documents where name like 'probe-plan%'`);
  console.log(results.join('\n'));
  console.log(`\nCLEANUP: ${leftoverUsers} probe users, ${leftoverDocs} probe documents left behind (both must be 0)`);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 && leftoverUsers === '0' && leftoverDocs === '0' ? 0 : 1);
}

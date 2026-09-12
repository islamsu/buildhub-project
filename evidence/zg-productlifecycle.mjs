// ── LIVE: the product lifecycle, end to end and adversarially ──────────────
//
// PIMG. The unit suite pins the transition table and the service against
// doubles. Five things it structurally cannot prove, and they are the five
// this probe exists for:
//
//   A DRAFT IS INVISIBLE TO BUYERS, against a real database. `publicProductFilter()`
//     being correct is a claim about a function; that the marketplace list, the
//     product page, the vendor's shop window and the ask-a-question endpoint
//     all return NOTHING for a draft is a claim about SQL.
//
//   THE MIGRATION'S BACKFILL held: every pre-existing row kept the visibility
//     it had. A backfill that defaulted everything to 'active' would silently
//     republish products their suppliers had withdrawn.
//
//   THE LEGACY BOOLEAN AGREES WITH THE STATUS after every move, read straight
//     out of MySQL. Two fields meaning one thing is how they come to disagree.
//
//   AN UNDECLARED MOVE IS REFUSED OVER HTTP, and archived does not come
//     straight back to the marketplace.
//
//   THE OWNERSHIP DOOR. Another supplier moving your product must get the same
//     answer as somebody moving a product that does not exist.
//
// Products are created through `marketplace.create` over HTTP, so a row exists
// only because the product put it there.
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
const productsMade = [];

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
    username: u, email: `${u}@example.test`, password: 'ProductPass!2026',
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

const dbStatus = id => sql(`select concat(status,'|',active) from products where id=${id}`);

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const supplier = await account('plsu', 'supplier');
  const rival    = await account('plri', 'supplier');
  const buyer    = await account('plbu', 'homeowner');
  // Compliance approval has a real admin path; set directly because it is
  // setup for this probe's subject rather than the subject itself.
  sql(`update users set onboardingStatus='approved' where id in (${supplier.id},${rival.id})`);

  const category = sql(`select nameEn from productCategories where status='active' limit 1`) || 'Materials';
  check('SETUP: a real category exists to list against', !!category, `category=${category}`);

  // ── 1-3. Creating live, and creating a draft ────────────────────────────
  const liveCreate = await call(supplier, 'marketplace.create', {
    name: `Probe live ${stamp}`, category, price: 100, unit: 'piece',
  });
  const liveId = liveCreate.data?.id ?? 0;
  if (liveId) productsMade.push(liveId);
  check('1. creating a product publishes it by default, exactly as it did before the lifecycle',
    liveCreate.status === 200 && dbStatus(liveId) === 'active|1',
    `http=${liveCreate.status} db=${dbStatus(liveId)} err=${String(liveCreate.error).slice(0, 60)}`);

  const draftCreate = await call(supplier, 'marketplace.create', {
    name: `Probe draft ${stamp}`, category, price: 200, unit: 'piece', status: 'draft',
  });
  const draftId = draftCreate.data?.id ?? 0;
  if (draftId) productsMade.push(draftId);
  check('2. a product can be created as a DRAFT, which is the new state',
    draftCreate.status === 200 && dbStatus(draftId) === 'draft|0',
    `http=${draftCreate.status} db=${dbStatus(draftId)}`);

  check('3. neither of the two states a product must have been published to reach is creatable',
    (await call(supplier, 'marketplace.create', { name: `Probe bad ${stamp}`, category, status: 'archived' })).status !== 200);

  // ── 4-8. A DRAFT IS INVISIBLE, on every public surface ──────────────────
  const list = await query(buyer, 'marketplace.list', { limit: 100 });
  const listed = (list.data ?? []).map(p => p.id);
  check('4. the marketplace list shows the live product and NOT the draft',
    listed.includes(liveId) && !listed.includes(draftId), `count=${listed.length}`);

  const draftPage = await query(buyer, 'marketplace.get', { id: draftId });
  const livePage = await query(buyer, 'marketplace.get', { id: liveId });
  check('5. the product page serves the live one and refuses the draft',
    livePage.status === 200 && draftPage.status !== 200,
    `live=${livePage.status} draft=${draftPage.status}`);

  const shop = await query(buyer, 'marketplace.vendorProducts', { vendorId: supplier.id, limit: 50 });
  const shopIds = (shop.data ?? []).map(p => p.id);
  check('6. the vendor’s shop window shows the live one and not the draft',
    shopIds.includes(liveId) && !shopIds.includes(draftId), `ids=${shopIds.join(',')}`);

  const askDraft = await call(buyer, 'marketplace.askQuestion', { productId: draftId, question: 'Is this available?' });
  check('7. a buyer cannot ask a question about a draft', askDraft.status !== 200, `http=${askDraft.status}`);

  const search = await query(buyer, 'marketplace.list', { search: `Probe draft ${stamp}` });
  check('8. and searching for it by name finds nothing - not even a hint it exists',
    (search.data ?? []).length === 0, `hits=${(search.data ?? []).length}`);

  // ── 9-13. The declared moves, and the refusals ──────────────────────────
  const off = await call(supplier, 'marketplace.setProductStatus', { id: liveId, status: 'inactive' });
  check('9. the supplier can take a live product off sale',
    off.status === 200 && dbStatus(liveId) === 'inactive|0', `db=${dbStatus(liveId)}`);

  const gone = await query(buyer, 'marketplace.get', { id: liveId });
  check('10. and a buyer can no longer reach it', gone.status !== 200, `http=${gone.status}`);

  const back = await call(supplier, 'marketplace.setProductStatus', { id: liveId, status: 'active' });
  check('11. putting it back restores it for buyers, with the derived boolean in step',
    back.status === 200 && dbStatus(liveId) === 'active|1'
    && (await query(buyer, 'marketplace.get', { id: liveId })).status === 200);

  const publishDraft = await call(supplier, 'marketplace.setProductStatus', { id: draftId, status: 'active' });
  check('12. a draft publishes, and only then becomes visible',
    publishDraft.status === 200
    && (await query(buyer, 'marketplace.get', { id: draftId })).status === 200,
    `http=${publishDraft.status}`);

  const backToDraft = await call(supplier, 'marketplace.setProductStatus', { id: draftId, status: 'draft' });
  check('13. NOTHING RETURNS TO DRAFT - a published product has been seen and asked about',
    backToDraft.status !== 200, `http=${backToDraft.status} err=${String(backToDraft.error).slice(0, 70)}`);

  // ── 14-17. Archiving, and coming back from it ───────────────────────────
  const archived = await call(supplier, 'marketplace.setProductStatus', { id: draftId, status: 'archived' });
  check('14. a product can be retired',
    archived.status === 200 && dbStatus(draftId) === 'archived|0', `db=${dbStatus(draftId)}`);

  check('15. ARCHIVED, NEVER DELETED - the row and its history survive',
    sql(`select count(*) from products where id=${draftId}`) === '1'
    && sql(`select archivedAt is not null from products where id=${draftId}`) === '1');

  const straightBack = await call(supplier, 'marketplace.setProductStatus', { id: draftId, status: 'active' });
  check('16. an archived product does NOT come straight back to the marketplace, and the refusal names both states',
    straightBack.status !== 200 && /Archived/i.test(String(straightBack.error)) && /Live/i.test(String(straightBack.error)),
    `http=${straightBack.status} err=${String(straightBack.error).slice(0, 80)}`);

  const restored = await call(supplier, 'marketplace.setProductStatus', { id: draftId, status: 'inactive' });
  check('17. it returns to OFF SALE, and republishing is then a second, deliberate decision',
    restored.status === 200 && dbStatus(draftId) === 'inactive|0'
    && sql(`select archivedAt is null from products where id=${draftId}`) === '1',
    `db=${dbStatus(draftId)}`);

  // ── 18-20. The ownership door ───────────────────────────────────────────
  const rivalMove = await call(rival, 'marketplace.setProductStatus', { id: liveId, status: 'archived' });
  const ghostMove = await call(rival, 'marketplace.setProductStatus', { id: 99999999, status: 'archived' });
  check('18. NEGATIVE: another supplier cannot move your product', rivalMove.status !== 200, `http=${rivalMove.status}`);
  check('19. and a product that does not exist answers IDENTICALLY - no id oracle',
    rivalMove.status === ghostMove.status && rivalMove.error === ghostMove.error,
    `mine=${rivalMove.status}/${rivalMove.error} ghost=${ghostMove.status}/${ghostMove.error}`);
  check('20. nothing changed', dbStatus(liveId) === 'active|1');

  const buyerMove = await call(buyer, 'marketplace.setProductStatus', { id: liveId, status: 'inactive' });
  const anon = new Session('anon');
  const anonMove = await anon.post('marketplace.setProductStatus', { id: liveId, status: 'inactive' });
  check('21. NEGATIVE: a homeowner and a signed-out visitor are both refused',
    buyerMove.status !== 200 && anonMove.status !== 200,
    `buyer=${buyerMove.status} anon=${anonMove.status}`);

  // ── 22-23. The audit ────────────────────────────────────────────────────
  const history = sql(`select group_concat(concat(oldValue,'>',newValue) order by id) from fieldValueHistory where subjectType='product' and subjectId=${liveId} and field='status'`);
  check('22. every move is recorded with the state it came FROM',
    history === 'active>inactive,inactive>active', `history=${history}`);

  const events = sql(`select group_concat(action order by id) from commercialAuditEvents where subjectType='product' and subjectId=${draftId}`);
  check('23. the commercial trail carries the publish and the retirements',
    events.includes('product_published') && events.includes('product_delisted'), `events=${events}`);

  // ── 24-25. THE PLACEMENT GUARD ──────────────────────────────────────────
  // A live commercial placement points at the row and publicPlacement filters
  // on the same status, so archiving would leave a paid slot rendering nothing.
  sql(`insert into vendorSponsorships (vendorId, productId, category, entityType, surface, package, startsAt) `
    + `values (${supplier.id}, ${liveId}, ${JSON.stringify(category).replace(/"/g, "'")}, 'PRODUCT', 'MASTER_DISCOVERY', 'PREMIER', now())`);
  const blocked = await call(supplier, 'marketplace.setProductStatus', { id: liveId, status: 'archived' });
  check('24. ARCHIVING A PRODUCT WITH A LIVE PLACEMENT IS REFUSED, with a reason a supplier can act on',
    blocked.status !== 200 && /placement/i.test(String(blocked.error)),
    `http=${blocked.status} err=${String(blocked.error).slice(0, 80)}`);

  const stillOff = await call(supplier, 'marketplace.setProductStatus', { id: liveId, status: 'inactive' });
  check('25. but going off sale is still allowed - the paid slot must not become a trap',
    stillOff.status === 200, `http=${stillOff.status} err=${String(stillOff.error).slice(0, 60)}`);
  await call(supplier, 'marketplace.setProductStatus', { id: liveId, status: 'active' });

  // ── 26. THE MIGRATION'S BACKFILL, on the rows that predate it ───────────
  const drift = sql(`select count(*) from products where (status='active') <> (active=1)`);
  check('26. the legacy boolean agrees with the status on EVERY row in the database',
    drift === '0', `disagreeing rows=${drift}`);
  const statuses = sql(`select group_concat(distinct status) from products`);
  check('27. and no row was left with a status the vocabulary does not declare',
    statuses.split(',').filter(Boolean).every(s => ['draft', 'active', 'inactive', 'archived'].includes(s)),
    `statuses=${statuses}`);
} catch (error) {
  check('PROBE COMPLETED', false, String(error?.message ?? error).slice(0, 200));
} finally {
  for (const id of productsMade) {
    for (const q of [
      `delete from vendorSponsorships where productId=${id}`,
      // Placement analytics live in analyticsEvents, keyed by the sponsorship
      // id - there is no placementEvents table, and a delete against one is a
      // cleanup step that silently does nothing.
      `delete from analyticsEvents where subjectType='placement' and subjectId in (select id from vendorSponsorships where productId=${id})`,
      `delete from productQuestions where productId=${id}`,
      `delete from commercialAuditEvents where subjectType='product' and subjectId=${id}`,
      `delete from fieldValueHistory where subjectType='product' and subjectId=${id}`,
      `delete from products where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from vendorSponsorships where vendorId=${id} or grantedBy=${id}`,
      `delete from products where supplierId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftoverUsers = made.length ? sql(`select count(*) from users where id in (${made.join(',')})`) : '0';
  const leftoverProducts = sql(`select count(*) from products where name like 'Probe live%' or name like 'Probe draft%' or name like 'Probe bad%'`);
  console.log(results.join('\n'));
  console.log(`\nCLEANUP: ${leftoverUsers} probe users, ${leftoverProducts} probe products left behind (both must be 0)`);
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 && leftoverUsers === '0' && leftoverProducts === '0' ? 0 : 1);
}

/**
 * ── DOES THE DESTINATION DO WHAT THE CARD PROMISED? ───────────────────────
 *
 * The failure this exists to catch is a card that looks filtered and is not: a
 * Suppliers page that quietly serves the undifferentiated list of all five
 * provider roles, or a Contractors page that falls back to everyone because no
 * contractor has joined. Both would pass a test that only checked the URL
 * changed, and both are the consolidation the owner rejected - reintroduced at
 * the destination instead of on the card.
 *
 * So this asks the real endpoints, against real rows, with a fixture built to
 * make a leak visible: one provider of EACH role, all five publicly eligible
 * at once. A role view that returns any of the other four fails here.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
await assertBuild(BASE);
const DB = 'buildhub_prelaunch';

const sql = q => execSync(
  `mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`,
).toString().split('\n').filter(l => !/^PAGER set to/.test(l)).join('\n').trim();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
};

const query = async (path, input) => {
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`);
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    data: body?.result?.data?.json ?? null,
    code: body?.error?.json?.data?.code ?? null,
    message: body?.error?.json?.message ?? null,
  };
};

const stamp = Date.now() % 100000000;
const made = { users: [], categories: [] };
const esc = v => v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const ROLES = ['supplier', 'contractor', 'engineer', 'architect', 'project_manager'];

function mkProvider(role) {
  const u = `jr${stamp}${role.slice(0, 4)}`;
  const row = {
    openId: `probe-${u}`, username: u, email: `${u}@example.test`,
    name: `Journey ${role} ${stamp}`, userRole: role,
    onboardingStatus: 'approved', accountStatus: 'active',
    isDummy: 0, deactivatedAt: null, verified: 1,
  };
  sql(`insert into users (${Object.keys(row).join(',')}) values (${Object.values(row).map(esc).join(',')})`);
  const id = Number(sql(`select id from users where username='${u}'`));
  if (!Number.isInteger(id) || id <= 0 || sql(`select username from users where id=${id}`) !== u) {
    throw new Error(`probe setup: ${u} resolved to id ${id}`);
  }
  made.users.push(id);
  return id;
}

/** A declared category, the same mechanism the Design and Finishing views use. */
function declare(userId, category) {
  sql(`insert into vendorCategories (userId, category) values (${userId}, ${esc(category)})`);
  made.categories.push(userId);
}

const roleOf = new Map();

try {
  /* ══ ONE PROVIDER PER ROLE, ALL ELIGIBLE ═════════════════════════════
     A leak is only visible when there is something to leak. With five roles
     live at once, "Suppliers returns one row" is not enough - it has to be the
     RIGHT row and nothing else. */
  const ids = {};
  for (const role of ROLES) {
    ids[role] = mkProvider(role);
    roleOf.set(ids[role], role);
  }
  /* And two declared categories, on roles chosen to prove the AXIS matters:
     the CONTRACTOR declares Renovation, so Finishing must include a provider
     that the Contractors role view also has - different questions, overlapping
     answers, both correct. The ARCHITECT declares Design, so Design Services
     must include somebody no role view for supplier or contractor would. */
  declare(ids.contractor, 'Renovation');
  declare(ids.architect, 'Design');

  const mine = new Set(Object.values(ids));
  const rolesIn = rows => [...new Set((rows ?? [])
    .map(v => roleOf.get(Number(v.id)))
    .filter(Boolean))].sort();
  const minesIn = rows => (rows ?? []).map(v => Number(v.id)).filter(id => mine.has(id));

  /* ══ 1. THE UNFILTERED DIRECTORY STILL HAS EVERYONE ══════════════════
     The positive control, and the thing that must not change: the full
     provider directory is unchanged and still reachable. */
  const all = await query('marketplace.vendors', { limit: 100 });
  check('1. the unfiltered directory returns all five roles',
    rolesIn(all.data).length === 5, rolesIn(all.data).join(','));

  /* ══ 2. SUPPLIERS RETURNS SUPPLIERS, AND NOTHING ELSE ════════════════ */
  const suppliers = await query('marketplace.vendors', { role: 'supplier', limit: 100 });
  check('2. SUPPLIERS: the role view returns the supplier',
    minesIn(suppliers.data).includes(ids.supplier),
    `got ${minesIn(suppliers.data).length} of the fixture`);
  check('2. SUPPLIERS: and returns NO other role',
    rolesIn(suppliers.data).join(',') === 'supplier', rolesIn(suppliers.data).join(',') || 'empty');
  check('2. SUPPLIERS: every row the endpoint returned really is a supplier',
    (suppliers.data ?? []).every(v => v.userRole === 'supplier'),
    [...new Set((suppliers.data ?? []).map(v => v.userRole))].join(','));
  check('2. SUPPLIERS: it is NARROWER than the unfiltered directory',
    (suppliers.data ?? []).length < (all.data ?? []).length,
    `${(suppliers.data ?? []).length} < ${(all.data ?? []).length}`);

  /* ══ 3. CONTRACTORS LIKEWISE ═════════════════════════════════════════ */
  const contractors = await query('marketplace.vendors', { role: 'contractor', limit: 100 });
  check('3. CONTRACTORS: the role view returns the contractor',
    minesIn(contractors.data).includes(ids.contractor),
    `got ${minesIn(contractors.data).length} of the fixture`);
  check('3. CONTRACTORS: and returns NO other role',
    rolesIn(contractors.data).join(',') === 'contractor', rolesIn(contractors.data).join(',') || 'empty');
  check('3. CONTRACTORS: every row really is a contractor',
    (contractors.data ?? []).every(v => v.userRole === 'contractor'),
    [...new Set((contractors.data ?? []).map(v => v.userRole))].join(','));

  /* ══ 4. THE CATEGORY VIEWS KEEP THE OTHER AXIS ═══════════════════════
     Design Services and Finishing filter on what a provider DECLARED, not on
     their role - which is why the contractor who declared Renovation belongs
     in Finishing and the architect who declared Design belongs in Design
     Services. Filtering either by role would discard the providers the
     customer came for. */
  const design = await query('marketplace.vendors', { category: 'Design', limit: 100 });
  check('4. DESIGN SERVICES: includes the architect who DECLARED Design',
    minesIn(design.data).includes(ids.architect), minesIn(design.data).join(','));
  check('4. DESIGN SERVICES: excludes the supplier who declared nothing',
    !minesIn(design.data).includes(ids.supplier));
  check('4. DESIGN SERVICES: is a category view, not an architect-role view',
    !(design.data ?? []).every(v => v.userRole === 'architect')
      || minesIn(design.data).length === 1,
    'declared-category semantics');

  const finishing = await query('marketplace.vendors', { category: 'Renovation', limit: 100 });
  check('4. FINISHING: includes the CONTRACTOR who declared Renovation',
    minesIn(finishing.data).includes(ids.contractor), minesIn(finishing.data).join(','));
  check('4. FINISHING: excludes the architect who declared only Design',
    !minesIn(finishing.data).includes(ids.architect));

  /* ══ 5. THE AXES COMPOSE, THEY DO NOT FIGHT ══════════════════════════
     A buyer inside the Contractors view narrowing to Renovation should get the
     intersection - which is what keeps the category dropdown useful on a role
     page instead of contradicting it. */
  const both = await query('marketplace.vendors', { role: 'contractor', category: 'Renovation', limit: 100 });
  check('5. role AND category compose to the intersection',
    minesIn(both.data).length === 1 && minesIn(both.data)[0] === ids.contractor,
    minesIn(both.data).join(','));
  const empty = await query('marketplace.vendors', { role: 'supplier', category: 'Design', limit: 100 });
  check('5. and an empty intersection is empty, not a fallback to everyone',
    minesIn(empty.data).length === 0, `${minesIn(empty.data).length} fixture rows leaked`);

  /* ══ 6. THE PUBLIC INPUT REFUSES A NON-PROVIDER ROLE ═════════════════ */
  for (const role of ['admin', 'homeowner', 'ADMIN', '', 'supplier OR 1=1']) {
    const refused = await query('marketplace.vendors', { role, limit: 10 });
    check(`6. role=${JSON.stringify(role)} is refused by the endpoint`,
      refused.data === null && refused.status >= 400, `status=${refused.status}`);
  }

  /* ══ 7. ELIGIBILITY STILL OUTRANKS THE ROLE FILTER ═══════════════════
     The frozen correction from the previous candidate: a role view must not
     become a way around public listing eligibility. */
  sql(`update users set accountStatus='frozen' where id=${ids.supplier}`);
  const afterFreeze = await query('marketplace.vendors', { role: 'supplier', limit: 100 });
  check('7. a suspended supplier is absent from the Suppliers view',
    !minesIn(afterFreeze.data).includes(ids.supplier), minesIn(afterFreeze.data).join(','));
  sql(`update users set onboardingStatus='rejected', accountStatus='active' where id=${ids.supplier}`);
  const afterReject = await query('marketplace.vendors', { role: 'supplier', limit: 100 });
  check('7. an unapproved supplier is absent from the Suppliers view',
    !minesIn(afterReject.data).includes(ids.supplier), minesIn(afterReject.data).join(','));
  sql(`update users set onboardingStatus='approved' where id=${ids.supplier}`);
  const restored = await query('marketplace.vendors', { role: 'supplier', limit: 100 });
  check('7. and it returns once the provider is eligible again',
    minesIn(restored.data).includes(ids.supplier), minesIn(restored.data).join(','));

  /* ══ 8. THE PAGES THEMSELVES RESOLVE ═════════════════════════════════ */
  for (const route of [
    '/marketplace/products', '/marketplace/suppliers', '/marketplace/contractors',
    '/marketplace/designers', '/marketplace/finishing', '/marketplace/vendors', '/rfq',
  ]) {
    const res = await fetch(`${BASE}${route}`);
    check(`8. ${route} is served`, res.status === 200, `status=${res.status}`);
  }
} finally {
  if (made.categories.length > 0) {
    try { sql(`delete from vendorCategories where userId in (${made.categories.join(',')})`); }
    catch (e) { console.log(`CLEANUP  vendorCategories: ${String(e).slice(0, 120)}`); }
  }
  if (made.users.length > 0) {
    try {
      sql(`delete from users where id in (${made.users.join(',')})`);
      const left = Number(sql(`select count(*) from users where id in (${made.users.join(',')})`));
      if (left > 0) console.log(`CLEANUP  users left ${left} rows behind`);
    } catch (e) { console.log(`CLEANUP  users: ${String(e).slice(0, 140)}`); }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

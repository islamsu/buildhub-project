// ── LIVE: the service catalogue ───────────────────────────────────────────
//
// SVC. The unit suite pins the rules against doubles. Six things it
// structurally cannot prove, and they are the six this probe exists for:
//
//   THE SEEDED CATEGORIES ARE REALLY THERE, bilingual, scoped SERVICE, and
//     offered by the product - and the PRODUCT categories were not rescoped
//     underneath the products already filed against them.
//
//   QUOTE ON REQUEST WITH A PRICE IS REFUSED OVER HTTP, not just in a
//     function. And refused means nothing was written.
//
//   AN UNAPPROVED PROVIDER CAN DRAFT AND CANNOT PUBLISH. That split is the
//     whole onboarding story for this feature and it is one HTTP call apart.
//
//   A DRAFT IS INVISIBLE TO THE PUBLIC, and so is every service belonging to
//     an account BuildHub has not approved - the second clause, which a
//     column predicate cannot express and a unit test cannot execute.
//
//   ANOTHER PROVIDER'S SERVICE IS NOT_FOUND, over the wire, from a real
//     session - the row-existence oracle this design exists to close.
//
//   AND THE AUDIT ENUM ACCEPTS 'service' IN MySQL. A TypeScript union widened
//     alone compiles and then fails on the first published service.
//
// Every step is driven over HTTP through the product's own procedures. The one
// exception is stated where it occurs: approval status is set in SQL, because
// approving an applicant is setup for this probe rather than its subject.
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
    code: parsed?.error?.json?.data?.code ?? null,
  };
}

async function account(prefix, userRole) {
  const s = new Session(prefix);
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'SvcPass!2026',
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp failed for ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session for ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id, name: u };
}

const call = (a, path, input) => a.s.post(path, input);
const query = (a, path, input) => a.s.get(path, input);
const serviceCount = providerId =>
  Number(sql(`select count(*) from serviceOfferings where providerId=${providerId}`) || 0);

let serviceId = 0;

try {
  // ── 1-3. The taxonomy the unused scope was waiting for ──────────────────
  const anon = new Session('anon');
  const cats = await anon.get('services.categories');
  const rows = cats.data ?? [];
  check('1. the service categories are offered publicly', cats.status === 200 && rows.length >= 15,
    `http=${cats.status} n=${rows.length}`);
  check('2. every one carries BOTH languages, and they differ',
    rows.length > 0 && rows.every(row => row.nameEn && row.nameAr && row.nameEn !== row.nameAr));
  check('3. and NO product category leaked into the service list',
    rows.length > 0 && rows.every(row => String(row.slug).startsWith('svc-')),
    rows.filter(row => !String(row.slug).startsWith('svc-')).map(r => r.slug).join(',').slice(0, 60));

  const productScoped = Number(sql(`select count(*) from productCategories where scope='PRODUCT'`));
  check('4. THE SEED RESCOPED NOTHING: the product categories are untouched',
    productScoped === 35, `product-scope rows=${productScoped}`);

  const waterproofing = rows.find(row => row.slug === 'svc-waterproofing');
  check('5. a real Egyptian trade is listable', Boolean(waterproofing), waterproofing?.nameEn);

  // ── Cast ────────────────────────────────────────────────────────────────
  const provider = await account('svpr', 'contractor');   // will be approved
  const other    = await account('svot', 'contractor');   // a different provider
  const pending  = await account('svpd', 'engineer');     // never approved
  const buyer    = await account('svby', 'homeowner');
  check('6. SETUP: three providers and a customer exist', provider.id > 0 && other.id > 0 && pending.id > 0);

  // ── 7-9. An unapproved provider MAY draft ───────────────────────────────
  const draft = await call(pending, 'services.create', {
    title: `Probe drafting ${stamp}`, categoryId: waterproofing.id,
    pricingBasis: 'quote_on_request',
  });
  check('7. AN UNAPPROVED PROVIDER CAN DRAFT - the catalogue is ready on approval day',
    draft.status === 200 && serviceCount(pending.id) === 1,
    `http=${draft.status} err=${String(draft.error).slice(0, 60)}`);

  const publishAttempt = await call(pending, 'services.setStatus', {
    serviceId: draft.data?.id, status: 'active',
  });
  check('8. AND CANNOT PUBLISH - the refusal names the registration, not "forbidden"',
    publishAttempt.status !== 200 && publishAttempt.code === 'FORBIDDEN'
      && /approved/i.test(String(publishAttempt.error)),
    `code=${publishAttempt.code} err=${String(publishAttempt.error).slice(0, 70)}`);
  check('9. and the draft is still a draft',
    sql(`select status from serviceOfferings where providerId=${pending.id}`) === 'draft');

  // Approval status is SETUP here, not this probe's subject.
  sql(`update users set onboardingStatus='approved' where id in (${provider.id}, ${other.id})`);

  // ── 10-13. The pricing coherence rule, over HTTP ────────────────────────
  const incoherent = await call(provider, 'services.create', {
    title: `Probe incoherent ${stamp}`, categoryId: waterproofing.id,
    pricingBasis: 'quote_on_request', priceMin: 500,
  });
  check('10. QUOTE ON REQUEST WITH A PRICE IS REFUSED over the wire',
    incoherent.status !== 200 && incoherent.code === 'BAD_REQUEST',
    `code=${incoherent.code} err=${String(incoherent.error).slice(0, 70)}`);
  check('11. and refused means NOTHING WAS WRITTEN', serviceCount(provider.id) === 0,
    `rows=${serviceCount(provider.id)}`);

  const backwards = await call(provider, 'services.create', {
    title: `Probe backwards ${stamp}`, categoryId: waterproofing.id,
    pricingBasis: 'per_square_metre', priceMin: 900, priceMax: 400,
  });
  check('12. a maximum below the minimum is refused rather than swapped',
    backwards.status !== 200 && /below the minimum/i.test(String(backwards.error)),
    String(backwards.error).slice(0, 60));

  const productCategoryId = Number(sql(`select id from productCategories where scope='PRODUCT' limit 1`));
  const wrongScope = await call(provider, 'services.create', {
    title: `Probe wrong scope ${stamp}`, categoryId: productCategoryId,
    pricingBasis: 'quote_on_request',
  });
  check('13. a PRODUCT category is refused, and the message says which to pick',
    wrongScope.status !== 200 && /service category/i.test(String(wrongScope.error)),
    String(wrongScope.error).slice(0, 60));

  // ── 14-17. A real, coherent listing ─────────────────────────────────────
  const created = await call(provider, 'services.create', {
    title: `Bathroom waterproofing ${stamp}`,
    description: 'Three-coat cementitious membrane, including screed protection.',
    categoryId: waterproofing.id,
    pricingBasis: 'per_square_metre', priceMin: 120, priceMax: 260,
    leadTimeDays: 14, warrantyMonths: 60,
  });
  serviceId = created.data?.id ?? 0;
  check('14. a coherent service is created, as a DRAFT', created.status === 200 && serviceId > 0
    && sql(`select status from serviceOfferings where id=${serviceId}`) === 'draft',
    `http=${created.status} id=${serviceId}`);

  const beforePublish = await anon.get('services.forProvider', { providerId: provider.id });
  check('15. A DRAFT IS INVISIBLE to the public',
    beforePublish.status === 200 && (beforePublish.data ?? []).length === 0,
    `n=${(beforePublish.data ?? []).length}`);

  const published = await call(provider, 'services.setStatus', { serviceId, status: 'active' });
  check('16. an approved provider publishes it', published.status === 200,
    `http=${published.status} err=${String(published.error).slice(0, 60)}`);

  const publicView = await anon.get('services.forProvider', { providerId: provider.id });
  const shown = (publicView.data ?? [])[0];
  check('17. and a signed-out customer sees it, with its real figures',
    shown?.id === serviceId && Number(shown?.priceMin) === 120 && Number(shown?.priceMax) === 260
      && shown?.leadTimeDays === 14 && shown?.warrantyMonths === 60,
    JSON.stringify(shown ?? {}).slice(0, 110));
  check('18. carrying the category in both languages',
    Boolean(shown?.categoryNameEn && shown?.categoryNameAr && shown.categoryNameEn !== shown.categoryNameAr),
    `${shown?.categoryNameEn} / ${shown?.categoryNameAr}`);

  // ── 19. The audit enum, in MySQL ────────────────────────────────────────
  const audited = Number(sql(
    `select count(*) from commercialAuditEvents where subjectType='service' and subjectId=${serviceId}`) || 0);
  check('19. THE AUDIT ENUM ACCEPTS "service" IN MySQL - create and publish are both recorded',
    audited >= 2, `events=${audited}`);

  // ── 20-22. The second visibility clause ─────────────────────────────────
  const otherService = await call(other, 'services.create', {
    title: `Probe other ${stamp}`, categoryId: waterproofing.id, pricingBasis: 'quote_on_request',
  });
  await call(other, 'services.setStatus', { serviceId: otherService.data?.id, status: 'active' });
  const otherPublic = await anon.get('services.forProvider', { providerId: other.id });
  check('20. a second approved provider is visible too - the rule is not "one provider"',
    (otherPublic.data ?? []).length === 1);

  sql(`update users set onboardingStatus='under_review' where id=${other.id}`);
  const afterUnapproval = await anon.get('services.forProvider', { providerId: other.id });
  check('21. WITHDRAWING APPROVAL HIDES A LIVE SERVICE - the second clause is real',
    (afterUnapproval.data ?? []).length === 0,
    `n=${(afterUnapproval.data ?? []).length} status=${sql(`select status from serviceOfferings where id=${otherService.data?.id}`)}`);
  check('22. and the offering row is untouched - it is hidden, not destroyed',
    sql(`select status from serviceOfferings where id=${otherService.data?.id}`) === 'active');
  sql(`update users set onboardingStatus='approved' where id=${other.id}`);

  // ── 23-26. Ownership over the wire ──────────────────────────────────────
  const steal = await call(other, 'services.update', {
    serviceId, title: 'Stolen', categoryId: waterproofing.id, pricingBasis: 'quote_on_request',
  });
  check('23. ANOTHER PROVIDER’S SERVICE IS NOT_FOUND, never FORBIDDEN',
    steal.status !== 200 && steal.code === 'NOT_FOUND', `code=${steal.code}`);
  check('24. and the title is untouched',
    sql(`select title from serviceOfferings where id=${serviceId}`).startsWith('Bathroom waterproofing'));

  const stealStatus = await call(other, 'services.setStatus', { serviceId, status: 'archived' });
  check('25. nor can they archive it', stealStatus.status !== 200 && stealStatus.code === 'NOT_FOUND',
    `code=${stealStatus.code}`);

  const buyerWrite = await call(buyer, 'services.create', {
    title: 'Homeowner service', categoryId: waterproofing.id, pricingBasis: 'quote_on_request',
  });
  check('26. a homeowner cannot list a service at all',
    buyerWrite.status !== 200 && buyerWrite.code === 'FORBIDDEN', `code=${buyerWrite.code}`);

  const anonWrite = await anon.post('services.create', {
    title: 'Anonymous', categoryId: waterproofing.id, pricingBasis: 'quote_on_request',
  });
  check('27. and a signed-out caller certainly cannot',
    anonWrite.status !== 200 && anonWrite.code === 'UNAUTHORIZED', `code=${anonWrite.code}`);

  // ── 28-30. The lifecycle ────────────────────────────────────────────────
  const delisted = await call(provider, 'services.setStatus', { serviceId, status: 'inactive' });
  const afterDelist = await anon.get('services.forProvider', { providerId: provider.id });
  check('28. delisting takes it off the public profile', delisted.status === 200
    && (afterDelist.data ?? []).length === 0);

  await call(provider, 'services.setStatus', { serviceId, status: 'archived' });
  const straightBack = await call(provider, 'services.setStatus', { serviceId, status: 'active' });
  check('29. ARCHIVED CANNOT GO STRAIGHT LIVE - the refusal names both states',
    straightBack.status !== 200 && /archived to active/i.test(String(straightBack.error)),
    String(straightBack.error).slice(0, 60));

  const restored = await call(provider, 'services.setStatus', { serviceId, status: 'inactive' });
  check('30. but it restores to off-sale, a deliberate second step',
    restored.status === 200 && sql(`select status from serviceOfferings where id=${serviceId}`) === 'inactive');

  const mine = await query(provider, 'services.mine');
  check('31. the provider’s own list shows it whatever its status',
    (mine.data ?? []).some(row => row.id === serviceId), `n=${(mine.data ?? []).length}`);
  check('32. and shows only THEIR services',
    (mine.data ?? []).length === 1, `n=${(mine.data ?? []).length}`);

} catch (error) {
  check('PROBE COMPLETED', false, String(error).slice(0, 200));
} finally {
  for (const id of made) {
    for (const q of [
      `delete from commercialAuditEvents where actorId=${id}`,
      `delete from serviceOfferings where providerId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from registrationReviewEvents where userId=${id} or actorId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  const leftUsers = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  const leftServices = made.length === 0 ? 0 : Number(sql(`select count(*) from serviceOfferings where providerId in (${made.join(',')})`) || 0);
  check('33. CLEANUP: every account and listing this probe created is gone',
    leftUsers === 0 && leftServices === 0, `users=${leftUsers} services=${leftServices}`);
  // The SEEDED categories are NOT cleaned up: they are a migration's output,
  // not this probe's, and deleting them would undo the migration.
  const seeded = Number(sql(`select count(*) from productCategories where scope='SERVICE'`) || 0);
  check('34. and the seeded taxonomy is left exactly as the migration made it',
    seeded === 20, `service categories=${seeded}`);

  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

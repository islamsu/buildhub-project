// ── LIVE: RFQ supplier invitations, on top of the open board ────────────────
//
// Two things this proves that the unit suite cannot:
//
//   the EXEMPTION is real against a real meter - the qualifiedEnquiries table
//     is counted before and after, so "no lead was spent" is a fact about the
//     database rather than about a mock;
//   the REMOVED-MEMBER rule, which lives in a WHERE clause the unit double
//     cannot model. It is only testable where the WHERE is real.
import { chromium } from 'playwright';
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

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
async function freshContext() {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await c.route('**/*', r => {
    const h = new URL(r.request().url()).hostname;
    return (h === '127.0.0.1' || h === 'localhost') ? r.continue() : r.abort();
  });
  return c;
}

const stamp = Date.now() % 100000000;
const made = [];
const madeRfqs = [];

async function go(p, u) {
  await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await p.waitForTimeout(800);
}

/** A real account, registered through the real form. */
async function account(prefix, roleIndex = 0) {
  const p = await (await freshContext()).newPage();
  await go(p, '/auth');
  await (await p.locator('button.p-4.rounded-xl').all())[roleIndex].click();
  const u = `${prefix}${stamp}`;
  await p.getByPlaceholder(/username|اسم/i).fill(u);
  await p.locator('input[type="email"]').fill(`${u}@example.test`);
  const pw = p.locator('input[type="password"]');
  await pw.nth(0).fill('InvitePass!2026'); await pw.nth(1).fill('InvitePass!2026');
  await p.getByRole('button', { name: /create account|إنشاء/i }).last().click();
  await p.waitForTimeout(2600);
  const me = await p.evaluate(async () =>
    (await (await fetch('/api/trpc/auth.me', { credentials: 'include' })).json())?.result?.data?.json ?? null);
  if (!me?.id) throw new Error(`registration failed for ${prefix}`);
  made.push(me.id);
  return { p, id: me.id };
}

const call = (page, path, input) => page.evaluate(async ([pa, i]) => {
  const res = await fetch(`/api/trpc/${pa}`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: i }),
  });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null, error: parsed?.error?.json?.message ?? null };
}, [path, input]);

const query = (page, path, input) => page.evaluate(async ([pa, i]) => {
  const qs = i === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: i }))}`;
  const res = await fetch(`/api/trpc/${pa}${qs}`, { credentials: 'include' });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null, error: parsed?.error?.json?.message ?? null };
}, [path, input]);

try {
  // ── Cast ────────────────────────────────────────────────────────────────
  const customer = await account('ricu');            // homeowner
  sql(`update users set userRole='homeowner' where id=${customer.id}`);

  // A supplier who declares NOTHING, so the only way they can see the RFQ is
  // the invitation. This is what makes the category-bypass provable.
  const invitee = await account('risa');
  sql(`update users set userRole='supplier', onboardingStatus='approved' where id=${invitee.id}`);

  // A supplier who DOES match the category - the open board, unchanged.
  const boardSupplier = await account('risb');
  sql(`update users set userRole='supplier', onboardingStatus='approved' where id=${boardSupplier.id}`);

  const rival = await account('risr');
  sql(`update users set userRole='supplier', onboardingStatus='approved' where id=${rival.id}`);

  const manager = await account('ripm');
  sql(`update users set userRole='project_manager', onboardingStatus='approved' where id=${manager.id}`);

  for (const a of [customer, invitee, boardSupplier, rival, manager]) await go(a.p, '/');

  // The board supplier declares the category; the invitee declares nothing.
  // profile.setMyCategories - verified against VendorServiceCategories.tsx,
  // not guessed. The first version called a procedure that does not exist and
  // swallowed the failure with .catch(), so four downstream checks failed for
  // a reason that had nothing to do with what they were testing. A silently
  // swallowed setup failure is a process error, not a test result.
  const declare = await call(boardSupplier.p, 'profile.setMyCategories', { categories: ['Materials'] });
  check('SETUP: the category declaration was accepted', declare.status === 200,
    `http=${declare.status} err=${String(declare.error).slice(0, 60)}`);
  const declaredBoard = sql(`select count(*) from vendorCategories where userId=${boardSupplier.id}`);
  const declaredInvitee = sql(`select count(*) from vendorCategories where userId=${invitee.id}`);
  check('the board supplier declared a category', Number(declaredBoard) > 0, `rows=${declaredBoard}`);
  check('the INVITED supplier declared NONE - so only an invitation can reach them',
    declaredInvitee === '0', `rows=${declaredInvitee}`);

  // A project the manager runs, and an RFQ raised against it.
  const project = await call(customer.p, 'projects.create', {
    title: `Invite probe ${stamp}`, description: 'Live invitation probe', budget: 250000,
    location: 'Cairo', category: 'residential',
  });
  const projectId = project.data?.id ?? Number(sql(`select id from projects where ownerId=${customer.id} order by id desc limit 1`));
  check('the customer created a project', Number.isInteger(projectId) && projectId > 0, `projectId=${projectId}`);

  await call(customer.p, 'projects.addMember', { projectId, userId: manager.id, projectRole: 'manager' });
  const memberRole = sql(`select projectRole from projectMembers where projectId=${projectId} and userId=${manager.id}`);
  check('the project manager is on the project team', memberRole === 'manager', `role=${memberRole}`);

  const rfq = await call(customer.p, 'rfq.create', {
    title: `Rebar for slab ${stamp}`, description: 'Live invitation probe RFQ',
    category: 'Materials', quantity: 20, unit: 'tonne', location: 'Cairo', projectId,
  });
  const rfqId = rfq.data?.id ?? Number(sql(`select id from rfqs where requesterId=${customer.id} order by id desc limit 1`));
  madeRfqs.push(rfqId);
  check('the customer raised an RFQ against the project', Number.isInteger(rfqId) && rfqId > 0,
    `rfqId=${rfqId} err=${rfq.error ?? '-'}`);

  // ── 1. The open board is UNCHANGED ──────────────────────────────────────
  const boardBefore = await query(boardSupplier.p, 'rfq.eligible');
  const seenByCategory = (boardBefore.data?.items ?? []).some(i => i.id === rfqId);
  check('OPEN BOARD: a category-matching supplier sees the RFQ without any invitation',
    seenByCategory, `items=${(boardBefore.data?.items ?? []).length}`);

  const inviteeBoardBefore = await query(invitee.p, 'rfq.eligible');
  check('OPEN BOARD: a supplier with no declared category does NOT see it yet',
    !(inviteeBoardBefore.data?.items ?? []).some(i => i.id === rfqId),
    `items=${(inviteeBoardBefore.data?.items ?? []).length}`);

  // ── 2. Who may invite ───────────────────────────────────────────────────
  const byRival = await call(rival.p, 'rfq.inviteSupplier', { rfqId, supplierId: invitee.id });
  check('a rival supplier cannot invite anyone to somebody else\'s RFQ',
    byRival.status !== 200, `http=${byRival.status} err=${String(byRival.error).slice(0, 40)}`);
  check('and the refusal is NOT_FOUND-shaped, so it does not confirm the RFQ exists',
    /not found/i.test(String(byRival.error)), String(byRival.error).slice(0, 40));

  const byManager = await call(manager.p, 'rfq.inviteSupplier', { rfqId, supplierId: rival.id });
  check('the PROJECT MANAGER may invite - the same capability that lets them raise the RFQ',
    byManager.status === 200 && byManager.data?.outcome === 'invited',
    `http=${byManager.status} outcome=${byManager.data?.outcome} err=${byManager.error ?? '-'}`);

  const byCustomer = await call(customer.p, 'rfq.inviteSupplier', { rfqId, supplierId: invitee.id });
  check('the REQUESTER may invite', byCustomer.status === 200 && byCustomer.data?.outcome === 'invited',
    `outcome=${byCustomer.data?.outcome} err=${byCustomer.error ?? '-'}`);

  check('DATABASE: the invitation is recorded with who sent it',
    sql(`select invitedBy from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`) === String(customer.id),
    `invitedBy=${sql(`select invitedBy from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`)}`);

  const again = await call(customer.p, 'rfq.inviteSupplier', { rfqId, supplierId: invitee.id });
  check('inviting the same supplier twice is a no-op, not a second invitation',
    again.data?.outcome === 'already_invited', `outcome=${again.data?.outcome}`);
  check('DATABASE: still exactly ONE invitation row for that pair',
    sql(`select count(*) from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`) === '1');
  check('and exactly ONE notification - not two about one invitation',
    sql(`select count(*) from notifications where userId=${invitee.id} and messageKey='notif.rfq.invited'`) === '1',
    `count=${sql(`select count(*) from notifications where userId=${invitee.id} and messageKey='notif.rfq.invited'`)}`);

  const selfInvite = await call(customer.p, 'rfq.inviteSupplier', { rfqId, supplierId: customer.id });
  check('a customer cannot invite themselves', selfInvite.status !== 200, `http=${selfInvite.status}`);

  // ── 3. THE REMOVED-MEMBER RULE, only provable where the WHERE is real ────
  await call(customer.p, 'projects.removeMember', { projectId, userId: manager.id });
  const removedAt = sql(`select ifnull(removedAt,'NULL') from projectMembers where projectId=${projectId} and userId=${manager.id}`);
  check('the project manager was removed from the team', removedAt !== 'NULL', `removedAt=${removedAt}`);

  const afterRemoval = await call(manager.p, 'rfq.inviteSupplier', { rfqId, supplierId: boardSupplier.id });
  check('REMOVED MEMBER: they can no longer invite - the rule the unit double could not model',
    afterRemoval.status !== 200, `http=${afterRemoval.status} err=${String(afterRemoval.error).slice(0, 40)}`);
  check('DATABASE: no invitation was created by the removed member',
    sql(`select count(*) from rfqSuppliers where rfqId=${rfqId} and supplierId=${boardSupplier.id}`) === '0');

  // ── 4. The invitation reaches the supplier's board across the category ──
  const inviteeBoard = await query(invitee.p, 'rfq.eligible');
  const row = (inviteeBoard.data?.items ?? []).find(i => i.id === rfqId);
  check('INVITED: the RFQ now appears on their board despite no matching category',
    !!row, `items=${(inviteeBoard.data?.items ?? []).length}`);
  check('and it is flagged as invited, so the supplier knows why it is there',
    row?.invited === true, `invited=${row?.invited}`);

  // ── 5. THE EXEMPTION, against the real meter ────────────────────────────
  const usedBefore = sql(`select count(*) from qualifiedEnquiries where userId=${invitee.id}`);
  const opened = await call(invitee.p, 'rfq.openEnquiry', { rfqId });
  check('an invited supplier can open the RFQ', opened.status === 200,
    `http=${opened.status} err=${opened.error ?? '-'}`);
  check('the response says the access came from the invitation',
    opened.data?.byInvitation === true, `byInvitation=${opened.data?.byInvitation}`);

  const usedAfter = sql(`select count(*) from qualifiedEnquiries where userId=${invitee.id}`);
  check('EXEMPTION IS REAL: no qualifiedEnquiries row was written',
    usedBefore === usedAfter && usedAfter === '0', `before=${usedBefore} after=${usedAfter}`);
  check('DATABASE: the invitation moved to viewed instead',
    sql(`select status from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`) === 'viewed',
    sql(`select status from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`));

  const firstViewed = sql(`select viewedAt from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`);
  await call(invitee.p, 'rfq.openEnquiry', { rfqId });
  check('opening it AGAIN does not re-stamp when they first saw it',
    sql(`select viewedAt from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`) === firstViewed,
    `first=${firstViewed}`);
  check('and still spends no lead on the second open',
    sql(`select count(*) from qualifiedEnquiries where userId=${invitee.id}`) === '0');

  // ── 6. An UNINVITED supplier is still metered, exactly as before ─────────
  const boardUsedBefore = sql(`select count(*) from qualifiedEnquiries where userId=${boardSupplier.id}`);
  const boardOpen = await call(boardSupplier.p, 'rfq.openEnquiry', { rfqId });
  check('OPEN BOARD UNCHANGED: an uninvited category match can still open it',
    boardOpen.status === 200, `http=${boardOpen.status} err=${boardOpen.error ?? '-'}`);
  check('and it is NOT flagged as an invitation', boardOpen.data?.byInvitation !== true,
    `byInvitation=${boardOpen.data?.byInvitation}`);
  const boardUsedAfter = sql(`select count(*) from qualifiedEnquiries where userId=${boardSupplier.id}`);
  check('METER UNCHANGED: the uninvited supplier DID spend a lead',
    Number(boardUsedAfter) === Number(boardUsedBefore) + 1, `before=${boardUsedBefore} after=${boardUsedAfter}`);

  // ── 7. Who may see the invitation list ──────────────────────────────────
  const listByCustomer = await query(customer.p, 'rfq.invitations', { rfqId });
  check('the requester can see who they invited', listByCustomer.status === 200 && Array.isArray(listByCustomer.data),
    `http=${listByCustomer.status} rows=${listByCustomer.data?.length}`);

  const serialised = JSON.stringify(listByCustomer.data ?? []);
  check('the list carries no credential, token or hash',
    !/passwordHash|scrypt\$|invitationToken|passwordResetToken/i.test(serialised), 'no secrets in payload');
  check('and no supplier email or phone - contact is what a qualified enquiry buys',
    !/"email"|"phone"/.test(serialised), 'no contact details');

  const listByRival = await query(rival.p, 'rfq.invitations', { rfqId });
  check('a RIVAL supplier cannot see who else was approached',
    listByRival.status !== 200, `http=${listByRival.status}`);
  const listByInvitee = await query(invitee.p, 'rfq.invitations', { rfqId });
  check('not even an INVITED supplier can see the other firms invited',
    listByInvitee.status !== 200, `http=${listByInvitee.status}`);

  // ── 8. Declining ────────────────────────────────────────────────────────
  const declineByStranger = await call(boardSupplier.p, 'rfq.declineInvitation', { rfqId });
  check('a supplier with no invitation cannot decline one',
    declineByStranger.status !== 200, `http=${declineByStranger.status}`);

  const declined = await call(rival.p, 'rfq.declineInvitation', { rfqId });
  check('an invited supplier may decline', declined.status === 200,
    `http=${declined.status} err=${declined.error ?? '-'}`);
  check('DATABASE: the decline is recorded',
    sql(`select status from rfqSuppliers where rfqId=${rfqId} and supplierId=${rival.id}`) === 'declined');
  check('the REQUESTER is told, so they are not left waiting on a supplier who said no',
    sql(`select count(*) from notifications where userId=${customer.id} and messageKey='notif.rfq.invitationDeclined'`) === '1',
    `count=${sql(`select count(*) from notifications where userId=${customer.id} and messageKey='notif.rfq.invitationDeclined'`)}`);

  const declinedBoard = await query(rival.p, 'rfq.eligible');
  check('a DECLINED invitation drops off their board - the decline changed something',
    !(declinedBoard.data?.items ?? []).some(i => i.id === rfqId && i.invited),
    `still invited=${(declinedBoard.data?.items ?? []).some(i => i.id === rfqId && i.invited)}`);

  const declineTwice = await call(rival.p, 'rfq.declineInvitation', { rfqId });
  check('declining twice is refused rather than silently re-stamped',
    declineTwice.status !== 200, `http=${declineTwice.status}`);

  // ── 9. Quoting closes the loop ──────────────────────────────────────────
  const quoted = await call(invitee.p, 'rfq.submitQuotation', {
    rfqId, price: 125000, timeline: 30, notes: 'Live invitation probe quotation',
  });
  check('the invited supplier can quote', quoted.status === 200,
    `http=${quoted.status} err=${String(quoted.error).slice(0, 60)}`);
  check('DATABASE: the invitation is marked responded',
    sql(`select status from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`) === 'responded',
    sql(`select status from rfqSuppliers where rfqId=${rfqId} and supplierId=${invitee.id}`));
  check('a supplier who has already quoted cannot un-quote by declining',
    (await call(invitee.p, 'rfq.declineInvitation', { rfqId })).status !== 200);

  // ── 10. THE PANEL ON THE REAL PAGE ──────────────────────────────────────
  //
  // A second RFQ, because the first has been quoted on and declined against -
  // this one starts clean so the panel's states are unambiguous.
  const uiRfq = await call(customer.p, 'rfq.create', {
    title: `Panel probe ${stamp}`, description: 'Live invitation panel probe',
    category: 'Materials', quantity: 5, unit: 'tonne', location: 'Cairo',
  });
  const uiRfqId = uiRfq.data?.id ?? Number(sql(`select id from rfqs where requesterId=${customer.id} order by id desc limit 1`));
  madeRfqs.push(uiRfqId);

  await go(customer.p, `/rfq/${uiRfqId}`);
  check('LIVE UI: the invitation panel is on the requester\'s RFQ page',
    await customer.p.locator('[data-testid="rfq-invitations"]').count() > 0);
  check('LIVE UI: it says nobody has been invited yet, rather than showing an empty list',
    await customer.p.locator('[data-testid="rfq-invitations-empty"]').count() > 0);

  await customer.p.locator('[data-testid="rfq-invite-search"]').fill('risa');
  await customer.p.locator('[data-testid="rfq-invite-search-go"]').click();
  await customer.p.waitForTimeout(2000);
  const inviteBtn = customer.p.locator(`[data-testid="rfq-invite-${invitee.id}"]`);
  check('LIVE UI: searching the directory finds the supplier', await inviteBtn.count() > 0,
    `found=${await inviteBtn.count()}`);

  if (await inviteBtn.count() > 0) {
    await inviteBtn.click();
    await customer.p.waitForTimeout(2000);
    check('LIVE UI -> DATABASE: the click actually created the invitation',
      sql(`select count(*) from rfqSuppliers where rfqId=${uiRfqId} and supplierId=${invitee.id}`) === '1',
      `rows=${sql(`select count(*) from rfqSuppliers where rfqId=${uiRfqId} and supplierId=${invitee.id}`)}`);
    const listed = await customer.p.locator('[data-testid="rfq-invitations-list"]').innerText().catch(() => '');
    check('LIVE UI: the supplier now appears with an honest "awaiting response" status',
      /Awaiting response/i.test(listed), listed.replace(/\n/g, ' ').slice(0, 60));
  }

  // A RIVAL supplier opening the same page must not see the panel at all -
  // and, more importantly, the server refuses them regardless.
  await go(rival.p, `/rfq/${uiRfqId}`);
  check('LIVE UI: a rival supplier is not shown the invitation panel',
    await rival.p.locator('[data-testid="rfq-invitations"]').count() === 0);
  check('and the server refuses them the data behind it',
    (await query(rival.p, 'rfq.invitations', { rfqId: uiRfqId })).status !== 200);

  // ── 11. The supplier reads the invitation in their own language ─────────
  await invitee.p.evaluate(() => localStorage.setItem('buildhub_lang', 'ar'));
  await go(invitee.p, '/messages');
  const arTab = invitee.p.locator('[role="tab"]').filter({ hasText: /notification|الإشعارات/i }).first();
  if (await arTab.count()) { await arTab.click(); await invitee.p.waitForTimeout(1500); }
  const arabic = await invitee.p.evaluate(() => document.body.innerText);
  check('LIVE AR: the invitation reads in Arabic, and says it costs no enquiry',
    /دعوة/.test(arabic) && /المؤهلة/.test(arabic),
    arabic.split('\n').filter(l => /دعوة|المؤهلة/.test(l)).slice(0, 1).join(' ').slice(0, 60) || 'no Arabic line');

} catch (error) {
  check('the probe ran to completion', false, String(error.message).split('\n')[0].slice(0, 140));
} finally {
  // Child-first and idempotent, so this can be run again.
  for (const id of madeRfqs) {
    for (const q of [
      `delete from qualifiedEnquiries where rfqId=${id}`,
      `delete from rfqSuppliers where rfqId=${id}`,
      `delete from quotations where rfqId=${id}`,
      `delete from rfqs where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) {
    for (const q of [
      `delete from notifications where userId=${id}`,
      `delete from qualifiedEnquiries where userId=${id}`,
      `delete from rfqSuppliers where supplierId=${id} or invitedBy=${id}`,
      `delete from quotations where providerId=${id}`,
      `delete from rfqs where requesterId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from projectMembers where userId=${id} or assignedBy=${id} or removedBy=${id}`,
      `delete from projects where ownerId=${id} or createdBy=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from billingEvents where userId=${id} or actorId=${id}`,
      `delete from vendorSubscriptions where userId=${id}`,
      `delete from users where id=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  await b.close();
  console.log(results.join('\n'));
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

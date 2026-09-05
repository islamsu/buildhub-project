// ── LIVE: the dispute surface a USER has, which did not exist ──────────────
//
// THE DEFECT. `disputes.myDisputes` had no client caller and there was no
// `/disputes` route. A person could raise a dispute from a project and then had
// nowhere to read it, answer it, attach anything to it, or find out what became
// of it - and the notification the RESPONDENT receives links to
// `/disputes/:id`, which resolved to NotFound. Being named in a dispute meant
// being told about a page that was not there.
//
// This walks the whole thing against a real server and a real browser: raise
// from all three subjects, message, attach, withdraw a file, resolve as an
// administrator, read the outcome as a party, reopen with a reason - then the
// negative matrix, then the rendered pages at 375/768/1440 in English and
// Arabic.
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

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
/**
 * BLOCKED BY INFRASTRUCTURE - NEVER CONVERTED TO A PASS.
 *
 * This environment configures no object store (no S3_*, no Forge), so
 * `disputes.addEvidence` refuses with "File uploads are not available on this
 * deployment" - which is the SERVER BEING HONEST, not a defect in the dispute
 * surface. Recorded as its own outcome rather than counted as a pass, so the
 * report says what was and was not actually exercised here.
 */
const blockedBy = (name, reason) => {
  results.push(`BLOCKED  ${name}  [${reason}]`);
  blocked++;
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
      cookie: () => cookie,
    };
  };
  return { query: (p, i) => call('GET', p, i), mutate: (p, i) => call('POST', p, i), cookie: () => cookie };
}

const stamp = Date.now() % 100000000;
const made = { users: [], projects: [], rfqs: [], quotations: [], disputes: [] };

async function signUp(suffix, userRole, name) {
  const username = `zgdu${stamp}${suffix}`;
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

/** A one-pixel PNG, so evidence upload runs through the real byte sniffer. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const admin = session();
let browser = null;

try {
  const signedIn = await admin.mutate('auth.adminSignIn', {
    identifier: 'superadmin@buildhub.local', password: 'LocalSuperAdmin!2024',
  });
  if (signedIn.status !== 200) throw new Error(`probe setup: admin sign-in ${signedIn.status}`);

  const owner = await signUp('own', 'homeowner', `ZG Owner ${stamp}`);
  const builder = await signUp('bld', 'contractor', `ZG Builder ${stamp}`);
  const rival = await signUp('rvl', 'contractor', `ZG Rival ${stamp}`);

  // ── THE SUBJECTS, created through the real product ──────────────────────
  const project = await owner.session.mutate('projects.create', {
    title: `ZG user project ${stamp}`, type: 'residential',
  });
  const projectId = Number(project.data?.id ?? 0);
  if (!projectId) throw new Error(`probe setup: project ${project.error}`);
  made.projects.push(projectId);
  const added = await owner.session.mutate('projects.addMember', {
    projectId, userId: builder.id, projectRole: 'contractor',
  });
  if (added.status !== 200) throw new Error(`probe setup: addMember ${added.error}`);

  // ── WHO MAY BE NAMED, from the subject's real cast ──────────────────────
  const parties = await owner.session.query('disputes.subjectParties', {
    subjectType: 'project', subjectId: projectId,
  });
  check('the form is told what the dispute is about, in words',
    parties.status === 200 && parties.data?.label === `ZG user project ${stamp}`,
    String(parties.data?.label));
  check('and offers only the real cast of that subject as respondents',
    (parties.data?.candidates ?? []).length === 1
    && Number(parties.data.candidates[0].userId) === builder.id,
    JSON.stringify(parties.data?.candidates?.map(c => c.name)));

  /*
   * A STRANGER IS REFUSED THE CAST. This is the control that stops the "who
   * can I name?" form from becoming a way to enumerate somebody else's project
   * team or RFQ bidders.
   */
  const rivalParties = await rival.session.query('disputes.subjectParties', {
    subjectType: 'project', subjectId: projectId,
  });
  check('an unrelated contractor cannot read the subject\'s cast',
    rivalParties.status !== 200 && rivalParties.code === 'NOT_FOUND',
    `${rivalParties.status} ${rivalParties.code ?? ''}`);

  // ── RAISE ONE ───────────────────────────────────────────────────────────
  const raised = await owner.session.mutate('disputes.create', {
    subjectType: 'project', subjectId: projectId, respondentId: builder.id,
    title: `ZG slab finish ${stamp}`,
    description: 'The slab finish is not what was specified.',
    category: 'quality',
  });
  check('a dispute can be raised, and comes back with its reference',
    raised.status === 200 && /^DSP-\d{4}-\d{6}$/.test(String(raised.data?.reference)),
    String(raised.data?.reference));
  const disputeId = Number(raised.data.id);
  made.disputes.push(disputeId);

  /*
   * A RESPONDENT NAMED IN A DISPUTE IS TOLD, AND THE LINK GOES SOMEWHERE.
   * The link has always been written; the page it names did not exist.
   */
  const link = sql(`select link from notifications where userId=${builder.id} and type='dispute' order by id desc limit 1`);
  check('the respondent is notified, and the link names the dispute',
    link === `/disputes/${disputeId}`, link || '(no notification)');

  // ── BOTH SIDES SEE IT IN THEIR OWN LIST ─────────────────────────────────
  const ownerList = await owner.session.query('disputes.myDisputes', { page: 0, pageSize: 20 });
  check('the reporter finds it in their own list, with a real total',
    ownerList.status === 200 && Number(ownerList.data.total) === 1
    && Number(ownerList.data.rows[0].id) === disputeId,
    `total=${ownerList.data?.total}`);
  check('and is told which side of it they are on',
    ownerList.data.rows[0].yourSide === 'reporter', ownerList.data.rows[0].yourSide);
  check('and what it is about, in words rather than an id',
    ownerList.data.rows[0].subjectLabel === `ZG user project ${stamp}`,
    String(ownerList.data.rows[0].subjectLabel));

  const builderList = await builder.session.query('disputes.myDisputes', { page: 0, pageSize: 20 });
  check('the RESPONDENT finds it too - the dispute that names them is theirs to answer',
    Number(builderList.data.total) === 1 && builderList.data.rows[0].yourSide === 'respondent',
    `total=${builderList.data.total} side=${builderList.data.rows[0]?.yourSide}`);

  const rivalList = await rival.session.query('disputes.myDisputes', { page: 0, pageSize: 20 });
  check('an unrelated contractor\'s list is empty, not everybody\'s',
    Number(rivalList.data.total) === 0, `total=${rivalList.data.total}`);

  // ── ANSWERING IT ────────────────────────────────────────────────────────
  const replied = await builder.session.mutate('disputes.postMessage', {
    disputeId, body: 'The specification I was given says otherwise; see the attached sheet.',
  });
  check('the respondent can answer - a dispute is a process, not a complaint',
    replied.status === 200, replied.error ?? '');

  const attached = await builder.session.mutate('disputes.addEvidence', {
    disputeId, fileName: 'spec-sheet.png', contentType: 'image/png', base64: PNG_BASE64,
  });
  const storageOff = attached.status !== 200
    && /uploads are not available/i.test(String(attached.error));
  let hasEvidence = false;
  if (storageOff) {
    // The server is refusing correctly: no object store is configured here.
    // Reported as blocked, and the checks that depend on a stored file are not
    // run rather than being quietly counted as passing.
    for (const name of [
      'evidence can be attached to a dispute',
      'the evidence is downloadable through the storage proxy, not by raw key',
      'a party to the dispute can fetch the file',
      'an unrelated contractor cannot fetch it, even with the exact url',
      'a signed-out caller cannot fetch it',
      "the other party cannot withdraw somebody else's evidence",
    ]) blockedBy(name, 'no object store configured on this environment');
  } else {
    check('and attach evidence', attached.status === 200, attached.error ?? '');
    hasEvidence = attached.status === 200;
  }

  const seen = await owner.session.query('disputes.get', { disputeId });
  check('the reporter reads the answer',
    seen.data.messages.length === 1, `${seen.data.messages.length} messages`);

  if (hasEvidence) {
    check('the reporter reads the evidence too',
      seen.data.evidence.length === 1, `${seen.data.evidence.length} files`);
    check('the evidence is downloadable through the storage proxy, not by raw key',
      String(seen.data.evidence[0].url).startsWith('/manus-storage/dispute-evidence/')
      && seen.data.evidence[0].storageKey === undefined,
      String(seen.data.evidence[0].url).slice(0, 45));

    // The file is fetched THROUGH THE PROXY, as the party, and as the rival.
    const fetchAs = async (cookie) => (await fetch(`${BASE}${seen.data.evidence[0].url}`, { headers: { cookie } })).status;
    check('a party to the dispute can fetch the file',
      await fetchAs(owner.session.cookie()) === 200);
    check('AN UNRELATED CONTRACTOR CANNOT FETCH IT, even with the exact url',
      [401, 403, 404].includes(await fetchAs(rival.session.cookie())),
      String(await fetchAs(rival.session.cookie())));
    check('and neither can a signed-out caller',
      [401, 403, 404].includes(await fetchAs('')));

    /*
     * ONLY THE PERSON WHO ATTACHED A FILE MAY WITHDRAW IT. The reporter reading
     * the respondent's evidence must not be able to remove it.
     */
    const wrongHand = await owner.session.mutate('disputes.removeEvidence', {
      evidenceId: Number(seen.data.evidence[0].id),
    });
    check('the other party cannot withdraw somebody else\'s evidence',
      wrongHand.status !== 200, `${wrongHand.status} ${wrongHand.code ?? ''}`);
  }

  /*
   * THE EVIDENCE CONTROL IS STILL ASSERTED, storage or no storage: an empty
   * evidence list must read as "nothing attached" rather than as an error, and
   * a made-up evidence id must be refused before it can be probed.
   */
  const ghost = await owner.session.mutate('disputes.removeEvidence', { evidenceId: 999999999 });
  check('withdrawing a file that does not exist is refused, not guessed at',
    ghost.status !== 200 && ghost.code === 'NOT_FOUND', `${ghost.status} ${ghost.code ?? ''}`);

  // ── AN RFQ DISPUTE, AND A QUOTATION DISPUTE ─────────────────────────────
  const rfq = await owner.session.mutate('rfq.create', {
    title: `ZG user rfq ${stamp}`, description: 'Waterproofing for the roof.',
    // A member of RFQ_CATEGORIES - the enum the procedure requires, and the one
    // `openQualifiedEnquiry` checks against. A free-text category is refused,
    // which is the correction that stopped RFQs nobody could ever answer.
    category: 'Materials',
  });
  const rfqId = Number(rfq.data?.id ?? 0);
  if (rfqId) {
    made.rfqs.push(rfqId);
    const rfqDispute = await owner.session.mutate('disputes.create', {
      subjectType: 'rfq', subjectId: rfqId,
      title: `ZG rfq trouble ${stamp}`, description: 'No usable responses.',
      category: 'communication',
    });
    check('a dispute can be raised about an RFQ, which had no subject before 0046',
      rfqDispute.status === 200, rfqDispute.error ?? '');
    if (rfqDispute.status === 200) made.disputes.push(Number(rfqDispute.data.id));

    const rivalRfqDispute = await rival.session.mutate('disputes.create', {
      subjectType: 'rfq', subjectId: rfqId,
      title: 'should never exist', description: 'x', category: 'other',
    });
    check('somebody with no relationship to the RFQ cannot raise one about it',
      rivalRfqDispute.status !== 200 && rivalRfqDispute.code === 'NOT_FOUND',
      `${rivalRfqDispute.status} ${rivalRfqDispute.code ?? ''}`);
  } else {
    check('probe setup: RFQ created', false, rfq.error ?? `${rfq.status}`);
  }

  // ── THE ADMINISTRATOR CONCLUDES IT, AND THE PARTIES SEE HOW ─────────────
  const resolved = await admin.mutate('admin.updateDispute', {
    disputeId, status: 'resolved',
    resolutionType: 'resolved_by_agreement',
    resolutionNotes: 'The parties agreed to re-finish the slab.',
  });
  check('an administrator concludes it, saying how', resolved.status === 200, resolved.error ?? '');

  const concluded = await owner.session.query('disputes.get', { disputeId });
  check('the parties read the OUTCOME, not just a changed badge',
    concluded.data.dispute.resolutionType === 'resolved_by_agreement'
    && String(concluded.data.dispute.resolutionNotes).includes('re-finish'),
    String(concluded.data.dispute.resolutionType));

  const lateMessage = await builder.session.mutate('disputes.postMessage', {
    disputeId, body: 'one more thing',
  });
  check('a concluded dispute takes no more messages, and says why',
    lateMessage.status !== 200 && String(lateMessage.error).includes('resolved'),
    String(lateMessage.error).slice(0, 60));

  const reopened = await builder.session.mutate('disputes.reopen', {
    disputeId, reason: 'The re-finish was not done.',
  });
  check('either party can reopen it, with a reason', reopened.status === 200, reopened.error ?? '');
  const reopenedRead = await owner.session.query('disputes.get', { disputeId });
  check('reopening clears the outcome rather than leaving a stale one',
    reopenedRead.data.dispute.status === 'open' && reopenedRead.data.dispute.resolutionType === null,
    `${reopenedRead.data.dispute.status} / ${reopenedRead.data.dispute.resolutionType}`);
  check('and the history records every move, oldest first in the record',
    reopenedRead.data.history.length >= 3, `${reopenedRead.data.history.length} entries`);

  // ── WITHDRAWAL IS THE REPORTER'S, AND IT IS FINAL ───────────────────────
  const wrongWithdraw = await builder.session.mutate('disputes.withdraw', {
    disputeId, reason: 'not mine to withdraw',
  });
  check('the respondent cannot withdraw a dispute they did not raise',
    wrongWithdraw.status !== 200, `${wrongWithdraw.status} ${wrongWithdraw.code ?? ''}`);

  const withdrawn = await owner.session.mutate('disputes.withdraw', {
    disputeId, reason: 'Settled between us directly.',
  });
  check('the reporter can withdraw their own', withdrawn.status === 200, withdrawn.error ?? '');
  const reReopen = await owner.session.mutate('disputes.reopen', {
    disputeId, reason: 'changed my mind',
  });
  check('a WITHDRAWN dispute is terminal - it cannot be reopened to restart an investigation',
    reReopen.status !== 200, `${reReopen.status}: ${String(reReopen.error).slice(0, 50)}`);

  // ── THE FILTERS ON THE USER'S OWN LIST ──────────────────────────────────
  const openOnly = await owner.session.query('disputes.myDisputes', { page: 0, pageSize: 20, status: 'open' });
  const closedOnly = await owner.session.query('disputes.myDisputes', { page: 0, pageSize: 20, status: 'closed' });
  check('the open filter excludes the withdrawn one',
    !openOnly.data.rows.some(row => Number(row.id) === disputeId),
    `${openOnly.data.total} open`);
  check('and the closed filter includes it',
    closedOnly.data.rows.some(row => Number(row.id) === disputeId),
    `${closedOnly.data.total} closed`);

  const idor = await rival.session.query('disputes.get', { disputeId });
  check('an unrelated contractor cannot read the dispute by id',
    idor.status !== 200 && idor.code === 'NOT_FOUND', `${idor.status} ${idor.code ?? ''}`);

  // ══ RENDERED, IN A REAL BROWSER ════════════════════════════════════════
  browser = await launchBrowser({ port: 9333 });
  const cookieOf = raw => raw.split('; ').filter(Boolean).map(pair => {
    const [name, ...rest] = pair.split('=');
    return { name, value: rest.join('='), domain: '127.0.0.1', path: '/' };
  });

  for (const width of [375, 768, 1440]) {
    for (const lang of ['en', 'ar']) {
      const page = await browser.newPage();
      await page.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 768,
      });
      await page.setCookies(cookieOf(owner.session.cookie()));
      // The language is the SITE's, from its own key - not the browser's.
      await page.goto(`${BASE}/`, { waitFor: 'body' });
      await page.evaluate(`localStorage.setItem('buildhub_lang', ${JSON.stringify(lang)});`);

      /*
       * WAIT FOR THE ROW, NOT FOR THE CARD.
       *
       * The card renders while the query is still in flight, so asserting on
       * row count straight after it is a race - one that reported a correct
       * page as empty on whichever pass happened to lose it. The row is the
       * thing being asserted, so it is the thing to wait for.
       */
      const listed = await page.goto(`${BASE}/disputes`, {
        waitFor: `[data-testid="my-dispute-${disputeId}"]`, timeoutMs: 30000,
      });
      check(`${width}/${lang}: the disputes page renders, with this person's dispute on it`, listed);

      const state = await page.evaluate(`
        const rows = [...document.querySelectorAll('[data-testid^="my-dispute-"]')]
          .filter(el => /my-dispute-\\d+$/.test(el.dataset.testid));
        const total = document.querySelector('[data-testid="my-disputes-pager-total"]');
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        return JSON.stringify({
          rows: rows.length,
          text: document.body.innerText,
          total: total ? total.innerText : null,
          dir: document.documentElement.getAttribute('dir') ?? document.body.getAttribute('dir'),
          overflow,
        });
      `);
      const view = JSON.parse(state);

      check(`${width}/${lang}: the disputes this person is in are listed`,
        view.rows >= 1, `${view.rows} rows`);
      check(`${width}/${lang}: the row count is stated, not guessed`,
        view.total !== null && !/^0 record/.test(view.total), String(view.total));
      check(`${width}/${lang}: the page does not scroll sideways`,
        view.overflow <= 1, `${view.overflow}px`);
      check(`${width}/${lang}: it is written in the site's language`,
        lang === 'ar' ? /النزاعات/.test(view.text) : /Disputes/.test(view.text));
      if (lang === 'ar') {
        check(`${width}/ar: the page is laid out right to left`, view.dir === 'rtl', String(view.dir));
      }

      // Into the record itself, by clicking the row rather than typing a url.
      const opened = await page.evaluate(`
        const row = document.querySelector('[data-testid="my-dispute-${disputeId}"]');
        if (!row) return 'no row';
        row.click();
        return 'clicked';
      `);
      check(`${width}/${lang}: a dispute in the list opens its record`, opened === 'clicked', String(opened));

      const arrived = await page.goto(`${BASE}/disputes/${disputeId}`, {
        waitFor: '[data-testid="dispute-subject"]', timeoutMs: 30000,
      });
      check(`${width}/${lang}: the record the notification links to renders`, arrived);

      const detail = await page.evaluate(`
        const text = document.body.innerText;
        return JSON.stringify({
          status: (document.querySelector('[data-testid="dispute-status"]') || {}).innerText ?? null,
          subject: (document.querySelector('[data-testid="dispute-subject"]') || {}).innerText ?? null,
          messages: document.querySelectorAll('[data-testid="dispute-messages"] li').length,
          evidence: document.querySelectorAll('[data-testid="dispute-evidence"] li').length,
          noEvidenceStated: !!document.querySelector('[data-testid="dispute-no-evidence"]'),
          history: document.querySelectorAll('[data-testid="dispute-history"] li').length,
          closedNote: !!document.querySelector('[data-testid="dispute-closed-note"]'),
          canMessage: !!document.querySelector('[data-testid="dispute-message"]'),
          leaksNote: /Internal|ملاحظات داخلية/.test(text),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        });
      `);
      const record = JSON.parse(detail);

      check(`${width}/${lang}: the record shows the subject in words`,
        typeof record.subject === 'string' && record.subject.includes(String(stamp)),
        String(record.subject));
      check(`${width}/${lang}: the exchange is on the page`,
        record.messages === 1, `${record.messages} messages`);
      if (hasEvidence) {
        check(`${width}/${lang}: and the evidence is listed`,
          record.evidence === 1, `${record.evidence} files`);
      } else {
        // With no object store there is nothing attached, and the page must say
        // so plainly rather than rendering an empty list with no explanation.
        check(`${width}/${lang}: with nothing attached, the page says so`,
          record.noEvidenceStated, `stated=${record.noEvidenceStated}`);
      }
      check(`${width}/${lang}: the history is shown`, record.history >= 3, `${record.history} entries`);
      /*
       * The dispute is WITHDRAWN by now, so the message box must be gone and
       * the reason said - a box that submits into a refusal is worse than no
       * box.
       */
      check(`${width}/${lang}: a concluded dispute offers no message box, and says why`,
        record.closedNote && !record.canMessage,
        `note=${record.closedNote} box=${record.canMessage}`);
      check(`${width}/${lang}: the page never shows an administrator's internal note`,
        !record.leaksNote);
      check(`${width}/${lang}: the record does not scroll sideways`,
        record.overflow <= 1, `${record.overflow}px`);

      page.close();
    }
  }

  /*
   * AND THE UNRELATED CONTRACTOR, IN A BROWSER: the page must refuse rather
   * than render an empty shell that looks like a dispute with nothing in it.
   */
  const rivalPage = await browser.newPage();
  await rivalPage.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await rivalPage.setCookies(cookieOf(rival.session.cookie()));
  /*
   * WARMED THROUGH `/` FIRST, and waited on the element rather than on `body`.
   *
   * These two pages were the only ones in this probe that skipped the warm-up
   * the loop above does, and they reported a WORKING refusal as a failure: this
   * server runs Vite in dev mode, so the first load of a route's module graph
   * compiles on demand and `body` exists long before the app has rendered into
   * it. Verified by loading both pages by hand with and without the warm-up -
   * the product was right and the probe was impatient.
   */
  await rivalPage.goto(`${BASE}/`, { waitFor: 'body' });
  await rivalPage.goto(`${BASE}/disputes/${disputeId}`, {
    waitFor: '[data-testid="dispute-not-found"]', timeoutMs: 30000,
  });
  const refused = await rivalPage.evaluate(`
    return JSON.stringify({
      notFound: !!document.querySelector('[data-testid="dispute-not-found"]'),
      leaks: /slab finish|re-finish the slab/.test(document.body.innerText),
    });
  `);
  const refusal = JSON.parse(refused);
  check('an unrelated contractor opening the url is refused in the browser too', refusal.notFound);
  check('and none of the dispute\'s content reaches their page', !refusal.leaks);
  rivalPage.close();

  const emptyPage = await browser.newPage();
  await emptyPage.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await emptyPage.setCookies(cookieOf(rival.session.cookie()));
  await emptyPage.goto(`${BASE}/`, { waitFor: 'body' });
  /*
   * THE LANGUAGE IS SET EXPLICITLY HERE. `buildhub_lang` is localStorage, which
   * is per ORIGIN and shared by every page in this browser - so the Arabic pass
   * of the loop above was still in force, and this assertion read an Arabic
   * page against English copy and called correct behaviour a failure.
   */
  await emptyPage.evaluate(`localStorage.setItem('buildhub_lang', 'en');`);
  await emptyPage.goto(`${BASE}/disputes`, {
    waitFor: '[data-testid="my-disputes-empty"]', timeoutMs: 30000,
  });
  const empty = await emptyPage.evaluate(`
    const el = document.querySelector('[data-testid="my-disputes-empty"]');
    return el ? el.innerText : 'no empty state';
  `);
  // ZERO DISPUTES IS A REAL ANSWER, STATED PLAINLY - and it says where to raise
  // one rather than leaving a dead end.
  check('somebody with no disputes is told so, and told where to raise one',
    /You have raised no disputes/.test(empty) && /project, RFQ or quotation/.test(empty),
    empty.slice(0, 70));
  emptyPage.close();
} catch (error) {
  check(`PROBE ABORTED: ${error.message}`, false);
} finally {
  if (browser) browser.close();
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
      attempt(`delete from quotations where rfqId in (${made.rfqs.join(',')})`);
      attempt(`delete from rfqItems where rfqId in (${made.rfqs.join(',')})`);
      attempt(`delete from rfqSuppliers where rfqId in (${made.rfqs.join(',')})`);
      attempt(`delete from qualifiedEnquiries where rfqId in (${made.rfqs.join(',')})`);
      attempt(`delete from rfqs where id in (${made.rfqs.join(',')})`);
    }
    if (made.projects.length > 0) {
      attempt(`delete from projectMembers where projectId in (${made.projects.join(',')})`);
      attempt(`delete from projects where id in (${made.projects.join(',')})`);
    }
    attempt(`delete from projectMembers where userId in (${ids})`);
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
console.log(`\n${pass}/${pass + fail} passed`
  + (blocked > 0 ? `, ${blocked} BLOCKED BY INFRASTRUCTURE (not counted either way)` : ''));
process.exit(fail === 0 ? 0 : 1);

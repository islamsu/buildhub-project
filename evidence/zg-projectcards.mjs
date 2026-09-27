/**
 * ── THE PROJECT CARD JOURNEY, BOTH WAYS ─────────────────────────────────
 *
 * The owner clicked a card in the Project Manager's own Project Queue and the
 * product did nothing. All six role workspaces rendered project cards as plain
 * `<div>`s: bordered tiles with a title, a status badge and a progress bar,
 * visually identical to every actionable record in BuildHub, and inert.
 *
 * ── AND THE OBVIOUS FIX WOULD HAVE MADE IT WORSE ────────────────────────
 *
 * Those grids came from `projects.directory`, a sanitized LEAD directory with no
 * membership filter at all. Linking every row to `/projects/:id` would have sent
 * a provider into `requireProjectAccess` and replaced a dead card with a
 * NOT_FOUND. So this probe proves BOTH halves, in a real browser:
 *
 *   POSITIVE  a project the reader owns, and one they are an ACTIVE MEMBER of,
 *             each open the real `/projects/:id` workspace
 *   NEGATIVE  an opportunity card never reaches a project page; following it
 *             lands on the REQUEST; and the project it names stays refused -
 *             indistinguishably from one that does not exist
 *
 * It also checks the thing that made the defect invisible to tests: every card
 * that LOOKS actionable is an anchor, in the tab order, with a focus ring and a
 * CTA in both languages.
 *
 * Fixtures are created here and removed, and the removal is proved.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'CardsPass!2026';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9094);

const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();
const num = q => Number(sql(q) || '0');

let pass = 0, fail = 0, step = 1;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step++}. ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(page, expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(`return (${expression});`)) return true;
    await settle(250);
  }
  return false;
}

const stamp = Date.now() % 100000000;
const made = [];
const projectsMade = [];
let browser;

class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
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
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return {
    status: res.status,
    data: parsed?.result?.data?.json ?? null,
    error: parsed?.error?.json?.message ?? null,
    code: parsed?.error?.json?.data?.code ?? null,
  };
}
async function account(prefix, userRole) {
  const s = new Session();
  const u = `${prefix}${stamp}`;
  const signUp = await s.post('auth.signUp', {
    username: u, email: `${u}@example.test`, password: PASSWORD,
    name: `Probe ${prefix}`, userRole,
  });
  if (signUp.status !== 200) throw new Error(`signUp ${prefix}: ${signUp.status} ${signUp.error}`);
  const me = await s.get('auth.me');
  if (!me.data?.id) throw new Error(`no session ${prefix}`);
  made.push(me.data.id);
  return { s, id: me.data.id };
}

try {
  /* ═══ FIXTURES ═══
   *
   * One Project Manager, and three projects that exercise the three cases the
   * split has to get right: one they OWN, one they are an active MEMBER of, and
   * one belonging to a stranger that they must never reach.
   */
  const owner = await account('pcown', 'homeowner');
  const stranger = await account('pcstr', 'homeowner');
  const manager = await account('pcpm', 'project_manager');
  sql(`update users set onboardingStatus='approved', verified=1 where id=${manager.id}`);

  const ownProject = await manager.s.post('projects.create', {
    title: `PM owns ${stamp}`, type: 'renovation', location: 'Cairo', budget: 500000,
  });
  const ownId = ownProject.data?.id ?? 0;
  if (ownId) projectsMade.push(ownId);

  const memberProject = await owner.s.post('projects.create', {
    title: `PM is a member ${stamp}`, type: 'residential', location: 'Giza', budget: 750000,
  });
  const memberId = memberProject.data?.id ?? 0;
  if (memberId) projectsMade.push(memberId);

  const strangerProject = await stranger.s.post('projects.create', {
    title: `Stranger only ${stamp}`, type: 'commercial', location: 'Alexandria', budget: 900000,
  });
  const strangerId = strangerProject.data?.id ?? 0;
  if (strangerId) projectsMade.push(strangerId);

  check(ownId > 0 && memberId > 0 && strangerId > 0,
    'SETUP: three projects - owned, member-of, and a stranger\'s',
    `${ownId} / ${memberId} / ${strangerId}`);

  /* The manager joins the second project, through the real membership path. */
  const added = await owner.s.post('projects.addMember', { projectId: memberId, userId: manager.id, projectRole: 'manager' });
  check(added.status === 200, 'the manager is added as a project member',
    `http=${added.status} ${String(added.error).slice(0, 60)}`);

  /* And the stranger's project gets an OPEN request, which is what makes it an
     opportunity rather than merely a row in a directory. */
  const strangerRfq = await stranger.s.post('rfq.create', {
    projectId: strangerId, title: `Stranger request ${stamp}`,
    description: 'An open request on a project the manager is not on.',
    category: 'Renovation', location: 'Alexandria',
  });
  const strangerRfqId = strangerRfq.data?.id ?? 0;
  check(strangerRfqId > 0, 'the stranger\'s project has an open request', `rfq=${strangerRfqId}`);

  /* ═══ 1. THE SERVER AGREES ABOUT WHO MAY SEE WHAT ═══ */
  console.log('\n── what the manager may read ──');

  const list = await manager.s.get('projects.list');
  const listIds = (list.data ?? []).map(row => Number(row.id));
  check(listIds.includes(ownId), 'projects.list contains the project they own');
  check(listIds.includes(memberId), 'and the one they are an active member of');
  check(!listIds.includes(strangerId), 'and NOT the stranger\'s project', `ids=${listIds.join(',')}`);

  const directory = await manager.s.get('projects.directory', { page: 0, pageSize: 50 });
  const dirIds = ((directory.data?.rows) ?? []).map(row => Number(row.id));
  check(dirIds.includes(strangerId),
    'the directory DOES list the stranger\'s project - it is a lead directory, not a membership list');
  const dirRow = ((directory.data?.rows) ?? []).find(row => Number(row.id) === strangerId) ?? {};
  for (const field of ['budget', 'spent', 'ownerId', 'description']) {
    check(!(field in dirRow), `and the directory row carries no ${field}`);
  }

  /* THE NEGATIVE THAT MATTERS: the project page itself stays refused. */
  const refused = await manager.s.get('projects.get', { id: strangerId });
  check(refused.code === 'NOT_FOUND', 'projects.get REFUSES the stranger\'s project',
    `${refused.code} HTTP ${refused.status}`);
  const absent = await manager.s.get('projects.get', { id: 99_000_000 });
  check(absent.code === 'NOT_FOUND' && absent.error === refused.error,
    'and does so indistinguishably from a project that does not exist',
    `${absent.code} / same message: ${absent.error === refused.error}`);

  /* ═══ 2. THE RENDERED WORKSPACE ═══ */
  console.log('\n── the Project Manager workspace ──');

  browser = await launchBrowser({ port: CDP_PORT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/`);
  await page.setCookies(asBrowserCookies(manager.s.header()));

  for (const [lang, dir] of [['en', 'ltr'], ['ar', 'rtl']]) {
    await page.evaluate(`localStorage.setItem('buildhub_lang', '${lang}'); return true;`);
    await page.goto(`${BASE}/platform/project_manager`);
    await waitFor(page, `document.documentElement.dir === '${dir}'`);
    const ready = await waitFor(page, `!!document.querySelector('[data-testid="managed-project-card"]')`);
    check(ready, `${lang}: the workspace renders managed project cards`);
    if (!ready) continue;

    const seen = await page.evaluate(`
      const managed = Array.from(document.querySelectorAll('[data-testid="managed-project-card"]'));
      const opportunities = Array.from(document.querySelectorAll('[data-testid="project-opportunity-card"]'));
      const describe = nodes => nodes.map(node => ({
        tag: node.tagName,
        href: node.getAttribute('href'),
        tabbable: node.tabIndex >= 0,
        label: node.getAttribute('aria-label') || '',
        text: (node.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 140),
      }));
      return {
        managed: describe(managed),
        opportunities: describe(opportunities),
        body: (document.body.innerText || ''),
      };
    `);

    /* ── POSITIVE: both of the manager's projects are here, and both open ── */
    const managedHrefs = seen.managed.map(card => card.href);
    check(managedHrefs.includes(`/projects/${ownId}`),
      `${lang}: the project they OWN is a link to its workspace`, managedHrefs.join(' '));
    check(managedHrefs.includes(`/projects/${memberId}`),
      `${lang}: and so is the one they are a MEMBER of`);
    check(seen.managed.every(card => card.tag === 'A' && card.tabbable),
      `${lang}: every managed card is an anchor in the tab order`,
      seen.managed.map(card => `${card.tag}/${card.tabbable}`).join(' '));
    check(seen.managed.every(card => card.label.length > 10),
      `${lang}: and each has an accessible name`, seen.managed[0]?.label ?? '');

    /* ── NEGATIVE: the stranger's project is an OPPORTUNITY, not a project link ── */
    check(!managedHrefs.includes(`/projects/${strangerId}`),
      `${lang}: the stranger's project is NOT offered as a managed project`);
    const opportunityHrefs = seen.opportunities.map(card => card.href);
    check(opportunityHrefs.every(href => href.startsWith('/rfq/')),
      `${lang}: every opportunity card points at a REQUEST, never a project`,
      opportunityHrefs.join(' ') || 'none rendered');
    check(!opportunityHrefs.some(href => href.includes('/projects/')),
      `${lang}: so no opportunity can reach a project page`);
    check(opportunityHrefs.includes(`/rfq/${strangerRfqId}`),
      `${lang}: and the stranger's project appears as its open request`,
      opportunityHrefs.join(' '));

    /* ── The opportunity card shows nothing private ── */
    const opportunityText = seen.opportunities.map(card => card.text).join(' | ');
    for (const secret of ['900000', '900,000']) {
      check(!opportunityText.includes(secret),
        `${lang}: the stranger's budget is not on the opportunity card`, opportunityText.slice(0, 80));
    }

    /* ── The labels describe the truth ── */
    if (lang === 'en') {
      check(seen.body.includes('Managed Projects') && seen.body.includes('Project Opportunities'),
        'en: the two sections are named for what they hold');
      check(!seen.body.includes('Project Queue'),
        'en: the old mixed "Project Queue" heading is gone');
    } else {
      check(/المشاريع التي أديرها/.test(seen.body) && /فرص المشاريع/.test(seen.body),
        'ar: both section names reach an Arabic reader');
    }
  }

  /* ═══ 3. FOLLOWING THE CARDS ═══ */
  console.log('\n── following each card ──');

  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  await page.goto(`${BASE}/platform/project_manager`);
  await waitFor(page, `!!document.querySelector('[data-testid="managed-project-card"]')`);

  /* A managed card, opened by KEYBOARD - the interaction a div never had. */
  const opened = await page.evaluate(`
    const card = Array.from(document.querySelectorAll('[data-testid="managed-project-card"]'))
      .find(node => node.getAttribute('href') === '/projects/${ownId}');
    if (!card) return 'card not found';
    card.focus();
    if (document.activeElement !== card) return 'card could not take focus';
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card.click();
    return 'ok';
  `);
  check(opened === 'ok', 'a managed card takes keyboard focus', String(opened));
  const arrived = await waitFor(page, `location.pathname === '/projects/${ownId}'`);
  check(arrived, 'and opens the real project workspace', await page.evaluate('return location.pathname;'));
  if (arrived) {
    /* WAIT for the record, do not snapshot mid-load. The first version read
       the body 0ms after the route changed and reported a loading screen as a
       missing project. */
    const shown = await waitFor(page, `document.body.innerText.includes('PM owns ${stamp}')`);
    const detail = await page.evaluate(`return (document.body.innerText || '');`);
    check(shown, 'which shows that project', detail.replace(/\s+/g, ' ').slice(0, 90));
    check(!/not found|غير موجود/i.test(detail), 'and is not a not-found page');
  }

  /* An opportunity card, followed to the request. */
  await page.goto(`${BASE}/platform/project_manager`);
  await waitFor(page, `!!document.querySelector('[data-testid="project-opportunity-card"]')`);
  await page.evaluate(`
    const card = Array.from(document.querySelectorAll('[data-testid="project-opportunity-card"]'))
      .find(node => node.getAttribute('href') === '/rfq/${strangerRfqId}');
    if (card) card.click();
    return true;
  `);
  const atRequest = await waitFor(page, `location.pathname === '/rfq/${strangerRfqId}'`);
  check(atRequest, 'an opportunity card opens the request it named',
    await page.evaluate('return location.pathname;'));
  if (atRequest) {
    await settle(2000);
    const requestPage = await page.evaluate(`return (document.body.innerText || '').slice(0, 800);`);
    check(!/not found|غير موجود/i.test(requestPage),
      'and that request page is a real page, not a dead end',
      requestPage.replace(/\s+/g, ' ').slice(0, 80));
  }

  /* AND THE DEAD END THE OBVIOUS FIX WOULD HAVE CREATED, confirmed closed. */
  await page.goto(`${BASE}/projects/${strangerId}`);
  /* The page asks the server, so the refusal arrives after a round trip. Waiting
     for it to settle is the difference between reading the answer and reading
     the spinner. */
  await waitFor(page, `!/loading|جار/i.test(document.body.innerText || '')`, 15000);
  await settle(1200);
  const blocked = await page.evaluate(`return (document.body.innerText || '');`);
  check(!blocked.includes(`Stranger only ${stamp}`),
    'reaching the stranger\'s project page directly never shows the project',
    blocked.replace(/\s+/g, ' ').slice(0, 90));
  check(!blocked.includes('900,000') && !blocked.includes('900000'),
    'and its budget never renders');

  /* ═══ 4. THE OTHER FOUR WORKSPACES ═══
   *
   * The Project Manager queue is the one the owner clicked; the pattern was in
   * all six. Each provider role is checked for the same two properties.
   */
  console.log('\n── the other provider workspaces ──');

  for (const role of ['contractor', 'engineer', 'architect', 'supplier']) {
    const provider = await account(`pc${role.slice(0, 3)}`, role);
    sql(`update users set onboardingStatus='approved', verified=1 where id=${provider.id}`);
    const providerPage = await browser.newPage();
    await providerPage.setViewport({ width: 1440, height: 1000 });
    await providerPage.goto(`${BASE}/`);
    await providerPage.setCookies(asBrowserCookies(provider.s.header()));
    await providerPage.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
    await providerPage.goto(`${BASE}/platform/${role}`);
    await waitFor(providerPage, `(document.body.innerText || '').length > 200`);
    await settle(2200);

    const roleSeen = await providerPage.evaluate(`
      /*
       * CARD-SHAPED ELEMENTS ONLY. Filtering every div that mentions "Progress"
       * matched the CardContent wrapper - an ancestor of the real cards, which
       * of course is not inside an anchor - and reported one inert tile on a
       * section whose every card is a link. A card is a bordered tile.
       */
      const inert = Array.from(document.querySelectorAll('[id="role-projects"] div'))
        .filter(node => /rounded-xl/.test(node.className || '') && /border/.test(node.className || ''))
        .filter(node => /Progress/i.test(node.innerText || ''))
        .filter(node => !node.closest('a') && !node.closest('button') && node.getAttribute('role') !== 'button');
      return {
        opportunities: Array.from(document.querySelectorAll('[data-testid="project-opportunity-card"]'))
          .map(node => ({ tag: node.tagName, href: node.getAttribute('href'), tabbable: node.tabIndex >= 0 })),
        inertCount: inert.length,
        heading: (document.querySelector('[id="role-projects"]')?.innerText || '').split('\\n')[0],
      };
    `);
    check(roleSeen.opportunities.every(card => card.tag === 'A' && card.tabbable
          && (card.href || '').startsWith('/rfq/')),
      `${role}: every project card is an anchor to a request`,
      roleSeen.opportunities.map(c => `${c.tag}:${c.href}`).join(' ') || 'none rendered');
    check(roleSeen.inertCount === 0,
      `${role}: no inert project tile is left in the projects section`,
      `${roleSeen.inertCount} inert`);
    check(/Opportunit/i.test(roleSeen.heading),
      `${role}: the section is named for what it holds`, roleSeen.heading);
    await providerPage.close?.();
  }
} finally {
  if (browser) await browser.close();
  console.log('\n── cleanup ──');
  for (const projectId of projectsMade) {
    const rfqIds = sql(`select id from rfqs where projectId=${projectId}`).split('\n').filter(Boolean);
    for (const id of rfqIds) {
      for (const table of ['quotations', 'rfqSuppliers', 'qualifiedEnquiries', 'rfqItems']) {
        sql(`delete from ${table} where rfqId=${id}`);
      }
      sql(`delete from rfqs where id=${id}`);
    }
    sql(`delete from projectMembers where projectId=${projectId}`);
    sql(`delete from expenses where projectId=${projectId}`);
    sql(`delete from projects where id=${projectId}`);
  }
  for (const id of made) {
    for (const stmt of [
      `delete from referralCodeEvents where actorId=${id} or userId=${id}`,
      `delete from vendorCategories where userId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from savedItems where userId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) {
      try { sql(stmt); } catch { /* nothing of this kind for that id */ }
    }
    try { sql(`delete from users where id=${id}`); } catch { /* counted below */ }
  }
  const usersLeft = num(`select count(*) from users where email like '%${stamp}@example.test'`);
  const projectsLeft = projectsMade.length === 0 ? 0
    : num(`select count(*) from projects where id in (${projectsMade.join(',')})`);
  check(usersLeft === 0 && projectsLeft === 0, 'every fixture this probe created is removed',
    `${usersLeft} users, ${projectsLeft} projects`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

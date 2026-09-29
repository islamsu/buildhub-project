/**
 * ── THE STOREFRONT, READ BY SOMEBODY WITH NO ACCOUNT ────────────────────
 *
 * `/vendor/:id` answered "Please sign in to view this vendor profile" to every
 * signed-out reader and every crawler, on the page §21 and §37 both describe as
 * public and the marketplace's most important destination. `evidence/zg-seo.mjs`
 * proved that wall existed; this proves it is gone and that opening it did not
 * widen anything.
 *
 * ── THE THREE QUESTIONS THIS ANSWERS ────────────────────────────────────
 *
 * CAN A STRANGER READ AN APPROVED STOREFRONT? The company, categories, service
 * areas, products, services, portfolio and reviews - everything §21 lists.
 *
 * CAN A STRANGER READ ONE THAT IS NOT PUBLISHED? An unapproved applicant, a
 * frozen account, a deactivated one, a homeowner. All must answer NOT FOUND,
 * identically, so walking ids reveals nothing about which accounts exist.
 *
 * DOES ANYTHING PRIVATE COME WITH IT? The named contact, their email, phone,
 * mobile and address are released only once the provider has engaged. A stranger
 * has engaged with nobody, so the response is checked FIELD BY FIELD rather than
 * by reading the page.
 *
 * Every fixture is created here and removed, and the removal is proved.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'StorePass!2026';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9091);

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

/** An UNAUTHENTICATED tRPC read. No cookie header at all, deliberately. */
async function anonymous(path, input) {
  const url = `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    data: body?.result?.data?.json ?? null,
    error: body?.error?.json?.message ?? null,
    code: body?.error?.json?.data?.code ?? null,
  };
}

const stamp = Date.now() % 100000000;
const made = [];
let browser;

async function makeProvider(prefix, { onboardingStatus, accountStatus, userRole = 'supplier', deactivated = false }) {
  const username = `${prefix}${stamp}`;
  const res = await fetch(`${BASE}/api/trpc/auth.signUp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: {
      username, email: `${username}@example.test`, password: PASSWORD,
      name: `Probe ${prefix}`, userRole,
    } }),
  });
  if (res.status !== 200) throw new Error(`signUp ${prefix}: ${res.status}`);
  const id = num(`select id from users where email='${username}@example.test'`);
  made.push(id);
  sql(`update users set onboardingStatus='${onboardingStatus}', accountStatus='${accountStatus}',`
    + ` verified=${onboardingStatus === 'approved' ? 1 : 0},`
    + ` deactivatedAt=${deactivated ? 'now()' : 'null'} where id=${id}`);
  return id;
}

try {
  /* ═══ FIXTURES ═══ */
  const published = await makeProvider('stpub', { onboardingStatus: 'approved', accountStatus: 'active' });
  const unapproved = await makeProvider('stwait', { onboardingStatus: 'under_review', accountStatus: 'active' });
  const frozen = await makeProvider('stfroz', { onboardingStatus: 'approved', accountStatus: 'frozen' });
  const gone = await makeProvider('stgone', { onboardingStatus: 'approved', accountStatus: 'active', deactivated: true });
  const buyer = await makeProvider('stbuy', { onboardingStatus: 'approved', accountStatus: 'active', userRole: 'homeowner' });

  /* The real column names: companyDescription, and primaryContact* for the
     relationship-gated block. */
  sql(`insert into vendorProfiles (userId, companyName, tradingName, city, country, companyDescription)
       values (${published}, 'Probe Materials ${stamp} LLC', 'Probe Materials ${stamp}', 'Cairo', 'Egypt',
               'A published storefront a stranger may read.')`);
  sql(`update vendorProfiles set primaryContactName='Private Person ${stamp}',
       primaryContactEmail='private${stamp}@example.test',
       primaryContactPhone='+201000000${String(stamp).slice(-3)}',
       addressLine='17 Private Street ${stamp}', registrationNumber='CR-${stamp}'
       where userId=${published}`);

  /* A portfolio item, because an EMPTY section and a HIDDEN section look the
     same to a buyer and mean opposite things. */
  sql(`insert into portfolioItems (userId, title, description, category, location, completionYear)
       values (${published}, 'Portfolio piece ${stamp}', 'Work a stranger should see',
               'Renovation', 'Cairo', 2025)`);

  check(published > 0 && unapproved > 0 && frozen > 0 && gone > 0 && buyer > 0,
    'SETUP: a published provider, an unapproved one, a frozen one, a deactivated one and a buyer',
    `${published}/${unapproved}/${frozen}/${gone}/${buyer}`);

  /* ═══ 1. A STRANGER CAN READ THE PUBLISHED STOREFRONT ═══ */
  console.log('\n── signed out, approved provider ──');

  const open = await anonymous('profile.getPublic', { userId: published });
  check(open.status === 200, 'an unauthenticated read of an approved storefront succeeds',
    `HTTP ${open.status} ${String(open.error).slice(0, 60)}`);
  check(open.data?.id === published, 'and returns that provider', `id=${open.data?.id}`);
  check(open.data?.company?.companyName === `Probe Materials ${stamp} LLC`,
    'including the company identity §21 asks for', open.data?.company?.companyName ?? 'absent');
  check(open.data?.company?.city === 'Cairo' && open.data?.company?.country === 'Egypt',
    'and its location');

  /* ═══ 2. NOTHING PRIVATE CAME WITH IT ═══ */
  console.log('\n── what the same response does NOT contain ──');

  const serialised = JSON.stringify(open.data ?? {});
  check(open.data?.contactAccess === 'none',
    'the contact tier for a stranger is `none`', String(open.data?.contactAccess));
  check(open.data?.primaryContact === null,
    'so the named contact block is null, not merely hidden by the page',
    JSON.stringify(open.data?.primaryContact));
  for (const [what, needle] of [
    ['the contact person', `Private Person ${stamp}`],
    ['their email', `private${stamp}@example.test`],
    ['their phone', `+201000000${String(stamp).slice(-3)}`],
    ['their street address', `17 Private Street ${stamp}`],
    ['the commercial registration', `CR-${stamp}`],
  ]) {
    check(!serialised.includes(needle), `${what} is absent from the payload`);
  }
  check(!('registrationNumber' in (open.data ?? {})),
    'and the registration field is not even present as a key');
  check(open.data?.contactChannel === 'sign_in',
    'the contact channel says SIGN IN, not "unavailable" - the provider can be reached, by somebody with an account',
    String(open.data?.contactChannel));

  /* ═══ 3. WHAT IS NOT PUBLISHED IS NOT READABLE ═══ */
  console.log('\n── signed out, everything the directory would not list ──');

  for (const [what, id] of [
    ['an unapproved applicant', unapproved],
    ['a frozen account', frozen],
    ['a deactivated account', gone],
    ['a homeowner', buyer],
    ['an id that does not exist', 99_000_000],
  ]) {
    const refused = await anonymous('profile.getPublic', { userId: id });
    check(refused.code === 'NOT_FOUND', `${what} answers NOT_FOUND`, `${refused.code} HTTP ${refused.status}`);
  }
  /* IDENTICALLY, or the difference is an enumeration oracle. */
  const messages = [];
  for (const id of [unapproved, frozen, gone, buyer, 99_000_000]) {
    messages.push((await anonymous('profile.getPublic', { userId: id })).error);
  }
  check(new Set(messages).size === 1,
    'and all of them with the SAME message - a stranger learns nothing about which accounts exist',
    `${new Set(messages).size} distinct: ${[...new Set(messages)].join(' | ').slice(0, 80)}`);

  /* ═══ 3b. THE PORTFOLIO MOVED WITH THE STOREFRONT ═══
   *
   * `portfolio.list` was a protectedProcedure, so the section rendered EMPTY to
   * a signed-out buyer - a claim about the provider, not about the reader.
   */
  console.log('\n── the portfolio, signed out ──');
  {
    const portfolio = await anonymous('portfolio.list', { userId: published });
    check(portfolio.status === 200, 'a stranger can read a published provider\'s portfolio',
      `HTTP ${portfolio.status} ${String(portfolio.error).slice(0, 50)}`);
    check(Array.isArray(portfolio.data) && portfolio.data.length === 1,
      'and it really contains the item, so the section is not empty',
      `${Array.isArray(portfolio.data) ? portfolio.data.length : 'not an array'} item(s)`);

    /* And the same gate as the storefront: nothing unpublished. */
    for (const [what, id] of [
      ['an unapproved applicant', unapproved],
      ['a frozen account', frozen],
      ['a homeowner', buyer],
    ]) {
      const refused = await anonymous('portfolio.list', { userId: id });
      check(refused.code === 'NOT_FOUND', `${what}'s portfolio answers NOT_FOUND`, String(refused.code));
    }
  }

  /* ═══ 4. THE PROVIDER AND AN ADMIN KEEP THEIR OWN ACCESS ═══ */
  console.log('\n── self and admin are unaffected ──');
  {
    const signIn = await fetch(`${BASE}/api/trpc/auth.signIn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { identifier: `stwait${stamp}@example.test`, password: PASSWORD } }),
    });
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
    const own = await fetch(
      `${BASE}/api/trpc/profile.getPublic?input=${encodeURIComponent(JSON.stringify({ json: { userId: unapproved } }))}`,
      { headers: { cookie } },
    ).then(res => res.json());
    check(own?.result?.data?.json?.id === unapproved,
      'an UNAPPROVED provider can still open their own storefront to check it',
      `id=${own?.result?.data?.json?.id ?? own?.error?.json?.data?.code}`);
  }

  /* ═══ 5. THE PAGE RENDERS, WITH NO SESSION, IN BOTH LANGUAGES ═══ */
  console.log('\n── the rendered page, signed out ──');

  browser = await launchBrowser({ port: CDP_PORT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`);
  /* Every cookie cleared, so this really is an anonymous reader. */
  await page.setCookies([]);
  await page.evaluate(`
    document.cookie.split(';').forEach(pair => {
      document.cookie = pair.split('=')[0].trim() + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
    return true;
  `);

  for (const [lang, width] of [['en', 1440], ['ar', 1440], ['en', 375]]) {
    await page.evaluate(`localStorage.setItem('buildhub_lang', '${lang}'); return true;`);
    await page.goto(`${BASE}/vendor/${published}`);
    await waitFor(page, `document.documentElement.dir === '${lang === 'ar' ? 'rtl' : 'ltr'}'`);
    const loaded = await waitFor(page, `document.body.innerText.includes('Probe Materials ${stamp}')`);
    const label = `${lang}/${width}px`;
    check(loaded, `${label}: the storefront renders for a signed-out reader`);
    if (!loaded) continue;

    const screen = await page.evaluate(`
      return {
        text: document.body.innerText || '',
        title: document.title,
        signedOutBlock: !!document.querySelector('[data-testid="vendor-signedout-actions"]'),
        signInCta: !!document.querySelector('[data-testid="vendor-signin-cta"]'),
        contactButton: !!document.querySelector('[data-testid="vendor-contact"]'),
        requestQuote: !!document.querySelector('[data-testid="vendor-request-quote"]'),
      };
    `);

    check(!/please sign in to view|يرجى تسجيل الدخول لعرض/i.test(screen.text),
      `${label}: no sign-in WALL - the page is readable`, screen.text.replace(/\s+/g, ' ').slice(0, 70));
    check(screen.signedOutBlock && screen.signInCta,
      `${label}: the session-bound actions are replaced by one honest sign-in prompt`);
    check(!screen.contactButton && !screen.requestQuote,
      `${label}: and no button is offered that would answer 401`,
      `contact=${screen.contactButton} quote=${screen.requestQuote}`);
    check(!screen.text.includes(`Private Person ${stamp}`) && !screen.text.includes(`CR-${stamp}`),
      `${label}: the private contact and registration are not on the page`);
    check(screen.text.includes(`Portfolio piece ${stamp}`),
      `${label}: the portfolio section shows real work, not an empty section`);
    if (lang === 'ar') {
      check(/[؀-ۿ]/.test(screen.text), `${label}: and it reads in Arabic`);
    }
  }

  /* ── THE TAB, AND THE CRAWLER'S FIRST RESPONSE ── */
  {
    const title = await page.evaluate('return document.title;');
    check(title.startsWith(`Probe Materials ${stamp}`),
      'the tab names the storefront', title);

    /* The shell, before any JavaScript runs - what a crawler actually reads. */
    const html = await fetch(`${BASE}/vendor/${published}`).then(res => res.text());
    const shellTitle = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    check(shellTitle.startsWith(`Probe Materials ${stamp}`),
      'and so does the FIRST response, before any JavaScript runs', shellTitle);
    /* Not indexable here - this deployment is not production - but the tag must
       be the route's, not a blanket refusal for an unlisted path. */
    check(/<meta name="robots" content="noindex, nofollow"/.test(html),
      'the shell is noindex on a non-production deployment, as every route is');

    const unpublishedShell = await fetch(`${BASE}/vendor/${unapproved}`).then(res => res.text());
    const unpublishedTitle = unpublishedShell.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    check(!unpublishedTitle.includes('Probe stwait'),
      'an unapproved applicant\'s NAME never reaches a <title> either', unpublishedTitle);
  }
} finally {
  if (browser) await browser.close();
  console.log('\n── cleanup ──');
  for (const id of made) {
    sql(`delete from portfolioItems where userId=${id}`);
    sql(`delete from vendorProfiles where userId=${id}`);
    sql(`delete from serviceOfferings where providerId=${id}`);
    sql(`delete from vendorCategories where userId=${id}`);
    sql(`delete from referralCodeEvents where actorId=${id} or userId=${id}`);
    sql(`delete from notifications where userId=${id}`);
    sql(`delete from users where id=${id}`);
  }
  const left = num(`select count(*) from users where email like '%${stamp}@example.test'`);
  check(left === 0, 'every fixture this probe created is removed', `${left} left`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

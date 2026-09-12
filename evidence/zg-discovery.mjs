/**
 * ── THE FOUR NUMBERS ON THE MARKETPLACE HUB, RENDERED ─────────────────────
 *
 * Two of the four section cards counted a CONSTANT COMPILED INTO THE PAGE -
 * `DESIGN_CATEGORIES.length` and `FINISHING_CATEGORIES.length` - in the same
 * slot, in the same typeface, as the vendors card's count of real accounts.
 * With no designer on the platform the card still read "14 disciplines": a
 * number that cannot move, presented as one that can.
 *
 *   THE COUNT MOVES WITH THE DATA. A designer signs up and is approved, and
 *     the number goes up by one. That is the whole property, and only a live
 *     run can show it.
 *
 *   AND IT IS THE REAL COUNT, agreed with the directory the card links to -
 *     the page behind the number lists exactly that many providers.
 *
 *   THE CHIPS ARE NOT CONTROLS: the card navigates, and the chips describe.
 *
 *   IN BOTH LANGUAGES, at every width, with nothing overflowing.
 */
import { execSync } from 'node:child_process';
import { launchBrowser } from './lib/cdp.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9200 + (process.pid % 90)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B`, { input: q }).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms));
const READY = '!!document.querySelector(\'[data-testid="hub-stat-designers"]\')';
async function waitFor(page, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value = 'false';
    try { value = await page.evaluate(`try { return String(${expression}); } catch { return 'false'; }`); } catch {}
    if (value === 'true') { await settle(250); return true; }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
const hub = page => page.evaluate(`
  const t = k => document.querySelector('[data-testid="' + k + '"]');
  const txt = el => el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
  return JSON.stringify({
    designers: txt(t('hub-stat-designers')),
    designersLabel: txt(t('hub-statlabel-designers')),
    finishing: txt(t('hub-stat-finishing')),
    finishingLabel: txt(t('hub-statlabel-finishing')),
    vendors: txt(t('hub-stat-vendors')),
    products: txt(t('hub-stat-products')),
    chips: txt(t('hub-chips-designers')),
    chipButtons: document.querySelectorAll('[data-testid="hub-chips-designers"] button').length,
    dir: document.documentElement.getAttribute('dir') || 'ltr',
  });
`);

const stamp = Date.now() % 100000000;
const made = [];

async function call(path, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: res.status, data: parsed?.result?.data?.json ?? null,
    cookie: (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ') || cookie || '' };
}
async function designer(prefix) {
  const u = `${prefix}${stamp}`;
  const up = await call('auth.signUp', {
    username: u, email: `${u}@example.test`, password: 'DiscPass!2026',
    name: `Probe designer ${prefix}`, userRole: 'architect',
  });
  if (up.status !== 200) throw new Error(`signUp ${prefix}: ${up.status}`);
  const id = Number(sql(`select id from users where username='${u}'`) || 0);
  made.push(id);
  sql(`update users set onboardingStatus='approved', verified=1 where id=${id}`);
  await call('profile.setMyCategories', { categories: ['Design'] }, up.cookie);
  return id;
}

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/marketplace`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/marketplace`);
  if (!await waitFor(page, READY)) throw new Error('the hub never rendered its section cards');

  const before = JSON.parse(await hub(page));
  check(/^\d+$/.test(before.designers) && /^\d+$/.test(before.finishing),
    '1. the designers and finishing cards carry a number', `${before.designers} / ${before.finishing}`);
  check(/Providers/i.test(before.designersLabel) && /Providers/i.test(before.finishingLabel),
    '2. LABELLED AS WHAT THEY COUNT — providers, not "disciplines"',
    `${before.designersLabel} / ${before.finishingLabel}`);
  // The two constants this used to render, asserted by their real lengths -
  // 14 design disciplines and 21 finishing services. A number that happens to
  // equal one of them is the defect returning.
  check(before.designers !== '14' && before.finishing !== '21',
    '3. and neither is the length of the hardcoded list it used to render',
    `${before.designers} / ${before.finishing}`);

  // ── THE NUMBER MOVES WITH THE DATA ──────────────────────────────────────
  const baseline = Number(before.designers);
  await designer('dsa');
  await designer('dsb');
  await page.goto(`${BASE}/marketplace`);
  if (!await waitFor(page, `document.querySelector('[data-testid="hub-stat-designers"]').innerText.trim() === '${baseline + 2}'`)) {
    // fall through to the assertion, which will report what it actually says
  }
  const after = JSON.parse(await hub(page));
  check(Number(after.designers) === baseline + 2,
    '4. TWO DESIGNERS SIGN UP AND THE COUNT GOES UP BY TWO — a constant cannot do that',
    `${baseline} -> ${after.designers}`);
  check(after.finishing === before.finishing,
    '5. and the finishing card, which gained nobody, does not move',
    `${before.finishing} -> ${after.finishing}`);

  // ── THE NUMBER AGREES WITH THE PAGE BEHIND IT ───────────────────────────
  // Compared against the DIRECTORY QUERY the page behind the card reads, not
  // against a count of rendered cards: the directory's markup carries no
  // per-row test id, and a selector that matches nothing would have compared
  // the card's number to zero and called it agreement.
  const directory = await (await fetch(`${BASE}/api/trpc/marketplace.vendors?input=${encodeURIComponent(JSON.stringify({ json: { limit: 100 } }))}`)).json();
  const rows = directory?.result?.data?.json ?? [];
  const realDesigners = rows.filter(v => (v.categories ?? []).includes('Design')).length;
  check(rows.length > 0 && Number(after.designers) === realDesigners,
    '6. AND THE CARD AGREES WITH THE DIRECTORY BEHIND IT',
    `card=${after.designers} directory=${realDesigners} of ${rows.length} providers`);

  await page.goto(`${BASE}/marketplace/designers`);
  await waitFor(page, `document.body.innerText.length > 200`);
  const designersPage = await page.evaluate(`
    return String(!/Page Not Found/i.test(document.body.innerText));
  `);
  check(designersPage === 'true', '6a. and that page loads rather than 404ing');

  // ── THE CHIPS DESCRIBE, THEY DO NOT FILTER ──────────────────────────────
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, READY);
  const chips = JSON.parse(await hub(page));
  check(chips.chips.length > 4 && chips.chipButtons === 0,
    '7. the chips describe the section and are not controls that filter nothing',
    `buttons=${chips.chipButtons} text=${chips.chips.slice(0, 40)}`);

  // ── ARABIC AND THREE WIDTHS ─────────────────────────────────────────────
  await page.evaluate("localStorage.setItem('buildhub_lang', 'ar'); return true;");
  await page.goto(`${BASE}/marketplace`);
  await waitFor(page, READY);
  const arabic = JSON.parse(await hub(page));
  check(arabic.dir === 'rtl' && /[؀-ۿ]/.test(arabic.designersLabel)
    && !/Providers/i.test(arabic.designersLabel),
    '8. THE ARABIC LABEL IS ARABIC, not English in a flipped layout',
    `dir=${arabic.dir} label=${arabic.designersLabel}`);
  check(arabic.designers === after.designers,
    '9. and the number is the same fact in either language',
    `${after.designers} / ${arabic.designers}`);

  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/marketplace`);
    await waitFor(page, READY);
    const layout = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        visible: !!document.querySelector('[data-testid="hub-stat-designers"]'),
      });
    `));
    check(layout.scroll <= layout.client + 1 && layout.visible,
      `10${width === 375 ? 'a' : width === 768 ? 'b' : 'c'}. readable at ${width}px with no horizontal overflow`,
      `scroll=${layout.scroll} client=${layout.client}`);
  }
} catch (error) {
  check(false, 'PROBE COMPLETED', String(error).slice(0, 200));
} finally {
  try { await browser.close(); } catch {}
  for (const id of made) {
    for (const q of [
      `delete from vendorCategories where userId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from userAccountAuditEvents where userId=${id} or actorId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from fieldValueHistory where actorId=${id} or ownerId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) { try { sql(q); } catch {} }
  }
  for (const id of made) { try { sql(`delete from users where id=${id}`); } catch {} }
  const left = made.length === 0 ? 0 : Number(sql(`select count(*) from users where id in (${made.join(',')})`) || 0);
  check(left === 0, '11. CLEANUP: every account this probe created is gone', `users=${left}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

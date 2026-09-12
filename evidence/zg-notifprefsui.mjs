/**
 * ── THE NOTIFICATION PREFERENCES SCREEN, CLICKED ──────────────────────────
 *
 * The API probe proves the gate: a switch thrown over HTTP really stops the
 * row. What it cannot prove is that a person can find the switch and throw it.
 * That is this file.
 *
 * The three things it exists to catch, none of which a source-reading test can
 * see:
 *
 *   THE SECTION DRAWS AT ALL, inside /settings, for an ordinary account - not
 *     an admin, and not a provider. Every role receives quotations, messages
 *     and review notices, so a section rendered only for providers would be
 *     the reachability defect this project has hit before.
 *
 *   A REAL CLICK PERSISTS. Not a mutation fired by hand: the pointer goes down
 *     on the rendered control, and the value is then read back from a RELOADED
 *     page, so an optimistic UI that never reached the server would fail here.
 *
 *   AND THE LOCKED ONES CANNOT BE CLICKED, in both languages, with no raw
 *     translation key anywhere on the screen and no horizontal scrollbar at
 *     375, 768 or 1440.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
// A PER-RUN PORT. Two probes sharing 9222 fight, and the second reports the
// product as broken when the only thing wrong is the first one's browser.
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9600 + (process.pid % 300)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));

const stamp = Date.now() % 100000000;
const username = `nput${stamp}`;
let userId = 0;

// A REAL ACCOUNT, created through the product's own signup.
const signUp = await fetch(`${BASE}/api/trpc/auth.signUp`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ json: {
    username, email: `${username}@example.test`, password: 'NotifUiPass!2026',
    name: 'Probe notif ui', userRole: 'homeowner',
  } }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
check(signUp.status === 200 && cookie.length > 0, '1. SETUP: an ordinary account signs up and holds a session',
  `http=${signUp.status}`);
userId = Number(sql(`select id from users where username='${username}'`) || 0);

const browser = await launchBrowser({ port: CDP_PORT });
const page = await browser.newPage();

try {
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/settings`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/settings`);
  await settle(2500);

  const present = await page.evaluate(`
    const section = document.querySelector('[data-testid="settings-notifications"]');
    const card = document.querySelector('[data-testid="notification-preferences"]');
    return JSON.stringify({ section: !!section, card: !!card });
  `);
  const state = JSON.parse(present);
  check(state.section && state.card, '2. the Notifications section renders inside /settings for an ordinary account',
    JSON.stringify(state));

  const rows = JSON.parse(await page.evaluate(`
    const all = [...document.querySelectorAll('[data-testid^="notif-pref-"]')]
      .filter(el => el.dataset.testid.split('-').length === 3 || !el.dataset.testid.includes('switch'));
    const cards = [...document.querySelectorAll('[data-testid^="notif-pref-"]')]
      .filter(el => /^notif-pref-[a-z_]+$/.test(el.dataset.testid));
    const locked = [...document.querySelectorAll('[data-testid^="notif-pref-locked-"]')];
    const switches = [...document.querySelectorAll('[data-testid^="notif-pref-switch-"]')];
    return JSON.stringify({
      cards: cards.length,
      locked: locked.map(el => el.dataset.testid.replace('notif-pref-locked-','')).sort(),
      switches: switches.length,
      disabled: switches.filter(el => el.disabled || el.getAttribute('data-disabled') !== null).length,
    });
  `));
  check(rows.cards === 14, '3. all fourteen categories render', `n=${rows.cards}`);
  check(JSON.stringify(rows.locked) === JSON.stringify(['account','billing','compliance','disputes','moderation']),
    '4. and exactly the five mandatory ones carry a lock', rows.locked.join(','));
  check(rows.switches === 14, '5. every category has a switch', `n=${rows.switches}`);
  check(rows.disabled === 5, '6. and exactly the five locked ones are not operable', `disabled=${rows.disabled}`);

  const note = await page.evaluate(`
    const el = document.querySelector('[data-testid="notif-prefs-channel-note"]');
    return el ? el.innerText.trim() : '';
  `);
  check(/email/i.test(note) && /not yet available/i.test(note),
    '7. THE SCREEN SAYS SO: email and SMS are named as unavailable rather than offered',
    note.slice(0, 70));

  // ── A real click, read back from a reloaded page ─────────────────────────
  const before = sql(`select count(*) from notificationPreferences where userId=${userId}`);
  const clicked = await page.evaluate(`
    const el = document.querySelector('[data-testid="notif-pref-switch-messages"]');
    if (!el) return 'missing';
    el.click();
    return 'clicked';
  `);
  await settle(2000);
  const stored = sql(`select category, enabled from notificationPreferences where userId=${userId}`);
  check(clicked === 'clicked' && before === '0' && stored === 'messages\t0',
    '8. A REAL CLICK PERSISTS: the row appears in the database, switched off',
    `before=${before} after=${JSON.stringify(stored)}`);

  await page.goto(`${BASE}/settings`);
  await settle(2500);
  const reloaded = await page.evaluate(`
    const el = document.querySelector('[data-testid="notif-pref-switch-messages"]');
    return el ? el.getAttribute('data-state') : 'missing';
  `);
  check(reloaded === 'unchecked', '9. and a RELOADED page shows it off - the state came from the server',
    String(reloaded));

  // Put it back, through the UI, so the screen is proved in both directions.
  await page.evaluate(`document.querySelector('[data-testid="notif-pref-switch-messages"]').click(); return true;`);
  await settle(2000);
  check(sql(`select enabled from notificationPreferences where userId=${userId}`) === '1',
    '10. clicking it again switches it back on, updating the same row',
    sql(`select count(*) from notificationPreferences where userId=${userId}`) + ' row(s)');

  // ── A locked switch does nothing ─────────────────────────────────────────
  await page.evaluate(`
    const el = document.querySelector('[data-testid="notif-pref-switch-compliance"]');
    if (el) el.click();
    return true;
  `);
  await settle(1200);
  check(!sql(`select category from notificationPreferences where userId=${userId}`).includes('compliance'),
    '11. clicking the locked Compliance switch writes nothing',
    sql(`select group_concat(category) from notificationPreferences where userId=${userId}`));

  // ── No raw keys, either language ─────────────────────────────────────────
  for (const [lang, dirWanted] of [['en', 'ltr'], ['ar', 'rtl']]) {
    await page.evaluate(`localStorage.setItem('buildhub_lang', '${lang}'); return true;`);
    await page.goto(`${BASE}/settings`);
    await settle(2500);
    const report = JSON.parse(await page.evaluate(`
      const card = document.querySelector('[data-testid="notification-preferences"]');
      const text = card ? card.innerText : '';
      return JSON.stringify({
        raw: (text.match(/notifCategory\\.[a-z_.]+|notifPrefs\\.[a-zA-Z.]+/g) || []),
        dir: document.documentElement.getAttribute('dir') || 'ltr',
        length: text.length,
      });
    `));
    check(report.length > 400, `12${lang === 'en' ? 'a' : 'b'}. the ${lang.toUpperCase()} screen has real content to check`,
      `chars=${report.length}`);
    check(report.raw.length === 0, `13${lang === 'en' ? 'a' : 'b'}. no raw translation key is rendered in ${lang.toUpperCase()}`,
      report.raw.slice(0, 3).join(','));
    check(report.dir === dirWanted, `14${lang === 'en' ? 'a' : 'b'}. the document direction is ${dirWanted}`, report.dir);
  }

  // Arabic must not be the English string - an untranslated copy would pass
  // every check above.
  const arabic = await page.evaluate(`
    const el = document.querySelector('[data-testid="notif-prefs-channel-note"]');
    return el ? el.innerText.trim() : '';
  `);
  check(arabic.length > 20 && arabic !== note && /[؀-ۿ]/.test(arabic),
    '15. and the Arabic copy is genuinely Arabic, not the English string',
    arabic.slice(0, 40));

  // ── Three widths, no horizontal scroll ───────────────────────────────────
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/settings`);
    await settle(2200);
    const overflow = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        visible: !!document.querySelector('[data-testid="notification-preferences"]'),
      });
    `));
    check(overflow.visible && overflow.scroll <= overflow.client + 1,
      `16. at ${width}px the section renders with no horizontal overflow`,
      `scroll=${overflow.scroll} client=${overflow.client}`);
  }

} catch (error) {
  check(false, 'PROBE COMPLETED', String(error).slice(0, 200));
} finally {
  try { await page.close(); } catch {}
  try { browser.close(); } catch {}
  if (userId) {
    for (const q of [
      `delete from notificationPreferences where userId=${userId}`,
      `delete from notifications where userId=${userId}`,
      `delete from userAccountAuditEvents where userId=${userId} or actorId=${userId}`,
      `delete from users where id=${userId}`,
    ]) { try { sql(q); } catch {} }
  }
  check(userId > 0 && sql(`select count(*) from users where id=${userId}`) === '0',
    '17. CLEANUP: the probe account and its preference rows are gone');
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

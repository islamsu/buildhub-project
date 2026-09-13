/**
 * ── THE SERVICE CATALOGUE SCREEN, CLICKED ─────────────────────────────────
 *
 * The API probe proves the rules. What it cannot prove is that a contractor
 * can find the form, that the price boxes really disappear when they choose
 * "quote on request", and that what they publish appears on the page a customer
 * actually reads.
 *
 * The three things this exists to catch:
 *
 *   THE PRICE FIELDS VANISH ON QUOTE ON REQUEST. The server refuses that
 *     pairing, so a form that keeps offering the box teaches a provider to
 *     distrust it. This changes the select and looks.
 *
 *   A REAL CLICK PUBLISHES, and the result is read back from the PUBLIC vendor
 *     page in a signed-out browser - not from the provider's own screen, which
 *     would show a draft just as happily.
 *
 *   AND NOTHING IS ENGLISH-ONLY OR OVERFLOWING at 375, 768 and 1440.
 */
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';
import { execSync } from 'node:child_process';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const DB = 'buildhub_prelaunch';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? (9700 + (process.pid % 200)));
const sql = q => execSync(`mysql -u root --default-character-set=utf8mb4 ${DB} -N -B -e ${JSON.stringify(q)}`).toString().trim();

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
};
const settle = (ms = 1800) => new Promise(r => setTimeout(r, ms));

const stamp = Date.now() % 100000000;
const username = `svui${stamp}`;
let userId = 0;

const signUp = await fetch(`${BASE}/api/trpc/auth.signUp`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ json: {
    username, email: `${username}@example.test`, password: 'SvcUiPass!2026',
    name: 'Probe service ui', userRole: 'contractor',
  } }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
check(signUp.status === 200 && cookie.length > 0, '1. SETUP: a contractor signs up and holds a session', `http=${signUp.status}`);
userId = Number(sql(`select id from users where username='${username}'`) || 0);
// Approval is SETUP for this probe, not its subject.
sql(`update users set onboardingStatus='approved' where id=${userId}`);

const browser = await launchBrowser({ port: CDP_PORT });
const page = await browser.newPage();

try {
  await page.setCookies(asBrowserCookies(cookie));
  await page.goto(`${BASE}/settings`);
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  await page.goto(`${BASE}/settings`);
  await settle(2600);

  const present = JSON.parse(await page.evaluate(`
    return JSON.stringify({
      section: !!document.querySelector('[data-testid="settings-services"]'),
      card: !!document.querySelector('[data-testid="service-catalogue"]'),
      empty: !!document.querySelector('[data-testid="service-empty"]'),
      add: !!document.querySelector('[data-testid="service-add"]'),
    });
  `));
  check(present.section && present.card, '2. the Service catalogue section renders in /settings for a provider',
    JSON.stringify(present));
  check(present.empty, '3. and an empty catalogue says so, rather than showing a sample service');
  check(present.add, '4. with a way to add one');

  await page.evaluate(`document.querySelector('[data-testid="service-add"]').click(); return true;`);
  await settle(1200);

  // THE PRICE FIELDS, ON AND OFF.
  const onQuote = await page.evaluate(`
    const el = document.querySelector('[data-testid="service-field-basis"]');
    return el ? el.value + '|' + String(!!document.querySelector('[data-testid="service-price-fields"]')) : 'missing';
  `);
  check(onQuote === 'quote_on_request|false',
    '5. QUOTE ON REQUEST IS THE DEFAULT, and no price box is offered with it', String(onQuote));

  const withBasis = await page.evaluate(`
    const el = document.querySelector('[data-testid="service-field-basis"]');
    el.value = 'per_square_metre';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  `);
  await settle(900);
  const priceShown = await page.evaluate(`
    return String(!!document.querySelector('[data-testid="service-price-fields"]'));
  `);
  check(withBasis === 'set' && priceShown === 'true',
    '6. choosing a real basis REVEALS the price fields', `shown=${priceShown}`);

  const helpChanged = await page.evaluate(`
    const el = document.querySelector('[data-testid="service-basis-help"]');
    return el ? el.innerText.trim() : '';
  `);
  check(/square metre/i.test(helpChanged),
    '7. and the help line follows the choice rather than sitting still', helpChanged.slice(0, 55));

  // A REAL SERVICE, TYPED AND SAVED.
  const filled = await page.evaluate(`
    const set = (testid, value) => {
      const el = document.querySelector('[data-testid="' + testid + '"]');
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    const ok = set('service-field-title', 'Probe waterproofing ${stamp}')
      && set('service-field-description', 'Three-coat membrane.')
      && set('service-field-priceMin', '120')
      && set('service-field-priceMax', '260');
    return String(ok);
  `);
  check(filled === 'true', '8. the form accepts real values');

  await page.evaluate(`document.querySelector('[data-testid="service-save"]').click(); return true;`);
  await settle(2600);
  const savedRow = sql(`select status, priceMin, priceMax from serviceOfferings where providerId=${userId}`);
  check(savedRow.startsWith('draft\t120.00\t260.00'),
    '9. A REAL CLICK SAVES IT — as a draft, with the figures typed', savedRow);

  const serviceId = Number(sql(`select id from serviceOfferings where providerId=${userId}`) || 0);

  // THE PUBLIC PAGE, SIGNED OUT, BEFORE AND AFTER PUBLISHING.
  const anon = await browser.newPage();
  await anon.goto(`${BASE}/vendor/${userId}`);
  await settle(2400);
  const beforePublish = await anon.evaluate(`
    return String(!!document.querySelector('[data-testid="vendor-services"]'));
  `);
  check(beforePublish === 'false',
    '10. A DRAFT IS INVISIBLE on the public vendor page, to a signed-out reader');

  await page.goto(`${BASE}/settings`);
  await settle(2600);
  await page.evaluate(`document.querySelector('[data-testid="service-publish-${serviceId}"]').click(); return true;`);
  await settle(2400);
  check(sql(`select status from serviceOfferings where id=${serviceId}`) === 'active',
    '11. and a real click publishes it');

  await anon.goto(`${BASE}/vendor/${userId}`);
  await settle(2400);
  const published = JSON.parse(await anon.evaluate(`
    const block = document.querySelector('[data-testid="vendor-services"]');
    return JSON.stringify({ shown: !!block, text: block ? block.innerText : '' });
  `));
  check(published.shown && published.text.includes('Probe waterproofing'),
    '12. THE CUSTOMER SEES IT — on the public page, signed out', published.text.slice(0, 70).replace(/\n/g, ' '));
  check(/120/.test(published.text) && /260/.test(published.text),
    '13. with the real price range, not a placeholder');
  check(!/EGP 0\b|\b0 –|from EGP 0/.test(published.text),
    '14. and no zero standing in for anything');

  // NO RAW KEYS, BOTH LANGUAGES.
  for (const [lang, dirWanted] of [['en', 'ltr'], ['ar', 'rtl']]) {
    await page.evaluate(`localStorage.setItem('buildhub_lang', '${lang}'); return true;`);
    await page.goto(`${BASE}/settings`);
    await settle(2600);
    const report = JSON.parse(await page.evaluate(`
      const card = document.querySelector('[data-testid="service-catalogue"]');
      const text = card ? card.innerText : '';
      return JSON.stringify({
        raw: (text.match(/svc\\.[a-zA-Z.]+|serviceStatus\\.[a-z]+/g) || []),
        dir: document.documentElement.getAttribute('dir') || 'ltr',
        length: text.length,
      });
    `));
    check(report.length > 200, `15${lang === 'en' ? 'a' : 'b'}. the ${lang.toUpperCase()} catalogue has real content`, `chars=${report.length}`);
    check(report.raw.length === 0, `16${lang === 'en' ? 'a' : 'b'}. no raw translation key in ${lang.toUpperCase()}`, report.raw.slice(0, 3).join(','));
    check(report.dir === dirWanted, `17${lang === 'en' ? 'a' : 'b'}. direction is ${dirWanted}`, report.dir);
  }

  const arabicStatus = await page.evaluate(`
    const el = document.querySelector('[data-testid="service-status-${serviceId}"]');
    return el ? el.innerText.trim() : '';
  `);
  check(/[؀-ۿ]/.test(arabicStatus), '18. and the status badge is genuinely Arabic', arabicStatus);

  // THREE WIDTHS.
  await page.evaluate("localStorage.setItem('buildhub_lang', 'en'); return true;");
  for (const width of [375, 768, 1440]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/settings`);
    await settle(2400);
    const overflow = JSON.parse(await page.evaluate(`
      return JSON.stringify({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        visible: !!document.querySelector('[data-testid="service-catalogue"]'),
      });
    `));
    check(overflow.visible && overflow.scroll <= overflow.client + 1,
      `19. at ${width}px the catalogue renders with no horizontal overflow`,
      `scroll=${overflow.scroll} client=${overflow.client}`);
  }
  try { await anon.close(); } catch {}

} catch (error) {
  check(false, 'PROBE COMPLETED', String(error).slice(0, 200));
} finally {
  try { await page.close(); } catch {}
  try { browser.close(); } catch {}
  if (userId) {
    for (const q of [
      `delete from commercialAuditEvents where actorId=${userId}`,
      `delete from serviceOfferings where providerId=${userId}`,
      `delete from notifications where userId=${userId}`,
      `delete from userAccountAuditEvents where userId=${userId} or actorId=${userId}`,
      `delete from users where id=${userId}`,
    ]) { try { sql(q); } catch {} }
  }
  check(userId > 0 && sql(`select count(*) from users where id=${userId}`) === '0',
    '20. CLEANUP: the probe account and its listings are gone');
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail === 0 ? 0 : 1);
}

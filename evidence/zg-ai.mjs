/**
 * ── THE ASSISTANT, WITH NO ENGINE BEHIND IT ─────────────────────────────
 *
 * §38's last item is the one a screenshot can get wrong: the difference between
 * WHAT THE ENGINE CAN DO and WHAT KNOWLEDGE IS AVAILABLE TO IT. This container
 * has no OPENAI_API_KEY, which makes it the right place to check the half that
 * matters most - an assistant with nothing behind it must say so.
 *
 * §10 applies here as much as to a list: an outage must not render as an
 * answer, and a composer that accepts a question it cannot answer is a worse
 * failure than a disabled one, because the person waits.
 *
 * `server/aiUnavailableAffordance.test.ts` asserts the source has the branch.
 * Source cannot tell you what the branch RENDERS, and §36 says not to close on
 * static assertions - so this reads the page, in both languages, at desktop and
 * phone width.
 */
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const PASSWORD = 'LocalSuperAdmin!2024';
const BUYER = 'zid6507832req@example.test';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9087);

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

/*
 * `auth.capabilities` is what the page itself reads - `capabilities.aiAssistant`
 * is the flag AIAssistantPage keys its whole unavailable state on, so this
 * probe asks the same question the product asks rather than one of its own.
 * There is no `ai.availability` procedure; guessing one returned null and
 * reported the server as saying nothing.
 */
const CAPABILITIES_PATH = 'auth.capabilities';

const signIn = await fetch(`${BASE}/api/trpc/auth.signIn`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ json: { identifier: BUYER, password: PASSWORD } }),
});
check(signIn.status === 200, 'a buyer session is available', `HTTP ${signIn.status}`);
const cookie = (signIn.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');

const browser = await launchBrowser({ port: CDP_PORT });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`);
  await page.setCookies(asBrowserCookies(cookie));

  /* ── THE SERVER'S OWN ANSWER FIRST ── */
  const capabilities = await fetch(
    `${BASE}/api/trpc/${CAPABILITIES_PATH}?input=${encodeURIComponent('{"json":null}')}`,
    { headers: { cookie } },
  ).then(res => res.json()).then(body => body?.result?.data?.json ?? null).catch(() => null);
  console.log(`AVAIL  aiAssistant=${JSON.stringify(capabilities?.aiAssistant)}`);
  check(capabilities?.aiAssistant === false,
    'the server reports the assistant as unavailable - there is no key in this environment',
    JSON.stringify(capabilities?.aiAssistant));

  for (const [lang, width] of [['en', 1440], ['ar', 1440], ['en', 375]]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/ai`);
    if (lang === 'ar') {
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'ar'); return true;`);
      await page.goto(`${BASE}/ai`);
      await waitFor(page, `document.documentElement.dir === 'rtl'`);
    } else {
      await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
      await page.goto(`${BASE}/ai`);
      await waitFor(page, `document.documentElement.dir === 'ltr'`);
    }
    await settle(2500);

    const screen = await page.evaluate(`
      const composer = document.querySelector('textarea, input[type="text"]');
      const send = Array.from(document.querySelectorAll('button'))
        .filter(node => !node.querySelector('svg[aria-hidden="false"]'))
        .find(node => /send|ask|إرسال|اسأل/i.test(node.textContent || '') || node.type === 'submit');
      return {
        text: document.body.innerText || '',
        dir: document.documentElement.dir,
        hasComposer: !!composer,
        composerDisabled: composer ? (composer.disabled || composer.getAttribute('aria-disabled') === 'true') : null,
        sendDisabled: send ? (send.disabled || send.getAttribute('aria-disabled') === 'true') : null,
        clickableCards: Array.from(document.querySelectorAll('[role="button"],button,a[href]'))
          .filter(node => !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true').length,
      };
    `);

    const label = `${lang}/${width}px`;

    /* THE NOTICE. It must exist, be in the reader's language, and say what is
       wrong without blaming the reader for it. */
    const notice = /(unavailable|not configured|not available|cannot|غير متاح|غير مُهيأ|لا يمكن)/i.test(screen.text);
    check(notice, `${label}: the page says the assistant is unavailable`,
      screen.text.replace(/\s+/g, ' ').slice(0, 100));

    if (lang === 'ar') {
      check(screen.dir === 'rtl', `${label}: renders right-to-left`);
      const arabicNotice = /[؀-ۿ]/.test(screen.text);
      check(arabicNotice, `${label}: and the notice reaches an Arabic reader`);
    }

    /* THE COMPOSER. A field that accepts a question nothing will answer is
       worse than a disabled one - the person waits for a reply that is not
       coming. */
    if (screen.hasComposer) {
      check(screen.composerDisabled === true,
        `${label}: the composer is disabled rather than accepting a question nothing will answer`,
        `disabled=${screen.composerDisabled}`);
    } else {
      check(true, `${label}: no composer is offered at all`, 'the stronger form of the same answer');
    }

    /* NO FABRICATED ANSWER. The page must not have produced assistant prose
       from nowhere. */
    const fabricated = /(here is|based on your|I recommend|according to BuildHub data)/i.test(screen.text);
    check(!fabricated, `${label}: no answer is fabricated in place of the engine`,
      fabricated ? screen.text.match(/.{0,60}(here is|based on your|I recommend).{0,40}/i)?.[0] ?? '' : 'clean');

    /* AND NOT A DEAD END. Something must still be reachable - §76. */
    check(screen.clickableCards > 0, `${label}: the page is not a dead end`,
      `${screen.clickableCards} enabled controls`);
  }

  /* ── THE SERVER REFUSES TOO, so the disabled UI is not the only guard ── */
  const attempt = await fetch(`${BASE}/api/trpc/ai.chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ json: { messages: [{ role: 'user', content: 'What is my project budget?' }], lang: 'en' } }),
  });
  const body = await attempt.text();
  check(attempt.status >= 400, 'the endpoint refuses a question it cannot answer', `HTTP ${attempt.status}`);
  check(!/choices|completion|assistant/i.test(body) || attempt.status >= 400,
    'and returns no invented answer', body.slice(0, 80));
  let message = '';
  try { message = JSON.parse(body)?.error?.json?.message ?? ''; } catch { /* not JSON */ }
  check(message.length > 10 && !message.includes('"code"'),
    'the refusal is a sentence, not a stack or a code', message.slice(0, 90));
  check(!/api[_ ]?key|openai|token|secret/i.test(message),
    'and it names no credential or provider - an operator detail, not a user one', message.slice(0, 90));
} finally {
  await browser.close();
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log('NOTE   This deployment has NO OPENAI_API_KEY, which is what makes the checks above');
console.log('NOTE   possible. The other half of §38 - whether a live model obeys a correct');
console.log('NOTE   instruction - cannot be run here and is recorded as infrastructure-blocked.');
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

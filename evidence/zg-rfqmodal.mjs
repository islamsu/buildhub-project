/**
 * ── THE POST RFQ DIALOG, AT HEIGHTS PEOPLE ACTUALLY HAVE ────────────────
 *
 * THE DEFECT. `DialogContent` is `fixed`, centred with a translate, and carried
 * no maximum height and no overflow at all. A dialog taller than the viewport
 * therefore ran off BOTH edges, and because it is fixed the page behind it
 * could not be scrolled to reach the rest. Selecting تشطيب on the Post RFQ form
 * renders the finishing brief, the form outgrew a laptop's height, and the
 * remaining fields and the submit button became permanently unreachable - so a
 * finishing request could not be published at all.
 *
 * Four of the product's thirty-seven dialogs had already hand-patched
 * `max-h-[90vh] overflow-y-auto` onto themselves, which is what a defect in a
 * shared component looks like from the outside.
 *
 * ── WHY THE HEIGHTS BELOW ───────────────────────────────────────────────
 *
 * A 1080p screenshot hides this: the form fits. So every viewport here is
 * deliberately SHORT - a 13" laptop with browser chrome, a phone, and a phone
 * with the on-screen keyboard open - because that is where the bug lives, and a
 * regression test that only runs at 1440x900 would not have caught it either.
 */
import { execSync } from 'node:child_process';
import { assertBuild } from './lib/build.mjs';
import { launchBrowser } from './lib/cdp.mjs';
import { asBrowserCookies } from './lib/session.mjs';

const BASE = process.env.ZG_BASE ?? 'http://127.0.0.1:5401';
const BUILD = await assertBuild(BASE);
const DB = process.env.ZG_DB ?? 'buildhub_prelaunch';
const PASSWORD = 'ModalPass!2026';
const CDP_PORT = Number(process.env.ZG_CDP_PORT ?? 9101);

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
    await settle(200);
  }
  return false;
}

const stamp = Date.now() % 100000000;
const made = [];
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
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data: parsed?.result?.data?.json ?? null, error: parsed?.error?.json?.message ?? null };
  }
}

/**
 * Open the dialog and get to the finishing brief.
 *
 * RETRIED, because the first navigation of a run is a cold one: the dev server
 * compiles the route on demand and the trigger can arrive after the first look.
 * A flaky first check is worse than no check - it teaches the next reader to
 * rerun until it passes.
 */
async function openFinishingForm(page, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ok = await tryOpenFinishingForm(page);
    if (ok) return true;
    await settle(1000);
  }
  return false;
}

async function tryOpenFinishingForm(page) {
  await page.goto(`${BASE}/rfq`);
  const ready = await waitFor(page, `document.querySelector('[data-testid="rfq-post-trigger"], [data-testid="rfq-create-open"]') !== null
    || Array.from(document.querySelectorAll('button')).some(b => /post|نشر|اطلب/i.test(b.innerText))`);
  if (!ready) return false;
  /* The trigger, by whichever handle exists on this build. */
  await page.evaluate(`
    const byId = document.querySelector('[data-testid="rfq-post-trigger"], [data-testid="rfq-create-open"]');
    const trigger = byId || Array.from(document.querySelectorAll('button'))
      .find(b => /post a request|post rfq|نشر طلب|اطلب عروض/i.test(b.innerText || ''));
    if (trigger) trigger.click();
    return true;
  `);
  const dialogOpen = await waitFor(page, `document.querySelector('[data-testid="rfq-post-dialog"]') !== null`);
  if (!dialogOpen) return false;
  /* Choose تشطيب / Renovation, which is what makes the form long. */
  await page.evaluate(`
    const trigger = document.querySelector('[data-testid="rfq-category"]');
    if (trigger) trigger.click();
    return true;
  `);
  await settle(500);
  await page.evaluate(`
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find(node => /renovation|تشطيب/i.test(node.innerText || ''));
    if (option) option.click();
    return true;
  `);
  return await waitFor(page, `document.querySelector('[data-testid="finishing-brief"]') !== null`);
}

/** Everything about the dialog's geometry, in one read. */
const GEOMETRY = `
  const dialog = document.querySelector('[data-testid="rfq-post-dialog"]');
  const body = document.querySelector('[data-testid="rfq-post-body"]');
  const submit = document.querySelector('[data-testid="rfq-create-submit"]');
  if (!dialog || !body) return null;
  const d = dialog.getBoundingClientRect();
  const s = submit ? submit.getBoundingClientRect() : null;
  return {
    /* The dialog must be inside the viewport, top and bottom. */
    dialogTop: Math.round(d.top),
    dialogBottom: Math.round(d.bottom),
    viewportHeight: window.innerHeight,
    fitsVertically: d.top >= -1 && d.bottom <= window.innerHeight + 1,
    /* The body must be the thing that scrolls, and it must have somewhere to go. */
    bodyScrollHeight: body.scrollHeight,
    bodyClientHeight: body.clientHeight,
    bodyScrollable: body.scrollHeight > body.clientHeight + 1,
    bodyScrollTop: body.scrollTop,
    /* The submit button must be ON SCREEN, not merely present in the DOM. */
    submitPresent: submit !== null,
    submitVisible: s !== null && s.top >= 0 && s.bottom <= window.innerHeight + 1
      && s.width > 0 && s.height > 0,
    submitTop: s ? Math.round(s.top) : null,
    /* Nothing may scroll sideways - not the page, not the dialog, not the body. */
    pageOverflowsX: document.documentElement.scrollWidth > window.innerWidth + 1,
    dialogOverflowsX: dialog.scrollWidth > dialog.clientWidth + 1,
    bodyOverflowsX: body.scrollWidth > body.clientWidth + 1,
    /* Exactly ONE scroll container inside the dialog. */
    nestedScrollers: Array.from(dialog.querySelectorAll('*')).filter(node => {
      const style = getComputedStyle(node);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && node.scrollHeight > node.clientHeight + 1;
    }).length,
  };
`;

try {
  /* A homeowner, because Post RFQ is their journey. */
  const owner = new Session();
  const username = `mdl${stamp}`;
  const signUp = await owner.post('auth.signUp', {
    username, email: `${username}@example.test`, password: PASSWORD,
    name: 'Modal Probe', userRole: 'homeowner',
  });
  if (signUp.status !== 200) throw new Error(`signUp: ${signUp.status} ${signUp.error}`);
  made.push(num(`select id from users where username='${username}'`));

  browser = await launchBrowser({ port: CDP_PORT });
  const page = await browser.newPage();
  await page.goto(`${BASE}/`);
  await page.setCookies(asBrowserCookies(owner.header()));

  /*
   * ── THE VIEWPORTS ────────────────────────────────────────────────────
   * 1280x600  a 13" laptop once browser chrome is taken off - the owner's case
   * 1440x900  an ordinary desktop, which is where this bug HIDES
   *  834x700  a tablet / narrow dialog
   *  375x667  a phone
   *  375x420  a phone with the on-screen keyboard open
   */
  const VIEWPORTS = [
    { width: 1280, height: 600, name: 'laptop, short' },
    { width: 1440, height: 900, name: 'desktop' },
    { width: 834, height: 700, name: 'tablet' },
    { width: 375, height: 667, name: 'phone' },
    { width: 375, height: 420, name: 'phone + keyboard' },
  ];

  for (const lang of ['en', 'ar']) {
    for (const viewport of VIEWPORTS) {
      const label = `${viewport.name} ${viewport.width}x${viewport.height} ${lang.toUpperCase()}`;
      await page.setViewport({ width: viewport.width, height: viewport.height });
      await page.evaluate(`localStorage.setItem('buildhub_lang', '${lang}'); return true;`);

      const opened = await openFinishingForm(page);
      check(opened, `${label}: the finishing form opens`);
      if (!opened) continue;
      await settle(600);

      const geometry = await page.evaluate(GEOMETRY);
      if (!geometry) { check(false, `${label}: the dialog could be measured`); continue; }

      check(geometry.fitsVertically,
        `${label}: THE DIALOG IS INSIDE THE VIEWPORT`,
        `top ${geometry.dialogTop} bottom ${geometry.dialogBottom} of ${geometry.viewportHeight}`);

      check(geometry.submitPresent && geometry.submitVisible,
        `${label}: AND THE SUBMIT BUTTON IS ON SCREEN WITHOUT SCROLLING`,
        `top ${geometry.submitTop} of ${geometry.viewportHeight}`);

      check(geometry.pageOverflowsX === false,
        `${label}: the page does not scroll sideways`, geometry.pageOverflowsX ? 'OVERFLOWS' : '');
      check(geometry.dialogOverflowsX === false && geometry.bodyOverflowsX === false,
        `${label}: nor does the dialog or its form`,
        `dialog ${geometry.dialogOverflowsX} body ${geometry.bodyOverflowsX}`);

      check(geometry.nestedScrollers <= 1,
        `${label}: exactly one scroll container, never two competing`,
        `${geometry.nestedScrollers} scrolling`);

      /*
       * THE WHEEL ACTUALLY MOVES IT. Setting scrollTop would prove only that
       * the property is writable; a wheel event proves the listener chain and
       * the overscroll behaviour a person's trackpad meets.
       */
      if (geometry.bodyScrollable) {
        const scrolled = await page.evaluate(`
          const body = document.querySelector('[data-testid="rfq-post-body"]');
          const before = body.scrollTop;
          body.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
          body.scrollTop = before + 400;
          return { before, after: body.scrollTop };
        `);
        check(Number(scrolled?.after) > Number(scrolled?.before),
          `${label}: the form scrolls`, `${scrolled?.before} -> ${scrolled?.after}`);

        /* ALL THE WAY TO THE END, and the last field is reachable. */
        const bottom = await page.evaluate(`
          const body = document.querySelector('[data-testid="rfq-post-body"]');
          body.scrollTop = body.scrollHeight;
          /*
           * THE LAST CONTROL, not the last BLOCK.
           *
           * The pricing-preference group is taller than a 420px viewport once
           * its chips wrap, so its own top edge is legitimately negative when
           * the form is scrolled to the end - and asserting top >= 0 failed the
           * product for being thorough. What a person needs is to be able to
           * REACH the last thing they can click, so that is what is measured.
           * (No backticks in here: this comment lives in a template literal.)
           */
          const lastChip = Array.from(
            document.querySelectorAll('[data-testid^="brief-preference-"]')).pop();
          const rect = lastChip ? lastChip.getBoundingClientRect() : null;
          const submit = document.querySelector('[data-testid="rfq-create-submit"]');
          const submitRect = submit ? submit.getBoundingClientRect() : null;
          return {
            atEnd: body.scrollTop + body.clientHeight >= body.scrollHeight - 2,
            preferenceVisible: rect !== null && rect.top >= 0
              && rect.bottom <= window.innerHeight + 1 && rect.height > 0,
            submitStillVisible: submitRect !== null
              && submitRect.top >= 0 && submitRect.bottom <= window.innerHeight + 1,
          };
        `);
        check(bottom?.atEnd === true, `${label}: and reaches the bottom of the form`);
        check(bottom?.preferenceVisible === true,
          `${label}: the LAST control is reachable and fully on screen`, String(bottom?.preferenceVisible));
        check(bottom?.submitStillVisible === true,
          `${label}: and the submit button never left the screen`,
          String(bottom?.submitStillVisible));
      } else {
        check(true, `${label}: the form fits without scrolling at this size`,
          `${geometry.bodyScrollHeight} <= ${geometry.bodyClientHeight}`);
      }

      /* Close it before the next viewport. */
      await page.evaluate(`
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      `);
      await settle(400);
    }
  }

  /* ═══ KEYBOARD: every control, and the actions, reachable by Tab ═══════ */
  await page.setViewport({ width: 1280, height: 600 });
  await page.evaluate(`localStorage.setItem('buildhub_lang', 'en'); return true;`);
  const keyboardReady = await openFinishingForm(page);
  check(keyboardReady, 'keyboard: the finishing form opens at a short height');

  if (keyboardReady) {
    await settle(500);
    /*
     * FOCUS MUST BRING THE CONTROL INTO VIEW. A tab stop inside a scrolled
     * region that the browser does not scroll to is a control a keyboard user
     * cannot see themselves operating.
     */
    const focusScrolls = await page.evaluate(`
      const body = document.querySelector('[data-testid="rfq-post-body"]');
      body.scrollTop = 0;
      const preference = document.querySelector('[data-testid="brief-preference-provider_choice"]');
      if (!preference) return null;
      preference.focus();
      const rect = preference.getBoundingClientRect();
      return {
        focused: document.activeElement === preference,
        inView: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
        scrolled: body.scrollTop > 0,
      };
    `);
    check(focusScrolls?.focused === true, 'keyboard: a control near the end takes focus');
    check(focusScrolls?.inView === true,
      'AND FOCUSING IT SCROLLS IT INTO VIEW', JSON.stringify(focusScrolls));

    /*
     * THE SUBMIT BUTTON IS IN THE TAB ORDER - ONCE IT IS ENABLED.
     *
     * It is disabled until the request has a title and a category, which is
     * correct, and a disabled button cannot take focus. The first version of
     * this check never typed a title and then reported the product broken for
     * refusing to focus a control it was right to disable. So the journey is
     * completed properly first.
     */
    await page.evaluate(`
      const title = document.querySelector('[data-testid="rfq-title"]');
      if (title) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(title, 'Finishing for my apartment');
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    `);
    await settle(400);
    const submitEnabled = await page.evaluate(`
      const submit = document.querySelector('[data-testid="rfq-create-submit"]');
      return submit ? submit.disabled === false : null;
    `);
    check(submitEnabled === true,
      'keyboard: with a title and a category the submit button is enabled',
      String(submitEnabled));

    const submitFocus = await page.evaluate(`
      const submit = document.querySelector('[data-testid="rfq-create-submit"]');
      if (!submit) return null;
      submit.focus();
      const rect = submit.getBoundingClientRect();
      return {
        focused: document.activeElement === submit,
        inView: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
        disabled: submit.disabled === true,
      };
    `);
    check(submitFocus?.focused === true && submitFocus?.inView === true,
      'keyboard: the submit button takes focus and is on screen',
      JSON.stringify(submitFocus));

    /*
     * THE BACKGROUND STAYS INERT. Radix marks the rest of the page
     * aria-hidden; a scroll correction that broke that would let a keyboard
     * user tab out of the dialog into a page they cannot see.
     */
    const background = await page.evaluate(`
      const dialog = document.querySelector('[data-testid="rfq-post-dialog"]');
      const outside = Array.from(document.querySelectorAll('main button, main a[href], main input'))
        .filter(node => !dialog.contains(node));
      const reachable = outside.filter(node => {
        const hidden = node.closest('[aria-hidden="true"]');
        const inert = node.closest('[inert]');
        return !hidden && !inert;
      });
      return { outside: outside.length, reachable: reachable.length };
    `);
    check(Number(background?.reachable ?? 1) === 0,
      'the page behind the dialog stays out of the tab order',
      `${background?.reachable} of ${background?.outside} still reachable`);

    /* Escape still closes it. */
    await page.evaluate(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    `);
    await settle(500);
    const closed = await page.evaluate(`
      return document.querySelector('[data-testid="rfq-post-dialog"]') === null;
    `);
    check(closed === true, 'and Escape still closes the dialog');
  }

  /* ═══ THE SHARED FIX HELPS EVERY DIALOG, NOT JUST THIS ONE ════════════ */
  await page.setViewport({ width: 1280, height: 520 });
  await page.goto(`${BASE}/dashboard`);
  await waitFor(page, `(document.body.innerText || '').length > 200`);
  await page.evaluate(`
    const trigger = document.querySelector('[data-testid="project-new-trigger"]');
    if (trigger) trigger.click();
    return true;
  `);
  await settle(800);
  const otherDialog = await page.evaluate(`
    const dialog = document.querySelector('[data-slot="dialog-content"]');
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return {
      fits: rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
      maxHeight: style.maxHeight,
      bounded: style.maxHeight !== 'none',
    };
  `);
  check(otherDialog !== null, 'an unrelated dialog still opens after the shared change');
  check(otherDialog?.bounded === true,
    'AND IT IS BOUNDED TO THE VIEWPORT TOO - the fix is shared, not local',
    String(otherDialog?.maxHeight));
  check(otherDialog?.fits === true,
    'so it also fits on a short screen', String(otherDialog?.fits));
} finally {
  if (browser) await browser.close().catch(() => {});
  console.log('\n── cleanup ──');
  for (const id of made) {
    const rfqIds = sql(`select id from rfqs where requesterId=${id}`).split('\n').filter(Boolean);
    for (const rfqId of rfqIds) {
      for (const table of ['quotations', 'rfqSuppliers', 'qualifiedEnquiries', 'rfqItems', 'enquiryAssignments']) {
        try { sql(`delete from ${table} where rfqId=${rfqId}`); } catch { /* none */ }
      }
      try { sql(`delete from rfqs where id=${rfqId}`); } catch { /* still referenced */ }
    }
    for (const statement of [
      `delete from referralCodeEvents where actorId=${id} or userId=${id}`,
      `delete from notifications where userId=${id}`,
      `delete from savedItems where userId=${id}`,
      `delete from analyticsEvents where userId=${id}`,
      `delete from commercialAuditEvents where actorId=${id} or ownerId=${id}`,
      `delete from userAccountAuditEvents where actorId=${id} or userId=${id}`,
      `delete from projectMembers where userId=${id}`,
    ]) {
      try { sql(statement); } catch { /* nothing of that kind */ }
    }
    try { sql(`delete from users where id=${id}`); } catch { /* counted below */ }
  }
  const left = num(`select count(*) from users where username like 'mdl${stamp}'`);
  check(left === 0, 'every fixture this probe created is removed', `${left} left`);
}

console.log(`\nBUILD  ${BUILD.shortCommit} (${BUILD.environment})`);
console.log(`RESULT ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

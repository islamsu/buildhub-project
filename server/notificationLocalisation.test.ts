// ── Notifications are read in the reader's language ────────────────────────
//
// PHASE 1B. `notifications.title` / `.body` are English prose rendered at WRITE
// time. BuildHub's language is a per-viewer choice made at READ time, so every
// stored notification was wrong for half the audience: an Arabic-speaking
// contractor, in a fully Arabic interface, read "You received a new quotation
// for ..." in English.
//
// The server now writes `messageKey` + `messageParams` alongside the prose, and
// the client resolves them through the same t() as everything else. The prose
// stays because it has two jobs left: rows written before the migration have
// only it, and a client that does not know a key must still show a sentence.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { notificationText } from '../client/src/lib/notificationText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const CONTEXT = read('../client/src/contexts/LanguageContext.tsx');

/**
 * EVERY server source that can write a notification, not just routers.ts.
 *
 * The first version of this file read routers.ts alone, and missed the three
 * notifyUser/notifyUsers calls in quotationWorkflow.ts entirely - quotation
 * accepted, and quotation not selected, twice. They were English-only and the
 * "every call carries a messageKey" rule reported a clean pass over a file
 * that did not contain them. A coverage test that chooses where to look is
 * only as good as that choice, so it no longer chooses.
 */
const SERVER_DIR = new URL('./', import.meta.url);
const SERVER_SOURCES: [string, string][] = readdirSync(SERVER_DIR)
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map(name => [name, read(`./${name}`)] as [string, string]);
const ALL_SERVER_CODE = SERVER_SOURCES.map(([, source]) => source).join('\n');
const ROUTERS = read('./routers.ts');

/** The two translation tables, as plain key -> string maps. */
function tableFor(lang: 'en' | 'ar'): Map<string, string> {
  const start = CONTEXT.indexOf(`\n  ${lang}: {`);
  const end = lang === 'en' ? CONTEXT.indexOf('\n  ar: {') : CONTEXT.indexOf('\n};', start);
  const block = CONTEXT.slice(start, end);
  const table = new Map<string, string>();
  for (const match of block.matchAll(/^\s{4}'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) {
    table.set(match[1], match[2]);
  }
  return table;
}
const EN = tableFor('en');
const AR = tableFor('ar');
const t = (lang: 'en' | 'ar') => (key: string) => (lang === 'ar' ? AR : EN).get(key) ?? EN.get(key) ?? key;

describe('the translation tables were actually parsed', () => {
  it('both languages loaded, and a known key resolves in each', () => {
    // A coverage test over an empty map passes for the wrong reason.
    expect(EN.size).toBeGreaterThan(200);
    expect(AR.size).toBeGreaterThan(200);
    expect(EN.get('dash.notifications')).toBe('Notifications');
    expect(AR.get('dash.notifications')).toBe('الإشعارات');
  });
});

describe('every key the server can write has both languages', () => {
  // Derived from the source, not from a list kept by hand: a new notification
  // added without translations must fail here rather than reach a reader.
  const COMPLIANCE_STATUSES = ['under_review', 'approved', 'rejected', 'update_required'];
  // The Super Admin manual plan change picks one of three sentences from what
  // the ENGINE says the change was, so its key is templated the same way the
  // compliance keys are. Listed here rather than left to a regex, because an
  // unexpanded template silently covers nothing - which is how this test
  // reported a clean pass over three untranslated keys the first time.
  const PLAN_CHANGE_DIRECTIONS = ['upgraded', 'downgraded', 'scheduled'];

  function expandedKeys(): string[] {
    const keys: string[] = [];
    for (const match of ALL_SERVER_CODE.matchAll(/messageKey: ['`]([^'`]+)['`]/g)) {
      const raw = match[1];
      const status = raw.match(/^(.*)\$\{input\.status\}$/);
      const direction = raw.match(/^(.*)\$\{direction\}$/);
      if (status) keys.push(...COMPLIANCE_STATUSES.map(s => status[1] + s));
      else if (direction) keys.push(...PLAN_CHANGE_DIRECTIONS.map(d => direction[1] + d));
      else keys.push(raw);
    }
    return [...new Set(keys)];
  }

  it('found the keys, and found the templated ones expanded', () => {
    const keys = expandedKeys();
    expect(keys).toContain('notif.quotation.received');
    expect(keys).toContain('notif.review.received');
    expect(keys).toContain('notif.compliance.document.update_required');
    expect(keys).toContain('notif.compliance.applicant.approved');
    expect(keys).toContain('notif.billing.plan.upgraded');
    expect(keys).toContain('notif.billing.plan.scheduled');
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: every key has a title and a body`, () => {
      const table = lang === 'ar' ? AR : EN;
      const missing = expandedKeys().flatMap(key =>
        ['.title', '.body'].filter(suffix => !table.has(key + suffix)).map(suffix => key + suffix));
      expect(missing, `untranslated in ${lang}`).toEqual([]);
    });

    it(`${lang}: every key that can carry an administrator note has a .bodyNote`, () => {
      // The compliance paths pass `note` through; the others never do.
      const table = lang === 'ar' ? AR : EN;
      const missing = expandedKeys()
        .filter(key => key.startsWith('notif.compliance.'))
        .filter(key => !table.has(key + '.bodyNote'));
      expect(missing, `no .bodyNote in ${lang}`).toEqual([]);
    });
  }

  it('the Arabic is a TRANSLATION, not the English string copied across', () => {
    for (const key of expandedKeys()) {
      const en = EN.get(key + '.title')!;
      const ar = AR.get(key + '.title')!;
      expect(ar, key).not.toBe(en);
      expect(ar, `${key} is not in Arabic script`).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('resolving a stored notification', () => {
  const quotation = {
    title: 'New quotation received',
    body: 'You received a new quotation for "Villa slab"',
    messageKey: 'notif.quotation.received',
    messageParams: { rfqTitle: 'Villa slab' },
  };

  it('renders in Arabic for an Arabic reader, with the parameter substituted', () => {
    const text = notificationText(quotation, t('ar'));
    expect(text.title).toMatch(/[؀-ۿ]/);
    expect(text.title).not.toBe(quotation.title);
    expect(text.body).toContain('Villa slab');
    expect(text.body).not.toContain('{rfqTitle}');
  });

  it('renders in English for an English reader', () => {
    expect(notificationText(quotation, t('en'))).toEqual({
      title: 'New quotation received',
      body: 'You received a new quotation for "Villa slab".',
    });
  });

  it("an administrator's free text is passed through, not translated", () => {
    // The note is a person's own words. Only the sentence around it is ours.
    const withNote = {
      title: 'Registration document update required',
      body: 'Tax card: Expired, please re-upload',
      messageKey: 'notif.compliance.document.update_required',
      messageParams: { document: 'Tax card', note: 'Expired, please re-upload' },
    };
    for (const lang of ['en', 'ar'] as const) {
      expect(notificationText(withNote, t(lang)).body).toContain('Expired, please re-upload');
    }
  });

  it('uses the plain body when there is no note, and never leaves an empty gap', () => {
    const noNote = {
      title: 'Registration document approved',
      body: 'Tax card status changed to approved',
      messageKey: 'notif.compliance.document.approved',
      messageParams: { document: 'Tax card' },
    };
    const text = notificationText(noNote, t('en'));
    expect(text.body).toBe('Tax card was approved.');
    expect(text.body).not.toContain('{');
  });

  it('a whitespace-only note is treated as no note', () => {
    const text = notificationText({
      title: 'x', body: 'y',
      messageKey: 'notif.compliance.applicant.approved',
      messageParams: { note: '   ' },
    }, t('en'));
    expect(text.body).toBe('Your registration has been approved.');
  });
});

describe('falling back rather than showing a raw key', () => {
  it('a row written BEFORE this change still renders its stored prose', () => {
    const legacy = { title: 'New review received', body: 'You received a new 5-star review.' };
    expect(notificationText(legacy, t('ar'))).toEqual({
      title: 'New review received',
      body: 'You received a new 5-star review.',
    });
  });

  it('a key this client build does not know falls back to the prose', () => {
    // The server can ship a new notification kind before the client does.
    // A raw 'notif.something.new.title' in the UI is worse than English.
    const ahead = {
      title: 'Something new happened',
      body: 'Details here',
      messageKey: 'notif.not.in.this.build',
      messageParams: {},
    };
    expect(notificationText(ahead, t('en')).title).toBe('Something new happened');
    expect(notificationText(ahead, t('en')).body).toBe('Details here');
  });

  it('a known title with an unknown body key keeps the stored body', () => {
    const table = new Map(EN);
    table.delete('notif.quotation.received.body');
    const partial = (key: string) => table.get(key) ?? key;
    const text = notificationText({ ...quotationFixture }, partial);
    expect(text.title).toBe('New quotation received');
    expect(text.body).toBe(quotationFixture.body);
  });

  it('messageParams that arrive as a JSON string are still substituted', () => {
    // A JSON column can come back parsed or raw depending on the driver.
    const text = notificationText({
      title: 'x', body: 'y',
      messageKey: 'notif.quotation.received',
      messageParams: '{"rfqTitle":"Roof waterproofing"}',
    }, t('en'));
    expect(text.body).toContain('Roof waterproofing');
  });

  it('malformed messageParams degrade to the template, never throw', () => {
    for (const bad of ['not json', 42, [], null, undefined]) {
      expect(() => notificationText({
        title: 'x', body: 'y', messageKey: 'notif.quotation.received', messageParams: bad,
      }, t('en'))).not.toThrow();
    }
  });

  it('an unknown placeholder is left visible rather than blanked', () => {
    // Blanking hides that a parameter was never supplied; leaving it shows it.
    const text = notificationText({
      title: 'x', body: 'y',
      messageKey: 'notif.quotation.received',
      messageParams: {},
    }, t('en'));
    expect(text.body).toContain('{rfqTitle}');
  });
});

const quotationFixture = {
  title: 'New quotation received',
  body: 'You received a new quotation for "Villa slab"',
  messageKey: 'notif.quotation.received',
  messageParams: { rfqTitle: 'Villa slab' },
};

/**
 * The text of one call's arguments, from `start` to the parenthesis that closes
 * the call. Brace/paren balanced so a nested object or a template literal
 * cannot end the slice early.
 */
function argumentsOf(source: string, start: number): string {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return source.slice(start, start + 4000);
}

describe('the server writes the key everywhere it writes prose', () => {
  it('every notifyUser/notifyUsers call carries a messageKey, in EVERY server file', () => {
    // The defect this file exists to prevent is a NEW notification added the
    // old way. Counting the two against each other catches that - but only in
    // files it actually reads, which is why this counts per file and names
    // the offender rather than summing across the codebase.
    // PER CALL SITE, not two totals compared. Counting `messageKey: ` across a
    // whole file and comparing it to the number of notify calls was a proxy
    // that could be satisfied the wrong way in both directions: one call with
    // two keys and another with none summed to a pass, and any unrelated line
    // mentioning messageKey - a SELECT of notifications.messageKey, for
    // instance - broke it while every notification was correctly keyed.
    //
    // Now each call's own argument object is read and required to carry a key.
    const offenders: string[] = [];
    let total = 0;
    for (const [name, source] of SERVER_SOURCES) {
      if (name === 'notifications.ts') continue; // the transport, not a caller
      for (const match of source.matchAll(/notify(?:User|Users)\(db,/g)) {
        total += 1;
        // From the call to the end of its argument list. Brace-balanced rather
        // than a fixed window, so a long notification body cannot push its own
        // messageKey outside the slice being searched.
        const body = argumentsOf(source, match.index! + match[0].length);
        if (!/messageKey:/.test(body)) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${name}:${line}`);
        }
      }
    }
    expect(total, 'no notification call sites found at all').toBeGreaterThan(5);
    expect(offenders, 'a notification was added without a messageKey').toEqual([]);
  });

  it('the scan actually reaches quotationWorkflow.ts', () => {
    // Named explicitly, because this is the file the first version missed. A
    // rule that silently stops covering a file passes for the wrong reason.
    const names = SERVER_SOURCES.map(([name]) => name);
    expect(names).toContain('quotationWorkflow.ts');
    expect(names).toContain('routers.ts');
    const [, workflow] = SERVER_SOURCES.find(([name]) => name === 'quotationWorkflow.ts')!;
    // FOUR since closeRfqSecure landed - accept-winner, accept-losers,
    // reject, close. Was three. This number is a canary, not a fact worth
    // knowing: if it moves, somebody added a notification site, and the
    // messageKey rule in the test above is what actually checks the new one is
    // localised. It passed for the fourth site before this count was updated.
    expect([...workflow.matchAll(/notify(?:User|Users)\(db,/g)].length).toBe(4);
  });
});

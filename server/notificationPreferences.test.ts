/**
 * ── WHAT A PREFERENCE HAS TO BE TRUE TO BE A PREFERENCE ───────────────────
 *
 * Four rules this file exists to pin, each of which a plausible-looking
 * implementation gets wrong:
 *
 *   THE GATE IS AT THE WRITE, NOT AT THE SCREEN. A settings page that hides a
 *   row changes nothing about what BuildHub sends. The assertions below are
 *   about `notifyUser` and `notifyUsers` consulting the gate, because those
 *   two functions are the only places a notification is created.
 *
 *   MANDATORY IS DECIDED BEFORE THE TABLE IS READ. Not "unless a row says
 *   otherwise": a suppression row for `compliance` that reached the database
 *   by any route whatsoever must still not stop a registration decision.
 *   That is checked twice on purpose - once where rows are read, once where
 *   the decision is made - so neither check alone is load-bearing.
 *
 *   AN UNRECOGNISED KEY IS DELIVERED. The failure direction is chosen, not
 *   inherited. Over-delivery is visible and complainable; a message silently
 *   suppressed because nobody mapped its key is neither.
 *
 *   AND THE MAP DOES NOT GET TO ROT. The census reads every messageKey out of
 *   the server tree and fails if one of them resolves to no category - so the
 *   "fail open" above stays a safety net and never becomes the way the feature
 *   actually works.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  NOTIFICATION_CATEGORIES,
  MANDATORY_NOTIFICATION_CATEGORIES,
  OPTIONAL_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_PREFIXES,
  categoryForMessageKey,
  resolveCategoryWith,
  isMandatoryCategory,
  notificationCategoryHelp,
  notificationCategoryLabel,
  type NotificationCategory,
} from '@shared/notificationPreferences';
import {
  deliveryDecision,
  suppressedCategoriesFor,
  notificationPreferencesFor,
  setNotificationPreference,
  isNotificationCategory,
  NotificationPreferenceError,
} from './notificationPreferences';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const SCHEMA = readSourceForAssertions(read('../drizzle/schema.ts'));
const NOTIFICATIONS = readSourceForAssertions(read('./notifications.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const CONTEXT = read('../client/src/contexts/LanguageContext.tsx');
const MIGRATION = read('../drizzle/0051_notification_preferences.sql');
const SCREEN = readSourceForAssertions(read('../client/src/components/NotificationPreferences.tsx'));
const SETTINGS = readSourceForAssertions(read('../client/src/pages/SettingsPage.tsx'));

/** Every server source that could write a notification, found rather than listed. */
function serverSources(dir = new URL('./', import.meta.url)): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const child = new URL(name, dir);
    if (statSync(child).isDirectory()) { out.push(...serverSources(new URL(`${name}/`, dir))); continue; }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    out.push(readFileSync(child, 'utf8'));
  }
  return out;
}
const ALL_SERVER_CODE = serverSources().join('\n');

/** The two translation tables, as plain key -> string maps. */
function tableFor(lang: 'en' | 'ar'): Map<string, string> {
  const start = CONTEXT.indexOf(`\n  ${lang}: {`);
  const end = lang === 'en' ? CONTEXT.indexOf('\n  ar: {') : CONTEXT.indexOf('\n};', start);
  const block = CONTEXT.slice(start, end);
  const table = new Map<string, string>();
  for (const match of block.matchAll(/^\s{4}'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) table.set(match[1], match[2]);
  return table;
}
const EN = tableFor('en');
const AR = tableFor('ar');

/**
 * A db double that answers each select in order and records every write, so
 * the assertions are about what was WRITTEN rather than which branch was taken.
 * The `where()` result is lazy and consumed once - an eager answer charges two
 * responses to a `.where().limit()` and every later assertion reads the wrong
 * query's rows, which is how a harness makes real failures look like passes.
 */
function fakeDb(selects: unknown[][], options: { failReads?: boolean } = {}) {
  let call = 0;
  const writes: { kind: 'insert' | 'update'; values: any }[] = [];
  const answer = () => options.failReads
    ? Promise.reject(new Error('connection lost'))
    : Promise.resolve(selects[call++] ?? []);
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => {
          let pending: Promise<unknown> | null = null;
          const take = () => (pending ??= answer());
          return { limit: () => take(), then: (ok: any, err: any) => take().then(ok, err) };
        },
      }),
    }),
    insert: () => ({ values: (values: any) => { writes.push({ kind: 'insert', values }); return Promise.resolve(); } }),
    update: () => ({ set: (values: any) => ({ where: () => { writes.push({ kind: 'update', values }); return Promise.resolve(); } }) }),
    writes,
    get callCount() { return call; },
  };
  return db;
}

describe('the vocabulary is closed, and mandatory is a short defended list', () => {
  it('mandatory and optional partition the categories exactly', () => {
    expect(NOTIFICATION_CATEGORIES.length).toBeGreaterThan(0);
    const mandatory = new Set<string>(MANDATORY_NOTIFICATION_CATEGORIES);
    const optional = new Set<string>(OPTIONAL_NOTIFICATION_CATEGORIES);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(mandatory.has(category) !== optional.has(category), category).toBe(true);
    }
    expect(mandatory.size + optional.size).toBe(NOTIFICATION_CATEGORIES.length);
  });

  it('MANDATORY IS NARROW - it is the account, the money, the law and a proceeding', () => {
    // Pinned as a literal set, because the value of "mandatory" is entirely in
    // its shortness. A category quietly added here takes a switch away from
    // every user on the platform, and that should require editing a test that
    // says so rather than appending to a list.
    expect([...MANDATORY_NOTIFICATION_CATEGORIES].sort()).toEqual(
      ['account', 'billing', 'compliance', 'disputes', 'moderation'],
    );
  });

  it('every optional category is genuinely switchable and every mandatory one is not', () => {
    for (const category of OPTIONAL_NOTIFICATION_CATEGORIES) expect(isMandatoryCategory(category)).toBe(false);
    for (const category of MANDATORY_NOTIFICATION_CATEGORIES) expect(isMandatoryCategory(category)).toBe(true);
  });

  it('isNotificationCategory refuses anything outside the vocabulary', () => {
    for (const category of NOTIFICATION_CATEGORIES) expect(isNotificationCategory(category)).toBe(true);
    for (const bogus of ['', 'Account', 'billing ', 'everything', 'account;--']) {
      expect(isNotificationCategory(bogus), bogus).toBe(false);
    }
  });

  it('every category has a label AND a help line in both languages', () => {
    // A coverage test over an empty map passes for the wrong reason.
    expect(EN.size).toBeGreaterThan(200);
    expect(AR.size).toBeGreaterThan(200);
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const key of [notificationCategoryLabel(category), notificationCategoryHelp(category)]) {
        expect(EN.get(key), `${key} EN`).toBeTruthy();
        expect(AR.get(key), `${key} AR`).toBeTruthy();
        // Arabic that is the English string is an untranslated placeholder.
        expect(AR.get(key), `${key} untranslated`).not.toBe(EN.get(key));
      }
    }
  });

  it('a mandatory category explains WHY in its help text, rather than only refusing', () => {
    // A locked switch with no reason reads as a bug. Each of these has to name
    // the consequence of not receiving the message.
    for (const category of MANDATORY_NOTIFICATION_CATEGORIES) {
      const help = EN.get(notificationCategoryHelp(category)) ?? '';
      expect(help.length, category).toBeGreaterThan(30);
    }
  });
});

describe('a message key resolves to exactly one category, by longest prefix', () => {
  it('the two namespaces that split resolve to DIFFERENT categories', () => {
    // This is the whole reason resolution is longest-prefix rather than first
    // match. Somebody rating you is news you may mute; a moderation decision
    // and a benefit being taken back are not.
    expect(categoryForMessageKey('notif.review.received')).toBe('reviews');
    expect(categoryForMessageKey('notif.review.reportResolved')).toBe('moderation');
    expect(categoryForMessageKey('notif.referral.reward')).toBe('referrals');
    expect(categoryForMessageKey('notif.referral.attributed')).toBe('referrals');
    expect(categoryForMessageKey('notif.referral.reversed.bonus_revoked')).toBe('billing');
  });

  it('resolution does not depend on the order the prefixes happen to be written', () => {
    // THE REAL FUNCTION, over a reordered table - not a copy of it.
    //
    // The first version of this test reimplemented longest-prefix locally and
    // compared the copy against `categoryForMessageKey`. It passed with the
    // product mutated to take the FIRST match rather than the longest, because
    // the prefixes are written specific-before-general and first-match is
    // accidentally right for every key BuildHub sends today. A test that
    // compares two implementations only catches them disagreeing, and these
    // two agreed while one of them was wrong.
    const reversed = Object.fromEntries(Object.entries(NOTIFICATION_CATEGORY_PREFIXES).reverse());
    for (const key of ['notif.review.reportResolved', 'notif.referral.reversed.x', 'notif.review.received', 'notif.referral.reward']) {
      expect(resolveCategoryWith(reversed as any, key), key).toBe(categoryForMessageKey(key));
    }
    // And the canonical table still resolves the split namespaces correctly,
    // so this cannot pass by both sides being equally wrong.
    expect(resolveCategoryWith(reversed as any, 'notif.review.reportResolved')).toBe('moderation');
  });

  it('a prefix matches on a SEGMENT boundary, never on a shared word start', () => {
    // 'notif.review' must not swallow a future 'notif.reviewboard.*'. A bare
    // startsWith would, and would file it under reviews for ever.
    expect(categoryForMessageKey('notif.reviewboard.invited')).toBeNull();
    expect(categoryForMessageKey('notif.messages.received')).toBeNull();
    expect(categoryForMessageKey('notif.message')).toBe('messages');
    expect(categoryForMessageKey('notif.message.received')).toBe('messages');
  });

  it('an unknown, empty or absent key resolves to nothing', () => {
    expect(categoryForMessageKey('notif.not.in.this.build')).toBeNull();
    expect(categoryForMessageKey('')).toBeNull();
    expect(categoryForMessageKey(null)).toBeNull();
    expect(categoryForMessageKey(undefined)).toBeNull();
  });

  it('every prefix in the table points at a real category', () => {
    for (const [prefix, category] of Object.entries(NOTIFICATION_CATEGORY_PREFIXES)) {
      expect(isNotificationCategory(category), prefix).toBe(true);
    }
  });
});

describe('THE CENSUS: no notification BuildHub can send is unmapped', () => {
  /**
   * Every messageKey written anywhere in the server tree, reduced to the part
   * that is statically known. Several call sites build their key at runtime -
   * `notif.compliance.document.${input.status}` - and the static part is what
   * prefix resolution actually sees.
   */
  const keys = [...ALL_SERVER_CODE.matchAll(/messageKey: *(?:\n\s*)?['`]([^'`]+)['`]/g)]
    .map(match => match[1])
    .map(raw => ({ raw, stem: raw.split('${')[0].replace(/\.$/, '') }));

  it('finds the keys at all - an empty census passes vacuously', () => {
    const distinct = new Set(keys.map(key => key.raw));
    expect(distinct.size).toBeGreaterThan(20);
    expect([...distinct]).toContain('notif.quotation.received');
  });

  it('every message key the server can write resolves to a category', () => {
    const unmapped = keys.filter(key => categoryForMessageKey(key.stem) === null);
    expect(unmapped.map(key => key.raw)).toEqual([]);
  });

  it('no TEMPLATED key could expand past its own category', () => {
    // The subtle failure this catches: if a key's static stem is
    // 'notif.review' and the table also contains 'notif.review.reportResolved',
    // then the census above passes on the stem while the real, expanded key
    // lands in a different category at runtime. Any such overlap has to be
    // resolved by naming the expansion explicitly, not left to the stem.
    const ambiguous: string[] = [];
    for (const key of keys) {
      if (!key.raw.includes('${')) continue;
      for (const prefix of Object.keys(NOTIFICATION_CATEGORY_PREFIXES)) {
        if (prefix.startsWith(`${key.stem}.`)) ambiguous.push(`${key.raw} vs ${prefix}`);
      }
    }
    expect(ambiguous).toEqual([]);
  });

  it('the mandatory categories are the ones carrying the compliance, billing and dispute keys', () => {
    // Read from the source rather than asserted about the table: the point is
    // that the messages BuildHub actually sends about registrations, money and
    // proceedings are the unmutable ones.
    const stems = new Set(keys.map(key => key.stem));
    for (const stem of ['notif.compliance.applicant', 'notif.dispute.raised']) {
      expect(stems.has(stem), stem).toBe(true);
      expect(isMandatoryCategory(categoryForMessageKey(stem)!), stem).toBe(true);
    }
  });
});

describe('the delivery decision', () => {
  it('delivers a mandatory category even when it is explicitly suppressed', () => {
    // The second of the two checks. A row saying "no compliance notifications"
    // is ignored here regardless of how it got into the table.
    for (const category of MANDATORY_NOTIFICATION_CATEGORIES) {
      const suppressed = new Set<NotificationCategory>([category]);
      const key = Object.entries(NOTIFICATION_CATEGORY_PREFIXES)
        .find(([, value]) => value === category)![0];
      expect(deliveryDecision(`${key}.anything`, suppressed), category).toEqual({ deliver: true, category });
    }
  });

  it('withholds an optional category the user switched off', () => {
    expect(deliveryDecision('notif.product.question', new Set(['product_qa'])))
      .toEqual({ deliver: false, category: 'product_qa' });
  });

  it('delivers an optional category the user has not switched off', () => {
    expect(deliveryDecision('notif.product.question', new Set(['messages'])))
      .toEqual({ deliver: true, category: 'product_qa' });
    expect(deliveryDecision('notif.product.question', undefined))
      .toEqual({ deliver: true, category: 'product_qa' });
  });

  it('delivers an unrecognised key even to a user who switched off everything', () => {
    const everything = new Set<NotificationCategory>(NOTIFICATION_CATEGORIES);
    expect(deliveryDecision('notif.not.in.this.build', everything))
      .toEqual({ deliver: true, category: null });
    expect(deliveryDecision(null, everything)).toEqual({ deliver: true, category: null });
  });
});

describe('reading preferences', () => {
  it('reports only the categories a user actually switched off', async () => {
    const db = fakeDb([[
      { userId: 5, category: 'product_qa', enabled: false },
      { userId: 5, category: 'messages', enabled: true },
    ]]);
    const map = await suppressedCategoriesFor(db, [5]);
    expect([...(map.get(5) ?? [])]).toEqual(['product_qa']);
  });

  it('DROPS a suppression row for a mandatory category on the way out', () => {
    // The first of the two checks. No caller is ever handed a suppression it
    // is required to ignore, so no caller can forget to ignore it.
    return suppressedCategoriesFor(
      fakeDb([[{ userId: 5, category: 'compliance', enabled: false }]]),
      [5],
    ).then(map => expect(map.get(5)).toBeUndefined());
  });

  it('ignores a row naming a category that no longer exists', async () => {
    const map = await suppressedCategoriesFor(
      fakeDb([[{ userId: 5, category: 'carrier_pigeon', enabled: false }]]),
      [5],
    );
    expect(map.get(5)).toBeUndefined();
  });

  it('DELIVERS when the preference read fails - a database hiccup is not a mute', async () => {
    const map = await suppressedCategoriesFor(fakeDb([], { failReads: true }), [5]);
    expect(map.size).toBe(0);
    expect(deliveryDecision('notif.product.question', map.get(5)).deliver).toBe(true);
  });

  it('does not query at all for an empty recipient list', async () => {
    const db = fakeDb([[{ userId: 5, category: 'product_qa', enabled: false }]]);
    expect((await suppressedCategoriesFor(db, [])).size).toBe(0);
    expect(db.callCount).toBe(0);
  });

  it('keeps recipients apart - one muted user does not mute the batch', async () => {
    const map = await suppressedCategoriesFor(fakeDb([[
      { userId: 5, category: 'product_qa', enabled: false },
      { userId: 6, category: 'messages', enabled: false },
    ]]), [5, 6]);
    expect([...(map.get(5) ?? [])]).toEqual(['product_qa']);
    expect([...(map.get(6) ?? [])]).toEqual(['messages']);
  });

  it('the user view lists EVERY category, not only the stored exceptions', async () => {
    const rows = await notificationPreferencesFor(fakeDb([[]]), 5);
    expect(rows.map(row => row.category).sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
    expect(rows.every(row => row.enabled)).toBe(true);
  });

  it('the user view reports a mandatory category as on even with a suppression row', async () => {
    const rows = await notificationPreferencesFor(
      fakeDb([[{ userId: 5, category: 'compliance', enabled: false }]]),
      5,
    );
    expect(rows.find(row => row.category === 'compliance')).toEqual(
      { category: 'compliance', mandatory: true, enabled: true },
    );
  });
});

describe('recording a choice', () => {
  it('refuses a category that is not in the vocabulary', async () => {
    await expect(setNotificationPreference(fakeDb([[]]), { userId: 5, category: 'everything', enabled: false }))
      .rejects.toMatchObject({ code: 'UNKNOWN_CATEGORY' });
  });

  it('REFUSES TO SWITCH OFF A MANDATORY CATEGORY, server-side', async () => {
    for (const category of MANDATORY_NOTIFICATION_CATEGORIES) {
      const db = fakeDb([[]]);
      await expect(
        setNotificationPreference(db, { userId: 5, category, enabled: false }),
        category,
      ).rejects.toBeInstanceOf(NotificationPreferenceError);
      // And refused means nothing was written, not "wrote it then complained".
      expect(db.writes, category).toEqual([]);
    }
  });

  it('allows a mandatory category to be switched ON, which is what it already is', async () => {
    const db = fakeDb([[]]);
    await expect(setNotificationPreference(db, { userId: 5, category: 'billing', enabled: true }))
      .resolves.toEqual({ category: 'billing', enabled: true });
  });

  it('writes a new row for a first choice, carrying the caller id', async () => {
    const db = fakeDb([[]]);
    await setNotificationPreference(db, { userId: 5, category: 'product_qa', enabled: false });
    expect(db.writes).toEqual([{ kind: 'insert', values: { userId: 5, category: 'product_qa', enabled: false } }]);
  });

  it('UPDATES the existing row rather than adding a second one', async () => {
    // The unique index makes a second row impossible, and this is the code
    // path that keeps it from being attempted.
    const db = fakeDb([[{ id: 99 }]]);
    await setNotificationPreference(db, { userId: 5, category: 'product_qa', enabled: true });
    expect(db.writes).toEqual([{ kind: 'update', values: { enabled: true } }]);
  });
});

describe('the gate is wired where notifications are written', () => {
  it('BOTH notifyUser and notifyUsers consult it', () => {
    const single = NOTIFICATIONS.slice(
      NOTIFICATIONS.indexOf('export async function notifyUser('),
      NOTIFICATIONS.indexOf('export async function notifyUsers('),
    );
    const many = NOTIFICATIONS.slice(NOTIFICATIONS.indexOf('export async function notifyUsers('));
    for (const [name, body] of [['notifyUser', single], ['notifyUsers', many]] as const) {
      expect(body, name).toContain('suppressedCategoriesFor');
      expect(body, name).toContain('deliveryDecision');
      // Before the insert, not after it.
      expect(body.indexOf('deliveryDecision'), name).toBeLessThan(body.indexOf('db.insert(notifications)'));
    }
  });

  it('the bulk path decides PER RECIPIENT rather than for the batch', () => {
    const many = NOTIFICATIONS.slice(NOTIFICATIONS.indexOf('export async function notifyUsers('));
    // A single shared decision would be the easy mistake, and would let one
    // muted recipient silence a compliance decision addressed to forty others.
    expect(many).toContain('suppressed.get(params.userId)');
    expect(many).toContain('.filter(');
  });

  it('no notification writer bypasses the seam by inserting the table directly', () => {
    const direct = [...ALL_SERVER_CODE.matchAll(/\.insert\(notifications\)/g)].length;
    expect(direct).toBe(2); // notifyUser and notifyUsers, and nothing else.
  });
});

describe('the procedures answer for the caller and nobody else', () => {
  const slice = (name: string) => {
    const start = ROUTERS.indexOf(`  ${name}: protectedProcedure`);
    expect(start, name).toBeGreaterThan(-1);
    // To the next procedure, rather than a fixed window: a doc comment growing
    // by a paragraph must not push the guard out of what is being read.
    const rest = ROUTERS.slice(start + name.length + 4);
    const next = rest.search(/\n  [a-zA-Z]+: (protected|public|admin)/);
    return rest.slice(0, next === -1 ? undefined : next);
  };

  it('setPreference takes the user from the session, not from the input', () => {
    const body = slice('setPreference');
    expect(body).toContain('userId: ctx.user.id');
    expect(body).not.toContain('input.userId');
  });

  it('setPreference does not accept a userId at all, so there is none to tamper with', () => {
    expect(slice('setPreference')).not.toMatch(/userId: z\./);
  });

  it('both procedures are protected - preferences are not a public read', () => {
    for (const name of ['preferences', 'setPreference']) {
      expect(ROUTERS, name).toContain(`  ${name}: protectedProcedure`);
    }
  });

  it('a refused mandatory change comes back as FORBIDDEN, not as a 500', () => {
    const mapper = ROUTERS.slice(ROUTERS.indexOf('function asNotificationPreferenceTrpcError'));
    expect(mapper.slice(0, 500)).toContain("'FORBIDDEN'");
    expect(mapper.slice(0, 500)).toContain("'BAD_REQUEST'");
  });
});

describe('the table says what the code assumes', () => {
  it('carries userId, category and enabled', () => {
    const table = SCHEMA.slice(
      SCHEMA.indexOf("export const notificationPreferences = mysqlTable"),
      SCHEMA.indexOf('}));', SCHEMA.indexOf("export const notificationPreferences = mysqlTable")),
    );
    expect(table).toContain("varchar('category'");
    expect(table).toContain("boolean('enabled')");
    expect(table).toContain('.notNull()');
  });

  it('ONE ROW PER USER PER CATEGORY - the uniqueness is the model', () => {
    // Two rows for the same pair would make "is this on" a question with two
    // answers, settled by whichever the database returned first.
    expect(SCHEMA).toContain("uniqueIndex('notificationPreferences_user_category_idx')");
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX `notificationPreferences_user_category_idx`');
  });

  it('the migration backfills NOTHING, so no existing user loses a notification', () => {
    // Absence means on. A backfill would write a row per user per category and
    // turn a safe default into fourteen million rows that can drift.
    expect(MIGRATION).not.toMatch(/INSERT INTO `?notificationPreferences/i);
    expect(MIGRATION).not.toMatch(/UPDATE `?notificationPreferences/i);
  });

  it('every statement is separated for the migration runner', () => {
    // Comment lines are stripped FIRST. The first version of this counted
    // semicolons across the whole file and read the two in the header prose as
    // SQL statements - it failed on a migration that was correct, which is the
    // same defect as passing one that is not.
    const sql = MIGRATION.split('\n')
      // Not `startsWith('--')`: the breakpoint token starts with '--' too, and
      // stripping it left one chunk containing every statement.
      .filter(line => !/^\s*--(?!>)/.test(line))
      .join('\n');
    const chunks = sql.split('--> statement-breakpoint');
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.split(';').filter(part => part.trim().length > 0).length).toBe(1);
    }
    // And the separator is the exact token the runner looks for.
    expect(MIGRATION.split('-->').length - 1).toBe(chunks.length - 1);
  });
});

describe('the screen tells the truth about what BuildHub can actually send', () => {
  it('OFFERS NO EMAIL OR SMS SWITCH, because neither channel exists', () => {
    // `server/_core/mailer.ts` has no configured provider and no notification
    // is routed to it; there is no SMS sender at all. A switch labelled Email
    // would be wired to nothing, and the user would believe they had turned
    // something on.
    expect(SCREEN).not.toMatch(/Switch[^>]*email/i);
    expect(SCREEN).not.toMatch(/Switch[^>]*sms/i);
    expect(SCREEN).toContain('notifPrefs.channelNote');
  });

  it('says so in both languages rather than leaving the absence unexplained', () => {
    for (const table of [EN, AR]) {
      const note = table.get('notifPrefs.channelNote') ?? '';
      expect(note.length).toBeGreaterThan(30);
    }
    expect(EN.get('notifPrefs.channelNote')).toMatch(/email/i);
  });

  it('SHOWS the mandatory categories rather than hiding them, locked and explained', () => {
    // Hiding them is easier and leaves a user wondering why a registration
    // decision arrived after they "turned notifications off".
    expect(SCREEN).toContain('notifPrefs.mandatoryHeading');
    expect(SCREEN).toContain('notifPrefs.requiredNote');
    expect(SCREEN).toContain('notificationCategoryHelp');
  });

  it('reads "locked" from the shared vocabulary, so screen and server agree', () => {
    expect(SCREEN).toContain('isMandatoryCategory');
  });

  it('every string on the screen goes through t(), so nothing is English-only', () => {
    // Any bare quoted sentence here would be a string a reader of the Arabic
    // site sees in English.
    const jsxText = [...SCREEN.matchAll(/>\s*([A-Za-z][A-Za-z ,.'-]{12,})\s*</g)].map(m => m[1]);
    expect(jsxText).toEqual([]);
  });

  it('distinguishes "could not load" from "nothing to show"', () => {
    expect(SCREEN).toContain('LoadFailed');
    expect(SCREEN).toContain('prefs.isError');
    // And the two states are separately identifiable to anything checking.
    expect(SCREEN).toContain('notification-preferences-loading');
  });

  it('PUTS THE SWITCH BACK when the server refuses the change', () => {
    // A control that stays where the user left it while the server refused
    // tells them the opposite of what happened.
    const onError = SCREEN.slice(SCREEN.indexOf('onError:'), SCREEN.indexOf('onError:') + 300);
    expect(onError).toContain('invalidate');
    expect(onError).toContain('setFailed');
  });

  it('is reachable - Settings mounts it, for every role', () => {
    // Not behind an isProvider branch: a homeowner receives quotations,
    // messages and review notifications too.
    expect(SETTINGS).toContain('<NotificationPreferences />');
    const section = SETTINGS.slice(
      SETTINGS.indexOf('id="settings-notifications"'),
      SETTINGS.indexOf('<NotificationPreferences />'),
    );
    expect(section).not.toContain('isProvider');
  });
});

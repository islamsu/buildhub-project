/**
 * ── AN AUDIT REPORT THAT STOPS AT 1,000 AND DOES NOT SAY SO ───────────────
 *
 * `server/adminList.ts` exists to end one defect and its header names it: a
 * screen that truncates silently and filters what is left in the browser
 * answers "nothing matches" when the match is past the cut, with exactly the
 * confidence it answers correctly. The audit surface was still doing it in both
 * readers - 1,000 platform-wide, 100 per account, neither with a total.
 *
 * An audit report is the one screen whose entire value is that it is COMPLETE.
 *
 * Four rules pinned here:
 *
 *   THE COUNT AND THE ROWS ARE FILTERED IDENTICALLY, including the joins - a
 *   search reaches across both identity tables, so a count over the bare table
 *   would count rows the page cannot show, and "Page 1 of 9" over one page is a
 *   worse lie than no pager.
 *
 *   THE JOINS ARE LEFT, NEVER INNER. Both id columns are nullable ON PURPOSE so
 *   the trail outlives its subject; an inner join would drop exactly the events
 *   about deleted accounts, which is the history most worth keeping.
 *
 *   NO USER ROW IS READ WHOLESALE. The old report built its identity columns
 *   from a map over EVERY account in the database - passwordHash and
 *   invitationToken included - to decorate an export.
 *
 *   AND THE FILTER OPTIONS COME FROM THE DATA, because `action` is a varchar
 *   written by forty-odd call sites and a hand-kept list of them would silently
 *   omit the newest one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { listAccountAudit, auditFilterOptions } from './accountAuditView';
import { ADMIN_PAGE_SIZE_MAX } from './adminList';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const VIEW = readSourceForAssertions(read('./accountAuditView.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const TRAIL = readSourceForAssertions(read('../client/src/components/AdminAuditTrail.tsx'));
const DASHBOARD = readSourceForAssertions(read('../client/src/pages/AdminDashboard.tsx'));

/**
 * A db double that records the chain each query built, so the assertions can be
 * about WHAT WAS ASKED rather than about what came back. `where` is captured
 * for both queries, because "the count and the rows are filtered identically"
 * is a claim about two calls agreeing.
 */
function fakeDb(rows: any[], total = rows.length) {
  const calls: { kind: 'count' | 'rows'; joins: number; where: unknown; ordered: unknown[] }[] = [];
  let n = 0;
  const chain = (kind: 'count' | 'rows') => {
    const record = { kind, joins: 0, where: undefined as unknown, ordered: [] as unknown[] };
    calls.push(record);
    const self: any = {
      leftJoin: () => { record.joins += 1; return self; },
      innerJoin: () => { record.joins += 100; return self; },
      where: (predicate: unknown) => { record.where = predicate; return self; },
      orderBy: (...parts: unknown[]) => { record.ordered = parts; return self; },
      limit: () => self,
      offset: () => Promise.resolve(rows),
      then: (ok: any, err: any) =>
        Promise.resolve(kind === 'count' ? [{ count: total }] : rows).then(ok, err),
    };
    return self;
  };
  return {
    select: () => ({ from: () => chain((n++ === 0 ? 'count' : 'rows')) }),
    selectDistinct: () => ({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
    calls,
  } as any;
}

const event = (over: Record<string, unknown> = {}) => ({
  id: 1, action: 'admin_user_frozen', source: 'admin', note: 'spam',
  createdAt: new Date('2026-03-01'),
  userId: 77, userName: 'Mona Said', userEmail: 'mona@example.test',
  actorId: 4, actorName: 'Super Admin', actorEmail: 'admin@example.test',
  subjectIsDummy: false, subjectAccountSource: 'self', subjectUserRole: 'contractor',
  subjectRole: 'user', subjectAccountStatus: 'frozen', subjectInvitationStatus: 'none',
  ...over,
});

describe('the count and the rows cannot disagree', () => {
  it('BOTH queries carry BOTH joins, so a search over a name counts what it shows', async () => {
    const db = fakeDb([event()]);
    await listAccountAudit(db, { search: 'Mona' });
    const [count, rows] = db.calls;
    expect(count.joins).toBe(2);
    expect(rows.joins).toBe(2);
  });

  it('and the SAME predicate object reaches both', async () => {
    const db = fakeDb([event()]);
    await listAccountAudit(db, { action: 'admin_user_frozen' });
    expect(db.calls[0].where).toBe(db.calls[1].where);
  });

  it('an unfiltered read passes no predicate at all, rather than an empty and()', async () => {
    // drizzle renders a bare `and()` as SQL matching nothing, so an unfiltered
    // list would come back empty and read as "there is nothing here".
    const db = fakeDb([event()]);
    await listAccountAudit(db, {});
    expect(db.calls[0].where).toBeUndefined();
  });

  it('reports the REAL total, not the number of rows returned', async () => {
    const page = await listAccountAudit(fakeDb([event()], 4213), {});
    expect(page.total).toBe(4213);
    expect(page.rows).toHaveLength(1);
  });
});

describe('the joins are LEFT, so the trail outlives its subject', () => {
  it('no reader inner-joins the identity tables', async () => {
    const db = fakeDb([event()]);
    await listAccountAudit(db, {});
    expect(db.calls.every((call: any) => call.joins === 2)).toBe(true);
    expect(VIEW).not.toContain('innerJoin');
  });

  it('an event whose subject is gone still renders, with no name to show', async () => {
    const page = await listAccountAudit(
      fakeDb([event({ userId: null, userName: null, userEmail: null })]), {});
    expect(page.rows[0]).toMatchObject({ userId: null, userName: null });
  });

  it('AN EVENT NOBODY PERFORMED IS "System", not a blank column', async () => {
    // A blank actor invites the reader to assume an administrator did it.
    const page = await listAccountAudit(
      fakeDb([event({ actorId: null, actorName: null, actorEmail: null })]), {});
    expect(page.rows[0].actorName).toBe('System');
  });

  it('an actor with no name falls back to the email, then the id - never nothing', async () => {
    const byEmail = await listAccountAudit(fakeDb([event({ actorName: null })]), {});
    expect(byEmail.rows[0].actorName).toBe('admin@example.test');
    const byId = await listAccountAudit(fakeDb([event({ actorName: null, actorEmail: null })]), {});
    expect(byId.rows[0].actorName).toBe('#4');
  });
});

describe('no user row is read wholesale', () => {
  it('the six subject columns are named, and nothing else', () => {
    expect(VIEW).toContain('subjectAccountStatus: subject.accountStatus');
    expect(VIEW).toContain('subjectInvitationStatus: subject.invitationStatus');
    for (const secret of ['passwordHash', 'invitationToken', 'openId']) {
      expect(VIEW, `${secret} must never be selected here`).not.toContain(secret);
    }
  });

  it('and the procedure no longer touches the users table itself', () => {
    const body = ROUTERS.slice(
      ROUTERS.indexOf("fullAuditReport: adminWith('audit.read')"),
      ROUTERS.indexOf("auditFilterOptions: adminWith('audit.read')"),
    );
    expect(body).not.toMatch(/from\(users\)/);
    expect(body).toContain('listAccountAudit');
  });

  it('the derived account type is computed from the joined columns', async () => {
    const dummy = await listAccountAudit(fakeDb([event({ subjectIsDummy: true })]), {});
    expect(dummy.rows[0].accountType).toBe('Dummy / Test');
    const created = await listAccountAudit(fakeDb([event({ subjectAccountSource: 'admin_created' })]), {});
    expect(created.rows[0].accountType).toBe('Admin Created');
    const self = await listAccountAudit(fakeDb([event()]), {});
    expect(self.rows[0].accountType).toBe('Self Registered');
  });
});

describe('the ordering is stable', () => {
  it('newest first, THEN by id - or a row can appear on two pages', async () => {
    const db = fakeDb([event()]);
    await listAccountAudit(db, {});
    expect(db.calls[1].ordered).toHaveLength(2);
    expect(VIEW).toContain('desc(userAccountAuditEvents.createdAt), desc(userAccountAuditEvents.id)');
  });
});

describe('the search', () => {
  it('reaches BOTH identities, because "Mona" means the person either way', () => {
    // Sliced from `term ? or(` to the end of that ternary. The first attempt
    // cut at `') : null,'` which the EARLIER filters match first, producing an
    // empty slice that contained nothing and would have passed had the
    // assertion been a `not.toContain`.
    const start = VIEW.indexOf('term ? or(');
    expect(start, 'the search filter is gone entirely').toBeGreaterThan(-1);
    const where = VIEW.slice(start, VIEW.indexOf(']);', start));
    for (const column of ['subject.name', 'subject.email', 'actor.name', 'actor.email']) {
      expect(where, `${column} is not searched`).toContain(column);
    }
    expect(where).toContain('userAccountAuditEvents.note');
  });

  it('USES THE ONE ESCAPER rather than building its own LIKE pattern', () => {
    // The first version escaped inline. It happened to be correct and was still
    // wrong to have; `searchInputHardening.test.ts` is what found it.
    expect(VIEW).toContain('containsTerm(term)');
    expect(VIEW).not.toMatch(/`%\$\{/);
  });

  it('an action is matched EXACTLY, never by prefix', () => {
    // `admin_user_frozen` and `admin_user_unfrozen` share one, and a prefix
    // match would conflate freezing an account with releasing it.
    expect(VIEW).toContain('eq(userAccountAuditEvents.action, query.action)');
    expect(VIEW).not.toContain('like(userAccountAuditEvents.action');
  });
});

describe('the filter options come from the data', () => {
  it('read distinct from the table, not from a list restated here', async () => {
    const options = await auditFilterOptions(fakeDb([{ value: 'admin_user_frozen' }]));
    expect(options.actions).toEqual(['admin_user_frozen']);
    expect(VIEW).toContain('selectDistinct');
  });

  it('and a null source is dropped rather than offered as a blank choice', async () => {
    const options = await auditFilterOptions(fakeDb([{ value: null }]));
    expect(options.sources).toEqual([]);
  });
});

describe('the screens', () => {
  it('a caller cannot ask for an unbounded page', () => {
    const body = ROUTERS.slice(
      ROUTERS.indexOf("fullAuditReport: adminWith('audit.read')"),
      ROUTERS.indexOf("auditFilterOptions: adminWith('audit.read')"),
    );
    expect(body).toContain('.max(ADMIN_PAGE_SIZE_MAX)');
    expect(ADMIN_PAGE_SIZE_MAX).toBeLessThanOrEqual(100);
  });

  it('THE EXPORT WALKS EVERY PAGE — or it would truncate at 25 instead of 1,000', () => {
    const exporter = DASHBOARD.slice(DASHBOARD.indexOf('const exportAuditPdf'));
    expect(exporter.slice(0, 1400)).toContain('auditRows.length >= page.total');
    expect(exporter.slice(0, 1400)).toContain('pageSize: 100');
  });

  it('the screen shows the REAL TOTAL, which is what tells an administrator it is complete', () => {
    expect(TRAIL).toContain('data-testid="audit-total"');
    expect(TRAIL).toContain('accounts.data?.total');
  });

  it('and distinguishes "nothing matches" from "nothing has happened"', () => {
    // An administrator who cannot tell those apart reads a bad filter as a
    // quiet platform.
    expect(TRAIL).toContain('No event matches this search.');
    expect(TRAIL).toContain('No account event has been recorded yet.');
  });

  it('the search is debounced, so it is one request per pause', () => {
    expect(TRAIL).toContain('setTimeout');
    expect(TRAIL).toContain('setDebouncedSearch');
  });

  it('and changing a filter returns to the first page', () => {
    // Otherwise a search runs against page 7 of the old result and looks empty.
    const filter = TRAIL.slice(TRAIL.indexOf('data-testid="audit-action-filter"') - 400);
    expect(filter.slice(0, 500)).toContain('setAuditPage(0)');
  });

  it('the pager is bilingual and both controls exist', () => {
    for (const id of ['audit-pager', 'audit-prev', 'audit-next', 'audit-page-label']) {
      expect(TRAIL, id).toContain(`data-testid="${id}"`);
    }
  });
});

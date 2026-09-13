/**
 * ── THE ACCOUNT AUDIT TRAIL, READ AS A LIST ───────────────────────────────
 *
 * `server/adminList.ts` was written to end one defect, and its own header names
 * it: a screen that truncates silently and filters what is left in the browser
 * will answer "nothing matches" when the match is on the row after the cut,
 * with exactly the same confidence it answers correctly. The audit surface was
 * still doing it, in both of its readers:
 *
 *   `admin.fullAuditReport` took the most recent 1,000 events and returned a
 *   bare array. An audit report is the one screen whose entire value is that
 *   it is COMPLETE; one that quietly stops at a thousand and does not say so
 *   is worse than none, because it will be relied on.
 *
 *   `admin.accountAudit` took the most recent 100 for one account, with no
 *   total. A long-lived vendor's early history - the approval, the first freeze,
 *   the name correction - is exactly the part that falls off the end, and it is
 *   exactly the part somebody opens this screen to find.
 *
 * Neither offered a filter, a search or a page. This routes both through
 * `adminPage`, so the count and the rows are filtered identically by
 * construction and a caller cannot forget.
 *
 * ── IDENTITIES, NOT IDS ───────────────────────────────────────────────────
 *
 * The rows carried `userId` and `actorId` and nothing else, so the screen
 * showed "actor 41 froze user 208". Both are LEFT joined, never inner: the
 * columns are nullable ON PURPOSE - an audit event must outlive the account it
 * describes - and an inner join would silently drop precisely the events about
 * deleted users, which is the history most worth keeping.
 */
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { userAccountAuditEvents, users } from '../drizzle/schema';
import { adminPage, allOf, COUNT, ADMIN_PAGE_SIZE_DEFAULT, type AdminPage } from './adminList';
import { containsTerm, MAX_SEARCH_LENGTH } from './_core/searchTerms';

type Db = any;

/** The two identities a row carries, aliased so one table can be joined twice. */
const subject = alias(users, 'auditSubject');
const actor = alias(users, 'auditActor');

export type AuditRow = {
  id: number;
  action: string;
  source: string | null;
  note: string | null;
  createdAt: Date;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  actorId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  /** Derived from the subject, for the report export. */
  accountType: string;
  role: string;
  accountStatus: string;
  invitationStatus: string;
};

export type AuditQuery = {
  /** One account's history. Omitted for the platform-wide report. */
  userId?: number;
  /** Exactly one action, e.g. `admin_user_frozen`. */
  action?: string;
  /** Where the event came from, e.g. `admin`, `self_service`. */
  source?: string;
  /** Events by one administrator, which is the "what did they do" question. */
  actorId?: number;
  from?: Date;
  to?: Date;
  /**
   * Free text across the action, the note, and BOTH identities - because an
   * administrator searching "Mona" means the person, and does not know or care
   * whether Mona was the subject or the actor.
   */
  search?: string;
  page?: number;
  pageSize?: number;
};

/**
 * THE ONE ESCAPER, not a second one written here.
 *
 * The first version of this file built its own `%term%` inline. It happened to
 * be correct, and it was still wrong to have: `containsTerm` already neutralises
 * the user's wildcards - so a search for "100%" is not a search for everything -
 * and `searchInputHardening.test.ts` exists to catch exactly this, which is how
 * the duplicate was found.
 */
const contains = (column: unknown, term: string) => like(column as never, containsTerm(term));

export async function listAccountAudit(db: Db, query: AuditQuery): Promise<AdminPage<AuditRow>> {
  const term = query.search?.trim().slice(0, MAX_SEARCH_LENGTH);
  const where = allOf(and, [
    query.userId ? eq(userAccountAuditEvents.userId, query.userId) : null,
    query.actorId ? eq(userAccountAuditEvents.actorId, query.actorId) : null,
    // `action` and `source` are varchars, not enums, so there is no column to
    // read an allowed set from and `enumFilter` does not apply. Matched exactly
    // rather than by prefix: `admin_user_frozen` and `admin_user_unfrozen`
    // share one, and a prefix match would conflate freezing with releasing.
    query.action ? eq(userAccountAuditEvents.action, query.action) : null,
    query.source ? eq(userAccountAuditEvents.source, query.source) : null,
    query.from ? gte(userAccountAuditEvents.createdAt, query.from) : null,
    query.to ? lte(userAccountAuditEvents.createdAt, query.to) : null,
    term ? or(
      contains(userAccountAuditEvents.action, term),
      contains(userAccountAuditEvents.note, term),
      contains(subject.name, term),
      contains(subject.email, term),
      contains(actor.name, term),
      contains(actor.email, term),
    ) : null,
  ]);

  // BOTH QUERIES CARRY BOTH JOINS. The search reaches across them, so a count
  // built on the bare table would count rows the page cannot show - and "Page 1
  // of 9" over one page of results is a worse lie than no pager at all.
  const countQuery = db.select(COUNT).from(userAccountAuditEvents)
    .leftJoin(subject, eq(userAccountAuditEvents.userId, subject.id))
    .leftJoin(actor, eq(userAccountAuditEvents.actorId, actor.id));

  const rowsQuery = db.select({
    id: userAccountAuditEvents.id,
    action: userAccountAuditEvents.action,
    source: userAccountAuditEvents.source,
    note: userAccountAuditEvents.note,
    createdAt: userAccountAuditEvents.createdAt,
    userId: userAccountAuditEvents.userId,
    userName: subject.name,
    userEmail: subject.email,
    actorId: userAccountAuditEvents.actorId,
    actorName: actor.name,
    actorEmail: actor.email,
    // THE SUBJECT'S OWN COLUMNS, JOINED. The report used to build these from a
    // map over EVERY user row in the database - every column of every account,
    // passwordHash and invitationToken included, pulled into process memory to
    // decorate an audit export. An explicit six is what it actually needed.
    subjectIsDummy: subject.isDummy,
    subjectAccountSource: subject.accountSource,
    subjectUserRole: subject.userRole,
    subjectRole: subject.role,
    subjectAccountStatus: subject.accountStatus,
    subjectInvitationStatus: subject.invitationStatus,
  }).from(userAccountAuditEvents)
    // LEFT, never inner: both columns are nullable on purpose so the trail
    // outlives its subject, and an inner join would drop exactly the events
    // about deleted accounts.
    .leftJoin(subject, eq(userAccountAuditEvents.userId, subject.id))
    .leftJoin(actor, eq(userAccountAuditEvents.actorId, actor.id));

  const page = await adminPage<any>({
    countQuery, rowsQuery, where,
    // Newest first, then by id so two events in the same second have a stable
    // order - without it a row can appear on two consecutive pages.
    orderBy: [desc(userAccountAuditEvents.createdAt), desc(userAccountAuditEvents.id)],
    page: query.page ?? 0,
    pageSize: query.pageSize ?? ADMIN_PAGE_SIZE_DEFAULT,
  });

  return {
    ...page,
    rows: page.rows.map((row: any): AuditRow => ({
      id: Number(row.id),
      action: row.action,
      source: row.source,
      note: row.note,
      createdAt: row.createdAt,
      userId: row.userId,
      userName: row.userName,
      userEmail: row.userEmail,
      actorId: row.actorId,
      // "System" is the truth for an event nobody performed - an account
      // created by signup, a token that expired. A blank actor column invites
      // the reader to assume an administrator did it.
      actorName: row.actorId ? (row.actorName || row.actorEmail || `#${row.actorId}`) : 'System',
      actorEmail: row.actorEmail,
      accountType: row.subjectIsDummy ? 'Dummy / Test'
        : row.subjectAccountSource === 'admin_created' ? 'Admin Created'
        : 'Self Registered',
      role: row.subjectUserRole || row.subjectRole || 'user',
      accountStatus: row.subjectAccountStatus || 'active',
      invitationStatus: row.subjectInvitationStatus || 'none',
    })),
  };
}

/**
 * The distinct actions and sources actually present, for the filter controls.
 *
 * READ FROM THE DATA, not from a list restated here. `action` is a varchar
 * written by forty-odd call sites; a hand-kept list of them would be wrong the
 * first time somebody added an action, and the filter would silently omit it.
 */
export async function auditFilterOptions(db: Db): Promise<{ actions: string[]; sources: string[] }> {
  const [actions, sources] = await Promise.all([
    db.selectDistinct({ value: userAccountAuditEvents.action }).from(userAccountAuditEvents)
      .orderBy(userAccountAuditEvents.action).limit(200),
    db.selectDistinct({ value: userAccountAuditEvents.source }).from(userAccountAuditEvents)
      .orderBy(userAccountAuditEvents.source).limit(200),
  ]);
  return {
    actions: actions.map((row: any) => row.value).filter(Boolean),
    sources: sources.map((row: any) => row.value).filter(Boolean),
  };
}

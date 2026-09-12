/**
 * THE ADMIN USER DIRECTORY: FILTERED, SORTED, PAGED AND COUNTED BY THE DATABASE.
 *
 * `admin.users` used to be `select(...).limit(250)` and the screen did the rest
 * in JavaScript over whatever came back. Under 250 accounts that is merely
 * wasteful. Past 250 it is wrong in a way nothing announces:
 *
 *   - accounts 251 and beyond are invisible to administration entirely;
 *   - searching for one of them finds nothing, which reads as "no such user"
 *     rather than "not in the page I was given";
 *   - the group tiles report counts of a truncated sample as platform counts.
 *
 * Extracted into its own module rather than left inline for the ordinary
 * reason: this is the only way to test the grouping and the paging without
 * standing up the whole router.
 */
import { and, asc, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { users } from '../drizzle/schema';
import { containsTerm } from './_core/searchTerms';

/** A row as the directory screen may see it. Never a hash, never a token. */
export const ADMIN_DIRECTORY_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  role: users.role,
  userRole: users.userRole,
  accountStatus: users.accountStatus,
  frozenReason: users.frozenReason,
  verified: users.verified,
  isDummy: users.isDummy,
  accountSource: users.accountSource,
  invitationStatus: users.invitationStatus,
  createdAt: users.createdAt,
} as const;

/**
 * WHICH GROUP AN ACCOUNT FALLS INTO.
 *
 * `COALESCE(userRole, role)` reproduces exactly what the screen computed as
 * `userRole ?? role`. It is copied deliberately rather than corrected: which
 * group an account belongs to is a product decision, and this change is about
 * correctness at scale. Changing both at once would make a regression here
 * indistinguishable from the intended fix.
 */
export const groupExpression = sql<string>`COALESCE(${users.userRole}, ${users.role})`;

/**
 * A directory row, spelled out.
 *
 * `db.select(...)` is typed `any` through the loose db handle this module
 * takes, and letting that `any` escape means the SCREEN loses its types too -
 * which is how a column rename becomes a blank cell instead of a compile
 * error. The shape is declared here so the client keeps real types.
 */
export type AdminDirectoryRow = {
  id: number;
  name: string | null;
  email: string | null;
  username: string | null;
  role: string | null;
  userRole: string | null;
  accountStatus: string | null;
  frozenReason: string | null;
  verified: boolean | null;
  isDummy: boolean | null;
  accountSource: string | null;
  invitationStatus: string | null;
  createdAt: Date;
};

export type AdminDirectoryPage = {
  rows: AdminDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    all: number;
    real: number;
    dummy: number;
    byRole: Record<string, number>;
    byRoleReal: Record<string, number>;
  };
};

export type AdminUserQuery = {
  search?: string;
  group: string;
  sort: 'newest' | 'name' | 'role';
  page: number;
  pageSize: number;
};

/** 'all' and anything unrecognised mean no group restriction. */
const GROUP_KEYS = new Set([
  'homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager', 'admin',
]);

function filterFor(query: AdminUserQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (GROUP_KEYS.has(query.group)) {
    conditions.push(sql`${groupExpression} = ${query.group}`);
  }
  const term = query.search?.trim();
  if (term) {
    // The screen matched `${name} ${email}` as one string, so a query spanning
    // the two used to match and would stop matching if this were a plain OR of
    // the columns. Matching each column separately is the honest reading of
    // "search by name or email", and the placeholder says exactly that.
    const pattern = containsTerm(term);
    conditions.push(or(like(users.name, pattern), like(users.email, pattern), like(users.username, pattern))!);
  }
  return conditions.length ? and(...conditions) : undefined;
}

function orderFor(sort: AdminUserQuery['sort']) {
  if (sort === 'name') return [asc(users.name), desc(users.id)];
  if (sort === 'role') return [asc(groupExpression), desc(users.id)];
  // `id` breaks ties so paging is stable: two accounts created in the same
  // second must not swap places between page 1 and page 2, which would show one
  // twice and hide the other.
  return [desc(users.createdAt), desc(users.id)];
}

export async function listAdminUsers(db: any, query: AdminUserQuery): Promise<AdminDirectoryPage> {
  const where = filterFor(query);

  // THREE queries, not one per group. The counts come back as a single
  // GROUP BY rather than one COUNT per role, which was the shape that would
  // have grown an N+1 as roles were added.
  const [rows, totalRows, groupRows] = await Promise.all([
    db.select(ADMIN_DIRECTORY_COLUMNS).from(users)
      .where(where)
      .orderBy(...orderFor(query.sort))
      .limit(query.pageSize)
      .offset(query.page * query.pageSize),
    db.select({ count: sql<number>`count(*)` }).from(users).where(where),
    db.select({
      group: groupExpression,
      total: sql<number>`count(*)`,
      dummy: sql<number>`sum(case when ${users.isDummy} = 1 then 1 else 0 end)`,
    }).from(users).groupBy(groupExpression),
  ]);

  const byRole: Record<string, number> = {};
  const byRoleReal: Record<string, number> = {};
  let all = 0;
  let dummy = 0;
  for (const row of groupRows as { group: string | null; total: number; dummy: number }[]) {
    const total = Number(row.total ?? 0);
    const dummyCount = Number(row.dummy ?? 0);
    if (row.group) {
      byRole[String(row.group)] = total;
      // The screen shows both: how many accounts of this kind exist, and how
      // many of them are real. A QA persona counted as a customer would make
      // the platform look busier than it is.
      byRoleReal[String(row.group)] = total - dummyCount;
    }
    all += total;
    dummy += dummyCount;
  }

  return {
    rows: rows as AdminDirectoryRow[],
    total: Number(totalRows[0]?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    // Counts describe the WHOLE directory, never the current filter: they feed
    // the group tiles, and a tile that changed when you clicked another tile
    // would be reporting the filter back to you rather than the platform.
    counts: { all, real: all - dummy, dummy, byRole, byRoleReal },
  };
}

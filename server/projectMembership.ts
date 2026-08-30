/**
 * THE ONE PLACE PROJECT ACCESS IS DECIDED.
 *
 * Sixteen call sites in server/routers.ts each carried their own copy of
 * `eq(projects.ownerId, ctx.user.id)`. Sixteen copies of a rule is sixteen
 * chances for one of them to drift, and no way to widen the rule without
 * finding all of them - which is exactly why adding a project team required
 * touching every one.
 *
 * Everything below returns the SAME refusal shape for "no such project" and
 * "not your project": NOT_FOUND. A FORBIDDEN would confirm that a project id
 * exists, which is a disclosure a stranger should not get by guessing numbers.
 */

import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { projects, projectMembers } from '../drizzle/schema';
import { projectRoleCan, isProjectRole, type ProjectCapability, type ProjectRole } from '../shared/projectAccess';

type Db = any;

export type ProjectAccess = {
  projectId: number;
  ownerId: number;
  /** The caller's capacity on this project. */
  projectRole: ProjectRole;
};

/**
 * The caller's LIVE membership of a project, or null.
 *
 * `removedAt IS NULL` is the whole of the difference between a current member
 * and a historical one. Removal is a soft end so that a dispute can still show
 * who was on the job when a decision was taken - but a removed member must not
 * keep reading the project, so every authorization path filters on it and only
 * the history surfaces do not.
 */
export async function liveMembership(
  db: Db, projectId: number, userId: number,
): Promise<ProjectRole | null> {
  const [row] = await db.select({ projectRole: projectMembers.projectRole })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
      isNull(projectMembers.removedAt),
    ))
    .limit(1);
  const value = row?.projectRole;
  return isProjectRole(value) ? value : null;
}

/**
 * Authorize a capability on a project, or throw.
 *
 * OWNERSHIP IS STILL HONOURED DIRECTLY, not only through the membership table.
 * The backfill gave every existing project an owner membership, but a row in a
 * join table is a weaker guarantee than a NOT NULL column on the project
 * itself: if a membership were ever deleted by hand, the owner would lose their
 * own project. Reading `ownerId` as well means the customer can never be locked
 * out of the record that is theirs.
 */
export async function requireProjectAccess(
  db: Db, projectId: number, userId: number, capability: ProjectCapability,
): Promise<ProjectAccess> {
  const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }

  const role: ProjectRole | null = project.ownerId === userId
    ? 'owner'
    : await liveMembership(db, projectId, userId);

  // Not on the project at all. Answered as NOT_FOUND, the same as an id that
  // does not exist, so the refusal carries no information.
  if (!role) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }

  if (!projectRoleCan(role, capability)) {
    // On the project, but not in a capacity that permits this. Here FORBIDDEN
    // is correct and NOT_FOUND would be a lie: they can already see the
    // project, so hiding its existence proves nothing and only confuses them.
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Your role on this project (${role}) does not allow this action.`,
    });
  }

  return { projectId: project.id, ownerId: project.ownerId, projectRole: role };
}

/**
 * Project ids the caller may READ, for list queries.
 *
 * Returned as ids rather than as a joined query so the caller keeps whatever
 * column projection it already had. An empty array means "no projects", which
 * every caller must handle as a normal state rather than as an error - a new
 * account legitimately has none.
 */
export async function readableProjectIds(db: Db, userId: number): Promise<number[]> {
  const owned = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.ownerId, userId));
  const member = await db.select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), isNull(projectMembers.removedAt)));
  // Array.from rather than spreading the Set: this file is compiled under a
  // target that does not downlevel Set iteration, and the spread form fails to
  // build even though it typechecks in an editor.
  const seen = new Set<number>();
  for (const r of owned as { id: number }[]) seen.add(r.id);
  for (const r of member as { id: number }[]) seen.add(r.id);
  return Array.from(seen);
}

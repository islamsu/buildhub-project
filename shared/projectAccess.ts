/**
 * WHO MAY DO WHAT ON A PROJECT.
 *
 * Before this file, the answer was one line repeated sixteen times:
 * `eq(projects.ownerId, ctx.user.id)`. Ownership was the only relationship the
 * schema could express, so it was also the only rule - reading a project,
 * changing its budget, and logging a day's work on site were all the same
 * question with the same answer.
 *
 * They are not the same question. A contractor on a job needs to file progress
 * reports without being able to rewrite the budget. A supplier delivering to it
 * needs to see the job without filing progress at all. An owner needs to do
 * everything. Collapsing those into "are you the owner" is why none of them
 * were possible.
 *
 * TWO DIFFERENT ROLES, AND THEY ARE DELIBERATELY UNRELATED
 *
 *   users.userRole            what this ACCOUNT is on BuildHub
 *   projectMembers.projectRole what this PERSON is on THIS PROJECT
 *
 * Authorization here reads the second and never the first. A `contractor`
 * account can be the `manager` of one project and a `viewer` on another, and
 * an account's type must not decide what it may do to a specific job. The one
 * place account role still matters is CREATION - see PROJECT_CREATOR_ROLES.
 */

export const PROJECT_ROLES = [
  'owner', 'manager', 'contractor', 'architect', 'engineer', 'supplier', 'viewer',
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * The five things a person can do to a project. Each site in the router names
 * one of these rather than re-deriving a condition, so a capability can be
 * widened or narrowed in exactly one place.
 *
 *   read       see the project, its milestones, tasks, logs and documents
 *   report     add progress: daily logs, progress reports, documents
 *   finance    see or add expenses - the customer's spend, deliberately NOT
 *              part of `read`, because a contractor working on a job has no
 *              business reading what the customer paid everyone else
 *   manage     change the project itself, its milestones, its tasks, its team
 *   commercial raise an RFQ against the project, committing it to spend
 */
export const PROJECT_CAPABILITIES = ['read', 'report', 'finance', 'manage', 'commercial'] as const;
export type ProjectCapability = (typeof PROJECT_CAPABILITIES)[number];

/**
 * THE MATRIX. Every cell is a deliberate decision, not a default.
 *
 * `viewer` reads and nothing else - that is the entire point of the role.
 *
 * `supplier` reads but cannot `report`. A supplier delivers goods against an
 * RFQ; they do not file the site's progress. Their commercial channel is the
 * quotation, not the project.
 *
 * `contractor`, `architect` and `engineer` report but do not `manage`. They do
 * the work and record it; they do not rewrite the budget or change who else is
 * on the job.
 *
 * `manage` and `commercial` are held by `owner` and `manager` only. Both commit
 * the customer to money or change the shape of the project, and a project
 * manager holds them because commissioning on a client's behalf is what the
 * role is for.
 */
const CAPABILITIES: Record<ProjectRole, readonly ProjectCapability[]> = {
  owner:      ['read', 'report', 'finance', 'manage', 'commercial'],
  manager:    ['read', 'report', 'finance', 'manage', 'commercial'],
  contractor: ['read', 'report'],
  architect:  ['read', 'report'],
  engineer:   ['read', 'report'],
  supplier:   ['read'],
  viewer:     ['read'],
};

export function projectRoleCan(role: ProjectRole, capability: ProjectCapability): boolean {
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: ProjectRole): readonly ProjectCapability[] {
  return CAPABILITIES[role] ?? [];
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * WHICH ACCOUNT ROLES MAY CREATE A PROJECT AT ALL.
 *
 * This is the one decision that reads users.userRole rather than a membership,
 * because before a project exists there is nobody on it.
 *
 * THE HISTORY, because this rule was wrong twice and the reasoning matters
 * more than the list:
 *
 *   1. `projects.create` was `protectedProcedure` with NO role check. Only the
 *      homeowner dashboard offered the button, so it looked restricted and was
 *      not: any account could POST directly and own a project.
 *
 *   2. It was then restricted to homeowners, justified partly by the fact that
 *      all existing projects happened to be homeowner-owned. That justification
 *      was bad: historical rows record the rule that WAS enforced, not the rule
 *      that SHOULD be. A restriction cannot be evidence for itself.
 *
 * The rule now: every professional role that participates in delivering a job
 * may commission one, because a project manager or a main contractor
 * commissioning work is ordinary construction practice. A creator who is not
 * the customer records the customer as `ownerId` and themselves as `createdBy`.
 *
 * SUPPLIER IS EXCLUDED, and this is the considered exception rather than an
 * oversight: a supplier sells goods into a project. They are the counterparty
 * to a request, not the party commissioning one. Their route in is being added
 * to a project or invited to an RFQ, both of which now exist.
 */
export const PROJECT_CREATOR_ROLES = [
  'homeowner', 'project_manager', 'contractor', 'architect', 'engineer',
] as const;

export function canCreateProject(userRole: string | null | undefined): boolean {
  return (PROJECT_CREATOR_ROLES as readonly string[]).includes(userRole ?? '');
}

/**
 * The project role a creator holds on the project they just made.
 *
 * A homeowner creating their own project is its `owner`. Anyone else is its
 * `manager`: they run the job, but the customer named as `ownerId` owns it.
 * Returning `owner` for everyone would quietly make a contractor the owner of
 * a customer's project, which is the thing this whole model exists to prevent.
 */
export function creatorProjectRole(userRole: string | null | undefined): ProjectRole {
  return userRole === 'homeowner' ? 'owner' : 'manager';
}

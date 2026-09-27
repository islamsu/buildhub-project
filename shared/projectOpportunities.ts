/**
 * ── TWO KINDS OF PROJECT CARD, AND THEY ARE NOT INTERCHANGEABLE ─────────
 *
 * Every role workspace rendered "projects" as a grid of plain `<div>`s. Nothing
 * was clickable, nothing had a focus state, and nothing said what to do next -
 * so a Project Manager clicked a card in their own Project Queue and the
 * product did nothing at all. §47: can the user find it, can the user complete
 * it. The answer was no at the first step.
 *
 * ── WHY THE OBVIOUS FIX IS WRONG ────────────────────────────────────────
 *
 * Making every row navigate to `/projects/:id` would replace a dead card with a
 * dead end. Those grids are fed by `projects.directory`, which is a SANITIZED
 * LEAD DIRECTORY over every project on the platform - it applies no membership
 * filter, and deliberately selects only id, title, type, status, location and
 * progress, never budget or owner. `projects.get` correctly demands
 * `requireProjectAccess`, so a provider following such a link would meet
 * NOT_FOUND on a card the workspace had just shown them.
 *
 * The two data sources answer different questions, and the UI has to say which:
 *
 *   MANAGED      `projects.list` - owned, or an ACTIVE member
 *                (`readableProjectIds`: ownerId, or projectMembers with
 *                removedAt IS NULL). These open the real workspace, and
 *                `requireProjectAccess` is what actually permits it.
 *
 *   OPPORTUNITY  `projects.directory` minus the above. NOT the reader's
 *                project. It never opens a project page, because there is
 *                nothing there this reader may see.
 *
 * ── WHAT AN OPPORTUNITY'S ACTION IS, AND WHY IT IS NOT A NEW DOMAIN ─────
 *
 * The legitimate next step on a lead is the REQUEST attached to it. An open RFQ
 * is already the canonical opportunity surface: it has its own authorization,
 * its own eligibility rules and its own allowance accounting, and a provider
 * reaching a project through one gains no project access at all.
 *
 * So an opportunity card is only shown WHEN IT HAS AN OPEN REQUEST TO ACT ON,
 * and its action goes to that request. A directory row with no open request is
 * not an opportunity - it is a row in a directory, and presenting it as an
 * actionable card would recreate the defect with a nicer border. That also
 * corrects a KPI that counted every project on the platform as this provider's
 * opportunity.
 *
 * Pure functions, no queries: the caller supplies both lists and this decides
 * which card each row earns.
 */

/** The sanitized shape `projects.directory` returns. Nothing private is here. */
export type DirectoryProject = {
  id: number;
  title: string;
  type?: string | null;
  status?: string | null;
  location?: string | null;
  progress?: number | null;
};

/** A project the reader owns or is an active member of. */
export type ManagedProject = { id: number; title: string };

/** The fields of an RFQ this pairing needs. `rfq.list` returns all of them. */
export type OpenRequest = {
  id: number;
  projectId?: number | null;
  status?: string | null;
  title?: string | null;
  category?: string | null;
};

/**
 * A directory project the reader may act on, paired with the request that makes
 * it actionable.
 *
 * `requestCount` is the number of open requests on that project, so a card can
 * say "3 open requests" truthfully; `requestId` is the one its action opens -
 * the lowest id, which is the earliest and therefore the most likely to be
 * closing soonest. Deterministic either way, because a card whose destination
 * changed between renders would be its own defect.
 */
export type ProjectOpportunity = {
  project: DirectoryProject;
  requestId: number;
  requestCount: number;
};

/** Only an OPEN request is something to act on. */
export function isOpenRequest(request: OpenRequest): boolean {
  return (request.status ?? '').trim().toLowerCase() === 'open';
}

/**
 * Split a directory listing into the reader's own projects and the rest.
 *
 * Membership is decided by the MANAGED list, which came from
 * `readableProjectIds` on the server. This function never infers it - there is
 * nothing in a directory row that could tell you, and guessing is how a
 * provider ends up being shown a project page they cannot open.
 */
export function partitionDirectory(
  directory: readonly DirectoryProject[],
  managed: readonly ManagedProject[],
): { mine: DirectoryProject[]; others: DirectoryProject[] } {
  const mineIds = new Set(managed.map(project => Number(project.id)));
  const mine: DirectoryProject[] = [];
  const others: DirectoryProject[] = [];
  for (const project of directory) {
    (mineIds.has(Number(project.id)) ? mine : others).push(project);
  }
  return { mine, others };
}

/**
 * The opportunities a reader can actually act on.
 *
 * Excludes their own projects - those are Managed, and listing them twice under
 * two different promises is the labelling problem this split exists to fix -
 * and excludes any project with no open request, because there would be nothing
 * for the card to do.
 */
export function projectOpportunities(
  directory: readonly DirectoryProject[],
  managed: readonly ManagedProject[],
  requests: readonly OpenRequest[],
): ProjectOpportunity[] {
  const { others } = partitionDirectory(directory, managed);

  const byProject = new Map<number, number[]>();
  for (const request of requests) {
    if (!isOpenRequest(request)) continue;
    const projectId = Number(request.projectId ?? 0);
    if (!Number.isFinite(projectId) || projectId <= 0) continue;
    const ids = byProject.get(projectId) ?? [];
    ids.push(Number(request.id));
    byProject.set(projectId, ids);
  }

  const opportunities: ProjectOpportunity[] = [];
  for (const project of others) {
    const ids = byProject.get(Number(project.id));
    if (!ids || ids.length === 0) continue;
    opportunities.push({
      project,
      requestId: Math.min(...ids),
      requestCount: ids.length,
    });
  }
  return opportunities;
}

/**
 * THE FIELDS AN OPPORTUNITY CARD MAY RENDER.
 *
 * Exported so a test can assert the list rather than trusting a reviewer to
 * notice a seventh field appearing. Everything here is already in
 * `projects.directory`'s own column allowlist; the point is that the CARD
 * cannot start rendering something else if the query is ever widened.
 */
export const OPPORTUNITY_SAFE_FIELDS = [
  'id', 'title', 'type', 'status', 'location', 'progress',
] as const;

/** Fields that must never reach an opportunity card, named so a test can check. */
export const OPPORTUNITY_FORBIDDEN_FIELDS = [
  'budget', 'spent', 'ownerId', 'owner', 'description', 'documents', 'members',
  'startDate', 'endDate', 'currency', 'marketCode',
] as const;

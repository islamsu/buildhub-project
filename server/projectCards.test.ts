/**
 * ── A CARD THAT LOOKS ACTIONABLE MUST BE ACTIONABLE ─────────────────────
 *
 * Six role workspaces rendered project cards as plain `<div>`s - a bordered
 * tile with a title, a status badge and a progress bar, identical to every
 * actionable record in the product, and inert. A Project Manager clicked a card
 * in their own Project Queue and nothing happened. §47's first two questions:
 * can the user find it, can the user complete it.
 *
 * ── AND THE OBVIOUS FIX WOULD HAVE BEEN A DEAD END ──────────────────────
 *
 * Those grids were fed by `projects.directory` - a sanitized LEAD directory
 * with no membership filter at all. Linking every row to `/projects/:id` would
 * have sent a provider to `projects.get`, which correctly demands
 * `requireProjectAccess`, and replaced a dead card with a NOT_FOUND.
 *
 * So the split is the fix: MANAGED (owned or active member, from
 * `projects.list`) opens the workspace; OPPORTUNITY (a directory row the reader
 * is not on) opens the open REQUEST, which is the canonical opportunity surface
 * and grants no project access.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  OPPORTUNITY_FORBIDDEN_FIELDS,
  isOpenRequest,
  partitionDirectory,
  projectOpportunities,
} from '../shared/projectOpportunities';

const ROOT = join(import.meta.dirname, '..');
const code = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

const directory = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Project ${id}`, status: 'active', location: 'Cairo', progress: 40, ...extra });
const open = (id: number, projectId: number) => ({ id, projectId, status: 'open', title: `RFQ ${id}` });

describe('managed and opportunity are decided by MEMBERSHIP, never inferred', () => {
  it('a directory row the reader belongs to is theirs', () => {
    const { mine, others } = partitionDirectory([directory(1), directory(2)], [{ id: 2, title: 'Project 2' }]);
    expect(mine.map(p => p.id)).toEqual([2]);
    expect(others.map(p => p.id)).toEqual([1]);
  });

  it('with no managed list, NOTHING is treated as the reader\'s', () => {
    /*
     * The safe direction. A bug that empties `projects.list` must leave every
     * card an opportunity - a request link - rather than promising a project
     * page the reader cannot open.
     */
    const { mine, others } = partitionDirectory([directory(1), directory(2)], []);
    expect(mine).toEqual([]);
    expect(others).toHaveLength(2);
  });

  it('and ids are compared as numbers, so a string id cannot split one project in two', () => {
    const { mine } = partitionDirectory([directory(7)], [{ id: '7' as unknown as number, title: 'Project 7' }]);
    expect(mine.map(p => p.id)).toEqual([7]);
  });
});

describe('an opportunity exists only when there is something to do', () => {
  it('pairs a directory project with its open request', () => {
    const result = projectOpportunities([directory(1)], [], [open(50, 1)]);
    expect(result).toEqual([{ project: directory(1), requestId: 50, requestCount: 1 }]);
  });

  it('EXCLUDES a project with no open request', () => {
    /*
     * The heart of it. A directory row with nothing to respond to is not an
     * opportunity - it is a row in a directory, and showing it as an actionable
     * card recreates the original defect with a nicer border.
     */
    expect(projectOpportunities([directory(1)], [], [])).toEqual([]);
    expect(projectOpportunities([directory(1)], [], [{ ...open(50, 1), status: 'closed' }])).toEqual([]);
    expect(projectOpportunities([directory(1)], [], [{ ...open(50, 1), status: 'awarded' }])).toEqual([]);
  });

  it('EXCLUDES the reader\'s own projects, so nothing is listed twice', () => {
    // Listed under both headings, it would promise two different things about
    // one record - which is the labelling problem the split exists to fix.
    const result = projectOpportunities([directory(1)], [{ id: 1, title: 'Project 1' }], [open(50, 1)]);
    expect(result).toEqual([]);
  });

  it('ignores a request that belongs to no project', () => {
    // A standalone RFQ has no projectId. It is a real opportunity, but not a
    // PROJECT opportunity, and it has its own surface.
    for (const projectId of [null, undefined, 0, -1]) {
      expect(projectOpportunities([directory(1)], [], [{ ...open(50, 1), projectId }])).toEqual([]);
    }
  });

  it('counts every open request but links to ONE, deterministically', () => {
    const result = projectOpportunities([directory(1)], [], [open(80, 1), open(50, 1), open(65, 1)]);
    expect(result[0].requestCount).toBe(3);
    // The lowest id: the earliest request, and stable between renders. A card
    // whose destination changed on re-render would be its own defect.
    expect(result[0].requestId).toBe(50);
    expect(projectOpportunities([directory(1)], [], [open(50, 1), open(80, 1), open(65, 1)])[0].requestId).toBe(50);
  });

  it('only an OPEN request counts', () => {
    expect(isOpenRequest({ id: 1, status: 'open' })).toBe(true);
    expect(isOpenRequest({ id: 1, status: 'OPEN' })).toBe(true);
    for (const status of ['closed', 'awarded', 'draft', 'cancelled', '', null, undefined]) {
      expect(isOpenRequest({ id: 1, status }), String(status)).toBe(false);
    }
  });

  it('keeps directory order, so the list does not reshuffle', () => {
    const result = projectOpportunities(
      [directory(3), directory(1), directory(2)], [],
      [open(10, 1), open(11, 2), open(12, 3)]);
    expect(result.map(entry => entry.project.id)).toEqual([3, 1, 2]);
  });
});

describe('the two cards are two components, with two destinations', () => {
  const cards = code('client/src/components/ProjectCards.tsx');

  it('a managed card opens the project workspace', () => {
    expect(cards).toContain('href={`/projects/${project.id}`}');
  });

  it('an opportunity card opens the REQUEST, never the project', () => {
    expect(cards).toContain('href={`/rfq/${requestId}`}');
    /*
     * The one assertion that stops this regressing into the dead end. The
     * opportunity component must not contain a project link at all - not behind
     * a condition, not as a fallback.
     */
    const opportunity = cards.slice(cards.indexOf('export function ProjectOpportunityCard'));
    expect(opportunity).not.toContain('/projects/');
  });

  it('and they are separate components rather than one with a variant', () => {
    // A shared component with a `variant` prop is one edit away from giving an
    // opportunity card the managed card's link.
    expect(cards).toContain('export function ManagedProjectCard');
    expect(cards).toContain('export function ProjectOpportunityCard');
    expect(cards).not.toMatch(/variant\??: 'managed'/);
  });
});

describe('every card is keyboard-operable, not merely clickable', () => {
  const cards = code('client/src/components/ProjectCards.tsx');

  it('both render a real link, so the platform gives tab order and Enter', () => {
    // A `div onClick` is mouse-only: not in the tab order, no Enter, no focus
    // ring, no open-in-new-tab. §62 counts that as a failure.
    expect(cards).not.toContain('<div onClick');
    expect((cards.match(/<Link/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('with a visible focus ring and a hover state', () => {
    expect(cards).toContain('focus-visible:ring-2');
    expect(cards).toContain('hover:border-primary/40');
  });

  it('and a visible CTA plus an accessible name, in both languages', () => {
    expect(cards).toContain('aria-label={`${cta}');
    for (const marker of ['Open project workspace', 'افتح مساحة المشروع',
                          'View the open request', 'اعرض الطلب المفتوح']) {
      expect(cards, marker).toContain(marker);
    }
  });
});

describe('an opportunity card renders nothing private', () => {
  const cards = code('client/src/components/ProjectCards.tsx');

  it('no owner-private field appears anywhere in the card file', () => {
    /*
     * `projects.directory` already withholds these, so this is defence in
     * depth: if that query is ever widened, the CARD still cannot start
     * rendering them.
     */
    const opportunity = cards.slice(cards.indexOf('export function ProjectOpportunityCard'));
    /*
     * MATCHED AS A WORD, not as `project.<field>`. A mutation test wrote
     * `(opportunity.project as any).budget` and the prefixed form sailed
     * through: the card rendered a project's budget and this test stayed
     * green. The field name must not appear in the card body at ALL, however
     * it is reached - and `code()` has already stripped the comments, so the
     * prose above this function cannot trip it.
     */
    for (const field of OPPORTUNITY_FORBIDDEN_FIELDS) {
      expect(opportunity, `${field} reaches an opportunity card`)
        .not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('and the forbidden list really names the ones that matter', () => {
    // A list that had quietly emptied would make the check above vacuous.
    for (const field of ['budget', 'ownerId', 'documents', 'members']) {
      expect([...OPPORTUNITY_FORBIDDEN_FIELDS]).toContain(field);
    }
  });
});

describe('the workspaces use them, and nothing inert is left', () => {
  const platform = code('client/src/pages/RolePlatform.tsx');

  it('no workspace renders a project into a bare div any more', () => {
    // The exact shape that was wrong, in all six.
    expect(platform).not.toMatch(/projects\.slice\(0, \d\)\.map\(project => <div/);
    expect(platform).not.toMatch(/projectDirectory\.slice\(0, \d\)\.map\(project => <div/);
  });

  it('managed projects are loaded for EVERY role, not only the homeowner', () => {
    /*
     * The root cause. `enabled: role === 'homeowner'` meant a Project Manager's
     * workspace had no source of their own projects - only the directory - so
     * there was nothing safe to link a card to.
     */
    expect(platform).toContain("trpc.projects.list.useQuery(undefined, { enabled: isAuthenticated })");
    expect(platform).not.toContain("enabled: isAuthenticated && role === 'homeowner'");
  });

  it('and the Project Manager has two sections with truthful names', () => {
    expect(platform).toContain('Managed Projects');
    expect(platform).toContain('المشاريع التي أديرها');
    expect(platform).toContain('Project Opportunities');
    expect(platform).toContain('فرص المشاريع');
  });

  it('the opportunity KPI counts opportunities, not every project on the platform', () => {
    // It read `projectDirectory.length` under a label that said "yours".
    const kpi = platform.slice(platform.indexOf("'Project Opportunities'"));
    expect(kpi.slice(0, 200)).toContain('value: opportunities.length');
  });

  it('and a Project Manager\'s own counts are their own', () => {
    const queue = platform.slice(platform.indexOf("t('platform.projects'), value:"));
    expect(queue.slice(0, 120)).toContain('managedProjects.length');
  });

  it('including the average, which described a different population', () => {
    /*
     * Average Progress sat in the Managed Projects group beside two counts that
     * are the manager's own, and averaged `projectDirectory` - every project on
     * the platform. Three numbers in one group, two populations.
     */
    expect(platform).toContain('const averageProgress = progressOf(projects');
    expect(platform).not.toMatch(/averageProgress\s*=\s*projectDirectory/);
  });

  it('and averaging nothing reads as no data, not as 0% progress', () => {
    // A manager with no projects has no average. 0% is a claim about work done.
    expect(platform).toMatch(/progressOf[\s\S]{0,200}:\s*null;/);
    expect(platform).toContain("averageProgress === null ? '—'");
  });
});

describe('the homeowner dashboard card is a link too', () => {
  const dashboard = code('client/src/pages/HomeownerDashboard.tsx');

  it('it navigated, but was mouse-only - now it is an anchor', () => {
    expect(dashboard).not.toContain('onClick={() => navigate(`/projects/${project.id}`)}');
    expect(dashboard).toContain('href={`/projects/${project.id}`}');
    expect(dashboard).toContain('focus-visible:ring-2');
  });

  it('and it keeps the budget a homeowner legitimately sees on their own project', () => {
    // Which is also why it is not the shared card: that one is used on provider
    // surfaces, where money must not appear.
    expect(dashboard).toContain("formatMoney(project.budget, project.currency, lang)");
  });
});

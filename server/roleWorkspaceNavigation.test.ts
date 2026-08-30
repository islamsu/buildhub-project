import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ROLE_SECTIONS, SECTION_IDS, WORKSPACE_ROLES, hasSection, isSectionId, workspaceHref,
  type SectionId, type WorkspaceRole,
} from '@shared/roleWorkspaceSections';

/**
 * THE MENU MAY NOT NAME A PLACE THAT DOES NOT EXIST.
 *
 * A live click audit of all six roles drove 1,499 controls and found thirty
 * that produced no observable effect whatsoever - no navigation, no scroll, no
 * change of any kind. Twenty of them were workspace menu entries: Pipeline,
 * Catalogue, Documents, Portfolio, Project Queue and Performance all carried
 * the bare `/platform/:role` path, so clicking them while on that page did
 * nothing at all and every one of them rendered as the active item at the same
 * time.
 *
 * These tests read the SHIPPING SOURCE. They fail if a menu entry points at a
 * section the workspace does not render, if two entries for one role resolve
 * to the same destination, or if a section in the registry has no element
 * carrying its id.
 */

const layout = readFileSync(new URL('../client/src/components/DashboardLayout.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../client/src/pages/RolePlatform.tsx', import.meta.url), 'utf8');

/** Menu entries built by the `workspaceItem(role, Icon, 'key', 'section')` helper. */
function menuSectionsFor(role: WorkspaceRole): SectionId[] {
  const re = new RegExp(`workspaceItem\\('${role}',\\s*\\w+,\\s*'[^']+',\\s*'([a-z-]+)'\\)`, 'g');
  return [...layout.matchAll(re)].map(match => match[1] as SectionId);
}

/**
 * The body of one workspace component. Scoping matters: an earlier version of
 * this test asked only whether an id appeared ANYWHERE in the file, which
 * passed while the architect's Projects entry pointed at an anchor that
 * existed on three other workspaces and not on theirs. A live browser run
 * caught it; this now does.
 */
function workspaceBody(name: string): string {
  const start = workspace.indexOf(`function ${name}Workspace(`);
  if (start < 0) return '';
  const end = workspace.indexOf('\n}', start);
  return workspace.slice(start, end);
}

/** Sections the shared professional block renders, outside any one workspace. */
const SHARED_SECTIONS = new Set(['role-overview', 'role-enquiries', 'role-performance']);

/**
 * Sections rendered in the PAGE body rather than in a workspace component,
 * inside a role branch. Each names the branch it must sit in, so the exemption
 * still proves the section is reachable for that role and only that role.
 */
const PAGE_LEVEL_SECTIONS: Partial<Record<string, { role: WorkspaceRole; branch: string }>> = {
  // The supplier's real catalogue management, mounted next to the workspace
  // summary card rather than inside it.
  'role-catalogue': { role: 'supplier', branch: "role === 'supplier' ? (" },
};

const COMPONENT_FOR: Record<WorkspaceRole, string> = {
  homeowner: 'Homeowner', contractor: 'Contractor', engineer: 'Engineer',
  architect: 'Architect', supplier: 'Supplier', project_manager: 'ProjectManager',
};

describe('the workspace section registry', () => {
  it('every id it names is rendered by the workspace page', () => {
    const rendered = new Set([...workspace.matchAll(/id="(role-[a-z]+)"/g)].map(m => m[1]));
    const named = new Set(Object.values(ROLE_SECTIONS).flat());
    expect(named.size).toBeGreaterThan(0);
    for (const section of named) {
      expect(rendered, `${section} is offered as a destination but nothing carries that id`).toContain(section);
    }
  });

  it.each(WORKSPACE_ROLES)('%s: every section it offers is rendered by ITS OWN workspace', role => {
    const body = workspaceBody(COMPONENT_FOR[role]);
    expect(body.length, `${COMPONENT_FOR[role]}Workspace not found`).toBeGreaterThan(100);
    const own = new Set([...body.matchAll(/id="(role-[a-z]+)"/g)].map(m => m[1]));
    for (const section of ROLE_SECTIONS[role]) {
      if (SHARED_SECTIONS.has(section)) continue;
      const pageLevel = PAGE_LEVEL_SECTIONS[section];
      if (pageLevel) {
        expect(pageLevel.role, `${section} is claimed as page-level for ${pageLevel.role}, not ${role}`).toBe(role);
        const branchAt = workspace.indexOf(pageLevel.branch);
        expect(branchAt, `${pageLevel.branch} not found`).toBeGreaterThan(-1);
        const idAt = workspace.indexOf(`id="${section}"`);
        // Inside that branch: after it starts, and before the next role branch.
        const nextBranch = workspace.indexOf("' ? (", branchAt + pageLevel.branch.length);
        expect(idAt, `${section} must be rendered inside the ${pageLevel.role} branch`).toBeGreaterThan(branchAt);
        expect(idAt, `${section} must be rendered inside the ${pageLevel.role} branch`).toBeLessThan(nextBranch);
        continue;
      }
      expect(own, `${role} offers ${section} but ${COMPONENT_FOR[role]}Workspace does not render it`).toContain(section);
    }
  });

  it('the shared sections really are outside every per-role workspace', () => {
    // Otherwise the exemption above would hide a missing anchor.
    for (const role of WORKSPACE_ROLES) {
      const body = workspaceBody(COMPONENT_FOR[role]);
      for (const shared of ['role-enquiries', 'role-performance', 'role-overview']) {
        expect(body, `${shared} must not be inside ${COMPONENT_FOR[role]}Workspace`).not.toContain(`id="${shared}"`);
      }
    }
  });

  it('rejects a section id that is not in the list', () => {
    expect(isSectionId('role-performance')).toBe(true);
    expect(isSectionId('role-invented')).toBe(false);
    expect(isSectionId('')).toBe(false);
  });

  it('workspaceHref refuses to build an anchor for a section the role does not have', () => {
    // A supplier has a catalogue; a contractor does not.
    expect(workspaceHref('supplier', 'role-catalogue')).toBe('/platform/supplier#role-catalogue');
    expect(hasSection('contractor', 'role-catalogue')).toBe(false);
    expect(workspaceHref('contractor', 'role-catalogue')).toBe('/platform/contractor');
  });

  it('overview is the top of the page, not an anchor', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(workspaceHref(role, 'role-overview')).toBe(`/platform/${role}`);
    }
  });

  it('the contractor workspace has a pipeline and no generic rfq list', () => {
    // The contractor's requests card is id="role-pipeline". A shortcut aimed at
    // role-rfqs scrolled to an element that is not on that page.
    expect(hasSection('contractor', 'role-pipeline')).toBe(true);
    expect(hasSection('contractor', 'role-rfqs')).toBe(false);
  });

  it('the project manager has a queue rather than a second projects entry', () => {
    // Project Queue and Projects both pointed at role-projects: two labels,
    // one destination, and one of them therefore always lied.
    expect(hasSection('project_manager', 'role-queue')).toBe(true);
    expect(hasSection('project_manager', 'role-projects')).toBe(false);
  });
});

describe('the role sidebar', () => {
  it.each(WORKSPACE_ROLES)('%s: every workspace entry names a section the role renders', role => {
    const sections = menuSectionsFor(role);
    expect(sections.length, `${role} has no workspace menu entries`).toBeGreaterThan(0);
    for (const section of sections) {
      expect(ROLE_SECTIONS[role], `${role}'s menu offers ${section}`).toContain(section);
    }
  });

  it.each(WORKSPACE_ROLES)('%s: no two workspace entries share a destination', role => {
    const sections = menuSectionsFor(role);
    expect(new Set(sections).size).toBe(sections.length);
  });

  it('no menu entry carries a bare workspace path without a section', () => {
    // This is the exact shape of the defect: `path: '/platform/contractor'`
    // written out by hand, with no section, for an entry that is not Overview.
    const bare = [...layout.matchAll(/path:\s*'(\/platform\/[a-z_]+)'/g)].map(m => m[1]);
    expect(bare, `hand-written workspace paths bypass the registry: ${bare.join(', ')}`).toEqual([]);
  });

  it('does not advertise Reviews or Settings, which had no destination', () => {
    // "Reviews" pointed at /messages and "Settings" at the workspace root.
    // Reviews are written on a completed project; there is no settings page.
    expect(layout).not.toContain("'dash.reviews'");
    expect(layout).not.toContain("labelKey: 'dash.settings', path: '/platform");
  });

  it('marks exactly one entry current, using the section in the address bar', () => {
    // Comparing the path alone lit up four entries at once on /platform/contractor.
    expect(layout).toContain('const isCurrent = (item: MenuItem)');
    expect(layout).toContain('hashSection ? item.section === hashSection');
    expect(layout).toContain("aria-current={isActive ? 'page' : undefined}");
  });

  it('going to a section of the current page pushes the hash and reveals it', () => {
    // setLocation alone is a no-op when the path does not change, which is
    // what made these clicks silent.
    expect(layout).toContain('window.history.pushState');
    expect(layout).toContain("new HashChangeEvent('hashchange')");
    expect(layout).toContain('revealSection(itemHash)');
  });
});

describe('the workspace page', () => {
  it('lands on the section the URL names', () => {
    expect(workspace).toContain('const hashSection = useHashSection();');
    expect(workspace).toContain('revealSection(hashSection)');
  });

  it('shortcut cards go through goToSection, not a bare scrollIntoView', () => {
    // A bare scrollIntoView on a section already in view is invisible, and the
    // URL then does not describe what the reader is looking at.
    expect(workspace).not.toContain("getElementById('role-projects')?.scrollIntoView");
    expect(workspace).not.toContain("getElementById('role-rfqs')?.scrollIntoView");
    expect(workspace).toContain("goToSection('role-pipeline')");
    expect(workspace).toContain("goToSection('role-queue')");
  });

  it('the architect public-profile button goes to the public page, not a section', () => {
    // It scrolled to the performance block. The page clients actually see is
    // /vendor/:id.
    expect(workspace).toContain('navigate(`/vendor/${ownProfileId}`)');
  });

  it('a homeowner can still edit their own profile somewhere', () => {
    // The editor was once rendered only inside the professional-only block, so
    // a homeowner had no way to change their own bio, location or avatar. It
    // then lived in the workspace as `role-profile`, and has now moved to
    // /settings along with the rest of the account configuration.
    //
    // The property under test never changed: a homeowner must be able to reach
    // their own profile editor. Only its address did.
    const settings = readFileSync(new URL('../client/src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('<VendorProfileCard />');
    expect(settings).toContain('id="settings-profile"');
    // And it is reachable from the homeowner's own menu, not just by URL.
    expect(layout).toContain('SETTINGS_MENU_ITEM');
    expect(layout).toContain("path: '/settings'");
    // The old anchor must be gone from both the map and the page, or the menu
    // would point at a section that no longer renders.
    expect(ROLE_SECTIONS.homeowner).not.toContain('role-profile' as never);
    expect(workspace).not.toContain('id="role-profile"');
  });

  it('every section id in the source is a registered one', () => {
    const ids = [...workspace.matchAll(/id="(role-[a-z]+)"/g)].map(m => m[1]);
    for (const id of ids) expect(SECTION_IDS as readonly string[]).toContain(id);
  });
});

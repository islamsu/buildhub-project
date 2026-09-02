import { describe, expect, it } from 'vitest';
import { getRolePlatformPath, isPlatformRole, PLATFORM_ROLES } from '../client/src/lib/rolePlatform';

describe('role platform routing', () => {
  it('supports every account category shown in the role chooser', () => {
    expect(PLATFORM_ROLES).toEqual([
      'homeowner',
      'contractor',
      'engineer',
      'architect',
      'supplier',
      'project_manager',
    ]);
    for (const role of PLATFORM_ROLES) {
      expect(isPlatformRole(role)).toBe(true);
      expect(getRolePlatformPath(role)).toBe(`/platform/${role}`);
    }
  });

  it('routes admins separately and defaults unknown roles to the homeowner platform', () => {
    expect(getRolePlatformPath('admin')).toBe('/admin');
    expect(getRolePlatformPath(undefined)).toBe('/platform/homeowner');
    expect(getRolePlatformPath('unknown')).toBe('/platform/homeowner');
  });
});

// ── The workspace may not describe work it cannot do ───────────────────────
//
// PHASE 1B: "Do not create fake buttons that do nothing" and "where a workflow
// does not yet exist, document the gap rather than inventing a fake backend
// action". Three cards in RolePlatform.tsx broke that in the other direction -
// prose describing a capability, with nothing behind it:
//
//   - Engineer, "Material Quality Inspection - Audit supplier specifications
//     against engineering standards": no button, no data, no backend. A whole
//     workflow announced and not implemented.
//   - Engineer, "Validate load requirements and reinforcement schedules":
//     BuildHub validates nothing. An AI assistant reads what you attach.
//   - Architect, "Present architectural renderings and client mood boards
//     directly in workspace": there is no portfolio hosting at all.
//
// The last one is now a DASHED card that says so, which is the shape the brief
// asks for: name the gap where the user would look for the feature.
import { readFileSync } from 'node:fs';

const PLATFORM_PAGE = readFileSync(new URL('../client/src/pages/RolePlatform.tsx', import.meta.url), 'utf8');

describe('no role workspace promises a capability that does not exist', () => {
  it('REGRESSION: the three fabricated claims are gone', () => {
    expect(PLATFORM_PAGE).not.toContain('Material Quality Inspection');
    expect(PLATFORM_PAGE).not.toContain('Audit supplier specifications against engineering standards');
    expect(PLATFORM_PAGE).not.toContain('Validate load requirements and reinforcement schedules');
    expect(PLATFORM_PAGE).not.toContain('Present architectural renderings and client mood boards');
  });

  it('the capability that WAS missing is now real, and reachable where the user looks for it', () => {
    // WHAT THIS TEST USED TO ASSERT, and why it changed.
    //
    // Portfolio hosting did not exist, so the honest thing was to say so: this
    // test required the words "Portfolio hosting - not available yet" on the
    // architect's card. Portfolio hosting now EXISTS - portfolioItems, the
    // portfolio router, PortfolioManager, and public display on the vendor
    // profile - so that disclaimer would be a false statement about the
    // product, and demanding it would be a test insisting the UI lie.
    //
    // The obligation is unchanged, only its direction: what the architect
    // looks for must be TRUE where they look. So the assertion is now that the
    // real manager is mounted on the page, not that an apology is.
    expect(PLATFORM_PAGE).toContain('<PortfolioManager />');
    expect(PLATFORM_PAGE).toContain("import PortfolioManager from '@/components/PortfolioManager'");
    // The route out to the public profile is still the other half of the
    // answer, and is still required.
    expect(PLATFORM_PAGE).toContain('Go to my public profile');
    // And the retired disclaimer must not linger beside the working feature.
    expect(PLATFORM_PAGE).not.toContain('Portfolio hosting - not available yet');
  });

  it('every STATIC card carries a control or is marked unavailable', () => {
    // The general form of the defect. A card built from live rows is fine -
    // the data is the content. A card that is pure prose has to either DO
    // something (a Button) or admit it cannot (border-dashed).
    //
    // Blocks are cut at the next sibling marker rather than by matching JSX,
    // which is sound here because no `rounded-xl border` card in this file
    // nests another; if one ever does, this test over-reads rather than
    // under-reads, which is the safe direction for a guard.
    const MARKER = '<div className="rounded-xl border';
    const DATA_BOUND = /\{(project|rfq|product|quote|metric|action)\./;
    const offenders: string[] = [];
    let examined = 0;
    let from = PLATFORM_PAGE.indexOf(MARKER);
    while (from !== -1) {
      const next = PLATFORM_PAGE.indexOf(MARKER, from + MARKER.length);
      const end = PLATFORM_PAGE.indexOf('</CardContent>', from);
      const stop = next === -1 ? (end === -1 ? PLATFORM_PAGE.length : end) : Math.min(next, end === -1 ? next : end);
      const block = PLATFORM_PAGE.slice(from, stop);
      const isStatic = !DATA_BOUND.test(block) && !block.includes('.map(');
      if (!isStatic) { from = next; continue; }
      examined++;
      if (!block.includes('<Button') && !block.includes('border-dashed')) {
        offenders.push(block.slice(0, 120));
      }
      from = next;
    }
    // A scanner that examined nothing would pass for the wrong reason. The
    // marker deliberately requires `<div className=` immediately, which the
    // row templates never match - they carry `key={...}` first - so what is
    // left is exactly the static cards.
    expect(examined, 'static cards the guard actually examined').toBeGreaterThanOrEqual(4);
    expect(offenders, 'static prose cards with nothing behind them').toEqual([]);
  });
});

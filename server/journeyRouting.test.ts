import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { and, eq } from 'drizzle-orm';
import { users } from '../drizzle/schema';
import { readSourceForAssertions } from './_testing/sourceText';
import { directoryVisibilityFilter, PROVIDER_ROLES } from './vendorDirectory';
import { PROVIDER_ROLES as MATRIX_PROVIDER_ROLES } from '../shared/roleMatrix';

/**
 * ── A CARD MUST APPLY THE FILTER IT PROMISES ────────────────────────────
 *
 * The failure mode this exists for is a destination that looks filtered and
 * is not: a Suppliers card that opens the undifferentiated list of all five
 * provider roles, or a Contractors card that quietly falls back to everyone
 * because no contractor has joined. Both would pass a test that only checked
 * the URL changed, which is why §44 asks for the resulting filter SEMANTICS.
 *
 * So this proves the chain end to end, in source where the wiring lives and in
 * rendered SQL where the filtering happens:
 *
 *   route  ->  component  ->  preset  ->  query parameter  ->  WHERE clause
 */

const ROOT = join(import.meta.dirname, '..');
const code = (rel: string) => readSourceForAssertions(readFileSync(join(ROOT, rel), 'utf8'));
const APP = () => code('client/src/App.tsx');
const DIRECTORY = () => code('client/src/pages/VendorsDirectory.tsx');
const ROUTERS = () => code('server/routers.ts');
const DIRECTORY_SERVER = () => code('server/vendorDirectory.ts');

const sqlOf = (condition: unknown) => new MySqlDialect().sqlToQuery(condition as never).sql;

/** Every journey destination, and the axis it claims. */
const DESTINATIONS = [
  { id: 'products', route: '/marketplace/products', axis: 'catalogue' },
  { id: 'suppliers', route: '/marketplace/suppliers', axis: 'role', value: 'supplier',
    component: 'SuppliersDirectory', file: 'client/src/pages/SuppliersDirectory.tsx' },
  { id: 'contractors', route: '/marketplace/contractors', axis: 'role', value: 'contractor',
    component: 'ContractorsDirectory', file: 'client/src/pages/ContractorsDirectory.tsx' },
  { id: 'design', route: '/marketplace/designers', axis: 'category', value: 'Design',
    component: 'DesignersDirectory', file: 'client/src/pages/DesignersDirectory.tsx' },
  { id: 'finishing', route: '/marketplace/finishing', axis: 'category', value: 'Renovation',
    component: 'FinishingDirectory', file: 'client/src/pages/FinishingDirectory.tsx' },
  { id: 'quotes', route: '/rfq', axis: 'workflow' },
] as const;

describe('every journey resolves to a real destination', () => {
  it('each route is registered and reaches its own component', () => {
    const app = APP();
    for (const destination of DESTINATIONS) {
      expect(app, `${destination.route} is not a route`)
        .toContain(`path={"${destination.route}"}`);
      if ('component' in destination) {
        expect(app, `${destination.route} does not reach ${destination.component}`)
          .toMatch(new RegExp(`path=\\{"${destination.route.replace(/\//g, '\\/')}"\\}\\s+component=\\{${destination.component}\\}`));
      }
    }
  });

  it('and NO destination silently opens the unfiltered provider directory', () => {
    /*
     * THE DEFECT THIS BLOCKS. Each of the four provider journeys must pass its
     * own preset into the shared view. A component that rendered
     * `<VendorsDirectoryView />` bare would be the generic all-provider list
     * wearing a journey label - which is precisely the consolidation the owner
     * rejected, reintroduced one component at a time.
     */
    for (const destination of DESTINATIONS) {
      if (!('file' in destination)) continue;
      const source = code(destination.file);
      const preset = destination.axis === 'role' ? 'presetRole' : 'presetCategory';
      expect(source, `${destination.component} passes no ${preset}`)
        .toMatch(new RegExp(`${preset}="${destination.value}"`));
      expect(source, `${destination.component} renders the unfiltered directory`)
        .not.toMatch(/<VendorsDirectoryView\s*\/>/);
    }
  });

  it('the role preset is sent to the SERVER, not applied in the browser', () => {
    /*
     * A role view that fetched everything and hid the rest would still ship
     * other roles' provider records to the browser, and its result count would
     * describe a list the page does not show.
     */
    const view = DIRECTORY();
    const call = view.slice(view.indexOf('trpc.marketplace.vendors.useQuery'));
    const body = call.slice(0, call.indexOf('});'));
    expect(body, 'the role is no longer part of the query').toContain('role: presetRole');
    expect(view, 'the role became a client-side filter')
      .not.toMatch(/vendors\.filter\([^)]*userRole/);
  });

  it('and the role is a FIXED destination identity, not another dropdown', () => {
    /*
     * A role select would turn four first-class journeys back into one
     * directory with a filter, which is the consolidation being corrected. The
     * category dropdown stays usable INSIDE a role view - narrowing
     * Contractors to Renovation is a reasonable thing to want.
     */
    const view = DIRECTORY();
    expect(view, 'the role became user-changeable state')
      .not.toMatch(/useState[^\n]*presetRole/);
    expect(view, 'the category filter was removed from role views')
      .toContain('useState(presetCategory ?? ');
  });
});

describe('the role filter narrows the directory and can never widen it', () => {
  it('ROLE NARROWS: the clause is ANDed onto the visibility rule', () => {
    /*
     * Asserted on rendered SQL rather than on the source line. The directory's
     * own rule already restricts to the five provider roles; a role preset
     * picks one OUT OF that set. Expressed as an AND, so a role outside the set
     * - were the type ever bypassed - returns nothing rather than reaching a
     * homeowner or an administrator. Fail closed by construction.
     */
    const base = sqlOf(directoryVisibilityFilter());
    const narrowed = sqlOf(and(directoryVisibilityFilter(), eq(users.userRole, 'supplier')));
    expect(base, 'the directory stopped restricting to provider roles')
      .toMatch(/`users`\.`userRole` in/);
    expect(narrowed, 'the role clause is gone').toMatch(/`users`\.`userRole` = \?/);
    expect(narrowed, 'the role replaced the visibility rule instead of narrowing it')
      .toContain(base);
    expect(narrowed, 'the two became alternatives').not.toMatch(/\bor\b/);
  });

  it('and the server applies it that way', () => {
    const source = DIRECTORY_SERVER();
    expect(source, 'the role filter is gone from the query builder')
      .toMatch(/if \(filters\.role\) \{[\s\S]{0,120}eq\(users\.userRole, filters\.role\)/);
  });

  it('THE PUBLIC INPUT ADMITS ONLY PROVIDER ROLES', () => {
    /*
     * The directory is public and unauthenticated. A free-text role would be
     * an invitation to ask for 'admin' or 'homeowner', so the endpoint takes
     * an enum over PROVIDER_ROLES and Zod refuses anything else before a query
     * is built.
     */
    const routers = ROUTERS();
    const vendors = routers.slice(routers.indexOf('  vendors: publicProcedure'));
    const input = vendors.slice(0, vendors.indexOf('.query('));
    expect(input, 'the role input is not an enum').toContain('role: z.enum(PROVIDER_ROLES)');
    expect(input, 'the role input is free text').not.toMatch(/role: z\.string/);

    expect(PROVIDER_ROLES, 'a non-provider role entered the public enum')
      .not.toContain('admin' as never);
    expect(PROVIDER_ROLES).not.toContain('homeowner' as never);
    /* And the two role lists agree: the directory's enum and the role matrix's
       are the same five, so a journey cannot name a role the matrix does not
       have. Two copies that drift is how one of them ends up laxer. */
    expect([...PROVIDER_ROLES].sort()).toEqual([...MATRIX_PROVIDER_ROLES].sort());
  });

  it('the two role journeys name roles the matrix actually has', () => {
    const model = code('client/src/components/brand/domainIdentity.ts');
    const roles = [...model.matchAll(/filter: \{ by: 'role', value: '([^']+)' \}/g)].map(m => m[1]);
    expect(roles).toEqual(['supplier', 'contractor']);
    for (const role of roles) {
      expect(MATRIX_PROVIDER_ROLES, `${role} is not a provider role`).toContain(role as never);
    }
  });
});

describe('the category journeys keep the declared-category axis', () => {
  it('DESIGN SERVICES AND FINISHING FILTER ON DECLARED CATEGORY, NOT ROLE', () => {
    /*
     * The axis matters for correctness, not neatness. A contractor who has
     * declared Renovation belongs in Finishing; filtering Finishing by role
     * would discard exactly the providers the customer came for. And Design
     * Services is a SERVICE the customer wants, which is why the label is not
     * "Professionals" and the filter is not "architect role".
     */
    expect(code('client/src/pages/DesignersDirectory.tsx'))
      .toMatch(/presetCategory="Design"/);
    expect(code('client/src/pages/FinishingDirectory.tsx'))
      .toMatch(/presetCategory="Renovation"/);
    for (const file of ['DesignersDirectory', 'FinishingDirectory']) {
      expect(code(`client/src/pages/${file}.tsx`), `${file} became role-filtered`)
        .not.toMatch(/presetRole/);
    }
  });

  it('and the category filter is the shared taxonomy, matched against declarations', () => {
    const source = DIRECTORY_SERVER();
    expect(source, 'the category filter stopped reading declared categories')
      .toMatch(/vendorCategories\.userId[\s\S]{0,160}vendorCategories\.category/);
  });
});

describe('placement is not rendered on an axis it was never sold against', () => {
  it('A ROLE VIEW SHOWS THE ORGANIC DIRECTORY ONLY', () => {
    /*
     * Every placement surface is scoped by category or globally; none is sold
     * per role. That leaves two wrong options on a Suppliers page - show them
     * unfiltered and a contractor appears in a paid slot on a page promising
     * suppliers, or filter them client-side and an advertiser silently loses
     * impressions they paid for. So a role view renders neither, and nothing
     * about placement eligibility changes.
     */
    const view = DIRECTORY();
    expect(view, 'the role guard on placement is gone').toContain('const placementsApply = !presetRole');
    for (const surface of ['MasterProviderSlot', 'ProviderSpotlight']) {
      expect(view, `${surface} is rendered unconditionally on a role view`)
        .toMatch(new RegExp(`placementsApply && <${surface}`));
    }
    /* The two placement QUERIES are gated too - not merely hidden, which would
       still fetch a paid strip the page cannot show. */
    for (const query of ['sponsoredVendors', 'featuredProviders']) {
      const at = view.indexOf(`trpc.marketplace.${query}.useQuery`);
      expect(at, `${query} is gone`).toBeGreaterThan(-1);
      expect(view.slice(at, at + 400), `${query} still runs on a role view`)
        .toContain('enabled: placementsApply');
    }
  });

  it('and the category views keep their placement exactly as before', () => {
    /* Design Services and Finishing are category-scoped, which is the axis
       placement IS sold on, so they are untouched. */
    for (const file of ['DesignersDirectory', 'FinishingDirectory']) {
      expect(code(`client/src/pages/${file}.tsx`), `${file} suppressed its placement`)
        .not.toMatch(/placementsApply|presetRole/);
    }
  });
});

describe('the hub and the homepage teach one mental model', () => {
  it('both read the SAME journey identities', () => {
    const hub = code('client/src/pages/MarketplaceHub.tsx');
    const home = code('client/src/pages/Home.tsx');
    expect(home).toContain("from '@/components/brand/domainIdentity'");
    expect(hub).toContain("from '@/components/brand/domainIdentity'");
    expect(hub, 'the hub kept its own colour table').not.toMatch(/domainStyle\(/);
  });

  it('and the hub offers Suppliers and Contractors, not one "Vendors" card', () => {
    /*
     * §16: a visitor must not learn "Suppliers" on one page and "Suppliers &
     * professionals" on another for the same discovery intent.
     */
    const hub = code('client/src/pages/MarketplaceHub.tsx');
    const sections = hub.slice(hub.indexOf('const sections = ['));
    const ids = [...sections.matchAll(/^      id: '([a-z]+)',$/gm)].map(m => m[1]);
    expect(ids, 'the hub destinations drifted from the homepage journeys')
      .toEqual(['products', 'suppliers', 'contractors', 'designers', 'finishing']);
    expect(sections, 'the hub still points a macro card at the unfiltered directory')
      .not.toContain("href: '/marketplace/vendors'");
  });

  it('and Get Quotes stays a homepage action rather than a catalogue domain', () => {
    /*
     * Deliberately asymmetric, and §16 allows it: the hub lists marketplace
     * areas to browse, and an RFQ is not one. It keeps its own call to action
     * further down the hub instead.
     */
    const hub = code('client/src/pages/MarketplaceHub.tsx');
    const sections = hub.slice(hub.indexOf('const sections = ['), hub.indexOf('EDITORIAL FEATURED'));
    expect(sections, 'Get Quotes became a marketplace domain').not.toMatch(/id: 'quotes'/);
    expect(hub, 'the hub lost its RFQ call to action').toContain('marketHub.rfqCta');
  });
});

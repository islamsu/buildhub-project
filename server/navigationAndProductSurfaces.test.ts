// ── The guards added by the navigation, settings and product pass ──────────
//
// Four rules, and the reason each one is here rather than being taken on trust:
//
//   PROJECTS ARE THE CUSTOMER'S. `projects.create` was `protectedProcedure`
//   with no role check. Only the homeowner dashboard offered the button, so it
//   LOOKED restricted - and that appearance was the whole of the restriction.
//   Any authenticated account could POST to it directly.
//
//   A UNIT COMES FROM THE LIST, BUT AN OLD ONE STILL SAVES. Tightening a field
//   must not lock people out of records they already own; sixteen products are
//   priced per "tonne" and three per "ton", and none of their owners should be
//   refused when they edit a price.
//
//   THE CUSTOMER'S PHONE NUMBER IS WHAT THE CREDIT BUYS. Identity is free so a
//   supplier can decide whether to bid; contact channels are not, or an
//   approved supplier could route around the qualified-enquiry charge entirely.
//
//   THE PLAN BESIDE A NAME COMES FROM BILLING. Not from the role, not from a
//   constant - or a lapsed trial would keep saying Premium.

import { describe, expect, it } from 'vitest';
import { ROLE_SECTIONS, WORKSPACE_ROLES } from '../shared/roleWorkspaceSections';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { PRODUCT_UNITS, isProductUnit, normaliseUnit } from '@shared/productUnits';
import { parseProductImport } from '@shared/productImport';
import { canCreateProject, creatorProjectRole } from '@shared/projectAccess';
import { SEED_CATEGORIES } from '@shared/categoryTaxonomy';
import { indexFromSeed, importCategoryResolver } from './categoryService';

/**
 * The REAL resolver over the REAL seed.
 *
 * parseProductImport used to take a list of permitted category strings, which
 * is exactly how bulk upload came to disagree with single product listing. It
 * now takes the same resolver the single-product path uses, so these tests
 * exercise the actual resolution rather than a stand-in list.
 */
const CATEGORY_RESOLVER = importCategoryResolver(indexFromSeed(SEED_CATEGORIES));

const read = (relative: string) => readSourceForAssertions(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const ROUTERS = read('./routers.ts');
const APP = read('../client/src/App.tsx');

// ══ 1. PROJECTS ARE CREATED BY THE CUSTOMER ═══════════════════════════════

describe('who may start a project', () => {
  const block = (() => {
    const start = ROUTERS.indexOf('const projectsRouter = router({');
    expect(start, 'projectsRouter not found').toBeGreaterThan(-1);
    const at = ROUTERS.indexOf('  create: protectedProcedure', start);
    return ROUTERS.slice(at, ROUTERS.indexOf('\n  update:', at));
  })();

  it('the slice is the real procedure, not an empty string', () => {
    // Every assertion below would pass vacuously on '' .
    expect(block.length).toBeGreaterThan(400);
    expect(block).toContain('db.insert(projects)');
  });

  /**
   * THIS RULE CHANGED, AND THE REASON IT CHANGED IS THE POINT.
   *
   * The previous version of this test asserted homeowner-only creation. That
   * restriction was justified partly by the observation that every existing
   * project happened to be homeowner-owned - which is not evidence of
   * anything: historical rows record the rule that WAS enforced, so a
   * restriction was being used as proof of itself.
   *
   * The rule is now the professional roles that deliver a job, with supplier
   * excluded because a supplier sells INTO a project rather than
   * commissioning one. The list lives in shared/projectAccess.ts and this
   * asserts the PROCEDURE consults it, rather than re-listing the roles here
   * where the two copies could drift apart.
   */
  it('refuses accounts outside the creator list, in the PROCEDURE', () => {
    expect(block).toContain('canCreateProject(ctx.user.userRole)');
    expect(block).toContain("code: 'FORBIDDEN'");
  });

  it('and the refusal tells a supplier where they actually stand', () => {
    // Someone hitting this is looking for the feature, not attacking it.
    expect(block).toContain('Suppliers sell into projects rather than commissioning them');
  });

  it('the check runs BEFORE the insert, not after it', () => {
    expect(block.indexOf('canCreateProject(')).toBeLessThan(block.indexOf('db.insert(projects)'));
  });

  it('the creator list is the professional roles, and excludes supplier', () => {
    // The list itself, checked where it lives. Asserted by BEHAVIOUR rather
    // than by matching the array's source text, so it fails if the function
    // stops agreeing with the constant.
    expect(canCreateProject('homeowner')).toBe(true);
    expect(canCreateProject('project_manager')).toBe(true);
    expect(canCreateProject('contractor')).toBe(true);
    expect(canCreateProject('architect')).toBe(true);
    expect(canCreateProject('engineer')).toBe(true);
    // The considered exception.
    expect(canCreateProject('supplier')).toBe(false);
    // And nothing unknown slips through.
    expect(canCreateProject('admin')).toBe(false);
    expect(canCreateProject(undefined)).toBe(false);
  });

  it('a creator who is not the customer becomes the manager, not the owner', () => {
    // Otherwise a contractor creating a job would quietly own the customer's
    // project, which is exactly what the membership model exists to prevent.
    expect(creatorProjectRole('homeowner')).toBe('owner');
    expect(creatorProjectRole('contractor')).toBe('manager');
    expect(creatorProjectRole('project_manager')).toBe('manager');
  });

  it('creation records the creator AND seeds the team', () => {
    // A project with nobody on it would render as having no members at all.
    expect(block).toContain('createdBy: ctx.user.id');
    expect(block).toContain('db.insert(projectMembers)');
  });

  it('the role comes from the session, never from the request body', () => {
    expect(block).not.toMatch(/input\.(userRole|role|ownerId)/);
    expect(block).toContain('ownerId: ctx.user.id');
  });
});

// ══ 2. THE UNIT RULE ══════════════════════════════════════════════════════

describe('a product unit comes from the list - without stranding old rows', () => {
  it('the list is non-trivial and covers what the catalogue already uses', () => {
    expect(PRODUCT_UNITS.length).toBeGreaterThan(10);
    // These are units real products in this catalogue are priced in.
    for (const unit of ['tonne', 'bag', 'm2', 'm3', 'unit']) {
      expect(isProductUnit(unit), unit).toBe(true);
    }
  });

  it('a new product must use a known unit', () => {
    expect(normaliseUnit('tonne', null)).toEqual({ ok: true, value: 'tonne' });
    expect(normaliseUnit('ton', null)).toEqual({ ok: false });
    expect(normaliseUnit('whatever the supplier typed', null)).toEqual({ ok: false });
  });

  it('an EXISTING unit outside the list still saves - the whole point', () => {
    // "ton" is not in the list. Three products are priced in it. Their owners
    // must still be able to edit the price without being refused over a field
    // they never touched.
    expect(normaliseUnit('ton', 'ton')).toEqual({ ok: true, value: 'ton' });
    expect(normaliseUnit('sack', 'sack')).toEqual({ ok: true, value: 'sack' });
  });

  it('but an existing row cannot be changed to a DIFFERENT unknown unit', () => {
    // Preserving what is there is not the same as reopening the field.
    expect(normaliseUnit('ton', 'tonne')).toEqual({ ok: false });
    expect(normaliseUnit('made up', 'ton')).toEqual({ ok: false });
  });

  it('omitting the field changes nothing, and clearing it is allowed', () => {
    expect(normaliseUnit(undefined, 'ton')).toEqual({ ok: true, value: undefined });
    expect(normaliseUnit(null, 'ton')).toEqual({ ok: true, value: null });
    expect(normaliseUnit('', 'ton')).toEqual({ ok: true, value: null });
  });

  it('both write paths apply it, and the update path knows the stored value', () => {
    expect(ROUTERS).toContain('normaliseUnit(input.unit, null)');
    expect(ROUTERS).toContain('normaliseUnit(rest.unit, owned.unit)');
    // The stored value can only be known after the row is read.
    expect(ROUTERS.indexOf('normaliseUnit(rest.unit, owned.unit)'))
      .toBeGreaterThan(ROUTERS.indexOf("message: 'Product not found'"));
  });

  it('the refusal tells the supplier what the acceptable values are', () => {
    expect(ROUTERS).toContain('Choose a unit from the list.');
    expect(ROUTERS).toContain('PRODUCT_UNITS.join');
  });
});

// ══ 3. ORIGIN IS REACHABLE END TO END ═════════════════════════════════════

describe('country of origin', () => {
  it('is accepted when a product is CREATED, not only when it is edited', () => {
    // The column and the update path both had it. Nothing could set it at
    // creation and no form collected it, so in practice it did not exist.
    const create = ROUTERS.slice(
      ROUTERS.indexOf('  create: approvedProviderProcedure'),
      ROUTERS.indexOf('  importProducts:'),
    );
    expect(create.length).toBeGreaterThan(300);
    expect(create).toContain('origin: z.string().max(100).optional()');
  });

  /**
   * BEHAVIOUR, NOT TEXT.
   *
   * The test below this one asserts that routers.ts CONTAINS
   * `normaliseUnit(row.unit, null)`. That is worth keeping - it pins the
   * wiring - but on its own it is a text check, and mutating that line kills
   * the suite because the TEXT changed, not because anything behaved
   * differently. A live probe caught the difference: the rule looked tested
   * and was, for a while, running against a server that predated it.
   *
   * This runs the actual composition the router runs - parse the CSV, then
   * put each row's unit through the rule - so it fails if either half stops
   * working, including if the parser ever stops populating `unit`.
   */
  it('a CSV row spelt "ton" is REFUSED by the parse-then-normalise pipeline', () => {
    const csv = [
      'name,description,price,unit,category',
      'Rebar 12mm,steel,22500,ton,Materials',
      'Washed sand,sand,180,m3,Materials',
    ].join('\n');
    const parsed = parseProductImport(csv, CATEGORY_RESOLVER);
    expect(parsed.rows, 'the parser produced no rows').toHaveLength(2);
    // The parser must actually carry the unit through; if it ever stops, the
    // rule silently passes everything and this catches that too.
    expect(parsed.rows.map(row => row.unit)).toEqual(['ton', 'm3']);

    const refused = parsed.rows.filter(row => !normaliseUnit(row.unit, null).ok);
    expect(refused.map(row => row.unit)).toEqual(['ton']);
    // POSITIVE CONTROL: the valid row is not collateral damage.
    expect(normaliseUnit('m3', null)).toEqual({ ok: true, value: 'm3' });
  });

  it('the BULK IMPORT path applies the same unit rule as the form', () => {
    // The gap this closes: `create` and `updateProduct` both went through
    // normaliseUnit; `importProducts` wrote `row.unit` straight from the CSV.
    // A supplier could not list ONE product per "ton" through the form and
    // could list five hundred through a spreadsheet.
    const importBlock = ROUTERS.slice(
      ROUTERS.indexOf('  importProducts:'),
      ROUTERS.indexOf('  uploadProductImage:'),
    );
    expect(importBlock.length, 'importProducts block not found').toBeGreaterThan(400);
    expect(importBlock).toContain('normaliseUnit(row.unit, null)');
    // Refused as a per-line error the supplier can act on, not thrown away
    // silently and not accepted.
    expect(importBlock).toContain("column: 'unit'");
    expect(importBlock).toContain('...unitErrors');
    // And it must reach BOTH the reported list and the count, or the import
    // would report zero errors and then refuse to run.
    expect(importBlock.match(/\.\.\.unitErrors/g)?.length).toBe(2);
  });

  it('and a form actually collects it', () => {
    const form = read('../client/src/pages/ProductFormPage.tsx');
    expect(form).toContain('data-testid="product-origin"');
    expect(form).toContain('origin: form.origin || undefined');
  });
});

// ══ 4. WHO THE CUSTOMER IS, AND WHAT THE CREDIT BUYS ══════════════════════

describe('the requester behind an RFQ', () => {
  const block = (() => {
    const at = ROUTERS.indexOf('  requesterContact: protectedProcedure');
    expect(at, 'requesterContact not found').toBeGreaterThan(-1);
    return ROUTERS.slice(at, ROUTERS.indexOf('\n  summary:', at));
  })();

  it('the slice is real', () => {
    expect(block.length).toBeGreaterThan(600);
  });

  it('goes through an explicit column allowlist, never select().from(users)', () => {
    expect(block).not.toMatch(/select\(\)\s*\n?\s*\.from\(users\)/);
    for (const forbidden of ['passwordHash', 'invitationToken', 'openId', 'loginMethod', 'tokenHash']) {
      expect(block, `${forbidden} must not be selected`).not.toContain(forbidden);
    }
    // POSITIVE CONTROL: it really does select the identity fields, so the
    // assertions above are not passing on an empty projection.
    expect(block).toContain('name: users.name');
    expect(block).toContain('userRole: users.userRole');
  });

  it('releases email and phone ONLY when the enquiry has been consumed', () => {
    expect(block).toContain('qualifiedEnquiries.rfqId, input.rfqId');
    expect(block).toContain('email: users.email');
    // The contact select sits inside the `consumed` branch, not beside the
    // identity select.
    expect(block.indexOf('const consumed')).toBeLessThan(block.indexOf('email: users.email'));
    expect(block).toContain('if (consumed)');
  });

  it('a stranger gets NOT_FOUND, which does not confirm the id exists', () => {
    expect(block).toContain("code: 'NOT_FOUND', message: 'RFQ not found'");
    expect(block).not.toContain("code: 'FORBIDDEN'");
  });

  it('and the page says WHY contact is absent rather than printing N/A', () => {
    const page = read('../client/src/pages/RFQRespondPage.tsx');
    expect(page).toContain('data-testid="respond-contact-locked"');
    expect(page).not.toContain('N/A');
  });
});

// ══ 5. THE PLAN BESIDE THE NAME ═══════════════════════════════════════════

describe('the plan shown next to a person', () => {
  const navbar = read('../client/src/components/Navbar.tsx');
  const shell = read('../client/src/components/DashboardLayout.tsx');

  it('comes from the billing system in BOTH shells', () => {
    // A signed-in person lives inside DashboardLayout and never sees Navbar,
    // so putting it in only one of them shows it to almost nobody.
    for (const [name, source] of [['navbar', navbar], ['shell', shell]] as const) {
      expect(source, `${name} must read the real subscription`).toContain('trpc.billing.mySubscription.useQuery');
      expect(source, `${name} must label it from the catalogue`).toContain('billing.plan.${subscription.plan}');
    }
  });

  it('is never derived from the role or hard-coded', () => {
    for (const source of [navbar, shell]) {
      expect(source).not.toMatch(/plan\s*=\s*['"](free|professional|premium)['"]/);
      expect(source).not.toMatch(/userRole\s*===\s*['"]supplier['"]\s*\?\s*['"]/);
    }
  });

  it('renders NOTHING while unknown, rather than guessing "Free"', () => {
    // A Premium vendor shown "Free" because a request was in flight is worse
    // than no badge at all.
    for (const source of [navbar, shell]) {
      expect(source).toContain("subscription?.plan ? t(`billing.plan.");
      expect(source).toContain(': null;');
    }
  });

  it('and every plan id in the catalogue has a label in both languages', async () => {
    const { PLAN_IDS } = await import('@shared/billing');
    const context = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    for (const plan of PLAN_IDS) {
      const occurrences = context.split(`'billing.plan.${plan}':`).length - 1;
      expect(occurrences, `billing.plan.${plan} must exist in EN and AR`).toBe(2);
    }
  });
});

// ══ 6. THE NEW SURFACES ARE REACHABLE ═════════════════════════════════════

describe('every new page has an address and a way in', () => {
  it('the routes are registered', () => {
    for (const route of ['/settings', '/rfq/:id/respond', '/products/new', '/products/:id/edit']) {
      expect(APP, `${route} must be routed`).toContain(`path={"${route}"}`);
    }
  });

  it('the respond route is matched before the detail route', () => {
    expect(APP.indexOf('path={"/rfq/:id/respond"}')).toBeLessThan(APP.indexOf('path={"/rfq/:id"}'));
  });

  it('route components are named, not inline arrows', () => {
    // An inline arrow is a new component identity every render - React
    // remounts the page and loses form state mid-edit - and it hides the
    // route from the repository census, whose parser matches
    // `component={Identifier}`. Both product routes were missing from the
    // census until this was caught.
    expect(APP).not.toMatch(/component=\{\(\)\s*=>/);
  });

  it('and each is reachable by ordinary navigation, not only by URL', () => {
    const layout = read('../client/src/components/DashboardLayout.tsx');
    expect(layout).toContain("path: '/settings'");
    const detail = read('../client/src/pages/RFQDetail.tsx');
    expect(detail).toContain('/respond`}>');
    const workspace = read('../client/src/pages/RolePlatform.tsx');
    expect(workspace).toContain("navigate('/products/new')");
    const catalogue = read('../client/src/components/SupplierCatalogue.tsx');
    expect(catalogue).toContain('/edit`}>');
  });

  it('the brand returns Home from the signed-in shell', () => {
    // The one element a person instinctively clicks to leave a workspace. It
    // was a bare <div> on every dashboard, RFQ, product and admin screen.
    const layout = read('../client/src/components/DashboardLayout.tsx');
    expect(layout).toContain('data-testid="brand-home"');
    const at = layout.indexOf('data-testid="brand-home"');
    expect(layout.slice(Math.max(0, at - 200), at)).toContain('href="/"');
  });

  it('Dashboard and AI are top-level, not buried in the account menu', () => {
    const navbar = read('../client/src/components/Navbar.tsx');
    const links = navbar.slice(navbar.indexOf('const navLinks = ['), navbar.indexOf('];', navbar.indexOf('const navLinks = [')));
    expect(links).toContain("t('nav.dashboard')");
    expect(links).toContain("t('dash.ai')");
  });

  /**
   * EVERY ROLE'S SIDEBAR NAMES AT LEAST ONE OF ITS OWN WORKSPACE SECTIONS.
   *
   * The homeowner's did not. Its menu pointed at /dashboard, /marketplace,
   * /rfq, /messages, /ai and /settings - six other places - and named none of
   * the workspace it belongs to, so `role-projects` was reachable only by
   * clicking a KPI tile, and "Overview" had nothing to bring you back FROM:
   * from the top of the workspace it did nothing at all.
   *
   * A live click audit found it (6 of 7 destinations did something); no unit
   * test could have, which is why one exists now.
   */
  it("every role's sidebar names a section of its own workspace", () => {
    const layout = read('../client/src/components/DashboardLayout.tsx');
    for (const role of WORKSPACE_ROLES) {
      const sections = ROLE_SECTIONS[role].filter(id => id !== 'role-overview');
      const menu = role === 'homeowner'
        ? layout.slice(layout.indexOf('const HOMEOWNER_MENU_KEYS'), layout.indexOf('];', layout.indexOf('const HOMEOWNER_MENU_KEYS')))
        : layout.slice(layout.indexOf(`  ${role}: [`), layout.indexOf('  ],', layout.indexOf(`  ${role}: [`)));
      expect(menu.length, `${role}: menu block not found`).toBeGreaterThan(40);
      const named = sections.filter(id => menu.includes(`'${id}'`));
      expect(named.length, `${role} names none of ${sections.join(', ')}`).toBeGreaterThan(0);
    }
  });
});

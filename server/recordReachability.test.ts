import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A RECORD THE PRODUCT SHOWS YOU MUST BE A RECORD YOU CAN OPEN.
 *
 * The zero-gap click audit drove every visible control in all six role
 * workspaces. Among what it found: a provider's own submitted quotations were
 * rendered as summary tiles that could not be clicked, and the RFQ detail page
 * showed a provider nothing about the response they had already sent - the
 * quotation existed in the database, was listed as a number in a KPI, and had
 * no surface anywhere that showed it as a record.
 *
 * These tests read the shipping source and hold each entity to one of the
 * three acceptable outcomes: it performs its action, it opens its record, or
 * it is not presented as something to click.
 */

import { ROLE_SECTIONS } from '@shared/roleWorkspaceSections';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const workspace = read('../client/src/pages/RolePlatform.tsx');
const rfqDetail = read('../client/src/pages/RFQDetail.tsx');
const rfqList = read('../client/src/pages/RFQPage.tsx');
const routes = read('../client/src/App.tsx');

describe('a submitted quotation is reachable', () => {
  it('the workspace tile opens THE QUOTATION it depicts', () => {
    expect(workspace).toContain('data-testid="my-quotation"');
    // WAS `/rfq/${quote.rfqId}`, and that was a workaround, not the intent. A
    // quotation had no page, so the tile opened the nearest thing that existed
    // - the request it answered. /quotations/:id now exists, so the tile opens
    // the record it actually depicts. The old expectation is not weakened here,
    // it is superseded: a control should open what it shows.
    //
    // The HANDLER, not the file. Asserting the file merely contained the
    // navigate call let a mutation that replaced onClick with a no-op survive:
    // the identical call in onKeyDown kept the assertion true, so a tile that
    // was dead to the mouse and alive to the keyboard would have passed.
    const onClick = /onClick=\{\(\) => navigate\(`\/quotations\/\$\{quote\.id\}`\)\}/;
    const onKeyDown = /onKeyDown=\{event => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\) navigate\(`\/quotations\/\$\{quote\.id\}`\); \}\}/;
    expect(onClick.test(workspace), 'the tile must navigate on click').toBe(true);
    expect(onKeyDown.test(workspace), 'and on Enter or Space').toBe(true);
  });

  it('and it is reachable by keyboard, not only by mouse', () => {
    const at = workspace.indexOf('data-testid="my-quotation"');
    const tile = workspace.slice(at - 400, at + 600);
    expect(tile).toContain('role="button"');
    expect(tile).toContain('tabIndex={0}');
    expect(tile).toContain('onKeyDown');
  });

  // ── EVERY role that can bid must be able to see its own bids ─────────────
  //
  // This assertion used to name contractor and supplier. That list was the
  // defect, not the specification: an engineer and an architect are offered a
  // Create Quotation control on their own Design/Engineering RFQ cards, the
  // server accepts the bid, myQuotations was fetched for them - and then the
  // result was discarded, because only two workspaces rendered it. Someone
  // could submit a priced commercial offer and have nowhere in the product to
  // see that they had.
  //
  // Found by driving the whole per-role workflow in a browser, not by reading
  // the source, and the fix is worth nothing if the rule can rot back. So the
  // set of bidding roles is now DERIVED FROM THE WORKSPACE ITSELF: any role
  // whose workspace offers onQuote() must render role-quotations. A future
  // role that gains a quote button and no surface fails here.
  const WORKSPACE_COMPONENTS: Record<string, string> = {
    ContractorWorkspace: 'contractor',
    EngineerWorkspace: 'engineer',
    ArchitectWorkspace: 'architect',
    SupplierWorkspace: 'supplier',
    ProjectManagerWorkspace: 'project_manager',
  };
  const workspaceBody = (component: string) => {
    const at = workspace.indexOf(`function ${component}(`);
    expect(at, `${component} not found`).toBeGreaterThan(-1);
    const next = Object.keys(WORKSPACE_COMPONENTS)
      .map(other => other === component ? -1 : workspace.indexOf(`function ${other}(`, at + 1))
      .filter(i => i > -1);
    return workspace.slice(at, next.length ? Math.min(...next) : workspace.length);
  };

  it('every role whose workspace offers to create a quotation renders a quotations surface', () => {
    const bidders = Object.entries(WORKSPACE_COMPONENTS)
      .filter(([component]) => workspaceBody(component).includes('onQuote('))
      .map(([, role]) => role);
    // POSITIVE CONTROL: if this ever reads zero the derivation broke and the
    // loop below would pass vacuously.
    expect(bidders.length, 'no bidding workspace found - the derivation is broken').toBeGreaterThanOrEqual(4);
    for (const role of bidders) {
      expect(ROLE_SECTIONS[role as keyof typeof ROLE_SECTIONS], `${role} can bid and must be able to see its bids`)
        .toContain('role-quotations');
      // RENDERED FOR THAT ROLE ON THAT PAGE - not necessarily inside the
      // workspace COMPONENT. The supplier's quotations card was hoisted into
      // the supplier branch of RolePlatform so it lands immediately after the
      // overview, which is the order the brief specifies; it is still rendered
      // for the supplier and for no other role.
      //
      // The PLACEMENT - that a page-level section sits inside the right role
      // branch and only that one - is proven in roleWorkspaceNavigation.test.ts
      // by PAGE_LEVEL_SECTIONS, which pins it to the branch. This assertion is
      // about REACHABILITY: a role that can bid must be able to see its bids.
      const component = Object.keys(WORKSPACE_COMPONENTS).find(c => WORKSPACE_COMPONENTS[c] === role)!;
      const branch = `role === '${role}' ? (`;
      const branchAt = workspace.indexOf(branch);
      const inOwnWorkspace = workspaceBody(component).includes('id="role-quotations"');
      const inOwnBranch = branchAt > -1
        && workspace.slice(branchAt, workspace.indexOf("' ? (", branchAt + branch.length))
             .includes('id="role-quotations"');
      expect(inOwnWorkspace || inOwnBranch,
        `${role} can bid but nothing renders the quotations surface its sidebar and KPI point at`)
        .toBe(true);
    }
  });

  it('and they all render the same tiles from the same component', () => {
    // One implementation, so a fix to one is a fix to all of them.
    expect(workspace).toContain('function QuotationTiles(');
    const surfaces = workspace.split('id="role-quotations"').length - 1;
    const uses = workspace.split('<QuotationTiles').length - 1;
    expect(uses, 'every quotations section must render the shared tiles').toBe(surfaces);
  });

  it('the RFQ page shows a provider the response they sent', () => {
    expect(rfqDetail).toContain('data-testid="rfq-detail-my-quotation"');
    expect(rfqDetail).toContain('trpc.rfq.myQuotations.useQuery');
  });

  it('that panel can only ever show the reader their own bid', () => {
    // myQuotations is approvedProviderProcedure and filters on
    // quotations.providerId = ctx.user.id. Nothing on this page supplies a
    // provider id, so there is no input through which it could widen.
    const routers = read('./routers.ts');
    const at = routers.indexOf('  myQuotations: approvedProviderProcedure');
    expect(at).toBeGreaterThan(-1);
    const body = routers.slice(at, routers.indexOf('\n  quotations: protectedProcedure', at));
    expect(body).toContain('eq(quotations.providerId, ctx.user.id)');
    expect(body).not.toMatch(/input\./);
  });

  it('the free-response panel is not shown alongside a response already sent', () => {
    // Otherwise a provider who has already quoted is invited to quote again.
    expect(rfqDetail).toContain('{!isOwner && isProvider && !myQuotation && (');
  });
});

describe('dashboard KPIs lead to the records they count', () => {
  it('a KPI with a destination is clickable, and one without is not', () => {
    // The rule is symmetric. A number that counts records the reader can go
    // and look at should take them there; a number with nowhere to go must not
    // dress itself up as a control.
    expect(workspace).toContain("type Metric = { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone: string; section?: SectionId };");
    expect(workspace).toContain("{...(metric.section ? {");
    expect(workspace).toContain("onClick: () => goToSection(metric.section!)");
  });

  it('a clickable KPI is operable from the keyboard', () => {
    const at = workspace.indexOf('{...(metric.section ? {');
    const card = workspace.slice(at, at + 700);
    expect(card).toContain("role: 'button' as const");
    expect(card).toContain('tabIndex: 0');
    expect(card).toContain('onKeyDown');
  });

  it('every section a KPI points at is one the role actually renders', () => {
    // Same rule as the sidebar: a destination that does not exist for the role
    // is a click that does nothing.
    const named = [...workspace.matchAll(/section: '(role-[a-z]+)'/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(5);
    const everySection = new Set(Object.values(ROLE_SECTIONS).flat());
    for (const section of named) expect(everySection).toContain(section);
  });

  it('the quotation KPIs point at a surface for every role that reaches them', () => {
    // This replaces an assertion that engineer and architect must NOT point a
    // KPI at a quotations section. That was true only because they had no such
    // section, which was itself the defect - the number was real, the reader
    // could not act on it, and the bid it counted was invisible.
    //
    // The shared metrics branch serves contractor, engineer and architect. Now
    // that all three render the section, the conditional is gone and every one
    // of them must actually have it.
    expect(workspace).toContain("value: myQuotations.length, icon: FileText, tone: 'text-violet-600 bg-violet-50', section: 'role-quotations'");
    expect(workspace).not.toContain("? 'role-quotations' : undefined");
    for (const role of ['contractor', 'engineer', 'architect', 'supplier'] as const) {
      expect(ROLE_SECTIONS[role], `${role}'s quotation KPI must lead somewhere`).toContain('role-quotations');
    }
  });
});

describe('every business entity BuildHub stores is either openable or deliberately not', () => {
  // The list is the schema's, not a wish list. Where there is no detail page
  // the reason is recorded here rather than left as an unexplained gap.
  const ENTITIES: Array<{ name: string; route?: string; note?: string }> = [
    { name: 'vendor / supplier / any provider', route: '/vendor/:id' },
    { name: 'product', route: '/marketplace/products/:id' },
    { name: 'RFQ', route: '/rfq/:id' },
    { name: 'project', route: '/projects/:id' },
  ];

  it.each(ENTITIES.filter(e => e.route))('$name has a detail route', ({ route }) => {
    expect(routes).toContain(`path={"${route}"}`);
  });

  it('a conversation is addressable, so it can be linked to', () => {
    // Not a route of its own: /messages?to=<userId> selects the thread, which
    // is what makes "contact this vendor" possible at all.
    const messages = read('../client/src/pages/MessagesPage.tsx');
    expect(messages).toContain("new URLSearchParams(search).get('to')");
  });

  it('an RFQ row in the list opens the RFQ', () => {
    expect(rfqList).toContain('data-testid="rfq-open-detail"');
    expect(rfqList).toContain('href={`/rfq/${rfq.id}`}');
  });

  it('the RFQ card does not advertise itself as clickable when the CTA is what clicks', () => {
    // card-hover lifts the card on hover, which reads as "click me". The card
    // body is not a link - it contains its own links and buttons - so the
    // affordance belonged to the CTA, not the card.
    const at = rfqList.indexOf('{allRfqs.map(rfq => {');
    // Comments stripped: the assertion is about the className the browser
    // sees, and the note explaining WHY the class is gone naturally mentions
    // it by name.
    const card = rfqList.slice(at, at + 1200)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(card).toContain('<Card key={rfq.id}');
    expect(card).not.toContain('card-hover');
  });
});

describe('a control must not be hidden under the fixed navbar', () => {
  // The navbar is `fixed top-0 h-16`. RFQDetail's container used py-8 (32px),
  // so the top of the page - including its "All requests" back button - sat
  // UNDERNEATH it. elementFromPoint at the centre of that button returned the
  // navbar, not the button, and both a real click and Playwright's timed out.
  // A control that cannot be reached is dead however correct its handler is.
  const NAVBAR_HEIGHT_CLASS = 'h-16';
  const navbar = read('../client/src/components/Navbar.tsx');

  it('the navbar is still fixed and still that tall', () => {
    // If either changes, the clearance below has to be re-derived.
    expect(navbar).toContain('fixed top-0 inset-x-0 z-50');
    expect(navbar).toContain(NAVBAR_HEIGHT_CLASS);
  });

  it.each([
    ['RFQDetail', '../client/src/pages/RFQDetail.tsx'],
    ['RFQPage', '../client/src/pages/RFQPage.tsx'],
    ['ProjectDetail', '../client/src/pages/ProjectDetail.tsx'],
    ['VendorProfile', '../client/src/pages/VendorProfile.tsx'],
    ['AIAssistantPage', '../client/src/pages/AIAssistantPage.tsx'],
  ])('%s clears it, in EVERY state it renders', (_name, path) => {
    const source = read(path);
    // Anchored to the SHELL, not to "any container". Every one of these pages
    // renders <Navbar /> followed immediately by the page's top-level box, and
    // a page has several such states - loading, not-found, and the record
    // itself. The first version of this test looked only at the first one,
    // which on RFQDetail is the loading state and was already fine, so
    // reverting the real container to py-8 passed. Matching every <Navbar />
    // catches every state; anchoring to it skips the nested boxes inside,
    // which inherit their parent's clearance and need none of their own.
    const shells = [...source.matchAll(/<Navbar\s*\/>\s*(?:\{[^\n]*\n\s*)?<\w+[^>]*?className="([^"]*)"/g)].map(m => m[1]);
    expect(shells.length, 'no page shell found after <Navbar />').toBeGreaterThan(0);
    for (const cls of shells) {
      const top = cls.match(/\bp[ty]-(\d+)\b/);
      expect(top, `"${cls}" sits directly under the navbar and sets no top padding`).not.toBeNull();
      expect(
        Number(top![1]) * 4,
        `"${cls}" gives ${Number(top![1]) * 4}px of clearance under a 64px navbar`,
      ).toBeGreaterThanOrEqual(80);
    }
  });
});

describe('context travels with the click', () => {
  const projectDetail = read('../client/src/pages/ProjectDetail.tsx');
  const ai = read('../client/src/pages/AIAssistantPage.tsx');

  it('AI Help from a project names that project', () => {
    // It opened a bare /ai, so the assistant's project selector read "No
    // specific project" for someone who had clicked from a project page.
    // Confirmed in a browser before and after.
    expect(projectDetail).toContain('window.open(`/ai?project=${projectId}`');
  });

  it('the assistant honours it only for a project the account can already see', () => {
    // The id is a selector, not an authorization. It is applied only if it is
    // in the list the server already returned for this session.
    expect(ai).toContain("new URLSearchParams(search).get('project')");
    expect(ai).toContain('selectableProjects.some(project => String(project.id) === requestedProjectId)');
  });

  it('and it does not fight a choice the reader has made', () => {
    expect(ai).toContain("if (projectId !== 'none') return;");
  });
});

describe('a product names who sells it, and links there', () => {
  const productDetail = read('../client/src/pages/ProductDetail.tsx');
  const routers = read('./routers.ts');

  it('marketplace.get returns the supplier identity', () => {
    // The page invited buyers to "ask the supplier a question" and never said
    // who the supplier was; nothing on it led to the vendor's record or to the
    // rest of their catalogue.
    const at = routers.indexOf('  get: publicProcedure.input(z.object({ id: z.number() }))');
    expect(at).toBeGreaterThan(-1);
    const body = routers.slice(at, routers.indexOf('  myProducts:', at));
    expect(body).toContain('return { ...product, supplier };');
    expect(body).toContain('select({ id: users.id, name: users.name, verified: users.verified })');
  });

  it('and NOTHING more than the public directory already publishes', () => {
    // Name and verification only. Not email, not phone, not account state.
    const at = routers.indexOf('  get: publicProcedure.input(z.object({ id: z.number() }))');
    const body = routers.slice(at, routers.indexOf('  myProducts:', at));
    for (const forbidden of ['users.email', 'users.phone', 'users.accountStatus', 'users.openId', 'users.passwordHash']) {
      expect(body, `${forbidden} must not reach a public product response`).not.toContain(forbidden);
    }
  });

  it('the page renders it as a route to that vendor', () => {
    expect(productDetail).toContain('data-testid="product-supplier"');
    expect(productDetail).toContain('href={`/vendor/${product.supplier.id}`}');
  });

  it('and degrades honestly when a supplier row is missing', () => {
    // A product whose supplier account was removed must not render "undefined".
    expect(productDetail).toContain('{product.supplier && (');
    expect(productDetail).toContain("product.supplier.name ?? (lang === 'ar' ? 'مورد على BuildHub' : 'A BuildHub supplier')");
  });
});

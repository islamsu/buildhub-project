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
  it('the workspace tile opens the request it answers', () => {
    expect(workspace).toContain('data-testid="my-quotation"');
    // The HANDLER, not the file. Asserting the file merely contained the
    // navigate call let a mutation that replaced onClick with a no-op survive:
    // the identical call in onKeyDown kept the assertion true, so a tile that
    // was dead to the mouse and alive to the keyboard would have passed.
    const onClick = /onClick=\{\(\) => navigate\(`\/rfq\/\$\{quote\.rfqId\}`\)\}/;
    const onKeyDown = /onKeyDown=\{event => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\) navigate\(`\/rfq\/\$\{quote\.rfqId\}`\); \}\}/;
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

  it('BOTH roles that bid have somewhere to see their bids', () => {
    // The supplier dashboard carried a "My Quotations" count with no surface
    // anywhere behind it - the contractor was the only bidder whose responses
    // were rendered at all.
    expect(ROLE_SECTIONS.contractor).toContain('role-quotations');
    expect(ROLE_SECTIONS.supplier).toContain('role-quotations');
    expect(workspace.split('id="role-quotations"').length - 1).toBe(2);
  });

  it('and both render the same tiles from the same component', () => {
    // One implementation, so a fix to one is a fix to both.
    expect(workspace).toContain('function QuotationTiles(');
    expect(workspace.split('<QuotationTiles').length - 1).toBe(2);
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

  it('the roles with no quotations surface do not point a KPI at one', () => {
    // Engineer and architect bid through the same endpoint but have no
    // quotations card, so their My Quotations tile stays informational rather
    // than jumping somewhere unrelated.
    expect(ROLE_SECTIONS.engineer).not.toContain('role-quotations');
    expect(ROLE_SECTIONS.architect).not.toContain('role-quotations');
    expect(workspace).toContain("section: role === 'contractor' ? 'role-quotations' : undefined");
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

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

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const workspace = read('../client/src/pages/RolePlatform.tsx');
const rfqDetail = read('../client/src/pages/RFQDetail.tsx');
const rfqList = read('../client/src/pages/RFQPage.tsx');
const routes = read('../client/src/App.tsx');

describe('a submitted quotation is reachable', () => {
  it('the workspace tile opens the request it answers', () => {
    expect(workspace).toContain('data-testid="my-quotation"');
    expect(workspace).toContain('navigate(`/rfq/${quote.rfqId}`)');
  });

  it('and it is reachable by keyboard, not only by mouse', () => {
    const at = workspace.indexOf('data-testid="my-quotation"');
    const tile = workspace.slice(at - 200, at + 600);
    expect(tile).toContain('role="button"');
    expect(tile).toContain('tabIndex={0}');
    expect(tile).toContain('onKeyDown');
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

/**
 * ── THE NOTIFICATION CENTRE ───────────────────────────────────────────────
 *
 * Two defects, both found by reading the product rather than its labels:
 *
 *   THE BADGE WAS ALL-OR-NOTHING. `markAllRead` was the ONLY writer of
 *   `read: true` anywhere in the codebase, so somebody with forty unread who
 *   opened one had to clear every one of them or keep a number that no longer
 *   described what they had seen. It is the same defect messaging carried
 *   before MSG: a count that could only ever be wrong in one direction.
 *
 *   AND ONE NOTIFICATION POINTED AT A PAGE THAT DOES NOT EXIST. An admin
 *   handed a batch of enquiries was linked to `/admin/enquiries/assignee/<id>`,
 *   which matches no route - `/admin/:section/:record` is three segments and
 *   that is four - so the notification landed on "404 Page Not Found".
 *   Confirmed in a browser, not inferred from the route table.
 *
 * The second is a CLASS, not an instance: a `link` is written in one file and
 * resolved in another, and nothing connected them. The census below walks every
 * destination the server writes and requires a route that can serve it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const APP = read('../client/src/App.tsx');
const MESSAGES = readSourceForAssertions(read('../client/src/pages/MessagesPage.tsx'));
const ENQUIRIES = readSourceForAssertions(read('../client/src/components/AdminVendorEnquiries.tsx'));

function between(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `start marker is gone: ${startMarker}`).toBeGreaterThan(-1);
  const end = text.indexOf(endMarker, start);
  expect(end, `end marker is gone or above the start: ${endMarker}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Every route wouter is told about, as a segment pattern. */
function declaredRoutes(): string[][] {
  const found = [...APP.matchAll(/path=(?:\{)?"([^"]+)"(?:\})?/g)].map(match => match[1]);
  expect(found.length, 'no routes were found - the matcher stopped working').toBeGreaterThan(20);
  return found.map(route => route.split('/').filter(Boolean));
}

/** Every destination the server writes onto a notification. */
function writtenLinks(): string[] {
  const source = readSourceForAssertions(read('./routers.ts'))
    + readSourceForAssertions(read('./notifications.ts'));
  const templated = [...source.matchAll(/link: `([^`]+)`/g)].map(match => match[1]);
  const literal = [...source.matchAll(/link: '([^']+)'/g)].map(match => match[1]);
  return [...new Set([...templated, ...literal])];
}

/** Does any declared route serve this path? `${...}` stands for one segment. */
function servedBy(link: string, routes: string[][]): boolean {
  // A query string and a fragment are not part of the path.
  const path = link.split('?')[0].split('#')[0];
  const segments = path.split('/').filter(Boolean);
  return routes.some(route => {
    if (route.length !== segments.length) return false;
    return route.every((part, index) => part.startsWith(':') || part === segments[index]);
  });
}

describe('every destination a notification carries is a page that exists', () => {
  it('finds the routes and the links, so the census is not vacuous', () => {
    expect(declaredRoutes().length).toBeGreaterThan(20);
    expect(writtenLinks().length).toBeGreaterThan(15);
  });

  it('AND EVERY ONE OF THEM RESOLVES', () => {
    const routes = declaredRoutes();
    const dead = writtenLinks().filter(link => !servedBy(link, routes));
    expect(
      dead,
      'These are written onto notifications and match no route in App.tsx, so the '
      + 'recipient lands on 404. Point them at a real page, or add the route:\n  '
      + dead.join('\n  '),
    ).toEqual([]);
  });

  it('and the census can actually tell a dead link from a live one', () => {
    // An instrument that answers "all fine" to everything proves nothing. The
    // defect this was written for is the four-segment admin path.
    const routes = declaredRoutes();
    expect(servedBy('/admin/enquiries?assignee=5', routes)).toBe(true);
    expect(servedBy('/admin/enquiries/assignee/5', routes), 'the census no longer sees the original defect').toBe(false);
    expect(servedBy('/rfq/${input.rfqId}', routes)).toBe(true);
    expect(servedBy('/nowhere/at/all/deep', routes)).toBe(false);
  });

  it('the assignment notification points at the filtered queue', () => {
    expect(ROUTERS).toContain('/admin/enquiries?assignee=');
    expect(ROUTERS, 'the dead four-segment path is back').not.toContain('/admin/enquiries/assignee/');
  });
});

describe('a notification can be read one at a time', () => {
  const markRead = () => between(ROUTERS, 'markRead: protectedProcedure', 'markAllRead: protectedProcedure');

  it('and the receipt is the RECIPIENT to give', () => {
    // Constrained in the WHERE, not checked beforehand: an id belonging to
    // somebody else matches no row rather than reaching a different branch.
    const body = markRead();
    expect(body).toContain('eq(notifications.id, input.id)');
    expect(body).toContain('eq(notifications.userId, ctx.user.id)');
  });

  it('it reports whether it actually changed anything', () => {
    // "I marked it read" and "that one was not mine" have to stay
    // distinguishable, which is the flag removeMember was silently getting
    // wrong until _core/writeResult.ts existed.
    expect(markRead()).toContain('changed: changedSomething(result)');
  });

  it('and it only touches one that is still unread', () => {
    expect(markRead()).toContain('eq(notifications.read, false)');
  });

  it('THE SCREEN GIVES THE RECEIPT ON OPENING', () => {
    expect(MESSAGES).toContain('trpc.notifications.markRead.useMutation');
    expect(MESSAGES).toContain('markOneRead.mutate({ id: n.id })');
    // Whether or not it has somewhere to go: an informational notification is
    // just as read once somebody has clicked it.
    expect(MESSAGES).toMatch(/href=\{n\.link\}[^>]*onClick=\{open\}/);
    expect(MESSAGES).toMatch(/<div key=\{n\.id\} onClick=\{open\}/);
  });

  it('and the badge follows, rather than staying where it was', () => {
    const handler = between(MESSAGES, 'trpc.notifications.markRead.useMutation', 'const search');
    expect(handler).toContain('utils.notifications.unreadCount.invalidate()');
    expect(handler).toContain('utils.notifications.list.invalidate()');
  });

  it('re-reading something already read writes nothing', () => {
    expect(MESSAGES).toContain('if (!n.read) markOneRead.mutate');
  });
});

describe('a queue narrowed by a link says so', () => {
  it('the screen reads the assignee from the URL', () => {
    expect(ENQUIRIES).toContain("new URLSearchParams(queryString).get('assignee')");
    expect(ENQUIRIES).toContain('assigneeId: assigneeFilter');
  });

  it('and a non-numeric parameter is ignored rather than sent on', () => {
    expect(ENQUIRIES).toMatch(/\/\^\\d\+\$\/\.test\(assigneeParam\)/);
  });

  it('A SILENT FILTER IS NOT ACCEPTABLE — the reader can see it and turn it off', () => {
    // A list narrowed by a query parameter with nothing on screen to say so
    // reads as a quiet queue: the admin takes "4 enquiries" for the whole
    // board rather than their own share of it.
    expect(ENQUIRIES).toContain('data-testid="enquiry-assignee-chip"');
    expect(ENQUIRIES).toContain('data-testid="enquiry-assignee-clear"');
    const chip = between(ENQUIRIES, 'data-testid="enquiry-assignee-chip"', 'data-testid="enquiry-assignee-clear"');
    // Named, not numbered, when the name is known.
    expect(chip).toContain('admins.data');
    expect(chip).toMatch(/[؀-ۿ]/);
  });
});

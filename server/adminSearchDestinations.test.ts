// ── Every search result opens something that exists ────────────────────────
//
// A search that finds the record and then links nowhere is worse than one that
// does not find it: the administrator believes they have been shown the case.
// This file holds the console's destination map against two things it can
// drift from - the set of kinds the SERVER can emit, and the set of routes
// App.tsx actually REGISTERS.
//
// The destination map used to be a switch inside the search component that
// recovered a bid's request id with a regex over the hit's DISPLAY TEXT. That
// could not be tested without rendering the component, and re-wording one
// label would have unlinked every bid with nothing failing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEARCH_LINK_KINDS } from './admin/platformSearch';
import { SEARCH_LINK_ROUTE, searchHitHref } from '../client/src/lib/adminSearchDestinations';
import { ADMIN_SECTIONS } from '../client/src/lib/adminNavigation';

const APP = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');

/** Every path App.tsx registers, as wouter patterns. */
const REGISTERED = [...APP.matchAll(/<Route\s+path=\{?["'`]([^"'`]+)["'`]\}?/g)].map(m => m[1]);

/**
 * Does a concrete href REACH SOMETHING, not merely match a pattern?
 *
 * `/admin/:section` and `/admin/:section/:record` are catch-alls, so pattern
 * matching alone says yes to `/admin/dispute-cases/7` - which registers, then
 * renders the overview. A destination under /admin has to name a section the
 * console actually resolves. This distinction is not theoretical: the first
 * version of this file matched on patterns only, and a mutation that pointed
 * the dispute link at an invented section passed it.
 */
function isRegistered(href: string): boolean {
  const path = href.split('?')[0];
  const matchesPattern = REGISTERED.some(pattern => {
    const rx = new RegExp('^' + pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$');
    return rx.test(path);
  });
  if (!matchesPattern) return false;

  // A path served ONLY by the catch-alls must name a real section.
  const servedByNamedRoute = REGISTERED.some(pattern => {
    if (pattern.includes(':section')) return false;
    const rx = new RegExp('^' + pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '$');
    return rx.test(path);
  });
  if (servedByNamedRoute) return true;

  const section = path.split('/')[2] ?? '';
  return ADMIN_SECTIONS.includes(section);
}

describe('the route table this file reads is really the route table', () => {
  it('finds the routes App.tsx registers', () => {
    // POSITIVE CONTROL. Without it every assertion below passes on an empty
    // list, which is the failure mode this whole file exists to prevent.
    expect(REGISTERED.length).toBeGreaterThan(20);
    expect(REGISTERED).toContain('/admin/users/:id');
    expect(REGISTERED).toContain('/admin/:section/:record');
  });

  it('rejects a path nothing registers', () => {
    // NEGATIVE CONTROL for the matcher itself.
    expect(isRegistered('/definitely/not/a/route/at/all')).toBe(false);
  });

  it('rejects an /admin path whose section the console does not resolve', () => {
    // THE CONTROL THAT WAS MISSING. This matches `/admin/:section/:record`
    // and so "registers"; it resolves to the overview, which is a broken link
    // wearing a valid route's clothes.
    expect(isRegistered('/admin/dispute-cases/7')).toBe(false);
    expect(ADMIN_SECTIONS).toContain('disputes');
    expect(ADMIN_SECTIONS).not.toContain('dispute-cases');
  });
});

describe('every kind the server can emit has a destination', () => {
  it('the map covers the kinds exactly - no missing kind, no dead entry', () => {
    expect(Object.keys(SEARCH_LINK_ROUTE).sort()).toEqual([...SEARCH_LINK_KINDS].sort());
  });

  it('every destination is a route App.tsx registers', () => {
    for (const kind of SEARCH_LINK_KINDS) {
      const href = SEARCH_LINK_ROUTE[kind]('7');
      expect(isRegistered(href), `${kind} -> ${href}`).toBe(true);
    }
  });

  it('a reference with a slash or a space cannot escape its route', () => {
    // An enquiry is addressed by ENQ-<rfq>-<vendor>, which is derived rather
    // than stored - but the value still reaches a URL, and a reference that
    // was not encoded would silently become a different path.
    const href = SEARCH_LINK_ROUTE.enquiry('ENQ-1-2/../../admin/settings');
    expect(href).not.toContain('../');
    expect(href.split('/').length).toBe(4);
  });

  it('an unknown kind links nowhere rather than to a guess', () => {
    expect(searchHitHref({ kind: 'not-a-kind', key: '1' })).toBeNull();
    expect(searchHitHref(null)).toBeNull();
    expect(searchHitHref(undefined)).toBeNull();
  });
});

describe('the case destinations actually open the case', () => {
  const DISPUTES = readFileSync(new URL('../client/src/components/AdminDisputes.tsx', import.meta.url), 'utf8');
  const SUPPORT = readFileSync(new URL('../client/src/components/AdminSupportTickets.tsx', import.meta.url), 'utf8');
  const DASHBOARD = readFileSync(new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');

  it('both case queues accept the record in the path', () => {
    for (const [name, source] of [['disputes', DISPUTES], ['support', SUPPORT]] as const) {
      expect(source, name).toContain('openRecord');
      // Not merely accepted - acted on. A prop that is destructured and never
      // used is the exact shape of this bug.
      expect(source, name).toContain('setOpenId(parsed)');
    }
  });

  it('the console passes the record from the URL to both', () => {
    expect(DASHBOARD).toContain('<AdminDisputes openRecord={adminRecord} />');
    expect(DASHBOARD).toContain('<AdminSupportTickets openRecord={adminRecord} />');
  });

  it('search lives in Operations, and is not a second search box inside Disputes', () => {
    // It was rendered above the RFQ investigation, which has since grown its
    // own typeahead over the same procedure. Two search boxes over one
    // procedure is the duplication rule this codebase keeps.
    const operations = DASHBOARD.slice(DASHBOARD.indexOf('<TabsContent value="operations">'));
    expect(operations.slice(0, 900)).toContain('<AdminPlatformSearch />');
    const disputes = DASHBOARD.slice(DASHBOARD.indexOf('<TabsContent value="disputes">'));
    expect(disputes.slice(0, 400)).not.toContain('<AdminPlatformSearch />');
    expect((DASHBOARD.match(/<AdminPlatformSearch \/>/g) ?? []).length).toBe(1);
  });
});

/**
 * ── A QUEUE THAT IS COUNTED MUST BE A QUEUE THAT IS SHOWN ─────────────────
 *
 * adminAttention() computed a nameChanges count from the day it was written
 * and nothing rendered it. The number was correct, the query was real, and
 * no administrator could ever see it - so the queue was reported as missing.
 * A count with no surface is not a feature; it is dead code wearing one.
 *
 * This file holds the completeness invariant that stops it happening to the
 * next queue somebody adds:
 *
 *   every queue is rendered SOMEWHERE - a sidebar entry or a tab badge
 *   every badge opens a destination the console can actually resolve
 *   every badge says what it counts, in words, not just a number
 *   the sidebar map never points at a queue that does not exist
 *
 * WHAT THIS FILE DOES NOT CLAIM. It does not prove a badge renders, updates,
 * or clears - a structural check cannot, and pretending otherwise would be
 * the weaker assertion the owner warned about. That proof is in
 * evidence/zg-attention.mjs, which drives a real console: it seeds a pending
 * request, reads the rendered count in both places, opens the queue, decides
 * the request and watches both badges clear. This file only guarantees that
 * no queue is left without a place to appear at all.
 */
import { describe, expect, it } from 'vitest';
import { ATTENTION_QUEUES, ATTENTION_META } from './adminAttention';
import {
  ADMIN_ATTENTION_QUEUE,
  ADMIN_NAV,
  ADMIN_SECTIONS,
  ADMIN_SECTION_ALIASES,
} from '../client/src/lib/adminNavigation';
import { readFileSync } from 'node:fs';

const ADMIN_DASHBOARD = readFileSync(
  new URL('../client/src/pages/AdminDashboard.tsx', import.meta.url), 'utf8');

/** The queues the sidebar carries, as a set. */
const sidebarQueues = new Set(Object.values(ADMIN_ATTENTION_QUEUE));

/**
 * The queues carried by a tab badge instead of a sidebar entry. Read from the
 * console's own source by the testid the probe drives, so a tab that is
 * deleted stops counting here too.
 */
const tabQueues = new Set(
  [...ADMIN_DASHBOARD.matchAll(/data-testid="tab-attention-([A-Za-z]+)"/g)].map(m => m[1]),
);

/** `/admin/x?filter` -> `x`, resolved through the alias table. */
function sectionOf(href: string): string {
  const path = href.split('?')[0];
  const section = path.startsWith('/admin/') ? path.slice('/admin/'.length) : '';
  return ADMIN_SECTION_ALIASES[section] ?? section;
}

describe('every attention queue has somewhere to appear', () => {
  it.each(ATTENTION_QUEUES)('%s is rendered by the sidebar or by a tab', queue => {
    expect(sidebarQueues.has(queue) || tabQueues.has(queue)).toBe(true);
  });

  it('the name-change queue in particular is rendered in BOTH places', () => {
    // It is a tab inside User Management: the sidebar makes it findable, the
    // tab makes the badge land on the work. Losing either reintroduces the
    // original complaint.
    expect(sidebarQueues.has('nameChanges')).toBe(true);
    expect(tabQueues.has('nameChanges')).toBe(true);
  });

  it('the sidebar never badges a queue the server does not compute', () => {
    for (const queue of Object.values(ADMIN_ATTENTION_QUEUE)) {
      expect(ATTENTION_QUEUES as readonly string[]).toContain(queue);
    }
  });

  it('every path the sidebar badges is a real menu destination', () => {
    const paths = new Set(ADMIN_NAV.map(entry => entry.path));
    for (const path of Object.keys(ADMIN_ATTENTION_QUEUE)) {
      expect(paths).toContain(path);
    }
  });
});

describe('every attention badge can be acted on', () => {
  it.each(ATTENTION_QUEUES)('%s points at a section the console resolves', queue => {
    const section = sectionOf(ATTENTION_META[queue].href);
    expect(ADMIN_SECTIONS).toContain(section);
  });

  it.each(ATTENTION_QUEUES)('%s says what it is counting, in words', queue => {
    const meaning = ATTENTION_META[queue].meaning;
    // Not a label, not a queue name repeated back - a sentence about state.
    expect(meaning.length).toBeGreaterThan(15);
    expect(meaning).toMatch(/ /);
    expect(meaning).not.toBe(queue);
  });
});

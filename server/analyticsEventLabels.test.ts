/**
 * ── NO ANALYTICS EVENT MAY SHIP WITHOUT A NAME ─────────────────────────
 *
 * The Insights page rendered `row.eventType` raw, so an administrator read
 * badges saying `user.signed_in` and `subscription.payment_failed` - dotted
 * identifiers from the event store (§55, §72), in English whatever the
 * reader's language (§67). Found by the visual-QA sweep, not by reading the
 * component, where `{row.eventType}` looks entirely ordinary.
 *
 * This file exists so the fix cannot rot: a new event is one line in
 * `ANALYTICS_EVENTS`, and without an exhaustiveness check that line silently
 * puts an identifier back on an operator's screen.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyticsEventLabel, labelledAnalyticsEvents } from '../shared/analyticsEventLabels';
import { ANALYTICS_EVENT_TYPES } from '../shared/analyticsEvents';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

describe('every analytics event has a name in both languages', () => {
  it('EXHAUSTIVE: no event type is missing a label', () => {
    const missing = ANALYTICS_EVENT_TYPES.filter(type => analyticsEventLabel(type, 'en') === null);
    expect(missing, 'a new event would render as a raw dotted identifier').toEqual([]);
  });

  it('and no label names an event that does not exist', () => {
    const orphans = labelledAnalyticsEvents()
      .filter(type => !(ANALYTICS_EVENT_TYPES as readonly string[]).includes(type));
    expect(orphans, 'a label names an event that no longer exists').toEqual([]);
  });

  it('the Arabic side is genuinely Arabic', () => {
    const arabic = (value: string) => Array.from(value)
      .some(ch => (ch.codePointAt(0) ?? 0) >= 0x0600 && (ch.codePointAt(0) ?? 0) <= 0x06ff);
    for (const type of ANALYTICS_EVENT_TYPES) {
      const label = analyticsEventLabel(type, 'ar');
      expect(label, `${type} has no Arabic label`).not.toBeNull();
      expect(arabic(label!), `${type} is not translated`).toBe(true);
    }
  });

  it('and no label leaks the identifier or a dotted token', () => {
    for (const type of ANALYTICS_EVENT_TYPES) {
      for (const lang of ['en', 'ar'] as const) {
        const label = analyticsEventLabel(type, lang)!;
        expect(label, `${type}/${lang}`).not.toContain(type);
        expect(label, `${type}/${lang} looks like an identifier`).not.toMatch(/[a-z]+\.[a-z_]+/);
        expect(label, `${type}/${lang} contains an underscore`).not.toMatch(/_/);
      }
    }
  });

  it('an unknown event returns NULL rather than the identifier', () => {
    expect(analyticsEventLabel('not.a.real_event', 'en')).toBeNull();
  });

  it('and the Insights surface goes through the label function', () => {
    const surface = src('client/src/components/AdminCommercialAnalytics.tsx');
    expect(surface).toContain('analyticsEventLabel');
    // The exact spelling that was on screen.
    expect(surface, 'the raw event type is still rendered')
      .not.toMatch(/^\s*\{row\.eventType\}\s*$/m);
  });
});

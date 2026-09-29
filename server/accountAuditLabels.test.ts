/**
 * ── NO AUDIT EVENT MAY SHIP WITHOUT A NAME ─────────────────────────────
 *
 * The audit trail rendered `row.action` raw, so an administrator read
 * `admin_password_reset_requested` in a badge and the filter dropdown
 * offered the same snake_case as its option labels. §55 and §72 forbid raw
 * enums and database terminology in user-facing text; §67 adds that an
 * English identifier is no better on an Arabic screen.
 *
 * Found by the visual-QA sweep, which reported `signed_in` as a raw token on
 * `/admin/analytics` - not by reading the component, where `{row.action}`
 * looks entirely ordinary.
 *
 * THE POINT OF THIS FILE is that the fix cannot rot. A new audit action is a
 * one-line addition to `ACCOUNT_AUDIT_ACTIONS`, and without this test that
 * one line silently puts snake_case back on an operator's screen.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountAuditActionLabel, labelledAuditActions } from '../shared/accountAuditLabels';
import { ACCOUNT_AUDIT_ACTIONS } from './_core/accountAudit';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = (relative: string) => readSourceForAssertions(readFileSync(join(ROOT, relative), 'utf8'));

describe('every audit action has a name in both languages', () => {
  it('EXHAUSTIVE: no action is missing a label', () => {
    const missing = ACCOUNT_AUDIT_ACTIONS.filter(
      action => accountAuditActionLabel(action, 'en') === null,
    );
    expect(missing, 'a new audit action would render as raw snake_case').toEqual([]);
  });

  it('and no label exists for an action that does not', () => {
    // A stale label is not harmful, but it means the list has drifted - and a
    // drifted list is one that stops being read as authoritative.
    const orphans = labelledAuditActions()
      .filter(action => !(ACCOUNT_AUDIT_ACTIONS as readonly string[]).includes(action));
    expect(orphans, 'a label names an action that no longer exists').toEqual([]);
  });

  it('every label is in Arabic on the Arabic side', () => {
    const arabic = (value: string) => Array.from(value)
      .some(ch => (ch.codePointAt(0) ?? 0) >= 0x0600 && (ch.codePointAt(0) ?? 0) <= 0x06ff);
    for (const action of ACCOUNT_AUDIT_ACTIONS) {
      const label = accountAuditActionLabel(action, 'ar');
      expect(label, `${action} has no Arabic label`).not.toBeNull();
      expect(arabic(label!), `${action} is not translated`).toBe(true);
    }
  });

  it('and no label leaks the identifier it replaces', () => {
    // "Signed in (admin_signed_in)" would satisfy a naive check while still
    // showing the operator the enum.
    for (const action of ACCOUNT_AUDIT_ACTIONS) {
      for (const lang of ['en', 'ar'] as const) {
        expect(accountAuditActionLabel(action, lang), `${action}/${lang}`).not.toContain(action);
        expect(accountAuditActionLabel(action, lang), `${action}/${lang} contains an underscore`)
          .not.toMatch(/_/);
      }
    }
  });

  it('an unknown action returns NULL rather than the raw identifier', () => {
    /*
     * The fallback is the caller's decision, made visibly. A helper that
     * silently returned the identifier would put snake_case back on the
     * screen with nothing failing.
     */
    expect(accountAuditActionLabel('not_a_real_action', 'en')).toBeNull();
    expect(accountAuditActionLabel('', 'ar')).toBeNull();
  });
});

describe('no Admin surface renders a raw action any more', () => {
  const SURFACES = [
    'client/src/components/AdminAuditTrail.tsx',
    'client/src/components/AdminRfqInvestigation.tsx',
    'client/src/components/AdminVendorBilling.tsx',
  ];

  it('each one goes through the label function', () => {
    for (const surface of SURFACES) {
      expect(src(surface), `${surface} does not label its actions`)
        .toContain('accountAuditActionLabel');
    }
  });

  it('and none prints the raw property', () => {
    // `{row.action}` and `{event.action}` are the exact spellings that were
    // on screen.
    for (const surface of SURFACES) {
      const code = src(surface);
      expect(code, `${surface} still renders a raw action`).not.toMatch(/\{row\.action\}/);
      expect(code, `${surface} still renders a raw action`).not.toMatch(/\{event\.action\}/);
    }
  });

  it('including the filter dropdown, which offered snake_case as its options', () => {
    expect(src('client/src/components/AdminAuditTrail.tsx'))
      .not.toMatch(/value=\{action\}>\{action\}</);
  });
});

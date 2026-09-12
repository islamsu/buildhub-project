import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ACCOUNT_AUDIT_ACTIONS,
  ACCOUNT_AUDIT_SOURCES,
  MAX_ACCOUNT_AUDIT_NOTE,
  recordAccountEvent,
} from './_core/accountAudit';

/**
 * THE ACCOUNT AUDIT TRAIL HAS ONE WRITER, AND THIS IS WHAT KEEPS IT THAT WAY.
 *
 * `db.insert(userAccountAuditEvents).values({...})` was hand-rolled at
 * FORTY-SIX call sites while its sibling `commercialAuditEvents` had a single
 * helper. With no shared entry point, every new privileged action has to
 * remember to write its own row, in the right shape, with an action name
 * nothing checks - and nothing structurally notices when one forgets.
 */

const SERVER_DIR = new URL('.', import.meta.url);

/** Every server source file, excluding tests and the helper itself. */
function serverSources(dir = SERVER_DIR, found: { path: string; text: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) { serverSources(child, found); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    if (entry.name === 'accountAudit.ts') continue;
    found.push({ path: child.pathname, text: readFileSync(child, 'utf8') });
  }
  return found;
}

describe('the sweep found real files - otherwise the rule below is vacuous', () => {
  it('reads the server sources', () => {
    const sources = serverSources();
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.some(file => file.path.endsWith('/routers.ts'))).toBe(true);
  });
});

describe('nothing writes the account audit trail directly', () => {
  it('every insert goes through recordAccountEvent', () => {
    const offenders = serverSources()
      .filter(file => /\.insert\(\s*userAccountAuditEvents\s*\)/.test(file.text))
      .map(file => file.path.replace(/.*\/server\//, 'server/'));
    expect(
      offenders,
      `these write the audit trail directly instead of calling recordAccountEvent: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('and the helper is actually used, not merely available', () => {
    const users = serverSources().filter(file => file.text.includes('recordAccountEvent('));
    expect(users.length).toBeGreaterThanOrEqual(4);
    const paths = users.map(file => file.path.replace(/.*\/server\//, 'server/'));
    for (const expected of ['server/routers.ts', 'server/db.ts', 'server/adminBootstrap.ts', 'server/referralEngine.ts']) {
      expect(paths).toContain(expected);
    }
  });
});

describe('the action vocabulary is closed', () => {
  it('names every action the product records', () => {
    // 50+ actions across account lifecycle, authentication, administrator
    // authority, QA personas, entitlements, referral and vendor identity.
    expect(ACCOUNT_AUDIT_ACTIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('has no duplicates - a repeated action is a merge accident', () => {
    expect(new Set(ACCOUNT_AUDIT_ACTIONS).size).toBe(ACCOUNT_AUDIT_ACTIONS.length);
  });

  it('every action is lower_snake_case, so the trail is greppable', () => {
    for (const action of ACCOUNT_AUDIT_ACTIONS) {
      expect(action, `${action} is not lower_snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('fits the column, which is varchar(80)', () => {
    for (const action of ACCOUNT_AUDIT_ACTIONS) {
      expect(action.length, `${action} is too long for the column`).toBeLessThanOrEqual(80);
    }
    for (const source of ACCOUNT_AUDIT_SOURCES) {
      expect(source.length, `${source} is too long for the column`).toBeLessThanOrEqual(40);
    }
  });

  it('covers the privileged actions that most need a trail', () => {
    // Named individually as well as counted: these are the ones somebody asks
    // about after an incident.
    for (const critical of [
      'admin_created', 'admin_role_changed', 'admin_sessions_revoked',
      'admin_password_changed', 'admin_invitation_revoked', 'super_admin_bootstrapped',
      'account_frozen', 'account_unfrozen', 'plan_changed_manually',
    ]) {
      expect(ACCOUNT_AUDIT_ACTIONS).toContain(critical);
    }
  });
});

describe('recordAccountEvent writes what it was given', () => {
  const capture = () => {
    const values = vi.fn().mockResolvedValue(undefined);
    return { db: { insert: vi.fn(() => ({ values })) }, values };
  };

  it('passes the event through to the table', async () => {
    const { db, values } = capture();
    await recordAccountEvent(db, {
      userId: 7, actorId: 3, action: 'admin_role_changed',
      source: 'admin_management', note: 'SUPPORT_ADMIN -> BILLING_ADMIN',
    });
    expect(values).toHaveBeenCalledWith({
      userId: 7, actorId: 3, action: 'admin_role_changed',
      source: 'admin_management', note: 'SUPPORT_ADMIN -> BILLING_ADMIN',
    });
  });

  it('records a null actor as null, never as a string', async () => {
    // "system did this" and "we do not know who did this" must not collapse
    // into the same row.
    const { db, values } = capture();
    await recordAccountEvent(db, { userId: 1, actorId: null, action: 'referral_reward_granted' });
    expect(values.mock.calls[0][0].actorId).toBeNull();
  });

  it('truncates a long note rather than storing it whole', async () => {
    const { db, values } = capture();
    await recordAccountEvent(db, {
      userId: 1, actorId: 1, action: 'admin_user_updated',
      note: 'x'.repeat(MAX_ACCOUNT_AUDIT_NOTE + 500),
    });
    expect(values.mock.calls[0][0].note).toHaveLength(MAX_ACCOUNT_AUDIT_NOTE);
  });

  it('normalises a missing note and source to null, not undefined', async () => {
    const { db, values } = capture();
    await recordAccountEvent(db, { userId: 1, actorId: 1, action: 'password_signed_in' });
    expect(values.mock.calls[0][0].note).toBeNull();
    expect(values.mock.calls[0][0].source).toBeNull();
  });

  it('THROWS when the write fails, unlike the commercial audit helper', async () => {
    // The deliberate difference. These rows record who created an
    // administrator, who changed a role, who revoked whose sessions. For a
    // privileged action, "it happened but we failed to record who did it" is
    // not a degraded success - it is the outcome an attacker wants. The 46
    // call sites already awaited the insert and so already failed the mutation
    // on a write failure; preserving that is the safer posture.
    const db = { insert: () => ({ values: () => Promise.reject(new Error('audit table unavailable')) }) };
    await expect(recordAccountEvent(db, { userId: 1, actorId: 1, action: 'admin_created' }))
      .rejects.toThrow('audit table unavailable');
  });
});

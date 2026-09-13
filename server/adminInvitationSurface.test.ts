import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { ADMIN_PASSWORD_MIN_LENGTH } from '@shared/adminRoles';

/**
 * THREE ADMINISTRATOR CAPABILITIES EXISTED AND COULD NOT BE REACHED.
 *
 *   admin.adminInvitations      list the links issued for an account
 *   admin.revokeAdminInvitation kill one before it is redeemed
 *   admin.changeOwnPassword     rotate your own password
 *
 * All three were implemented, tested server-side, and called by nothing. The
 * consequence was concrete: an invitation or reset link sent to the wrong
 * address could not be cancelled from anywhere in the product - the only thing
 * that ended it was its own expiry - and an administrator who suspected their
 * password was known could not change it without another Super Admin issuing
 * them a reset link.
 *
 * This file guards the wiring. It reads the page for the CALLS, because
 * whether a procedure is invoked is a fact about the source, and it checks the
 * shared password rule by value rather than by text.
 */

const PAGE = readSourceForAssertions(
  readFileSync(new URL('../client/src/pages/AdminAdmins.tsx', import.meta.url), 'utf8'),
);
const ROUTERS = readSourceForAssertions(
  readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'),
);

describe('the page was read - otherwise every check below is vacuous', () => {
  it('is the administrator console', () => {
    expect(PAGE.length).toBeGreaterThan(2000);
    expect(PAGE).toContain('trpc.admin.admins.useQuery');
  });
});

describe('the dead administrator procedures are wired to controls', () => {
  it.each([
    ['admin.adminInvitations', 'trpc.admin.adminInvitations.useQuery'],
    ['admin.revokeAdminInvitation', 'trpc.admin.revokeAdminInvitation.useMutation'],
    ['admin.changeOwnPassword', 'trpc.admin.changeOwnPassword.useMutation'],
  ])('%s is called by the console', (_procedure, call) => {
    expect(PAGE).toContain(call);
  });

  it('every one of them still exists on the server as a Super-Admin-only procedure', () => {
    // The mirror direction: wiring a call to a procedure that has been
    // renamed or downgraded would leave this file green and the screen broken.
    expect(ROUTERS).toContain('adminInvitations: superAdminProcedure');
    expect(ROUTERS).toContain('revokeAdminInvitation: superAdminProcedure');
    // changeOwnPassword is deliberately adminProcedure, not superAdmin: every
    // administrator may change their OWN password and nobody else's.
    expect(ROUTERS).toContain('changeOwnPassword: adminProcedure');
  });

  it('offers a revoke control and a way to open the link list', () => {
    expect(PAGE).toContain('data-testid={`admin-links-${admin.id}`}');
    expect(PAGE).toContain('data-testid={`admin-revoke-link-${row.id}`}');
    expect(PAGE).toContain('data-testid="admin-change-own-password"');
  });
});

describe('a link list distinguishes not-loaded, failed, and genuinely empty', () => {
  it('renders a distinct error state rather than reporting an empty list', () => {
    // Saying "no links have been issued" when the read FAILED is a false
    // statement about the account, and it is the exact shape of bug this
    // codebase has hit before.
    expect(PAGE).toContain('invitationsFailed');
    expect(PAGE).toContain('data-testid="admin-links-error"');
    expect(PAGE).toContain('data-testid="admin-links-empty"');
  });
});

describe('an invitation state is derived, never a second stored truth', () => {
  it('derives used / revoked / expired / live from the row own timestamps', () => {
    expect(PAGE).toContain('const linkState =');
    expect(PAGE).toContain("if (row.usedAt) return 'used'");
    expect(PAGE).toContain("if (row.revokedAt) return 'revoked'");
    expect(PAGE).toContain("return 'expired'");
  });

  it('offers Revoke only for a live link', () => {
    // The server refuses a used one, so a button that always fails would be
    // worse than no button.
    expect(PAGE).toContain("state === 'live' ? (");
    expect(ROUTERS).toContain("if (row.usedAt) throw new TRPCError({ code: 'BAD_REQUEST'");
  });
});

describe('the administrator password minimum has ONE definition', () => {
  it('is a real number, shared rather than copied', () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('is longer than an ordinary account password minimum', () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBeGreaterThan(8);
  });

  it('is not re-declared anywhere - the drift guard', () => {
    // It used to be a server-local const with the invitation screen carrying
    // its own copy under the comment "Matches ADMIN_PASSWORD_MIN_LENGTH on the
    // server", which is a comment doing a compiler's job. A third copy was
    // about to be written for the change-password form.
    const invitation = readSourceForAssertions(
      readFileSync(new URL('../client/src/pages/AdminAcceptInvitation.tsx', import.meta.url), 'utf8'),
    );
    for (const [name, source] of [['routers.ts', ROUTERS], ['AdminAdmins.tsx', PAGE], ['AdminAcceptInvitation.tsx', invitation]] as const) {
      expect(source, `${name} re-declares the minimum instead of importing it`)
        .not.toMatch(/const\s+ADMIN_PASSWORD_MIN_LENGTH\s*=/);
      expect(source, `${name} hardcodes the number instead of importing it`)
        .not.toMatch(/const\s+MIN_LENGTH\s*=\s*\d/);
    }
  });

  it('the change-password form enforces the shared minimum, not a literal', () => {
    expect(PAGE).toContain('passwordForm.newPassword.length < ADMIN_PASSWORD_MIN_LENGTH');
  });

  it('and requires the current password, so a borrowed session cannot lock the owner out', () => {
    expect(PAGE).toContain('passwordForm.currentPassword.length < 1');
    expect(ROUTERS).toContain('currentPassword: z.string().min(1).max(128)');
  });

  it('and requires the new password twice, so a typo does not become the password', () => {
    expect(PAGE).toContain('passwordForm.newPassword !== passwordForm.confirm');
  });
});

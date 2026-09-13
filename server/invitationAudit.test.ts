import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  getDb: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByUsername: vi.fn(),
  normalizeEmail: (value: string | null | undefined) => value?.trim().toLowerCase() || null,
  normalizeUsername: (value: string | null | undefined) => value?.trim().toLowerCase() || null,
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb, getUserByEmail, getUserByUsername } from './db';

function makeAdminCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: 'admin-1',
      email: 'admin@buildhub.com',
      name: 'BuildHub Admin',
      loginMethod: 'test',
      role: 'admin',
      adminRole: 'SUPER_ADMIN', // migration 0020: an admin row must now say WHICH administrator it is
      userRole: 'admin',
      accountStatus: 'active',
      isDummy: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

describe('invitation and audit PDF export features', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generates an expiring invitation link upon admin user creation', async () => {
    (getUserByUsername as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockResolvedValueOnce([{ insertId: 77 }]).mockResolvedValueOnce([]);
    const db = { insert: vi.fn().mockReturnValue({ values: valuesMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeAdminCtx());
    const res = await caller.admin.createUser({
      username: 'architect.lead',
      email: 'architect@lead.com',
      name: 'Lead Architect',
      userRole: 'architect',
      sendInvitation: true,
    });

    expect(res.success).toBe(true);
    expect(res.invitationLink).toMatch(/\/auth\/setup-password\?token=/);
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ invitationStatus: 'invitation_sent', invitationToken: expect.any(String) }));
  });

  it('completes password setup with a valid invitation token', async () => {
    const targetUser = { id: 77, invitationToken: 'valid-token-123', invitationExpiresAt: new Date(Date.now() + 3600000), invitationStatus: 'invitation_sent', username: 'architect.lead' };
    const selectWhere = vi.fn().mockResolvedValue([targetUser]);
    const updateWhere = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeAdminCtx());
    const res = await caller.admin.completeInvitation({ token: 'valid-token-123', password: 'SecurePassword123' });
    expect(res).toEqual({ success: true, username: 'architect.lead' });
    expect(updateWhere).toHaveBeenCalled();
  });

  it('rejects expired invitation tokens', async () => {
    const expiredUser = { id: 78, invitationToken: 'expired-token', invitationExpiresAt: new Date(Date.now() - 3600000), invitationStatus: 'invitation_sent', username: 'expired.user' };
    const selectWhere = vi.fn().mockResolvedValue([expiredUser]);
    const updateWhere = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.completeInvitation({ token: 'expired-token', password: 'Password123' })).rejects.toThrow('expired');
  });

  it('generates a full audit report for PDF export including account types and invitation statuses', async () => {
    /**
     * THE SHAPE CHANGED, THE RULE DID NOT.
     *
     * This doubled the old implementation: one query for the events, a second
     * that returned EVERY user row so the report could build a lookup map. The
     * report is now paged and LEFT JOINs the six subject columns it needs, so
     * the double models a count query and a rows query instead.
     *
     * The assertions are unchanged and one is added - the real total, which the
     * old report never sent and which is the number that tells an administrator
     * whether they are looking at all of it.
     */
    const joined = [{
      id: 1, action: 'admin_created_account_with_invite', source: 'admin_created',
      note: null, createdAt: new Date(),
      userId: 77, userName: 'Lead Architect', userEmail: 'architect@lead.com',
      actorId: 1, actorName: 'Super Admin', actorEmail: 'admin@buildhub.test',
      subjectIsDummy: false, subjectAccountSource: 'admin_created',
      subjectUserRole: 'architect', subjectRole: 'user',
      subjectAccountStatus: 'active', subjectInvitationStatus: 'invitation_sent',
    }];
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        const isCount = selectCount === 1;
        const chain: any = {
          leftJoin: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn().mockResolvedValue(joined),
          then: (ok: any, err: any) =>
            Promise.resolve(isCount ? [{ count: 1 }] : joined).then(ok, err),
        };
        return { from: vi.fn(() => chain) };
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeAdminCtx());
    const report = await caller.admin.fullAuditReport();
    expect(report.rows).toHaveLength(1);
    // THE REAL TOTAL, which the truncating version never sent.
    expect(report.total).toBe(1);
    expect(report.rows[0]).toEqual(expect.objectContaining({
      userName: 'Lead Architect',
      accountType: 'Admin Created',
      role: 'architect',
      invitationStatus: 'invitation_sent',
      // An event with an actor names the person, never a bare id.
      actorName: 'Super Admin',
    }));
  });
});

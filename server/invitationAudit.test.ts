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
    const auditEvents = [{ id: 1, userId: 77, actorId: 1, action: 'admin_created_account_with_invite', source: 'admin_created', note: null, createdAt: new Date() }];
    const usersList = [{ id: 77, name: 'Lead Architect', email: 'architect@lead.com', isDummy: false, accountSource: 'admin_created', userRole: 'architect', accountStatus: 'active', invitationStatus: 'invitation_sent' }];
    let selectCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return { from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(auditEvents) }) }) };
        }
        return { from: vi.fn().mockResolvedValue(usersList) };
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);

    const caller = appRouter.createCaller(makeAdminCtx());
    const report = await caller.admin.fullAuditReport();
    expect(report).toHaveLength(1);
    expect(report[0]).toEqual(expect.objectContaining({
      userName: 'Lead Architect',
      accountType: 'Admin Created',
      role: 'architect',
      invitationStatus: 'invitation_sent',
    }));
  });
});

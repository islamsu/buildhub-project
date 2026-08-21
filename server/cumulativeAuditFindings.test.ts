import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';

// Phase 4A cumulative final audit: a source sweep for `select().from(users)`
// found two admin-only endpoints (admin.complianceQueue, admin.complianceApplicant)
// that were doing a bare full-row select and spreading it (including passwordHash
// and the live invitationToken bearer credential) directly into the Admin
// Dashboard's Compliance Queue / Applicant Detail response - the same exposure
// class Phase 4A.6.7 already closed for admin.users, just missed on these two
// sibling endpoints. Fixed with the same explicit-allowlist pattern
// (COMPLIANCE_APPLICANT_COLUMNS in server/routers.ts). These tests lock the fix in.
function makeAdminCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: 'admin-1',
      email: 'admin@test.com',
      name: 'Admin',
      loginMethod: 'manus',
      role: 'admin',
      userRole: 'homeowner',
      accountStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

describe('admin.complianceQueue - no full-row exposure (Phase 4A cumulative audit fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never issues a bare select().from(users) - uses an explicit column allowlist', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('complianceQueue: adminProcedure'), source.indexOf('complianceApplicant: adminProcedure'));
    expect(block).not.toMatch(/select\(\)\.from\(users\)/);
    expect(block).toContain('COMPLIANCE_APPLICANT_COLUMNS');
  });

  it('passwordHash and invitationToken are absent from the allowlist definition', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('const COMPLIANCE_APPLICANT_COLUMNS'), source.indexOf('const adminRouter = router({'));
    expect(block).not.toContain('passwordHash');
    expect(block).not.toContain('invitationToken');
  });

  it('calls select() with the explicit COMPLIANCE_APPLICANT_COLUMNS object (a real projection at the SQL level), not an empty select() that would return every column', async () => {
    const fromMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]), orderBy: vi.fn().mockResolvedValue([]) });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: selectMock });
    const caller = appRouter.createCaller(makeAdminCtx());

    await caller.admin.complianceQueue({ includeDummy: true });

    // First select() call is the users query - confirm it received an explicit
    // column-allowlist object (not undefined, which would mean "every column").
    const firstCallColumns = selectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCallColumns).toBeTruthy();
    expect(firstCallColumns).not.toHaveProperty('passwordHash');
    expect(firstCallColumns).not.toHaveProperty('invitationToken');
    expect(Object.keys(firstCallColumns).sort()).toEqual(
      ['createdAt', 'email', 'id', 'isDummy', 'name', 'onboardingReviewNotes', 'onboardingReviewedAt', 'onboardingStatus', 'userRole'].sort()
    );
  });
});

describe('admin.complianceApplicant - no full-row exposure (Phase 4A cumulative audit fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never issues a bare select().from(users) - uses an explicit column allowlist', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('complianceApplicant: adminProcedure'), source.indexOf('reviewComplianceDocument: adminProcedure'));
    expect(block).not.toMatch(/select\(\)\.from\(users\)/);
    expect(block).toContain('COMPLIANCE_APPLICANT_COLUMNS');
  });

  it('calls select() with the explicit COMPLIANCE_APPLICANT_COLUMNS object for the applicant lookup', async () => {
    // A trimmed row shaped exactly like a real COMPLIANCE_APPLICANT_COLUMNS
    // projection would return - proves the rest of the handler (requirements/
    // documents/history/events assembly) works correctly with the narrowed shape.
    const trimmedApplicant = { id: 20, name: 'Applicant User', email: 'applicant@example.com', userRole: 'contractor', onboardingStatus: 'under_review', onboardingReviewNotes: null, onboardingReviewedAt: null, isDummy: false, createdAt: new Date('2025-01-01') };
    const usersSelect = { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([trimmedApplicant]) }) };
    const emptyListSelect = { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) };
    let callCount = 0;
    const selectMock = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? usersSelect : emptyListSelect;
    });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({ select: selectMock });
    const caller = appRouter.createCaller(makeAdminCtx());

    const result = await caller.admin.complianceApplicant({ userId: 20 });
    const json = JSON.stringify(result);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('invitationToken');
    expect(result.applicant.id).toBe(20);

    const firstCallColumns = selectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCallColumns).not.toHaveProperty('passwordHash');
    expect(firstCallColumns).not.toHaveProperty('invitationToken');
  });

  it('an unauthenticated caller is rejected', async () => {
    const anonCtx: TrpcContext = { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] };
    const caller = appRouter.createCaller(anonCtx);
    await expect(caller.admin.complianceApplicant({ userId: 20 })).rejects.toThrow();
  });
});

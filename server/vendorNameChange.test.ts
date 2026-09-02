import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { vendorNameChangeRequests } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

function makeCtx(userId: number, role: 'user' | 'admin' = 'user', userRole = 'homeowner'): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      loginMethod: 'manus',
      role,
      adminRole: role === 'admin' ? 'SUPER_ADMIN' : null,
      userRole,
      accountStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return { user: null, req: { protocol: 'https', headers: {} } as TrpcContext['req'], res: {} as TrpcContext['res'] };
}

describe('vendor name change workflow', () => {
  it('defines one auditable request table for vendor and admin corrections', () => {
    expect(vendorNameChangeRequests).toBeTruthy();
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain('requestVendorNameChange: approvedProviderProcedure');
    expect(source).toContain('directVendorNameCorrection: adminWith(');
    expect(source).toContain('adminCorrection: true');
  });

  it('rejects a homeowner from requesting a vendor name change', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'homeowner'));
    await expect(caller.profile.requestVendorNameChange({
      field: 'companyName',
      requestedValue: 'New Company',
    })).rejects.toThrow();
  });

  it('rejects a non-admin from the admin name-change queue', async () => {
    const caller = appRouter.createCaller(makeCtx(2, 'user', 'supplier'));
    await expect(caller.admin.vendorNameChanges()).rejects.toThrow();
  });

  it('rejects an unauthenticated admin correction caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.admin.directVendorNameCorrection({
      userId: 3,
      field: 'companyName',
      requestedValue: 'Corrected Co',
      reason: 'Typo correction',
    })).rejects.toThrow();
  });
});

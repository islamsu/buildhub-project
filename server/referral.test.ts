import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { referrals } from '../drizzle/schema';
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

describe('referral foundation', () => {
  it('defines a referrals ledger and accepts referralCode on signup', () => {
    expect(referrals).toBeTruthy();
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain('referralCode: z.string().trim().min(4).max(32).optional()');
    expect(source).toContain('myReferral: protectedProcedure.query');
    expect(source).toContain('referrals: adminWith(');
  });

  it('requires authentication for myReferral', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.profile.myReferral()).rejects.toThrow();
  });

  it('denies a non-admin from the admin referral list', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'supplier'));
    await expect(caller.admin.referrals()).rejects.toThrow();
  });

  it('provides campaign/reward/qualification/reversal procedures', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain("referralCampaigns: adminWith('marketplace.manage')");
    expect(source).toContain("createReferralCampaign: adminWith('marketplace.manage')");
    expect(source).toContain("qualifyReferral: adminWith('marketplace.manage')");
    expect(source).toContain("reverseReferralReward: adminWith('marketplace.manage')");
  });

  it('denies a non-admin from campaign management', async () => {
    const caller = appRouter.createCaller(makeCtx(1, 'user', 'supplier'));
    await expect(caller.admin.referralCampaigns()).rejects.toThrow();
  });

  it('connects real verification events to the centralized referral engine', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    expect(source).toContain("qualifyReferralEvent(db, input.userId, 'ACCOUNT_VERIFIED'");
  });
});

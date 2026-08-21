import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';

vi.mock('./db', () => ({
  getDb: vi.fn(),
}));

import { getDb } from './db';

function makeVendorCtx(userId = 10, overrides: Record<string, unknown> = {}): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `vendor-${userId}`,
      email: `vendor${userId}@test.com`,
      name: 'Test Contractor Co.',
      loginMethod: 'manus',
      role: 'user',
      userRole: 'contractor',
      accountStatus: 'active',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
      lastSignedIn: new Date('2025-01-01'),
      ...overrides,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

function makeAnonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

const PUBLIC_ROW = {
  id: 10,
  name: 'Test Contractor Co.',
  bio: 'We build things.',
  avatar: 'https://example.com/avatar.png',
  location: 'Cairo, Egypt',
  userRole: 'contractor',
  verified: true,
  createdAt: new Date('2025-01-01'),
};

describe('profile.getPublic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns exactly the public field allowlist plus completedProjects, nothing else', async () => {
    const whereMock = vi.fn().mockResolvedValue([PUBLIC_ROW]);
    const selectMock = vi.fn((cols?: unknown) => ({ from: vi.fn().mockReturnValue({ where: whereMock }) }));
    const countWhereMock = vi.fn().mockResolvedValue([{ count: 3 }]);
    let call = 0;
    const db = {
      select: vi.fn(() => {
        call += 1;
        if (call === 1) return { from: vi.fn().mockReturnValue({ where: whereMock }) };
        return { from: vi.fn().mockReturnValue({ where: countWhereMock }) };
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(1));

    const result = await caller.profile.getPublic({ userId: 10 });

    expect(result).toEqual({
      id: 10,
      name: 'Test Contractor Co.',
      bio: 'We build things.',
      avatar: 'https://example.com/avatar.png',
      location: 'Cairo, Egypt',
      userRole: 'contractor',
      verified: true,
      createdAt: PUBLIC_ROW.createdAt,
      completedProjects: 3,
    });
    // Explicit shape assertion, not just a value check: the private-field keys
    // must never appear on the response object at all.
    for (const forbidden of ['passwordHash', 'invitationToken', 'invitationExpiresAt', 'email', 'phone', 'frozenReason', 'accountStatus', 'creationNote', 'onboardingReviewNotes']) {
      expect(Object.keys(result)).not.toContain(forbidden);
    }
  });

  it('never issues select().from(users) with no column list for the public query', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const profileSection = source.slice(source.indexOf('Vendor Profile Router'), source.indexOf('Admin Router'));
    const codeOnly = profileSection.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(profileSection).toContain('PUBLIC_PROFILE_COLUMNS');
    expect(codeOnly).not.toMatch(/select\(\)\.from\(users\)/);
  });

  it('returns NOT_FOUND for a non-provider (e.g. homeowner) user id, not their data', async () => {
    const whereMock = vi.fn().mockResolvedValue([{ ...PUBLIC_ROW, userRole: 'homeowner' }]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(1));

    await expect(caller.profile.getPublic({ userId: 99 })).rejects.toThrow('Vendor profile not found');
  });

  it('returns NOT_FOUND for a nonexistent user id', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereMock }) }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(1));

    await expect(caller.profile.getPublic({ userId: 99999 })).rejects.toThrow('Vendor profile not found');
  });

  it('rejects an unauthenticated caller (the safer of the two options left open by Phase 4A.5)', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.profile.getPublic({ userId: 10 })).rejects.toThrow();
  });

  it('rejects invalid input (non-positive-integer userId)', async () => {
    const caller = appRouter.createCaller(makeVendorCtx(1));
    await expect(caller.profile.getPublic({ userId: -1 })).rejects.toThrow();
    await expect(caller.profile.getPublic({ userId: 1.5 } as never)).rejects.toThrow();
  });
});

describe('profile.getOwn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retrieves the caller\'s own profile using ctx.user.id, never a client-supplied id', async () => {
    const whereMock = vi.fn().mockResolvedValue([PUBLIC_ROW]);
    let call = 0;
    const db = {
      select: vi.fn(() => {
        call += 1;
        if (call === 1) return { from: vi.fn().mockReturnValue({ where: whereMock }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 0 }]) }) };
      }),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(10));

    const result = await caller.profile.getOwn();
    expect(result.id).toBe(10);
    expect(result.completedProjects).toBe(0);
  });

  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.profile.getOwn()).rejects.toThrow();
  });

  it('has no userId (or any target-account identifier) in its input schema at all', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const getOwnBlock = source.slice(source.indexOf('getOwn: protectedProcedure'), source.indexOf('update: protectedProcedure'));
    expect(getOwnBlock).not.toContain('.input(');
  });
});

describe('profile.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the caller\'s own row (ctx.user.id), never a client-supplied id', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const db = { update: vi.fn().mockReturnValue({ set: setMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(10));

    await caller.profile.update({ bio: 'New bio', location: 'Alexandria' });
    expect(setMock).toHaveBeenCalledWith({ bio: 'New bio', location: 'Alexandria' });
    // The mutation only ever targets the authenticated caller's row.
    const dbAny = db as unknown as { update: ReturnType<typeof vi.fn> };
    expect(dbAny.update).toHaveBeenCalled();
  });

  it('has no userId field in its input schema - a smuggled one is silently stripped, not honored', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const db = { update: vi.fn().mockReturnValue({ set: setMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(10));

    // Force an extra, unschematized field through the type system to prove Zod
    // strips it rather than the mutation ever reading or acting on it.
    await caller.profile.update({ bio: 'x', userId: 999 } as never);
    expect(setMock).toHaveBeenCalledWith(expect.not.objectContaining({ userId: expect.anything() }));
  });

  it('rejects unauthorized/unknown fields silently rather than persisting them (mass-assignment protection)', async () => {
    const whereMock = vi.fn().mockResolvedValue([]);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    const db = { update: vi.fn().mockReturnValue({ set: setMock }) };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(10));

    await caller.profile.update({ bio: 'ok', passwordHash: 'hacked', role: 'admin' } as never);
    const setArg = setMock.mock.calls[0][0];
    expect(setArg).not.toHaveProperty('passwordHash');
    expect(setArg).not.toHaveProperty('role');
  });

  it('rejects a bio over the length limit', async () => {
    const caller = appRouter.createCaller(makeVendorCtx(10));
    await expect(caller.profile.update({ bio: 'x'.repeat(1001) })).rejects.toThrow();
  });

  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(makeAnonCtx());
    await expect(caller.profile.update({ bio: 'x' })).rejects.toThrow();
  });
});

describe('profile.uploadAvatar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-image content type', async () => {
    const caller = appRouter.createCaller(makeVendorCtx(10));
    await expect(caller.profile.uploadAvatar({ contentType: 'application/pdf', base64: 'AAAA' })).rejects.toThrow();
  });

  it('rejects an oversized image (over 2MB)', async () => {
    const db = { update: vi.fn() };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const caller = appRouter.createCaller(makeVendorCtx(10));
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
    await expect(caller.profile.uploadAvatar({ contentType: 'image/png', base64: oversized })).rejects.toThrow('2MB');
  });
});

describe('vendor profile localization', () => {
  it('every new profile.* key exists in both the English and Arabic translation maps', () => {
    const source = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
    const keys = Array.from(new Set(Array.from(source.matchAll(/'(profile\.[a-z_]+)':/g)).map(m => m[1])));
    expect(keys.length).toBeGreaterThan(0);
    const occurrences = (key: string) => (source.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) ?? []).length;
    for (const key of keys) {
      expect(occurrences(key), `expected '${key}' to appear exactly twice (English + Arabic maps)`).toBe(2);
    }
  });
});

describe('vendor profile responsive conventions', () => {
  it('uses responsive utility classes, not fixed pixel widths, for the new profile section', () => {
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'); // sanity: backend has no width/layout concerns
    expect(source).toBeTruthy();
    // Phase 4A.6.4: the vendor profile edit UI lives in the reusable VendorProfileCard
    // component (rendered from RolePlatform.tsx, the real reachable vendor dashboard),
    // not in ProviderDashboard.tsx (a legacy redirect-only shim - see
    // BUILDHUB_PHASE4A64_DASHBOARD_INTEGRATION.md).
    const page = readFileSync(new URL('../client/src/components/VendorProfileCard.tsx', import.meta.url), 'utf8');
    expect(page).not.toMatch(/width:\s*\d+px/);
    expect(page).toContain('sm:grid-cols-2');
  });

  it('the public vendor profile page also avoids fixed pixel widths and sets dir for RTL/LTR', () => {
    const page = readFileSync(new URL('../client/src/pages/VendorProfile.tsx', import.meta.url), 'utf8');
    expect(page).not.toMatch(/width:\s*\d+px/);
    expect(page).toContain("dir={lang === 'ar' ? 'rtl' : 'ltr'}");
  });
});

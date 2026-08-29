import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import type { TrpcContext } from './_core/context';
import { getDb } from './db';
import { users as usersTable, products as productsTable } from '../drizzle/schema';

/**
 * CONTACTING A VENDOR.
 *
 * The messages page told people, in its own empty state, that "conversations
 * start when you contact a vendor from the marketplace". No such control
 * existed anywhere: `messages.conversations` returns only accounts you have
 * already exchanged a message with, so there was nothing to select and no way
 * to write the first one. The vendor page offered no contact action at all and
 * listed none of the vendor's products.
 *
 * These tests hold the contact model to what the repository actually operates:
 * an in-platform thread, and nothing that releases a phone number or an email
 * address that is not part of a vendor's public record.
 */

function ctx(userId: number, overrides: Record<string, unknown> = {}): TrpcContext {
  return {
    user: {
      id: userId, openId: `u-${userId}`, email: `u${userId}@test.com`, name: `User ${userId}`,
      loginMethod: 'dummy', role: 'user', userRole: 'homeowner', accountStatus: 'active',
      createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'), lastSignedIn: new Date('2025-01-01'),
      ...overrides,
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };
}

function dbWith(rows: { users?: unknown[]; products?: unknown[] }) {
  const whereCalls: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const out = table === usersTable ? (rows.users ?? [])
          : table === productsTable ? (rows.products ?? []) : [];
        const chain = {
          where: vi.fn((condition: unknown) => {
            whereCalls.push(condition);
            return Object.assign(Promise.resolve(out), {
              orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(out) })),
            });
          }),
        };
        return chain;
      }),
    })),
  };
  return { db, whereCalls };
}

const ACTIVE_VENDOR = { id: 7, name: 'Nile Steel', userRole: 'supplier', accountStatus: 'active' };

describe('messages.recipient - opening a thread with someone new', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves an active account so the composer knows who it is writing to', async () => {
    const { db } = dbWith({ users: [ACTIVE_VENDOR] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const result = await appRouter.createCaller(ctx(1)).messages.recipient({ userId: 7 });
    expect(result).toEqual({ id: 7, name: 'Nile Steel', initials: 'NS', role: 'supplier' });
  });

  it('returns only display identity - never contact details or account state', async () => {
    const { db } = dbWith({ users: [{ ...ACTIVE_VENDOR, email: 'x@y.z', phone: '+20100', accountStatus: 'active' }] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    const result = await appRouter.createCaller(ctx(1)).messages.recipient({ userId: 7 });
    expect(Object.keys(result).sort()).toEqual(['id', 'initials', 'name', 'role']);
  });

  it('a frozen account is indistinguishable from one that does not exist', async () => {
    // Same message for both, so this cannot be used to enumerate account state.
    const frozen = dbWith({ users: [{ ...ACTIVE_VENDOR, accountStatus: 'frozen' }] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(frozen.db);
    await expect(appRouter.createCaller(ctx(1)).messages.recipient({ userId: 7 }))
      .rejects.toThrow('That recipient is not available.');

    const missing = dbWith({ users: [] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(missing.db);
    await expect(appRouter.createCaller(ctx(1)).messages.recipient({ userId: 999 }))
      .rejects.toThrow('That recipient is not available.');
  });

  it('refuses to open a thread with yourself, exactly as messages.send does', async () => {
    const { db } = dbWith({ users: [ACTIVE_VENDOR] });
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(db);
    await expect(appRouter.createCaller(ctx(7)).messages.recipient({ userId: 7 }))
      .rejects.toThrow('You cannot send a message to yourself.');
  });

  it('rejects an unauthenticated caller', async () => {
    const anon = { user: null, req: { protocol: 'https', headers: {} }, res: {} } as unknown as TrpcContext;
    await expect(appRouter.createCaller(anon).messages.recipient({ userId: 7 })).rejects.toThrow();
  });

  it('reveals nothing messages.send did not already reveal', () => {
    // The justification for this endpoint existing at all: send already
    // accepts any active account id and already answers identically for
    // "no such user" and "not active". If send ever stops doing that, this
    // endpoint becomes a NEW oracle and needs re-arguing.
    const source = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
    const sendAt = source.indexOf('  send: protectedProcedure');
    expect(sendAt, 'messages.send not found').toBeGreaterThan(-1);
    // Anchored FORWARD from send: `uploadAttachment` appears earlier in the
    // file under a different router, so slicing between two bare indexOf calls
    // produced an empty string and the assertions below passed on nothing.
    const sendBody = source.slice(sendAt, source.indexOf('  uploadAttachment: protectedProcedure', sendAt));
    expect(sendBody.length, 'the messages.send body must not be empty').toBeGreaterThan(200);
    expect(sendBody).toContain("receiver.accountStatus !== 'active'");
    expect(sendBody).toContain('That recipient is not available.');
  });
});

describe('the vendor detail page', () => {
  const page = readFileSync(new URL('../client/src/pages/VendorProfile.tsx', import.meta.url), 'utf8');
  const messages = readFileSync(new URL('../client/src/pages/MessagesPage.tsx', import.meta.url), 'utf8');

  it('offers a contact action that goes to a real conversation', () => {
    expect(page).toContain('/messages?to=${userId}');
    expect(page).toContain("data-testid=\"vendor-contact\"");
  });

  it('shows what the vendor does and what they sell', () => {
    expect(page).toContain('data-testid="vendor-categories"');
    expect(page).toContain('data-testid="vendor-catalogue"');
    expect(page).toContain('trpc.marketplace.vendorProducts.useQuery');
  });

  it('never renders a phone number or an email address', () => {
    // Neither is in the public profile response, and this page must not become
    // the first place one appears.
    expect(page).not.toMatch(/profile\.(phone|email)/);
    expect(page).not.toMatch(/tel:|mailto:/);
  });

  it('does not offer a contact button that would fail', () => {
    expect(page).toContain("profile.contactChannel === 'message'");
    expect(page).toContain('data-testid="vendor-contact-unavailable"');
  });

  it('does not invite you to message yourself', () => {
    expect(page).toContain('const isSelf =');
    expect(page).toContain("t('vendor.contact.self')");
  });

  it('the messages page honours ?to= and can select someone with no history', () => {
    expect(messages).toContain("new URLSearchParams(search).get('to')");
    expect(messages).toContain('trpc.messages.recipient.useQuery');
    expect(messages).toContain('requestedRecipient && !persistedConversations.some');
  });

  it('the ?to= value is validated, not trusted as a number', () => {
    expect(messages).toContain('Number.isInteger(id) && id > 0');
  });

  it('arriving with a recipient shows the CONVERSATION, not the tab you came from', () => {
    // A message notification links to /messages?to=<sender>. wouter stays on
    // the same route, so the page does not remount and an uncontrolled Tabs
    // kept the notifications tab the reader had just clicked from. The thread
    // opened correctly and was invisible behind it - verified in a browser.
    expect(messages).toContain('<Tabs value={tab} onValueChange={setTab}>');
    expect(messages).not.toContain('<Tabs defaultValue="messages">');
    expect(messages).toContain("setSelectedConv(requestedRecipientId); setTab('messages');");
  });
});

describe('both languages carry the new strings', () => {
  const i18n = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');
  it.each(['vendor.services', 'vendor.contact', 'vendor.contact.cta', 'vendor.contact.note',
    'vendor.contact.self', 'vendor.contact.unavailable', 'vendor.catalogue'])('%s exists twice', key => {
    expect(i18n.split(`'${key}':`).length - 1, `${key} must be in EN and AR`).toBe(2);
  });

  it('the contact note states there is no phone or email, rather than implying one is hidden', () => {
    expect(i18n).toMatch(/Direct phone numbers and email addresses are not published/);
  });
});

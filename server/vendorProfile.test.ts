// ── THE VENDOR COMPANY PROFILE, AND WHO SEES WHICH PART OF IT ──────────────
//
// Until now a "vendor profile" was a `users` row: a personal name, a bio, a
// location. A customer choosing between two construction firms was choosing
// between two people's names.
//
// The contact rule here is NOT invented. `profile.getPublic` carried a comment
// recording that no flow released a vendor's direct line and that inventing one
// would be inventing a business rule. The owner has since DECIDED that rule:
// released once the vendor has ENGAGED. These tests pin that decision, both
// halves of it - what unlocks, and what deliberately does not.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import {
  VENDOR_PROFILE_ADMIN_COLUMNS, VENDOR_PROFILE_CONTACT_COLUMNS,
  VENDOR_PROFILE_PUBLIC_COLUMNS, readVendorProfile, saveOwnVendorProfile,
  unlocksContact, vendorContactAccess,
} from './vendorProfile';
import { projectMembers, projects, quotations, rfqs, users, vendorProfiles } from '../drizzle/schema';

const VENDOR = 50;
const CUSTOMER = 60;
const STRANGER = 70;

const FULL_ROW = {
  companyName: 'Nile Steel Works',
  companyDescription: 'Structural steel since 1998.',
  city: 'Giza', country: 'Egypt', website: 'https://example.test',
  primaryContactName: 'Mona Farid',
  primaryContactPosition: 'Commercial Director',
  primaryContactEmail: 'mona@example.test',
  primaryContactPhone: '0223456789',
  primaryContactMobile: '01000000000',
  addressLine: '14 Corniche El Nil',
  registrationNumber: 'CR-99887766',
};

/**
 * A double that answers by TABLE and records writes.
 *
 * `joinRows` is what the two relationship probes read. Keyed separately from
 * the plain tables because both probes select from a JOIN, and answering them
 * with the same rows as an unjoined read would make every viewer look related
 * to every vendor - which is the exact failure these tests exist to catch.
 */
function makeDb(options: {
  profile?: Record<string, unknown> | null;
  quotedRows?: unknown[];
  projectRows?: unknown[];
} = {}) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  let selectedColumns: unknown = null;
  let failInsertAsDuplicate = false;

  const chainFor = (rows: unknown[]): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      where: () => c, orderBy: () => c, limit: () => c, for: () => c,
      leftJoin: () => c, innerJoin: () => c, groupBy: () => c, offset: () => c,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    };
    return c;
  };

  const db: Record<string, unknown> = {
    select: (columns?: unknown) => {
      selectedColumns = columns;
      return {
        from: (table: unknown) => {
          if (table === quotations) return chainFor(options.quotedRows ?? []);
          if (table === projectMembers) return chainFor(options.projectRows ?? []);
          if (table === vendorProfiles) {
            const row = options.profile === undefined ? FULL_ROW : options.profile;
            if (!row) return chainFor([]);
            // THE DOUBLE HONOURS THE COLUMN LIST. Returning the whole row
            // regardless would make every allowlist test vacuous: the tier
            // would "pass" while the production code selected everything.
            const requested = Object.keys((selectedColumns ?? {}) as object);
            const projected: Record<string, unknown> = {};
            for (const key of requested) projected[key] = (row as Record<string, unknown>)[key];
            return chainFor([projected]);
          }
          return chainFor([]);
        },
      };
    },
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (failInsertAsDuplicate) {
          const e = new Error('dup') as Error & { code: string };
          e.code = 'ER_DUP_ENTRY';
          throw e;
        }
        inserts.push({ table, values });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push({ table, values }); },
      }),
    }),
  };

  return {
    db, inserts, updates,
    /** The column list the last select() asked for - see the over-select test. */
    lastSelectedColumns: () => Object.keys((selectedColumns ?? {}) as object),
    into: (t: unknown) => inserts.filter(r => r.table === t).map(r => r.values),
    patched: (t: unknown) => updates.filter(r => r.table === t).map(r => r.values),
    failNextInsertAsDuplicate: () => { failInsertAsDuplicate = true; },
  };
}

const viewer = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, role: 'user', adminRole: null, ...extra });

// ── 1. What unlocks the contact block ──────────────────────────────────────

describe('vendorContactAccess - the rule the owner decided, not one invented here', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the vendor sees their own contact block', async () => {
    const { db } = makeDb();
    await expect(vendorContactAccess(db, VENDOR, viewer(VENDOR))).resolves.toBe('self');
  });

  it('an administrator sees it - support answering "how do I reach this vendor" is ordinary', async () => {
    const { db } = makeDb();
    await expect(vendorContactAccess(db, VENDOR, viewer(STRANGER, { role: 'admin', adminRole: 'SUPPORT_ADMIN' })))
      .resolves.toBe('admin');
  });

  it('a customer the vendor QUOTED for sees it - the vendor engaged, which is the whole rule', async () => {
    const { db } = makeDb({ quotedRows: [{ id: 1 }] });
    await expect(vendorContactAccess(db, VENDOR, viewer(CUSTOMER))).resolves.toBe('quoted');
  });

  it('a customer whose PROJECT the vendor is on sees it', async () => {
    const { db } = makeDb({ projectRows: [{ id: 1 }] });
    await expect(vendorContactAccess(db, VENDOR, viewer(CUSTOMER))).resolves.toBe('project');
  });

  it('A STRANGER DOES NOT - and this is the case the whole design turns on', async () => {
    const { db } = makeDb();
    await expect(vendorContactAccess(db, VENDOR, viewer(STRANGER))).resolves.toBe('none');
  });

  it('an anonymous reader does not', async () => {
    const { db } = makeDb();
    await expect(vendorContactAccess(db, VENDOR, null)).resolves.toBe('none');
  });

  it('an admin row with NO adminRole is not treated as an administrator - fails closed', async () => {
    const { db } = makeDb();
    await expect(vendorContactAccess(db, VENDOR, viewer(STRANGER, { role: 'admin', adminRole: null })))
      .resolves.toBe('none');
  });

  it('every tier except "none" unlocks, and "none" never does', () => {
    for (const tier of ['self', 'admin', 'quoted', 'project'] as const) {
      expect(unlocksContact(tier)).toBe(true);
    }
    expect(unlocksContact('none')).toBe(false);
  });
});

// ── 2. What each tier actually receives ────────────────────────────────────

describe('readVendorProfile - the tiers are a property of the COLUMNS', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a stranger gets the public block and NO contact block at all', async () => {
    const { db } = makeDb();
    const result = await readVendorProfile(db, VENDOR, viewer(STRANGER));

    expect(result.profile).toMatchObject({ companyName: 'Nile Steel Works', city: 'Giza' });
    // NULL, not an object of nulls: "we are not showing you this" and "the
    // vendor left it blank" are different things to render.
    expect(result.contact).toBeNull();
    expect(result.contactAccess).toBe('none');
  });

  it('a stranger receives NO contact value anywhere in the payload, not even hidden in the public block', async () => {
    const { db } = makeDb();
    const result = await readVendorProfile(db, VENDOR, viewer(STRANGER));
    const serialised = JSON.stringify(result);
    for (const secret of ['Mona Farid', 'mona@example.test', '01000000000', 'Corniche', 'CR-99887766']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('a customer the vendor quoted for receives the contact block in full', async () => {
    const { db } = makeDb({ quotedRows: [{ id: 1 }] });
    const result = await readVendorProfile(db, VENDOR, viewer(CUSTOMER));
    expect(result.contact).toMatchObject({
      primaryContactName: 'Mona Farid',
      primaryContactPosition: 'Commercial Director',
      primaryContactEmail: 'mona@example.test',
      addressLine: '14 Corniche El Nil',
    });
  });

  it('a customer does NOT receive the registration number - that is the number an impersonator needs', async () => {
    const { db } = makeDb({ quotedRows: [{ id: 1 }] });
    const result = await readVendorProfile(db, VENDOR, viewer(CUSTOMER));
    expect(result.registrationNumber).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('CR-99887766');
  });

  it('the customer tier does not even ASK the database for the registration number', async () => {
    // Asserting only the returned shape left a real hole: widening the SELECT
    // to the admin column list still produced a correct-looking response,
    // because the attach step filters again. The value was fetched and
    // discarded - one refactor away from being spread into the payload.
    const rec = makeDb({ quotedRows: [{ id: 1 }] });
    await readVendorProfile(rec.db, VENDOR, viewer(CUSTOMER));
    expect(rec.lastSelectedColumns()).not.toContain('registrationNumber');
  });

  it('a stranger does not even ASK for the contact columns', async () => {
    const rec = makeDb();
    await readVendorProfile(rec.db, VENDOR, viewer(STRANGER));
    for (const column of ['primaryContactEmail', 'primaryContactPhone', 'addressLine']) {
      expect(rec.lastSelectedColumns()).not.toContain(column);
    }
  });

  it('an administrator does, for investigation', async () => {
    const { db } = makeDb();
    const result = await readVendorProfile(db, VENDOR, viewer(STRANGER, { role: 'admin', adminRole: 'SUPER_ADMIN' }));
    expect(result.registrationNumber).toBe('CR-99887766');
    expect(result.contact).not.toBeNull();
  });

  it('a vendor with NO profile row gets honest emptiness, never a fabricated shell', async () => {
    const { db } = makeDb({ profile: null });
    const result = await readVendorProfile(db, VENDOR, viewer(CUSTOMER, {}));
    expect(result.profile).toBeNull();
    expect(result.contact).toBeNull();
  });

  it('a vendor who filled in nothing gets nulls, not a company name invented from their personal name', async () => {
    const { db } = makeDb({ profile: { companyName: null, city: null, country: null, website: null, companyDescription: null } });
    const result = await readVendorProfile(db, VENDOR, viewer(STRANGER));
    expect(result.profile).toEqual({
      companyName: null, companyDescription: null, city: null, country: null, website: null,
    });
  });
});

// ── 3. The allowlists themselves ───────────────────────────────────────────

describe('the column allowlists', () => {
  it('the PUBLIC tier carries nothing that identifies a person or a place to visit', () => {
    expect(Object.keys(VENDOR_PROFILE_PUBLIC_COLUMNS).sort())
      .toEqual(['city', 'companyDescription', 'companyName', 'country', 'website'].sort());
  });

  it('the CONTACT tier is exactly the person and the street address', () => {
    expect(Object.keys(VENDOR_PROFILE_CONTACT_COLUMNS).sort()).toEqual([
      'addressLine', 'primaryContactEmail', 'primaryContactMobile',
      'primaryContactName', 'primaryContactPhone', 'primaryContactPosition',
    ].sort());
  });

  it('registrationNumber is in NEITHER of the two customer-facing tiers', () => {
    expect(Object.keys(VENDOR_PROFILE_PUBLIC_COLUMNS)).not.toContain('registrationNumber');
    expect(Object.keys(VENDOR_PROFILE_CONTACT_COLUMNS)).not.toContain('registrationNumber');
    expect(Object.keys(VENDOR_PROFILE_ADMIN_COLUMNS)).toContain('registrationNumber');
  });

  it('NO TIER, not even the admin one, can carry a credential - the table holds none', () => {
    const everything = Object.keys(VENDOR_PROFILE_ADMIN_COLUMNS).join(' ').toLowerCase();
    for (const forbidden of ['password', 'token', 'secret', 'hash', 'apikey', 'session']) {
      expect(everything).not.toContain(forbidden);
    }
  });
});

/**
 * ── THREE RULES DELIBERATELY NOT TESTED HERE ───────────────────────────────
 *
 * All three live in a WHERE clause, and the double above answers a query by
 * TABLE without interpreting its conditions:
 *
 *   a quotation unlocks contact only for the customer whose RFQ it was
 *   a project membership only for the customer who owns that project
 *   a REMOVED member's access ends with their membership
 *
 * A test written against this double would pass with any of those filters
 * deleted, which is the vacuous assertion this codebase has been bitten by
 * before. Making the double filter them itself would be worse still: it would
 * then pass with the production filter GONE, which is precisely the mutation
 * it is meant to catch.
 *
 * They are security rules about CROSS-CUSTOMER leakage, so they are proven
 * where the WHERE clause is real - against MariaDB, in
 * evidence/zg-vendorprofile.mjs.
 */

// ── 4. Saving your own, and only your own ──────────────────────────────────

describe('saveOwnVendorProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the row on first save', async () => {
    const rec = makeDb({ profile: null });
    await saveOwnVendorProfile(rec.db, VENDOR, { companyName: 'New Co' });
    expect(rec.into(vendorProfiles)[0]).toMatchObject({ userId: VENDOR, companyName: 'New Co' });
  });

  it('updates the existing row rather than creating a second', async () => {
    const rec = makeDb();
    await saveOwnVendorProfile(rec.db, VENDOR, { companyName: 'Renamed' });
    expect(rec.into(vendorProfiles)).toEqual([]);
    expect(rec.patched(vendorProfiles)[0]).toMatchObject({ companyName: 'Renamed' });
  });

  it('a concurrent first save does not discard the loser\'s edit - it updates instead', async () => {
    const rec = makeDb({ profile: null });
    rec.failNextInsertAsDuplicate();
    // Two tabs saving at once: the database refuses the second insert, and the
    // caller's edit must still land rather than being dropped for being second.
    await saveOwnVendorProfile(rec.db, VENDOR, { companyName: 'Second Tab' });
    expect(rec.patched(vendorProfiles)[0]).toMatchObject({ companyName: 'Second Tab' });
  });

  it('never writes a userId taken from the patch - the session decides whose profile this is', async () => {
    const rec = makeDb({ profile: null });
    await saveOwnVendorProfile(rec.db, VENDOR, { companyName: 'X', userId: '999' } as never);
    // The explicit userId argument is applied AFTER nothing and BEFORE the
    // spread would matter; what must never happen is a row landing on 999.
    expect(rec.into(vendorProfiles)[0].userId).toBe(VENDOR);
  });
});

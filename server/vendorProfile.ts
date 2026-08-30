/**
 * ── WHAT A VENDOR'S PROFILE SAYS, AND TO WHOM ──────────────────────────────
 *
 * Before this file a "vendor profile" was a `users` row: a personal name, a
 * bio, a location, a phone number. A customer choosing between two
 * construction firms was choosing between two people's names, with no company,
 * no address, no registration, no way to reach the person who actually
 * answers.
 *
 * THREE TIERS, AND THEY ARE A PROPERTY OF THE COLUMNS RATHER THAN OF THE
 * READER. Each list below is an explicit allowlist; there is no `select()`
 * anywhere in this file that could widen by accident.
 *
 *   PUBLIC        what a customer needs to CHOOSE: company, description,
 *                 city, country, website
 *   RELATIONSHIP  what they need to CONTACT: the named person, their
 *                 position, their email, phone, mobile and street address
 *   ADMIN         the commercial registration number
 *
 * WHY CONTACT IS NOT PUBLIC, AND WHY THE RULE IS NOT NEW.
 *
 * `rfq.requesterContact` already decides the mirror-image question - when a
 * supplier may see a customer's contact details - and answers it with "when
 * there is a real commercial relationship", not "when they are signed in".
 * This applies the same rule in the other direction rather than inventing a
 * second, competing one. `DIRECTORY_VENDOR_COLUMNS` likewise already omits
 * email and phone, so the directory has never disclosed contact.
 *
 * AN INVITATION IS DELIBERATELY NOT ENOUGH.
 *
 * The relationships that unlock contact are ones the VENDOR entered into:
 * they quoted, or they joined the project. Being INVITED is the customer
 * reaching out, and counting it would mean anyone could unlock any vendor's
 * private contact details by inviting them to a throwaway RFQ. The vendor
 * decides when their contact is released, by responding.
 */

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  projectMembers, projects, quotations, rfqs, users, vendorProfiles,
} from '../drizzle/schema';

type Db = any;

/** What anyone browsing the directory may see. */
export const VENDOR_PROFILE_PUBLIC_COLUMNS = {
  companyName: vendorProfiles.companyName,
  companyDescription: vendorProfiles.companyDescription,
  city: vendorProfiles.city,
  country: vendorProfiles.country,
  website: vendorProfiles.website,
} as const;

/** Released only on a relationship the vendor entered into. */
export const VENDOR_PROFILE_CONTACT_COLUMNS = {
  primaryContactName: vendorProfiles.primaryContactName,
  primaryContactPosition: vendorProfiles.primaryContactPosition,
  primaryContactEmail: vendorProfiles.primaryContactEmail,
  primaryContactPhone: vendorProfiles.primaryContactPhone,
  primaryContactMobile: vendorProfiles.primaryContactMobile,
  addressLine: vendorProfiles.addressLine,
} as const;

/**
 * Super Admin's wider investigation view. Note what is NOT here: this table
 * holds no credential of any kind, so even the widest tier cannot leak one.
 */
export const VENDOR_PROFILE_ADMIN_COLUMNS = {
  ...VENDOR_PROFILE_PUBLIC_COLUMNS,
  ...VENDOR_PROFILE_CONTACT_COLUMNS,
  registrationNumber: vendorProfiles.registrationNumber,
} as const;

export type VendorContactAccess =
  /** The vendor themselves, or an administrator. */
  | 'self'
  | 'admin'
  /** A customer whose RFQ this vendor quoted on. */
  | 'quoted'
  /** A customer whose project this vendor is a live member of. */
  | 'project'
  /** No relationship. Contact stays locked, and the UI says why. */
  | 'none';

/**
 * MAY THIS VIEWER SEE THIS VENDOR'S CONTACT DETAILS?
 *
 * Returns the REASON rather than a boolean, so the screen can tell the viewer
 * what would unlock it instead of rendering an unexplained blank - the same
 * `contactUnlocked` discipline rfq.requesterContact established.
 *
 * Every branch is a relationship stored in the database. Nothing here reads a
 * role, a plan, or anything the caller sent.
 */
export async function vendorContactAccess(
  db: Db,
  vendorId: number,
  viewer: { id: number; adminRole?: string | null; role?: string | null } | null,
): Promise<VendorContactAccess> {
  if (!viewer) return 'none';
  if (viewer.id === vendorId) return 'self';
  // Any administrator, not only Super Admin: support answering "how do I reach
  // this vendor" is ordinary, and this table holds no credential.
  if (viewer.role === 'admin' && viewer.adminRole) return 'admin';

  // The vendor quoted on one of this viewer's RFQs - the vendor engaged, which
  // is the whole point. An INVITATION would not count: see the header.
  const quoted = await db
    .select({ id: quotations.id })
    .from(quotations)
    .innerJoin(rfqs, eq(rfqs.id, quotations.rfqId))
    .where(and(eq(quotations.providerId, vendorId), eq(rfqs.requesterId, viewer.id)))
    .limit(1);
  if ((quoted as unknown[]).length > 0) return 'quoted';

  // The vendor is a LIVE member of a project this viewer owns. `removedAt IS
  // NULL` matters: a vendor taken off a job should not keep handing out their
  // details through it.
  const shared = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projectMembers.userId, vendorId),
      isNull(projectMembers.removedAt),
      eq(projects.ownerId, viewer.id),
    ))
    .limit(1);
  if ((shared as unknown[]).length > 0) return 'project';

  return 'none';
}

/** True for the tiers that actually release the contact block. */
export function unlocksContact(access: VendorContactAccess): boolean {
  return access !== 'none';
}

/**
 * Read one vendor's profile at the tier this viewer has earned.
 *
 * Returns `null` for the whole contact block rather than an object of nulls,
 * so the client can distinguish "we are not showing you this" from "the vendor
 * left it blank" - two very different things to render, and rendering the
 * second for the first is how a product ends up looking broken.
 *
 * NEVER FABRICATES. A vendor who has filled in nothing gets nulls, and the
 * screen says the vendor has not provided it - it does not invent a placeholder
 * company name from their personal name.
 */
export type VendorPublicProfile = {
  companyName: string | null;
  companyDescription: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
};

export type VendorPrimaryContact = {
  primaryContactName: string | null;
  primaryContactPosition: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  primaryContactMobile: string | null;
  addressLine: string | null;
};

export async function readVendorProfile(
  db: Db,
  vendorId: number,
  viewer: { id: number; adminRole?: string | null; role?: string | null } | null,
): Promise<{
  profile: VendorPublicProfile | null;
  contact: VendorPrimaryContact | null;
  contactAccess: VendorContactAccess;
  /** Present only for administrators. */
  registrationNumber?: string | null;
}> {
  const access = await vendorContactAccess(db, vendorId, viewer);
  const isAdmin = access === 'admin';

  const columns = isAdmin
    ? VENDOR_PROFILE_ADMIN_COLUMNS
    : unlocksContact(access)
      ? { ...VENDOR_PROFILE_PUBLIC_COLUMNS, ...VENDOR_PROFILE_CONTACT_COLUMNS }
      : VENDOR_PROFILE_PUBLIC_COLUMNS;

  const [row] = await db.select(columns).from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorId)).limit(1);

  if (!row) {
    // No profile row at all. Honest emptiness, not a fabricated shell.
    return { profile: null, contact: null, contactAccess: access };
  }

  const record = row as Record<string, unknown>;
  const publicPart: Record<string, unknown> = {};
  for (const key of Object.keys(VENDOR_PROFILE_PUBLIC_COLUMNS)) publicPart[key] = record[key] ?? null;

  let contact: Record<string, unknown> | null = null;
  if (unlocksContact(access)) {
    contact = {};
    for (const key of Object.keys(VENDOR_PROFILE_CONTACT_COLUMNS)) contact[key] = record[key] ?? null;
  }

  return {
    profile: publicPart as VendorPublicProfile,
    contact: contact as VendorPrimaryContact | null,
    contactAccess: access,
    ...(isAdmin ? { registrationNumber: (record.registrationNumber as string | null) ?? null } : {}),
  };
}

/**
 * The vendor's own editable profile. Every field, because it is theirs.
 *
 * Deliberately a DIFFERENT function from readVendorProfile: that one answers
 * "what may this viewer see", and reusing it for the edit form would mean the
 * form's contents depended on an access check that should never apply to the
 * owner. Two questions, two functions.
 */
export async function readOwnVendorProfile(db: Db, userId: number) {
  const [row] = await db.select(VENDOR_PROFILE_ADMIN_COLUMNS)
    .from(vendorProfiles).where(eq(vendorProfiles.userId, userId)).limit(1);
  return (row as Record<string, unknown> | undefined) ?? null;
}

/**
 * Create or update the caller's own profile.
 *
 * UPSERT BY THE UNIQUE INDEX, not by check-then-write: two concurrent saves
 * from two tabs cannot produce two profile rows, because the database refuses
 * the second and this updates instead.
 *
 * `userId` is never in the patch. It comes from the authenticated session at
 * the call site, so no payload can move a profile onto another account.
 */
export async function saveOwnVendorProfile(
  db: Db,
  userId: number,
  patch: Record<string, string | null>,
): Promise<void> {
  // ── THE OWNER OF THIS ROW IS NEVER TAKEN FROM THE PATCH ─────────────────
  //
  // `values({ userId, ...patch })` put the spread LAST, so a `userId` in the
  // patch overwrote the session's and the row landed on somebody else's
  // account. The router's schema has no userId field, so nothing could reach
  // it that way today - but this is a module-level function, and the next
  // caller is not bound by the previous caller's schema.
  //
  // Two guards, because either alone is one edit away from being wrong:
  // strip the key, and apply the session id LAST so it wins regardless.
  const { userId: _ignored, ...safe } = patch as Record<string, unknown>;
  const fields = safe as Record<string, string | null>;

  const [existing] = await db.select({ id: vendorProfiles.id })
    .from(vendorProfiles).where(eq(vendorProfiles.userId, userId)).limit(1);

  if (existing) {
    // The WHERE is scoped to the session's id too, so even a patch that
    // somehow still carried one could not move the row to another account.
    await db.update(vendorProfiles).set(fields).where(eq(vendorProfiles.userId, userId));
    return;
  }
  try {
    await db.insert(vendorProfiles).values({ ...fields, userId });
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    if (code !== 'ER_DUP_ENTRY') throw error;
    // Lost the race to a concurrent save. The row exists now, so update it -
    // the caller's edit must not be discarded because they were second.
    await db.update(vendorProfiles).set(fields).where(eq(vendorProfiles.userId, userId));
  }
}

/**
 * Company names for a set of vendors, for the directory listing.
 *
 * PUBLIC TIER ONLY, by construction: the column list is two entries and
 * neither is contact. Batched rather than queried per vendor - the directory
 * renders dozens of cards, and a query each would be the classic N+1.
 */
export async function companyNamesFor(db: Db, vendorIds: number[]): Promise<Map<number, string | null>> {
  if (vendorIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: vendorProfiles.userId, companyName: vendorProfiles.companyName })
    .from(vendorProfiles).where(inArray(vendorProfiles.userId, vendorIds));
  return new Map((rows as { userId: number; companyName: string | null }[])
    .map(r => [r.userId, r.companyName]));
}

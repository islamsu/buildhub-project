/**
 * ── FINDING THE RECORD (Part 48) ───────────────────────────────────────────
 *
 * The dispute investigation built in the previous pass asks for an RFQ id. An
 * administrator taking a support call does not have an RFQ id. They have a
 * name, an email address, or a phrase from a request title. Nothing in the
 * console turned any of those into an id, so the investigation was reachable
 * only by someone who already knew the answer.
 *
 * THE AUTHORIZATION MODEL IS PER SEGMENT, NOT PER PAGE. A search that crosses
 * five record types under one permission would hand a MARKETPLACE_ADMIN a
 * customer directory and a SUPPORT_ADMIN the bid book. Each segment carries the
 * permission that already governs that record type elsewhere in the admin
 * router, so this screen grants nobody anything they did not already hold.
 *
 * AN OMITTED SEGMENT IS REPORTED AS OMITTED, NEVER AS EMPTY. "No results" and
 * "you may not look here" are different answers, and collapsing them is how a
 * console teaches an administrator that a record does not exist when in fact
 * they simply cannot see it. `omitted` carries the keys, and the page says so.
 *
 * EXPLICIT COLUMN ALLOWLISTS. `users` holds a password hash and a live
 * invitation token, and a bare `select().from(users)` has carried both into an
 * administrator's browser twice in this codebase's history. Nothing here
 * selects a whole row.
 */

import { desc, eq, like, or, type SQL } from 'drizzle-orm';
import { hasAdminPermission, type AdminPermission } from '../../shared/adminRoles';
import { disputes, products, projects, quotations, rfqs, supportTickets, users, vendorProfiles } from '../../drizzle/schema';
import { containsTerm } from '../_core/searchTerms';
import { enquiryList } from '../vendorEnquiryQuery';
import { getDb } from '../db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Rows per segment. A search result is a way in, not a report. */
export const SEARCH_LIMIT = 10;

export type SearchSegmentKey =
  | 'users' | 'rfqs' | 'quotations' | 'products' | 'projects'
  | 'disputes' | 'tickets' | 'enquiries';

/**
 * Which permission governs which record type - the same one that governs it
 * everywhere else in the admin router, deliberately, so that this screen can
 * never become the loose door into a record type.
 */
export const SEARCH_SEGMENT_PERMISSION: Record<SearchSegmentKey, AdminPermission> = {
  users: 'users.read',
  rfqs: 'audit.read',
  quotations: 'audit.read',
  products: 'marketplace.manage',
  projects: 'audit.read',
  // Read off the procedures that already serve these records - admin.disputes
  // and admin.supportTickets are adminWith('support.manage'), admin.enquiryList
  // is adminWith('marketplace.manage'). Searching a record type must not be an
  // easier door into it than opening it.
  disputes: 'support.manage',
  tickets: 'support.manage',
  enquiries: 'marketplace.manage',
};

/**
 * WHERE THE CONSOLE SENDS THE ADMINISTRATOR, as a kind rather than a URL.
 *
 * A quotation has no admin-only page, so it resolves to the request it was bid
 * on - which is the record an investigator actually wants, and is the link the
 * investigation panel opens.
 *
 * The console used to recover a bid's destination by running a regex over its
 * DISPLAY STRING - `hit.detail?.match(/#(\d+)\)?$/)` - so re-wording one
 * label silently unlinked every bid in the search. The server knows which
 * record a hit resolves against; it says so, and the client owns the single
 * map from kind to route. Routes stay a client concern, destinations stop
 * being a formatting accident.
 */
export const SEARCH_LINK_KINDS = [
  'user', 'rfq', 'product', 'project', 'dispute', 'ticket', 'enquiry',
] as const;

export type SearchLinkKind = (typeof SEARCH_LINK_KINDS)[number];

export type SearchLink = { kind: SearchLinkKind; key: string };

export type SearchHit = {
  id: number;
  /**
   * THE HUMAN REFERENCE, when the record has one.
   *
   * A dispute is DSP-2026-000012 to everyone who has ever discussed it, a
   * ticket is its own reference, and an enquiry is ENQ-<rfq>-<vendor>. Those
   * are what an administrator has been given on the phone and what the console
   * addresses the record by; the row id is technical metadata underneath.
   * `null` for the record types that genuinely have no reference.
   */
  ref: string | null;
  label: string;
  detail: string | null;
  status: string | null;
  /** The record this result opens. A bid opens the request it was bid on. */
  link: SearchLink;
};

export type PlatformSearchResult = {
  query: string;
  segments: { key: SearchSegmentKey; hits: SearchHit[] }[];
  /** Segments this administrator may not read at all. NOT the same as empty. */
  omitted: SearchSegmentKey[];
};

/**
 * A bare number is an id, anything else is text.
 *
 * Both are searched where both make sense: typing 42 into the box should find
 * request #42, and typing it into a product search should find product #42 -
 * not every product whose description mentions 42.
 */
function idOf(query: string): number | null {
  const trimmed = query.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Any of these columns contains the term. */
function anyOf(columns: SQL[]): SQL | undefined {
  return or(...columns);
}

export async function runPlatformSearch(
  db: Db,
  adminRole: unknown,
  rawQuery: string,
): Promise<PlatformSearchResult> {
  const query = rawQuery.trim();
  const numeric = idOf(query);
  const term = containsTerm(query);

  const allowed = (segment: SearchSegmentKey) =>
    hasAdminPermission(adminRole, SEARCH_SEGMENT_PERMISSION[segment]);

  const segments: PlatformSearchResult['segments'] = [];
  const omitted: SearchSegmentKey[] = [];

  // ── People, AND the businesses they are ──────────────────────────────────
  //
  // ONE SEGMENT, NOT TWO. A vendor is a user row with a business identity
  // beside it, so a separate "vendors" segment would return the same rows under
  // a second heading and leave an administrator wondering which of the two is
  // the real record. Instead the one segment reaches the business identity:
  // searching a company name finds the account, and a provider is LABELLED by
  // its company with the person named underneath - which is how an
  // administrator was given it, and the order this console owes them.
  //
  // LEFT JOIN, not inner: a homeowner has no vendorProfiles row and must still
  // be findable.
  if (allowed('users')) {
    const rows = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      userRole: users.userRole,
      accountStatus: users.accountStatus,
      companyName: vendorProfiles.companyName,
      tradingName: vendorProfiles.tradingName,
    }).from(users)
      .leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id))
      .where(numeric !== null
        ? eq(users.id, numeric)
        : anyOf([
          like(users.name, term), like(users.email, term), like(users.username, term),
          like(vendorProfiles.companyName, term), like(vendorProfiles.tradingName, term),
        ]))
      .orderBy(desc(users.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'users',
      hits: rows.map(row => {
        const business = row.companyName ?? row.tradingName ?? null;
        const person = row.name ?? row.username ?? row.email ?? `#${row.id}`;
        return {
          id: row.id,
          ref: null,
          link: { kind: 'user' as const, key: String(row.id) },
          label: business ?? person,
          detail: business ? `${person} · ${row.userRole ?? ''}`.trim() : (row.userRole ?? null),
          status: row.accountStatus ?? null,
        };
      }),
    });
  } else omitted.push('users');

  // ── Requests ─────────────────────────────────────────────────────────────
  if (allowed('rfqs')) {
    const rows = await db.select({
      id: rfqs.id,
      title: rfqs.title,
      category: rfqs.category,
      status: rfqs.status,
    }).from(rfqs)
      .where(numeric !== null
        ? eq(rfqs.id, numeric)
        : anyOf([like(rfqs.title, term), like(rfqs.location, term)]))
      .orderBy(desc(rfqs.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'rfqs',
      hits: rows.map(row => ({ id: row.id, ref: null, link: { kind: 'rfq' as const, key: String(row.id) }, label: row.title, detail: row.category, status: row.status ?? null })),
    });
  } else omitted.push('rfqs');

  // ── Bids ─────────────────────────────────────────────────────────────────
  //
  // A bid has no title to match, so text search finds the bids ON matching
  // requests - which is what "find me the quotes for the Nasr City job" means.
  if (allowed('quotations')) {
    const rows = await db.select({
      id: quotations.id,
      rfqId: quotations.rfqId,
      price: quotations.price,
      currency: quotations.currency,
      status: quotations.status,
      title: rfqs.title,
    }).from(quotations)
      .innerJoin(rfqs, eq(rfqs.id, quotations.rfqId))
      .where(numeric !== null
        ? or(eq(quotations.id, numeric), eq(quotations.rfqId, numeric))
        : like(rfqs.title, term))
      .orderBy(desc(quotations.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'quotations',
      hits: rows.map(row => ({
        id: row.id,
        ref: null,
        // The REQUEST, named by the server. Not recovered from `detail`.
        link: { kind: 'rfq' as const, key: String(row.rfqId) },
        label: `${row.price} ${row.currency ?? ''}`.trim(),
        detail: `${row.title} (#${row.rfqId})`,
        status: row.status ?? null,
      })),
    });
  } else omitted.push('quotations');

  // ── Catalogue ────────────────────────────────────────────────────────────
  if (allowed('products')) {
    const rows = await db.select({
      id: products.id,
      name: products.name,
      nameAr: products.nameAr,
      category: products.category,
      status: products.status,
    }).from(products)
      .where(numeric !== null
        ? eq(products.id, numeric)
        : anyOf([like(products.name, term), like(products.nameAr, term), like(products.brand, term)]))
      .orderBy(desc(products.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'products',
      hits: rows.map(row => ({
        id: row.id,
        ref: null,
        link: { kind: 'product' as const, key: String(row.id) },
        label: row.name,
        detail: row.category,
        // The real lifecycle state, not a boolean flattening of it: a
        // searching administrator needs to see 'draft' and 'archived' as
        // themselves rather than as a second kind of 'inactive'.
        status: row.status,
      })),
    });
  } else omitted.push('products');

  // ── Projects ─────────────────────────────────────────────────────────────
  if (allowed('projects')) {
    const rows = await db.select({
      id: projects.id,
      title: projects.title,
      type: projects.type,
      status: projects.status,
    }).from(projects)
      .where(numeric !== null
        ? eq(projects.id, numeric)
        : anyOf([like(projects.title, term), like(projects.location, term)]))
      .orderBy(desc(projects.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'projects',
      hits: rows.map(row => ({ id: row.id, ref: null, link: { kind: 'project' as const, key: String(row.id) }, label: row.title, detail: row.type ?? null, status: row.status ?? null })),
    });
  } else omitted.push('projects');

  // ── Cases ────────────────────────────────────────────────────────────────
  //
  // ADDRESSED BY REFERENCE. A dispute is DSP-2026-000012 to the parties, to
  // the notification that announced it and to the administrator holding the
  // phone; nobody has its row id. The reference is matched first-class, and it
  // is what the result is labelled with.
  if (allowed('disputes')) {
    const rows = await db.select({
      id: disputes.id,
      reference: disputes.reference,
      title: disputes.title,
      category: disputes.category,
      status: disputes.status,
    }).from(disputes)
      .where(numeric !== null
        ? eq(disputes.id, numeric)
        : anyOf([like(disputes.reference, term), like(disputes.title, term)]))
      .orderBy(desc(disputes.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'disputes',
      hits: rows.map(row => ({
        id: row.id,
        ref: row.reference ?? null,
        link: { kind: 'dispute' as const, key: String(row.id) },
        label: row.reference ?? `#${row.id}`,
        detail: row.title,
        status: row.status ?? null,
      })),
    });
  } else omitted.push('disputes');

  // ── Support ──────────────────────────────────────────────────────────────
  if (allowed('tickets')) {
    const rows = await db.select({
      id: supportTickets.id,
      reference: supportTickets.reference,
      subject: supportTickets.subject,
      category: supportTickets.category,
      status: supportTickets.status,
    }).from(supportTickets)
      .where(numeric !== null
        ? eq(supportTickets.id, numeric)
        : anyOf([like(supportTickets.reference, term), like(supportTickets.subject, term)]))
      .orderBy(desc(supportTickets.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'tickets',
      hits: rows.map(row => ({
        id: row.id,
        ref: row.reference ?? null,
        link: { kind: 'ticket' as const, key: String(row.id) },
        label: row.reference ?? `#${row.id}`,
        detail: row.subject,
        status: row.status ?? null,
      })),
    });
  } else omitted.push('tickets');

  // ── Vendor enquiries ─────────────────────────────────────────────────────
  //
  // THROUGH THE CANONICAL QUERY, not a second one. `enquiryList` already
  // resolves an enquiry's state from the pair, already parses a pasted
  // ENQ-501-10, already matches the RFQ title and the vendor's name and
  // company, and already escapes the term through the shared helper. A
  // hand-rolled search here would be a second definition of what an enquiry IS
  // - which is exactly how the two of them drift.
  //
  // An enquiry has no table and therefore no id. Its reference IS its identity,
  // so `id` carries the RFQ - the record the reference resolves against - and
  // every consumer addresses the enquiry by `ref`.
  if (allowed('enquiries')) {
    const page = await enquiryList(db, { search: query, limit: SEARCH_LIMIT });
    segments.push({
      key: 'enquiries',
      hits: page.rows.map(row => ({
        id: row.rfqId,
        ref: row.reference,
        link: { kind: 'enquiry' as const, key: row.reference },
        label: row.reference,
        detail: [row.vendorCompany ?? row.vendorName, row.rfqTitle].filter(Boolean).join(' · ') || null,
        status: row.state,
      })),
    });
  } else omitted.push('enquiries');

  return { query, segments, omitted };
}

/** Kept for the tests, which pin that the two lists cannot drift apart. */
export const SEARCH_SEGMENTS = Object.keys(SEARCH_SEGMENT_PERMISSION) as SearchSegmentKey[];

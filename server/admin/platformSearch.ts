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
import { products, projects, quotations, rfqs, users } from '../../drizzle/schema';
import { containsTerm } from '../_core/searchTerms';
import { getDb } from '../db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Rows per segment. A search result is a way in, not a report. */
export const SEARCH_LIMIT = 10;

export type SearchSegmentKey = 'users' | 'rfqs' | 'quotations' | 'products' | 'projects';

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
};

/**
 * Where the console sends the administrator when they pick a result.
 *
 * A quotation has no admin-only page, so it resolves to the request it was bid
 * on - which is the record an investigator actually wants, and is the link the
 * investigation panel opens.
 */
export type SearchHit = {
  id: number;
  label: string;
  detail: string | null;
  status: string | null;
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

  // ── People ───────────────────────────────────────────────────────────────
  if (allowed('users')) {
    const rows = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      userRole: users.userRole,
      accountStatus: users.accountStatus,
    }).from(users)
      .where(numeric !== null
        ? eq(users.id, numeric)
        : anyOf([like(users.name, term), like(users.email, term), like(users.username, term)]))
      .orderBy(desc(users.id))
      .limit(SEARCH_LIMIT);
    segments.push({
      key: 'users',
      hits: rows.map(row => ({
        id: row.id,
        label: row.name ?? row.username ?? row.email ?? `#${row.id}`,
        detail: row.userRole ?? null,
        status: row.accountStatus ?? null,
      })),
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
      hits: rows.map(row => ({ id: row.id, label: row.title, detail: row.category, status: row.status ?? null })),
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
      active: products.active,
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
        label: row.name,
        detail: row.category,
        status: row.active ? 'active' : 'inactive',
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
      hits: rows.map(row => ({ id: row.id, label: row.title, detail: row.type ?? null, status: row.status ?? null })),
    });
  } else omitted.push('projects');

  return { query, segments, omitted };
}

/** Kept for the tests, which pin that the two lists cannot drift apart. */
export const SEARCH_SEGMENTS = Object.keys(SEARCH_SEGMENT_PERMISSION) as SearchSegmentKey[];

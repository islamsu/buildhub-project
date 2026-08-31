/**
 * ── OLD → NEW → ACTOR → TIME (Parts 42, 43, 44) ────────────────────────────
 *
 * WHY THIS IS NOT commercialAuditEvents.
 *
 * That table records WHICH fields changed and deliberately never their values:
 * "an audit row is read by more people than the record it describes." That was
 * the right call for its audience and is untouched here. But an administrator
 * investigating a dispute has to be able to answer "what was the price before
 * the supplier changed it", and a supplier has to be able to see their own
 * price history - and widening commercialAuditEvents.detail to carry values
 * would hand a competitor's historical pricing to anyone who could already read
 * the audit feed, as a side effect of a reporting change nobody reviewed as a
 * disclosure.
 *
 * So values live in their own table with their own read path.
 *
 * WHO MAY READ IT - the owner's decision, taken explicitly rather than assumed:
 * the record's own owner, and administrators holding `audit.read`. Nobody else.
 * `ownerId` is denormalised onto the row for the same reason
 * commercialAuditEvents does it: scoping the read otherwise means a different
 * join per subject type, five of them, each able to drift out of agreement.
 *
 * APPEND-ONLY. A later change inserts a new row and never rewrites an earlier
 * one, which is what makes "historical commercial events must not change merely
 * because current price changes" a property of the storage rather than a
 * promise about the code that happens to read it today.
 *
 * NEVER RECORD A CREDENTIAL HERE. The fields are business fields - price,
 * status, stock, terms. A password hash, a token or a provider key has no old
 * and new worth showing anyone, and Part 53 forbids surfacing them even to a
 * Super Admin. `FORBIDDEN_FIELDS` enforces that at the boundary rather than by
 * reviewer vigilance.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { fieldValueHistory } from '../../drizzle/schema';

export type FieldSubjectType = 'rfq' | 'quotation' | 'product' | 'user' | 'subscription';

/**
 * Fields that must never reach this table, matched case-insensitively against
 * the whole name so `passwordHash`, `password_hash` and `resetToken` are all
 * caught. A rejected write is dropped rather than throwing: an audit helper
 * must never be the reason a legitimate business mutation fails.
 */
const FORBIDDEN_FIELDS = [
  'password', 'passwordhash', 'token', 'secret', 'apikey', 'credential',
  'session', 'authorization', 'invitationtoken', 'tokenhash',
];

export function isRecordableField(field: string): boolean {
  const normalised = field.toLowerCase().replace(/[^a-z]/g, '');
  return !FORBIDDEN_FIELDS.some(forbidden => normalised.includes(forbidden));
}

export type FieldChange = {
  subjectType: FieldSubjectType;
  subjectId: number;
  /** Who the record belonged to at the time. */
  ownerId: number | null;
  actorId: number | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason?: string | null;
};

/**
 * Record one field's old and new value.
 *
 * BEST-EFFORT BY DESIGN, like notifyUser: never throws, so a failure to write
 * history can never roll back the business change it describes. A change that
 * happened with no history row is a gap in the record; a change refused because
 * the history table was busy is a broken product.
 */
export async function recordFieldChange(db: unknown, change: FieldChange): Promise<void> {
  try {
    if (!db) return;
    if (!isRecordableField(change.field)) return;
    // Nothing changed, nothing to record. Without this every save writes a row
    // per untouched field and the history becomes unreadable exactly when
    // somebody needs it - and, worse, records price changes that never
    // happened. See valuesEqual for why this is not a string comparison.
    if (valuesEqual(change.oldValue, change.newValue)) return;
    await (db as { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } })
      .insert(fieldValueHistory).values({
        subjectType: change.subjectType,
        subjectId: change.subjectId,
        ownerId: change.ownerId ?? null,
        actorId: change.actorId ?? null,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        reason: change.reason ?? null,
      });
  } catch {
    // Swallowed deliberately - see the doc comment above.
  }
}

/** Record several fields of one record in a single call. */
export async function recordFieldChanges(
  db: unknown,
  common: Omit<FieldChange, 'field' | 'oldValue' | 'newValue'>,
  fields: { field: string; oldValue: unknown; newValue: unknown }[],
): Promise<void> {
  for (const entry of fields) {
    await recordFieldChange(db, {
      ...common,
      field: entry.field,
      oldValue: stringifyValue(entry.oldValue),
      newValue: stringifyValue(entry.newValue),
    });
  }
}

/**
 * ARE THESE THE SAME VALUE?
 *
 * Not `===` on the strings, and the difference is not cosmetic. A DECIMAL(12,2)
 * column reads back as "1720.00" while the patch that "changed" it supplies
 * 1720, so a save that altered nothing compared "1720.00" against "1720",
 * called it a change, and wrote a history row saying the price moved from
 * 1720.00 to 1720.
 *
 * Found by saving a product twice in a browser. Nothing in the unit tests
 * could see it: they pass the same string shape to both sides, which is
 * exactly what the database does not do.
 *
 * That phantom row is worse than clutter. The history is read by an
 * administrator settling a dispute, and a fabricated price change is precisely
 * the kind of thing that would be taken as evidence of one.
 *
 * So numeric values are compared as numbers. Everything else is compared as
 * text. The values RECORDED stay exactly as the database and the caller gave
 * them - "1450.00" is what the column held and 1600 is what the supplier
 * typed, and rewriting either into a tidier form would be inventing a figure
 * neither side used.
 */
export function valuesEqual(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const left = Number(a);
  const right = Number(b);
  // Both sides must be genuine numbers. Number('') is 0 and Number(' ') is 0,
  // so blank-vs-zero would otherwise compare equal and hide a real edit.
  if (a.trim() === '' || b.trim() === '') return false;
  if (Number.isFinite(left) && Number.isFinite(right)) return left === right;
  return false;
}

/**
 * How a value is written down. Deliberately simple and lossless enough to read:
 * null becomes null (an absent value), everything else its string form. A
 * decimal column arrives as a string already, so "1450.00" stays exactly that
 * rather than being rounded into a different number by a JSON round-trip.
 */
export function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Compare a record before and after a patch, and record only what moved.
 * `before` and `after` are the raw rows; `fields` names what is worth keeping.
 */
export async function recordChangedFields(
  db: unknown,
  common: Omit<FieldChange, 'field' | 'oldValue' | 'newValue'>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Promise<void> {
  const moved = fields
    .filter(field => field in after)
    .map(field => ({ field, oldValue: before[field], newValue: after[field] }))
    .filter(entry => !valuesEqual(stringifyValue(entry.oldValue), stringifyValue(entry.newValue)));
  await recordFieldChanges(db, common, moved);
}

/** The business fields worth a history entry, per subject. Parts 42 and 44 name these. */
export const HISTORY_FIELDS = {
  rfq: ['title', 'description', 'category', 'budget', 'deadline', 'status', 'location'],
  quotation: ['price', 'currency', 'timeline', 'warranty', 'validUntil', 'commercialTerms', 'paymentTerms', 'attachments', 'status'],
  product: ['price', 'stock', 'description', 'active', 'name', 'unit', 'category'],
  user: ['onboardingStatus', 'verified', 'accountStatus', 'userRole', 'qualifiedEnquiriesPerMonth'],
  subscription: ['plan', 'status'],
} as const satisfies Record<FieldSubjectType, readonly string[]>;

export type HistoryEntry = {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actorId: number | null;
  createdAt: Date;
};

/**
 * Read one record's history, newest first.
 *
 * AUTHORIZATION IS THE CALLER'S, NOT THIS FUNCTION'S - deliberately. Passing a
 * `viewerId` here and having it decide would put a second authorization rule in
 * a helper, where a caller that forgot to pass it would silently get everything.
 * The procedures that call this establish "owner or audit.read" first and this
 * function only reads.
 */
export async function readFieldHistory(
  db: unknown,
  subjectType: FieldSubjectType,
  subjectIds: number[],
  limit = 200,
): Promise<(HistoryEntry & { subjectId: number })[]> {
  if (!db || subjectIds.length === 0) return [];
  const rows = await (db as {
    select: () => { from: (t: unknown) => { where: (c: unknown) => { orderBy: (o: unknown) => { limit: (n: number) => Promise<Record<string, unknown>[]> } } } };
  }).select().from(fieldValueHistory)
    .where(and(eq(fieldValueHistory.subjectType, subjectType), inArray(fieldValueHistory.subjectId, subjectIds)))
    .orderBy(desc(fieldValueHistory.id))
    .limit(limit);
  return rows.map(row => ({
    id: Number(row.id),
    subjectId: Number(row.subjectId),
    field: String(row.field),
    oldValue: (row.oldValue ?? null) as string | null,
    newValue: (row.newValue ?? null) as string | null,
    reason: (row.reason ?? null) as string | null,
    actorId: row.actorId === null || row.actorId === undefined ? null : Number(row.actorId),
    createdAt: row.createdAt as Date,
  }));
}

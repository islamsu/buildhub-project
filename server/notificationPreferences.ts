/**
 * ── THE NOTIFICATION PREFERENCE GATE ──────────────────────────────────────
 *
 * One gate, at the one seam. `notifyUser` and `notifyUsers` are the only two
 * functions in BuildHub that write a notification, so a preference enforced
 * here is enforced for all thirty-one call sites at once and cannot be
 * forgotten by the thirty-second.
 *
 * This is the difference between a preference and a checkbox. A settings
 * screen that hides a row changes nothing about what BuildHub sends; a filter
 * applied where the row is written is the preference actually taking effect.
 *
 * THREE RULES, each enforced here rather than trusted to the caller:
 *
 *   1. A MANDATORY category is always delivered. Not "usually", and not
 *      "unless a row says otherwise" — `deliveryDecision` checks the shared
 *      vocabulary before it looks at the table at all, so a suppression row
 *      for `compliance` that somehow reached the database by another route
 *      still cannot stop a registration decision from arriving.
 *   2. An unrecognised message key is DELIVERED. See
 *      `categoryForMessageKey` for why the failure direction is open, and
 *      `notificationPreferences.test.ts` for the census that stops an
 *      unmapped key from surviving in the tree.
 *   3. A failure to read preferences DELIVERS. A database hiccup in an
 *      optional lookup must not swallow a message; the same best-effort
 *      posture `notifyUser` already takes with its own write.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { getDb } from './db';
import { notificationPreferences } from '../drizzle/schema';
import {
  NOTIFICATION_CATEGORIES,
  categoryForMessageKey,
  isMandatoryCategory,
  type NotificationCategory,
} from '../shared/notificationPreferences';

type Db = Awaited<ReturnType<typeof getDb>>;

export class NotificationPreferenceError extends Error {
  constructor(readonly code: 'UNKNOWN_CATEGORY' | 'CATEGORY_IS_MANDATORY', message: string) {
    super(message);
    this.name = 'NotificationPreferenceError';
  }
}

export const isNotificationCategory = (value: string): value is NotificationCategory =>
  (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);

/**
 * The categories a given user has switched off. Mandatory categories are
 * stripped on the way out, so no caller — including this module's own gate —
 * can be handed a suppression it is required to ignore.
 */
export async function suppressedCategoriesFor(
  db: Db,
  userIds: readonly number[],
): Promise<Map<number, Set<NotificationCategory>>> {
  const result = new Map<number, Set<NotificationCategory>>();
  if (!db || userIds.length === 0) return result;
  const unique = Array.from(new Set(userIds));
  let rows: { userId: number; category: string; enabled: boolean }[] = [];
  try {
    rows = await db
      .select({
        userId: notificationPreferences.userId,
        category: notificationPreferences.category,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, unique));
  } catch (error) {
    // Rule 3: a failed read means "we do not know", and not knowing delivers.
    console.warn('[NotificationPreferences] Failed to read preferences; delivering:', error);
    return result;
  }
  for (const row of rows) {
    if (row.enabled) continue;
    if (!isNotificationCategory(row.category)) continue;
    if (isMandatoryCategory(row.category)) continue;
    const set = result.get(row.userId) ?? new Set<NotificationCategory>();
    set.add(row.category);
    result.set(row.userId, set);
  }
  return result;
}

/**
 * Should this message reach this user? Pure, given the suppression set, so the
 * rule can be tested without a database and read without following a query.
 */
export function deliveryDecision(
  messageKey: string | null | undefined,
  suppressed: ReadonlySet<NotificationCategory> | undefined,
): { deliver: boolean; category: NotificationCategory | null } {
  const category = categoryForMessageKey(messageKey);
  // Rule 2: nothing recognised the key, so nothing may suppress it.
  if (!category) return { deliver: true, category: null };
  // Rule 1: mandatory is decided before the table is consulted.
  if (isMandatoryCategory(category)) return { deliver: true, category };
  return { deliver: !suppressed?.has(category), category };
}

/**
 * The user's own view: every category, whether it is mandatory, and whether it
 * is currently on. Built from the full vocabulary rather than from the stored
 * rows, because the stored rows are only the exceptions — a user who has never
 * touched this screen has none, and must still see the complete list.
 */
export async function notificationPreferencesFor(
  db: Db,
  userId: number,
): Promise<{ category: NotificationCategory; mandatory: boolean; enabled: boolean }[]> {
  const suppressed = (await suppressedCategoriesFor(db, [userId])).get(userId) ?? new Set();
  return NOTIFICATION_CATEGORIES.map(category => ({
    category,
    mandatory: isMandatoryCategory(category),
    enabled: isMandatoryCategory(category) ? true : !suppressed.has(category),
  }));
}

/**
 * Record a choice. Refuses an unknown category and refuses to switch off a
 * mandatory one — server-side, because the locked switch in the settings
 * screen is a courtesy to the user and not a control over the request.
 *
 * Re-enabling writes `enabled = true` rather than deleting the row: the user
 * made a deliberate choice and BuildHub keeps it as a fact, which also makes
 * the write idempotent instead of a delete-or-insert branch.
 */
export async function setNotificationPreference(
  db: Db,
  params: { userId: number; category: string; enabled: boolean },
): Promise<{ category: NotificationCategory; enabled: boolean }> {
  if (!isNotificationCategory(params.category)) {
    throw new NotificationPreferenceError(
      'UNKNOWN_CATEGORY',
      `'${params.category}' is not a notification category.`,
    );
  }
  if (isMandatoryCategory(params.category) && !params.enabled) {
    throw new NotificationPreferenceError(
      'CATEGORY_IS_MANDATORY',
      `Notifications in the '${params.category}' category cannot be switched off.`,
    );
  }
  if (!db) throw new Error('Database unavailable');
  const existing = await db
    .select({ id: notificationPreferences.id })
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.userId, params.userId),
      eq(notificationPreferences.category, params.category),
    ))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(notificationPreferences)
      .set({ enabled: params.enabled })
      .where(eq(notificationPreferences.id, existing[0].id));
  } else {
    await db.insert(notificationPreferences).values({
      userId: params.userId,
      category: params.category,
      enabled: params.enabled,
    });
  }
  return { category: params.category, enabled: params.enabled };
}
